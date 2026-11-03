/**
 * One-click login capture through a real browser OR Firefox profile.
 *
 * Two paths:
 *   1. Chromium family (Edge, Chrome, Brave, Vivaldi, Opera) — launch with
 *      `--remote-debugging-port`, wait for sign-in, read session via CDP.
 *   2. Firefox — read cookies.sqlite + localStorage directly from the default
 *      profile. No browser launch needed.
 *
 * The `login` command picks the path automatically based on the system default
 * browser. The `attach` command stays Chromium-only (needs a live CDP port).
 *
 * @module dsh-web-sub/browser-login
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { findChromiumBrowser, defaultBrowser, CHROMIUM_KINDS } from './browser.js'
import { captureFromFirefox } from './firefox.js'
import { SITES, cookieHeaderFrom } from './sites.js'

/** Minimal CDP client over the global WebSocket. */
class Cdp {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    ws.addEventListener('message', (event) => {
      let message
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }
      if (message.id !== undefined && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error !== undefined) reject(new Error(message.error.message ?? 'CDP error'))
        else resolve(message.result)
      }
    })
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url)
      const timer = setTimeout(() => reject(new Error('CDP connect timeout')), 15000)
      ws.addEventListener('open', () => {
        clearTimeout(timer)
        resolve(new Cdp(ws))
      })
      ws.addEventListener('error', (event) => {
        clearTimeout(timer)
        reject(new Error(`CDP socket error: ${event?.message ?? 'unknown'}`))
      })
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP ${method} timed out`))
        }
      }, 30000)
    })
  }

  close() {
    try {
      this.ws.close()
    } catch {
      /* already closed */
    }
  }
}

/** Wait for the DevTools endpoint to answer. */
async function waitForEndpoint(port, deadlineMs) {
  const started = Date.now()
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })
      if (response.ok) return await response.json()
    } catch {
      /* not up yet */
    }
    if (Date.now() - started > deadlineMs) throw new Error('browser did not open a debugging port in time')
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

/** Find the page targets, optionally filtered to a set of hosts. */
async function pageTargets(port, hosts) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })
  const targets = await response.json()
  return targets.filter((target) => target.type === 'page')
    .filter((target) => hosts === undefined || hosts.some((host) => String(target.url).includes(host)))
}

async function findPageTarget(port, hosts) {
  const pages = await pageTargets(port, hosts)
  return pages[0] ?? null
}

/** Ask the browser to open a URL in a new tab. */
async function openTab(port, url) {
  const target = `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`
  for (const method of ['PUT', 'GET']) {
    try {
      const response = await fetch(target, { method, signal: AbortSignal.timeout(5000) })
      if (response.ok) return
    } catch {
      /* try the other verb */
    }
  }
  throw new Error('the DevTools endpoint refused to open a tab')
}

/** Read cookies for a site through CDP. */
async function cookiesFor(cdp, url) {
  const { cookies } = await cdp.send('Network.getCookies', { urls: [url] })
  return cookies
}

/** Evaluate an expression in the page and return its value. */
async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.text ?? 'page evaluation failed')
  return result.result?.value
}

/** Probe the page for a DeepSeek token. */
async function readDeepSeekToken(cdp) {
  const raw = await evaluate(cdp, `JSON.stringify(Object.entries(localStorage))`)
  if (typeof raw !== 'string') return null
  let entries
  try {
    entries = JSON.parse(raw)
  } catch {
    return null
  }

  const looksJwt = (value) => typeof value === 'string' && value.split('.').length === 3 && value.length > 40
  const looksOpaque = (value) => typeof value === 'string' && value.length >= 20 && /\s/.test(value) === false

  const candidates = []
  for (const [key, value] of entries) {
    if (!/token/i.test(key)) continue
    let parsed = value
    try {
      parsed = JSON.parse(value)
    } catch {
      /* not JSON, keep the raw string */
    }
    const candidate = parsed !== null && typeof parsed === 'object' ? (parsed.value ?? parsed.token) : parsed
    if (typeof candidate === 'string' && candidate !== '') candidates.push({ key, candidate })
  }

  const primary = candidates.find((entry) => entry.key === 'userToken')
  if (primary !== undefined && looksOpaque(primary.candidate)) return primary.candidate

  for (const { candidate } of candidates) {
    if (looksJwt(candidate)) return candidate
  }
  for (const [, value] of entries) {
    if (looksJwt(value)) return value
  }
  return null
}

/**
 * Wait for the user to finish signing in via CDP, then return the captured session.
 */
async function captureFromChromium({
  provider,
  dataDir,
  port = 9222,
  timeoutMs = 900_000,
  pollMs = 1500,
  attach = false,
  log = () => {},
}) {
  const site = SITES[provider]

  let browser = null
  if (attach === false) {
    browser = findChromiumBrowser()
    if (browser === null) throw new Error('no Chromium browser found; paste the credential manually instead')

    const userDataDir = join(dataDir, `browser-${provider}`)
    mkdirSync(userDataDir, { recursive: true, mode: 0o700 })

    log(`launching ${browser.kind} with profile ${userDataDir}`)
    const child = spawn(browser.path, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate,MediaRouter',
      site.url,
    ], { detached: true, stdio: 'ignore' })
    child.unref()
  } else {
    log(`attaching to the browser already listening on 127.0.0.1:${port}`)
  }

  await waitForEndpoint(port, 30_000)
  log(`devtools endpoint ready — waiting up to ${Math.round(timeoutMs / 60_000)} min for ${site.hosts[0]}`)

  const started = Date.now()
  let cdp = null
  let attachedId = null
  let lastUrl = null
  let warnedExpired = false
  let openedOnce = false

  try {
    for (;;) {
      if (Date.now() - started > timeoutMs) {
        throw new Error(
          `login was not detected in time (${Math.round(timeoutMs / 60_000)} min) — ` +
          `sign in at ${site.url} and run the command again`,
        )
      }

      let target = null
      try {
        target = await findPageTarget(port, site.hosts)
      } catch {
        /* devtools busy, try again next tick */
      }

      if (target === null) {
        if (lastUrl !== '<no-tab>') {
          log(`no tab on ${site.hosts[0]} yet — open ${site.url} in that browser`)
          lastUrl = '<no-tab>'
        }
        if (openedOnce === false && !attach) {
          openedOnce = true
          try {
            await openTab(port, site.url)
            log(`opened ${site.url}`)
          } catch (error) {
            log(`could not open the tab automatically: ${error.message}`)
          }
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs))
        continue
      }

      if (attachedId !== target.id) {
        if (cdp !== null) cdp.close()
        cdp = await Cdp.connect(target.webSocketDebuggerUrl)
        attachedId = target.id
        await cdp.send('Network.enable')
        await cdp.send('Runtime.enable')
        log(`attached to tab ${target.id.slice(0, 8)} (${target.url})`)
      }

      const url = String(target.url)
      if (url !== lastUrl) {
        lastUrl = url
        if (url !== site.url) log(`page: ${url}`)
      }

      if (/[?&]error=/.test(url) && warnedExpired === false) {
        warnedExpired = true
        log('the provider reported an error on the sign-in round-trip (the OAuth state can expire); retry the sign-in button in that tab')
      }
      if (/[?&]error=/.test(url) === false) warnedExpired = false

      try {
        let captured = null
        if (provider === 'deepseek-web') {
          const token = await readDeepSeekToken(cdp)
          if (token !== null) {
            const cookies = await cookiesFor(cdp, `https://${site.host}`)
            const cookie = cookieHeaderFrom(cookies, { hosts: site.cookieHosts, keep: site.cookieKeep })
            captured = { token, cookie }
          }
        } else if (provider === 'gemini-web') {
          const cookies = await cookiesFor(cdp, `https://${site.host}`)
          const cookie = cookieHeaderFrom(cookies, { hosts: site.cookieHosts, keep: site.cookieKeep })
          if (cookie.includes('__Secure-1PSID=')) captured = { cookie }
        }
        if (captured !== null) {
          log(`captured ${provider} session`)
          return { ...captured, source: 'browser', label: browser?.kind ?? 'attached' }
        }
      } catch (error) {
        log(`probe failed: ${error.message}`)
        if (/websocket|closed|detached/i.test(error.message)) {
          try { cdp.close() } catch { /* already gone */ }
          cdp = null
          attachedId = null
        }
      }

      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
  } finally {
    if (cdp !== null) cdp.close()
  }
}

