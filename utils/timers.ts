export interface Debounced<A extends unknown[]> {
    (...args: A): void
    cancel: () => void
}

/** Delays `fn` until `ms` after the last call; `cancel()` drops a pending call. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
    let handle: ReturnType<typeof setTimeout> | null = null
    const debounced = (...args: A) => {
        if (handle !== null) clearTimeout(handle)
        handle = setTimeout(() => {
            handle = null
            fn(...args)
        }, ms)
    }
    debounced.cancel = () => {
        if (handle === null) return
        clearTimeout(handle)
        handle = null
    }
    return debounced
}

export interface RestartableTimeout {
    /** Schedules `fn`, replacing any pending run. */
    start: (fn: () => void, ms: number) => void
    cancel: () => void
    readonly pending: boolean
}

/** A single timeout slot: starting again replaces the pending run, `cancel()` clears it. */
export function createTimeout(): RestartableTimeout {
    let handle: ReturnType<typeof setTimeout> | null = null
    const cancel = () => {
        if (handle === null) return
        clearTimeout(handle)
        handle = null
    }
    return {
        start(fn, ms) {
            cancel()
            handle = setTimeout(() => {
                handle = null
                fn()
            }, ms)
        },
        cancel,
        get pending() {
            return handle !== null
        }
    }
}

/**
 * Resolves once `predicate` holds, checking right after the current task and then every `intervalMs`, or
 * rejects after `timeoutMs`. Always yields at least one task first - long enough for a React-controlled page
 * to re-render with a value the extension just typed into one of its fields.
 */
export function waitUntil(predicate: () => boolean, {timeoutMs = 2000, intervalMs = 50} = {}): Promise<void> {
    const deadline = Date.now() + timeoutMs
    return new Promise((resolve, reject) => {
        const check = () => {
            if (predicate()) {
                resolve()
            } else if (Date.now() >= deadline) {
                reject(new Error(`Timed out after ${timeoutMs}ms`))
            } else {
                setTimeout(check, intervalMs)
            }
        }
        setTimeout(check, 0)
    })
}
