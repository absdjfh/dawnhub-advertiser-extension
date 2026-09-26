import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {renderToolbar} from "@/components/ui/toolbar"
import type {RaidData} from "@/components/api/dawn-api"

vi.mock("@/utils/report-error", () => ({reportError: vi.fn()}))

const raidWithBookings = {
    _id: "raid-1",
    dateTime: "2026-08-01T10:08:00.000Z",
    instanceName: "Undermine",
    difficulty: "heroic",
    groupType: "8/8",
    bookings: [{
        _id: "booking-1",
        nameRealm: "Alice-Argent-Dawn",
        advertiserName: "Seller",
        class: "demonhunter",
        pot: "150",
        deposit: 25,
        paid: "yes",
        source: "tc"
    }]
} as RaidData
const raidWithoutBookings = {...raidWithBookings, _id: "raid-2", bookings: undefined} as RaidData

function openSearch() {
    const toolbarSlot = document.createElement("div")
    document.body.appendChild(toolbarSlot)
    renderToolbar(toolbarSlot, {withBookingSearch: true})
    Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Find a buyer")!.click()
}

function search(term: string) {
    const input = document.querySelector<HTMLInputElement>(".dat-search-input")!
    input.value = term
    input.dispatchEvent(new InputEvent("input"))
}

function searchStatus() {
    return document.querySelector(".dat-search-status")?.textContent
}

describe("Find a buyer", () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <label for="start-date">Start Date</label>
            <input id="start-date" value="01/08/2026">
            <label for="end-date">End Date</label>
            <input id="end-date" value="02/08/2026">
        `
        vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve({
            ok: true,
            json: () => Promise.resolve(url.includes("/api/raids?") ? [raidWithBookings] : raidWithBookings)
        })))
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.clearAllMocks()
        document.body.replaceChildren()
    })

    it("should search the dates shown on the page for a partial name-realm and link the raid it's booked in", async () => {
        openSearch()
        await vi.waitFor(() => expect(searchStatus()).toBe("Loaded 1 raids. Type to search."))

        expect(fetch).toHaveBeenCalledWith("https://hub.dawn-boosting.com/api/raids?dateFrom=2026-08-01%2000%3A00%3A00&dateTo=2026-08-02%2023%3A59%3A59&type=raid&region=eu&nolog=true")
        search("alice-arg")

        await vi.waitFor(() => expect(searchStatus()).toBe("Found 1 bookings."))
        const link = document.querySelector<HTMLAnchorElement>(".dat-search-link")!
        expect(link.getAttribute("href")).toBe("https://hub.dawn-boosting.com/bookings/raids/raid-1")
        expect(link.getAttribute("target")).toBe("_blank")
        expect(link.textContent).toBe("10:08 - Undermine - Heroic - 8/8")
        expect(document.querySelector(".dat-search-meta")?.textContent).toBe("Alice-Argent-Dawn - Seller - Demon Hunter - pot 150k - deposit 25k - paid: Yes - source TC")
    })

    it("should complete a raid the list returned without bookings from its own details", async () => {
        vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve({
            ok: true,
            json: () => Promise.resolve(url.includes("/api/raids?") ? [raidWithoutBookings] : {...raidWithBookings, _id: "raid-2"})
        })))
        openSearch()
        await vi.waitFor(() => expect(searchStatus()).toBe("Loaded 1 raids. Type to search."))

        search("alice")

        await vi.waitFor(() => expect(searchStatus()).toBe("Found 1 bookings."))
        expect(fetch).toHaveBeenCalledWith("https://hub.dawn-boosting.com/api/raids/raid-2?nolog=true")
    })

    it("should say when nobody matches", async () => {
        openSearch()
        await vi.waitFor(() => expect(searchStatus()).toBe("Loaded 1 raids. Type to search."))

        search("nobody")

        await vi.waitFor(() => expect(searchStatus()).toBe("No matches found."))
        expect(document.querySelector(".dat-search-result")).toBeNull()
    })

    it("should say so when the page shows no date range to search", async () => {
        document.body.replaceChildren()
        openSearch()

        await vi.waitFor(() => expect(searchStatus()).toBe("Unable to find the date range on the page."))
        expect(fetch).not.toHaveBeenCalled()
    })

    it("should say so when the raids can't be loaded", async () => {
        vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ok: false, status: 500})))
        openSearch()

        await vi.waitFor(() => expect(searchStatus()).toBe("Failed to load raid data. Try again."))
    })

    it("should open just one popup however often it's clicked, and close on Close or Escape", async () => {
        openSearch()
        Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "Find a buyer")!.click()
        expect(document.querySelectorAll(".dat-search-popup")).toHaveLength(1)

        Array.from(document.querySelectorAll<HTMLButtonElement>(".dat-search-action")).find(button => button.textContent === "Close")!.click()
        await vi.waitFor(() => expect(document.querySelector(".dat-search-popup")).toBeNull())

        openSearch()
        document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}))
        await vi.waitFor(() => expect(document.querySelector(".dat-search-popup")).toBeNull())
    })
})
