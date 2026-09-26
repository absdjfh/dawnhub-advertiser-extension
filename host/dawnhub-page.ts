/** The HTML contract exposed by Dawnhub pages. Keep host selectors here. */
export const dawnhubSelectors = {
    toolbarMount: 'div[role="toolbar"] > div',
    grid: "table[role='grid']",
    gridRows: "table[role='grid'] > tbody > tr",
    gridHeaders: "table[role='grid'] th",
    bookingForm: "form",
    nextData: "script[id='__NEXT_DATA__']"
} as const

export interface NextData {
    buildId: string
    props: {
        pageProps: {
            raidInstances?: {raidId: string, name: string, shortName: string}[]
        }
    }
}

export function getNextData(): NextData | null {
    const nextData = document.querySelector<HTMLScriptElement>(dawnhubSelectors.nextData)
    if (!nextData) return null
    try {
        return JSON.parse(nextData.innerText) as NextData
    } catch (error) {
        console.error("Failed to parse Dawnhub's page data", error)
        return null
    }
}

/** The raids list, including the curves tab - the page with the raid table and Dawnhub's date filters. */
export function isRaidsView() {
    return /bookings\/(raids|curves)(?!\/)/.test(window.location.toString())
}

/** One raid's own page, with its bookings and the form to add one. */
export function isBookingView() {
    return window.location.toString().includes("/bookings/raids/")
}

export function getCurrentRaidIdFromUrl(): string | null {
    if (!isBookingView()) return null
    return window.location.pathname.split("/").filter(Boolean).slice(-1)[0] ?? null
}

export function getBookingPageUrl(baseUrl: string, raidId: string) {
    return `${baseUrl}/bookings/raids/${raidId}`
}

export function getDawnhubGrid() {
    return document.querySelector<HTMLTableElement>(dawnhubSelectors.grid)
}

export function getDawnhubGridRows() {
    return document.querySelectorAll<HTMLTableRowElement>(dawnhubSelectors.gridRows)
}

export function getDawnhubGridColumnHeaders() {
    return document.querySelectorAll<HTMLTableCellElement>(dawnhubSelectors.gridHeaders)
}

/**
 * Dawnhub can render more than one form on a raid's page (e.g. a raid-announcement form alongside the
 * booking form), so this looks for the one that actually has the individual-booking fields, identified
 * by a field unique to that form, rather than assuming the first form on the page is it.
 */
export function getDawnhubForm() {
    return Array.from(document.querySelectorAll<HTMLFormElement>(dawnhubSelectors.bookingForm))
        .find(form => form.querySelector("input[id='pot']")) ?? null
}

/** Reads one of Dawnhub's labelled inputs, e.g. the raids list's "Start Date" filter. */
export function getInputValueByLabel(labelText: string) {
    const label = Array.from(document.querySelectorAll<HTMLLabelElement>("label"))
        .find(entry => entry.textContent?.trim() === labelText)
    if (!label?.htmlFor) return null
    return (document.getElementById(label.htmlFor) as HTMLInputElement | null)?.value.trim() ?? null
}
