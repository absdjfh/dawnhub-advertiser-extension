import type {ContentScriptContext} from "#imports";

export type DawnhubContentContext = ContentScriptContext

/** A mounted feature that can take everything it added back off the page - e.g. when the extension is updated. */
export interface Integration {
    stop(): void
}

export interface RaidsTableIntegration extends Integration {
    /** Re-applies the row enhancements, e.g. after the open slots tick changed. */
    render(): void
}
