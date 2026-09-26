import {
    BOTH_CURVE_BOSSES,
    getBookingSearchButton,
    getCurveBossOptions,
    getDawnhubBookingInput,
    normalizeDawnhubBossName,
    type DawnhubBookingField
} from "@/host/dawnhub-booking-form";
import type {BookingFillFields} from "@/components/booking-intent/pending-booking";
import {setFieldValue} from "@/utils/dom/controls";
import {waitUntil} from "@/utils/timers";

export type FillBookingOutcome = "filled" | "filled_without_search"

/**
 * Fills the panel's fields into Dawnhub's booking form, then clicks Dawnhub's own character search for the
 * Name-Realm - the same magnifying glass the advertiser would click, which looks the character up and fills
 * its class in. Never submits: the advertiser checks the form and submits it themselves.
 *
 * On a curve raid, the boss the panel's checkboxes ended up on is ticked too. Deposit, source, the private note
 * and the rest are left alone - without a price list there's nothing to derive them from.
 */
export async function fillBookingForm(form: HTMLFormElement, fields: Omit<BookingFillFields, "raidId">): Promise<FillBookingOutcome> {
    if (fields.curveBoss) tickCurveBosses(fields.curveBoss)
    if (fields.price) setBookingField(form, "pot", fields.price)
    if (!fields.nameRealm) return "filled"
    setBookingField(form, "nameRealm", fields.nameRealm)
    return await clickCharacterSearch(form) ? "filled" : "filled_without_search"
}

/**
 * Ticks the one boss named - or every boss for {@link BOTH_CURVE_BOSSES} - and unticks the rest. Clicked rather
 * than set, so Dawnhub's own state follows. Skipped when the page shows no boss checkboxes: a raid that stopped
 * being a two-boss curve raid between the panel reading it and this running is no reason to fail the fill.
 */
function tickCurveBosses(curveBoss: string) {
    const wanted = normalizeDawnhubBossName(curveBoss)
    const both = wanted === normalizeDawnhubBossName(BOTH_CURVE_BOSSES)
    for (const option of getCurveBossOptions()) {
        const shouldBeChecked = both || normalizeDawnhubBossName(option.name) === wanted
        if (option.input.checked !== shouldBeChecked) option.input.click()
    }
}

function setBookingField(form: HTMLFormElement, field: DawnhubBookingField, value: string) {
    const input = getDawnhubBookingInput(form, field)
    if (!input) throw new Error(`Dawnhub's booking form has no ${field} field.`)
    setFieldValue(input, value)
}

/**
 * Waits for the search button to be clickable before clicking it: React only re-renders with the new
 * Name-Realm after the input event that set it, and a click before that would search for the old value -
 * or hit a button still disabled for an empty field.
 */
async function clickCharacterSearch(form: HTMLFormElement): Promise<boolean> {
    const searchButton = getBookingSearchButton(form)
    if (!searchButton) return false
    try {
        await waitUntil(() => !searchButton.disabled, {timeoutMs: 1500})
    } catch {
        return false
    }
    searchButton.click()
    return true
}
