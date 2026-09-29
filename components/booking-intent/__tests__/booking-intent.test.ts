import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {RaidData} from "@/components/api/dawn-api";
import {
    curveBossChoices,
    extractBookingIntentFromImage,
    extractBookingIntentFromText,
    getImageFromClipboard,
    parsePrice,
    resolveCurveBoss,
    restrictOpenRaidsToProximityWindow,
    summarizeOpenRaids,
    type OpenRaidSummary
} from "@/components/booking-intent/booking-intent";
import {checkPromptApiAvailability, createRequestSession} from "@/components/booking-intent/prompt-api";
import {recognizeScreenshotText} from "@/components/booking-intent/tesseract-ocr";
import {ARMOR_TYPES} from "@/components/wow-classes";

vi.mock("@/components/booking-intent/prompt-api", () => ({
    checkPromptApiAvailability: vi.fn(),
    createRequestSession: vi.fn()
}))

vi.mock("@/components/booking-intent/tesseract-ocr", () => ({
    recognizeScreenshotText: vi.fn()
}))

function createRaid(overrides: Partial<RaidData> = {}): RaidData {
    return {
        _id: "raid-1",
        dateTime: "2024-01-01T11:00:00+00:00",
        status: "active",
        region: "eu",
        curveSlots: [],
        type: "raid",
        loot: "saved",
        difficulty: "normal",
        groupType: "6/6",
        instance: "1",
        buyerSlots: "10",
        booked: 2,
        instanceName: "Venomous Abyss",
        ...overrides
    }
}

function openRaid(overrides: Partial<OpenRaidSummary> = {}): OpenRaidSummary {
    return {
        id: "raid-1",
        name: "Venomous Abyss",
        dateTime: "11:00",
        difficulty: "Normal",
        loot: "Saved",
        fullness: [{boss: "", booked: 2, slots: 10, emphasis: ""}],
        curveBosses: [],
        openArmorTypes: null,
        instant: Date.now(),
        ...overrides
    }
}

describe("getImageFromClipboard", () => {
    it("returns the pasted file when an image was pasted", () => {
        const file = new File(["fake"], "screenshot.png", {type: "image/png"})
        const clipboardData = {
            items: [{kind: "file", type: "image/png", getAsFile: () => file}]
        } as unknown as DataTransfer

        expect(getImageFromClipboard(clipboardData)).toBe(file)
    })

    it("returns null when only text was pasted", () => {
        const clipboardData = {
            items: [{kind: "string", type: "text/plain", getAsFile: () => null}]
        } as unknown as DataTransfer

        expect(getImageFromClipboard(clipboardData)).toBeNull()
    })

    it("returns null with no clipboard data", () => {
        expect(getImageFromClipboard(null)).toBeNull()
    })
})

