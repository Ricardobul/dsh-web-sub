/**
 * DeepSeek web PoW (proof-of-work) solver — pure Node.
 *
 * Instantiates DeepSeek's official `sha3_wasm_bg.wasm` through Node's built-in
 * WebAssembly, so no wasmtime / Python / native module is required.
 *
 * Flow:
 *   1. POST /api/v0/chat/create_pow_challenge -> challenge object
 *   2. brute-force the answer with the WASM
 *   3. assemble {algorithm, challenge, salt, answer, signature, target_path} and base64 it
 *
 * Contract notes (learned the hard way):
 *   - the prefix MUST be `salt + "_" + expire_at + "_"` — the trailing underscore
 *     is mandatory or the hash space is wrong;
 *   - `wasm_solve` writes into retptr: +0 is an i32 status, +8 is an f64 answer.
 *     status 0 means "no solution" (usually an expired challenge), non-zero means success.
 *
 * @module dsh-web-sub/pow
 */
import { readFileSync, existsSync } from 'node:fs'

/** Official WASM file name (DeepSeekHashV1). */
export const WASM_FILE_NAME = 'sha3_wasm_bg.wasm'

/** PoW solving failed (expired challenge or broken WASM). */
export class PowError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'PowError'
  }
}

/**
 * A loaded WASM solver instance.
 *
 * The module has no imports, so it instantiates with an empty import object.
 * Its memory can grow, therefore `memory.buffer` must be re-read on every access.
 */
export class PowSolver {
  #memory
  #solve
  #malloc
  #stack

  /**
   * @param {string} wasmPath - absolute path of `sha3_wasm_bg.wasm`.
   *   Falls back to `<wasmPath>.b64` (base64 text) when the binary is missing.
   */
  constructor(wasmPath) {
    let bytes
    try {
      bytes = readFileSync(wasmPath)
    } catch {
      try {
        const text = readFileSync(`${wasmPath}.b64`, 'utf8')
        bytes = Buffer.from(text.replace(/\s+/g, ''), 'base64')
      } catch (error) {
        throw new PowError(`cannot read PoW WASM: ${wasmPath} (${error.message})`, { cause: error })
      }
    }
    let exports
    try {
      const module = new WebAssembly.Module(bytes)
      exports = new WebAssembly.Instance(module, {}).exports
    } catch (error) {
      throw new PowError(`PoW WASM failed to instantiate: ${error.message}`, { cause: error })
    }
    for (const key of ['memory', 'wasm_solve', '__wbindgen_export_0', '__wbindgen_add_to_stack_pointer']) {
      if (exports[key] === undefined) {
        throw new PowError(`PoW WASM is missing export ${key}; the file is probably not the official build`, {})
      }
    }
    this.#memory = exports.memory
    this.#solve = exports.wasm_solve
    this.#malloc = exports.__wbindgen_export_0
    this.#stack = exports.__wbindgen_add_to_stack_pointer
  }

  /** Write a UTF-8 string into WASM linear memory; returns [pointer, byteLength]. */
  #write(text) {
    const data = Buffer.from(text, 'utf8')
    const ptr = this.#malloc(data.length, 1)
    // malloc may trigger memory growth, so the buffer must be fetched again.
    new Uint8Array(this.#memory.buffer).set(data, ptr)
    return [ptr, data.length]
  }

  /**
   * Solve one challenge.
   * @returns {number|null} integer answer; null means "no solution" (expired challenge).
   */
  solve(challenge, prefix, difficulty) {
    const retptr = this.#stack(-16)
    try {
      const [challengePtr, challengeLen] = this.#write(challenge)
      const [prefixPtr, prefixLen] = this.#write(prefix)
      this.#solve(retptr, challengePtr, challengeLen, prefixPtr, prefixLen, difficulty)
      const view = new DataView(this.#memory.buffer)
      const status = view.getInt32(retptr, true)
      if (status === 0) return null
      return Math.trunc(view.getFloat64(retptr + 8, true))
    } finally {
      this.#stack(16)
    }
  }

  /**
   * Turn a challenge object into the base64 value for the `x-ds-pow-response` header.
   * @param {Record<string, unknown>} challenge
   * @returns {string}
   */
  makeHeader(challenge) {
    const prefix = `${challenge.salt}_${challenge.expire_at}_`
    const answer = this.solve(challenge.challenge, prefix, challenge.difficulty)
    if (answer === null) {
      throw new PowError('PoW produced no answer (the challenge probably expired)')
    }
    const payload = {
      algorithm: challenge.algorithm,
      challenge: challenge.challenge,
      salt: challenge.salt,
      answer,
      signature: challenge.signature,
      target_path: challenge.target_path,
    }
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  }
}

/** Cache solvers by wasm path: compile once, reuse forever. */
const cache = new Map()

/**
 * Get (and cache) a solver instance for a wasm path.
 * @param {string} wasmPath
 * @returns {PowSolver}
 */
export function getSolver(wasmPath) {
  if (!existsSync(wasmPath) && !existsSync(`${wasmPath}.b64`)) {
    throw new PowError(`PoW WASM not found at ${wasmPath}`, {})
  }
  let solver = cache.get(wasmPath)
  if (solver === undefined) {
    solver = new PowSolver(wasmPath)
    cache.set(wasmPath, solver)
  }
  return solver
}
