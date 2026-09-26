import {defineBackground} from "#imports";
import {registerPendingBookings} from "@/components/booking-intent/pending-booking";

/**
 * Only what a content script can't do itself: opening a booking in a new tab with its fields waiting for it,
 * which needs the new tab's id - see pending-booking.ts.
 */
export default defineBackground(() => {
    registerPendingBookings()
})