describe("summarizeOpenRaids", () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2024-01-01T11:00:00.000Z"))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it("only includes active raids with open slots", () => {
        const raids = [
            createRaid({_id: "open", status: "active", booked: 2, buyerSlots: "10"}),
            createRaid({_id: "full", status: "active", booked: 10, buyerSlots: "10"}),
            createRaid({_id: "inactive", status: "closed", booked: 0, buyerSlots: "10"})
        ]

        expect(summarizeOpenRaids(raids).map(entry => entry.id)).toStrictEqual(["open"])
    })

    it("describes a raid the way the raid list shows it", () => {
        const [summary] = summarizeOpenRaids([createRaid({difficulty: "heroic", loot: "vip", booked: 3, buyerSlots: "4"})])

        expect(summary).toMatchObject({name: "Venomous Abyss", dateTime: "11:00", difficulty: "Heroic", loot: "VIP"})
    })

    it("reads a time Dawnhub marks as UTC as the Berlin wall clock it really is", () => {
        const [summary] = summarizeOpenRaids([createRaid({dateTime: "2024-07-01T18:30:00.000Z"})])

        expect(summary!.dateTime).toBe("18:30")
        expect(summary!.instant).toBe(Date.parse("2024-07-01T16:30:00.000Z")) // Europe/Berlin, summer time
    })

    it("counts a raid that isn't sold by boss as one whole set of slots", () => {
        const [summary] = summarizeOpenRaids([createRaid({booked: 2, buyerSlots: "10"})])

        expect(summary!.fullness).toStrictEqual([{boss: "", booked: 2, slots: 10, emphasis: ""}])
    })

    it("flags a sold-out boss of a curve raid, counting a boss nobody booked yet as well", () => {
        const [summary] = summarizeOpenRaids([createRaid({
            type: "curve",
            curveSlots: [{name: "The Coiled Altar", slots: "4"}, {name: "Ula'tek", slots: "4"}],
            booked: {"Ula'tek": 4}
        })])

        expect(summary!.fullness).toStrictEqual([
            {boss: "The Coiled Altar", booked: 0, slots: 4, emphasis: ""},
            {boss: "Ula'tek", booked: 4, slots: 4, emphasis: "full"}
        ])
    })

    it("flags a boss booked well ahead of the other, so the gap shows without reading the counts", () => {
        const [summary] = summarizeOpenRaids([createRaid({
            type: "curve",
            curveSlots: [{name: "The Coiled Altar", slots: "8"}, {name: "Ula'tek", slots: "8"}],
            booked: {"The Coiled Altar": 1, "Ula'tek": 6}
        })])

        expect(summary!.fullness.map(entry => entry.emphasis)).toStrictEqual(["", "ahead"])
    })

    it("flags neither boss when they're booked about as far as each other", () => {
        const [summary] = summarizeOpenRaids([createRaid({
            type: "curve",
            curveSlots: [{name: "The Coiled Altar", slots: "12"}, {name: "Ula'tek", slots: "12"}],
            booked: {"The Coiled Altar": 5, "Ula'tek": 7}
        })])

        expect(summary!.fullness.map(entry => entry.emphasis)).toStrictEqual(["", ""])
    })

    it("lists a curve raid's bosses, in the order they're sold, and none for any other raid", () => {
        const [curve, regular] = summarizeOpenRaids([
            createRaid({type: "curve", curveSlots: [{name: "The Coiled Altar", slots: "4"}, {name: "Ula'tek", slots: "4"}], booked: {}}),
            createRaid()
        ])

        expect(curve!.curveBosses).toStrictEqual(["The Coiled Altar", "Ula'tek"])
        expect(regular!.curveBosses).toStrictEqual([])
    })

    it("lists which armor types are still unbooked for a VIP raid, however Dawnhub writes the classes", () => {
        const [summary] = summarizeOpenRaids([createRaid({
            loot: "vip",
            bookedClasses: ["deathknight", "Priest"] // plate and cloth are taken, leather and mail remain
        })])

        expect(summary!.openArmorTypes).toStrictEqual(["leather", "mail"])
    })

    it("has no open armor types for a non-VIP raid, which doesn't sell by armor type", () => {
        const [summary] = summarizeOpenRaids([createRaid({loot: "saved", bookedClasses: ["deathknight"]})])

        expect(summary!.openArmorTypes).toBeNull()
    })
})

describe("restrictOpenRaidsToProximityWindow", () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2024-01-01T11:00:00.000Z"))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    const inHours = (id: string, hours: number) => openRaid({id, instant: Date.now() + hours * 3_600_000})

    it("keeps raids starting within the next three hours, including ones already started", () => {
        const raids = [inHours("soon", 1), inHours("far", 9), inHours("already-started", -1)]

        expect(restrictOpenRaidsToProximityWindow(raids).map(entry => entry.id)).toStrictEqual(["soon", "already-started"])
    })

    it("can come back empty when every raid starts further out than the window", () => {
        expect(restrictOpenRaidsToProximityWindow([inHours("far", 9)])).toStrictEqual([])
    })
})

describe("parsePrice", () => {
    it.each([
        ["200", 200],
        ["200k", 200],
        ["200K", 200],
        ["1,500", 1500],
        ["1.5m", 1500],
        ["2M", 2000],
        [" 250 k ", 250]
    ])("reads %j as %d thousand gold", (text, expected) => {
        expect(parsePrice(text)).toBe(expected)
    })

    it.each(["", "cheap", "0", "200g", "1-2k"])("finds no price in %j", text => {
        expect(parsePrice(text)).toBeNull()
    })
})

