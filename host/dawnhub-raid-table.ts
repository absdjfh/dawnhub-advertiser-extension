import type {RaidData} from "@/components/api/dawn-api";
import {isArmorType, type ArmorType} from "@/components/wow-classes";
import {getDawnhubGridColumnHeaders} from "@/host/dawnhub-page";
import {getBookedArmorTypes, hasOpenSlots} from "@/utils/raid-utils";

/**
 * Marks a row an extension filter took out of view. Dawnhub numbers the row ids of everything it rendered,
 * and `getRaidByRow` resolves raids by that numbering, so an extension filter hides its rows in place
 * instead of removing them; style.css is what takes a marked row off screen.
 */
const HIDDEN_ROW_ATTRIBUTE = "data-dat-raid-hidden"
const VIP_ARMOR_FILTER_LABEL = "Show only VIP raids with slots available for:"
const ROW_ID_PREFIX = "MUIDataTableBodyRow-raids-"

export function getColumnIndex(columnName: string) {
    return Array.from(getDawnhubGridColumnHeaders()).map(header => header.textContent).indexOf(columnName)
}

/**
 * The raid a table row shows. Dawnhub numbers its rows by their position in the raids list it loaded, after
 * its own VIP armor filter - so `raidData` has to be exactly that list, in that order.
 */
export function getRaidByRow(row: HTMLTableRowElement, raidData: RaidData[]): RaidData | undefined {
    const rowIndex = Number(row.id.split(ROW_ID_PREFIX)[1])
    return Number.isNaN(rowIndex) ? undefined : filterRaidsByVipArmorSelection(raidData)[rowIndex]
}

export function setRaidRowHidden(row: HTMLTableRowElement, hidden: boolean) {
    row.toggleAttribute(HIDDEN_ROW_ATTRIBUTE, hidden)
}

/**
 * Dawnhub's own raid filter: the container holding its "Show only VIP raids with slots available for:"
 * label and the armor toggle group under it. The extension reads the picked armor types from it, and
 * puts the filter Dawnhub has no equivalent of above it, where a raid filter is looked for.
 */
export function getVipArmorFilterSection(): HTMLElement | null {
    const label = Array.from(document.querySelectorAll<HTMLSpanElement>("span"))
        .find(element => element.textContent?.trim() === VIP_ARMOR_FILTER_LABEL)
    const section = label?.parentElement ?? null
    return section?.querySelector("div[role='group']") ? section : null
}

function filterRaidsByVipArmorSelection(raidData: RaidData[]) {
    const selectedArmorTypes = getSelectedVipArmorTypes()
    if (selectedArmorTypes.length === 0) return raidData
    return raidData.filter(raid => matchesSelectedVipArmorSelection(raid, selectedArmorTypes))
}

function getSelectedVipArmorTypes(): ArmorType[] {
    const toggleGroup = getVipArmorFilterSection()?.querySelector<HTMLDivElement>("div[role='group']")
    if (!toggleGroup) return []
    return Array.from(toggleGroup.querySelectorAll<HTMLButtonElement>("button[aria-pressed='true'][value]"))
        .map(button => button.value)
        .filter(isArmorType)
}

function matchesSelectedVipArmorSelection(raid: RaidData, selectedArmorTypes: ArmorType[]) {
    if (raid.loot !== "vip" || !hasOpenSlots(raid)) return false
    const bookedArmorTypes = getBookedArmorTypes(raid)
    return selectedArmorTypes.every(armorType => !bookedArmorTypes.has(armorType))
}
