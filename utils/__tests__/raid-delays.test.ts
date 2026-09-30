import {beforeEach, describe, expect, it} from "vitest"
import {fakeBrowser} from "#imports"
import type {RaidData} from "@/components/api/dawn-api"
import {createRaidLockTracker, estimateRaidDelays, raidLocksStore, type RaidLock} from "@/utils/raid-delays"

const RAID_LIST = "https://hub.dawn-boosting.com/api/raids?dateFrom=2026-09-25%2000%3A00%3A00&dateTo=2026-09-25%2023%3A59%3A59&type=raid&region=eu"
const CURVE_LIST = "https://hub.dawn-boosting.com/api/raids?dateFrom=2026-09-25%2000%3A00%3A00&dateTo=2026-09-25%2023%3A59%3A59&type=curve&region=eu"
const SECOND = 1000
const MINUTE = 60 * SECOND

/** Dawn time on the day the raids are on; Dawnhub writes Dawn's wall time with a Z. */
function at(time: string) {
    return Date.parse(`2026-09-25T${time}:00+02:00`)
}

function raid(id: string, time: string, status = "active", fields: Partial<RaidData> = {}) {
    return {
        _id: id,
        dateTime: `2026-09-25T${time}:00.000Z`,
        status,
        type: "raid",
        squadLeader: "leader",
        ...fields
    } as RaidData
}

function lock(raidId: string, planned: string, locked: string, squadLeader = "leader"): RaidLock {
    return {raidId, squadLeader, plannedAt: at(planned), lockedAt: at(locked)}
}

beforeEach(() => {
    fakeBrowser.reset()
})

describe("noticeLocks", () => {
    it("should time a lock halfway between the load that showed the raid active and the one showing it locked", async () => {
        const noticeLocks = createRaidLockTracker()
        await noticeLocks(RAID_LIST, [raid("a", "17:20"), raid("b", "18:00")], at("17:27"))
        const known = await noticeLocks(RAID_LIST, [raid("a", "17:20", "locked"), raid("b", "18:00")], at("17:27") + 30 * SECOND)

        const timed = [{raidId: "a", squadLeader: "leader", plannedAt: at("17:20"), lockedAt: at("17:27") + 15 * SECOND}]
        expect(known).toEqual(timed)
        expect(await raidLocksStore.getValue()).toEqual(timed)
    })

    it("should not time a raid first seen locked, or a lock after a gap between loads too long to tell", async () => {
        const noticeLocks = createRaidLockTracker()
        await noticeLocks(RAID_LIST, [raid("a", "17:20", "locked"), raid("b", "18:00")], at("17:27"))
        await noticeLocks(RAID_LIST, [raid("a", "17:20", "locked"), raid("b", "18:00")], at("17:27") + 30 * SECOND)
        // Dawnhub stops reloading a hidden tab, and reloads it as soon as it is shown again.
        await noticeLocks(RAID_LIST, [raid("a", "17:20", "locked"), raid("b", "18:00", "locked")], at("18:10"))

        expect(await raidLocksStore.getValue()).toEqual([])
    })

    it("should time a lock up to three minutes between loads", async () => {
        const noticeLocks = createRaidLockTracker()
        await noticeLocks(RAID_LIST, [raid("a", "17:20")], at("17:27"))
        await noticeLocks(RAID_LIST, [raid("a", "17:20", "locked")], at("17:30"))

        expect((await raidLocksStore.getValue()).map(entry => entry.lockedAt)).toEqual([at("17:28") + 30 * SECOND])
    })

    it("should only compare loads of the same list", async () => {
        const noticeLocks = createRaidLockTracker()
        await noticeLocks(RAID_LIST, [raid("a", "17:20")], at("17:27"))
        await noticeLocks(CURVE_LIST, [raid("a", "17:20", "locked")], at("17:27") + 30 * SECOND)

        expect(await raidLocksStore.getValue()).toEqual([])
    })

    it("should only count a raid going from active to locked", async () => {
        const noticeLocks = createRaidLockTracker()
        await noticeLocks(RAID_LIST, [raid("a", "17:20"), raid("b", "17:30")], at("17:27"))
        await noticeLocks(RAID_LIST, [raid("a", "17:20", "cancelled"), raid("b", "17:30", "completed")], at("17:27") + 30 * SECOND)

        expect(await raidLocksStore.getValue()).toEqual([])
    })

    it("should keep the first lock seen of each raid, and forget locks after a day", async () => {
        const seenInAnotherTab = lock("a", "17:20", "17:26")
        await raidLocksStore.setValue([{...lock("old", "17:00", "17:10"), lockedAt: at("17:10") - 24 * 60 * MINUTE}, seenInAnotherTab])
        const noticeLocks = createRaidLockTracker()
        await noticeLocks(RAID_LIST, [raid("a", "17:20"), raid("b", "17:25")], at("17:27"))
        await noticeLocks(RAID_LIST, [raid("a", "17:20", "locked"), raid("b", "17:25", "locked")], at("17:27") + 30 * SECOND)

        expect(await raidLocksStore.getValue()).toEqual([
            seenInAnotherTab,
            {raidId: "b", squadLeader: "leader", plannedAt: at("17:25"), lockedAt: at("17:27") + 15 * SECOND}
        ])
    })
})

