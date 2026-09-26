import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {flushPromises} from "@vue/test-utils"
import type {RaidData} from "@/components/api/dawn-api"
import {closeBookingIntentPanel, isBookingIntentPanelOpen, openBookingIntentPanel} from "@/components/ui/booking-intent-panel"
import {openBookingInNewTab} from "@/components/booking-intent/pending-booking"
import {rememberRaidsListRequest} from "@/host/dawnhub-raids-request"
import {showToast} from "@/utils/toast"

vi.mock("@/utils/toast", () => ({showToast: vi.fn()}))
vi.mock("@/components/booking-intent/pending-booking", () => ({openBookingInNewTab: vi.fn()}))

const RAIDS_LIST_URL = "https://hub.dawn-boosting.com/api/raids?dateFrom=2026-09-25%2000%3A00%3A00&dateTo=2026-09-25%2023%3A59%3A59&type=raid&region=eu"

function raid(id: string, time: string, overrides: Partial<RaidData> = {}): RaidData {
    return {
        _id: id,
        dateTime: `2026-09-25T${time}:00+02:00`,
        status: "active",
        region: "eu",
        curveSlots: [],
        type: "raid",
        loot: "saved",
        difficulty: "heroic",
        groupType: "8/8",
        instance: "1",
        buyerSlots: "20",
        booked: 5,
        instanceName: "Undermine",
        ...overrides
    }
}

const listedRaids = [
    raid("soon", "20:00"),
    raid("full", "20:30", {booked: 20}),
    raid("later", "23:30")
]

function respondWith(routes: Record<string, unknown>) {
    vi.stubGlobal("fetch", vi.fn((url: string) => {
        const route = Object.keys(routes).find(prefix => url.startsWith(prefix))
        return Promise.resolve(route
            ? {ok: true, json: () => Promise.resolve(routes[route])}
            : {ok: false, status: 404})
    }))
}

/** The raids the panel's first booking offers - its whole list, opened if it's been narrowed to one raid. */
function raidOptions() {
    const changeRaid = Array.from(document.querySelectorAll<HTMLButtonElement>(".dat-booking-entry button")).find(button => button.textContent?.trim() === "change raid")
    changeRaid?.click()
    return Array.from(document.querySelectorAll<HTMLInputElement>(".dat-raid-option input")).map(input => input.value)
}

function selectedRaid() {
    return document.querySelector<HTMLInputElement>(".dat-raid-option input:checked")?.value ?? ""
}

function clickButton(text: string) {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>(".dat-dialog button")).find(element => element.textContent?.trim() === text)
    if (!button) throw new Error(`No "${text}" button`)
    button.click()
}

function typeInto(label: string, value: string) {
    const input = Array.from(document.querySelectorAll("label")).find(element => element.textContent?.trim().startsWith(label))!.querySelector("input")!
    input.value = value
    input.dispatchEvent(new Event("input"))
}

describe("Opening the fill booking panel", () => {
    beforeEach(() => {
        vi.useFakeTimers({toFake: ["Date"]})
        vi.setSystemTime(new Date("2026-09-25T17:30:00.000Z")) // 19:30 in Berlin
        history.replaceState(null, "", "/bookings/raids?type=raid")
        respondWith({[RAIDS_LIST_URL]: listedRaids})
    })

    afterEach(() => {
        closeBookingIntentPanel()
        vi.useRealTimers()
        vi.unstubAllGlobals()
        vi.clearAllMocks()
        sessionStorage.clear()
        document.body.replaceChildren()
    })

    it("should offer the raids from the list last shown that still take a buyer and start soon", async () => {
        rememberRaidsListRequest(RAIDS_LIST_URL)

        await openBookingIntentPanel()
        await flushPromises()

        expect(fetch).toHaveBeenCalledWith(`${RAIDS_LIST_URL}&ext`)
        expect(raidOptions()).toStrictEqual(["soon"])
        expect(document.body.textContent).toContain("show all raids")
    })

    it("should ask for the raids list first when it has nothing to match against", async () => {
        await openBookingIntentPanel()

        expect(showToast).toHaveBeenCalledWith("Open Dawnhub's raids list first and wait for it to load - the DM is matched against the raids listed there.")
        expect(isBookingIntentPanelOpen()).toBe(false)
    })

    it("should say so when none of the listed raids take a buyer", async () => {
        respondWith({[RAIDS_LIST_URL]: [raid("full", "20:30", {booked: 20})]})
        rememberRaidsListRequest(RAIDS_LIST_URL)

        await openBookingIntentPanel()

        expect(showToast).toHaveBeenCalledWith("None of the raids you're looking at has a slot left to book.")
        expect(document.querySelector(".dat-dialog")).toBeNull()
    })

    it("should report a raids list that can't be loaded", async () => {
        respondWith({})
        rememberRaidsListRequest(RAIDS_LIST_URL)

        await openBookingIntentPanel()

        expect(showToast).toHaveBeenCalledWith(expect.stringContaining("Could not load Dawnhub's raids"))
        expect(isBookingIntentPanelOpen()).toBe(false)
    })

    it("should open only one panel, however many times it's asked to while opening", async () => {
        rememberRaidsListRequest(RAIDS_LIST_URL)

        await Promise.all([openBookingIntentPanel(), openBookingIntentPanel()])

        expect(document.querySelectorAll(".dat-dialog")).toHaveLength(1)
    })

    describe("on a raid's own page", () => {
        beforeEach(() => {
            history.replaceState(null, "", "/bookings/raids/linked")
        })

        it("should offer and select that raid, even one never shown on a list", async () => {
            respondWith({"https://hub.dawn-boosting.com/api/raids/linked": raid("linked", "23:45")})

            await openBookingIntentPanel()
            await flushPromises()

            expect(raidOptions()).toStrictEqual(["linked"])
            expect(selectedRaid()).toBe("linked")
        })

        it("should open the booking in a new tab and keep the panel up for the next one", async () => {
            respondWith({"https://hub.dawn-boosting.com/api/raids/linked": raid("linked", "23:45")})
            vi.mocked(openBookingInNewTab).mockResolvedValue(undefined)
            await openBookingIntentPanel()
            await flushPromises()

            typeInto("Name-Realm", "Bob-Kazzak")
            typeInto("Pot", "250")
            await flushPromises()
            clickButton("Open & fill")
            await flushPromises()

            expect(openBookingInNewTab).toHaveBeenCalledWith(
                "https://hub.dawn-boosting.com/bookings/raids/linked",
                {raidId: "linked", nameRealm: "Bob-Kazzak", price: "250", curveBoss: ""}
            )
            expect(isBookingIntentPanelOpen()).toBe(true)
            expect(document.querySelector(".dat-booking-entry")!.textContent).toContain("opened in a new tab")
        })
    })
})
