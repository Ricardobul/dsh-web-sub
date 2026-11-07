#!/usr/bin/env node
/**
 * dsh-web-sub CLI — bind and test the web sessions without opening DSH.
 *
 *   dsh-web-sub status
 *   dsh-web-sub login deepseek-web        # opens Edge/Chrome, waits for sign-in
 *   dsh-web-sub login gemini-web
 *   dsh-web-sub set deepseek-web --token <jwt> [--cookie "<cookie header>"]
 *   dsh-web-sub set gemini-web --cookie "<cookie header>"
 *   dsh-web-sub check deepseek-web
 *   dsh-web-sub unbind deepseek-web
 *   dsh-web-sub serve                     # run the bridge on its own
 *   dsh-web-sub chat <model> "<prompt>"   # end-to-end smoke test through the bridge
 */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIB = join(HERE, '..', 'lib')
const WASM_PATH = join(HERE, '..', 'assets', 'sha3_wasm_bg.wasm')
const DATA_DIR = process.env.DSH_WEB_SUB_DATA_DIR || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh', 'dsh-web-sub')

/** Import a CommonJS/ESM file from lib/ using a proper file:// URL (Windows-safe). */
const load = (relativePath) => import(pathToFileURL(join(LIB, relativePath)).href)

const { readAccounts, setAccount, removeAccount, maskAccount, readBindFlag, writeBindFlag, DATA_DIR: STORE_DIR } =
  await load('store.js')
const { startBridge, DEFAULT_PORT } = await load('server.js')
const { captureFromDefaultBrowser, captureFromChromium, findChromiumBrowser, defaultBrowser } = await load('browser-login.js')
const { auditVideo, checkVisualQcStatus } = await load('visual-qc.js')
const { ChatGPTWebClient, readCodexAuth, writeCodexAuth, CODEX_OAUTH_CLIENT_ID } = await load(join('providers', 'chatgpt.js'))

const PROVIDERS = ['deepseek-web', 'gemini-web', 'chatgpt']

function usage() {
  console.log(`dsh-web-sub — bind chat.deepseek.com / gemini.google.com / chatgpt.com to DSH

  status                      show what is connected
  browser                     show which browser will be used
  login <provider>            open a browser and wait for sign-in (or OAuth PKCE for chatgpt)
  set <provider> [flags]      paste credentials manually
        --token <jwt>             DeepSeek userToken
        --cookie "<header>"       Cookie header from the site
  check <provider>            validate the stored session
  models <provider>           list the models the account can use
  attach <provider> [port]    capture from a browser already on a debug port
  unbind <provider>           forget a provider
  serve                       run the OpenAI-compatible bridge
  chat <model> "<prompt>"     send one message through the bridge
  audit <file> [flags]        run visual QC on a video (safe-area, OCR, format)
        --ratio <9:16|16:9>       target aspect ratio (default: 9:16)
        --safeArea <pixels>       central safe column in px (default: 880)
  qc                          check visual QC engine readiness (watch-skill)

providers: ${PROVIDERS.join(', ')}
models: deepseek-web-chat, deepseek-web-think, gemini-web, gemini-web-think, gpt-5.6-luna, gpt-6-luna, gpt-5.6-sol, gpt-6-astra
data dir: ${STORE_DIR}`)
}

/** Parse `--flag value` pairs out of argv. */
function flags(argv) {
  const out = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else {
      out[key] = next
      index += 1
    }
  }
  return out
}

