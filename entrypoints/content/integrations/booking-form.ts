import {createIntegratedUi} from "#imports";
import {fillBookingForm} from "@/components/booking-intent/booking-form";
import {takePendingBookingFor} from "@/components/booking-intent/pending-booking";
import {getCurrentRaidIdFromUrl, getDawnhubForm} from "@/host/dawnhub-page";
import {dawnhubBookingFormFields} from "@/host/dawnhub-booking-form";
import {reportError} from "@/utils/report-error";
import {showToast} from "@/utils/toast";
import type {DawnhubContentContext, Integration} from "@/entrypoints/content/integrations/types";

/**
 * Picks up the fields the fill booking panel left for this tab when it opened it (see openBookingInNewTab),
 * as soon as the booking form shows up. Anchored to the form's Pot field rather than to any form: a raid's
 * page can render another form first (e.g. its announcement), and only this one is the booking form.
 */
export function mountBookingFormIntegration(ctx: DawnhubContentContext): Integration {
    const bookingForm = createIntegratedUi(ctx, {
        position: "inline",
        anchor: dawnhubBookingFormFields.pot,
        append: () => {
            // The form is filled in place.
        },
        // WXT hands onMount its own (here unattached) wrapper, not the anchor, so the form is looked up instead.
        onMount: () => {
            const form = getDawnhubForm()
            if (form) void applyPendingBooking(form)
        }
    })
    bookingForm.autoMount()
    return {stop: () => bookingForm.remove()}
}

async function applyPendingBooking(form: HTMLFormElement) {
    const raidId = getCurrentRaidIdFromUrl()
    if (!raidId) return
    try {
        const fields = await takePendingBookingFor(raidId)
        if (!fields) return
        const outcome = await fillBookingForm(form, fields)
        showToast(outcome === "filled"
            ? "Booking filled in - check it over, then submit it."
            : "Booking filled in, but Dawnhub's character search didn't respond - look the character up yourself, then submit.",
        outcome === "filled" ? "success" : "error")
    } catch (error) {
        reportError("Could not fill the booking", error, {toast: true})
    }
}
