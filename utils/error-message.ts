/** Turns an operational error into a safe, useful message for an extension user. */
export function getErrorMessage(error: unknown, fallback = "An unexpected error occurred.") {
    return error instanceof Error && error.message ? error.message : fallback
}

export function formatActionError(action: string, error: unknown, nextStep: string) {
    return `${action}.\n\n${getErrorMessage(error)}\n\n${nextStep}`
}
