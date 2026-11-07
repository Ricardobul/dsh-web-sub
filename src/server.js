/**
 * Local OpenAI-compatible bridge for dsh-web-sub.
 *
 * DSH's `llm-pi-ai` layer speaks `openai-completions` against a `baseURL`; this
 * server is that baseURL. It exposes the bound web sessions as ordinary models,
 * so nothing downstream has to know a browser session is behind them.
 *
 * Routes:
 *   GET  /health                -> liveness + which providers are bound
 *   GET  /v1/models             -> OpenAI model list
 *   POST /v1/chat/completions   -> streaming (SSE) or buffered completion
 *
 * @module dsh-web-sub/server
 */
import { createServer } from 'node:http'
import fs from 'node:fs'
import { join } from 'node:path'
import { DeepSeekWebClient, promptFromMessages as deepseekPrompt } from './providers/deepseek.js'
import { GeminiWebClient, promptFromMessages as geminiPrompt } from './providers/gemini.js'
import { captureFromFirefox } from './firefox.js'
import { setAccount } from './store.js'
import { auditVideo } from './visual-qc.js'
import { MiddlewareEngine } from './middleware.js'

export const BUILTIN_AUDIT_TOOL = {
  type: 'function',
  function: {
    name: 'auditar_video',
    description: 'Executa auditoria visual e OCR em clipes de vídeo/motion graphics renderizados. Verifica Safe-Area 9:16 / 16:9 (coluna central de 880px), corte de texto e integridade.',
    parameters: {
      type: 'object',
      properties: {
        caminho_video: {
          type: 'string',
          description: 'Caminho absoluto ou relativo do vídeo (.mp4 / .webm) a ser auditado.',
        },
        formato: {
          type: 'string',
          enum: ['9:16', '16:9', '4:5', '1:1'],
          description: 'Proporção do vídeo (padrão: 9:16 vertical).',
        },
        criterios: {
          type: 'string',
          description: 'Critérios específicos de validação ou restrição de Safe-Area.',
        },
      },
      required: ['caminho_video'],
    },
  },
}

export const DEFAULT_PORT = 18431

/**
 * Thinking levels offered in the model picker, as `reasoningEfforts`.
 *
 * DSH reads this map from the route (`llm-pi-ai` schema) and shows a level
 * selector in the composer; the value is the spelling it sends back as
 * `reasoning_effort`. Neither web UI has a numeric thinking budget — Gemini's
 * payload carries a single flag (`1` standard, `2` extended) and DeepSeek's
 * carries the DeepThink toggle — so the ladder is deliberately two rungs.
 */
export const REASONING_EFFORTS = { low: 'low', high: 'high' }

/**
 * Models this bridge always advertises.
 *
 * The Gemini entries here are only the fallback shape; once an account is
 * bound, `catalogueFor()` replaces them with the models Google actually
 * offers that account, name included.
 */
export const MODEL_CATALOGUE = [
  {
    id: 'deepseek-web-chat',
    name: 'DeepSeek Web (Chat)',
    provider: 'deepseek-web',
    contextWindow: 131072,
    maxTokens: 8192,
    thinking: false,
    reasoningEfforts: REASONING_EFFORTS,
  },
  {
    id: 'deepseek-web-think',
    name: 'DeepSeek Web (DeepThink)',
    provider: 'deepseek-web',
    contextWindow: 131072,
    maxTokens: 8192,
    thinking: true,
    reasoningEfforts: REASONING_EFFORTS,
  },
  {
    id: 'gemini-web',
    name: 'Gemini Web (Flash)',
    provider: 'gemini-web',
    contextWindow: 1048576,
    maxTokens: 8192,
    thinking: false,
    reasoningEfforts: REASONING_EFFORTS,
  },
  {
    id: 'gemini-web-think',
    name: 'Gemini Web (Extended Thinking)',
    provider: 'gemini-web',
    contextWindow: 1048576,
    maxTokens: 8192,
    thinking: true,
    reasoningEfforts: REASONING_EFFORTS,
  },
]

