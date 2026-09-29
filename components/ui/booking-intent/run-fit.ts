import {resolveCurveBoss, type OpenRaidSummary} from "@/components/booking-intent/booking-intent";
import {ARMOR_TYPES} from "@/components/wow-classes";
import {BOTH_CURVE_BOSSES} from "@/host/dawnhub-booking-form";
import {capitalize} from "@/utils/raid-utils";
import type {BookingEntry} from "@/components/ui/booking-intent/booking-entry";

/**
 * Why a raid in a booking's raid list may not take that booking: "misfit" when it can't - it has no room for
 * every character the panel is booking, or it's a VIP raid whose armor type is sold already - and "check" when
 * that can't be told yet, because nothing said what the buyer's armor type is. Only ever a mark on the raid:
 * it can still be picked, since the advertiser may know better (one of the characters going elsewhere, say).
 */
export interface RunFitMark {
    kind: "misfit" | "check"
    /** The mark as shown on the raid, e.g. "Plate taken". */
    text: string
    /** The reason in full, shown on hover. */
    reason: string
}

/**
 * The slots of `raid` a booking would take: those of the bosses ticked when it's the raid the booking is set
 * to, and otherwise what the ticks would start as if it were picked - the boss the message asked for, or every
 * boss when it named none (see BookingIntentEntry.vue). A raid sold whole has a single set, which RaidFullness
 * names "".
 */
function slotsTaken(raid: OpenRaidSummary, booking: BookingEntry): string[] {
    if (raid.curveBosses.length === 0) return [""]
    if (booking.raidId === raid.id && booking.checkedCurveBosses.length > 0) return booking.checkedCurveBosses
    const boss = resolveCurveBoss(raid, booking.mentionedCurveBoss)
    return boss && boss !== BOTH_CURVE_BOSSES ? [boss] : raid.curveBosses
}

/**
 * Where the characters the panel is booking won't all fit. A message booking several characters books them
 * into the same raid, so each set of slots this booking takes has to have room for every other booking taking
 * it as well - on a curve raid that's counted boss by boss, since two characters on different bosses don't
 * compete for a spot. Bookings already opened in a tab still count: the raid list is what Dawnhub reported
 * when the panel opened, so their spots aren't taken off it yet.
 */
function roomMarks(raid: OpenRaidSummary, booking: BookingEntry, bookings: BookingEntry[]): RunFitMark[] {
    const taken = slotsTaken(raid, booking)
    return raid.fullness.flatMap((fullness): RunFitMark[] => {
        if (fullness.slots <= 0 || !taken.includes(fullness.boss)) return []
        const needed = bookings.filter(other => slotsTaken(raid, other).includes(fullness.boss)).length
        const free = Math.max(0, fullness.slots - fullness.booked)
        if (free >= needed) return []
        const onBoss = fullness.boss ? ` on ${fullness.boss}` : ""
        if (free === 0) {
            return [{kind: "misfit", text: fullness.boss ? `${fullness.boss} full` : "Full", reason: `No spot is left${onBoss}.`}]
        }
        return [{
            kind: "misfit",
            text: `Room for ${free} of ${needed}${onBoss}`,
            reason: `${needed} characters in this panel need a spot${onBoss}, but only ${free} ${free === 1 ? "is" : "are"} left.`
        }]
    })
}

/**
 * A VIP raid sells one buyer per armor type, so the buyer's has to be one it still has - and two of the
 * panel's characters wearing the same one can't both go. While nothing says what the buyer wears, a raid that
 * has sold any armor type already is marked to be checked by hand; one that has sold none takes them whatever
 * they turn out to be.
 */
function armorMarks(raid: OpenRaidSummary, booking: BookingEntry, bookings: BookingEntry[]): RunFitMark[] {
    const open = raid.openArmorTypes
    if (!open) return []
    const armorType = booking.mentionedArmorType
    if (!armorType) {
        if (open.length === ARMOR_TYPES.length) return []
        return [{
            kind: "check",
            text: "Check class",
            reason: `The DM didn't say what the buyer plays - this VIP raid only has ${open.map(capitalize).join(", ") || "no armor type"} left.`
        }]
    }
    const armor = capitalize(armorType)
    if (!open.includes(armorType)) {
        return [{kind: "misfit", text: `${armor} taken`, reason: `This VIP raid has sold its ${armor} spot already.`}]
    }
    const sameArmor = bookings.filter(other => other.mentionedArmorType === armorType).length
    if (sameArmor < 2) return []
    return [{
        kind: "misfit",
        text: `Room for 1 of ${sameArmor} ${armor}`,
        reason: `${sameArmor} characters in this panel wear ${armor}, but a VIP raid takes one buyer per armor type.`
    }]
}

/** What stands in the way of `booking` going to `raid`, given every booking in the panel - none when it fits. */
export function runFitMarks(raid: OpenRaidSummary, booking: BookingEntry, bookings: BookingEntry[]): RunFitMark[] {
    return [...roomMarks(raid, booking, bookings), ...armorMarks(raid, booking, bookings)]
}
