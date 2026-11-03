/**
 * Which browser to drive, starting with the one Windows considers the default.
 *
 * Two things matter here: the plugin should open the browser the user actually
 * uses, and it needs a browser it can talk to. The DevTools Protocol exists
 * only in Chromium-family browsers (Edge, Chrome, Brave, Vivaldi, Opera), so a
 * Firefox default takes a different path — see `firefox.js`, which reads the
 * session straight from the profile instead of driving the browser.
 *
 * @module dsh-web-sub/browser
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

/** Programs registered as `http(s)` handlers, mapped to a browser family. */
const PROGID_PREFIXES = [
  ['MSEdge', 'edge'],
  ['AppXq0fevzme2pys62n3e0fbqa7peapykr8v', 'edge'],
  ['Chrome', 'chrome'],
  ['Brave', 'brave'],
  ['Vivaldi', 'vivaldi'],
  ['Opera', 'opera'],
  ['Chromium', 'chromium'],
  ['Firefox', 'firefox'],
  ['Safari', 'safari'],
  ['IE.HTTP', 'ie'],
]

/** Families the DevTools Protocol can drive. */
export const CHROMIUM_KINDS = new Set(['edge', 'chrome', 'brave', 'vivaldi', 'opera', 'chromium'])

/**
 * Map a registry ProgId to a browser family.
 * @param {string} progId e.g. `MSEdgeHTM`, `ChromeHTML`, `FirefoxURL-308046B0AF4A39CB`
 * @returns {string} family name, or `'unknown'`
 */
export function kindFromProgId(progId) {
  const value = String(progId ?? '').trim()
  if (value === '') return 'unknown'
  for (const [prefix, kind] of PROGID_PREFIXES) {
    if (value.toLowerCase().startsWith(prefix.toLowerCase())) return kind
  }
  return 'unknown'
}

const PROGRAM_FILES = process.env['ProgramFiles'] || 'C:\\Program Files'
const PROGRAM_FILES_X86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
const LOCAL_APP_DATA = process.env['LOCALAPPDATA'] || ''

/** Where each family usually installs its executable, in probe order. */
const EXE_CANDIDATES = {
  edge: [
    `${PROGRAM_FILES_X86}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${PROGRAM_FILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ],
  chrome: [
    `${PROGRAM_FILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${PROGRAM_FILES_X86}\\Google\\Chrome\\Application\\chrome.exe`,
    `${LOCAL_APP_DATA}\\Google\\Chrome\\Application\\chrome.exe`,
  ],
  brave: [
    `${PROGRAM_FILES}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    `${LOCAL_APP_DATA}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
  ],
  vivaldi: [
    `${PROGRAM_FILES}\\Vivaldi\\Application\\vivaldi.exe`,
    `${LOCAL_APP_DATA}\\Vivaldi\\Application\\vivaldi.exe`,
  ],
  chromium: [
    `${LOCAL_APP_DATA}\\Chromium\\Application\\chrome.exe`,
    `${PROGRAM_FILES}\\Chromium\\Application\\chrome.exe`,
  ],
  opera: [
    `${LOCAL_APP_DATA}\\Programs\\Opera\\opera.exe`,
    `${PROGRAM_FILES}\\Opera\\opera.exe`,
  ],
  firefox: [
    `${PROGRAM_FILES}\\Mozilla Firefox\\firefox.exe`,
    `${PROGRAM_FILES_X86}\\Mozilla Firefox\\firefox.exe`,
  ],
}

/** Read a single registry value; `null` when the key or value is missing. */
function regQuery(key, value) {
  if (process.platform !== 'win32') return null
  try {
    const output = execFileSync('reg', ['query', key, '/v', value], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const match = new RegExp(`${value}\\s+REG_\\w+\\s+(.+)`).exec(output)
    return match === null ? null : match[1].trim()
  } catch {
    return null
  }
}

/** Resolve an executable for a family, trusting the registry first. */
function exeFor(kind) {
  const exeNames = { edge: 'msedge.exe', chrome: 'chrome.exe', brave: 'brave.exe', vivaldi: 'vivaldi.exe', chromium: 'chrome.exe', opera: 'opera.exe', firefox: 'firefox.exe' }
  const exe = exeNames[kind]
  if (exe !== undefined) {
    for (const hive of ['HKCU', 'HKLM']) {
      const registered = regQuery(`${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`, '')
      const path = registered === null ? null : registered.replace(/^"|"$/g, '')
      if (path !== null && existsSync(path)) return path
    }
  }
  for (const path of EXE_CANDIDATES[kind] ?? []) {
    if (existsSync(path)) return path
  }
  return null
}

/**
 * The browser Windows opens links with, plus whether it can be driven.
 *
 * @returns {{progId: string, kind: string, path: string|null, chromium: boolean} | null}
 */
export function defaultBrowser() {
  const progId = regQuery('HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', 'ProgId')
    ?? regQuery('HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice', 'ProgId')
  if (progId === null) return null
  const kind = kindFromProgId(progId)
  return { progId, kind, path: exeFor(kind), chromium: CHROMIUM_KINDS.has(kind) }
}

/**
 * Pick a Chromium browser to drive.
 *
 * Order: `DSH_WEB_SUB_BROWSER` (explicit override) → the system default when it
 * is Chromium → any installed Chromium. Returns `null` when none exists, which
 * callers turn into "paste the credential instead".
 *
 * @returns {{path: string, kind: string, isDefault: boolean} | null}
 */
export function findChromiumBrowser() {
  const override = process.env.DSH_WEB_SUB_BROWSER
  if (override !== undefined && override !== '' && existsSync(override)) {
    return { path: override, kind: 'custom', isDefault: false }
  }

  const preferred = defaultBrowser()
  if (preferred !== null && preferred.chromium && preferred.path !== null) {
    return { path: preferred.path, kind: preferred.kind, isDefault: true }
  }

  for (const kind of ['edge', 'chrome', 'brave', 'vivaldi', 'chromium', 'opera']) {
    const path = exeFor(kind)
    if (path !== null) return { path, kind, isDefault: false }
  }
  return null
}

/**
 * One line describing the browser situation, for `status` and the panel.
 * @returns {string}
 */
export function describeBrowserChoice() {
  const preferred = defaultBrowser()
  const chromium = findChromiumBrowser()
  if (preferred === null) {
    return chromium === null ? 'no browser found' : `${chromium.kind} (default unknown)`
  }
  if (preferred.chromium) {
    return `${preferred.kind} (system default, DevTools capture)`
  }
  if (chromium === null) {
    return `${preferred.kind} (system default, profile capture)`
  }
  return `${preferred.kind} (system default, profile capture) — ${chromium.kind} available as fallback`
}
