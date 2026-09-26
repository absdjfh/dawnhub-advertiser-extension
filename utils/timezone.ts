const DAWN_TIMEZONE = "Europe/Berlin";
const DAWN_UTC_REGEX =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?Z$/;

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const values: Record<string, string> = {};
    for (const part of parts) {
        if (part.type !== "literal") {
            values[part.type] = part.value;
        }
    }
    const asUtc = Date.UTC(
        Number(values.year),
        Number(values.month) - 1,
        Number(values.day),
        Number(values.hour),
        Number(values.minute),
        Number(values.second)
    );
    return (asUtc - date.getTime()) / 60000;
}

function getOffsetMinutesForLocalTime(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
    millisecond: number,
    timeZone: string
): number {
    const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
    let offset = getTimeZoneOffsetMinutes(utcDate, timeZone);
    const adjusted = new Date(utcDate.getTime() - offset * 60000);
    const adjustedOffset = getTimeZoneOffsetMinutes(adjusted, timeZone);
    if (adjustedOffset !== offset) {
        offset = adjustedOffset;
    }
    return offset;
}

function formatOffset(offsetMinutes: number): string {
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const absMinutes = Math.abs(offsetMinutes);
    const hours = String(Math.floor(absMinutes / 60)).padStart(2, "0");
    const minutes = String(absMinutes % 60).padStart(2, "0");
    return `${sign}${hours}:${minutes}`;
}

export function normalizeDawnDateTime(value: string): string {
    if (!value.endsWith("Z")) {
        return value;
    }
    const match = DAWN_UTC_REGEX.exec(value);
    if (!match) {
        return value;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6] ?? 0);
    const millisecond = Number((match[7] ?? "0").padEnd(3, "0"));
    const offsetMinutes = getOffsetMinutesForLocalTime(
        year,
        month,
        day,
        hour,
        minute,
        second,
        millisecond,
        DAWN_TIMEZONE
    );
    return value.replace(/Z$/, formatOffset(offsetMinutes));
}

export function parseDawnDateTime(value: string): Date {
    return new Date(normalizeDawnDateTime(value));
}
