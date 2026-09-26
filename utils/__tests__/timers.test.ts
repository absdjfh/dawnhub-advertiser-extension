import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {createTimeout, debounce, waitUntil} from "@/utils/timers"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("debounce", () => {
    it("runs once with the last arguments after the delay", () => {
        const fn = vi.fn()
        const debounced = debounce(fn, 150)
        debounced("a")
        vi.advanceTimersByTime(100)
        debounced("b")
        vi.advanceTimersByTime(149)
        expect(fn).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(fn).toHaveBeenCalledTimes(1)
        expect(fn).toHaveBeenCalledWith("b")
    })

    it("cancel drops the pending call and is safe to repeat", () => {
        const fn = vi.fn()
        const debounced = debounce(fn, 150)
        debounced()
        debounced.cancel()
        debounced.cancel()
        vi.advanceTimersByTime(1000)
        expect(fn).not.toHaveBeenCalled()
    })

    it("can be called again after firing", () => {
        const fn = vi.fn()
        const debounced = debounce(fn, 10)
        debounced()
        vi.advanceTimersByTime(10)
        debounced()
        vi.advanceTimersByTime(10)
        expect(fn).toHaveBeenCalledTimes(2)
    })
})

describe("createTimeout", () => {
    it("fires after the delay and clears pending", () => {
        const fn = vi.fn()
        const timeout = createTimeout()
        timeout.start(fn, 7000)
        expect(timeout.pending).toBe(true)
        vi.advanceTimersByTime(6999)
        expect(fn).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(fn).toHaveBeenCalledTimes(1)
        expect(timeout.pending).toBe(false)
    })

    it("restarting replaces the pending run", () => {
        const first = vi.fn()
        const second = vi.fn()
        const timeout = createTimeout()
        timeout.start(first, 500)
        vi.advanceTimersByTime(400)
        timeout.start(second, 500)
        vi.advanceTimersByTime(500)
        expect(first).not.toHaveBeenCalled()
        expect(second).toHaveBeenCalledTimes(1)
    })

    it("cancel prevents the run", () => {
        const fn = vi.fn()
        const timeout = createTimeout()
        timeout.start(fn, 500)
        timeout.cancel()
        expect(timeout.pending).toBe(false)
        vi.advanceTimersByTime(1000)
        expect(fn).not.toHaveBeenCalled()
    })
})

describe("waitUntil", () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it("always lets the current task finish first, even when the condition already holds", async () => {
        const resolved = vi.fn()
        void waitUntil(() => true).then(resolved)

        await Promise.resolve()
        expect(resolved).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(0)
        expect(resolved).toHaveBeenCalled()
    })

    it("resolves once the condition holds, checking every interval", async () => {
        let ready = false
        const resolved = vi.fn()
        void waitUntil(() => ready, {intervalMs: 50}).then(resolved)

        await vi.advanceTimersByTimeAsync(120)
        expect(resolved).not.toHaveBeenCalled()

        ready = true
        await vi.advanceTimersByTimeAsync(50)
        expect(resolved).toHaveBeenCalled()
    })

    it("gives up after the timeout", async () => {
        const waiting = waitUntil(() => false, {timeoutMs: 300})
        const assertion = expect(waiting).rejects.toThrow("Timed out after 300ms")

        await vi.advanceTimersByTimeAsync(350)
        await assertion
    })
})
