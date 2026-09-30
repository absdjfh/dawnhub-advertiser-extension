import type {RaidDelay} from "@/utils/raid-delays";

const DELAY_ATTRIBUTE = "data-dat-raid-delay"

/**
 * Shows a raid's likely start under the time Dawnhub lists, with what the estimate goes by on hover. It sits
 * next to the raid link rather than inside the Dawnhub content that link mirrors, so the link goes on showing
 * the listed start alone, and is only written when it changes: Dawnhub re-renders its rows constantly.
 */
export function renderRaidDelay(cell: HTMLTableCellElement | undefined, delay: RaidDelay | undefined) {
    const mark = cell?.querySelector<HTMLElement>(`:scope > [${DELAY_ATTRIBUTE}]`)
    if (!cell || !delay) {
        mark?.remove()
        return
    }
    const shown = mark ?? createRaidDelayMark(cell)
    const text = `~${delay.expectedStart}`
    if (shown.textContent !== text) shown.textContent = text
    if (shown.title !== delay.reason) shown.title = delay.reason
}

/** Gives every Time cell back to Dawnhub, e.g. when the extension is updated or removed. */
export function removeRaidDelays() {
    document.querySelectorAll(`[${DELAY_ATTRIBUTE}]`).forEach(mark => mark.remove())
}

function createRaidDelayMark(cell: HTMLTableCellElement) {
    // A span, not a div: the raid link finds Dawnhub's own content in the cell as its first child div.
    const mark = document.createElement("span")
    mark.setAttribute(DELAY_ATTRIBUTE, "")
    mark.className = "dat-raid-delay"
    cell.appendChild(mark)
    return mark
}