describe("resolveCurveBoss", () => {
    const curveRaid = (curveBosses: string[]) => openRaid({id: "curve-raid", curveBosses})
    const bothBosses = () => curveRaid(["The Coiled Altar", "Ula'tek"])

    it("picks the boss named in full", () => {
        expect(resolveCurveBoss(bothBosses(), "Ula'tek")).toBe("Ula'tek")
    })

    it("picks the boss a buyer's shorthand stands for", () => {
        expect(resolveCurveBoss(bothBosses(), "Coiled")).toBe("The Coiled Altar")
        expect(resolveCurveBoss(bothBosses(), "Altar")).toBe("The Coiled Altar")
        expect(resolveCurveBoss(bothBosses(), "Ula")).toBe("Ula'tek")
        expect(resolveCurveBoss(bothBosses(), "ulatek")).toBe("Ula'tek")
    })

    it("books both bosses when the buyer asked for both", () => {
        expect(resolveCurveBoss(bothBosses(), "Both")).toBe("Both")
    })

    it("singles out no boss when none was named", () => {
        expect(resolveCurveBoss(bothBosses(), "")).toBe("")
    })

    it("singles out no boss rather than guessing when the name fits both of them", () => {
        expect(resolveCurveBoss(curveRaid(["The Coiled Altar", "The Coiled Depths"]), "Coiled")).toBe("")
    })

    it("has nothing to pick on a curve raid selling a single boss, which shows no boss checkboxes", () => {
        expect(resolveCurveBoss(curveRaid(["Ula'tek"]), "Ula'tek")).toBe("")
    })

    it("has nothing to pick on a raid that isn't a curve raid, or with no raid picked at all", () => {
        expect(resolveCurveBoss(curveRaid([]), "Ula'tek")).toBe("")
        expect(resolveCurveBoss(undefined, "Ula'tek")).toBe("")
    })

    it("offers boss checkboxes only for a curve raid sold by boss", () => {
        expect(curveBossChoices(bothBosses())).toStrictEqual(["The Coiled Altar", "Ula'tek"])
        expect(curveBossChoices(curveRaid(["Ula'tek"]))).toStrictEqual([])
        expect(curveBossChoices(curveRaid([]))).toStrictEqual([])
        expect(curveBossChoices(undefined)).toStrictEqual([])
    })
})

/** The schema one booking of the answer has to fit - the answer itself is a list of these. */
interface BookingSchema {
    properties: Record<string, {enum?: string[]}>
    required: string[]
}

interface PromptOptions {
    responseConstraint: {properties: {bookings: {items: BookingSchema}}, required: string[]}
}

function bookingSchemaOf(options: PromptOptions): BookingSchema {
    return options.responseConstraint.properties.bookings.items
}

type ReplyFields = Partial<Record<
    "mentionedTime" | "mentionedRaidName" | "mentionedDifficulty" | "mentionedLoot" | "mentionedPrice" | "mentionedClass" | "mentionedArmorType" | "nameRealm" | "mentionedCurveBoss",
    string
>>

function booking(fields: ReplyFields = {}) {
    return {
        mentionedTime: "",
        mentionedRaidName: "",
        mentionedDifficulty: "",
        mentionedLoot: "",
        mentionedPrice: "",
        mentionedClass: "",
        mentionedArmorType: "",
        nameRealm: "",
        mentionedCurveBoss: "",
        ...fields
    }
}

function replyWith(...bookings: ReturnType<typeof booking>[]) {
    return JSON.stringify({bookings})
}

/** One booking's worth of answer - what a message asking for a single character reads as. */
function reply(fields: ReplyFields = {}) {
    return replyWith(booking(fields))
}

