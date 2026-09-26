import {storage} from "#imports";
import type {RaidData} from "@/components/api/dawn-api";
import {getVipArmorFilterSection, setRaidRowHidden} from "@/host/dawnhub-raid-table";
import {createCheckboxToggle} from "@/utils/dom/controls";
import {hasOpenSlots} from "@/utils/raid-utils";

/**
 * Hides the raids that are already full, whatever their loot type is. Dawnhub filters its VIP raids by the
 * armor type their open slots still take, but offers nothing of the kind for curve and regular raids, so
 * the extension hides those rows itself, on top of whichever of Dawnhub's own filters are in place.
 *
 * The tick is kept in extension storage, so it survives reloads, and mirrored in memory, so the synchronous
 * row renderer can branch on it.
 */
export const openSlotsFilterStore = storage.defineItem<boolean>("local:openSlotsOnly", {fallback: false})

let openSlotsOnly = false

const FILTER_CLASS = "dat-open-slots-filter"

/** Loads the stored tick before anything is rendered, so neither the tick nor the rows start from a stale one. */
export async function restoreOpenSlotsFilter() {
    openSlotsOnly = await openSlotsFilterStore.getValue()
}

/**
 * Adds the tick that keeps only the raids with a slot left on screen. Dawnhub's armor filter is where a raid
 * filter is looked for, so the tick goes directly above it, and only falls back into the extension's toolbar
 * on the pages Dawnhub renders no filter of its own on, curves among them. Standing outside the toolbar, the
 * tick outlives the toolbar it was built with, so a previous one is dropped here instead of being left behind.
 */
export function addOpenSlotsFilter(toolbar: HTMLElement, onChange: () => void) {
    removeOpenSlotsFilter()
    const {root} = createCheckboxToggle({
        name: "Show only raids with slots available",
        checked: openSlotsOnly,
        onchange: async checked => {
            openSlotsOnly = checked
            onChange()
            await openSlotsFilterStore.setValue(checked)
        }
    })
    root.classList.add(FILTER_CLASS)
    const vipArmorFilter = getVipArmorFilterSection()
    if (vipArmorFilter) vipArmorFilter.prepend(root)
    else toolbar.appendChild(root)
}

export function removeOpenSlotsFilter() {
    document.querySelectorAll(`.${FILTER_CLASS}`).forEach(previous => previous.remove())
}

/**
 * Applies the filter to a row whose raid the caller already resolved. A row no raid could be resolved for is
 * Dawnhub's own; it is left alone rather than taken for a full raid.
 */
export function applyOpenSlotsFilter(row: HTMLTableRowElement, raid: RaidData | undefined) {
    setRaidRowHidden(row, openSlotsOnly && raid != null && !hasOpenSlots(raid))
}
