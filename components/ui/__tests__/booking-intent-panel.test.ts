import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {flushPromises, type DOMWrapper, type VueWrapper} from "@vue/test-utils"
import BookingIntentPanel from "@/components/ui/BookingIntentPanel.vue"
import type {BookingIntentBooking, BookingIntentResult, OpenRaidSummary} from "@/components/booking-intent/booking-intent"
import type {BookingFillFields} from "@/components/booking-intent/pending-booking"
import type {LanguageModelAvailability} from "@/components/booking-intent/prompt-api"
import {mountVue} from "@/utils/__tests__/support/mount-vue"

const extractFromTextMock = vi.hoisted(() => vi.fn<(text: string, openRaids: OpenRaidSummary[]) => Promise<BookingIntentResult>>())
const extractFromImageMock = vi.hoisted(() => vi.fn<(image: Blob, openRaids: OpenRaidSummary[]) => Promise<BookingIntentResult>>())
const availabilityMock = vi.hoisted(() => vi.fn<() => Promise<LanguageModelAvailability>>())

vi.mock("@/components/booking-intent/booking-intent", async importOriginal => ({
    ...await importOriginal<typeof import("@/components/booking-intent/booking-intent")>(),
    extractBookingIntentFromText: extractFromTextMock,
    extractBookingIntentFromImage: extractFromImageMock
}))

vi.mock("@/components/booking-intent/prompt-api", () => ({
    checkPromptApiAvailability: availabilityMock
}))

function openRaid(id: string, overrides: Partial<OpenRaidSummary> = {}): OpenRaidSummary {
    return {
        id,
        name: "Undermine",
        dateTime: "20:00",
        difficulty: "Heroic",
        loot: "Unsaved",
        fullness: [{boss: "", booked: 10, slots: 20, emphasis: ""}],
        curveBosses: [],
        openArmorTypes: null,
        instant: 0,
        ...overrides
    }
}

const curveRaid = openRaid("raid-curve", {
    name: "Liberation of Undermine",
    dateTime: "22:00",
    loot: "Saved",
    curveBosses: ["The Coiled Altar", "Ula'tek"],
    fullness: [
        {boss: "The Coiled Altar", booked: 1, slots: 8, emphasis: ""},
        {boss: "Ula'tek", booked: 8, slots: 8, emphasis: "full"}
    ]
})

const openRaids = [
    openRaid("raid-undermine"),
    openRaid("raid-palace", {name: "Nerub-ar Palace", dateTime: "21:30", loot: "VIP", openArmorTypes: ["mail", "plate"]}),
    curveRaid
]

/** A reading of one or more bookings, as extractBookingIntentFrom* answers it. */
function read(...bookings: Partial<BookingIntentBooking>[]): BookingIntentResult {
    return {status: "read", raw: {}, bookings: bookings.map(booking => ({raidId: "", nameRealm: "", price: "", mentionedCurveBoss: "", mentionedArmorType: "", ...booking}))}
}

let openBooking: ReturnType<typeof vi.fn<(fields: BookingFillFields) => Promise<void>>>

/** Attached to the page like the real panel, so a paste into one of its fields bubbles up to the document. */
function mountPanel(props: {openRaids?: OpenRaidSummary[], allOpenRaids?: OpenRaidSummary[], preselectedRaidId?: string | null, initialImage?: Blob | null} = {}) {
    return mountVue(BookingIntentPanel, {
        props: {
            openRaids: props.openRaids ?? openRaids,
            allOpenRaids: props.allOpenRaids ?? openRaids,
            preselectedRaidId: props.preselectedRaidId ?? null,
            initialImage: props.initialImage ?? null,
            openBooking
        },
        attachTo: document.body
    })
}

function bookings(wrapper: VueWrapper) {
    return wrapper.findAll(".dat-booking-entry")
}

function booking(wrapper: VueWrapper, index = 0) {
    const found = bookings(wrapper)[index]
    if (!found) throw new Error(`No booking ${index + 1}`)
    return found
}

