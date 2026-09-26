import {browser} from "#imports";
import {createWorker, type Worker} from "tesseract.js";

/**
 * Reads text off a screenshot with a dedicated OCR engine instead of Chrome's on-device Prompt API - a small
 * general-purpose vision-language model turned out to guess at cramped or stylized text (e.g. blending a
 * chat sender's display name into a character name written a few lines below it) rather than reliably
 * reading the actual pixels. Tesseract is built for exactly this instead, and tends to do noticeably better
 * on plain, high-contrast chat text. Everything it needs (the worker script, the wasm engine, and the English
 * language data) ships with the extension - nothing is fetched from a CDN, keeping this feature's
 * "processed entirely on your device" guarantee true for this step too.
 */
let workerPromise: Promise<Worker> | null = null

/** Tesseract wants a directory to fetch "eng.traineddata.gz" from, not the file itself - derived from the
 *  bundled file's own URL so it can't drift out of sync with where that file actually is. */
function langDataDirectoryUrl() {
    const fileUrl = browser.runtime.getURL("/tesseract/lang-data/eng.traineddata.gz")
    return fileUrl.slice(0, fileUrl.lastIndexOf("/"))
}

/** Reuses one worker for the page's whole lifetime - spinning one up (loading the wasm engine and the English
 *  language data) is slow enough that recreating it for every pasted screenshot would make this unusable. */
function getOrCreateWorker(): Promise<Worker> {
    workerPromise ??= createWorker("eng", 1, {
        workerPath: browser.runtime.getURL("/tesseract/worker.min.js"),
        // The self-contained core (wasm inlined as base64) rather than the split .js+.wasm pair - the split
        // version has the wasm engine locate its own binary relative to wherever it thinks it was loaded
        // from, which is one more thing to get wrong across this already multi-hop (blob -> extension ->
        // worker) loading chain. Bigger download, but nothing left to misresolve.
        corePath: browser.runtime.getURL("/tesseract/tesseract-core-simd-lstm.wasm.js"),
        langPath: langDataDirectoryUrl(),
        // A plain `new Worker(url)` requires the script to be same-origin with the page that creates it - a
        // chrome-extension:// URL never qualifies, no matter what web_accessible_resources says (that only
        // makes the file fetchable, it doesn't satisfy the Worker's own same-origin check). Wrapping it in a
        // blob: URL sidesteps this: the blob inherits the page's origin, and the extension resource is then
        // only ever reached through an ordinary (web-accessible-gated) importScripts call from inside the
        // worker, which isn't subject to that same-origin rule.
        workerBlobURL: true
    }).catch(error => {
        // A failed createWorker() must not be cached - the next call should try again instead of reusing
        // a rejection forever (e.g. after a transient fetch error for one of the bundled files).
        workerPromise = null
        throw error
    })
    return workerPromise
}

/** Transcribes whatever text is visible in a screenshot, first line to last, with no attempt to interpret it -
 *  that interpreting is left to the on-device model afterward (see ocrScreenshotText in booking-intent.ts). */
export async function recognizeScreenshotText(image: Blob): Promise<string> {
    const worker = await getOrCreateWorker()
    // Tesseract.js reads a Blob/File directly at runtime despite its own type declarations not listing it.
    const {data} = await worker.recognize(image)
    return data.text
}
