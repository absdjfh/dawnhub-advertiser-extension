let activeTooltip: HTMLElement | undefined

/** Attaches a custom tooltip that appears immediately on hover, unlike the browser's native `title` delay. */
export function attachInstantTooltip(element: HTMLElement, text: string | (() => string | undefined)) {
    const resolveText = typeof text === "function" ? text : () => text
    element.addEventListener("mouseenter", () => {
        const resolved = resolveText()
        if (resolved) showInstantTooltip(element, resolved)
    })
    element.addEventListener("mouseleave", hideInstantTooltip)
    return element
}

export function showInstantTooltip(anchor: HTMLElement, text: string) {
    hideInstantTooltip()
    const tooltip = document.createElement("div")
    tooltip.dataset.extInstantTooltip = ""
    tooltip.setAttribute("role", "tooltip")
    tooltip.textContent = text
    tooltip.style.position = "fixed"
    tooltip.style.zIndex = "2147483647"
    tooltip.style.maxWidth = "320px"
    tooltip.style.padding = "5px 7px"
    tooltip.style.borderRadius = "4px"
    tooltip.style.backgroundColor = "#1f2937"
    tooltip.style.color = "#ffffff"
    tooltip.style.fontSize = "12px"
    tooltip.style.lineHeight = "1.35"
    tooltip.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.25)"
    tooltip.style.pointerEvents = "none"
    tooltip.style.whiteSpace = "pre-line" // a text listing several entries puts each on a line of its own

    const rect = anchor.getBoundingClientRect()
    tooltip.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2, window.innerWidth - 8))}px`
    tooltip.style.transform = "translateX(-50%)"
    document.body.appendChild(tooltip)
    // Below the anchor, unless the tooltip would run off the bottom of the window there, like an anchor in the
    // last rows of a table has it; then above it, the way Dawnhub's own tooltips flip.
    const height = tooltip.getBoundingClientRect().height
    const top = rect.bottom + 6 + height > window.innerHeight - 8 ? rect.top - 6 - height : rect.bottom + 6
    tooltip.style.top = `${Math.max(8, Math.min(top, window.innerHeight - 8))}px`
    activeTooltip = tooltip
}

export function hideInstantTooltip() {
    activeTooltip?.remove()
    activeTooltip = undefined
}
