import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
    getRememberedRaidsListRequest,
    isDawnhubRaidsListRequest,
    rememberRaidsListRequest,
    watchDawnhubRaidsListRequests
} from "@/host/dawnhub-raids-request";

const LIST_URL = "https://hub.dawn-boosting.com/api/raids?dateFrom=2026-09-25%2000%3A00%3A00&dateTo=2026-09-25%2023%3A59%3A59&type=raid&region=eu"

/** Stands in for the browser's PerformanceObserver: records the observer so a test can deliver entries to it. */
class FakePerformanceObserver {
    static instances: FakePerformanceObserver[] = []
    observedWith: PerformanceObserverInit | null = null
    disconnected = false

    constructor(private readonly callback: (list: {getEntries(): {name: string}[]}) => void) {
        FakePerformanceObserver.instances.push(this)
    }

    observe(options: PerformanceObserverInit) {
        this.observedWith = options
    }

    disconnect() {
        this.disconnected = true
    }

    deliver(...urls: string[]) {
        this.callback({getEntries: () => urls.map(name => ({name}))})
    }
}

describe("isDawnhubRaidsListRequest", () => {
    it.each([
        LIST_URL,
        "https://devhub.dawn-boosting.com/api/raids?type=curve&region=us"
    ])("recognizes Dawnhub loading its raids list: %s", url => {
        expect(isDawnhubRaidsListRequest(url)).toBe(true)
    })

    it.each([
        ["one raid's details", "https://hub.dawn-boosting.com/api/raids/abc123?nolog=true"],
        ["this extension's own reload of a list", `${LIST_URL}&ext`],
        ["a list without a query", "https://hub.dawn-boosting.com/api/raids"],
        ["another site", "https://example.com/api/raids?type=raid"],
        ["another Dawnhub endpoint", "https://hub.dawn-boosting.com/api/bookings?raid=1"],
        ["something that isn't a URL", "not a url"]
    ])("ignores %s", (_, url) => {
        expect(isDawnhubRaidsListRequest(url)).toBe(false)
    })
})

describe("watchDawnhubRaidsListRequests", () => {
    beforeEach(() => {
        FakePerformanceObserver.instances = []
        vi.stubGlobal("PerformanceObserver", FakePerformanceObserver)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it("replays the page's request history, including the list loaded before the extension started", () => {
        const onRequest = vi.fn()
        watchDawnhubRaidsListRequests(onRequest)
        const observer = FakePerformanceObserver.instances[0]!

        expect(observer.observedWith).toStrictEqual({type: "resource", buffered: true})
        observer.deliver(LIST_URL)
        expect(onRequest).toHaveBeenCalledExactlyOnceWith(LIST_URL)
    })

    it("only acts on the latest raids list in a batch, ignoring every other request in it", () => {
        const onRequest = vi.fn()
        watchDawnhubRaidsListRequests(onRequest)
        const newerList = LIST_URL.replace("region=eu", "region=us")

        FakePerformanceObserver.instances[0]!.deliver(
            LIST_URL,
            "https://hub.dawn-boosting.com/_next/static/chunk.js",
            newerList,
            `${newerList}&ext`,
            "https://hub.dawn-boosting.com/api/raids/abc123?nolog=true"
        )

        expect(onRequest).toHaveBeenCalledExactlyOnceWith(newerList)
    })

    it("calls back for nothing when a batch has no raids list in it", () => {
        const onRequest = vi.fn()
        watchDawnhubRaidsListRequests(onRequest)

        FakePerformanceObserver.instances[0]!.deliver("https://hub.dawn-boosting.com/api/raids/abc123")

        expect(onRequest).not.toHaveBeenCalled()
    })

    it("stops watching when told to", () => {
        const stop = watchDawnhubRaidsListRequests(vi.fn())

        stop()

        expect(FakePerformanceObserver.instances[0]!.disconnected).toBe(true)
    })
})

describe("remembering the raids list for the tab", () => {
    afterEach(() => {
        sessionStorage.clear()
    })

    it("hands back the list last remembered", () => {
        rememberRaidsListRequest(LIST_URL)

        expect(getRememberedRaidsListRequest()).toBe(LIST_URL)
    })

    it("has nothing to hand back before a list was ever loaded in the tab", () => {
        expect(getRememberedRaidsListRequest()).toBeNull()
    })

    it("never hands back anything but a Dawnhub raids list, whatever ended up under its key", () => {
        sessionStorage.setItem("dawnhubAdvertiserTools:raidsListRequest", "https://example.com/api/raids?type=raid")

        expect(getRememberedRaidsListRequest()).toBeNull()
    })
})
