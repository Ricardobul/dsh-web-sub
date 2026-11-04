/**
 * gemini.google.com web client — pure Node.
 *
 * Gemini has no public API for consumer accounts, so this speaks the same
 * internal RPC the web app speaks:
 *
 *   POST https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate
 *   form body: at=<SNlM0e>&f.req=[null,"<81-slot json array>"]
 *
 * Three values must be scraped from the app HTML first:
 *   - `SNlM0e`  -> the `at` anti-CSRF token
 *   - `cfb2h`   -> the `bl` build label
 *   - `FdrFJe`  -> the `f.sid` session id
 *
 * The response is the usual batchexecute stream: `)]}'`, then alternating
 * `<length>` / `<json line>` frames. Each candidate frame carries the FULL text
 * so far, so deltas are computed by comparing against what was already sent.
 *
 * Request shape derived from the actively maintained open-source reference
 * HanaokaYuzu/Gemini-API (MIT).
 *
 * Transport note: this module deliberately does NOT use `fetch()`. undici caps
 * response headers at 16 KB, and `gemini.google.com/app` sends more than that,
 * which surfaced inside DSH as an opaque "fetch failed"
 * (`UND_ERR_HEADERS_OVERFLOW`). `node:https` accepts an explicit
 * `maxHeaderSize`, so the requests are made with it directly.
 *
 * @module dsh-web-sub/providers/gemini
 */
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

export const GEMINI_HOME = 'https://gemini.google.com'
export const GENERATE_ENDPOINT = GEMINI_HOME + '/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate'
export const BATCH_ENDPOINT = GEMINI_HOME + '/_/BardChatUi/data/batchexecute'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'

/**
 * Cap on response-header bytes.
 *
 * Node's default is 16 KB and Google exceeds it on `/app`; raising it is the
 * whole reason this module talks HTTPS directly.
 */
const MAX_HEADER_BYTES = 256 * 1024

/** Slots inside the 81-element request array that carry meaning. */
const STREAMING_FLAG_INDEX = 7
const TEMPORARY_CHAT_FLAG_INDEX = 45
const MODEL_NUMBER_INDEX = 79
const EXTENDED_THINKING_INDEX = 80
/** `[None]*9 + [context]` — the metadata slot the web app sends for a fresh chat. */
const DEFAULT_METADATA = ['', '', '', null, null, null, null, null, null, '']

/** The header that actually selects a model; everything else is bookkeeping. */
export const MODEL_HEADER_KEY = 'x-goog-ext-525001261-jspb'
/** RPC the web app uses to learn which models the signed-in account may pick. */
const USER_STATUS_RPC = 'otAQ7b'

/**
 * Models offered when discovery has not run yet (no session, or the RPC failed).
 *
 * Kept as a *fallback* only: the real list is read from the account, because
 * Google renames, renumbers and re-tiers models without warning.
 */
export const FALLBACK_MODELS = [
  { modelId: 'fbb127bbb056c959', modelName: 'gemini-flash', displayName: 'Gemini Flash', capacity: 1, capacityField: 12, modelNumber: 1 },
  { modelId: '9d8ca3786ebdfbea', modelName: 'gemini-pro', displayName: 'Gemini Pro', capacity: 1, capacityField: 12, modelNumber: 3 },
]

export class GeminiWebError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'GeminiWebError'
    this.kind = options.kind ?? 'server'
    this.status = options.status
  }
}

/** Parse a `name=value; name2=value2` cookie header into a map. */
export function parseCookieHeader(header) {
  const out = new Map()
  for (const chunk of String(header ?? '').split(';')) {
    const index = chunk.indexOf('=')
    if (index < 0) continue
    const name = chunk.slice(0, index).trim()
    if (name === '') continue
    out.set(name, chunk.slice(index + 1).trim())
  }
  return out
}