/**
 * Build the model list for a given account state.
 *
 * `account.models` holds what the Gemini account reported at bind time
 * (`[{modelId, modelName, displayName}]`), so the picker shows the same names
 * the browser shows — "Gemini 3.8 Flash", "Gemini 4 Argon", and whatever comes
 * next. Older records used `name`; both spellings are accepted.
 */
export function catalogueFor(account) {
  const discovered = (Array.isArray(account?.models) ? account.models : [])
    .map((model) => ({
      modelId: String(model?.modelId ?? ''),
      modelName: String(model?.modelName ?? model?.name ?? ''),
      displayName: String(model?.displayName ?? model?.modelName ?? model?.name ?? ''),
    }))
    .filter((model) => model.modelId !== '')

  if (discovered.length === 0) return MODEL_CATALOGUE

  /** Display name as the browser shows it, with the vendor prefix normalised. */
  const label = (model) =>
    /^gemini\b/i.test(model.displayName) ? model.displayName : `Gemini ${model.displayName}`

  const gemini = discovered.map((model) => ({
    // `argon`, `flash`, `pro` — readable in the picker and in logs; the real
    // selection still travels as `modelId`.
    id: `gemini-web--${slugify(model.modelName).replace(/^gemini-/, '') || model.modelId}`,
    name: label(model),
    provider: 'gemini-web',
    model: model.modelId,
    thinking: false,
    contextWindow: 1048576,
    maxTokens: 8192,
    reasoningEfforts: REASONING_EFFORTS,
  }))
  // Extended thinking used to be a separate model id; it is now the `high`
  // level of every Gemini model, so the picker carries one row per model
  // instead of a duplicate labelled "(Extended Thinking)".
  return [...MODEL_CATALOGUE.filter((model) => model.provider === 'deepseek-web'), ...gemini]
}

/** `Gemini 4 Argon` -> `gemini-4-argon`. */
function slugify(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Resolve a requested model id to a catalogue entry (tolerant of suffixes).
 * @param {string} requested
 * @param {Array<object>} [catalogue]
 */
export function resolveModel(requested, catalogue = MODEL_CATALOGUE) {
  const id = String(requested ?? '').trim()
  const exact = catalogue.find((model) => model.id === id)
  if (exact !== undefined) return exact
  if (id.startsWith('gemini')) {
    const models = catalogue.filter((model) => model.provider === 'gemini-web')
    if (models.length === 0) return catalogue[0]
    // `gemini-web--<slug>` keeps its own entry; a retired `gemini-web-think`
    // id still lands on a real model instead of falling through to DeepSeek.
    const think = id.includes('think')
    return models.find((model) => model.thinking === think) ?? models[0]
  }
  if (id.startsWith('deepseek')) {
    return catalogue.find((model) => model.id === (id.includes('think') || id.includes('r1') ? 'deepseek-web-think' : 'deepseek-web-chat')) ?? catalogue[0]
  }
  return catalogue[0]
}

/** Levels that turn the provider's extended-thinking mode on. */
const EXTENDED_EFFORTS = new Set(['high', 'xhigh', 'max', 'extended', 'think', 'thinking'])

/**
 * Read the thinking level a request asks for.
 *
 * Accepts the three spellings that reach this bridge: the OpenAI
 * `reasoning_effort` string, the newer `reasoning: { effort }` object, and the
 * bare `thinking` boolean some clients send. Returns `undefined` when the
 * request says nothing, so the model's own default applies.
 *
 * @returns {boolean | undefined}
 */
export function extendedThinkingFor(body) {
  const requested = body?.reasoning_effort
    ?? body?.reasoningEffort
    ?? body?.reasoning?.effort
    ?? body?.thinking
  if (typeof requested === 'boolean') return requested
  if (typeof requested !== 'string') return undefined
  const effort = requested.trim().toLowerCase()
  if (effort === '') return undefined
  return EXTENDED_EFFORTS.has(effort)
}

/**
 * Safely parse a JSON string from a <tool_call> block.
 * Supports raw JSON, markdown-wrapped JSON, and handles single objects or arrays.
 *
 * @param {string} raw
 * @returns {Array<{name: string, arguments: string}> | null}
 */
export function parseToolCallJson(raw) {
  let cleaned = String(raw ?? '').trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim()
  }
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

  function tryParse(str) {
    try {
      return JSON.parse(str)
    } catch {
      try {
        // Strip trailing commas before closing braces/brackets
        const relaxed = str.replace(/,\s*([}\]])/g, '$1')
        return JSON.parse(relaxed)
      } catch {
        return null
      }
    }
  }

  let obj = tryParse(cleaned)
  if (!obj) {
    const extracted = extractFirstJsonObject(cleaned, 0)
    if (extracted && extracted.end !== -1) {
      obj = tryParse(extracted.json)
    }
  }

  if (!obj) return null

  try {
    const items = Array.isArray(obj) ? obj : [obj]
    const results = []
    for (const item of items) {
      const inner = item.tool_call ?? item.function ?? item
      const name = inner.name ?? inner.tool
      if (name && typeof name === 'string') {
        let args = inner.arguments ?? inner.args ?? inner.parameters ?? {}
        if (typeof args !== 'string') {
          args = JSON.stringify(args)
        }
        results.push({ name: name.trim(), arguments: args })
      }
    }
    return results.length > 0 ? results : null
  } catch {
    return null
  }
}

