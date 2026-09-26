/** A point in time that remembers the UTC offset it was written with, so its wall clock can be read back unchanged. */
export interface OffsetTime {
    /** Epoch milliseconds; NaN when the source string could not be parsed. */
    instant: number
    offsetMinutes: number
}

const ISO_REGEX =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2})(?::(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/
const INVALID_DATE = "Invalid date"
const MS_PER_MINUTE = 60_000

function parseOffsetMinutes(value: string | undefined): number {
    if (!value || value === "Z") return 0
    const sign = value.startsWith("-") ? -1 : 1
    const digits = value.slice(1).replace(":", "")
    return sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2) || 0))
}

/**
 * Parses an ISO 8601 string keeping the offset written in it (no local time zone involved). A string without an
 * offset is read as UTC, so its wall clock is preserved as written.
 */
export function parseOffsetTime(value: string): OffsetTime {
    const match = ISO_REGEX.exec(value.trim())
    const invalid = {instant: NaN, offsetMinutes: 0}
    if (!match) return invalid

    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
    const [hour, minute, second] = [Number(match[4] ?? 0), Number(match[5] ?? 0), Number(match[6] ?? 0)]
    const millisecond = Number((match[7] ?? "0").slice(0, 3).padEnd(3, "0"))
    const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond))
    // Date.UTC silently rolls impossible dates over (Feb 30 -> Mar 2); reject them instead.
    if (utcDate.getUTCFullYear() !== year || utcDate.getUTCMonth() !== month - 1 || utcDate.getUTCDate() !== day
        || hour > 23 || minute > 59 || second > 59) return invalid

    const offsetMinutes = parseOffsetMinutes(match[8])
    return {instant: utcDate.getTime() - offsetMinutes * MS_PER_MINUTE, offsetMinutes}
}

function wallClock(time: OffsetTime): Date {
    return new Date(time.instant + time.offsetMinutes * MS_PER_MINUTE)
}

/** Minute of the hour on the wall clock of the time's own offset. */
export function getWallMinute(time: OffsetTime): number {
    return wallClock(time).getUTCMinutes()
}

/** Formats the wall clock of the time's own offset as HH:mm. */
export function formatWallTime(time: OffsetTime): string {
    if (Number.isNaN(time.instant)) return INVALID_DATE
    const clock = wallClock(time)
    return `${String(clock.getUTCHours()).padStart(2, "0")}:${String(clock.getUTCMinutes()).padStart(2, "0")}`
}

/** Shifts the instant by a number of minutes, keeping the offset. */
export function addMinutes(time: OffsetTime, minutes: number): OffsetTime {
    return {instant: time.instant + minutes * MS_PER_MINUTE, offsetMinutes: time.offsetMinutes}
}

/**
 * Formats the distance between a timestamp and now in words, e.g. "5 minutes ago" or "in 2 hours". Matches moment's
 * fromNow() thresholds; beyond a month moment counts calendar months, this counts 30.4-day months.
 */
export function formatTimeAgo(timestamp: number, now: number = Date.now()): string {
    const elapsedMs = now - timestamp
    const absMs = Math.abs(elapsedMs)
    const seconds = Math.round(absMs / 1000)
    const minutes = Math.round(absMs / MS_PER_MINUTE)
    const hours = Math.round(absMs / 3_600_000)
    const days = absMs / 86_400_000
    const months = Math.round(days * 4800 / 146097)
    const years = Math.round(months / 12)

    let phrase: string
    if (seconds < 45) phrase = "a few seconds"
    else if (minutes <= 1) phrase = "a minute"
    else if (minutes < 45) phrase = `${minutes} minutes`
    else if (hours <= 1) phrase = "an hour"
    else if (hours < 22) phrase = `${hours} hours`
    else if (Math.round(days) <= 1) phrase = "a day"
    else if (Math.round(days) < 26) phrase = `${Math.round(days)} days`
    else if (months <= 1) phrase = "a month"
    else if (months < 11) phrase = `${months} months`
    else if (years <= 1) phrase = "a year"
    else phrase = `${years} years`

    return elapsedMs < 0 ? `in ${phrase}` : `${phrase} ago`
}
