/**
 * Dawnhub's individual-booking form: only the fields this extension ever fills. Class, source, deposit and
 * the rest are left to Dawnhub's own character search and to the advertiser - there's no price list to
 * derive a deposit from.
 */
export const dawnhubBookingFormFields = {
    nameRealm: "input[id='nameRealm']",
    pot: "input[id='pot']"
} as const

export type DawnhubBookingField = keyof typeof dawnhubBookingFormFields

export function getDawnhubBookingInput(form: HTMLFormElement, field: DawnhubBookingField) {
    return form.querySelector<HTMLInputElement>(dawnhubBookingFormFields[field])
}

/** Dawnhub's own magnifying-glass button next to Name-Realm, which looks the character up and fills in its class. */
export function getBookingSearchButton(form: HTMLFormElement) {
    return form.querySelector<HTMLButtonElement>('button[aria-label="search"]')
}

/** What a curve raid's boss choice reads as when every boss is booked rather than one specific one. Not a boss
 *  name Dawnhub ever renders. */
export const BOTH_CURVE_BOSSES = "Both"

export interface CurveBossOption {
    name: string
    input: HTMLInputElement
}

/**
 * The boss checkboxes Dawnhub renders on a curve raid's booking form, under its "Bosses" label - empty for a
 * curve raid selling a single boss, which it renders no checkboxes for, as well as for every other raid type.
 */
export function getCurveBossOptions(): CurveBossOption[] {
    const bossLabel = Array.from(document.querySelectorAll<HTMLParagraphElement>("p"))
        .find(paragraph => paragraph.textContent?.trim().startsWith("Bosses"))
    const group = bossLabel?.parentElement
    if (!group) return []
    return Array.from(group.querySelectorAll<HTMLLabelElement>("label"))
        .map(label => ({
            name: label.querySelector("span.MuiFormControlLabel-label")?.textContent?.trim() ?? "",
            input: label.querySelector<HTMLInputElement>("input[type='checkbox']")
        }))
        .filter((option): option is CurveBossOption => Boolean(option.name && option.input))
}

export function normalizeDawnhubBossName(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}
