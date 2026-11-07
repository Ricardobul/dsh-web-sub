/**
 * middleware.js — Extensible Hooks and Middleware Engine for dsh-web-sub.
 *
 * Allows users and developers to attach custom request/response interceptors,
 * local routers (such as ONNX classifiers, small language models, Ollama, LangChain),
 * or custom prompt grounding without modifying the core open-source package.
 *
 * Discovery order:
 * 1. File path in `DSH_WEB_SUB_MIDDLEWARE` environment variable.
 * 2. `middleware.mjs` or `middleware.js` in the dsh-web-sub data directory (~/.dsh/dsh-web-sub/).
 *
 * @module dsh-web-sub/middleware
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export class MiddlewareEngine {
  /**
   * @param {string} [dataDir] Optional directory where custom middleware is located.
   */
  constructor(dataDir = '') {
    this.dataDir = dataDir
    this.middleware = null
    this.initialized = false
  }

  /**
   * Lazily loads custom user middleware if present.
   */
  async init() {
    if (this.initialized) return
    this.initialized = true

    const customEnv = process.env.DSH_WEB_SUB_MIDDLEWARE
    const candidatePaths = customEnv
      ? [customEnv]
      : this.dataDir
        ? [join(this.dataDir, 'middleware.mjs'), join(this.dataDir, 'middleware.js')]
        : []

    for (const p of candidatePaths) {
      if (existsSync(p)) {
        try {
          const mod = await import(pathToFileURL(p).href)
          this.middleware = mod
          console.log(`[bridge] Loaded custom middleware from ${p}`)
          break
        } catch (err) {
          console.error(`[bridge] Failed to load custom middleware from ${p}:`, err)
        }
      }
    }
  }

  /**
   * Hook executed before sending a request to the upstream web provider.
   *
   * @param {object} context
   * @param {object} context.model Resolved model catalogue entry
   * @param {Array<object>} context.messages Input conversation messages
   * @param {Array<object>} context.tools Input tool definitions
   * @param {boolean} context.stream Whether the request asks for streaming
   * @param {object} context.body Raw request body
   * @returns {Promise<object>} Modified context or fast-path response { handled: true, response: ... }
   */
  async onRequest(context) {
    await this.init()
    if (typeof this.middleware?.onRequest === 'function') {
      try {
        const result = await this.middleware.onRequest(context)
        if (result && typeof result === 'object') {
          return result
        }
      } catch (err) {
        console.error('[bridge] middleware.onRequest error:', err)
      }
    }
    return context
  }

  /**
   * Hook executed after a completion or tool call is produced.
   *
   * @param {object} context
   * @param {object} context.model
   * @param {string} context.content
   * @param {Array<object>} context.toolCalls
   * @param {string} [context.reasoning]
   * @returns {Promise<object>}
   */
  async onResponse(context) {
    await this.init()
    if (typeof this.middleware?.onResponse === 'function') {
      try {
        const result = await this.middleware.onResponse(context)
        if (result && typeof result === 'object') {
          return result
        }
      } catch (err) {
        console.error('[bridge] middleware.onResponse error:', err)
      }
    }
    return context
  }
}
