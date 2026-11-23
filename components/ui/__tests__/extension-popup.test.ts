import {describe, expect, it} from "vitest"
import ExtensionPopup from "@/components/ui/ExtensionPopup.vue"
import {mountVue} from "@/utils/__tests__/support/mount-vue"

describe("Extension popup", () => {
    it("should list every tool, each linked to its section of the user guide", () => {
        const wrapper = mountVue(ExtensionPopup)

        expect(wrapper.findAll(".tools a").map(link => [link.text(), link.attributes("href")])).toEqual([
            ["Find a buyer", "https://dawn-adv-tools.rolich.net/guide.html#find-a-buyer"],
            ["Raids with slots available", "https://dawn-adv-tools.rolich.net/guide.html#slots-available"],
            ["Raid time links", "https://dawn-adv-tools.rolich.net/guide.html#raid-links"],
            ["Late starts", "https://dawn-adv-tools.rolich.net/guide.html#late-starts"]
        ])
    })

    it("should link the raids list, the user guide, and the privacy policy", () => {
        const wrapper = mountVue(ExtensionPopup)

        const links = Object.fromEntries(wrapper.findAll("a").map(link => [link.text(), link.attributes("href")]))
        expect(links).toMatchObject({
            "raids list": "https://hub.dawn-boosting.com/bookings/raids?type=raid",
            "User guide": "https://dawn-adv-tools.rolich.net/guide.html",
            "Privacy policy": "https://dawn-adv-tools.rolich.net/privacy.html"
        })
    })
})