function describeStatus() {
  const accounts = readAccounts()
  const preferred = defaultBrowser()
  const chromium = findChromiumBrowser()
  let browserInfo = null
  if (preferred !== null) {
    browserInfo = `${preferred.kind} — ${preferred.path ?? '(path unknown)'} (${preferred.chromium ? 'Chromium' : 'Firefox'})`
  } else if (chromium !== null) {
    browserInfo = `${chromium.kind} — ${chromium.path} (Chromium fallback)`
  } else {
    browserInfo = '(none found)'
  }
  console.log(`data dir : ${STORE_DIR}`)
  console.log(`browser  : ${browserInfo}`)
  console.log(`flag     : ${JSON.stringify(readBindFlag())}`)
  for (const provider of PROVIDERS) {
    if (provider === 'chatgpt') {
      const auth = readCodexAuth()
      console.log(`\n${provider}`)
      if (!auth.accessToken && !auth.refreshToken) {
        console.log('  status  : NOT CONNECTED (run `dsh-web-sub login chatgpt` or ensure ~/.codex/auth.json exists)')
      } else {
        const mask = (t) => (t && t.length > 12 ? `${t.slice(0, 4)}…${t.slice(-4)}` : '****')
        console.log(`  status  : connected (via ${auth.filePath})`)
        console.log(`  plan    : ${auth.planType || 'chatgpt'}`)
        if (auth.email) console.log(`  account : ${auth.email}`)
        console.log(`  token   : ${mask(auth.accessToken)}`)
        if (auth.expiresAt) console.log(`  expires : ${new Date(auth.expiresAt).toLocaleString()}`)
      }
      continue
    }

    const account = accounts[provider]
    console.log(`\n${provider}`)
    if (account === undefined) {
      console.log('  status  : NOT CONNECTED')
      continue
    }
    const masked = maskAccount(account)
    console.log(`  status  : connected (${masked.source ?? 'unknown'} via ${masked.label ?? 'n/a'})`)
    console.log(`  token   : ${masked.tokenPreview ?? '(none)'}`)
    console.log(`  cookie  : ${masked.cookiePreview ?? '(none)'}`)
    console.log(`  updated : ${masked.updatedAt}`)
  }
}

async function validate(provider, credential) {
  if (provider === 'chatgpt' || provider === 'openai-codex') {
    const client = new ChatGPTWebClient()
    const check = await client.checkLogin()
    return {
      ok: check.ok,
      message: check.ok ? `logged in (plan: ${check.planType}, account: ${check.accountId})` : check.message,
      models: [
        { displayName: 'GPT-5.6 Luna', modelName: 'gpt-5.6-luna', modelId: 'gpt-5.6-luna' },
        { displayName: 'GPT-6 Luna', modelName: 'gpt-6-luna', modelId: 'gpt-6-luna' },
        { displayName: 'GPT-5.6 Sol', modelName: 'gpt-5.6-sol', modelId: 'gpt-5.6-sol' },
        { displayName: 'GPT-6 Astra', modelName: 'gpt-6-astra', modelId: 'gpt-6-astra' },
      ],
    }
  }
  if (provider === 'deepseek-web') {
    const { DeepSeekWebClient } = await load(join('providers', 'deepseek.js'))
    const client = new DeepSeekWebClient({ token: credential.token, cookie: credential.cookie ?? '', wasmPath: WASM_PATH })
    return client.checkLogin()
  }
  const { GeminiWebClient } = await load(join('providers', 'gemini.js'))
  const client = new GeminiWebClient({ cookie: credential.cookie })
  const check = await client.checkLogin()
  const models = Array.isArray(check.detail?.models) ? check.detail.models : undefined
  return { ...check, client, models }
}

/** Save the credential plus whatever models the account reported. */
function persist(provider, credential, check) {
  const models = Array.isArray(check?.models) ? check.models : undefined
  setAccount(provider, { provider, ...credential, ...(models === undefined ? {} : { models }) })
  writeBindFlag({ provider })
}

const [, , command, ...rest] = process.argv

