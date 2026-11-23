import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {ContentScriptContext, fakeBrowser} from "#imports";
import type {RaidData} from "@/components/api/dawn-api";
import {openSlotsFilterStore} from "@/components/ui/open-slots-filter";
import {raidLocksStore} from "@/utils/raid-delays";
import contentScript from "@/entrypoints/content/index";
import raidsTableHtml from "@/host/__tests__/fixtures/dawnhub-raids-table.html?raw"

const LIST_URL = "https://hub.dawn-boosting.com/api/raids?dateFrom=2026-08-01%2000%3A00%3A00&dateTo=2026-08-01%2023%3A59%3A59&type=raid&region=eu"

/** The list behind the fixture's five rows, in Dawnhub's order - rows 2 and 3 are full. */
const raids = [
    {_id: "r0", dateTime: "2026-08-01T10:00:00.000Z", status: "active", squadLeader: "leader-0", loot: "vip", booked: 1, buyerSlots: "4", instanceName: "Undermine"},
    {_id: "r1", dateTime: "2026-08-01T10:15:00.000Z", status: "active", squadLeader: "leader-1", loot: "unsaved", booked: 1, buyerSlots: "10", instanceName: "Undermine"},
    {_id: "r2", dateTime: "2026-08-01T10:30:00.000Z", status: "active", squadLeader: "leader-2", loot: "vip", booked: 4, buyerSlots: "4", instanceName: "Undermine"},
    {_id: "r3", dateTime: "2026-08-01T10:45:00.000Z", status: "active", squadLeader: "leader-3", loot: "unsaved", booked: 10, buyerSlots: "10", instanceName: "Undermine"},
    {_id: "r4", dateTime: "2026-08-01T11:00:00.000Z", status: "active", squadLeader: "leader-4", loot: "vip", booked: 2, buyerSlots: "10", instanceName: "Undermine"}
] as RaidData[]

/** A Dawn wall clock time on the day the fixture's raids are on, as an instant. */
function dawnTime(time: string) {
    return Date.parse(`2026-08-01T${time}:00+02:00`)
}

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

/** Every likely start shown on the table, with what its estimate goes by. */
function delayMarks() {
    return Array.from(document.querySelectorAll<HTMLElement>("[data-dat-raid-delay]")).map(mark => [mark.textContent, mark.title])
}

function respondWithRaids(list: RaidData[]) {
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(url === `${LIST_URL}&ext`
        ? {ok: true, json: () => Promise.resolve(list)}
        : {ok: false, status: 404})))
}

