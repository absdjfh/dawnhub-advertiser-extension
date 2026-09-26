import type {BookingIntentBooking} from "@/components/booking-intent/booking-intent";

/**
 * One booking the fill booking panel is collecting, as its own set of fields (see BookingIntentEntry.vue). A
 * pasted message regularly asks for more than one - two characters of the same buyer, or one of theirs and one
 * of a friend's - and each of them is checked, corrected and opened on its own, so the panel keeps a list of
 * these rather than a single set of fields.
 */
export interface BookingEntry {
    /** Identity for the panel's list: entries are added and removed around each other, and two of them can hold
     *  exactly the same fields, so nothing about the booking itself can key the list. */
    key: number
    raidId: string
    /** Set once the advertiser picks a raid themselves, so a message read afterwards leaves their choice alone.
     *  The raid a booking starts on (the one whose page is open) is only a default, and a match replaces it. */
    raidPickedByHand: boolean
    nameRealm: string
    /** Pot, in thousands of gold - "" leaves Dawnhub's own Pot field alone. */
    price: string
    /** Which curve boss the message asked for this character, kept as the model answered it rather than as one
     *  of a particular raid's bosses - the raid can still be changed by hand afterwards, so it's only resolved
     *  against that raid's own bosses (see resolveCurveBoss). "" when nothing was read, or nothing named one. */
    mentionedCurveBoss: string
    /** Which of the picked raid's bosses are ticked right now - what's ticked on the booking form. */
    checkedCurveBosses: string[]
    /** Set once the advertiser ticks a box themselves, so a message read afterwards leaves their choice alone.
     *  Reset whenever the picked raid changes, since the boxes then stand for a different raid's bosses. */
    curveBossesPickedByHand: boolean
    /** Whether this booking's own tab has been opened already - shown so that going through several bookings
     *  one after the other makes it plain which of them are still left. */
    opened: boolean
    /** Why this booking can't be opened yet, "" while there's nothing to say. */
    error: string
}

let nextKey = 0

/** A blank booking, starting on `raidId` - the raid whose page is open, or "" for none. */
export function createBookingEntry(raidId: string): BookingEntry {
    nextKey += 1
    return {
        key: nextKey,
        raidId,
        raidPickedByHand: false,
        nameRealm: "",
        price: "",
        mentionedCurveBoss: "",
        checkedCurveBosses: [],
        curveBossesPickedByHand: false,
        opened: false,
        error: ""
    }
}

/**
 * Fills what was read for one booking into an entry, leaving anything already filled in by hand alone - the
 * on-device model can be slow (or unavailable), so the advertiser is free to type into an entry while it's still
 * reading, and what they typed always wins. The boss is stored as read either way, and BookingIntentEntry.vue
 * decides whether that still moves the ticks (curveBossesPickedByHand).
 */
export function fillBookingEntry(entry: BookingEntry, booking: BookingIntentBooking) {
    entry.mentionedCurveBoss = booking.mentionedCurveBoss
    if (!entry.raidPickedByHand && booking.raidId) entry.raidId = booking.raidId
    if (!entry.nameRealm) entry.nameRealm = booking.nameRealm
    if (!entry.price) entry.price = booking.price
}
