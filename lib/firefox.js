/**
 * Read a session from a Firefox profile directory.
 *
 * Firefox stores cookies in `cookies.sqlite` and localStorage in
 * `storage/default/<origin>/ls/data.sqlite`. Both are SQLite databases that
 * can be read with Node's built-in `node:sqlite` (no native addon needed).
 *
 * This is a read-only copy of the files — the profile stays untouched.
 *
 * @module dsh-web-sub/firefox
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { SITES, cookieHeaderFrom } from './sites.js'

/** Copy a profile file to a temp location so we can read it while Firefox is running. */
export function copyToTemp(source) {
  const tmp = mkdtempSync(join(tmpdir(), 'ff-'))
  const dest = join(tmp, 'copy.sqlite')
  copyFileSync(source, dest)
  return dest
}

/** Find the default Firefox profile directory. */
export function findDefaultProfile() {
  const appData = process.env.APPDATA
  if (!appData) return null
  const ini = join(appData, 'Mozilla', 'Firefox', 'profiles.ini')
  if (!existsSync(ini)) return null
  const lines = readFileSync(ini, 'utf8').split('\n')
  let current = {}
  const profiles = []
  const installs = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[')) {
      if (current.Path !== undefined || current.Default !== undefined || current.Locked !== undefined) {
        if (current.section?.startsWith('Install')) {
          installs.push({ ...current })
        } else {
          profiles.push({ ...current })
        }
      }
      current = { section: trimmed.slice(1, -1) }
    } else if (trimmed.includes('=')) {
      const [key, value] = trimmed.split('=', 2)
      current[key.trim()] = value.trim()
    }
  }
  if (current.Path !== undefined || current.Default !== undefined || current.Locked !== undefined) {
    if (current.section?.startsWith('Install')) {
      installs.push({ ...current })
    } else {
      profiles.push({ ...current })
    }
  }

  // First check the Install section for the locked default
  for (const install of installs) {
    if (install.Default && install.Locked === '1') {
      const path = install.Default
      return join(appData, 'Mozilla', 'Firefox', path.startsWith('Profiles/') ? path : 'Profiles/' + path)
    }
  }

  // Then check profiles for Default=1
  for (const profile of profiles) {
    if (profile.Default === '1' && profile.Path) {
      return join(appData, 'Mozilla', 'Firefox', profile.IsRelative === '1' ? profile.Path : profile.Path)
    }
  }

  // Fallback to the first profile with a path
  for (const profile of profiles) {
    if (profile.Path) {
      return join(appData, 'Mozilla', 'Firefox', profile.IsRelative === '1' ? profile.Path : profile.Path)
    }
  }

  return null
}

/** Read all cookies from a Firefox cookies.sqlite for the given hosts. */
export function readFirefoxCookies(profileDir, hosts) {
  const cookieDb = join(profileDir, 'cookies.sqlite')
  if (!existsSync(cookieDb)) return []
  const copy = copyToTemp(cookieDb)
  const db = new DatabaseSync(copy, { readOnly: true })
  const placeholders = hosts.map(() => 'host LIKE ?').join(' OR ')
  const params = hosts.map((h) => `%${h}%`)
  const rows = db.prepare(`select host, name, value, expiry, isSecure, sameSite from moz_cookies where ${placeholders}`).all(...params)
  db.close()
  return rows
}

/** Read a localStorage key from Firefox's storage/default/<origin>/ls/data.sqlite. */
export function readFirefoxLocalStorage(profileDir, origin, key) {
  const lsDb = join(profileDir, 'storage', 'default', origin, 'ls', 'data.sqlite')
  if (!existsSync(lsDb)) return null
  const copy = copyToTemp(lsDb)
  const db = new DatabaseSync(copy, { readOnly: true })
  const row = db.prepare('select value from data where key = ?').get(key)
  db.close()
  if (row?.value === undefined) return null
  // Firefox stores localStorage as BLOB (Uint8Array); convert to string.
  const buf = row.value instanceof Uint8Array ? row.value : Buffer.from(row.value)
  return buf.toString('utf8')
}

/**
 * Capture a session from the Firefox profile.
 * @param {'deepseek-web'|'gemini-web'} provider
 * @returns {Promise<{cookie?: string, token?: string, source: string, label: string} | null>}
 */
export async function captureFromFirefox(provider) {
  const site = SITES[provider]
  if (!site) return null

  const profileDir = findDefaultProfile()
  if (!profileDir) return null

  // Cookies
  const cookies = readFirefoxCookies(profileDir, site.cookieHosts)
  const cookieHeader = cookieHeaderFrom(cookies, { hosts: site.cookieHosts, keep: site.cookieKeep })
  if (site.requiredCookie && !cookieHeader.includes(`${site.requiredCookie}=`)) {
    return null
  }

  // Token (DeepSeek)
  let token = null
  if (site.tokenKey && site.tokenHost) {
    const origin = `https+++${site.tokenHost}`
    const raw = readFirefoxLocalStorage(profileDir, origin, site.tokenKey)
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw)
        token = parsed.value ?? parsed.token ?? (typeof parsed === 'string' ? parsed : null)
      } catch {
        token = raw
      }
    }
  }

  return {
    cookie: cookieHeader,
    token,
    source: 'firefox-profile',
    label: 'Firefox default profile',
  }
}