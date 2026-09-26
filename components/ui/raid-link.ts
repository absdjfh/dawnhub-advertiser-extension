import type {RaidData} from "@/components/api/dawn-api";
import {getBookingPageUrl} from "@/host/dawnhub-page";
import {BASE_URL} from "@/utils/constants";

const LINK_ATTRIBUTE = "data-dat-raid-link"

/**
 * Turns a raid's Time cell into a real link to the raid, so a middle click or Ctrl+click opens it in a new
 * tab - Dawnhub itself only navigates on a plain row click. Dawnhub's own content is mirrored into the link
 * and hidden rather than moved, because React keeps rendering the original node and would fail to update
 * one the extension had reparented.
 */
export function renderRaidLink(cell: HTMLTableCellElement | undefined, raid: RaidData) {
    if (!cell || !BASE_URL) return
    const hostContent = cell.querySelector<HTMLElement>(":scope > div")
    if (!hostContent) return

    const link = cell.querySelector<HTMLAnchorElement>(`:scope > a[${LINK_ATTRIBUTE}]`) ?? createRaidLink(cell)
    link.href = getBookingPageUrl(BASE_URL, raid._id)
    // Only the raid and the text Dawnhub shows decide the link, so markup churn around that text costs no rebuild.
    const sourceKey = `${raid._id}|${hostContent.textContent}`
    if (link.dataset.datRaidLinkSource !== sourceKey) {
        const mirroredContent = hostContent.cloneNode(true) as HTMLElement
        mirroredContent.style.display = ""
        link.dataset.datRaidLinkSource = sourceKey
        link.replaceChildren(mirroredContent)
    }
    hostContent.style.display = "none"
}

/** Gives every Time cell back to Dawnhub, e.g. when the extension is updated or removed. */
export function removeRaidLinks() {
    document.querySelectorAll<HTMLAnchorElement>(`a[${LINK_ATTRIBUTE}]`).forEach(link => {
        const hostContent = link.parentElement?.querySelector<HTMLElement>(":scope > div")
        if (hostContent) hostContent.style.display = ""
        link.remove()
    })
}

function createRaidLink(cell: HTMLTableCellElement) {
    const link = document.createElement("a")
    link.setAttribute(LINK_ATTRIBUTE, "")
    link.className = "dat-raid-link"
    link.onclick = event => event.stopPropagation() // Dawnhub navigates on row click; let the link decide instead
    cell.appendChild(link)
    return link
}
