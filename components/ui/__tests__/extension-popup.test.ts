import {afterEach, describe, expect, it, vi} from "vitest"
import {flushPromises} from "@vue/test-utils"
import ExtensionPopup from "@/components/ui/ExtensionPopup.vue"
import type {LanguageModelAvailability} from "@/components/booking-intent/prompt-api"
import {mountVue} from "@/utils/__tests__/support/mount-vue"

const availabilityMock = vi.hoisted(() => vi.fn<() => Promise<LanguageModelAvailability>>())
const downloadModelMock = vi.hoisted(() => vi.fn<(onProgress: (fraction: number) => void) => Promise<void>>())

vi.mock("@/components/booking-intent/prompt-api", () => ({
    checkPromptApiAvailability: availabilityMock,
    downloadModel: downloadModelMock
}))

async function mountPopup(availability: LanguageModelAvailability) {
    availabilityMock.mockResolvedValue(availability)
    const wrapper = mountVue(ExtensionPopup)
    await flushPromises()
    return wrapper
}

describe("Extension popup", () => {
    afterEach(() => {
        vi.clearAllMocks()
    })

    it("should say DMs are read on this computer once on-device AI is ready", async () => {
        const wrapper = await mountPopup("available")

        expect(wrapper.get(".status").text()).toBe("On-device AI is ready. DMs are read on this computer.")
        expect(wrapper.find(".status-action").exists()).toBe(false)
    })

    it("should download the on-device model on request, showing its progress", async () => {
        let reportProgress!: (fraction: number) => void
        let finishDownload!: () => void
        downloadModelMock.mockImplementation(onProgress => {
            reportProgress = onProgress
            return new Promise(resolve => finishDownload = resolve)
        })
        const wrapper = await mountPopup("downloadable")
        expect(wrapper.get(".status").text()).toContain("One-time download needed.")

        await wrapper.get(".status-action").trigger("click")
        reportProgress(0.42)
        await flushPromises()

        expect(wrapper.get("[role=progressbar]").attributes("aria-valuenow")).toBe("42")
        expect(wrapper.get(".progress-bar").attributes("style")).toContain("width: 42%")

        finishDownload()
        await flushPromises()
        expect(wrapper.get(".status").text()).toBe("On-device AI is ready. DMs are read on this computer.")
    })

    it("should say why a download couldn't start, and where things stand now", async () => {
        downloadModelMock.mockRejectedValue(new Error("Requires a user gesture"))
        const wrapper = await mountPopup("downloadable")

        await wrapper.get(".status-action").trigger("click")
        await flushPromises()

        expect(wrapper.get(".status-error").text()).toBe("Requires a user gesture")
        expect(wrapper.find(".status-action").exists()).toBe(true)
    })

    it("should explain the fields can still be filled by hand where on-device AI isn't available", async () => {
        const wrapper = await mountPopup("unavailable")

        expect(wrapper.get(".status").text()).toContain("On-device AI isn't available here. You can still pick the raid and fill the fields yourself.")
        expect(wrapper.get(".status a").attributes("href")).toBe("https://dawn-adv-tools.rolich.net/guide.html#requirements")
    })

    it("should list every tool, each linked to its section of the user guide", async () => {
        const wrapper = await mountPopup("available")

        expect(wrapper.findAll(".tools a").map(link => [link.text(), link.attributes("href")])).toEqual([
            ["Fill booking from a DM", "https://dawn-adv-tools.rolich.net/guide.html#fill-from-dm"],
            ["Find a buyer", "https://dawn-adv-tools.rolich.net/guide.html#find-a-buyer"],
            ["Raids with slots available", "https://dawn-adv-tools.rolich.net/guide.html#slots-available"],
            ["Raid time links", "https://dawn-adv-tools.rolich.net/guide.html#raid-links"]
        ])
    })

    it("should link the raids list, the user guide, and the privacy policy", async () => {
        const wrapper = await mountPopup("available")

        const links = Object.fromEntries(wrapper.findAll("a").map(link => [link.text(), link.attributes("href")]))
        expect(links).toMatchObject({
            "raids list": "https://hub.dawn-boosting.com/bookings/raids?type=raid",
            "User guide": "https://dawn-adv-tools.rolich.net/guide.html",
            "Privacy policy": "https://dawn-adv-tools.rolich.net/privacy.html"
        })
    })
})
