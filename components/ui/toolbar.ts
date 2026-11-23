import BookingSearch from "@/components/ui/BookingSearch.vue";
import {createSvgIcon} from "@/utils/dom/controls";
import {attachInstantTooltip} from "@/utils/dom/instant-tooltip";
import {mountComponent, type MountedComponent} from "@/utils/mount-vue";

/** Feather's outline "search" icon. */
const SEARCH_ICON = '<circle cx="11" cy="11" r="7"/><path d="m20 20-4.35-4.35"/>'

export function renderToolbar(container: HTMLElement) {
    const toolbar = document.createElement("div")
    toolbar.className = "dat-toolbar"
    toolbar.appendChild(createBookingSearchButton(toolbar))
    container.appendChild(toolbar)
    return toolbar
}

function createBookingSearchButton(toolbar: HTMLElement) {
    let popup: MountedComponent | null = null
    let container: HTMLDivElement | null = null
    const button = document.createElement("button")
    button.type = "button"
    button.className = "dat-secondary-button"
    button.append(createSvgIcon(SEARCH_ICON, "dat-icon"), document.createTextNode("Find a buyer"))
    attachInstantTooltip(button, "Find which raids a character is booked into, across the dates shown on this page.")
    button.onclick = () => {
        if (container) {
            close()
            return
        }
        container = document.createElement("div")
        toolbar.appendChild(container)
        document.addEventListener("mousedown", onOutsideClick, true)
        popup = mountComponent(BookingSearch, {onClose: close}, container)
    }

    function onOutsideClick(event: MouseEvent) {
        if (container && !container.contains(event.target as Node) && !button.contains(event.target as Node)) close()
    }

    function close() {
        document.removeEventListener("mousedown", onOutsideClick, true)
        popup?.unmount()
        popup = null
        container?.remove()
        container = null
    }
    return button
}
