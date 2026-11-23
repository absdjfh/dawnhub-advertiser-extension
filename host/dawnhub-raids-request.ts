import {BASE_URLS} from "@/utils/constants";

const RAIDS_LIST_PATH = "/api/raids"

/**
 * Whether a URL is Dawnhub loading its raids list (e.g. `/api/raids?dateFrom=...&type=raid&region=eu`) - as
 * opposed to one raid's details (`/api/raids/<id>`), or this extension's own reload of the same list, which
 * ends in `ext` (see fetchRaidsList).
 */
export function isDawnhubRaidsListRequest(url: string): boolean {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return false
    }
    return BASE_URLS.includes(parsed.origin)
        && parsed.pathname === RAIDS_LIST_PATH
        && parsed.search.length > 1
        && !url.endsWith("ext")
}

/**
 * Calls `onRequest` with the URL of every raids list Dawnhub loads from now on, and once right away with the
 * last one it loaded before this script started, if any.
 *
 * Read off the page's own resource timing entries rather than intercepted: the table on screen numbers its
 * rows by position in exactly that response (see getRaidByRow), so the extension has to load the very same
 * list, and the page's performance timeline already names every request it made - no webRequest permission
 * and no background script needed to learn it.
 */
export function watchDawnhubRaidsListRequests(onRequest: (url: string) => void): () => void {
    const observer = new PerformanceObserver(list => {
        // The first callback replays the buffered history in one batch - only its latest request matters.
        const latest = list.getEntries().map(entry => entry.name).filter(isDawnhubRaidsListRequest).at(-1)
        if (latest) onRequest(latest)
    })
    observer.observe({type: "resource", buffered: true})
    return () => observer.disconnect()
}