/** The raid rows a booking shows, as their text - leaving out the marks on a raid that may not fit. */
function raidRows(entry: DOMWrapper<Element>) {
    return entry.findAll(".dat-raid-option-summary").map(row => row.text())
}

function pickedRaid(entry: DOMWrapper<Element>) {
    return (entry.find<HTMLInputElement>(".dat-raid-option input:checked").element as HTMLInputElement | undefined)?.value ?? ""
}

async function pickRaid(entry: DOMWrapper<Element>, raidId: string) {
    const radio = entry.findAll<HTMLInputElement>(".dat-raid-option input").find(input => input.element.value === raidId)
    if (!radio) throw new Error(`No raid ${raidId} on show`)
    await radio.setValue(true)
}

/** The input inside the label reading `label`, the way the advertiser finds it on screen. */
function field(entry: DOMWrapper<Element>, label: string) {
    const labelElement = entry.findAll("label").find(element => element.text().startsWith(label))
    if (!labelElement) throw new Error(`No field labelled "${label}"`)
    return labelElement.get("input")
}

function fieldValue(entry: DOMWrapper<Element>, label: string) {
    return (field(entry, label).element as HTMLInputElement).value
}

function tickedBosses(entry: DOMWrapper<Element>) {
    return entry.findAll<HTMLInputElement>(".dat-boss-option input").filter(input => input.element.checked).map(input => input.element.value)
}

function button(within: VueWrapper | DOMWrapper<Element>, text: string) {
    const found = within.findAll("button").find(element => element.text() === text || element.attributes("aria-label") === text)
    if (!found) throw new Error(`No "${text}" button`)
    return found
}

function notice(wrapper: VueWrapper) {
    return wrapper.find(".dat-notice").exists() ? wrapper.get(".dat-notice").text() : null
}

function paste(target: EventTarget, content: {text?: string, image?: File}) {
    const clipboardData = new DataTransfer()
    if (content.text) clipboardData.setData("text/plain", content.text)
    if (content.image) clipboardData.items.add(content.image)
    const event = new ClipboardEvent("paste", {clipboardData, bubbles: true, cancelable: true})
    target.dispatchEvent(event)
    return event
}

function drop(wrapper: VueWrapper, content: {text?: string, file?: File}) {
    const dataTransfer = new DataTransfer()
    if (content.text) dataTransfer.setData("text/plain", content.text)
    if (content.file) dataTransfer.items.add(content.file)
    const event = new DragEvent("drop", {bubbles: true, cancelable: true})
    // happy-dom's DragEvent ignores dataTransfer in its init dictionary; a browser's carries it like this.
    Object.defineProperty(event, "dataTransfer", {value: dataTransfer})
    wrapper.get("section").element.dispatchEvent(event)
    return event
}

