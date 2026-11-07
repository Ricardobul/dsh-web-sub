/**
/**
 * ChatGPT Web / OpenAI Codex adapter.
 *
 * Connects directly to the official ChatGPT Codex subscription backend
 * (https://chatgpt.com/backend-api/codex/responses) using the user's OAuth tokens
 * (stored in ~/.codex/auth.json or ~/.dsh/dsh-web-sub/accounts.json).
 *
 * Supports:
 *   - GPT-5.6 Luna (default high-performance reasoning & code model)
 *   - GPT-5.6 Sol, GPT-5.6 Terra, GPT-6 Astra, GPT-6 Luna, GPT-5.3 Codex Spark
 *   - Automatic PKCE OAuth token refresh via auth.openai.com
 *   - Streaming SSE with reasoning and native/synthetic function calling
 *
 * @module dsh-web-sub/providers/chatgpt
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const DEFAULT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api'
export const CODEX_AUTH_FILE = process.env.DSH_CHATGPT_AUTH || join(homedir(), '.codex', 'auth.json')

export const CHATGPT_MODELS = [
  {
    id: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna (ChatGPT Subscription)',
    provider: 'openai-codex',
    contextWindow: 272000,
    maxTokens: 128000,
    thinking: true,
  },
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol (ChatGPT Subscription)',
    provider: 'openai-codex',
    contextWindow: 272000,
    maxTokens: 128000,
    thinking: true,
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra (ChatGPT Subscription)',
    provider: 'openai-codex',
    contextWindow: 272000,
    maxTokens: 128000,
    thinking: true,
  },
  {
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra (ChatGPT Subscription)',
    provider: 'openai-codex',
    contextWindow: 272000,
    maxTokens: 128000,
    thinking: true,
  },
  {
    id: 'gpt-6-luna',
    name: 'GPT-6 Luna (ChatGPT Subscription)',
    provider: 'openai-codex',
    contextWindow: 272000,
    maxTokens: 128000,
    thinking: true,
  },
  {
    id: 'gpt-6-sol',
    name: 'GPT-6 Sol (ChatGPT Subscription)',
    provider: 'openai-codex',
    contextWindow: 272000,
    maxTokens: 128000,
    thinking: true,
  },
  {
    id: 'gpt-5.3-codex-spark',
    name: 'GPT-5.3 Codex Spark (ChatGPT Subscription)',
    provider: 'openai-codex',
    contextWindow: 128000,
    maxTokens: 128000,
    thinking: true,
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5 (ChatGPT Subscription)',
    provider: 'openai-codex',
    contextWindow: 272000,
    maxTokens: 128000,
    thinking: true,
  },
]

export class ChatGPTError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, kind?: string, cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message)
    this.name = 'ChatGPTError'
    this.status = options.status
    this.kind = options.kind ?? 'upstream'
    this.cause = options.cause
  }
}

/**
 * Decode JWT payload without verifying signature (used to check expiration & account id).
 *
 * @param {string} token
 * @returns {Record<string, unknown> | null}
 */
export function decodeJwtPayload(token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8')
    return JSON.parse(json)
  } catch {
    return null
  }
}

/**
 * Read the current stored Codex / ChatGPT OAuth credentials.
 * Checks ~/.codex/auth.json first, then accepts account overrides.
 *
 * @param {string} [filePath]
 * @returns {{ accessToken: string | null, refreshToken: string | null, accountId: string | null, planType: string | null, email: string | null, expiresAt: number | null, filePath: string }}
 */
export function readCodexAuth(filePath = CODEX_AUTH_FILE) {
  if (!existsSync(filePath)) {
    return {
      accessToken: null,
      refreshToken: null,
      accountId: null,
      planType: null,
      email: null,
      expiresAt: null,
      filePath,
    }
  }

  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'))
    const tokens = raw.tokens && typeof raw.tokens === 'object' ? raw.tokens : raw
    const accessToken = typeof tokens.access_token === 'string' ? tokens.access_token : null
    const refreshToken = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : null

    let accountId = typeof tokens.chatgpt_account_id === 'string'
      ? tokens.chatgpt_account_id
      : typeof raw.chatgpt_account_id === 'string'
        ? raw.chatgpt_account_id
        : null

    let planType = typeof tokens.chatgpt_plan_type === 'string' ? tokens.chatgpt_plan_type : null
    let email = typeof raw.email === 'string' ? raw.email : null
    let expiresAt = null

    if (accessToken) {
      const payload = decodeJwtPayload(accessToken)
      if (payload) {
        const authClaim = payload['https://api.openai.com/auth']
        if (authClaim && typeof authClaim === 'object') {
          if (!accountId && typeof authClaim.chatgpt_account_id === 'string') {
            accountId = authClaim.chatgpt_account_id
          }
          if (!planType && typeof authClaim.chatgpt_plan_type === 'string') {
            planType = authClaim.chatgpt_plan_type
          }
        }
        if (typeof payload.email === 'string' && !email) {
          email = payload.email
        }
        if (typeof payload.exp === 'number') {
          expiresAt = payload.exp * 1000
        }
      }
    }

    return {
      accessToken,
      refreshToken,
      accountId,
      planType,
      email,
      expiresAt,
      filePath,
    }
  } catch {
    return {
      accessToken: null,
      refreshToken: null,
      accountId: null,
      planType: null,
      email: null,
      expiresAt: null,
      filePath,
    }
  }
}

