import {storage} from "#imports";
import type {RaidData} from "@/components/api/dawn-api";
import {addMinutes, formatWallTime, type OffsetTime} from "@/utils/date";
import {getRaidTime} from "@/utils/raid-time";

/** When a raid went from active to locked: the closest the extension sees to when it actually started. */
export interface RaidLock {
    raidId: string
    /** Dawnhub's id for the raid's leader. */
    squadLeader: string
    /** The start the raid had when it locked. */
    plannedAt: number
    lockedAt: number
}

export interface RaidDelay {
    /** The raid's likely start in Dawn time, e.g. "18:48". */
    expectedStart: string
    /** What the estimate goes by, e.g. "18:30 run locked 18 min late". */
    reason: string
}

/**
 * The locks seen on every raids list, kept for all Dawnhub tabs alike: a leader's next raid may be listed
 * elsewhere than the raid before it.
 */
export const raidLocksStore = storage.defineItem<RaidLock[]>("local:raidLocks", {fallback: []})

const MINUTE_MS = 60_000
const KEEP_MS = 24 * 60 * MINUTE_MS
/**
 * A lock is only timed when the list was loaded this shortly before. Dawnhub reloads a list every 30 s while its
 * tab is shown and not at all while it is hidden, after which the raid could have locked at any point in between.
 */
const MAX_LOAD_GAP_MS = 3 * MINUTE_MS
/** Leaders run back to back; a raid further back than this says nothing about when their next one starts. */
const BACK_TO_BACK_MS = 3 * 60 * MINUTE_MS
/** Less late than this is on time. */
const MIN_DELAY_MINUTES = 3
/** Later than this is a raid left open in Dawnhub rather than a real delay. */
const MAX_DELAY_MINUTES = 90
/** The raids that take up their leader's time; cancelled and hidden ones do not. */
const HELD_STATUSES = new Set(["active", "locked", "completed"])

/**
 * Follows the raids lists a tab loads and remembers when their raids lock, timed halfway between the load that
 * still showed a raid active and the one showing it locked. A list is known by its address, so switching lists
 * or dates never compares one list with another. Returns every lock known afterwards, this tab's and other
 * tabs' alike, for the estimates to go by.
 */
export function createRaidLockTracker() {
    const lastLoadByList = new Map<string, ListLoad>()
    return async function noticeLocks(listUrl: string, raids: RaidData[], now: number): Promise<RaidLock[]> {
        const lastLoad = lastLoadByList.get(listUrl)
        lastLoadByList.set(listUrl, {activeIds: new Set(raids.filter(raid => raid.status === "active").map(raid => raid._id)), at: now})
        const locks = lastLoad && now - lastLoad.at <= MAX_LOAD_GAP_MS ? timeLocks(raids, lastLoad, now) : []
        return saveRaidLocks(locks, now)
    }
}

interface ListLoad {
    activeIds: Set<string>
    at: number
}

/** The raids this load shows locked that the load before still showed active, timed halfway between the two. */
function timeLocks(raids: RaidData[], lastLoad: ListLoad, now: number): RaidLock[] {
    const lockedAt = Math.round((lastLoad.at + now) / 2)
    return raids.flatMap(raid => raid.status === "locked" && raid.squadLeader && lastLoad.activeIds.has(raid._id)
        ? [{raidId: raid._id, squadLeader: raid.squadLeader, plannedAt: getRaidTime(raid).instant, lockedAt}]
        : [])
}

/** Keeps the first lock seen of each raid, since another tab may notice the same one later, and only the last day's. */
async function saveRaidLocks(locks: RaidLock[], now: number): Promise<RaidLock[]> {
    const stored = await raidLocksStore.getValue()
    const kept = stored.filter(lock => now - lock.lockedAt < KEEP_MS)
    const known = new Set(kept.map(lock => lock.raidId))
    const added = locks.filter(lock => !known.has(lock.raidId))
    const all = [...kept, ...added]
    // Written only when something changed: every refresh of the list passes through here.
    if (added.length > 0 || kept.length !== stored.length) await raidLocksStore.setValue(all)
    return all
}

/**
 * When each active raid will likely start, for the raids whose leader's raid before them is late: leaders run
 * back to back, so a raid still open past its start, or locked late, holds up the leader's next one. The raid
 * before is the leader's latest starting up to 3 h earlier, on this list or, once it locked, on any other.
 * Raids with nothing to go by, or going by a raid that was on time, get no estimate.
 */
export function estimateRaidDelays(raids: RaidData[], locks: RaidLock[], now: number): Map<string, RaidDelay> {
    const startOf = createStartReader()
    const listed = new Set(raids.map(raid => raid._id))
    const lockByRaid = new Map(locks.map(lock => [lock.raidId, lock]))
    const delays = new Map<string, RaidDelay>()
    for (const raid of raids) {
        if (raid.status !== "active" || !raid.squadLeader) continue
        const start = startOf(raid)
        const isJustBefore = (at: number) => at < start.instant && start.instant - at <= BACK_TO_BACK_MS
        const listedRaid = latest(raids.filter(other => other.squadLeader === raid.squadLeader
            && HELD_STATUSES.has(other.status) && isJustBefore(startOf(other).instant)), other => startOf(other).instant)
        const lockElsewhere = latest(locks.filter(lock => lock.squadLeader === raid.squadLeader && !listed.has(lock.raidId)
            && isJustBefore(lock.plannedAt)), lock => lock.plannedAt)
        const previous = lockElsewhere && (!listedRaid || lockElsewhere.plannedAt > startOf(listedRaid).instant)
            ? {start: lockElsewhere.plannedAt, open: false, lock: lockElsewhere}
            : listedRaid && {start: startOf(listedRaid).instant, open: listedRaid.status === "active", lock: lockByRaid.get(listedRaid._id)}
        const lateness = previous && latenessOf(previous, now)
        if (!lateness) continue
        const previousStart = formatWallTime({instant: previous.start, offsetMinutes: start.offsetMinutes})
        delays.set(raid._id, {
            expectedStart: formatWallTime(addMinutes(start, lateness.minutes)),
            reason: `${previousStart} run ${lateness.description}`
        })
    }
    return delays
}

/** How late the leader's raid before is: still open past its start, which grows by the minute, or how late it locked. */
function latenessOf(previous: {start: number, open: boolean, lock?: RaidLock}, now: number) {
    const isLate = (minutes: number) => minutes >= MIN_DELAY_MINUTES && minutes <= MAX_DELAY_MINUTES
    if (previous.open) {
        const minutes = Math.floor((now - previous.start) / MINUTE_MS)
        return isLate(minutes) ? {minutes, description: `still open ${minutes} min after start`} : undefined
    }
    if (!previous.lock) return undefined
    const minutes = Math.round((previous.lock.lockedAt - previous.lock.plannedAt) / MINUTE_MS)
    return isLate(minutes) ? {minutes, description: `locked ${minutes} min late`} : undefined
}

/** Reads each start once: raids share starts, and reading Dawn time for every pair of raids would hold up a long list. */
function createStartReader() {
    const starts = new Map<string, OffsetTime>()
    return (raid: RaidData) => {
        const start = starts.get(raid.dateTime) ?? getRaidTime(raid)
        starts.set(raid.dateTime, start)
        return start
    }
}

function latest<T>(items: T[], startOf: (item: T) => number): T | undefined {
    return items.reduce<T | undefined>((found, item) => !found || startOf(item) > startOf(found) ? item : found, undefined)
}