function buyerSearchButton() {
    return document.querySelector<HTMLButtonElement>(".dat-toolbar .dat-secondary-button")
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
        respondWithRaids(raids)
    })

    afterEach(() => {
        ctx.notifyInvalidated()
        vi.useRealTimers()
        vi.unstubAllGlobals()
        document.body.replaceChildren()
    })

    it("should add the buyer search to Dawnhub's toolbar", async () => {
        await startContentScript()

        await vi.waitFor(() => expect(buyerSearchButton()?.textContent).toBe("Find a buyer"))
        expect(document.querySelector(".dat-toolbar")!.textContent).not.toContain("Fill booking")
    })

    it("should reload the list Dawnhub loaded and link each raid's time to its page", async () => {
        await startContentScript()

        FakePerformanceObserver.latest!.deliver(LIST_URL)

        await vi.waitFor(() => expect(raidLinks()).toHaveLength(5))
        expect(fetch).toHaveBeenCalledWith(`${LIST_URL}&ext`)
        expect(raidLinks()[2]).toBe("https://hub.dawn-boosting.com/bookings/raids/r2")
    })

    it("should mark a raid's likely start when its leader's raid before it locked late", async () => {
        vi.useFakeTimers({toFake: ["Date"]})
        vi.setSystemTime(new Date("2026-08-01T08:20:00.000Z")) // 10:20 in Dawn time
        // A raid of the 10:15 raid's leader that locked 20 minutes late, timed on a list this one doesn't hold.
        await raidLocksStore.setValue([{raidId: "earlier", squadLeader: "leader-1", plannedAt: dawnTime("09:30"), lockedAt: dawnTime("09:50")}])
        await startContentScript()

        FakePerformanceObserver.latest!.deliver(LIST_URL)
        // Only Date is faked here, so the wait itself runs on real timers.
        await new Promise(resolve => setTimeout(resolve, 20))

        expect(delayMarks()).toStrictEqual([["~10:35", "09:30 run locked 20 min late"]])
        // Beside the raid link, outside the Dawnhub content that link mirrors, so the link still shows the listed start.
        const timeCell = document.querySelector<HTMLElement>("[data-dat-raid-delay]")!.closest("td")!
        expect(timeCell.querySelector("[data-dat-raid-delay]")!.previousElementSibling).toBe(timeCell.querySelector("a[data-dat-raid-link]"))
        expect(timeCell.querySelector("a[data-dat-raid-link]")!.textContent).toBe("10:15")
    })

    it("should time a raid's lock between the refreshes of the list that showed it change", async () => {
        const beforeFirstLoad = Date.now()
        await startContentScript()
        FakePerformanceObserver.latest!.deliver(LIST_URL)
        await vi.waitFor(() => expect(raidLinks()).toHaveLength(5))

        // Dawnhub refreshes its list itself; this refresh shows the 10:00 raid locked.
        respondWithRaids(raids.map(raid => raid._id === "r0" ? {...raid, status: "locked"} : raid))
        FakePerformanceObserver.latest!.deliver(LIST_URL)

        await vi.waitFor(async () => expect(await raidLocksStore.getValue()).toHaveLength(1))
        const [lock] = await raidLocksStore.getValue()
        expect(lock).toMatchObject({raidId: "r0", squadLeader: "leader-0", plannedAt: dawnTime("10:00")})
        expect(lock!.lockedAt).toBeGreaterThanOrEqual(beforeFirstLoad)
        expect(lock!.lockedAt).toBeLessThanOrEqual(Date.now())
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

    it.each(["/bookings/raids", "/bookings/raids/r2"])("should leave screenshot and text pastes to Dawnhub on %s", async path => {
        history.replaceState(null, "", path)
        const isBookingPage = path.endsWith("/r2")
        if (isBookingPage) {
            document.body.innerHTML = '<div role="toolbar"><div></div></div><form><input id="nameRealm"><input id="pot"></form>'
        }
        await startContentScript()
        if (!isBookingPage) {
            FakePerformanceObserver.latest!.deliver(LIST_URL)
            await vi.waitFor(() => expect(raidLinks()).toHaveLength(5))
        }

        const input = document.querySelector<HTMLInputElement>(isBookingPage ? "#nameRealm" : "#start-date")!
        const initialValue = input.value
        const screenshot = new DataTransfer()
        screenshot.items.add(new File(["png"], "dm.png", {type: "image/png"}))
        const message = new DataTransfer()
        message.setData("text/plain", "Bob-Kazzak for the 11:00 raid")
        for (const [target, clipboardData] of [[document.body, screenshot], [input, message]] as const) {
            const paste = new ClipboardEvent("paste", {clipboardData, bubbles: true, cancelable: true})
            target.dispatchEvent(paste)
            expect(paste.defaultPrevented).toBe(false)
        }

        expect(input.value).toBe(initialValue)
        expect(location.pathname).toBe(path)
        expect(document.querySelector("[role=dialog]")).toBeNull()
        if (isBookingPage) {
            expect(document.querySelector(".dat-toolbar")).toBeNull()
            expect(document.querySelector<HTMLInputElement>("#pot")!.value).toBe("")
        }
    })

    it("should take its toolbar off for good once the extension is reloaded or updated", async () => {
        await startContentScript()
        await vi.waitFor(() => expect(buyerSearchButton()).not.toBeNull())

        ctx.notifyInvalidated()
        // Dawnhub re-rendering its toolbar slot must not bring back a toolbar from the old script.
        const toolbarSlot = document.querySelector("div[role='toolbar'] > div")!
        toolbarSlot.replaceWith(document.createElement("div"))
        await new Promise(resolve => setTimeout(resolve, 50))

        expect(buyerSearchButton()).toBeNull()
    })

    it("should not bring its toolbar back when Dawnhub navigates after the extension was updated", async () => {
        await startContentScript()
        await vi.waitFor(() => expect(buyerSearchButton()).not.toBeNull())
        ctx.notifyInvalidated()
        await vi.waitFor(() => expect(buyerSearchButton()).toBeNull())

        // Dawnhub navigating within the page; WXT notices within a second, then the toolbar remount waits 500ms.
        history.pushState(null, "", "/bookings/raids?type=curve")
        await new Promise(resolve => setTimeout(resolve, 1800))

        expect(buyerSearchButton()).toBeNull()
    })
})
