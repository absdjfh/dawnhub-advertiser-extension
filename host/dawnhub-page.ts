/** The HTML contract exposed by Dawnhub pages. Keep host selectors here. */
export const dawnhubSelectors = {
    toolbarMount: 'div[role="toolbar"] > div',
    grid: "table[role='grid']",
    gridRows: "table[role='grid'] > tbody > tr",
    gridHeaders: "table[role='grid'] th",
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

/** Reads one of Dawnhub's labelled inputs, e.g. the raids list's "Start Date" filter. */
export function getInputValueByLabel(labelText: string) {
    const label = Array.from(document.querySelectorAll<HTMLLabelElement>("label"))
        .find(entry => entry.textContent?.trim() === labelText)
    if (!label?.htmlFor) return null
    return (document.getElementById(label.htmlFor) as HTMLInputElement | null)?.value.trim() ?? null
}
