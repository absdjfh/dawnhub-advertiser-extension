export const BASE_URLS = [
  "https://hub.dawn-boosting.com",
  "https://devhub.dawn-boosting.com",
]

const currentOrigin = globalThis.location?.origin
export const BASE_URL = currentOrigin && BASE_URLS.includes(currentOrigin) ? currentOrigin : null

/** The public site linked from the popup - see hosted/. */
export const HOMEPAGE_URL = "https://dawn-adv-tools.rolich.net"
export const GUIDE_URL = `${HOMEPAGE_URL}/guide.html`