/** Serialise a cookie map back into a Cookie header. */
export function joinCookieHeader(map) {
  return [...map.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
}

/** Pull the first capture of a regex out of the page HTML. */
function scrape(html, name) {
  const match = html.match(new RegExp(`"${name}":"([^"]+)"`))
  return match === null ? undefined : match[1]
}

/**
 * Turn undici's opaque `fetch failed` into something actionable.
 *
 * `fetch()` throws a bare `TypeError: fetch failed` and hides the real reason on
 * `.cause` (an `AggregateError` on dual-stack hosts). Without walking that chain
 * every network problem looks identical, which is exactly how a blocked request
 * gets mistaken for a broken session.
 */
export function describeNetworkError(error, depth = 0) {
  if (error === null || error === undefined || depth > 4) return 'unknown error'
  const code = typeof error.code === 'string' ? error.code : ''
  const syscall = typeof error.syscall === 'string' ? error.syscall : ''
  const host = typeof error.hostname === 'string' ? error.hostname : (typeof error.host === 'string' ? error.host : '')
  let detail = typeof error.message === 'string' && error.message !== '' ? error.message : String(error)
  if (code !== '' && !detail.includes(code)) detail += ` (${code})`
  if (syscall !== '' && host !== '') detail += ` ${syscall} ${host}`
  else if (host !== '') detail += ` ${host}`
  if (Array.isArray(error.errors) && error.errors.length > 0) {
    const nested = error.errors.map((inner) => describeNetworkError(inner, depth + 1))
    detail += ` [${[...new Set(nested)].join(' | ')}]`
  } else if (error.cause !== undefined && error.cause !== error) {
    const inner = describeNetworkError(error.cause, depth + 1)
    if (inner !== 'unknown error' && !detail.includes(inner)) detail += ` <- ${inner}`
  }
  return detail
}

/**
 * Open an HTTP(S) request and resolve with the (not yet consumed) response.
 *
 * @param {string|URL} url
 * @param {{method?: string, headers?: Record<string,string>, body?: string, timeoutMs?: number, signal?: AbortSignal}} [options]
 */
function openRequest(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = 60_000,
    signal,
  } = options

  return new Promise((resolve, reject) => {
    const target = url instanceof URL ? url : new URL(url)
    const transport = target.protocol === 'http:' ? httpRequest : httpsRequest
    const request = transport(target, { method, headers, maxHeaderSize: MAX_HEADER_BYTES })

    let response = null
    let settled = false

    const fail = (error) => {
      if (settled === true) return
      settled = true
      reject(error)
    }

    const kill = (error) => {
      if (response === null) request.destroy(error)
      else response.destroy(error)
    }

    const onAbort = () => {
      const error = new Error('cancelled')
      error.name = 'AbortError'
      kill(error)
    }

    let timer = null
    const armTimer = (ms) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        kill(new Error(`no answer from ${target.host} within ${Math.round(ms / 1000)}s`))
      }, ms)
      timer.unref?.()
    }
    armTimer(timeoutMs)

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
    }

    if (signal !== undefined) {
      if (signal.aborted === true) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    request.on('error', (error) => {
      cleanup()
      fail(error)
    })
    request.on('response', (incoming) => {
      response = incoming
      settled = true
      incoming.on('data', () => {
        armTimer(timeoutMs)
      })
      incoming.on('close', cleanup)
      incoming.on('end', cleanup)
      resolve(incoming)
    })

    if (body !== undefined) request.write(body)
    request.end()
  })
}

/** Drain a response to text. */
async function readText(response) {
  const chunks = []
  for await (const chunk of response) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * GET a URL, following redirects, with header room Google's `/app` needs.
 * @returns {Promise<{status: number, headers: Record<string, unknown>, body: string}>}
 */
async function getText(url, options = {}, maxRedirects = 5) {
  let current = url instanceof URL ? url.toString() : String(url)
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const response = await openRequest(current, { ...options, method: 'GET' })
    const status = response.statusCode ?? 0
    const location = response.headers.location
    if (status >= 300 && status < 400 && typeof location === 'string' && location !== '') {
      response.resume()
      current = new URL(location, current).toString()
      continue
    }
    const body = await readText(response)
    return { status, headers: response.headers, body }
  }
  throw new Error('too many redirects')
}

/** Read a nested value with a path of array indices; `undefined` when absent. */
function at(value, path) {
  let node = value
  for (const key of path) {
    if (node === null || node === undefined) return undefined
    node = node[key]
  }
  return node
}