describe("Fill booking panel", () => {
    beforeEach(() => {
        availabilityMock.mockResolvedValue("available")
        openBooking = vi.fn<(fields: BookingFillFields) => Promise<void>>().mockResolvedValue(undefined)
    })

    afterEach(() => {
        vi.clearAllMocks()
        document.body.replaceChildren()
    })

    it("should start with one booking listing every open raid, with how full each is", () => {
        const wrapper = mountPanel()

        expect(bookings(wrapper)).toHaveLength(1)
        expect(raidRows(booking(wrapper))).toEqual([
            "20:00 - Undermine - Heroic Unsaved (10/20)",
            "21:30 - Nerub-ar Palace - Heroic VIP (10/20) - Mail, Plate",
            "22:00 - Liberation of Undermine - Heroic Saved (The Coiled Altar: 1/8, Ula'tek: 8/8)"
        ])
    })

    it("should mark a sold-out boss the way Dawnhub's raid list does", () => {
        const wrapper = mountPanel()

        expect(booking(wrapper).get(".dat-fullness-full").text()).toBe("Ula'tek: 8/8")
    })

    it("should open a booking typed in by hand in a new tab, and keep the panel up", async () => {
        const wrapper = mountPanel()
        const entry = booking(wrapper)

        await pickRaid(entry, "raid-palace")
        await field(entry, "Name-Realm").setValue("  Alice-Argent Dawn ")
        await field(entry, "Pot").setValue("300")
        await button(entry, "Open & fill").trigger("click")
        await flushPromises()

        expect(openBooking).toHaveBeenCalledWith({raidId: "raid-palace", nameRealm: "Alice-Argent Dawn", price: "300", curveBoss: ""})
        expect(wrapper.emitted("close")).toBeUndefined()
        expect(booking(wrapper).text()).toContain("opened in a new tab")
    })

    it("should say so on the booking when it couldn't be opened", async () => {
        openBooking.mockRejectedValue(new Error("No tab"))
        const wrapper = mountPanel({preselectedRaidId: "raid-undermine"})

        await button(booking(wrapper), "Open & fill").trigger("click")
        await flushPromises()

        expect(booking(wrapper).text()).toContain("Could not open this booking: No tab")
        expect(booking(wrapper).text()).not.toContain("opened in a new tab")
    })

    it("should start on the raid whose page is open, showing only that raid until the list is asked for", async () => {
        const wrapper = mountPanel({preselectedRaidId: "raid-palace"})
        const entry = booking(wrapper)

        expect(raidRows(entry)).toEqual(["21:30 - Nerub-ar Palace - Heroic VIP (10/20) - Mail, Plate"])
        await button(entry, "change raid").trigger("click")
        expect(raidRows(entry)).toHaveLength(3)
        expect(pickedRaid(entry)).toBe("raid-palace")
    })

    it("should ask for a raid before opening a booking", async () => {
        const wrapper = mountPanel()

        await button(booking(wrapper), "Open & fill").trigger("click")

        expect(openBooking).not.toHaveBeenCalled()
        expect(booking(wrapper).text()).toContain("Select a raid before continuing.")
    })

    it("should only take a pot in thousands of gold", async () => {
        const wrapper = mountPanel({preselectedRaidId: "raid-undermine"})

        await field(booking(wrapper), "Pot").setValue("250k")
        await button(booking(wrapper), "Open & fill").trigger("click")

        expect(openBooking).not.toHaveBeenCalled()
        expect(booking(wrapper).text()).toContain("Pot must be a number, in thousands of gold (e.g. 250 for 250k).")
    })

    it("should offer only the raids starting soon until all of them are asked for", async () => {
        const wrapper = mountPanel({openRaids: [openRaids[0]!]})

        expect(raidRows(booking(wrapper))).toHaveLength(1)
        await button(booking(wrapper), "show all raids").trigger("click")

        expect(raidRows(booking(wrapper))).toHaveLength(3)
        expect(booking(wrapper).findAll("button").some(element => element.text() === "show all raids")).toBe(false)
    })

    it("should close on Escape, Close, the close button, and a click outside the window", async () => {
        const wrapper = mountPanel()

        document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}))
        await button(wrapper, "Close").trigger("click")
        await wrapper.get(".dat-dialog-close").trigger("click")
        await wrapper.get("[role=dialog]").trigger("click")
        await wrapper.get("section").trigger("click")

        expect(wrapper.emitted("close")).toHaveLength(4)
    })

    it("should stop listening for Escape and pastes once closed", async () => {
        const wrapper = mountPanel()
        wrapper.unmount()

        document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}))
        paste(document, {text: "Hi, book me please"})
        await flushPromises()

        expect(wrapper.emitted("close")).toBeUndefined()
        expect(extractFromTextMock).not.toHaveBeenCalled()
    })

    it("should explain that the fields have to be filled in by hand when on-device AI is unavailable", async () => {
        availabilityMock.mockResolvedValue("unavailable")
        const wrapper = mountPanel()
        await flushPromises()

        expect(notice(wrapper)).toContain("fill in the fields below yourself")
        expect(wrapper.get(".dat-notice a").attributes("href")).toBe("https://dawn-adv-tools.rolich.net/guide.html#requirements")
        expect(wrapper.find(".dat-dropzone").exists()).toBe(false)
    })

    it("should read a message pasted anywhere on the page and fill in the raid, name-realm, and pot it found", async () => {
        let finishReading!: (result: BookingIntentResult) => void
        extractFromTextMock.mockReturnValue(new Promise(resolve => finishReading = resolve))
        const wrapper = mountPanel()

        const event = paste(document, {text: "  Hi, mail at 21:30 NP for Bob-Kazzak, 300k ok?  "})
        await flushPromises()

        expect(event.defaultPrevented).toBe(true)
        expect(extractFromTextMock).toHaveBeenCalledWith("Hi, mail at 21:30 NP for Bob-Kazzak, 300k ok?", openRaids)
        expect(wrapper.get(".dat-booking-intent-pasted-text").text()).toBe("Hi, mail at 21:30 NP for Bob-Kazzak, 300k ok?")
        expect(notice(wrapper)).toBe("Reading it…")

        finishReading(read({raidId: "raid-palace", nameRealm: "Bob-Kazzak", price: "300"}))
        await flushPromises()

        const entry = booking(wrapper)
        expect(notice(wrapper)).toBe("Found it - check the fields below. Paste again to replace it.")
        expect(pickedRaid(entry)).toBe("raid-palace")
        expect(fieldValue(entry, "Name-Realm")).toBe("Bob-Kazzak")
        expect(fieldValue(entry, "Pot")).toBe("300")
    })

    it("should let a DM about another raid replace the raid whose page is open", async () => {
        extractFromTextMock.mockResolvedValue(read({raidId: "raid-palace"}))
        const wrapper = mountPanel({preselectedRaidId: "raid-undermine"})

        paste(document, {text: "NP at 21:30 please"})
        await flushPromises()

        expect(pickedRaid(booking(wrapper))).toBe("raid-palace")
    })

    it("should not overwrite anything the advertiser already picked or typed by hand", async () => {
        extractFromTextMock.mockResolvedValue(read({raidId: "raid-palace", nameRealm: "Bob-Kazzak", price: "300"}))
        const wrapper = mountPanel()
        const entry = booking(wrapper)
        await pickRaid(entry, "raid-undermine")
        await field(entry, "Name-Realm").setValue("Alice-Argent Dawn")
        await field(entry, "Pot").setValue("275")

        paste(document, {text: "Book Bob-Kazzak please"})
        await flushPromises()

        expect(pickedRaid(booking(wrapper))).toBe("raid-undermine")
        expect(fieldValue(booking(wrapper), "Name-Realm")).toBe("Alice-Argent Dawn")
        expect(fieldValue(booking(wrapper), "Pot")).toBe("275")
    })

    it("should tell the advertiser the on-device model is downloading while it reads", async () => {
        availabilityMock.mockResolvedValue("downloadable")
        extractFromTextMock.mockReturnValue(new Promise(() => undefined))
        const wrapper = mountPanel()
        await flushPromises()

        paste(document, {text: "Book me please"})
        await flushPromises()

        expect(notice(wrapper)).toBe("Downloading Chrome's on-device AI model (first use only), then reading it…")
    })

    it("should paste text into the field it was pasted into instead of reading it as a message", async () => {
        const wrapper = mountPanel()

        const event = paste(field(booking(wrapper), "Name-Realm").element, {text: "Alice-Argent Dawn"})
        await flushPromises()

        expect(event.defaultPrevented).toBe(false)
        expect(extractFromTextMock).not.toHaveBeenCalled()
    })

    it("should read the screenshot the panel was opened with, and one dropped onto it", async () => {
        extractFromImageMock.mockResolvedValue(read({raidId: "raid-undermine"}))
        const screenshot = new File(["png"], "dm.png", {type: "image/png"})
        const wrapper = mountPanel({initialImage: screenshot})
        await flushPromises()

        expect(extractFromImageMock).toHaveBeenCalledWith(screenshot, openRaids)
        expect(wrapper.get("img").attributes("alt")).toBe("Pasted screenshot")

        const dropped = new File(["png2"], "dm2.png", {type: "image/png"})
        const event = drop(wrapper, {file: dropped})
        await flushPromises()

        expect(event.defaultPrevented).toBe(true)
        expect(extractFromImageMock).toHaveBeenLastCalledWith(dropped, openRaids)
    })

    it("should say why a message could not be read", async () => {
        extractFromTextMock.mockResolvedValue({status: "error", message: "The model returned invalid JSON"})
        const wrapper = mountPanel()

        paste(document, {text: "Book me please"})
        await flushPromises()

        expect(notice(wrapper)).toBe("Could not read this: The model returned invalid JSON")
    })

    describe("several bookings in one message", () => {
        it("should show a booking for every character read, and open each of them on its own", async () => {
            extractFromTextMock.mockResolvedValue(read(
                {raidId: "raid-undermine", nameRealm: "Foo-Kazzak", price: "200"},
                {raidId: "raid-undermine", nameRealm: "Bar-TarrenMill", price: "200"}
            ))
            const wrapper = mountPanel()

            paste(document, {text: "Foo-Kazzak and Bar-TarrenMill at 20:00, 200k each"})
            await flushPromises()

            expect(notice(wrapper)).toBe("This asks for 2 bookings - check each one below, then open it.")
            expect(bookings(wrapper).map(entry => fieldValue(entry, "Name-Realm"))).toEqual(["Foo-Kazzak", "Bar-TarrenMill"])

            await button(booking(wrapper, 1), "Open & fill").trigger("click")
            await flushPromises()

            expect(openBooking).toHaveBeenCalledExactlyOnceWith({raidId: "raid-undermine", nameRealm: "Bar-TarrenMill", price: "200", curveBoss: ""})
            expect(booking(wrapper, 0).text()).not.toContain("opened in a new tab")
            expect(booking(wrapper, 1).text()).toContain("opened in a new tab")
        })

        it("should say which bookings matched no open raid, leaving those to pick by hand", async () => {
            extractFromTextMock.mockResolvedValue(read(
                {raidId: "raid-undermine", nameRealm: "Foo-Kazzak"},
                {raidId: "", nameRealm: "Bar-TarrenMill"}
            ))
            const wrapper = mountPanel()

            paste(document, {text: "two chars"})
            await flushPromises()

            expect(notice(wrapper)).toBe("1 of 2 bookings matched no open raid - pick a raid for those below, or remove them.")
            expect(raidRows(booking(wrapper, 0))).toHaveLength(1)
            expect(raidRows(booking(wrapper, 1))).toHaveLength(3)
        })

        it("should add a booking by hand for a buyer the reading missed", async () => {
            const wrapper = mountPanel({preselectedRaidId: "raid-palace"})

            await button(wrapper, "Add booking").trigger("click")

            expect(bookings(wrapper)).toHaveLength(2)
            expect(pickedRaid(booking(wrapper, 1))).toBe("raid-palace")
        })

        it("should read the next message into a booking of its own once this one has been opened", async () => {
            extractFromTextMock.mockResolvedValueOnce(read({raidId: "raid-undermine", nameRealm: "Foo-Kazzak"}))
            const wrapper = mountPanel()
            paste(document, {text: "first"})
            await flushPromises()
            await button(booking(wrapper), "Open & fill").trigger("click")
            await flushPromises()

            extractFromTextMock.mockResolvedValueOnce(read({raidId: "raid-palace", nameRealm: "Bar-TarrenMill"}))
            paste(document, {text: "second"})
            await flushPromises()

            expect(bookings(wrapper)).toHaveLength(1)
            expect(fieldValue(booking(wrapper), "Name-Realm")).toBe("Bar-TarrenMill")
            expect(pickedRaid(booking(wrapper))).toBe("raid-palace")
        })

        it("should drop a booking read by mistake, but never leave no booking at all", async () => {
            extractFromTextMock.mockResolvedValue(read({nameRealm: "Foo-Kazzak"}, {nameRealm: "Oops-Kazzak"}))
            const wrapper = mountPanel()
            paste(document, {text: "two chars"})
            await flushPromises()

            await button(booking(wrapper, 1), "Remove").trigger("click")

            expect(bookings(wrapper)).toHaveLength(1)
            expect(booking(wrapper).findAll("button").some(element => element.text() === "Remove")).toBe(false)
        })
    })

    describe("raids that may not fit the buyer", () => {
        const almostFullRaid = openRaid("raid-almost-full", {fullness: [{boss: "", booked: 19, slots: 20, emphasis: ""}]})
        const fullBossRaid = openRaid("raid-curve", {
            name: "Liberation of Undermine",
            curveBosses: ["The Coiled Altar", "Ula'tek"],
            fullness: [
                {boss: "The Coiled Altar", booked: 3, slots: 4, emphasis: ""},
                {boss: "Ula'tek", booked: 4, slots: 4, emphasis: "full"}
            ]
        })
        /** Cloth and leather are sold already, mail and plate are still open. */
        const vipRaid = openRaid("raid-vip", {loot: "VIP", openArmorTypes: ["mail", "plate"]})
        const untouchedVipRaid = openRaid("raid-vip-untouched", {dateTime: "20:30", loot: "VIP", openArmorTypes: ["cloth", "leather", "mail", "plate"]})

        function mountWith(raids: OpenRaidSummary[]) {
            return mountPanel({openRaids: raids, allOpenRaids: raids})
        }

        /** The marks on every raid a booking shows, by raid id - [] for a raid that fits. */
        function fitMarksOf(entry: DOMWrapper<Element>) {
            return Object.fromEntries(entry.findAll(".dat-raid-option").map(row => [
                (row.get("input").element as HTMLInputElement).value,
                row.findAll(".dat-fit-mark").map(mark => mark.text())
            ]))
        }

        async function pasteReading(...bookings: Partial<BookingIntentBooking>[]) {
            extractFromTextMock.mockResolvedValue(read(...bookings))
            paste(document, {text: "the message"})
            await flushPromises()
        }

        it("should mark a raid without room for every character the message names, on every booking", async () => {
            const wrapper = mountWith([almostFullRaid, openRaids[0]!])
            expect(fitMarksOf(booking(wrapper))).toEqual({"raid-almost-full": [], "raid-undermine": []})

            await pasteReading({nameRealm: "Foo-Kazzak"}, {nameRealm: "Bar-TarrenMill"})

            expect(fitMarksOf(booking(wrapper, 0))).toEqual({"raid-almost-full": ["Room for 1 of 2"], "raid-undermine": []})
            expect(fitMarksOf(booking(wrapper, 1))).toEqual({"raid-almost-full": ["Room for 1 of 2"], "raid-undermine": []})
            expect(booking(wrapper).get(".dat-fit-mark").attributes("title"))
                .toBe("2 characters in this panel need a spot, but only 1 is left.")
        })

        it("should keep marking a raid once one of the bookings has been opened", async () => {
            const wrapper = mountWith([almostFullRaid])
            await pasteReading({raidId: "raid-almost-full", nameRealm: "Foo-Kazzak"}, {raidId: "raid-almost-full", nameRealm: "Bar-TarrenMill"})

            await button(booking(wrapper, 0), "Open & fill").trigger("click")
            await flushPromises()

            expect(fitMarksOf(booking(wrapper, 1))).toEqual({"raid-almost-full": ["Room for 1 of 2"]})
        })

        it("should mark a curve boss only for the bookings that take it", async () => {
            const wrapper = mountWith([fullBossRaid])
            // Nothing read yet, so the booking takes both bosses - and Ula'tek has no spot left.
            expect(fitMarksOf(booking(wrapper))).toEqual({"raid-curve": ["Ula'tek full"]})

            await pasteReading({raidId: "raid-curve", nameRealm: "Foo-Kazzak", mentionedCurveBoss: "Coiled"})

            expect(fitMarksOf(booking(wrapper))).toEqual({"raid-curve": []})
        })

        it("should go by the bosses ticked for the raid a booking is set to", async () => {
            const wrapper = mountWith([fullBossRaid])
            await pasteReading({raidId: "raid-curve", nameRealm: "Foo-Kazzak", mentionedCurveBoss: "Coiled"})

            const ulatek = booking(wrapper).findAll<HTMLInputElement>(".dat-boss-option input").find(box => box.element.value === "Ula'tek")!
            await ulatek.setValue(true)

            expect(fitMarksOf(booking(wrapper))).toEqual({"raid-curve": ["Ula'tek full"]})
        })

        describe("with one spot left on each curve boss", () => {
            const roomyCurveRaid = openRaid("raid-curve", {
                ...fullBossRaid,
                fullness: [
                    {boss: "The Coiled Altar", booked: 3, slots: 4, emphasis: ""},
                    {boss: "Ula'tek", booked: 3, slots: 4, emphasis: ""}
                ]
            })

            it("should fit two characters booked on different bosses", async () => {
                const wrapper = mountWith([roomyCurveRaid])

                await pasteReading(
                    {raidId: "raid-curve", nameRealm: "Foo-Kazzak", mentionedCurveBoss: "Coiled"},
                    {raidId: "raid-curve", nameRealm: "Bar-TarrenMill", mentionedCurveBoss: "Ula"}
                )

                expect(fitMarksOf(booking(wrapper, 0))).toEqual({"raid-curve": []})
                expect(fitMarksOf(booking(wrapper, 1))).toEqual({"raid-curve": []})
            })

            it("should mark the boss two characters are both booked on", async () => {
                const wrapper = mountWith([roomyCurveRaid])

                await pasteReading(
                    {raidId: "raid-curve", nameRealm: "Foo-Kazzak", mentionedCurveBoss: "Coiled"},
                    {raidId: "raid-curve", nameRealm: "Bar-TarrenMill", mentionedCurveBoss: "Coiled"}
                )

                expect(fitMarksOf(booking(wrapper, 1))).toEqual({"raid-curve": ["Room for 1 of 2 on The Coiled Altar"]})
            })
        })

        it("should ask to check the class on a VIP raid with armor types sold while the buyer's is unknown", () => {
            const wrapper = mountWith([vipRaid, untouchedVipRaid])

            expect(fitMarksOf(booking(wrapper))).toEqual({"raid-vip": ["Check class"], "raid-vip-untouched": []})
        })

        it("should mark a VIP raid that has sold the buyer's armor type already", async () => {
            const wrapper = mountWith([vipRaid, untouchedVipRaid])

            await pasteReading({nameRealm: "Foo-Kazzak", mentionedArmorType: "cloth"})

            expect(fitMarksOf(booking(wrapper))).toEqual({"raid-vip": ["Cloth taken"], "raid-vip-untouched": []})
        })

        it("should not mark a VIP raid that still sells the buyer's armor type", async () => {
            const wrapper = mountWith([vipRaid])

            await pasteReading({nameRealm: "Foo-Kazzak", mentionedArmorType: "plate"})

            expect(fitMarksOf(booking(wrapper))).toEqual({"raid-vip": []})
        })

        it("should mark a VIP raid two characters of the same armor type can't both go to", async () => {
            const wrapper = mountWith([vipRaid])

            await pasteReading(
                {nameRealm: "Foo-Kazzak", mentionedArmorType: "plate"},
                {nameRealm: "Bar-TarrenMill", mentionedArmorType: "plate"}
            )

            expect(fitMarksOf(booking(wrapper, 1))).toEqual({"raid-vip": ["Room for 1 of 2 Plate"]})
        })
    })

    describe("curve boss", () => {
        it("should offer the bosses of the picked raid, all of them ticked until a message says otherwise", async () => {
            const wrapper = mountPanel()

            await pickRaid(booking(wrapper), "raid-curve")

            expect(tickedBosses(booking(wrapper))).toEqual(["The Coiled Altar", "Ula'tek"])
        })

        it("should offer no boss to pick for a raid that isn't sold by boss", async () => {
            const wrapper = mountPanel()

            await pickRaid(booking(wrapper), "raid-undermine")

            expect(booking(wrapper).find(".dat-boss-options").exists()).toBe(false)
        })

        it("should tick only the boss the buyer asked for, shorthand and all, and open the booking for it", async () => {
            extractFromTextMock.mockResolvedValue(read({raidId: "raid-curve", mentionedCurveBoss: "Coiled"}))
            const wrapper = mountPanel()

            paste(document, {text: "coiled please"})
            await flushPromises()
            await button(booking(wrapper), "Open & fill").trigger("click")
            await flushPromises()

            expect(tickedBosses(booking(wrapper))).toEqual(["The Coiled Altar"])
            expect(openBooking).toHaveBeenCalledWith(expect.objectContaining({raidId: "raid-curve", curveBoss: "The Coiled Altar"}))
        })

        it("should book both bosses when both are ticked", async () => {
            extractFromTextMock.mockResolvedValue(read({raidId: "raid-curve", mentionedCurveBoss: "Both"}))
            const wrapper = mountPanel()

            paste(document, {text: "both please"})
            await flushPromises()
            await button(booking(wrapper), "Open & fill").trigger("click")
            await flushPromises()

            expect(openBooking).toHaveBeenCalledWith(expect.objectContaining({curveBoss: "Both"}))
        })

        it("should leave boxes ticked by hand alone when a message is read afterwards", async () => {
            extractFromTextMock.mockResolvedValue(read({raidId: "raid-curve", mentionedCurveBoss: "Ula'tek"}))
            const wrapper = mountPanel()
            await pickRaid(booking(wrapper), "raid-curve")
            await booking(wrapper).findAll<HTMLInputElement>(".dat-boss-option input")[1]!.setValue(false)

            paste(document, {text: "ula please"})
            await flushPromises()

            expect(tickedBosses(booking(wrapper))).toEqual(["The Coiled Altar"])
        })

        it("should ask for a boss before opening a booking with none of them ticked", async () => {
            const wrapper = mountPanel()
            await pickRaid(booking(wrapper), "raid-curve")
            for (const box of booking(wrapper).findAll<HTMLInputElement>(".dat-boss-option input")) await box.setValue(false)

            await button(booking(wrapper), "Open & fill").trigger("click")

            expect(openBooking).not.toHaveBeenCalled()
            expect(booking(wrapper).text()).toContain("Tick at least one boss before continuing.")
        })

        it("should tick each booking's own boss when one message asks for a character on each", async () => {
            extractFromTextMock.mockResolvedValue(read(
                {raidId: "raid-curve", nameRealm: "Foo-Kazzak", mentionedCurveBoss: "The Coiled Altar"},
                {raidId: "raid-curve", nameRealm: "Bar-TarrenMill", mentionedCurveBoss: "Ula'tek"}
            ))
            const wrapper = mountPanel()

            paste(document, {text: "coiled: Foo-Kazzak, ula: Bar-TarrenMill"})
            await flushPromises()

            expect(bookings(wrapper).map(tickedBosses)).toEqual([["The Coiled Altar"], ["Ula'tek"]])
        })
    })
})
