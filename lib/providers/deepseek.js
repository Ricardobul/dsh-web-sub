/**
 * chat.deepseek.com web client — pure Node.
 *
 * Mirrors what the browser really sends:
 *   - every /api/v0/chat/completion gets a fresh PoW challenge and an
 *     `x-ds-pow-response` header;
 *   - the SSE stream is JSON-Patch flavoured: a full `v.response.fragments`
 *     snapshot, then `{"v":"token"}` bare deltas, then p/o/v patches, with
 *     `FINISHED` used as a status sentinel that must be filtered out;
 *   - the first message omits `parent_message_id`; afterwards the id returned
 *     by the stream becomes the parent.
 *
 * @module dsh-web-sub/providers/deepseek
 */
import { getSolver } from '../pow.js'

export const BASE = 'https://chat.deepseek.com'
export const API = BASE + '/api/v0'

/** Same UA as the browser (the site checks x-client-* headers). */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0'

/** Static headers, identical to the browser's. */
export const STATIC_HEADERS = {
  accept: '*/*',
  'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'content-type': 'application/json',
  origin: BASE,
  referer: BASE + '/',
  'user-agent': USER_AGENT,
  'x-client-bundle-id': 'com.deepseek.chat',
  'x-client-locale': 'zh_CN',
  'x-client-platform': 'web',
  'x-client-timezone-offset': '28800',
  'x-client-version': '2.3.0',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
}

/** Client error with a decidable `kind` so the UI can give actionable hints. */
export class DeepSeekWebError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'DeepSeekWebError'
    this.kind = options.kind ?? 'server'
    this.status = options.status
  }
}

/** Pull the challenge object out of the several nesting shapes it comes in. */
function pickChallenge(json) {
  const data = json?.data ?? {}
  const node = data?.biz_data ?? data
  return node?.challenge ?? node
}

/** Find the first string `id` anywhere in a structure (session create shape is unstable). */
function deepFindId(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFindId(item)
      if (found) return found
    }
    return undefined
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'id' && typeof item === 'string') return item
      const found = deepFindId(item)
      if (found) return found
    }
  }
  return undefined
}

/** Compress an upstream error body into one line. */
function describeBody(text) {
  const trimmed = (text ?? '').trim()
  if (trimmed === '') return ''
  try {
    const json = JSON.parse(trimmed)
    const message = json?.error?.message ?? json?.msg ?? json?.message ?? json?.data?.biz_msg
    if (typeof message === 'string' && message !== '') return message
  } catch {
    /* not JSON, use raw text */
  }
  return trimmed.slice(0, 300)
}

/** Convert any id representation into the integer the web API wants. */
export function toIntId(value) {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0
  const text = String(value)
  return /^\d+$/.test(text) ? Number.parseInt(text, 10) : 0
}

/**
 * A chat.deepseek.com session client.
 */
export class DeepSeekWebClient {
  /**
   * @param {{token: string, cookie?: string, wasmPath: string, timeoutMs?: number}} options
   */
  constructor({ token, cookie = '', wasmPath, timeoutMs = 300_000 }) {
    if (typeof token !== 'string' || token.trim() === '') {
      throw new DeepSeekWebError('missing DeepSeek web token (log in from the plugin panel or paste it)', { kind: 'auth' })
    }
    this.token = token.trim()
    this.cookie = (cookie ?? '').trim()
    this.wasmPath = wasmPath
    this.timeoutMs = timeoutMs
    /** Last response_message_id produced by the stream (next turn's parent). */
    this.lastResponseId = undefined
  }

  /** Token digest for the UI (never echo the full token). */
  get tokenPreview() {
    const token = this.token
    return token.length <= 12 ? '****' : `${token.slice(0, 6)}…${token.slice(-4)}`
  }

