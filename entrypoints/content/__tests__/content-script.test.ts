import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ContentScriptContext, fakeBrowser} from "#imports";
import type {RaidData} from "@/components/api/dawn-api";
import {openSlotsFilterStore} from "@/components/ui/open-slots-filter";
import {closeBookingIntentPanel} from "@/components/ui/booking-intent-panel";
import {takePendingBookingFor} from "@/components/booking-intent/pending-booking";

// The background script's half of the handoff is tested on its own (pending-booking.test.ts); here the booking
// page just asks it for the fields its tab was opened with.
vi.mock("@/components/booking-intent/pending-booking", () => ({
    takePendingBookingFor: vi.fn(() => Promise.resolve(null)),
    openBookingInNewTab: vi.fn()
}))
import contentScript from "@/entrypoints/content/index";
import raidsTableHtml from "@/host/__tests__/fixtures/dawnhub-raids-table.html?raw"

const LIST_URL = "https://hub.dawn-boosting.com/api/raids?dateFrom=2026-08-01%2000%3A00%3A00&dateTo=2026-08-01%2023%3A59%3A59&type=raid&region=eu"

/** The list behind the fixture's five rows, in Dawnhub's order - rows 2 and 3 are full. */
const raids = [
    {_id: "r0", dateTime: "2026-08-01T10:00:00.000Z", status: "active", loot: "vip", booked: 1, buyerSlots: "4", instanceName: "Undermine"},
    {_id: "r1", dateTime: "2026-08-01T10:15:00.000Z", status: "active", loot: "unsaved", booked: 1, buyerSlots: "10", instanceName: "Undermine"},
    {_id: "r2", dateTime: "2026-08-01T10:30:00.000Z", status: "active", loot: "vip", booked: 4, buyerSlots: "4", instanceName: "Undermine"},
    {_id: "r3", dateTime: "2026-08-01T10:45:00.000Z", status: "active", loot: "unsaved", booked: 10, buyerSlots: "10", instanceName: "Undermine"},
    {_id: "r4", dateTime: "2026-08-01T11:00:00.000Z", status: "active", loot: "vip", booked: 2, buyerSlots: "10", instanceName: "Undermine"}
] as RaidData[]

class FakePerformanceObserver {
    static latest: FakePerformanceObserver | null = null

    constructor(private readonly callback: (list: {getEntries(): {name: string}[]}) => void) {
        FakePerformanceObserver.latest = this
    }

    observe() {
        // Entries are delivered by the test, the way the browser reports Dawnhub's requests.
    }

    disconnect() {
        // Nothing to release.
    }

    /** Dawnhub finished loading a raids list. */
    deliver(url: string) {
        this.callback({getEntries: () => [{name: url}]})
    }
}

let ctx: ContentScriptContext

async function startContentScript() {
    ctx = new ContentScriptContext("content")
    await contentScript.main(ctx)
}

function rows() {
    return Array.from(document.querySelectorAll<HTMLTableRowElement>("table[role='grid'] > tbody > tr"))
}

function hiddenRows() {
    return rows().map(row => row.hasAttribute("data-dat-raid-hidden"))
}

function raidLinks() {
    return Array.from(document.querySelectorAll<HTMLAnchorElement>("a[data-dat-raid-link]")).map(link => link.getAttribute("href"))
}

function fillButton() {
    return document.querySelector<HTMLButtonElement>(".dat-fill-button")
}

function openSlotsTick() {
    return document.querySelector<HTMLInputElement>(".dat-open-slots-filter input")
}

