/**
 * On-disk account store for dsh-web-sub.
 *
 * Everything lives under `~/.dsh/dsh-web-sub/` with `0700` on the directory and
 * `0600` on every file, because these records are live session secrets.
 *
 * @module dsh-web-sub/store
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const DATA_DIR = process.env.DSH_WEB_SUB_DATA_DIR || join(homedir(), '.dsh', 'dsh-web-sub')
export const ACCOUNTS_FILE = process.env.DSH_WEB_SUB_ACCOUNTS_FILE || join(DATA_DIR, 'accounts.json')
export const BIND_FILE = process.env.DSH_WEB_SUB_BIND_FILE || join(DATA_DIR, 'bind.json')

/** Atomic write with restrictive permissions. */
function writeSecretFile(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, filePath)
  chmodSync(filePath, 0o600)
}

/** Read a JSON secret file, returning `fallback` on any problem. */
function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return fallback
  }
}

/** All bound accounts, keyed by provider id. */
export function readAccounts(filePath = ACCOUNTS_FILE) {
  const data = readJsonFile(filePath, {})
  const accounts = data && typeof data === 'object' && data.accounts && typeof data.accounts === 'object' ? data.accounts : {}
  return accounts
}

/** Persist the accounts map. */
export function writeAccounts(accounts, filePath = ACCOUNTS_FILE) {
  writeSecretFile(filePath, { version: 2, accounts, updatedAt: new Date().toISOString() })
}

/**
 * Save one provider's credentials.
 * @param {string} provider
 * @param {Record<string, unknown>} record
 */
export function setAccount(provider, record, filePath = ACCOUNTS_FILE) {
  const accounts = readAccounts(filePath)
  accounts[provider] = { ...record, updatedAt: new Date().toISOString() }
  writeAccounts(accounts, filePath)
  return accounts[provider]
}

/** Remove one provider's credentials. */
export function removeAccount(provider, filePath = ACCOUNTS_FILE) {
  const accounts = readAccounts(filePath)
  if (!Object.hasOwn(accounts, provider)) return false
  delete accounts[provider]
  writeAccounts(accounts, filePath)
  return true
}

/**
 * Masked view of an account, safe to send to the settings UI.
 * Secrets never leave the host in clear text.
 */
export function maskAccount(record) {
  if (record === null || record === undefined) return null
  const mask = (value) => {
    if (typeof value !== 'string' || value === '') return null
    return value.length <= 12 ? '****' : `${value.slice(0, 4)}…${value.slice(-4)}`
  }
  let safeSource = record.source ?? 'browser-session'
  if (typeof safeSource === 'string' && (safeSource.includes('firefox') || safeSource.includes('chromium'))) {
    safeSource = 'browser-session'
  }
  return {
    provider: record.provider ?? null,
    label: record.label ?? null,
    source: safeSource,
    updatedAt: record.updatedAt ?? null,
    tokenPreview: mask(record.token),
    cookiePreview: mask(record.cookie),
    hasToken: typeof record.token === 'string' && record.token !== '',
    hasCookie: typeof record.cookie === 'string' && record.cookie !== '',
    models: Array.isArray(record.models) ? record.models.map((model) => model.displayName || model.modelName || model.modelId) : [],
  }
}

/** Binding flag (kept for compatibility with the previous release). */
export function readBindFlag(filePath = BIND_FILE) {
  const data = readJsonFile(filePath, null)
  if (data === null || typeof data !== 'object') return { ok: false, bound: false }
  return { ok: true, bound: data.bound === true, boundAt: data.boundAt ?? null }
}

/** Write the binding flag. */
export function writeBindFlag(data, filePath = BIND_FILE) {
  const payload = { bound: true, boundAt: new Date().toISOString(), ...data }
  writeSecretFile(filePath, payload)
  return payload
}

/** Drop the binding flag. */
export function clearBindFlag(filePath = BIND_FILE) {
  try {
    unlinkSync(filePath)
  } catch {
    /* already gone */
  }
}

/** True when at least one provider is bound. */
export function anyBound(filePath = ACCOUNTS_FILE) {
  return Object.keys(readAccounts(filePath)).length > 0
}

export { existsSync }