/**
 * Atomically write tokens back to auth.json, preserving structure.
 *
 * @param {string} filePath
 * @param {string} accessToken
 * @param {string} [refreshToken]
 */
export function writeCodexAuth(filePath, accessToken, refreshToken) {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
  let existing = {}
  try {
    if (existsSync(filePath)) {
      existing = JSON.parse(readFileSync(filePath, 'utf8'))
    }
  } catch {
    existing = {}
  }

  const payload = decodeJwtPayload(accessToken)
  const authClaim = payload?.['https://api.openai.com/auth']
  const accountId = authClaim?.chatgpt_account_id || existing.chatgpt_account_id
  const planType = authClaim?.chatgpt_plan_type || existing.chatgpt_plan_type
  const email = payload?.email || existing.email

  const updated = {
    ...existing,
    auth_mode: 'oauth',
    email: email || existing.email,
    chatgpt_account_id: accountId || existing.chatgpt_account_id,
    chatgpt_plan_type: planType || existing.chatgpt_plan_type,
    tokens: {
      ...(existing.tokens && typeof existing.tokens === 'object' ? existing.tokens : {}),
      access_token: accessToken,
      refresh_token: refreshToken || existing.tokens?.refresh_token || existing.refresh_token,
      chatgpt_account_id: accountId,
      chatgpt_plan_type: planType,
      last_refresh: new Date().toISOString(),
    },
  }

  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(updated, null, 2) + '\n', { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, filePath)
  chmodSync(filePath, 0o600)
}

/**
 * Refresh OAuth token pair using refresh_token against auth.openai.com.
 *
 * @param {string} refreshToken
 * @param {string} [filePath]
 * @returns {Promise<{ accessToken: string, refreshToken: string, accountId: string | null }>}
 */
export async function refreshCodexToken(refreshToken, filePath = CODEX_AUTH_FILE) {
  if (!refreshToken) {
    throw new ChatGPTError('No refresh token available for ChatGPT.', { kind: 'auth' })
  }

  const res = await fetch('https://auth.openai.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: CODEX_OAUTH_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => '')
    throw new ChatGPTError(`ChatGPT token refresh failed (HTTP ${res.status}): ${errorText}`, {
      status: res.status,
      kind: 'auth',
    })
  }

  const data = await res.json()
  const newAccessToken = data.access_token
  const newRefreshToken = data.refresh_token || refreshToken

  if (!newAccessToken) {
    throw new ChatGPTError('ChatGPT refresh response missing access_token', { kind: 'auth' })
  }

  writeCodexAuth(filePath, newAccessToken, newRefreshToken)
  const auth = readCodexAuth(filePath)
  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    accountId: auth.accountId,
  }
}

/**
 * Ensure an active, valid access token is ready, refreshing automatically if close to expiry (< 5 min).
 *
 * @param {string} [filePath]
 * @returns {Promise<{ accessToken: string, accountId: string }>}
 */
export async function ensureValidCodexToken(filePath = CODEX_AUTH_FILE) {
  const auth = readCodexAuth(filePath)
  if (!auth.accessToken && !auth.refreshToken) {
    throw new ChatGPTError('ChatGPT is not connected. Sign in via `dsh-web-sub login chatgpt` or ensure ~/.codex/auth.json exists.', { kind: 'auth' })
  }

  const now = Date.now()
  const isExpiringSoon = auth.expiresAt !== null && auth.expiresAt - now < 5 * 60 * 1000

  if (!auth.accessToken || isExpiringSoon) {
    if (auth.refreshToken) {
      const refreshed = await refreshCodexToken(auth.refreshToken, filePath)
      return {
        accessToken: refreshed.accessToken,
        accountId: refreshed.accountId || '',
      }
    }
  }

  return {
    accessToken: auth.accessToken,
    accountId: auth.accountId || '',
  }
}

/**
 * Client for interacting with ChatGPT subscription models.
 */
export class ChatGPTWebClient {
  #authFile
  #baseUrl