describe("Content script on Dawnhub's raids list", () => {
    beforeEach(() => {
        fakeBrowser.reset()
        history.replaceState(null, "", "/bookings/raids?type=raid")
        document.body.innerHTML = raidsTableHtml
        vi.stubGlobal("PerformanceObserver", FakePerformanceObserver)
        vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(url === `${LIST_URL}&ext`
            ? {ok: true, json: () => Promise.resolve(raids)}
            : {ok: false, status: 404})))
    })

    afterEach(() => {
        ctx.notifyInvalidated()
        closeBookingIntentPanel()
        vi.unstubAllGlobals()
        sessionStorage.clear()
        document.body.replaceChildren()
    })

    it("should add the fill booking button and the buyer search to Dawnhub's toolbar", async () => {
        await startContentScript()

        await vi.waitFor(() => expect(fillButton()).not.toBeNull())
        expect(fillButton()!.textContent).toBe("Fill booking from DMCtrl V")
        expect(fillButton()!.getAttribute("aria-keyshortcuts")).toBe("Control+V")
        expect(document.querySelector("div[role='toolbar'] .dat-secondary-button")?.textContent).toBe("Find a buyer")
    })

    it("should reload the list Dawnhub loaded, link each raid's time to its page, and remember the list for the tab", async () => {
        await startContentScript()

        FakePerformanceObserver.latest!.deliver(LIST_URL)

        await vi.waitFor(() => expect(raidLinks()).toHaveLength(5))
        expect(fetch).toHaveBeenCalledWith(`${LIST_URL}&ext`)
        expect(raidLinks()[2]).toBe("https://hub.dawn-boosting.com/bookings/raids/r2")
        expect(sessionStorage.getItem("dawnhubAdvertiserTools:raidsListRequest")).toBe(LIST_URL)
    })

    it("should hide full raids while the slots available tick is on, and remember the tick", async () => {
        await startContentScript()
        FakePerformanceObserver.latest!.deliver(LIST_URL)
        await vi.waitFor(() => expect(raidLinks()).toHaveLength(5))
        // The tick joins Dawnhub's own VIP armor filter rather than the toolbar.
        expect(openSlotsTick()?.closest(".MuiStack-root")).not.toBeNull()

        openSlotsTick()!.click()

        await vi.waitFor(() => expect(hiddenRows()).toStrictEqual([false, false, true, true, false]))
        await vi.waitFor(async () => expect(await openSlotsFilterStore.getValue()).toBe(true))

        openSlotsTick()!.click()
        expect(hiddenRows()).toStrictEqual([false, false, false, false, false])
    })

    it("should start with full raids hidden when the tick was left on", async () => {
        await openSlotsFilterStore.setValue(true)
        await startContentScript()

        FakePerformanceObserver.latest!.deliver(LIST_URL)

        await vi.waitFor(() => expect(hiddenRows()).toStrictEqual([false, false, true, true, false]))
        expect(openSlotsTick()!.checked).toBe(true)
    })

    it("should open the fill booking panel for a screenshot pasted anywhere on the page", async () => {
        await startContentScript()
        FakePerformanceObserver.latest!.deliver(LIST_URL)
        await vi.waitFor(() => expect(raidLinks()).toHaveLength(5))

        const clipboardData = new DataTransfer()
        clipboardData.items.add(new File(["png"], "dm.png", {type: "image/png"}))
        const paste = new ClipboardEvent("paste", {clipboardData, bubbles: true, cancelable: true})
        document.body.dispatchEvent(paste)

        await vi.waitFor(() => expect(document.querySelector(".dat-dialog")).not.toBeNull())
        expect(paste.defaultPrevented).toBe(true)
    })

    it("should leave a text paste to whatever it was pasted into", async () => {
        await startContentScript()

        const clipboardData = new DataTransfer()
        clipboardData.setData("text/plain", "Undermine")
        const paste = new ClipboardEvent("paste", {clipboardData, bubbles: true, cancelable: true})
        document.body.dispatchEvent(paste)
        await new Promise(resolve => setTimeout(resolve, 20))

        expect(paste.defaultPrevented).toBe(false)
        expect(document.querySelector(".dat-dialog")).toBeNull()
    })

    it("should take its toolbar off for good once the extension is reloaded or updated", async () => {
        await startContentScript()
        await vi.waitFor(() => expect(fillButton()).not.toBeNull())

        ctx.notifyInvalidated()
        // Dawnhub re-rendering its toolbar slot must not bring back a toolbar from the old script.
        const toolbarSlot = document.querySelector("div[role='toolbar'] > div")!
        toolbarSlot.replaceWith(document.createElement("div"))
        await new Promise(resolve => setTimeout(resolve, 50))

        expect(fillButton()).toBeNull()
    })

    it("should fill the booking the panel left for the raid it opened, and search for the character", async () => {
        history.replaceState(null, "", "/bookings/raids/r2")
        vi.mocked(takePendingBookingFor).mockImplementation(raidId => Promise.resolve(raidId === "r2" ? {raidId: "r2", nameRealm: "Bob-Kazzak", price: "250", curveBoss: ""} : null))
        document.body.innerHTML = `
            <div role="toolbar"><div></div></div>
            <form><input id="nameRealm"><button type="button" aria-label="search">search</button><input id="pot"><input id="privateNote"></form>`
        const searched = vi.fn()
        document.querySelector("button[aria-label='search']")!.addEventListener("click", searched)

        await startContentScript()

        await vi.waitFor(() => expect(searched).toHaveBeenCalledOnce())
        expect(document.querySelector<HTMLInputElement>("#nameRealm")!.value).toBe("Bob-Kazzak")
        expect(document.querySelector<HTMLInputElement>("#pot")!.value).toBe("250")
        expect(document.querySelector<HTMLInputElement>("#privateNote")!.value).toBe("")
        expect(document.body.textContent).toContain("Booking filled in - check it over, then submit it.")
        // The raid's own page gets the fill button too, but no raids-list tick.
        expect(fillButton()).not.toBeNull()
        expect(openSlotsTick()).toBeNull()
    })

    it("should not bring its toolbar back when Dawnhub navigates after the extension was updated", async () => {
        await startContentScript()
        await vi.waitFor(() => expect(fillButton()).not.toBeNull())
        ctx.notifyInvalidated()
        await vi.waitFor(() => expect(fillButton()).toBeNull())

        // Dawnhub navigating within the page; WXT notices within a second, then the toolbar remount waits 500ms.
        history.pushState(null, "", "/bookings/raids?type=curve")
        await new Promise(resolve => setTimeout(resolve, 1800))

        expect(fillButton()).toBeNull()
    })
})