/**
 * Capture a session from the default browser (auto-detected).
 *
 * @param {{
 *   provider: 'deepseek-web'|'gemini-web',
 *   dataDir: string,
 *   timeoutMs?: number,
 *   pollMs?: number,
 *   log?: (message: string) => void,
 * }} options
 * @returns {Promise<{cookie?: string, token?: string, source: string, label: string}>}
 */
export async function captureFromDefaultBrowser({
  provider,
  dataDir,
  timeoutMs = 900_000,
  pollMs = 1500,
  log = () => {},
}) {
  const preferred = defaultBrowser()
  if (preferred === null) {
    throw new Error('no browser found on this system')
  }

  log(`default browser: ${preferred.kind} (${preferred.path ?? 'path unknown'})`)

  if (preferred.chromium) {
    return captureFromChromium({
      provider,
      dataDir,
      timeoutMs,
      pollMs,
      attach: false,
      log,
    })
  }

  if (preferred.kind === 'firefox') {
    const captured = await captureFromFirefox(provider)
    if (captured !== null) {
      log(`captured ${provider} session from Firefox profile`)
      return captured
    }
    throw new Error('Firefox profile has no valid session for this provider')
  }

  throw new Error(`the default browser (${preferred.kind}) is not supported for automatic capture — use 'attach' with a Chromium browser, or paste the credential manually`)
}

export { SITES, defaultBrowser, findChromiumBrowser, captureFromChromium }