import BookingIntentPanel from "@/components/ui/BookingIntentPanel.vue";
import {fetchRaidsList, getRaidDetails, type RaidData} from "@/components/api/dawn-api";
import {restrictOpenRaidsToProximityWindow, summarizeOpenRaids, type OpenRaidSummary} from "@/components/booking-intent/booking-intent";
import {openBookingInNewTab, type BookingFillFields} from "@/components/booking-intent/pending-booking";
import {getBookingPageUrl, getCurrentRaidIdFromUrl} from "@/host/dawnhub-page";
import {getRememberedRaidsListRequest} from "@/host/dawnhub-raids-request";
import {BASE_URL} from "@/utils/constants";
import {getRaidInstant} from "@/utils/raid-time";
import {mountComponent, type MountedComponent} from "@/utils/mount-vue";
import {reportError} from "@/utils/report-error";
import {showToast} from "@/utils/toast";

let panel: MountedComponent | null = null
// Set synchronously the moment an open is underway, before the `await`s below - `panel` itself isn't set
// until the app actually mounts, which would otherwise leave a window where a second trigger (another paste,
// or a click) fired while the first open is still in flight sees no panel yet and starts its own.
let opening = false

export function isBookingIntentPanelOpen() {
    return panel !== null || opening
}

export function closeBookingIntentPanel() {
    panel?.unmount()
    document.querySelector(".dat-booking-intent-root")?.remove()
    panel = null
}

/** Opens the confirm-before-fill panel; `image` pre-fills it when opened from a page-wide paste. */
export async function openBookingIntentPanel(image?: Blob) {
    if (isBookingIntentPanelOpen()) return
    opening = true
    try {
        const currentRaidId = getCurrentRaidIdFromUrl()
        let allOpenRaids: OpenRaidSummary[]
        try {
            allOpenRaids = summarizeOpenRaids(await loadCandidateRaids(currentRaidId))
        } catch (error) {
            reportError("Could not load Dawnhub's raids", error, {toast: "Reload the page and try again."})
            return
        }
        if (allOpenRaids.length === 0) {
            showToast(currentRaidId || getRememberedRaidsListRequest()
                ? "None of the raids you're looking at has a slot left to book."
                : "Open Dawnhub's raids list first and wait for it to load - the DM is matched against the raids listed there.")
            return
        }
        const nearbyOpenRaids = restrictOpenRaidsToProximityWindow(allOpenRaids)
        // Only narrow down to the proximity window when that leaves something to show - if every open raid
        // starts further out, showing none of them would be worse than falling back to all of them. The
        // raid whose page this is stays on the short list either way: it's the likeliest one of all.
        const currentRaid = allOpenRaids.find(raid => raid.id === currentRaidId)
        const openRaids = nearbyOpenRaids.length > 0 ? nearbyOpenRaids : allOpenRaids
        if (currentRaid && !openRaids.includes(currentRaid)) openRaids.unshift(currentRaid)

        const root = document.createElement("div")
        root.className = "dat-booking-intent-root"
        document.body.appendChild(root)
        panel = mountComponent(BookingIntentPanel, {
            openRaids,
            allOpenRaids,
            preselectedRaidId: currentRaid?.id ?? null,
            initialImage: image ?? null,
            openBooking,
            onClose: closeBookingIntentPanel
        }, root)
    } finally {
        opening = false
    }
}

/**
 * The raids the advertiser was last looking at in this tab (the raids list Dawnhub last loaded - see
 * rememberRaidsListRequest), plus the raid whose own page this is, if it is one: a raid opened straight from
 * a link was never on a list, and it's the likeliest raid the DM is about. Sorted soonest first, which is
 * also how a tie between equally good matches is broken.
 */
async function loadCandidateRaids(currentRaidId: string | null): Promise<RaidData[]> {
    const listRequest = getRememberedRaidsListRequest()
    const [listed, current] = await Promise.all([
        listRequest ? fetchRaidsList(listRequest) : Promise.resolve([]),
        currentRaidId ? getRaidDetails(currentRaidId).catch(() => null) : Promise.resolve(null)
    ])
    const raids = current && !listed.some(raid => raid._id === current._id) ? [...listed, current] : listed
    return raids
        .map(raid => ({raid, instant: getRaidInstant(raid)}))
        .sort((a, b) => a.instant - b.instant)
        .map(entry => entry.raid)
}

/**
 * Every booking is opened in a tab of its own, even when the raid it's for is already open in this one: a
 * message regularly asks for several bookings, and each of them needs its own booking form to be filled in.
 * The panel is deliberately left open afterwards, so the bookings read alongside this one can be checked and
 * opened as well without pasting the message again.
 */
async function openBooking(fields: BookingFillFields) {
    if (!BASE_URL) throw new Error("This isn't a Dawnhub page.")
    await openBookingInNewTab(getBookingPageUrl(BASE_URL, fields.raidId), fields)
}