describe("extractBookingIntentFromText", () => {
    let promptMock: ReturnType<typeof vi.fn<(prompt: string, options: PromptOptions) => Promise<string>>>

    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2024-01-01T11:00:00.000Z"))
        promptMock = vi.fn<(prompt: string, options: PromptOptions) => Promise<string>>()
        vi.mocked(createRequestSession).mockResolvedValue({prompt: promptMock, destroy: vi.fn()} as never)
        vi.mocked(checkPromptApiAvailability).mockResolvedValue("available")
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.clearAllMocks()
    })

    const vipRaid = (overrides: Partial<OpenRaidSummary> = {}) => openRaid({id: "vip-raid", name: "Tide & Venom Bundle", loot: "VIP", openArmorTypes: [...ARMOR_TYPES], ...overrides})
    const savedRaid = () => openRaid({id: "saved-raid", name: "Venomous Abyss", loot: "Saved"})
    const curveRaid = () => openRaid({id: "curve-raid", name: "Venomous Abyss", curveBosses: ["The Coiled Altar", "Ula'tek"]})

    it("reports unavailable without calling the model when the Prompt API can't be used", async () => {
        vi.mocked(checkPromptApiAvailability).mockResolvedValue("unavailable")

        const result = await extractBookingIntentFromText("hello", [vipRaid()])

        expect(result).toStrictEqual({status: "unavailable"})
        expect(createRequestSession).not.toHaveBeenCalled()
    })

    it("reports no raids open without calling the model when nothing is open", async () => {
        const result = await extractBookingIntentFromText("hello", [])

        expect(result).toStrictEqual({status: "no_raids_open"})
        expect(createRequestSession).not.toHaveBeenCalled()
    })

    it("asks about any kind of DM, and the open raids' names only, constrained to exactly those", async () => {
        promptMock.mockResolvedValue(reply())

        await extractBookingIntentFromText("dm text", [vipRaid(), savedRaid(), savedRaid()])

        const [prompt, options] = promptMock.mock.lastCall!
        expect(prompt).toContain("Discord, Battle.net, or in-game whispers")
        expect(prompt).toContain("Currently open raids: Tide & Venom Bundle, Venomous Abyss")
        expect(prompt).toContain("Message:\ndm text")
        expect(bookingSchemaOf(options).properties.mentionedRaidName!.enum).toStrictEqual(["Tide & Venom Bundle", "Venomous Abyss", ""])
    })

    it("hands back the mentioned price for the Pot field, in thousands of gold", async () => {
        promptMock.mockResolvedValue(reply({mentionedTime: "11:00", mentionedPrice: "1.5m", nameRealm: "Kasper-Tarrenmill"}))

        const result = await extractBookingIntentFromText("dm text", [savedRaid()])

        expect(result).toMatchObject({status: "read", bookings: [{raidId: "saved-raid", nameRealm: "Kasper-Tarrenmill", price: "1500"}]})
    })

    it("leaves the price blank when the model read none, or nothing usable", async () => {
        promptMock.mockResolvedValue(reply({mentionedTime: "11:00", mentionedPrice: "a lot"}))

        const result = await extractBookingIntentFromText("dm text", [savedRaid()])

        expect(result).toMatchObject({status: "read", bookings: [{price: ""}]})
    })

    it("breaks a tie between two equally-plausible raids by picking whichever came first", async () => {
        promptMock.mockResolvedValue(reply({mentionedTime: "11:00", nameRealm: "Kasper-Tarrenmill"}))

        const result = await extractBookingIntentFromText("dm text", [vipRaid(), savedRaid()])

        expect(result).toMatchObject({status: "read", bookings: [{raidId: "vip-raid", nameRealm: "Kasper-Tarrenmill"}]})
    })

    it("breaks a time tie using the raid name", async () => {
        promptMock.mockResolvedValue(reply({mentionedTime: "11:00", mentionedRaidName: "Venomous Abyss"}))

        const result = await extractBookingIntentFromText("dm text", [vipRaid(), savedRaid()])

        expect(result).toMatchObject({status: "read", bookings: [{raidId: "saved-raid"}]})
    })

    it("picks a raid from its name, difficulty, and loot type together when no time is mentioned", async () => {
        promptMock.mockResolvedValue(reply({mentionedRaidName: "Venomous Abyss", mentionedDifficulty: "normal", mentionedLoot: "saved"}))

        const result = await extractBookingIntentFromText("dm text", [vipRaid({instant: Date.now() + 9 * 3_600_000}), savedRaid()])

        expect(result).toMatchObject({status: "read", bookings: [{raidId: "saved-raid"}]})
    })

    it("treats a mentioned armor type as evidence of a VIP run, without the model saying \"vip\" outright", async () => {
        promptMock.mockResolvedValue(reply({mentionedTime: "11:00", mentionedArmorType: "mail"}))

        const result = await extractBookingIntentFromText("dm text", [savedRaid(), vipRaid()])

        expect(result).toMatchObject({status: "read", bookings: [{raidId: "vip-raid"}]})
    })

    it("never picks a VIP raid that already sold the buyer's armor type", async () => {
        promptMock.mockResolvedValue(reply({mentionedTime: "11:00", mentionedArmorType: "plate", nameRealm: "Kasper-Tarrenmill"}))

        const result = await extractBookingIntentFromText("dm text", [
            vipRaid({id: "plate-sold", openArmorTypes: ["cloth", "leather", "mail"]}),
            vipRaid({id: "plate-open", openArmorTypes: ["leather", "mail", "plate"]})
        ])

        expect(result).toMatchObject({status: "read", bookings: [{raidId: "plate-open"}]})
    })

    it("works out the buyer's armor type from their class when none is mentioned directly", async () => {
        promptMock.mockResolvedValue(reply({mentionedTime: "11:00", mentionedLoot: "vip", mentionedClass: "Death Knight"}))

        const result = await extractBookingIntentFromText("dm text", [
            vipRaid({id: "plate-sold", openArmorTypes: ["cloth", "leather", "mail"]}),
            vipRaid({id: "plate-open"})
        ])

        expect(result).toMatchObject({status: "read", bookings: [{raidId: "plate-open"}]})
    })

    it("hands on each character's armor type, named outright or implied by its class", async () => {
        promptMock.mockResolvedValue(replyWith(
            booking({nameRealm: "Foo-Kazzak", mentionedArmorType: "mail", mentionedClass: "Death Knight"}),
            booking({nameRealm: "Bar-TarrenMill", mentionedClass: "Priest"}),
            booking({nameRealm: "Baz-Kazzak", mentionedClass: "Tinker"})
        ))

        const result = await extractBookingIntentFromText("dm text", [vipRaid()])

        expect(result).toMatchObject({status: "read", bookings: [
            {nameRealm: "Foo-Kazzak", mentionedArmorType: "mail"},
            {nameRealm: "Bar-TarrenMill", mentionedArmorType: "cloth"},
            {nameRealm: "Baz-Kazzak", mentionedArmorType: ""}
        ]})
    })

    it("never picks a raid below the minimum match score, keeping what it did read", async () => {
        promptMock.mockResolvedValue(reply({nameRealm: "Kasper-Tarrenmill", mentionedPrice: "300"}))

        const result = await extractBookingIntentFromText("dm text", [vipRaid(), savedRaid()])

        expect(result).toMatchObject({status: "read", bookings: [{raidId: "", nameRealm: "Kasper-Tarrenmill", price: "300"}]})
    })

    it("carries the curve boss the message named over to the matched raid", async () => {
        promptMock.mockResolvedValue(reply({mentionedTime: "11:00", mentionedCurveBoss: "Ula'tek", nameRealm: "Kasper-Tarrenmill"}))

        const result = await extractBookingIntentFromText("dm text", [curveRaid()])

        expect(result).toMatchObject({status: "read", bookings: [{raidId: "curve-raid", mentionedCurveBoss: "Ula'tek"}]})
    })

    it("offers the open curve bosses for the model to pick from instead of leaving the boss free text", async () => {
        promptMock.mockResolvedValue(reply())

        await extractBookingIntentFromText("dm text", [curveRaid()])

        const [prompt, options] = promptMock.mock.lastCall!
        expect(prompt).toContain("Curve bosses those raids sell: The Coiled Altar, Ula'tek")
        expect(bookingSchemaOf(options).properties.mentionedCurveBoss!.enum).toStrictEqual(["The Coiled Altar", "Ula'tek", "Both", ""])
        expect(bookingSchemaOf(options).required).toContain("mentionedCurveBoss")
    })

    it("never asks about a curve boss when no curve raid is open to book one on", async () => {
        promptMock.mockResolvedValue(reply())

        await extractBookingIntentFromText("dm text", [savedRaid()])

        const [prompt, options] = promptMock.mock.lastCall!
        expect(prompt).not.toContain("mentionedCurveBoss")
        expect(bookingSchemaOf(options).properties).not.toHaveProperty("mentionedCurveBoss")
    })

    it("reports an error when the model call fails, and releases the session either way", async () => {
        const destroy = vi.fn()
        vi.mocked(createRequestSession).mockResolvedValue({prompt: promptMock, destroy} as never)
        promptMock.mockRejectedValue(new Error("The model exploded"))

        const result = await extractBookingIntentFromText("dm text", [vipRaid()])

        expect(result).toStrictEqual({status: "error", message: "The model exploded"})
        expect(destroy).toHaveBeenCalledOnce()
    })

    it("reports an error for a reply that isn't the JSON object asked for", async () => {
        promptMock.mockResolvedValue("null")

        expect(await extractBookingIntentFromText("dm text", [vipRaid()])).toStrictEqual({status: "error", message: "The model returned an unexpected response."})
    })

    describe("several bookings in one message", () => {
        it("reads a booking for every character the message asks for", async () => {
            promptMock.mockResolvedValue(replyWith(
                booking({mentionedTime: "11:00", nameRealm: "Coiled-Kazzak", mentionedCurveBoss: "The Coiled Altar"}),
                booking({mentionedTime: "11:00", nameRealm: "Ula-TarrenMill", mentionedCurveBoss: "Ula'tek"})
            ))

            const result = await extractBookingIntentFromText("dm text", [curveRaid()])

            expect(result).toMatchObject({
                status: "read",
                bookings: [
                    {raidId: "curve-raid", nameRealm: "Coiled-Kazzak", mentionedCurveBoss: "The Coiled Altar"},
                    {raidId: "curve-raid", nameRealm: "Ula-TarrenMill", mentionedCurveBoss: "Ula'tek"}
                ]
            })
        })

        it("shares the run's details and price, written only once, with every character", async () => {
            promptMock.mockResolvedValue(replyWith(
                booking({mentionedTime: "11:00", mentionedPrice: "200k", nameRealm: "Coiled-Kazzak"}),
                booking({nameRealm: "Ula-TarrenMill"})
            ))

            const result = await extractBookingIntentFromText("dm text", [curveRaid()])

            expect(result).toMatchObject({
                status: "read",
                bookings: [{raidId: "curve-raid", price: "200"}, {raidId: "curve-raid", nameRealm: "Ula-TarrenMill", price: "200"}]
            })
        })

        it("keeps a booking on its own raid when the message really does ask for two different ones", async () => {
            promptMock.mockResolvedValue(replyWith(
                booking({mentionedTime: "11:00", mentionedRaidName: "Tide & Venom Bundle", nameRealm: "Vip-Kazzak"}),
                booking({mentionedTime: "11:00", mentionedRaidName: "Venomous Abyss", nameRealm: "Saved-Kazzak"})
            ))

            const result = await extractBookingIntentFromText("dm text", [vipRaid(), savedRaid()])

            expect(result).toMatchObject({status: "read", bookings: [{raidId: "vip-raid"}, {raidId: "saved-raid"}]})
        })

        it("reads one booking out of the same character asked for twice over", async () => {
            promptMock.mockResolvedValue(replyWith(
                booking({mentionedTime: "11:00", nameRealm: "Kasper-Tarrenmill"}),
                booking({mentionedTime: "11:00", nameRealm: "kasper-tarrenmill"})
            ))

            const result = await extractBookingIntentFromText("dm text", [savedRaid()])

            expect(result).toMatchObject({status: "read", bookings: [{nameRealm: "Kasper-Tarrenmill"}]})
            expect((result as {bookings: unknown[]}).bookings).toHaveLength(1)
        })

        it("keeps the same character asked for on two bosses as two bookings", async () => {
            promptMock.mockResolvedValue(replyWith(
                booking({mentionedTime: "11:00", nameRealm: "Kasper-Tarrenmill", mentionedCurveBoss: "The Coiled Altar"}),
                booking({mentionedTime: "11:00", nameRealm: "Kasper-Tarrenmill", mentionedCurveBoss: "Ula'tek"})
            ))

            const result = await extractBookingIntentFromText("dm text", [curveRaid()])

            expect(result).toMatchObject({status: "read", bookings: [{mentionedCurveBoss: "The Coiled Altar"}, {mentionedCurveBoss: "Ula'tek"}]})
        })

        it("drops an entry naming no character at all next to ones that do", async () => {
            promptMock.mockResolvedValue(replyWith(
                booking({mentionedTime: "11:00", nameRealm: "Kasper-Tarrenmill"}),
                booking({mentionedTime: "11:00"})
            ))

            const result = await extractBookingIntentFromText("dm text", [savedRaid()])

            expect((result as {bookings: unknown[]}).bookings).toHaveLength(1)
        })

        it("still reads one booking, raid and all, out of a message naming no character", async () => {
            promptMock.mockResolvedValue(reply({mentionedTime: "11:00"}))

            const result = await extractBookingIntentFromText("dm text", [savedRaid()])

            expect(result).toMatchObject({status: "read", bookings: [{raidId: "saved-raid", nameRealm: ""}]})
        })

        it("leaves a booking to fill in by hand when the model answers with none at all", async () => {
            promptMock.mockResolvedValue(JSON.stringify({bookings: []}))

            const result = await extractBookingIntentFromText("dm text", [savedRaid()])

            expect(result).toMatchObject({status: "read", bookings: [{raidId: "", nameRealm: "", price: "", mentionedCurveBoss: ""}]})
        })

        it("asks the model for a list of bookings rather than a single reading", async () => {
            promptMock.mockResolvedValue(reply())

            await extractBookingIntentFromText("dm text", [savedRaid()])

            const [prompt, options] = promptMock.mock.lastCall!
            expect(prompt).toContain("one entry per character the message asks to book")
            expect(options.responseConstraint.required).toStrictEqual(["bookings"])
            expect(bookingSchemaOf(options).required).toContain("nameRealm")
        })
    })
})

