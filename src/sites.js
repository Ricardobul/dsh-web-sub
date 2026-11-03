/**
 * What each site is and how its session is read.
 *
 * Two engines capture a session: the DevTools Protocol (any Chromium browser)
 * and Firefox's own profile files. Both need the same handful of facts — the
 * URL to open, the hosts a tab may be on, which cookies survive, and whether
 * the provider keeps its token in `localStorage` — so those live here instead
 * of being duplicated per engine.
 *
 * @module dsh-web-sub/sites
 */

export const SITES = {
  'deepseek-web': {
    host: 'chat.deepseek.com',
    // Sign-in happens on the main domain, but redirects land on helpers.
    hosts: ['chat.deepseek.com', 'account.deepseek.com', 'platform.deepseek.com'],
    url: 'https://chat.deepseek.com/',
    // Where the token lives instead of a cookie.
    tokenKey: 'userToken',
    tokenHost: 'chat.deepseek.com',
    cookieHosts: ['chat.deepseek.com', '.deepseek.com'],
    // Analytics noise is dropped so the header stays small and readable.
    cookieKeep: (name) => !/^(_ga|_gid|_gat|Hm_|HMACCOUNT|__utm)/.test(name),
  },
  'gemini-web': {
    host: 'gemini.google.com',
    // Signing in happens on accounts.google.com first; matching only
    // gemini.google.com left the loop blind to the tab the user was typing in.
    hosts: ['gemini.google.com', 'accounts.google.com', 'myaccount.google.com'],
    url: 'https://gemini.google.com/app',
    cookieHosts: ['.google.com', 'gemini.google.com', 'accounts.google.com'],
    cookieKeep: (name) => /^(__Secure-1PSID|__Secure-1PSIDTS|__Secure-3PSID|SID|HSID|SSID|APISID|SAPISID|NID|AEC|SOCS|OSID|SEARCH_SAMESITE)$/.test(name),
    // Without this cookie the session is anonymous; it is the one that must be present.
    requiredCookie: '__Secure-1PSID',
  },
}

/**
 * Does a cookie host (as stored, e.g. `.google.com`) cover a page host?
 * @param {string} cookieHost
 * @param {string} pageHost
 */
export function hostMatches(cookieHost, pageHost) {
  const cookie = String(cookieHost ?? '').toLowerCase()
  const page = String(pageHost ?? '').toLowerCase()
  if (cookie === '' || page === '') return false
  if (cookie.startsWith('.')) {
    const bare = cookie.slice(1)
    return page === bare || page.endsWith(`.${bare}`)
  }
  return page === cookie
}

/**
 * Build a Cookie header from a jar, keeping only live, wanted cookies.
 *
 * @param {Array<{name: string, value: string, host?: string, expiry?: number}>} jar
 * @param {{hosts?: string[], keep?: (name: string) => boolean, now?: number}} options
 */
export function cookieHeaderFrom(jar, { hosts, keep, now = Date.now() } = {}) {
  const picked = new Map()
  for (const cookie of jar) {
    const name = String(cookie?.name ?? '')
    const value = String(cookie?.value ?? '')
    if (name === '' || value === '') continue
    if (keep !== undefined && keep(name) === false) continue
    if (hosts !== undefined && cookie.host !== undefined && hosts.some((host) => hostMatches(cookie.host, host)) === false) continue
    // `expiry` is seconds since the epoch in both Firefox and CDP; 0 means "session cookie".
    const expiry = Number(cookie.expiry ?? 0)
    if (expiry > 0 && expiry * 1000 < now) continue
    if (picked.has(name)) continue
    picked.set(name, value)
  }
  return [...picked.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
}
