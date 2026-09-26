import BookingSearch from "@/components/ui/BookingSearch.vue";
import {openBookingIntentPanel} from "@/components/ui/booking-intent-panel";
import {createSvgIcon} from "@/utils/dom/controls";
import {attachInstantTooltip} from "@/utils/dom/instant-tooltip";
import {mountComponent, type MountedComponent} from "@/utils/mount-vue";
import {getPasteModifierLabel} from "@/utils/platform";

/** A chat bubble with two lines of text - "a DM" - drawn in the same outline style as the rest of the icons. */
const MESSAGE_ICON = '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M7.5 8.5h9M7.5 12.5h5"/>'
/** Feather's outline "search" icon. */
const SEARCH_ICON = '<circle cx="11" cy="11" r="7"/><path d="m20 20-4.35-4.35"/>'

/**
 * The extension's toolbar in Dawnhub's own toolbar slot: the fill-booking button, and on the raids list the
 * buyer search next to it. Filling a booking from a DM is the reason the extension exists, so it's a full,
 * labelled button that also shows the shortcut that does the same thing from anywhere on the page.
 */
export function renderToolbar(container: HTMLElement, options: {withBookingSearch: boolean}) {
    const toolbar = document.createElement("div")
    toolbar.className = "dat-toolbar"
    toolbar.appendChild(createFillBookingButton())
    if (options.withBookingSearch) toolbar.appendChild(createBookingSearchButton(toolbar))
    container.appendChild(toolbar)
    return toolbar
}

function createFillBookingButton() {
    const modifier = getPasteModifierLabel()
    const button = document.createElement("button")
    button.type = "button"
    button.className = "dat-fill-button"
    button.setAttribute("aria-keyshortcuts", modifier === "⌘" ? "Meta+V" : "Control+V")

    const icon = document.createElement("span")
    icon.className = "dat-fill-button-icon"
    icon.appendChild(createSvgIcon(MESSAGE_ICON, "dat-icon"))

    const label = document.createElement("span")
    label.className = "dat-fill-button-label"
    label.textContent = "Fill booking from DM"

    const shortcut = document.createElement("kbd")
    shortcut.className = "dat-fill-button-shortcut"
    shortcut.textContent = `${modifier} V`
    shortcut.setAttribute("aria-hidden", "true")

    button.append(icon, label, shortcut)
    attachInstantTooltip(button, `Paste a screenshot of a buyer's DM (Discord, Battle.net or in-game) anywhere on this page (${modifier}+V) - or click here and paste the copied message text, which reads more accurately. The raid, Name-Realm and price are read on your device, then you confirm before anything is filled in.`)
    button.onclick = () => { void openBookingIntentPanel() }
    return button
}

function createBookingSearchButton(toolbar: HTMLElement) {
    let popup: MountedComponent | null = null
    const button = document.createElement("button")
    button.type = "button"
    button.className = "dat-secondary-button"
    button.append(createSvgIcon(SEARCH_ICON, "dat-icon"), document.createTextNode("Find a buyer"))
    attachInstantTooltip(button, "Find which raids a character is booked into, across the dates shown on this page.")
    button.onclick = () => {
        if (popup) return
        const container = document.createElement("div")
        toolbar.appendChild(container)
        popup = mountComponent(BookingSearch, {onClose: close}, container)

        function close() {
            popup?.unmount()
            container.remove()
            popup = null
        }
    }
    return button
}
