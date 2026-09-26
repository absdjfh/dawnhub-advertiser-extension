import {describe, expect, it} from "vitest"
import {addMinutes, formatTimeAgo, formatWallTime, getWallMinute, parseOffsetTime} from "@/utils/date"
import {normalizeDawnDateTime} from "@/utils/timezone"

const wall = (value: string) => formatWallTime(parseOffsetTime(value))

describe("parseOffsetTime / formatWallTime", () => {
    it("should keep the wall clock of the offset written in the string", () => {
        expect(wall("2026-07-01T10:08:00.000+02:00")).toBe("10:08")
        expect(wall("2026-07-01T10:08:00-03:30")).toBe("10:08")
        expect(wall("2026-07-01T10:08:00+0530")).toBe("10:08")
        expect(wall("2026-07-01 10:08:00Z")).toBe("10:08")
    })

    it("should read a string without an offset as written", () => {
        expect(wall("2026-07-01T10:08")).toBe("10:08")
    })

    it("should resolve the instant using the offset", () => {
        expect(parseOffsetTime("2026-07-01T10:00:00+02:00").instant).toBe(Date.UTC(2026, 6, 1, 8, 0))
    })

    it("should report invalid input", () => {
        expect(wall("garbage")).toBe("Invalid date")
        expect(wall("2026-02-30T10:00:00Z")).toBe("Invalid date")
        expect(wall("2026-02-01T24:00:00Z")).toBe("Invalid date")
    })

    it("should show Berlin wall time across the spring-forward gap", () => {
        expect(wall(normalizeDawnDateTime("2026-03-29T00:59:00.000Z"))).toBe("00:59")
        expect(wall(normalizeDawnDateTime("2026-03-29T03:00:00.000Z"))).toBe("03:00")
        expect(wall(normalizeDawnDateTime("2026-03-28T23:59:00.000Z"))).toBe("23:59")
    })

    it("should show Berlin wall time across the fall-back overlap", () => {
        expect(wall(normalizeDawnDateTime("2026-10-25T01:59:00.000Z"))).toBe("01:59")
        expect(wall(normalizeDawnDateTime("2026-10-25T02:30:00.000Z"))).toBe("02:30")
        expect(wall(normalizeDawnDateTime("2026-10-25T03:00:00.000Z"))).toBe("03:00")
    })
})

describe("addMinutes / getWallMinute", () => {
    it("should shift the instant and keep the offset", () => {
        const shifted = addMinutes(parseOffsetTime("2026-07-01T10:50:00+02:00"), 15)
        expect(formatWallTime(shifted)).toBe("11:05")
        expect(getWallMinute(shifted)).toBe(5)
    })

    it("should roll past midnight", () => {
        expect(formatWallTime(addMinutes(parseOffsetTime("2026-07-01T23:59:00+02:00"), 1))).toBe("00:00")
    })

    it("should not shift the wall clock when crossing a DST change (fixed offset)", () => {
        // 00:30 +01:00 on the spring-forward night plus 2h is 02:30 on the fixed +01:00 clock.
        expect(formatWallTime(addMinutes(parseOffsetTime("2026-03-29T00:30:00+01:00"), 120))).toBe("02:30")
    })

    it("should read the wall minute for a negative offset", () => {
        expect(getWallMinute(parseOffsetTime("2026-07-01T10:45:00-03:30"))).toBe(45)
    })
})

describe("formatTimeAgo", () => {
    const now = Date.UTC(2026, 5, 15, 12, 0, 0)
    const ago = (ms: number) => formatTimeAgo(now - ms, now)
    const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR

    it("should describe recent times", () => {
        expect(ago(0)).toBe("a few seconds ago")
        expect(ago(44 * SEC)).toBe("a few seconds ago")
        expect(ago(45 * SEC)).toBe("a minute ago")
        expect(ago(5 * MIN)).toBe("5 minutes ago")
        expect(ago(45 * MIN)).toBe("an hour ago")
        expect(ago(3 * HOUR)).toBe("3 hours ago")
        expect(ago(22 * HOUR)).toBe("a day ago")
        expect(ago(5 * DAY)).toBe("5 days ago")
    })

    it("should describe future times", () => {
        expect(ago(-5 * MIN)).toBe("in 5 minutes")
    })

    it("should describe long spans", () => {
        expect(ago(30 * DAY)).toBe("a month ago")
        expect(ago(90 * DAY)).toBe("3 months ago")
        expect(ago(400 * DAY)).toBe("a year ago")
        expect(ago(1100 * DAY)).toBe("3 years ago")
    })

    it("should not depend on DST: 24 real hours across a DST change is still a day", () => {
        const springForward = Date.UTC(2026, 2, 29, 12, 0, 0)
        expect(formatTimeAgo(springForward - DAY, springForward)).toBe("a day ago")
    })
})
