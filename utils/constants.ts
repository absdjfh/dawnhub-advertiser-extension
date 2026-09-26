export const BASE_URLS = [
  "https://hub.dawn-boosting.com",
  "https://devhub.dawn-boosting.com",
]

const currentOrigin = globalThis.location?.origin
export const BASE_URL = currentOrigin && BASE_URLS.includes(currentOrigin) ? currentOrigin : null

/** The public site the popup and error messages point people to - see hosted/. */
export const HOMEPAGE_URL = "https://dawn-adv-tools.rolich.net"
export const GUIDE_URL = `${HOMEPAGE_URL}/guide.html`

/**
 * Prefixes every key this extension keeps in the page's own sessionStorage. The page is Dawnhub's, so the
 * prefix keeps the extension's entries apart from Dawnhub's own.
 */
export const SESSION_STORAGE_PREFIX = "dawnhubAdvertiserTools:"