  /**
   * @param {{ authFile?: string, baseUrl?: string }} [options]
   */
  constructor(options = {}) {
    this.#authFile = options.authFile || CODEX_AUTH_FILE
    this.#baseUrl = (options.baseUrl || DEFAULT_CODEX_BASE_URL).replace(/\/+$/, '')
  }

  /**
   * Check connection status and user subscription metadata.
   */
  async checkLogin() {
    const auth = readCodexAuth(this.#authFile)
    if (!auth.accessToken && !auth.refreshToken) {
      return { ok: false, message: 'Not logged in' }
    }

    try {
      const valid = await ensureValidCodexToken(this.#authFile)
      return {
        ok: true,
        email: auth.email,
        planType: auth.planType || 'chatgpt',
        accountId: valid.accountId,
        expiresAt: auth.expiresAt,
      }
    } catch (error) {
      return { ok: false, message: error.message }
    }
  }

  /**
   * Map standard OpenAI-format messages and tools into Codex Responses API format.
   *
   * @param {Array<object>} messages
   * @param {Array<object>} [tools]
   * @returns {{ input: Array<object>, tools: Array<object> }}
   */
  formatPayload(messages, tools = []) {
    const input = []

    for (const msg of messages ?? []) {
      const role = String(msg.role ?? 'user')
      let content = typeof msg.content === 'string'
        ? msg.content
        : Array.isArray(msg.content)
          ? msg.content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('')
          : ''

      if (role === 'tool') {
        input.push({
          type: 'function_call_output',
          call_id: msg.tool_call_id || 'call_0',
          output: String(content ?? ''),
        })
        continue
      }

      if (role === 'assistant') {
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
          if (content.trim()) {
            input.push({ role: 'assistant', content })
          }
          for (const call of msg.tool_calls) {
            const fn = call.function ?? call
            let args = fn.arguments ?? {}
            if (typeof args !== 'string') args = JSON.stringify(args)
            input.push({
              type: 'function_call',
              call_id: call.id || 'call_0',
              name: fn.name,
              arguments: args,
            })
          }
          continue
        }
        input.push({ role: 'assistant', content })
        continue
      }

      input.push({ role, content })
    }

    const codexTools = (Array.isArray(tools) ? tools : []).map((t) => {
      const fn = t.function ?? t
      return {
        type: 'function',
        name: fn.name,
        description: fn.description || '',
        parameters: fn.parameters || { type: 'object', properties: {} },
      }
    })

    return { input, tools: codexTools }
  }

  /**
   * Stream a chat completion through the ChatGPT Codex responses endpoint.
   * Yields `[kind, text]` deltas ('content' | 'reasoning').
   *
   * @param {{ model: string, messages: Array<object>, tools?: Array<object>, signal?: AbortSignal, thinking?: boolean }} options
   * @returns {AsyncGenerator<[string, string], void, unknown>}
   */
  async *streamMessage(options) {
    const { accessToken, accountId } = await ensureValidCodexToken(this.#authFile)

    const modelName = options.model || 'gpt-5.6-luna'
    const { input, tools } = this.formatPayload(options.messages, options.tools)

    const requestBody = {
      model: modelName,
      input,
      store: false,
      stream: true,
    }

    if (tools.length > 0) {
      requestBody.tools = tools
    }

    const endpoint = `${this.#baseUrl}/codex/responses`
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'chatgpt-account-id': accountId,
      'OpenAI-Beta': 'responses=experimental',
      'accept': 'text/event-stream',
      'content-type': 'application/json',
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: options.signal,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new ChatGPTError(`ChatGPT error (HTTP ${response.status}): ${errorText}`, {
        status: response.status,
        kind: response.status === 401 || response.status === 403 ? 'auth' : 'upstream',
      })
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const dataStr = trimmed.slice(5).trim()
          if (dataStr === '' || dataStr === '[DONE]') continue

          try {
            const event = JSON.parse(dataStr)

            // Content text delta
            if (event.type === 'response.output_text.delta') {
              if (typeof event.delta === 'string') {
                yield ['content', event.delta]
              }
            }

            // Reasoning delta
            else if (
              event.type === 'response.reasoning_text.delta' ||
              event.type === 'response.thought.delta'
            ) {
              if (typeof event.delta === 'string') {
                yield ['reasoning', event.delta]
              }
            }

            // Native function call completion -> format as <tool_call> for server.js
            else if (
              event.type === 'response.output_item.done' &&
              event.item?.type === 'function_call'
            ) {
              const fn = event.item
              let args = fn.arguments ?? '{}'
              if (typeof args !== 'string') args = JSON.stringify(args)
              const toolBlock = `\n<tool_call>\n{"name": ${JSON.stringify(fn.name)}, "arguments": ${args}}\n</tool_call>\n`
              yield ['content', toolBlock]
            }
          } catch {
            /* ignore individual SSE parse error */
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }
}