describe("extractBookingIntentFromImage", () => {
    let promptMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2024-01-01T11:00:00.000Z"))
        promptMock = vi.fn()
        vi.mocked(createRequestSession).mockResolvedValue({prompt: promptMock, destroy: vi.fn()} as never)
        vi.mocked(checkPromptApiAvailability).mockResolvedValue("available")
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.clearAllMocks()
    })

    const openRaids = () => [openRaid({id: "vip-raid", name: "Tide & Venom Bundle", difficulty: "Heroic", loot: "VIP"})]

    it("transcribes the image with Tesseract, then matches against the transcription like a pasted message would", async () => {
        vi.mocked(recognizeScreenshotText).mockResolvedValue("yeah what's the name realm?\nkasper-tarrenmill")
        promptMock.mockResolvedValue(reply({mentionedTime: "11:00", mentionedRaidName: "Tide & Venom Bundle", nameRealm: "kasper-tarrenmill"}))

        const image = new Blob(["fake"], {type: "image/png"})
        const result = await extractBookingIntentFromImage(image, openRaids())

        expect(result).toMatchObject({status: "read", bookings: [{raidId: "vip-raid", nameRealm: "kasper-tarrenmill"}]})
        expect(recognizeScreenshotText).toHaveBeenCalledWith(image)
        expect(promptMock.mock.calls[0]![0]).toContain("kasper-tarrenmill")
    })

    it("reports an error and never reaches the matching step when transcription fails", async () => {
        vi.mocked(recognizeScreenshotText).mockRejectedValue(new Error("could not read the screenshot"))

        const result = await extractBookingIntentFromImage(new Blob(["fake"], {type: "image/png"}), openRaids())

        expect(result).toStrictEqual({status: "error", message: "could not read the screenshot"})
        expect(promptMock).not.toHaveBeenCalled()
    })

    it("reports unavailable without running OCR when the on-device model can't read the result anyway", async () => {
        vi.mocked(checkPromptApiAvailability).mockResolvedValue("unavailable")

        const result = await extractBookingIntentFromImage(new Blob(["fake"], {type: "image/png"}), openRaids())

        expect(result).toStrictEqual({status: "unavailable"})
        expect(recognizeScreenshotText).not.toHaveBeenCalled()
    })

    it("reports no raids open without touching Tesseract or the model", async () => {
        const result = await extractBookingIntentFromImage(new Blob(["fake"], {type: "image/png"}), [])

        expect(result).toStrictEqual({status: "no_raids_open"})
        expect(recognizeScreenshotText).not.toHaveBeenCalled()
        expect(createRequestSession).not.toHaveBeenCalled()
    })
})