describe("estimateRaidDelays", () => {
    it("should expect a leader's next raid as late as the raid before it locked", () => {
        const raids = [raid("a", "17:20", "locked"), raid("b", "18:00"), raid("c", "19:00")]

        expect(estimateRaidDelays(raids, [lock("a", "17:20", "17:38")], at("17:45"))).toEqual(new Map([
            ["b", {expectedStart: "18:18", reason: "17:20 run locked 18 min late"}]
        ]))
    })

    it("should count a raid still open past its start as late by the minute", () => {
        const raids = [raid("a", "18:30"), raid("b", "19:10")]

        expect(estimateRaidDelays(raids, [], at("18:42") + 40 * SECOND).get("b"))
            .toEqual({expectedStart: "19:22", reason: "18:30 run still open 12 min after start"})
        expect(estimateRaidDelays(raids, [], at("18:45")).get("b"))
            .toEqual({expectedStart: "19:25", reason: "18:30 run still open 15 min after start"})
    })

    it("should estimate nothing for a leader on time, or with nothing to go by", () => {
        const raids = [raid("a", "17:20", "locked"), raid("b", "18:00"), raid("other", "18:00", "active", {squadLeader: "someone else"})]

        expect(estimateRaidDelays(raids, [lock("a", "17:20", "17:22")], at("17:45"))).toEqual(new Map())
        // A lock no refresh timed, and a raid whose start has only just passed.
        expect(estimateRaidDelays(raids, [], at("17:45"))).toEqual(new Map())
        expect(estimateRaidDelays([raid("a", "17:20"), raid("b", "18:00")], [], at("17:22"))).toEqual(new Map())
    })

    it("should ignore a raid Dawnhub lists without a leader", () => {
        const raids = [raid("a", "17:20", "active", {squadLeader: undefined}), raid("b", "18:00", "active", {squadLeader: undefined})]

        expect(estimateRaidDelays(raids, [], at("17:45"))).toEqual(new Map())
    })

    it("should go by a leader's raid up to three hours earlier, and not by a delay too long to be real", () => {
        const late = lock("a", "15:00", "15:20")

        expect(estimateRaidDelays([raid("a", "15:00", "locked"), raid("b", "18:00")], [late], at("17:45")).get("b"))
            .toEqual({expectedStart: "18:20", reason: "15:00 run locked 20 min late"})
        expect(estimateRaidDelays([raid("a", "15:00", "locked"), raid("b", "18:01")], [late], at("17:45"))).toEqual(new Map())
        // A raid left open by mistake.
        expect(estimateRaidDelays([raid("a", "17:20"), raid("b", "18:00")], [], at("18:50")).get("b"))
            .toEqual({expectedStart: "19:30", reason: "17:20 run still open 90 min after start"})
        expect(estimateRaidDelays([raid("a", "17:20"), raid("b", "18:00")], [], at("18:51"))).toEqual(new Map())
    })

    it("should go by the leader's latest raid before, passing over cancelled ones", () => {
        const raids = [raid("a", "16:30", "locked"), raid("b", "17:20", "locked"), raid("cancelled", "17:50", "cancelled"), raid("c", "18:00")]
        const locks = [lock("a", "16:30", "17:00"), lock("b", "17:20", "17:28")]

        expect(estimateRaidDelays(raids, locks, at("17:45")).get("c"))
            .toEqual({expectedStart: "18:08", reason: "17:20 run locked 8 min late"})
    })

    it("should go by a raid that locked on another list when it is the leader's latest", () => {
        const raids = [raid("a", "17:00", "locked"), raid("b", "18:30")]
        const lockedOnCurveList = lock("curve", "17:30", "17:50")

        expect(estimateRaidDelays(raids, [lock("a", "17:00", "17:05"), lockedOnCurveList], at("18:00")).get("b"))
            .toEqual({expectedStart: "18:50", reason: "17:30 run locked 20 min late"})
        expect(estimateRaidDelays([...raids, raid("c", "17:45", "locked")], [lockedOnCurveList, lock("c", "17:45", "17:49")], at("18:00")).get("b"))
            .toEqual({expectedStart: "18:34", reason: "17:45 run locked 4 min late"})
    })
})
