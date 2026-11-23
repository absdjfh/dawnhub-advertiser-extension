import {createIntegratedUi} from "#imports";
import {addOpenSlotsFilter, removeOpenSlotsFilter} from "@/components/ui/open-slots-filter";
import {renderToolbar} from "@/components/ui/toolbar";
import {dawnhubSelectors, isRaidsView} from "@/host/dawnhub-page";
import {createTimeout} from "@/utils/timers";
import type {DawnhubContentContext, Integration, RaidsTableIntegration} from "@/entrypoints/content/integrations/types";

/** Mounts the extension's toolbar into Dawnhub's raids-list toolbar slot. */
export function mountToolbarIntegration(ctx: DawnhubContentContext, raidsTable: RaidsTableIntegration): Integration {
    const toolbar = createIntegratedUi(ctx, {
        position: "inline",
        anchor: dawnhubSelectors.toolbarMount,
        onMount: container => {
            if (!isRaidsView()) return
            const extensionToolbar = renderToolbar(container)
            addOpenSlotsFilter(extensionToolbar, () => raidsTable.render())
        },
        // The tick may have been moved next to Dawnhub's own filter, outside the container removed with this.
        onRemove: () => removeOpenSlotsFilter()
    })
    toolbar.autoMount()

    // Dawnhub is a single-page app: going from the raids list to a raid keeps its toolbar slot but not what
    // belongs in it, so the toolbar is rebuilt for the page navigated to.
    const remount = createTimeout()
    let stopped = false
    ctx.addEventListener(window, "wxt:locationchange", () => {
        if (stopped) return
        remount.start(() => {
            toolbar.remove()
            toolbar.autoMount()
        }, 500)
    })
    ctx.onInvalidated(() => remount.cancel())

    return {
        stop() {
            stopped = true
            remount.cancel()
            toolbar.remove()
            removeOpenSlotsFilter()
        }
    }
}