/**
 * Extract the boundaries and substring of the first balanced JSON object.
 *
 * @param {string} str
 * @param {number} startIndex
 * @returns {{start: number, end: number, json: string} | null}
 */
export function extractFirstJsonObject(str, startIndex = 0) {
  const openIndex = str.indexOf('{', startIndex)
  if (openIndex === -1) return null

  let depth = 0
  let inString = false
  let isEscaped = false

  for (let i = openIndex; i < str.length; i++) {
    const char = str[i]

    if (isEscaped) {
      isEscaped = false
      continue
    }

    if (char === '\\') {
      isEscaped = true
      continue
    }

    if (char === '"') {
      inString = !inString
      continue
    }

    if (!inString) {
      if (char === '{') {
        depth++
      } else if (char === '}') {
        depth--
        if (depth === 0) {
          return {
            start: openIndex,
            end: i + 1,
            json: str.slice(openIndex, i + 1),
          }
        }
      }
    }
  }

  return {
    start: openIndex,
    end: -1,
    json: str.slice(openIndex),
  }
}

/**
 * Extract all synthetic <tool_call> blocks or raw JSON tool calls from a completion text.
 * Returns the text with tool calls removed (cleanContent) and the parsed tool_calls.
 *
 * @param {string} text
 * @returns {{cleanContent: string, toolCalls: Array<object>}}
 */
