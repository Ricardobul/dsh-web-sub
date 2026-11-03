#!/usr/bin/env node
/**
 * Host smoke test — loads lib/index.js the way Cordis does and drives it with a
 * stub context, so a broken plugin fails here instead of inside DSH.
 *
 *   node tests/host-smoke.mjs
 *
 * Verifies that:
 *   - apply() starts the bridge and registers both providers in `llm-pi-ai`,
 *   - the credential slots are populated (so DSH never hides the providers),
 *   - both RPC routes answer through a stub web server,
 *   - a second apply() would not double-bind (cleanup works).
 */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const plugin = (await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)).default

let failures = 0
function check(label, condition, detail = '') {
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures += 1
    console.log(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const mutations = []
const credentials = new Map()
const routes = new Map()
const disposers = []

const settingsValue = { providers: {} }

const ctx = {
  settings: {
    describe: () => [{ ns: 'llm-pi-ai', value: settingsValue }],
    get: () => settingsValue,
    mutate: async (ns, ops) => {
      mutations.push({ ns, ops })
      for (const op of ops) {
        if (op.op === 'set' && op.path[0] === 'providers') {
          settingsValue.providers[op.path[1]] = op.value
        }
      }
    },
  },
  credentials: {
    set: async (key, value) => { credentials.set(key, value) },
  },
  // Registration is deferred through the timer service; run it at once here.
  timer: {
    setInterval: () => ({ cancel() {} }),
    setTimeout: (fn) => { fn(); return { cancel() {} } },
  },
  effect: (fn) => { disposers.push(fn()) },
  inject: (names, callback) => {
    callback({
      connection: { requestRejection: () => undefined },
      webServer: {
        register: ({ path, handler }) => {
          routes.set(path, handler)
          return () => routes.delete(path)
        },
      },
      effect: (fn) => { disposers.push(fn()) },
    })
  },
}

console.log('host smoke test')
await plugin.apply(ctx)
// The deferred registration resolves on the next tick of the event loop.
await new Promise((resolve) => setTimeout(resolve, 100))

check('both providers were written to llm-pi-ai', mutations.length >= 2, `${mutations.length} mutations`)
check('deepseek-web route points at the local bridge',
  /^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(settingsValue.providers['deepseek-web']?.baseURL ?? ''),
  settingsValue.providers['deepseek-web']?.baseURL)
check('gemini-web route uses the same bridge',
  settingsValue.providers['gemini-web']?.baseURL === settingsValue.providers['deepseek-web']?.baseURL)
check('routes speak the openai-completions dialect',
  settingsValue.providers['deepseek-web']?.api === 'openai-completions'
  && settingsValue.providers['gemini-web']?.api === 'openai-completions')
check('credential slots exist even while unbound',
  credentials.get('WEB_DEEPSEEK_TOKEN') !== undefined && credentials.get('WEB_GEMINI_COOKIE') !== undefined)

// DSH drops the provider with "the API key ... contains characters no HTTP
// header can carry" when the slot holds anything that is not a plain token,
// so the raw Cookie header must never reach the slot.
const headerSafe = (value) => typeof value === 'string'
  && value.length > 0
  && [...value].every((char) => {
    const code = char.codePointAt(0)
    return code >= 0x21 && code <= 0x7e
  })
check('credential slots are header-safe',
  headerSafe(credentials.get('WEB_GEMINI_COOKIE')) && headerSafe(credentials.get('WEB_DEEPSEEK_TOKEN')),
  `${credentials.get('WEB_GEMINI_COOKIE')} / ${credentials.get('WEB_DEEPSEEK_TOKEN')}`)
check('the raw cookie never reaches a credential slot',
  ![...credentials.values()].some((value) => typeof value === 'string'
    && (value.includes(';') || value.includes('\n'))))

// Drive the RPC surface the settings panel uses.
check('settings route registered', routes.has('/_dsh/dsh-web-sub'))
const handler = routes.get('/_dsh/dsh-web-sub')

async function rpc(method, body) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = {
    method: body === undefined ? 'GET' : 'POST',
    url: `/_dsh/dsh-web-sub/${method}`,
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk },
  }
  let status = 0
  let payload = ''
  const res = {
    writeHead: (code) => { status = code },
    end: (text) => { payload = text },
  }
  await handler(req, res)
  return { status, json: payload === '' ? null : JSON.parse(payload) }
}

const status = await rpc('getStatus')
check('getStatus answers ok', status.status === 200 && status.json?.ok === true, JSON.stringify(status.json)?.slice(0, 120))
check('status lists both providers',
  status.json?.providers?.['deepseek-web'] !== undefined && status.json?.providers?.['gemini-web'] !== undefined)
check('bridge is listening', typeof status.json?.port === 'number' && status.json.port > 0, String(status.json?.port))

const unknown = await rpc('nope')
check('unknown methods return 404', unknown.status === 404)

const bad = await rpc('test', { provider: 'nope' })
check('unknown providers are rejected', bad.json?.ok === false && /unknown provider/.test(bad.json.error))

// Cleanup must release the bridge.
for (const dispose of disposers) {
  try { dispose() } catch { /* ignore */ }
}
await new Promise((resolve) => setTimeout(resolve, 150))
const after = await fetch(`http://127.0.0.1:${status.json.port}/health`).then(() => true).catch(() => false)
check('dispose closes the bridge', after === false)

console.log('')
if (failures === 0) console.log('host smoke test passed')
else {
  console.log(`${failures} check(s) failed`)
  process.exitCode = 1
}
