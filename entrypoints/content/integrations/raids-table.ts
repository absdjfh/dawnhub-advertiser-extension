import {createIntegratedUi} from "#imports";
import {fetchRaidsList, type RaidData} from "@/components/api/dawn-api";
import {applyOpenSlotsFilter} from "@/components/ui/open-slots-filter";
import {removeRaidLinks, renderRaidLink} from "@/components/ui/raid-link";
import {dawnhubSelectors, getDawnhubGrid, getDawnhubGridRows, isRaidsView} from "@/host/dawnhub-page";
import {getColumnIndex, getRaidByRow, setRaidRowHidden} from "@/host/dawnhub-raid-table";
import {rememberRaidsListRequest, watchDawnhubRaidsListRequests} from "@/host/dawnhub-raids-request";
import {anyNodeMatches, registerObserver} from "@/utils/mutation-utils";
import {reportError} from "@/utils/report-error";
import type {DawnhubContentContext, RaidsTableIntegration} from "@/entrypoints/content/integrations/types";

/**
 * Keeps the raids list the page is showing in memory - reloaded with Dawnhub's own query every time Dawnhub
 * loads one - and decorates the table's rows from it: the open slots filter and the raid links.
 */
export function mountRaidsTableIntegration(ctx: DawnhubContentContext): RaidsTableIntegration {
    let raidData: RaidData[] = []
    let latestRequest = 0
    let stopped = false

    function render() {
        if (stopped || !isRaidsView()) return
        const timeColumnIndex = getColumnIndex("Time")
        for (const row of getDawnhubGridRows()) {
            const raid = getRaidByRow(row, raidData)
            applyOpenSlotsFilter(row, raid)
            if (raid) renderRaidLink(row.querySelectorAll("td")[timeColumnIndex], raid)
        }
    }

    const stopWatchingRequests = watchDawnhubRaidsListRequests(url => {
        if (stopped || !isRaidsView()) return
        rememberRaidsListRequest(url)
        const request = ++latestRequest
        // The rows on screen already belong to the new list; until it's reloaded, leave them undecorated
        // rather than resolve them against the old one, which could link a row to the wrong raid.
        raidData = []
        removeRaidLinks()
        render()
        fetchRaidsList(url)
            .then(data => {
                if (request !== latestRequest) return // a newer list was requested meanwhile
                raidData = data
                render()
            })
            .catch(error => reportError("Could not load Dawnhub's raids list", error))
    })

    let renderScheduled = false
    const scheduleRender = () => {
        if (renderScheduled) return
        renderScheduled = true
        requestAnimationFrame(() => {
            renderScheduled = false
            render()
        })
    }

    const table = createIntegratedUi(ctx, {
        position: "inline",
        anchor: dawnhubSelectors.grid,
        append: () => {
            // The table is decorated in place instead of adding a node.
        },
        onMount: () => {
            const grid = getDawnhubGrid()
            if (!grid) return null
            scheduleRender()
            return registerObserver(grid, {childList: true, subtree: true, attributeFilter: ["id"], characterData: false}, mutations => {
                const rowsChanged = anyNodeMatches(mutations, node => node.nodeName === "TR")
                const rowIdsChanged = mutations.some(mutation => mutation.target.nodeName === "TR" && mutation.attributeName === "id")
                const hostUpdatedRowContents = mutations.some(mutation => {
                    const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement
                    return mutation.type === "childList" && target?.closest("tr[id^='MUIDataTableBodyRow-raids-']")
                })
                if (rowsChanged || rowIdsChanged || hostUpdatedRowContents) scheduleRender()
            })
        },
        onRemove(observer?: MutationObserver | null) {
            observer?.disconnect()
        }
    })
    table.autoMount()

    return {
        render,
        stop() {
            stopped = true
            stopWatchingRequests()
            table.remove()
            removeRaidLinks()
            getDawnhubGridRows().forEach(row => setRaidRowHidden(row, false))
        }
    }
}
