import {browser, storage} from "#imports";
import type {StorageItemKey} from "@wxt-dev/storage";

/** What the fill booking panel hands off to be filled into one booking form - read by the on-device model or
 *  typed in by hand. See fillBookingForm. */
export interface BookingFillFields {
    raidId: string
    nameRealm: string
    /** Pot, in thousands of gold - "" leaves Dawnhub's own Pot field alone. */
    price: string
    /** The boss to tick on a curve raid's booking form, as the panel's own boss checkboxes ended up ticked: one
     *  of the picked raid's boss names, "Both", or "" for a raid with no boss to choose at all. */
    curveBoss: string
}

/** The messages a content script sends the background script - see registerPendingBookings. */
type PendingBookingMessage =
    | {type: "openBookingTab", url: string, fields: BookingFillFields}
    | {type: "takePendingBooking", raidId: string}

/**
 * Opens `url` - the raid's booking page - in a new tab, with `fields` waiting there to be filled in. Every
 * booking gets a tab of its own, so one message asking for several bookings can have each of them opened and
 * filled in while the panel stays up for the rest.
 *
 * The background script does both halves: the fields are kept under the *new* tab's id, which is what the
 * content script there asks for them by, and only the caller of tabs.create ever learns that id.
 */
export async function openBookingInNewTab(url: string, fields: BookingFillFields) {
    await sendToBackground({type: "openBookingTab", url, fields})
}

/** The fields this tab was opened with, if it was opened for `raidId` - handed over once, then forgotten. */
export async function takePendingBookingFor(raidId: string): Promise<BookingFillFields | null> {
    return await sendToBackground<BookingFillFields | null>({type: "takePendingBooking", raidId}) ?? null
}

async function sendToBackground<T = void>(message: PendingBookingMessage): Promise<T | undefined> {
    const reply = await browser.runtime.sendMessage<PendingBookingMessage, {result?: T, error?: string} | undefined>(message)
    if (reply?.error) throw new Error(reply.error)
    return reply?.result
}

export interface PendingBookingStore {
    set(tabId: number, fields: BookingFillFields): Promise<void>
    get(tabId: number): Promise<BookingFillFields | null>
    remove(tabId: number): Promise<void>
}

/**
 * The extension's own session storage, keyed by tab: kept in memory by the browser only, never written to
 * disk, and never visible to the Dawnhub page - unlike the page's own sessionStorage, which a new tab doesn't
 * get a copy of anyway.
 */
export function createSessionPendingBookingStore(): PendingBookingStore {
    const key = (tabId: number) => `session:pendingBooking-${tabId}` as StorageItemKey
    return {
        set: (tabId, fields) => storage.setItem(key(tabId), fields),
        get: tabId => storage.getItem<BookingFillFields>(key(tabId)),
        remove: tabId => storage.removeItem(key(tabId))
    }
}

/** The background side of the handoff, with the browser APIs it needs passed in - see registerPendingBookings. */
export function createPendingBookingService(deps: {createTab: (url: string) => Promise<number | undefined>, store: PendingBookingStore}) {
    return {
        async open(url: string, fields: BookingFillFields) {
            const tabId = await deps.createTab(url)
            if (typeof tabId !== "number") throw new Error("The new tab has no id to leave the booking under.")
            // Written after the tab exists because its id is the key. Storing takes a moment next to loading
            // the page, so the entry is always there well before that page's booking form asks for it.
            await deps.store.set(tabId, fields)
        },
        /** Only ever hands the fields to the tab they were left for, and only for the raid it was opened on - a
         *  stale entry must never fill a form the advertiser didn't ask for. */
        async take(tabId: number, raidId: string): Promise<BookingFillFields | null> {
            const fields = await deps.store.get(tabId)
            if (fields?.raidId !== raidId) return null
            await deps.store.remove(tabId)
            return fields
        },
        /** A booking tab closed before its form loaded leaves its entry behind, and tab ids are reused. */
        forget: (tabId: number) => deps.store.remove(tabId)
    }
}

/** Wires the handoff into the background script: opening booking tabs, handing their fields over, and clearing
 *  up after tabs that close before using them. */
export function registerPendingBookings() {
    const service = createPendingBookingService({
        createTab: async url => (await browser.tabs.create({url})).id,
        store: createSessionPendingBookingStore()
    })
    browser.runtime.onMessage.addListener((message: PendingBookingMessage, sender, sendResponse) => {
        let handled: Promise<unknown>
        if (message?.type === "openBookingTab") {
            handled = service.open(message.url, message.fields)
        } else if (message?.type === "takePendingBooking") {
            const tabId = sender.tab?.id
            handled = typeof tabId === "number" ? service.take(tabId, message.raidId) : Promise.resolve(null)
        } else {
            return false
        }
        // sendResponse rather than a returned promise: Chrome only waits for a reply sent this way.
        handled.then(
            result => sendResponse({result}),
            (error: unknown) => sendResponse({error: error instanceof Error ? error.message : String(error)})
        )
        return true
    })
    browser.tabs.onRemoved.addListener(tabId => void service.forget(tabId))
}