export function parseSyntheticToolCalls(text) {
  const toolCalls = []
  const toolCallRegex = /<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/gi
  let match
  let index = 0

  while ((match = toolCallRegex.exec(text)) !== null) {
    const rawJson = match[1].trim()
    const parsedList = parseToolCallJson(rawJson)
    if (parsedList && parsedList.length > 0) {
      for (const parsed of parsedList) {
        toolCalls.push({
          index: index++,
          id: `call_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`,
          type: 'function',
          function: {
            name: parsed.name,
            arguments: parsed.arguments,
          },
        })
      }
    }
  }

  let cleanContent = toolCalls.length > 0
    ? text.replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/gi, '').trim()
    : text

  // Fallback: If no <tool_call> tags were used, check for raw JSON tool calls
  if (toolCalls.length === 0) {
    let searchPos = 0
    while (searchPos < cleanContent.length) {
      const sub = cleanContent.slice(searchPos)
      const rawMatch = sub.match(/(?:```(?:json)?\s*)?\{\s*"(?:name|tool|function|tool_call)"\s*:/i)
      if (!rawMatch) break

      const triggerIndex = searchPos + rawMatch.index
      const obj = extractFirstJsonObject(cleanContent, triggerIndex)
      if (!obj || obj.end === -1) break

      const parsedList = parseToolCallJson(obj.json)
      if (parsedList && parsedList.length > 0) {
        for (const parsed of parsedList) {
          toolCalls.push({
            index: index++,
            id: `call_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`,
            type: 'function',
            function: {
              name: parsed.name,
              arguments: parsed.arguments,
            },
          })
        }
        let cutStart = triggerIndex
        let cutEnd = obj.end
        const after = cleanContent.slice(cutEnd)
        const mdCloseMatch = after.match(/^\s*```/)
        if (mdCloseMatch) {
          cutEnd += mdCloseMatch[0].length
        }
        cleanContent = (cleanContent.slice(0, cutStart) + cleanContent.slice(cutEnd)).trim()
        searchPos = cutStart
      } else {
        searchPos = triggerIndex + 1
      }
    }
  }

  return { cleanContent, toolCalls }
}

/** `chatcmpl-…` style id. */
function completionId() {
  return 'chatcmpl-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

/** Read the request body as JSON, with a size guard. */
async function readJson(req, limitBytes = 32 * 1024 * 1024) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > limitBytes) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf-8')
  if (raw.trim() === '') return {}
  return JSON.parse(raw)
}

/**
 * Build the bridge server.
 *
 * @param {{
 *   getAccount: (provider: string) => Record<string, any> | null,
 *   wasmPath: string,
 *   log?: (message: string) => void,
 * }} options
 */
