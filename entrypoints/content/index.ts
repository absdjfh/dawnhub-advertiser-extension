import {defineContentScript} from "#imports";
import {restoreOpenSlotsFilter} from "@/components/ui/open-slots-filter";
import {BASE_URLS} from "@/utils/constants";
import {mountBookingFormIntegration} from "@/entrypoints/content/integrations/booking-form";
import {mountPasteTrigger} from "@/entrypoints/content/integrations/paste-trigger";
import {mountRaidsTableIntegration} from "@/entrypoints/content/integrations/raids-table";
import {mountToolbarIntegration} from "@/entrypoints/content/integrations/toolbar";

import "./style.css"

export default defineContentScript({
    matches: BASE_URLS.map(url => `${url}/*`),
    async main(ctx) {
        await restoreOpenSlotsFilter()

        const raidsTable = mountRaidsTableIntegration(ctx)
        const integrations = [
            raidsTable,
            mountToolbarIntegration(ctx, raidsTable),
            mountBookingFormIntegration(ctx),
            mountPasteTrigger(ctx)
        ]

        const stopAll = () => {
            for (const integration of integrations) integration.stop()
        }
        // WXT's own invalidation cleanup removes each mounted UI but leaves its autoMount watcher running,
        // which would mount a fresh copy the next time Dawnhub re-renders - after an extension update, say.
        ctx.onInvalidated(stopAll)
    }
})
