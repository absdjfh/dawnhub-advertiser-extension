import {BASE_URL} from "@/utils/constants";
import type {LootType, RaidDifficulty} from "@/components/wow-classes";

export interface BookingData {
    _id: string
    dateTime: string
    nameRealm: string
    source: "tc" | "br" | "id"
    class: string
    pot: string
    deposit: number
    paid: string
    advertiser: string
    advertiserName?: string
}

export interface RaidData {
    _id: string
    dateTime: string
    status: string
    region: string
    /** A curve raid's total buyer slots per boss, rather than the single {@link buyerSlots} count VIP and regular raids use. */
    curveSlots: { name: string, slots: string }[]
    type: string
    loot: LootType
    difficulty: RaidDifficulty
    groupType: string
    instance: string
    /** Only returned for a raid's own details, and only when Dawnhub shows the viewer its bookings. */
    bookings?: BookingData[]
    buyerSlots: string
    /** A single count for VIP and regular raids; a curve raid reports it per boss name instead, against {@link curveSlots}. */
    booked: number | Record<string, number>
    bookedClasses?: string[]
    raidShortName?: string
    instanceName: string
}

/**
 * Loads a raids list with the same query Dawnhub itself just used (see host/dawnhub-raids-request.ts), so the
 * result lines up with the table on screen row for row. The trailing `ext` tells this extension's request
 * apart from Dawnhub's own when both show up in the page's network activity.
 */
export async function fetchRaidsList(dawnhubRequestUrl: string): Promise<RaidData[]> {
    return fetch(`${dawnhubRequestUrl}&ext`)
        .then(checkStatus)
        .then(response => response.json() as Promise<RaidData[]>)
}

/**
 * Loads raids in a date range - the booking search's query, for a range Dawnhub itself hasn't necessarily loaded.
 * @param params - dates as Dawnhub's own raids request writes them, "YYYY-MM-DD HH:mm:ss"
 */
export async function fetchRaidsInRange(params: {dateFrom: string, dateTo: string, type: string, region: string}): Promise<RaidData[]> {
    // Spaces encoded as %20, not URLSearchParams' +, the way Dawnhub's own requests send them.
    const query = Object.entries({...params, nolog: "true"})
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join("&")
    return fetch(`${BASE_URL}/api/raids?${query}`)
        .then(checkStatus)
        .then(response => response.json() as Promise<RaidData[]>)
}

/**
 * Retrieves full raid details (e.g. bookings) for one raid
 * @param raidId - {@link RaidData._id}
 */
export async function getRaidDetails(raidId: string): Promise<RaidData> {
    return fetch(`${BASE_URL}/api/raids/${raidId}?nolog=true`)
        .then(checkStatus)
        .then(response => response.json() as Promise<RaidData>)
}

function checkStatus(response: Response): Response {
    if (!response.ok) throw Error("Request failed with status code " + response.status)
    return response
}