export function createBridge({ getAccount, wasmPath, dataDir, log = () => {} }) {
  const resolvedDataDir = dataDir || process.env.DSH_WEB_SUB_DATA_DIR || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh', 'dsh-web-sub')
  const middlewareEngine = new MiddlewareEngine(resolvedDataDir)

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors)
      res.end()
      return
    }

    if (url.pathname === '/health') {
      const deepseek = getAccount('deepseek-web')
      const gemini = getAccount('gemini-web')
      res.writeHead(200, { 'content-type': 'application/json', ...cors })
      res.end(JSON.stringify({
        ok: true,
        providers: {
          'deepseek-web': Boolean(deepseek && deepseek.token),
          'gemini-web': Boolean(gemini && gemini.cookie),
        },
      }))
      return
    }

    if (url.pathname === '/v1/models' && req.method === 'GET') {
      const catalogue = catalogueFor(getAccount('gemini-web'))
      res.writeHead(200, { 'content-type': 'application/json', ...cors })
      res.end(JSON.stringify({
        object: 'list',
        data: catalogue.map((model) => ({
          id: model.id,
          object: 'model',
          owned_by: model.provider,
          context_window: model.contextWindow,
        })),
      }))
      return
    }

    if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
      let body
      try {
        body = await readJson(req)
      } catch (error) {
        res.writeHead(400, { 'content-type': 'application/json', ...cors })
        res.end(JSON.stringify({ error: { message: `invalid JSON body: ${error.message}`, type: 'invalid_request_error' } }))
        return
      }

      const catalogue = catalogueFor(getAccount('gemini-web'))
      const model = resolveModel(body.model, catalogue)
      const stream = body.stream !== false
      const created = Math.floor(Date.now() / 1000)
      const id = completionId()
      const rawTools = Array.isArray(body.tools)
        ? body.tools
        : (Array.isArray(body.functions) ? body.functions.map((f) => ({ type: 'function', function: f })) : [])
      const requestedTools = [...rawTools]
      if (process.env.DSH_ENABLE_BUILTIN_TOOLS === 'true' && requestedTools.length > 0 && !requestedTools.some((t) => (t.function?.name || t.name) === 'auditar_video')) {
        requestedTools.push(BUILTIN_AUDIT_TOOL)
      }

      // Extensible middleware hook: allows custom prompt grounding, local routers, or fast-path responses
      const middlewareContext = await middlewareEngine.onRequest({
        model,
        messages: body.messages ?? [],
        tools: requestedTools,
        stream,
        body,
      })

      if (middlewareContext?.handled && middlewareContext.response) {
        res.writeHead(200, { 'content-type': 'application/json', ...cors })
        res.end(JSON.stringify(middlewareContext.response))
        return
      }

      const effectiveMessages = middlewareContext?.messages ?? body.messages ?? []
      const effectiveTools = middlewareContext?.tools ?? requestedTools

      const abort = new AbortController()
      req.on('close', () => abort.abort())

      let deltas
      try {
        deltas = await openStream({
          model,
          messages: effectiveMessages,
          tools: effectiveTools,
          signal: abort.signal,
          getAccount,
          wasmPath,
          requestedExtended: extendedThinkingFor(body),
        })
      } catch (error) {
        const message = error?.message ?? String(error)
        log(`[bridge] ${model.id} failed: ${message}`)
        if (!stream) {
          res.writeHead(200, { 'content-type': 'application/json', ...cors })
          res.end(JSON.stringify({
            error: { message, type: 'upstream_error', code: error?.kind ?? 'unknown' },
            choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'error' }],
          }))
          return
        }
        // A streaming client (DSH among them) reads SSE until `finish_reason`.
        // Answering JSON here is what produced "Stream ended without
        // finish_reason", hiding the real error — so always close the stream.
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
          ...cors,
        })
        res.write(`data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model: model.id,
          choices: [{ index: 0, delta: { role: 'assistant', content: `Error: ${message}` }, finish_reason: null }],
        })}\n\n`)
        res.write(`data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model: model.id,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        })}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }

      if (!stream) {
        let content = ''
        let reasoning = ''
        try {
          for await (const [kind, text] of deltas) {
            if (kind === 'reasoning') reasoning += text
            else content += text
          }
        } catch (error) {
          log(`[bridge] ${model.id} stream failed: ${error.message}`)
          if (content === '' && reasoning === '') content = `Error: ${error.message}`
        }

        const { cleanContent, toolCalls } = parseSyntheticToolCalls(content)
        const hookResult = await middlewareEngine.onResponse({
          model,
          content: cleanContent,
          toolCalls,
          reasoning,
        })

        const finalContent = hookResult?.content !== undefined ? hookResult.content : cleanContent
        const finalToolCalls = hookResult?.toolCalls !== undefined ? hookResult.toolCalls : toolCalls
        const finishReason = finalToolCalls.length > 0 ? 'tool_calls' : 'stop'
        const message = { role: 'assistant', content: finalContent || (finalToolCalls.length > 0 ? null : '') }
        if (reasoning !== '') message.reasoning_content = reasoning
        if (finalToolCalls.length > 0) message.tool_calls = finalToolCalls

        res.writeHead(200, { 'content-type': 'application/json', ...cors })
        res.end(JSON.stringify({
          id,
          object: 'chat.completion',
          created,
          model: model.id,
          choices: [{ index: 0, message, finish_reason: finishReason }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }))
        return
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
        ...cors,
      })

      const send = (payload) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`)
      }

      const chunk = (delta, finishReason = null) => send({
        id,
        object: 'chat.completion.chunk',
        created,
        model: model.id,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })

      chunk({ role: 'assistant', content: '' })
      let produced = false
      let toolBuffer = ''
      let inToolCall = false
      let inRawJsonCall = false
      let streamedToolCalls = 0

      const emitToolCalls = (parsedCalls) => {
        for (const call of parsedCalls) {
          chunk({
            tool_calls: [
              {
                index: streamedToolCalls++,
                id: `call_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`,
                type: 'function',
                function: {
                  name: call.name,
                  arguments: call.arguments,
                },
              },
            ],
          })
        }
      }

      // Keep-alive heartbeat: send ping comment and empty delta every 2500ms
      // so DSH / fetch / proxies never hit idle timeout while the model is reasoning.
      const heartbeat = setInterval(() => {
        if (!res.writableEnded && !abort.signal.aborted) {
          try {
            res.write(': keep-alive\n\n')
            chunk({})
          } catch {
            /* ignore write errors */
          }
        }
      }, 2500)

      try {
        for await (const [kind, text] of deltas) {
          if (abort.signal.aborted || streamedToolCalls > 0) break
          produced = true
          if (kind === 'reasoning') {
            chunk({ reasoning_content: text })
            continue
          }

          toolBuffer += text

          while (toolBuffer.length > 0) {
            if (inToolCall) {
              const endIndex = toolBuffer.indexOf('</tool_call>')
              if (endIndex === -1) {
                break
              }
              const jsonStr = toolBuffer.slice(0, endIndex)
              toolBuffer = toolBuffer.slice(endIndex + '</tool_call>'.length)
              inToolCall = false

              const parsedCalls = parseToolCallJson(jsonStr)
              if (parsedCalls && parsedCalls.length > 0) {
                emitToolCalls(parsedCalls)
                abort.abort()
                break
              } else {
                chunk({ content: `<tool_call>${jsonStr}</tool_call>` })
              }
              continue
            }

            if (inRawJsonCall) {
              const obj = extractFirstJsonObject(toolBuffer, 0)
              if (!obj || obj.end === -1) {
                break
              }
              const jsonStr = obj.json
              let endPos = obj.end
              const post = toolBuffer.slice(endPos)
              const mdCloseMatch = post.match(/^\s*```/)
              if (mdCloseMatch) {
                endPos += mdCloseMatch[0].length
              }
              toolBuffer = toolBuffer.slice(endPos)
              inRawJsonCall = false

              const parsedCalls = parseToolCallJson(jsonStr)
              if (parsedCalls && parsedCalls.length > 0) {
                emitToolCalls(parsedCalls)
                abort.abort()
                break
              } else {
                chunk({ content: jsonStr })
              }
              continue
            }

            const startIndex = toolBuffer.indexOf('<tool_call>')
            if (startIndex !== -1) {
              const preText = toolBuffer.slice(0, startIndex)
              if (preText.length > 0) {
                chunk({ content: preText })
              }
              toolBuffer = toolBuffer.slice(startIndex + '<tool_call>'.length)
              inToolCall = true
              continue
            }

            const rawMatch = toolBuffer.match(/(?:```(?:json)?\s*)?\{\s*"(?:name|tool|function|tool_call)"\s*:/i)
            if (rawMatch) {
              const rawIndex = rawMatch.index
              const preText = toolBuffer.slice(0, rawIndex)
              if (preText.length > 0) {
                chunk({ content: preText })
              }
              toolBuffer = toolBuffer.slice(rawIndex)
              const mdOpenMatch = toolBuffer.match(/^```(?:json)?\s*/i)
              if (mdOpenMatch) {
                toolBuffer = toolBuffer.slice(mdOpenMatch[0].length)
              }
              inRawJsonCall = true
              continue
            }

            const partialMatch = toolBuffer.match(/<t(?:o(?:o(?:l(?:_(?:c(?:a(?:l(?:l>?)?)?)?)?)?)?)?)?$/i)
            const partialRaw = toolBuffer.match(/(?:```(?:json)?\s*)?\{(?:\s*"(?:n(?:a(?:m(?:e"?)?)?)?)?)?$/i)
            const partialMd = toolBuffer.match(/`{1,3}(?:json)?\s*$/i)
            const partial = partialMatch || partialRaw || partialMd

            if (partial) {
              const safeText = toolBuffer.slice(0, partial.index)
              if (safeText.length > 0) {
                chunk({ content: safeText })
              }
              toolBuffer = toolBuffer.slice(partial.index)
              break
            } else {
              chunk({ content: toolBuffer })
              toolBuffer = ''
              break
            }
          }
        }
      } catch (error) {
        clearInterval(heartbeat)
        if (!abort.signal.aborted) {
          log(`[bridge] ${model.id} stream error: ${error.message}`)
          chunk({ content: produced ? `\n\n[stream error: ${error.message}]` : `Error: ${error.message}` })
        }
      }

      clearInterval(heartbeat)

      if (!abort.signal.aborted && toolBuffer.length > 0) {
        if (inToolCall) {
          const parsedCalls = parseToolCallJson(toolBuffer)
          if (parsedCalls && parsedCalls.length > 0) {
            emitToolCalls(parsedCalls)
            abort.abort()
          } else {
            chunk({ content: `<tool_call>${toolBuffer}` })
          }
        } else if (inRawJsonCall) {
          const parsedCalls = parseToolCallJson(toolBuffer)
          if (parsedCalls && parsedCalls.length > 0) {
            emitToolCalls(parsedCalls)
            abort.abort()
          } else {
            chunk({ content: toolBuffer })
          }
        } else {
          const parsedCalls = parseToolCallJson(toolBuffer)
          if (parsedCalls && parsedCalls.length > 0) {
            emitToolCalls(parsedCalls)
            abort.abort()
          } else {
            chunk({ content: toolBuffer })
          }
        }
      }

      const finishReason = streamedToolCalls > 0 ? 'tool_calls' : 'stop'
      chunk({}, finishReason)
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }

    res.writeHead(404, { 'content-type': 'application/json', ...cors })
    res.end(JSON.stringify({ error: { message: 'not found' } }))
  })

  return server
}

/**
 * Live Gemini clients, keyed by cookie.
 *
 * Each client carries the scraped `at` token and a rotated `__Secure-1PSIDTS`,
 * so reusing it removes a full page load + model discovery from every message.
 * A client whose session dies is evicted and rebuilt on the next request.
 */
const geminiClients = new Map()

function geminiClientFor(cookie) {
  const cached = geminiClients.get(cookie)
  if (cached !== undefined) return cached
  if (geminiClients.size > 4) {
    // One account in practice; the cap only guards against unbounded growth
    // after a few re-logins with a fresh cookie each time.
    const [oldest] = geminiClients.keys()
    geminiClients.delete(oldest)
  }
  const client = new GeminiWebClient({ cookie })
  geminiClients.set(cookie, client)
  return client
}

/** Drop a cached client so the next request performs a clean handshake. */
function forgetGeminiClient(cookie) {
  geminiClients.delete(cookie)
}

/**
 * Start the right adapter and return an async iterator of deltas.
 * @returns {Promise<AsyncGenerator<[string, string], void, unknown>>}
 */
async function openStream({ model, messages, tools, signal, getAccount, wasmPath, requestedExtended }) {
  let account = getAccount(model.provider)
  // The request's level wins; the model's own default only fills the gap.
  const extendedThinking = requestedExtended ?? model.thinking === true

  if (model.provider === 'deepseek-web') {
    if (account === null || typeof account?.token !== 'string' || account.token === '') {
      throw new Error('DeepSeek is not connected. Open the plugin panel and log in, or paste your token.')
    }

    const createClient = (acc) => new DeepSeekWebClient({
      token: acc.token,
      cookie: typeof acc.cookie === 'string' ? acc.cookie : '',
      wasmPath,
    })

    try {
      const client = createClient(account)
      const sessionId = await client.createSession()
      return client.streamMessage(sessionId, deepseekPrompt(messages, tools), {
        thinking: extendedThinking,
        signal,
      })
    } catch (error) {
      if (error?.kind === 'auth' || error?.status === 401 || error?.status === 403) {
        try {
          const fresh = await captureFromFirefox('deepseek-web')
          if (fresh?.token) {
            setAccount('deepseek-web', { ...account, ...fresh })
            account = fresh
            const client = createClient(account)
            const sessionId = await client.createSession()
            return client.streamMessage(sessionId, deepseekPrompt(messages, tools), {
              thinking: extendedThinking,
              signal,
            })
          }
        } catch {
          /* ignore and rethrow original error */
        }
      }
      throw error
    }
  }

  if (model.provider === 'gemini-web') {
    if (account === null || typeof account?.cookie !== 'string' || account.cookie === '') {
      throw new Error('Gemini is not connected. Open the plugin panel and log in, or paste your cookie header.')
    }

    const refreshSessionFromFirefox = async () => {
      try {
        const fresh = await captureFromFirefox('gemini-web')
        if (fresh?.cookie) {
          const updated = setAccount('gemini-web', { ...account, ...fresh })
          account = updated
          return fresh.cookie
        }
      } catch {
        /* Firefox not installed or not logged in */
      }
      return null
    }

    let client = geminiClientFor(account.cookie)
    try {
      if (client.accessToken === undefined) {
        const initRes = await client.init()
        if (initRes?.cookie && initRes.cookie !== account.cookie) {
          setAccount('gemini-web', { ...account, cookie: initRes.cookie })
        }
      }
    } catch (error) {
      forgetGeminiClient(account.cookie)
      if (error?.kind !== 'auth') throw error
      // An expired session deserves auto-capture from Firefox before falling back
      const freshCookie = await refreshSessionFromFirefox()
      const cookieToUse = freshCookie || account.cookie
      const rebuilt = geminiClientFor(cookieToUse)
      const initRes = await rebuilt.init()
      if (initRes?.cookie && initRes.cookie !== account.cookie) {
        setAccount('gemini-web', { ...account, cookie: initRes.cookie })
      }
      client = rebuilt
    }

    const promptText = geminiPrompt(messages, tools)
    const streamOpts = {
      model: model.model,
      extendedThinking,
      signal,
    }

    async function* streamWithAutoRecovery() {
      try {
        yield* client.streamMessage(promptText, streamOpts)
      } catch (error) {
        const isRecoverable = error?.kind === 'auth'
          || error?.kind === 'protocol'
          || error?.status === 401
          || error?.status === 403
          || /auth|login|expired|snlm0e|no answer|no text|shape|protocol|abort/i.test(error?.message ?? '')

        if (isRecoverable) {
          log(`[bridge] Gemini auto-recovery triggered: ${error.message}`)
          forgetGeminiClient(account.cookie)
          const freshCookie = await refreshSessionFromFirefox()
          if (freshCookie) {
            const rebuilt = geminiClientFor(freshCookie)
            const initRes = await rebuilt.init()
            if (initRes?.cookie && initRes.cookie !== account.cookie) {
              setAccount('gemini-web', { ...account, cookie: initRes.cookie })
            }
            yield* rebuilt.streamMessage(promptText, streamOpts)
            return
          }
        }
        throw error
      }
    }

    return streamWithAutoRecovery()
  }

  throw new Error(`unknown provider for model ${model.id}`)
}

/**
 * Listen on 127.0.0.1, falling forward through ports if one is taken.
 * @returns {Promise<{server: import('node:http').Server, port: number, close: () => Promise<void>}>}
 */
export async function startBridge({ preferredPort = DEFAULT_PORT, ...options }) {
  for (let offset = 0; offset < 20; offset += 1) {
    const port = preferredPort + offset
    const server = createBridge(options)
    const ok = await new Promise((resolve) => {
      const onError = (error) => {
        server.removeListener('listening', onListening)
        if (error.code === 'EADDRINUSE') resolve(false)
        else resolve({ error })
      }
      const onListening = () => {
        server.removeListener('error', onError)
        resolve(true)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '127.0.0.1')
    })
    if (ok === true) {
      return {
        server,
        port,
        close: () => new Promise((resolve) => server.close(() => resolve())),
      }
    }
    if (ok !== false) throw ok.error
  }
  throw new Error(`could not bind any port in the ${preferredPort}..${preferredPort + 19} range`)
}
