// Ambient types for Chrome's on-device Prompt API (LanguageModel) - not yet in TS's lib types, so declared
// here. Used by the "fill booking from screenshot or text" feature in components/booking-intent/booking-intent.ts.

export type LanguageModelAvailability = "unavailable" | "downloadable" | "downloading" | "available"

interface LanguageModelExpectedIO {
    type: "text" | "image" | "audio"
    languages?: string[]
}

interface LanguageModelPromptContent {
    type: "text" | "image" | "audio"
    value: string | Blob | ImageBitmap
}

interface LanguageModelPromptMessage {
    role: "system" | "user" | "assistant"
    content: LanguageModelPromptContent[]
}

interface LanguageModelPromptOptions {
    responseConstraint?: object
}

interface LanguageModelAvailabilityOptions {
    expectedInputs?: LanguageModelExpectedIO[]
    expectedOutputs?: LanguageModelExpectedIO[]
}

interface LanguageModelCreateOptions {
    expectedInputs?: LanguageModelExpectedIO[]
    expectedOutputs?: LanguageModelExpectedIO[]
    /** Chrome requires both or neither - see CONSISTENT_ANSWER_OPTIONS below for why they're set the way they are. */
    temperature?: number
    topK?: number
    /** Reports the model download's progress, for a model that isn't on the device yet. */
    monitor?(monitor: LanguageModelCreateMonitor): void
}

interface LanguageModelCreateMonitor {
    /** `loaded` is the fraction downloaded so far, 0 to 1. */
    addEventListener(type: "downloadprogress", listener: (event: ProgressEvent) => void): void
}

interface LanguageModelSession {
    // Not implemented by every Chrome build that otherwise exposes LanguageModel - callers must feature-detect.
    readonly inputQuota?: number
    prompt(input: string | LanguageModelPromptMessage[], options?: LanguageModelPromptOptions): Promise<string>
    measureInputUsage?(input: string | LanguageModelPromptMessage[], options?: LanguageModelPromptOptions): Promise<number>
    /** Cheap compared to LanguageModel.create() - reuses the loaded model but starts with fresh conversation state. */
    clone(options?: {signal?: AbortSignal}): Promise<LanguageModelSession>
    destroy(): void
}

interface LanguageModelStatic {
    availability(options?: LanguageModelAvailabilityOptions): Promise<LanguageModelAvailability>
    create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>
}

declare global {
    // `var` is required here - it's what TS expects for ambient global augmentation.
    var LanguageModel: LanguageModelStatic | undefined
}

export type {LanguageModelPromptMessage, LanguageModelSession}

/** Booking intent is read from an English screenshot and produces English field values; nothing else is asked of the model. */
const EXPECTED_INPUTS: LanguageModelExpectedIO[] = [
    {type: "text", languages: ["en"]},
    {type: "image", languages: ["en"]}
]
const EXPECTED_OUTPUTS: LanguageModelExpectedIO[] = [{type: "text", languages: ["en"]}]

/**
 * Reading a screenshot correctly should have one right answer, not a range of creative ones. Left at its
 * normal settings, the model would sometimes give a different answer for the exact same screenshot - and
 * often just picked whatever came first in a list of raids, regardless of what the screenshot actually said.
 * These options tell it to always give its single most confident answer instead of varying its answers.
 */
const CONSISTENT_ANSWER_OPTIONS = {temperature: 0, topK: 1}

let sessionPromise: Promise<LanguageModelSession> | null = null

function isPromptApiSupported() {
    return typeof LanguageModel !== "undefined"
}

export async function checkPromptApiAvailability(): Promise<LanguageModelAvailability> {
    if (!isPromptApiSupported()) return "unavailable"
    return LanguageModel!.availability({expectedInputs: EXPECTED_INPUTS, expectedOutputs: EXPECTED_OUTPUTS})
}

/**
 * Reuses one session for the page's whole lifetime - LanguageModel.create() is slow enough (it can trigger a
 * model download) that recreating it for every pasted screenshot would make the feature unusable.
 */
export function getOrCreateSession(): Promise<LanguageModelSession> {
    sessionPromise ??= LanguageModel!.create({expectedInputs: EXPECTED_INPUTS, expectedOutputs: EXPECTED_OUTPUTS, ...CONSISTENT_ANSWER_OPTIONS})
        // A failed create() must not be cached - the next call should try again instead of reusing a
        // rejection forever (e.g. after a transient error).
        .catch(error => { sessionPromise = null; throw error })
    return sessionPromise
}

/**
 * The session remembers everything asked of it so far, and a screenshot takes up a lot of that memory. If we
 * reused the same session directly for a second screenshot, it would be piled on top of the first one and
 * quickly run out of room. Cloning starts each screenshot with a blank slate, without paying again for the
 * slow part - loading the model itself - which the clone reuses from the original session.
 */
export async function createRequestSession(): Promise<LanguageModelSession> {
    const baseSession = await getOrCreateSession()
    return baseSession.clone()
}

/**
 * Starts (or joins) the one-time download of Chrome's on-device model, for the popup's "Download" button.
 * Creating a session is what triggers the download, and Chrome only allows that right after a click or
 * keypress - which the popup's button provides. The session is only a means to that end, so it's discarded.
 */
export async function downloadModel(onProgress: (fractionLoaded: number) => void): Promise<void> {
    const session = await LanguageModel!.create({
        expectedInputs: EXPECTED_INPUTS,
        expectedOutputs: EXPECTED_OUTPUTS,
        ...CONSISTENT_ANSWER_OPTIONS,
        monitor(monitor) {
            monitor.addEventListener("downloadprogress", event => onProgress(event.loaded))
        }
    })
    session.destroy()
}