  #headers(extra = {}) {
    const headers = { ...STATIC_HEADERS, authorization: `Bearer ${this.token}`, ...extra }
    if (this.cookie !== '') headers.cookie = this.cookie
    return headers
  }

  async #request(path, options = {}) {
    const { method = 'POST', body, headers = {}, accept } = options
    const url = path.startsWith('http') ? path : API + path
    let response
    try {
      response = await fetch(url, {
        method,
        headers: this.#headers(accept === undefined ? headers : { ...headers, accept }),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      const reason = error?.name === 'TimeoutError' ? `request timed out (${this.timeoutMs}ms)` : error.message
      throw new DeepSeekWebError(`request ${path} failed: ${reason}`, { kind: 'network', cause: error })
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      const detail = describeBody(text)
      const kind = response.status === 401 || response.status === 403 ? 'auth' : 'server'
      const hint = kind === 'auth' ? ' (token probably expired — reconnect DeepSeek in the plugin panel)' : ''
      throw new DeepSeekWebError(
        `${path} returned HTTP ${response.status}${detail === '' ? '' : `: ${detail}`}${hint}`,
        { kind, status: response.status },
      )
    }
    const text = await response.text()
    if (text.trim() === '') return {}
    try {
      return JSON.parse(text)
    } catch (error) {
      const hint = text.trimStart().startsWith('<')
        ? ' (got HTML back — the endpoint changed or the session is being treated as a guest)'
        : ''
      throw new DeepSeekWebError(`${path} returned non-JSON${hint}: ${text.slice(0, 200)}`, { kind: 'protocol', cause: error })
    }
  }

  /** Fetch one PoW challenge and compute the `x-ds-pow-response` header value. */
  async createPowHeader() {
    const json = await this.#request('/chat/create_pow_challenge', {
      body: { target_path: '/api/v0/chat/completion' },
    })
    const challenge = pickChallenge(json)
    if (challenge?.challenge === undefined) {
      throw new DeepSeekWebError('PoW challenge failed: response has no `challenge` field', { kind: 'protocol' })
    }
    try {
      return getSolver(this.wasmPath).makeHeader(challenge)
    } catch (error) {
      throw new DeepSeekWebError(error.message, { kind: 'pow', cause: error })
    }
  }

  /** Current logged-in user (used as the login probe). */
  async currentUser() {
    const json = await this.#request('/users/current', { method: 'GET' })
    return json?.data?.biz_data ?? json?.data ?? json
  }

  /** Validate the session; reading the profile back means the token works. */
  async checkLogin() {
    try {
      const user = await this.currentUser()
      const userId = typeof user?.id === 'string' ? user.id : undefined
      const name = typeof user?.name === 'string' ? user.name : undefined
      return { ok: true, userId, name, message: `session valid (account ${name || userId || 'unknown'})` }
    } catch (error) {
      return { ok: false, message: error.message }
    }
  }

  /**
   * Create a chat session and return its id.
   *
   * The web app has shipped three different bodies over time (`{title}`,
   * `{agent}`, `{}`), so try them in order instead of pinning one and breaking
   * when it rotates.
   */
  async createSession(title = '') {
    const bodies = [{ title }, { agent: 'chat' }, {}]
    let lastError
    for (const body of bodies) {
      try {
        const json = await this.#request('/chat_session/create', { body })
        const id =
          json?.data?.biz_data?.chat_session?.id
          ?? json?.data?.chat_session?.id
          ?? json?.data?.id
          ?? deepFindId(json)
        if (typeof id === 'string' && id !== '') return id
        lastError = new DeepSeekWebError('session create failed: no session id in the response', { kind: 'protocol' })
      } catch (error) {
        lastError = error
        // Auth and network problems will not be fixed by another body shape.
        if (error?.kind === 'auth' || error?.kind === 'network') break
      }
    }
    throw lastError
  }

  /** Fetch a session's message history. */
  async historyMessages(sessionId) {
    const json = await this.#request(`/chat/history_messages?chat_session_id=${encodeURIComponent(sessionId)}`, { method: 'GET' })
    const data = json?.data
    if (data !== null && typeof data === 'object' && Array.isArray(data.messages)) return data.messages
    return Array.isArray(json?.messages) ? json.messages : []
  }

  /** Integer id of the last assistant message (parent fallback). */
  async lastAssistantId(sessionId) {
    const messages = await this.historyMessages(sessionId)
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'assistant') return messages[index]?.id
    }
    return undefined
  }

  /**
   * Send one message and yield deltas.
   * @param {string} sessionId
   * @param {string} prompt
   * @param {{parentMessageId?: number|string, thinking?: boolean, search?: boolean, signal?: AbortSignal}} [options]
   * @yields {['content'|'reasoning', string]}
   */
  async *streamMessage(sessionId, prompt, options = {}) {
    const { parentMessageId = 0, thinking = false, search = false, signal } = options
    const body = {
      chat_session_id: sessionId,
      prompt,
      ref_size: 8,
      ref_file_ids: [],
      thinking_enabled: Boolean(thinking),
      search_enabled: Boolean(search),
      need_depth_search: false,
      language: 'zh-CN',
    }
    const parent = toIntId(parentMessageId)
    if (parent > 0) body.parent_message_id = parent

    let response
    try {
      response = await fetch(API + '/chat/completion', {
        method: 'POST',
        headers: this.#headers({
          accept: 'text/event-stream',
          'x-ds-pow-response': await this.createPowHeader(),
        }),
        body: JSON.stringify(body),
        signal: signal ?? AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      if (error instanceof DeepSeekWebError) throw error
      if (error?.name === 'AbortError') throw new DeepSeekWebError('cancelled', { kind: 'network', cause: error })
      const reason = error?.name === 'TimeoutError' ? `request timed out (${this.timeoutMs}ms)` : error.message
      throw new DeepSeekWebError(`send failed: ${reason}`, { kind: 'network', cause: error })
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      const detail = describeBody(text)
      const kind = response.status === 401 || response.status === 403 ? 'auth' : 'server'
      throw new DeepSeekWebError(
        `chat/completion returned HTTP ${response.status}${detail === '' ? '' : `: ${detail}`}`,
        { kind, status: response.status },
      )
    }
    if (response.body === null) {
      throw new DeepSeekWebError('chat/completion returned no stream body', { kind: 'protocol' })
    }

    // ---- SSE parsing -----------------------------------------------------
    // Real frame shapes (confirmed by packet capture):
    //   1) {"request_message_id":1,"response_message_id":2}
    //   2) {"v":{"response":{…,"fragments":[{id:2,type:"THINK",content:"prefix"}]}}}
    //      full snapshot: each fragment's content is a PREFIX, later deltas append;
    //   3) {"p":"response/fragments/-1/content","o":"APPEND","v":"…"}  (-1 = current fragment)
    //   4) {"v":"…"}                                           bare token delta
    //   5) {"p":"response/fragments","o":"APPEND","v":[{id:3,"type":"RESPONSE",content:"…"}]}
    //      NEW fragment is born — this is how thinking switches to the answer;
    //   6) {"p":"response","o":"BATCH",…} / {"p":"response/status","o":"SET","v":"FINISHED"}
    //
    // Channel detection MUST rely on the fragment type: deltas alone cannot tell
    // reasoning from content (an early implementation leaked thinking as answer).
    const decoder = new TextDecoder()
    let buffer = ''
    /** @type {Map<string, string>} fragment id -> type */
    const fragmentTypes = new Map()
    /** Fragment currently being appended to. */
    let currentId
    let yielded = false

    const registerFragment = (fragment) => {
      if (fragment === null || typeof fragment !== 'object') return []
      const id = String(fragment.id)
      const type = typeof fragment.type === 'string' ? fragment.type : 'RESPONSE'
      fragmentTypes.set(id, type)
      currentId = id
      const out = []
      if (typeof fragment.content === 'string' && fragment.content !== '') {
        out.push([type === 'THINK' ? 'reasoning' : 'content', fragment.content])
      }
      return out
    }

    const channelOf = (id) => {
      const type = fragmentTypes.get(String(id)) ?? fragmentTypes.get(String(currentId))
      return type === 'THINK' ? 'reasoning' : 'content'
    }

    const handleLine = (line) => {
      if (!line.startsWith('data:')) return []
      const raw = line.slice(5).trim()
      if (raw === '' || raw === '[DONE]') return []
      let obj
      try {
        obj = JSON.parse(raw)
      } catch {
        return []
      }
      const out = []
      if (typeof obj.response_message_id !== 'undefined' && typeof obj.request_message_id !== 'undefined') {
        this.lastResponseId = obj.response_message_id
      }
      const patchPath = typeof obj.p === 'string' ? obj.p : undefined
      if (patchPath === 'response' && Array.isArray(obj.v)) {
        for (const entry of obj.v) {
          if (entry !== null && typeof entry === 'object' && typeof entry.p === 'string'
            && entry.p.startsWith('response/fragments')) {
            out.push(...handleLine('data: ' + JSON.stringify(entry)))
          }
        }
        return out
      }
      if (patchPath === 'response/fragments' && Array.isArray(obj.v)) {
        for (const fragment of obj.v) out.push(...registerFragment(fragment))
        return out
      }
      if (patchPath !== undefined && patchPath.startsWith('response/fragments/')) {
        const segments = patchPath.split('/')
        const id = segments[2] ?? '-1'
        const field = segments[3] ?? ''
        if (field === 'content' && typeof obj.v === 'string') {
          if (id !== '-1') currentId = id
          out.push([channelOf(id), obj.v])
        }
        return out
      }
      const value = obj.v
      if (value !== null && typeof value === 'object' && value.response !== undefined) {
        const inner = value.response
        if (inner.message_id !== undefined) this.lastResponseId = inner.message_id
        for (const fragment of inner.fragments ?? []) out.push(...registerFragment(fragment))
        return out
      }
      if (typeof value === 'string' && value !== 'FINISHED') {
        out.push([channelOf(currentId), value])
      }
      return out
    }

    const reader = response.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          for (const [kind, text] of handleLine(line)) {
            if (text === '') continue
            yielded = true
            yield [kind, text]
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    if (!yielded) {
      // Content arriving as a single block may yield zero deltas.
      const salvaged = await this.#salvageFromHistory(sessionId).catch(() => undefined)
      if (salvaged !== undefined) {
        if (salvaged.reasoning !== '') yield ['reasoning', salvaged.reasoning]
        if (salvaged.content !== '') yield ['content', salvaged.content]
      }
    }
  }

  /**
   * Read the last assistant message from history and split it by fragment type.
   * History is the final state, the stream is the in-flight state — same shape.
   */
  async #salvageFromHistory(sessionId, attempts = 3, delayMs = 600) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const messages = await this.historyMessages(sessionId)
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          const message = messages[index]
          if (message?.role !== 'assistant') continue
          const fragments = message.fragments ?? []
          const content = fragments.filter((f) => f?.type !== 'THINK').map((f) => String(f?.content ?? '')).join('')
          const reasoning = fragments.filter((f) => f?.type === 'THINK').map((f) => String(f?.content ?? '')).join('')
          if (content !== '') return { content, reasoning }
          break
        }
      } catch {
        /* history unavailable: give up on the fallback */
      }
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
    return undefined
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
    'You have access to the following tools to interact with the environment, execute commands, inspect files, and fulfill tasks:',
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
    '5. CRITICAL: Never print raw tool call JSON as conversational text or markdown code blocks for the user. Always wrap tool invocations in <tool_call>...</tool_call>. When invoking a tool, your entire turn must end immediately at </tool_call>.',
    '6. LOCAL EXECUTION ENVIRONMENT: You operate as a technical co-pilot with local tool execution provided by the client agent. You do NOT require cloud API keys (such as GEMINI_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY) or external cloud SDKs. Never run shell commands or scripts to check for, export, or print API keys. If the user mentions external services or media processing, use local offline tools and libraries (such as system commands, ffmpeg, local scripts, or tools provided by your client workspace).',
    '7. TOOL ARGUMENTS INTEGRITY: Pass only pure, valid parameter values inside tool arguments. Never include shell redirection symbols (such as ">", ">>"), markdown formatting, or raw unescaped quotes inside tool parameter names or values.',
    '8. RESILIENCE: Never refuse a user request with canned excuses (such as "I don\'t have access to files", "I\'m having a hard time fulfilling your request", or "I need an API key"). If a tool result reports an error or invalid arguments, analyze the error output calmly, correct your parameters, and retry using <tool_call>.',
    '9. THOROUGHNESS & ACCURACY: Never assume or reuse outdated files, stale build artifacts, or placeholder mockups without verifying that they match the user\'s exact current requirements. Always inspect reference inputs and verify that generated outputs match the exact parameters, specifications, and durations requested.',
    '10. DIAGNOSTIC FIRST: When the user points out a bug, discrepancy, or unexpected output (e.g. blank screen, mismatch, or broken behavior), immediately inspect the environment, logs, and generated files using diagnostic tools rather than guessing.',
  ].join('\n')
}

