import {formatActionError} from "@/utils/error-message"
import {showToast} from "@/utils/toast"

export interface ReportErrorOptions {
    /** `true` shows a toast with generic guidance; a string shows one using it as the "next step" guidance. */
    toast?: boolean | string
}

const DEFAULT_NEXT_STEP = "Try again."

/**
 * The single path for handling an operational error: logs it, and optionally tells the user. `context`
 * describes what failed, e.g. "Could not fill the booking". Nothing is recorded or sent anywhere - this
 * extension keeps no diagnostic history of its own.
 */
export function reportError(context: string, error: unknown, options: ReportErrorOptions = {}): void {
    console.error(context, error)
    if (!options.toast) return
    const nextStep = typeof options.toast === "string" ? options.toast : DEFAULT_NEXT_STEP
    showToast(formatActionError(context, error, nextStep))
}