/** `Gemini 4 Argon` -> `gemini-4-argon`. */
export function slugify(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Which capacity value this account may ask for.
 *
 * Mirrors the tiers the web app uses: the same model id is served at a higher
 * capacity for paid plans, and asking above your tier is rejected outright.
 */
function computeCapacity(tierFlags, capabilityFlags) {
  const has = (list, value) => Array.isArray(list) && list.includes(value)
  if (has(tierFlags, 21)) return { capacity: 1, capacityField: 13 }
  if (has(tierFlags, 22)) return { capacity: 2, capacityField: 13 }
  if (has(capabilityFlags, 115)) return { capacity: 4, capacityField: 12 }
  if (has(tierFlags, 16) || has(capabilityFlags, 106)) return { capacity: 3, capacityField: 12 }
  if (has(tierFlags, 8) || has(capabilityFlags, 19)) return { capacity: 2, capacityField: 12 }
  return { capacity: 1, capacityField: 12 }
}

/** Turn one entry of the account's model list into a plain model descriptor. */
function modelFromRpc(entry, capacity, capacityField) {
  if (!Array.isArray(entry)) return null
  const modelId = at(entry, [0])
  if (typeof modelId !== 'string' || modelId === '') return null
  const category = at(entry, [1]) ?? at(entry, [10]) ?? ''
  const displayName = at(entry, [11]) || at(entry, [19]) || category || modelId
  const description = at(entry, [12]) || at(entry, [2]) || ''
  const rawNumber = at(entry, [17])
  const secondary = at(entry, [9])
  const modelNumber = typeof rawNumber === 'number' ? rawNumber : (typeof secondary === 'number' ? secondary : 1)
  const modelName = category === '' ? `gemini-${slugify(displayName)}` : `gemini-${slugify(category)}`
  const aliases = new Set([
    modelId.toLowerCase(),
    modelName,
    slugify(category),
    slugify(displayName),
    `gemini-${slugify(displayName)}`,
  ].filter((alias) => alias !== ''))
  return {
    modelId,
    modelName,
    displayName: String(displayName),
    description: String(description),
    capacity,
    capacityField,
    modelNumber,
    aliases: [...aliases],
  }
}

/** Remove Google's artefact placeholder links that leak into reply text. */
const ARTEFACTS = /https?:\/\/googleusercontent\.com\/(?:\w+\/)*\d+\n*/g

/**
 * A gemini.google.com client bound to one account's cookies.
 */
export class GeminiWebClient {
  /**
   * @param {{cookie: string, language?: string, timeoutMs?: number}} options
   */
  constructor({ cookie, language = 'en', timeoutMs = 300_000 }) {
    const jar = parseCookieHeader(cookie)
    if (!jar.has('__Secure-1PSID')) {
      throw new GeminiWebError('missing __Secure-1PSID cookie (log in from the plugin panel or paste the Cookie header)', { kind: 'auth' })
    }
    this.jar = jar
    this.language = language
    this.timeoutMs = timeoutMs
    this.buildLabel = undefined
    this.sessionId = undefined
    this.accessToken = undefined
    /** UUID4 that ties every request of this client instance together. */
    this.sessionUuid = crypto.randomUUID().toUpperCase()
    /** Models this account may pick, filled by discoverModels(). */
    this.models = []
    this.accountStatus = undefined
    this._reqid = Math.floor(Math.random() * 900000) + 100000
    this.lastCid = ''
    this.lastRid = ''
  }

  get cookiePreview() {
    const psid = this.jar.get('__Secure-1PSID') ?? ''
    return psid.length <= 12 ? '****' : `${psid.slice(0, 6)}…${psid.slice(-4)}`
  }

  #headers(extra = {}) {
    return {
      'content-type': 'application/x-www-form-urlencoded;charset=utf-8',
      origin: GEMINI_HOME,
      referer: GEMINI_HOME + '/',
      'user-agent': USER_AGENT,
      'x-same-domain': '1',
      'accept-language': 'en-US,en;q=0.9',
      cookie: joinCookieHeader(this.jar),
      ...extra,
    }
  }

  /**
   * Load the app page to refresh cookies and scrape `at` / `bl` / `f.sid`.
   * Also absorbs any `__Secure-1PSIDTS` rotation Google hands back.
   */
  async init() {
    let page
    try {
      page = await getText(GEMINI_HOME + '/app', {
        headers: {
          'user-agent': USER_AGENT,
          'accept-language': 'en-US,en;q=0.9',
          cookie: joinCookieHeader(this.jar),
        },
        timeoutMs: 60_000,
      })
    } catch (error) {
      throw new GeminiWebError(`cannot reach gemini.google.com: ${describeNetworkError(error)}`, { kind: 'network', cause: error })
    }

    // Google rotates __Secure-1PSIDTS on almost every page load; keeping it fresh
    // is what stops the session from silently dying an hour later.
    const setCookies = page.headers['set-cookie']
    for (const line of Array.isArray(setCookies) ? setCookies : []) {
      const [pair] = String(line).split(';')
      const index = pair.indexOf('=')
      if (index < 0) continue
      const name = pair.slice(0, index).trim()
      const value = pair.slice(index + 1).trim()
      if (name === '__Secure-1PSIDTS' || name === '__Secure-1PSID') this.jar.set(name, value)
    }

    if (page.status < 200 || page.status > 299) {
      const kind = page.status === 401 || page.status === 403 ? 'auth' : 'server'
      throw new GeminiWebError(`gemini.google.com/app returned HTTP ${page.status}`, { kind, status: page.status })
    }

    const html = page.body
    this.accessToken = scrape(html, 'SNlM0e')
    this.buildLabel = scrape(html, 'cfb2h')
    this.sessionId = scrape(html, 'FdrFJe')

    if (this.accessToken === undefined) {
      throw new GeminiWebError(
        'could not read the SNlM0e token from the page — the session is not logged in (or the cookies expired)',
        { kind: 'auth' },
      )
    }

    // Model names live in the account, not in the code: Google renames and
    // renumbers them. Discovery is best-effort — a failure must not break login.
    try {
      await this.discoverModels()
    } catch {
      /* keep the fallback list */
    }

    return {
      ok: true,
      hasBuildLabel: this.buildLabel !== undefined,
      hasSessionId: this.sessionId !== undefined,
      cookie: joinCookieHeader(this.jar),
      cookieNames: [...this.jar.keys()],
      // Persisted verbatim, so keep the field names the catalogue reads back.
      models: this.models.map((model) => ({
        modelId: model.modelId,
        modelName: model.modelName,
        displayName: model.displayName,
      })),
    }
  }

  /** POST one `batchexecute` RPC and return the decoded `part[2]` bodies. */
  async #batchExec(rpcId, payload) {
    if (this.accessToken === undefined) await this.init()

    const reqid = this._reqid
    this._reqid += 100000

    const url = new URL(BATCH_ENDPOINT)
    url.searchParams.set('rpcids', rpcId)
    url.searchParams.set('hl', this.language)
    url.searchParams.set('_reqid', String(reqid))
    url.searchParams.set('rt', 'c')
    if (this.buildLabel !== undefined) url.searchParams.set('bl', this.buildLabel)
    if (this.sessionId !== undefined) url.searchParams.set('f.sid', this.sessionId)

    const batchHeader = JSON.parse('[1,null,null,null,null,null,null,null,[4,5,6,8],null,null,null,null,null,null,null]')
    batchHeader.push(this.sessionUuid)

    let response
    let text
    try {
      response = await openRequest(url, {
        method: 'POST',
        headers: this.#headers({
          [MODEL_HEADER_KEY]: JSON.stringify(batchHeader),
          'x-goog-ext-73010989-jspb': '[0]',
        }),
        body: new URLSearchParams({
          at: this.accessToken,
          'f.req': JSON.stringify([[[rpcId, payload, null, 'generic']]]),
        }).toString(),
        timeoutMs: 60_000,
      })
      const status = response.statusCode ?? 0
      if (status < 200 || status > 299) {
        response.resume()
        throw new GeminiWebError(`batchexecute ${rpcId} returned HTTP ${status}`, { kind: 'server', status })
      }
      text = await readText(response)
    } catch (error) {
      if (error instanceof GeminiWebError) throw error
      throw new GeminiWebError(`batchexecute ${rpcId} failed: ${describeNetworkError(error)}`, { kind: 'network', cause: error })
    }

    const bodies = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('[')) continue
      let frames
      try {
        frames = JSON.parse(trimmed)
      } catch {
        continue
      }
      for (const frame of Array.isArray(frames) ? frames : []) {
        if (!Array.isArray(frame)) continue
        if (frame[1] !== rpcId) continue
        const body = frame[2]
        if (typeof body !== 'string') continue
        try {
          bodies.push(JSON.parse(body))
        } catch {
          /* skip malformed frame */
        }
      }
    }
    return bodies
  }

  /**
   * Ask the account which models it may use, in the order the web app shows them.
   *
   * Falls back to `FALLBACK_MODELS` when the RPC is unavailable, so a request
   * can still be sent with the default model (no header at all).
   */
  async discoverModels() {
    const bodies = await this.#batchExec(USER_STATUS_RPC, '[]')
    const found = []
    for (const body of bodies) {
      const statusCode = at(body, [14])
      if (typeof statusCode === 'number') this.accountStatus = statusCode
      const list = at(body, [15])
      if (!Array.isArray(list)) continue
      const { capacity, capacityField } = computeCapacity(at(body, [16]), at(body, [17]))
      for (const entry of list) {
        const model = modelFromRpc(entry, capacity, capacityField)
        if (model !== null) found.push(model)
      }
      if (found.length > 0) break
    }
    this.models = found.length > 0 ? found : FALLBACK_MODELS.map((model) => ({
      ...model,
      description: '',
      aliases: [model.modelId, model.modelName],
    }))
    return this.models
  }

  /**
   * Pick the model the caller meant. `undefined` means "let Google choose".
   *
   * Matching is intentionally loose: DSH model ids, display names seen in the
   * browser (`Gemini Argon`), slugs and raw hex ids all resolve.
   */
  resolveModel(name) {
    const wanted = String(name ?? '').trim()
    if (wanted === '') return undefined
    const list = this.models.length > 0
      ? this.models
      : FALLBACK_MODELS.map((model) => ({ ...model, description: '', aliases: [model.modelId, model.modelName] }))
    const needle = wanted.toLowerCase()

    for (const model of list) {
      if (model.modelId.toLowerCase() === needle) return model
      if (model.modelName.toLowerCase() === needle) return model
      if (String(model.displayName).toLowerCase() === needle) return model
    }
    for (const model of list) {
      if (model.aliases.some((alias) => alias === needle)) return model
    }
    const slug = slugify(wanted)
    for (const model of list) {
      if (model.aliases.some((alias) => slugify(alias) === slug)) return model
      if (slugify(model.modelName) === slug) return model
      if (slugify(model.displayName) === slug) return model
    }
    // Last resort: the requested word appears somewhere in the model's names.
    for (const model of list) {
      const haystack = `${model.modelName} ${model.displayName} ${model.aliases.join(' ')}`.toLowerCase()
      if (haystack.includes(needle)) return model
    }
    return undefined
  }

  /**
   * Build the model-selection header.
   *
   * Shape (17 slots): `[1,null,null,null,"<id>",null,null,0,[4,5,6,8],null,null,
   * <capacity>,null,null,<modelNumber>,<thinkingFlag>,"<sessionUUID>"]`.
   * `capacityField === 13` shifts capacity one slot right, matching the web app.
   */
  buildModelHeader(model, extendedThinking = false) {
    const tail = model.capacityField === 13 ? `null,${model.capacity}` : String(model.capacity)
    const parsed = JSON.parse(
      `[1,null,null,null,${JSON.stringify(model.modelId)},null,null,0,[4,5,6,8],null,null,${tail},null,null,${model.modelNumber}]`,
    )
    parsed.push(extendedThinking ? 2 : 1)
    parsed.push(this.sessionUuid)
    return JSON.stringify(parsed)
  }

  /** Convenience for tests and diagnostics: header value for a model name. */
  headerForName(name, extendedThinking = false) {
    const model = this.resolveModel(name)
    return model === undefined ? undefined : this.buildModelHeader(model, extendedThinking)
  }

  /** Validate the session by loading the app page. */
  async checkLogin() {
    try {
      const info = await this.init()
      return { ok: true, message: 'session valid', detail: info }
    } catch (error) {
      return { ok: false, message: error.message }
    }
  }

  /**
   * Build the 81-slot inner request array for a prompt.
   * @param {string} prompt
   * @param {{temporary?: boolean, extendedThinking?: boolean, model?: object}} options
   */
  #buildInnerRequest(prompt, options = {}) {
    const inner = new Array(81).fill(null)
    inner[0] = [prompt, 0, null, null, null, null, 0]
    inner[1] = [this.language]
    inner[2] = DEFAULT_METADATA
    inner[6] = [1]
    inner[STREAMING_FLAG_INDEX] = 1
    inner[10] = 1
    inner[11] = 0
    inner[17] = [[0]]
    inner[18] = 0
    inner[27] = 1
    inner[30] = [4]
    inner[41] = [1]
    if (options.temporary === true) inner[TEMPORARY_CHAT_FLAG_INDEX] = 1
    inner[53] = 0
    inner[59] = crypto.randomUUID().toUpperCase()
    inner[61] = []
    inner[68] = 1
    inner[MODEL_NUMBER_INDEX] = options.model?.modelNumber ?? 1
    inner[EXTENDED_THINKING_INDEX] = options.extendedThinking === true ? 2 : 1
    return inner
  }

  /**
   * Send a prompt and yield `['content'|'reasoning', text]` deltas.
   * @param {string} prompt
   * @param {{model?: string, temporary?: boolean, extendedThinking?: boolean, signal?: AbortSignal}} [options]
   */
  async *streamMessage(prompt, options = {}) {
    if (this.accessToken === undefined) await this.init()

    const selected = this.resolveModel(options.model)
    const reqid = this._reqid
    this._reqid += 100000

    const url = new URL(GENERATE_ENDPOINT)
    url.searchParams.set('hl', this.language)
    url.searchParams.set('_reqid', String(reqid))
    url.searchParams.set('rt', 'c')
    if (this.buildLabel !== undefined) url.searchParams.set('bl', this.buildLabel)
    if (this.sessionId !== undefined) url.searchParams.set('f.sid', this.sessionId)

    const uuid = crypto.randomUUID().toUpperCase()
    const body = new URLSearchParams({
      at: this.accessToken,
      'f.req': JSON.stringify([
        null,
        JSON.stringify(this.#buildInnerRequest(prompt, { ...options, model: selected })),
      ]),
    })

    const headers = this.#headers({
      // The UUID ties this generate call to the client instance; the model
      // header is what actually selects the model.
      'x-goog-ext-525005358-jspb': `["${uuid}",1]`,
    })
    if (selected !== undefined) {
      headers[MODEL_HEADER_KEY] = this.buildModelHeader(selected, options.extendedThinking === true)
      headers['x-goog-ext-73010989-jspb'] = '[0]'
      headers['x-goog-ext-73010990-jspb'] = '[0,0,0]'
    }

    let response
    try {
      response = await openRequest(url, {
        method: 'POST',
        headers,
        body: body.toString(),
        timeoutMs: this.timeoutMs,
        signal: options.signal,
      })
    } catch (error) {
      if (error?.name === 'AbortError') throw new GeminiWebError('cancelled', { kind: 'network', cause: error })
      throw new GeminiWebError(`generate request failed: ${describeNetworkError(error)}`, { kind: 'network', cause: error })
    }
    const status = response.statusCode ?? 0
    if (status < 200 || status > 299) {
      const detail = await readText(response).catch(() => '')
      const kind = status === 401 || status === 403 ? 'auth' : 'server'
      throw new GeminiWebError(`StreamGenerate returned HTTP ${status}: ${detail.slice(0, 200)}`, { kind, status })
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let lastText = ''
    let lastThoughts = ''
    let emitted = false

    /** Handle one `wrb.fr` frame line. Returns deltas. */
    const handleFrame = (line) => {
      const out = []
      const trimmed = line.trim()
      if (!trimmed.startsWith('[')) return out
      let parsed
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        return out
      }
      const parts = Array.isArray(parsed) ? parsed : [parsed]
      for (const part of parts) {
        if (!Array.isArray(part)) continue
        const innerJson = part[2]
        if (typeof innerJson !== 'string') continue
        let inner
        try {
          inner = JSON.parse(innerJson)
        } catch {
          continue
        }
        const meta = at(inner, [1])
        if (Array.isArray(meta)) {
          if (typeof meta[0] === 'string' && meta[0] !== '') this.lastCid = meta[0]
          if (typeof meta[1] === 'string' && meta[1] !== '') this.lastRid = meta[1]
        }
        const candidates = at(inner, [4])
        if (!Array.isArray(candidates)) continue
        for (const candidate of candidates) {
          let text = String(at(candidate, [1, 0]) ?? '').replace(ARTEFACTS, '')
          const thoughts = String(at(candidate, [37, 0, 0]) ?? '')
          if (thoughts.length > lastThoughts.length) {
            out.push(['reasoning', thoughts.slice(lastThoughts.length)])
            lastThoughts = thoughts
          }
          if (text.length > lastText.length) {
            out.push(['content', text.slice(lastText.length)])
            lastText = text
          }
        }
      }
      return out
    }

    try {
      for await (const chunk of response) {
        buffer += decoder.decode(chunk, { stream: true })
        // The payload starts with Google's XSSI guard.
        if (buffer.startsWith(")]}'")) buffer = buffer.slice(4)

        let newlineIndex
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIndex)
          buffer = buffer.slice(newlineIndex + 1)
          for (const [kind, text] of handleFrame(line)) {
            if (text === '') continue
            emitted = true
            yield [kind, text]
          }
        }
      }
      // Flush whatever is left.
      for (const [kind, text] of handleFrame(buffer)) {
        if (text === '') continue
        emitted = true
        yield [kind, text]
      }
    } finally {
      response.destroy()
    }

    if (!emitted) {
      throw new GeminiWebError('Gemini returned no text (the request shape may have changed)', { kind: 'protocol' })
    }
  }
}

