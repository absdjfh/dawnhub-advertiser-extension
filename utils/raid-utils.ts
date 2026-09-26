import type {RaidData} from "@/components/api/dawn-api";
import {findWowClass, type ArmorType} from "@/components/wow-classes";
import {getNextData} from "@/host/dawnhub-page";

/**
 * Whether a raid still takes a buyer, whatever its loot type is. A curve raid books each boss separately, so
 * Dawnhub reports its `booked` count per boss name rather than as the single total VIP and regular raids use;
 * the raid still takes a buyer as long as any one of its bosses has a slot open.
 */
export function hasOpenSlots(raid: RaidData): boolean {
    const booked = raid.booked
    if (typeof booked === "number") {
        return booked < Number(raid.buyerSlots)
    }
    return (raid.curveSlots ?? []).some(slot => (booked[slot.name] ?? 0) < Number(slot.slots))
}

/** The armor types a VIP raid already sold - VIP raids sell one buyer per armor type. */
export function getBookedArmorTypes(raid: RaidData): Set<ArmorType> {
    return new Set((raid.bookedClasses ?? [])
        .map(className => findWowClass(className)?.armorType)
        .filter((armorType): armorType is ArmorType => armorType != null))
}

/**
 * The raid's short name as Dawnhub lists it. Dawnhub fills `instanceName` in on the raids list; the page's
 * own list of raid instances is the fallback for a raid that came without one.
 */
export function getRaidName(raid: RaidData): string {
    if (raid.instanceName) return raid.instanceName
    const instance = getNextData()?.props?.pageProps?.raidInstances?.find(entry => String(entry.raidId) === String(raid.instance))
    return instance?.name ?? instance?.shortName ?? raid.raidShortName ?? ""
}

export function capitalize(str: string) {
    if (!str) {
        return str
    }
    if (str === "vip") return "VIP"
    return str.charAt(0).toUpperCase() + str.slice(1)
}
