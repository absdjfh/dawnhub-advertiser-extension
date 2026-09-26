/** The modifier key a paste is typed with - "⌘" on macOS, "Ctrl" everywhere else - for the shortcut hints. */
export function getPasteModifierLabel(): string {
    return /Mac/i.test(globalThis.navigator?.userAgent ?? "") ? "⌘" : "Ctrl"
}
