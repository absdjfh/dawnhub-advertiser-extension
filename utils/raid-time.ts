import type {RaidData} from "@/components/api/dawn-api";
import {addMinutes, formatWallTime, parseOffsetTime, type OffsetTime} from "@/utils/date";
import {normalizeDawnDateTime} from "@/utils/timezone";

/** Formats the raid's start time as Dawnhub shows it, HH:mm on Dawn's own clock. */
export function formatRaidTime(raid: RaidData): string {
    return formatWallTime(getRaidTime(raid))
}

/** The raid's start as an absolute instant (epoch ms). */
export function getRaidInstant(raid: RaidData): number {
    return getRaidTime(raid).instant
}

/** The raid's start in Dawn time, the way Dawnhub shows it. */
export function getRaidTime(raid: RaidData): OffsetTime {
    const raidTime = parseOffsetTime(normalizeDawnDateTime(raid.dateTime))
    // Dawnhub uses 23:59 to represent midnight.
    return formatWallTime(raidTime) === "23:59" ? addMinutes(raidTime, 1) : raidTime
}