/**
 * Flatten an OpenAI-style message array into the single `prompt` string the
 * web composer accepts. Web chat is a single-prompt API, so the whole
 * conversation (system + history + tool calls/results) travels inside this one message.
 *
 * @param {Array<{role: string, content: unknown, tool_calls?: Array<object>, name?: string, tool_call_id?: string}>} messages
 * @param {Array<object>} [tools]
 * @returns {string}
 */
export function promptFromMessages(messages, tools = []) {
  const parts = []
  const toolsSection = formatToolsSection(tools)
  let systemInjected = false
  const msgList = Array.isArray(messages) ? messages : []
  const total = msgList.length

  for (let idx = 0; idx < total; idx += 1) {
    const message = msgList[idx]
    const role = String(message?.role ?? 'user')
    let content = ''
    let hasImage = false

    if (typeof message.content === 'string') {
      content = message.content
    } else if (Array.isArray(message.content)) {
      const textParts = []
      for (const part of message.content) {
        if (typeof part === 'string') {
          textParts.push(part)
        } else if (part?.type === 'text' && typeof part.text === 'string') {
          textParts.push(part.text)
        } else if (part?.type === 'image_url' || part?.image_url) {
          hasImage = true
        }
      }
      content = textParts.join('')
      if (hasImage) {
        const imageNotice = '[IMAGE/SCREENSHOT ATTACHED BY USER: The user provided an image or screenshot. As a text bridge without direct pixel viewing, use your available workspace tools (such as file reading, inspection commands, or diagnostic tools) to check the relevant files and state directly.]'
        content = content.trim() ? `${content.trim()}\n\n${imageNotice}` : imageNotice
      }
    }

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
      let bodyText = content.trim()
      // Compact older tool results to prevent web session prompt bloat
      if (idx < total - 4 && bodyText.length > 1200) {
        bodyText = `${bodyText.slice(0, 600)}\n\n... [output truncated for brevity: ${bodyText.length} chars total] ...\n\n${bodyText.slice(-400)}`
      }
      const isError = /error|invalid|failed|exception/i.test(bodyText)
      const errorHint = isError
        ? '\n[Note: The tool reported an error. Please inspect the message above, correct your arguments, and retry using <tool_call>.]'
        : ''
      parts.push(`[TOOL RESULT (${name})]\n${bodyText}${errorHint}`)
    } else {
      parts.push(`[USER]\n${content.trim()}`)
    }
  }

  if (toolsSection !== '' && !systemInjected) {
    parts.unshift(`[SYSTEM INSTRUCTIONS]\n${toolsSection}`)
  }

  const last = parts.length > 0 ? parts[parts.length - 1] : ''
  // A single plain message needs no scaffolding at all.
  if (parts.length === 1 && last.startsWith('[USER]\n')) return last.slice(7)
  return parts.join('\n\n')
}