/**
 * Format a list of OpenAI-style tools into an instruction block that tells the
 * web model which tools exist and how to call them using <tool_call> tags.
 *
 * @param {Array<object>} tools
 * @returns {string}
 */
export function formatToolsSection(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return ''
  const definitions = tools.map((t) => {
    const fn = t.function ?? t
    const name = fn.name
    const desc = fn.description ? fn.description.trim() : 'No description provided.'
    const params = fn.parameters ? JSON.stringify(fn.parameters) : '{}'
    return `- ${name}: ${desc}\n  Parameters: ${params}`
  }).join('\n')

  return [
    '# AVAILABLE TOOLS',
    'You have access to the following tools to interact with the environment, execute commands, and inspect files:',
    definitions,
    '',
    '# TOOL INVOCATION INSTRUCTIONS',
    'To call a tool, you MUST wrap your call in <tool_call> tags containing a single valid JSON object:',
    '<tool_call>',
    '{"name": "tool_name", "arguments": {"param1": "value1"}}',
    '</tool_call>',
    '',
    'RULES:',
    '1. Always output valid JSON inside <tool_call>...</tool_call>. Do not omit arguments.',
    '2. You may explain your plan briefly BEFORE calling a tool. Never output any text after </tool_call>.',
    '3. As soon as you output </tool_call>, STOP generating immediately. The system will execute the tool and provide the output as [TOOL RESULT].',
    '4. Only call tools listed under AVAILABLE TOOLS. Never fabricate tool outputs yourself.',
  ].join('\n')
}

