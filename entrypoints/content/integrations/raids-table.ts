import {createIntegratedUi} from "#imports";
import {fetchRaidsList, type RaidData} from "@/components/api/dawn-api";
import {applyOpenSlotsFilter} from "@/components/ui/open-slots-filter";
import {removeRaidDelays, renderRaidDelay} from "@/components/ui/raid-delay";
import {removeRaidLinks, renderRaidLink} from "@/components/ui/raid-link";
import {dawnhubSelectors, getDawnhubGrid, getDawnhubGridRows, isRaidsView} from "@/host/dawnhub-page";
import {getColumnIndex, getRaidByRow, setRaidRowHidden} from "@/host/dawnhub-raid-table";
import {rememberRaidsListRequest, watchDawnhubRaidsListRequests} from "@/host/dawnhub-raids-request";
import {anyNodeMatches, registerObserver} from "@/utils/mutation-utils";
import {createRaidLockTracker, estimateRaidDelays, type RaidLock} from "@/utils/raid-delays";
import {reportError} from "@/utils/report-error";
import type {DawnhubContentContext, RaidsTableIntegration} from "@/entrypoints/content/integrations/types";

/**
 * Keeps the raids list the page is showing in memory - reloaded with Dawnhub's own query every time Dawnhub
 * loads one - and decorates the table's rows from it: the open slots filter, the raid links and the likely
 * start of the raids held up by a late one before them.
 */
export function mountRaidsTableIntegration(ctx: DawnhubContentContext): RaidsTableIntegration {
    let raidData: RaidData[] = []
    // Every lock the extension has timed, kept in memory so the synchronous row renderer can estimate from it.
    let raidLocks: RaidLock[] = []
    let latestRequest = 0
    let stopped = false
    const noticeLocks = createRaidLockTracker()

    function render() {
        if (stopped || !isRaidsView()) return
        const timeColumnIndex = getColumnIndex("Time")
        // Estimated per render rather than per list: a raid still open past its start grows later by the minute.
        const delays = estimateRaidDelays(raidData, raidLocks, Date.now())
        for (const row of getDawnhubGridRows()) {
            const raid = getRaidByRow(row, raidData)
            applyOpenSlotsFilter(row, raid)
            if (!raid) continue
            const timeCell = row.querySelectorAll("td")[timeColumnIndex]
            renderRaidLink(timeCell, raid)
            renderRaidDelay(timeCell, delays.get(raid._id))
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
        removeRaidDelays()
        render()
        fetchRaidsList(url)
            .then(async data => {
                // Locks are timed from this load against the previous one of the same list, whether or not the
                // rows still belong to it, and before they are drawn: a raid that just locked moves its
                // leader's next raid's estimate at once.
                const locks = await noticeLocks(url, data, Date.now()).catch(error => {
                    // A storage hiccup costs the estimates, not the rest of the table.
                    reportError("Could not keep track of when raids lock", error)
                    return raidLocks
                })
                if (request !== latestRequest) return // a newer list was requested meanwhile
                raidData = data
                raidLocks = locks
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
            removeRaidDelays()
            getDawnhubGridRows().forEach(row => setRaidRowHidden(row, false))
        }
    }
}
