import {getImageFromClipboard} from "@/components/booking-intent/booking-intent";
import {checkPromptApiAvailability, getOrCreateSession} from "@/components/booking-intent/prompt-api";
import {isBookingIntentPanelOpen, openBookingIntentPanel} from "@/components/ui/booking-intent-panel";
import {isBookingView, isRaidsView} from "@/host/dawnhub-page";
import type {DawnhubContentContext, Integration} from "@/entrypoints/content/integrations/types";

/**
 * Wires the page-wide paste trigger for "fill booking from a DM" (the toolbar button is the other trigger,
 * and opens the same panel), on the two pages the toolbar button is on.
 *
 * Deliberately image-only: an image pasted somewhere on the page is unambiguous (nothing else on Dawnhub
 * wants one), but plain text is pasted into all sorts of fields constantly - a filter box, a booking field,
 * anywhere. Listening for text paste here too would risk hijacking one of those. The panel itself still
 * accepts pasted text, but only once it's open, which the advertiser did on purpose.
 */
export function mountPasteTrigger(ctx: DawnhubContentContext): Integration {
    let stopped = false

    // Warms up the session eagerly so the first paste doesn't have to wait for it - session creation is the
    // slow part, not the per-DM prompt. Only when the model is already on the device: creating a session for
    // one that still has to be downloaded needs a click or keypress to have just happened, and would fail here.
    void checkPromptApiAvailability().then(availability => {
        if (availability === "available") return getOrCreateSession()
    }).catch(error => console.warn("[dawnhub-advertiser-tools] on-device model warm-up failed", error))

    ctx.addEventListener(document, "paste", event => {
        if (stopped || !(isRaidsView() || isBookingView())) return
        // The panel has its own paste listener once it's open, so a second screenshot pasted while it's
        // already up goes to it directly instead of being swallowed here.
        if (isBookingIntentPanelOpen()) return
        const image = getImageFromClipboard(event.clipboardData)
        if (!image) return
        event.preventDefault()
        void openBookingIntentPanel(image)
    })

    return {stop: () => { stopped = true }}
}