/**
 * Flatten OpenAI-style messages into a single prompt, preserving roles, tool
 * calls, and tool results.
 *
 * @param {Array<{role: string, content: unknown, tool_calls?: Array<object>, name?: string, tool_call_id?: string}>} messages
 * @param {Array<object>} [tools]
 * @returns {string}
 */
export function promptFromMessages(messages, tools = []) {
  const parts = []
  const toolsSection = formatToolsSection(tools)
  let systemInjected = false

  for (const message of messages ?? []) {
    const role = String(message?.role ?? 'user')
    let content = typeof message.content === 'string'
      ? message.content
      : Array.isArray(message.content)
        ? message.content.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('')
        : ''

    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      const calls = message.tool_calls.map((call) => {
        const fn = call.function ?? call
        const name = fn.name
        let args = fn.arguments ?? {}
        if (typeof args !== 'string') {
          args = JSON.stringify(args)
        }
        return `<tool_call>\n{"name": ${JSON.stringify(name)}, "arguments": ${args}}\n</tool_call>`
      }).join('\n')
      content = content.trim() ? `${content.trim()}\n${calls}` : calls
    }

    if (content.trim() === '') continue

    if (role === 'system') {
      if (toolsSection !== '' && !systemInjected) {
        parts.push(`[SYSTEM INSTRUCTIONS]\n${content.trim()}\n\n${toolsSection}`)
        systemInjected = true
      } else {
        parts.push(`[SYSTEM INSTRUCTIONS]\n${content.trim()}`)
      }
    } else if (role === 'assistant') {
      parts.push(`[ASSISTANT]\n${content.trim()}`)
    } else if (role === 'tool') {
      const name = message.name || message.tool_call_id || 'tool'
      parts.push(`[TOOL RESULT (${name})]\n${content.trim()}`)
    } else {
      parts.push(`[USER]\n${content.trim()}`)
    }
  }

  if (toolsSection !== '' && !systemInjected) {
    parts.unshift(`[SYSTEM INSTRUCTIONS]\n${toolsSection}`)
  }

  const last = parts.length > 0 ? parts[parts.length - 1] : ''
  if (parts.length === 1 && last.startsWith('[USER]\n')) return last.slice(7)
  return parts.join('\n\n')
}
