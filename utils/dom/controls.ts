const SVG_NAMESPACE = "http://www.w3.org/2000/svg"
/** Paths of Material UI's CheckBoxOutlineBlank and CheckBox icons, so a tick matches the rest of the site. */
const CHECKBOX_BLANK_PATH = "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
const CHECKBOX_MARK_PATH = "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"

/** An inline SVG icon; `svgContent` is a static string authored next to each caller, never user input. */
export function createSvgIcon(svgContent: string, className: string) {
    const icon = document.createElementNS(SVG_NAMESPACE, "svg")
    icon.setAttribute("class", className)
    icon.setAttribute("viewBox", "0 0 24 24")
    icon.setAttribute("focusable", "false")
    icon.setAttribute("aria-hidden", "true")
    icon.innerHTML = svgContent
    return icon
}

/**
 * A ticked label for the filters the extension adds beside Dawnhub's own. A filter says what it is showing
 * while it is off, which a button that only differs by being pressed cannot, so it is rendered as a checkbox
 * with its label rather than as a button.
 */
export function createCheckboxToggle(options: {
    name: string
    checked: boolean
    onchange: (checked: boolean) => void | Promise<void>
}) {
    const {root: box, checkbox} = createMuiCheckbox()
    checkbox.checked = options.checked
    checkbox.onclick = async event => {
        event.stopPropagation()
        await options.onchange(checkbox.checked)
    }
    const root = document.createElement("label")
    root.className = "dat-checkbox-toggle"
    root.append(box, document.createTextNode(options.name))
    return {root, checkbox}
}

/** Rebuilds Material UI's checkbox, which Dawnhub itself renders nowhere on the pages the extension touches. */
function createMuiCheckbox() {
    const checkbox = document.createElement("input")
    checkbox.setAttribute("type", "checkbox")

    const icon = document.createElementNS(SVG_NAMESPACE, "svg")
    icon.setAttribute("class", "dat-mui-checkbox-icon")
    icon.setAttribute("viewBox", "0 0 24 24")
    icon.setAttribute("focusable", "false")
    icon.setAttribute("aria-hidden", "true")
    icon.append(createCheckboxPath("dat-mui-checkbox-blank", CHECKBOX_BLANK_PATH))
    icon.append(createCheckboxPath("dat-mui-checkbox-mark", CHECKBOX_MARK_PATH))

    const root = document.createElement("span")
    root.className = "dat-mui-checkbox"
    root.append(checkbox, icon)
    return {root, checkbox}
}

function createCheckboxPath(className: string, path: string) {
    const element = document.createElementNS(SVG_NAMESPACE, "path")
    element.setAttribute("class", className)
    element.setAttribute("d", path)
    return element
}

/**
 * Sets a Dawnhub form field the way typing into it would. Dawnhub's form is React-controlled; the input
 * event is what makes React pick the new value up (a content script's own `value` write bypasses React's
 * value tracker, so React sees the change as the user's).
 */
export function setFieldValue(field: HTMLInputElement, value: string) {
    field.value = value
    field.dispatchEvent(new Event("input", {bubbles: true}))
}