try {
  switch (command) {
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      usage()
      break

    case 'status':
      describeStatus()
      break

    case 'browser': {
      const preferred = defaultBrowser()
      const chromium = findChromiumBrowser()
      if (preferred === null) {
        console.log('no browser detected via registry')
      } else {
        console.log(`system default: ${preferred.kind} — ${preferred.path ?? '(path unknown)'}`)
        console.log(`  ${preferred.chromium ? 'Chromium family — DevTools capture available' : 'Firefox — profile capture available'}`)
      }
      if (chromium !== null && (!preferred || !preferred.chromium)) {
        console.log(`fallback Chromium: ${chromium.kind} — ${chromium.path}`)
      } else if (chromium === null && preferred?.chromium !== true) {
        console.log('no Chromium browser available for DevTools capture')
      }
      break
    }

    case 'login': {
      const provider = rest[0]
      const parsedFlags = flags(rest.slice(1))
      if (!PROVIDERS.includes(provider) && provider !== 'openai-codex') {
        console.error(`unknown provider "${provider}" — use one of: ${PROVIDERS.join(', ')}`)
        process.exitCode = 1
        break
      }

      if (provider === 'chatgpt' || provider === 'openai-codex') {
        const auth = readCodexAuth()
        if (auth.accessToken && !parsedFlags.force) {
          const client = new ChatGPTWebClient()
          const check = await client.checkLogin()
          if (check.ok) {
            console.log(`ChatGPT is already connected via ~/.codex/auth.json (Plan: ${check.planType}, Account: ${check.accountId}).`)
            console.log('Use `dsh-web-sub login chatgpt --force` to re-authenticate with a different account.')
            break
          }
        }

        console.log('Initiating ChatGPT OAuth PKCE login...')
        const { createHash, randomBytes } = await import('node:crypto')
        const { createServer } = await import('node:http')
        const { spawn } = await import('node:child_process')

        const verifier = randomBytes(32).toString('base64url')
        const challenge = createHash('sha256').update(verifier).digest('base64url')
        const state = randomBytes(16).toString('base64url')
        const port = 1455

        const authUrl = `https://auth.openai.com/oauth/authorize?client_id=${CODEX_OAUTH_CLIENT_ID}&response_type=code&scope=openid+profile+email+offline_access&redirect_uri=http%3A%2F%2Flocalhost%3A${port}%2Fauth%2Fcallback&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`

        console.log(`\nPlease authenticate in your browser:`)
        console.log(authUrl)

        try {
          if (process.platform === 'win32') {
            spawn('cmd.exe', ['/c', 'start', '', authUrl], { detached: true, stdio: 'ignore' })
          } else if (process.platform === 'darwin') {
            spawn('open', [authUrl], { detached: true, stdio: 'ignore' })
          } else {
            spawn('xdg-open', [authUrl], { detached: true, stdio: 'ignore' })
          }
        } catch {}

        const server = createServer(async (req, res) => {
          const u = new URL(req.url, `http://localhost:${port}`)
          if (u.pathname !== '/auth/callback') {
            res.writeHead(404)
            res.end('Not found')
            return
          }

          const code = u.searchParams.get('code')
          const retState = u.searchParams.get('state')

          if (!code || retState !== state) {
            res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
            res.end('<h2>Authorization failed or state mismatch.</h2>')
            return
          }

          try {
            const tokenRes = await fetch('https://auth.openai.com/oauth/token', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                client_id: CODEX_OAUTH_CLIENT_ID,
                grant_type: 'authorization_code',
                code,
                code_verifier: verifier,
                redirect_uri: `http://localhost:${port}/auth/callback`,
              }),
            })

            if (!tokenRes.ok) {
              const err = await tokenRes.text()
              res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' })
              res.end(`<h2>Token exchange failed</h2><pre>${err}</pre>`)
              return
            }

            const tokenData = await tokenRes.json()
            writeCodexAuth(auth.filePath, tokenData.access_token, tokenData.refresh_token)

            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            res.end('<h2>Success! Connected to ChatGPT Codex.</h2><p>You can close this tab and return to the terminal.</p>')

            console.log('\nChatGPT OAuth login successful! Credentials saved.')
            server.close()
          } catch (err) {
            res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' })
            res.end(`<h2>Error</h2><p>${err.message}</p>`)
            console.error('OAuth exchange error:', err)
          }
        })

        server.listen(port, '127.0.0.1', () => {
          console.log(`\nWaiting for browser callback on http://127.0.0.1:${port}/auth/callback (5 min timeout)...`)
        })

        setTimeout(() => {
          server.close()
        }, 5 * 60 * 1000)

        break
      }

      const preferred = defaultBrowser()
      if (preferred !== null) {
        console.log(`default browser: ${preferred.kind}${preferred.chromium ? ' (Chromium, launching with DevTools)' : ' (Firefox, reading profile)'}`)
      }
      console.log(`waiting for you to sign in to ${provider}…`)
      const captured = await captureFromDefaultBrowser({
        provider,
        dataDir: STORE_DIR,
        log: (message) => console.log(`  · ${message}`),
      })
      const check = await validate(provider, captured)
      if (!check.ok) {
        console.error(`captured a session but it does not work: ${check.message}`)
        process.exitCode = 1
        break
      }
      persist(provider, { ...captured, provider }, check)
      console.log(`connected: ${check.message}`)
      break
    }

    case 'attach': {
      const provider = rest[0]
      if (!PROVIDERS.includes(provider)) {
        console.error(`unknown provider "${provider}" — use one of: ${PROVIDERS.join(', ')}`)
        process.exitCode = 1
        break
      }
      const port = Number(rest[1]) || 9222
      const minutes = Number(rest[2]) || 20
      console.log(`attaching to 127.0.0.1:${port} — sign in to ${provider} in that browser (waiting ${minutes} min)…`)
      const captured = await captureFromChromium({
        provider,
        dataDir: STORE_DIR,
        port,
        timeoutMs: minutes * 60_000,
        attach: true,
        log: (message) => console.log(`  · ${message}`),
      })
      const check = await validate(provider, captured)
      if (!check.ok) {
        console.error(`captured a session but it does not work: ${check.message}`)
        process.exitCode = 1
        break
      }
      persist(provider, { ...captured, provider }, check)
      console.log(`connected: ${check.message}`)
      break
    }

    case 'set': {
      const provider = rest[0]
      if (!PROVIDERS.includes(provider)) {
        console.error(`unknown provider "${provider}" — use one of: ${PROVIDERS.join(', ')}`)
        process.exitCode = 1
        break
      }
      const parsed = flags(rest.slice(1))
      const credential = {
        token: typeof parsed.token === 'string' ? parsed.token.trim() : '',
        cookie: typeof parsed.cookie === 'string' ? parsed.cookie.trim() : '',
        source: 'manual',
        label: 'pasted',
      }
      const check = await validate(provider, credential)
      if (!check.ok) {
        console.error(`credential rejected: ${check.message}`)
        process.exitCode = 1
        break
      }
      persist(provider, credential, check)
      console.log(`connected: ${check.message}`)
      if (Array.isArray(check.models) && check.models.length > 0) {
        console.log('models   :')
        for (const model of check.models) console.log(`  · ${model.displayName}  (${model.modelName} / ${model.modelId})`)
      }
      break
    }

    case 'models': {
      const provider = rest[0] ?? 'gemini-web'
      if (!PROVIDERS.includes(provider)) {
        console.error(`unknown provider "${provider}"`)
        process.exitCode = 1
        break
      }
      const account = readAccounts()[provider] || (provider === 'chatgpt' || provider === 'openai-codex' ? readCodexAuth() : undefined)
      if (account === undefined || (provider === 'chatgpt' && !account.accessToken && !account.refreshToken)) {
        console.error(`${provider} is not connected`)
        process.exitCode = 1
        break
      }
      const check = await validate(provider, account)
      if (!check.ok) {
        console.error(`failed: ${check.message}`)
        process.exitCode = 1
        break
      }
      const models = Array.isArray(check.models) ? check.models : []
      if (models.length === 0) {
        console.log('the account reported no model list')
        break
      }
      persist(provider, account, check)
      console.log(`${models.length} model(s) for ${provider}:`)
      for (const model of models) console.log(`  · ${model.displayName}  (${model.modelName} / ${model.modelId})`)
      break
    }

    case 'check': {
      const provider = rest[0]
      if (!PROVIDERS.includes(provider)) {
        console.error(`unknown provider "${provider}"`)
        process.exitCode = 1
        break
      }
      const account = readAccounts()[provider] || (provider === 'chatgpt' || provider === 'openai-codex' ? readCodexAuth() : undefined)
      if (account === undefined || (provider === 'chatgpt' && !account.accessToken && !account.refreshToken)) {
        console.error(`${provider} is not connected`)
        process.exitCode = 1
        break
      }
      const check = await validate(provider, account)
      console.log(check.ok ? `ok: ${check.message}` : `failed: ${check.message}`)
      process.exitCode = check.ok ? 0 : 1
      break
    }

    case 'unbind': {
      const provider = rest[0]
      if (!PROVIDERS.includes(provider)) {
        console.error(`unknown provider "${provider}"`)
        process.exitCode = 1
        break
      }
      const removed = removeAccount(provider)
      console.log(removed ? `${provider} disconnected` : `${provider} was not connected`)
      break
    }

    case 'serve': {
      const bridge = await startBridge({
        preferredPort: Number(process.env.DSH_WEB_SUB_PORT) || DEFAULT_PORT,
        getAccount: (provider) => readAccounts()[provider] ?? null,
        wasmPath: WASM_PATH,
        dataDir: STORE_DIR,
        log: (message) => console.log(`[bridge] ${message}`),
      })
      console.log(`listening on http://127.0.0.1:${bridge.port}/v1`)
      console.log('Ctrl+C to stop')
      break
    }

    case 'chat': {
      const model = rest[0]
      const prompt = rest.slice(1).join(' ')
      if (model === undefined || prompt === '') {
        console.error('usage: dsh-web-sub chat <model> "<prompt>"')
        process.exitCode = 1
        break
      }
      const bridge = await startBridge({
        preferredPort: Number(process.env.DSH_WEB_SUB_PORT) || DEFAULT_PORT,
        getAccount: (provider) => readAccounts()[provider] ?? null,
        wasmPath: WASM_PATH,
        dataDir: STORE_DIR,
        log: (message) => console.error(`[bridge] ${message}`),
      })
      const response = await fetch(`http://127.0.0.1:${bridge.port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer cli' },
        body: JSON.stringify({ model, stream: true, messages: [{ role: 'user', content: prompt }] }),
      })
      if (!response.ok) {
        console.error(`HTTP ${response.status}: ${await response.text()}`)
        process.exitCode = 1
        break
      }
      const decoder = new TextDecoder()
      let buffer = ''
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const raw = line.slice(5).trim()
          if (raw === '' || raw === '[DONE]') continue
          let payload
          try {
            payload = JSON.parse(raw)
          } catch {
            continue
          }
          if (payload.error !== undefined) {
            console.error(`\nerror: ${payload.error.message}`)
            continue
          }
          const delta = payload.choices?.[0]?.delta ?? {}
          if (typeof delta.reasoning_content === 'string') process.stdout.write(`\x1b[2m${delta.reasoning_content}\x1b[0m`)
          if (typeof delta.content === 'string') process.stdout.write(delta.content)
        }
      }
      process.stdout.write('\n')
      await bridge.close()
      break
    }

    case 'audit': {
      const videoPath = rest[0]
      if (!videoPath) {
        console.error('usage: dsh-web-sub audit <video.mp4> [--ratio 9:16] [--safeArea 880]')
        process.exitCode = 1
        break
      }
      const parsed = flags(process.argv.slice(3))
      const ratio = typeof parsed.ratio === 'string' ? parsed.ratio : '9:16'
      const safeArea = Number(parsed.safeArea) || 880
      console.log(`[visual-qc] Auditing "${videoPath}" (target: ${ratio}, safe area: ${safeArea}px)...`)
      const report = await auditVideo({
        videoPath,
        aspectRatio: ratio,
        safeAreaColumnPx: safeArea,
        log: (m) => console.log(m),
      })
      console.log('\n--- QC REPORT ---')
      console.log(JSON.stringify(report, null, 2))
      if (!report.approved) process.exitCode = 2
      break
    }

    case 'qc': {
      const status = await checkVisualQcStatus()
      console.log('\n--- VISUAL QC ENGINE STATUS ---')
      console.log(JSON.stringify(status, null, 2))
      break
    }

    default:
      console.error(`unknown command "${command}"`)
      usage()
      process.exitCode = 1
  }
} catch (error) {
  console.error(`\nfailed: ${error.message}`)
  if (process.env.DSH_WEB_SUB_DEBUG) console.error(error.stack)
  process.exitCode = 1
}
