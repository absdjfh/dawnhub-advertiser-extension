import {describe, expect, it, vi} from "vitest";
import {createPendingBookingService, type BookingFillFields, type PendingBookingStore} from "@/components/booking-intent/pending-booking";

const fields: BookingFillFields = {raidId: "raid-1", nameRealm: "Bob-Kazzak", price: "250", curveBoss: ""}

function memoryStore(): PendingBookingStore & {entries: Map<number, BookingFillFields>} {
    const entries = new Map<number, BookingFillFields>()
    return {
        entries,
        set(tabId, value) {
            entries.set(tabId, value)
            return Promise.resolve()
        },
        get: tabId => Promise.resolve(entries.get(tabId) ?? null),
        remove(tabId) {
            entries.delete(tabId)
            return Promise.resolve()
        }
    }
}

function serviceWithTabs(tabIds: (number | undefined)[]) {
    const store = memoryStore()
    const createTab = vi.fn<(url: string) => Promise<number | undefined>>(() => Promise.resolve(tabIds.shift()))
    return {store, createTab, service: createPendingBookingService({createTab, store})}
}

describe("Handing a booking over to the tab opened for it", () => {
    it("opens the raid's booking page in a new tab and keeps the fields for exactly that tab", async () => {
        const {service, createTab, store} = serviceWithTabs([42])

        await service.open("https://hub.dawn-boosting.com/bookings/raids/raid-1", fields)

        expect(createTab).toHaveBeenCalledWith("https://hub.dawn-boosting.com/bookings/raids/raid-1")
        expect([...store.entries.keys()]).toStrictEqual([42])
    })

    it("hands the fields to the tab they were left for, exactly once", async () => {
        const {service} = serviceWithTabs([42])
        await service.open("url", fields)

        expect(await service.take(42, "raid-1")).toStrictEqual(fields)
        expect(await service.take(42, "raid-1")).toBeNull()
    })

    it("never hands them to another tab, or to the tab once it shows a different raid", async () => {
        const {service} = serviceWithTabs([42])
        await service.open("url", fields)

        expect(await service.take(7, "raid-1")).toBeNull()
        expect(await service.take(42, "raid-2")).toBeNull()
        expect(await service.take(42, "raid-1")).toStrictEqual(fields)
    })

    it("forgets the fields of a tab closed before it used them, since tab ids are handed out again", async () => {
        const {service} = serviceWithTabs([42])
        await service.open("url", fields)

        await service.forget(42)

        expect(await service.take(42, "raid-1")).toBeNull()
    })

    it("fails loudly when the browser gives the new tab no id to keep the fields under", async () => {
        const {service} = serviceWithTabs([undefined])

        await expect(service.open("url", fields)).rejects.toThrow("The new tab has no id to leave the booking under.")
    })
})
