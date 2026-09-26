import type {RaidData} from "@/components/api/dawn-api";
import {ARMOR_TYPES, findWowClass, type ArmorType, type LootType, type RaidDifficulty} from "@/components/wow-classes";
import {capitalize, getBookedArmorTypes, getRaidName, hasOpenSlots} from "@/utils/raid-utils";
import {formatRaidTime, getRaidInstant} from "@/utils/raid-time";
import {checkPromptApiAvailability, createRequestSession} from "@/components/booking-intent/prompt-api";
import {recognizeScreenshotText} from "@/components/booking-intent/tesseract-ocr";
import {BOTH_CURVE_BOSSES} from "@/host/dawnhub-booking-form";
import {getErrorMessage} from "@/utils/error-message";

/**
 * How full one set of buyer slots is: a curve raid reports one of these per boss, every other raid type a
 * single one for the raid as a whole (`boss` ""). Kept as counts rather than as a ready-made string so the
 * panel's raid list can color each boss on its own, the way Dawnhub's own raid list does (see raidFullness).
 */
export interface RaidFullness {
    /** The boss these slots belong to - "" for a raid sold whole rather than by boss. */
    boss: string
    booked: number
    /** 0 when Dawnhub reports no usable slot count, in which case nothing is flagged off it. */
    slots: number
    /** How the panel's raid list flags this count: "full" once every slot is taken - what Dawnhub's own raid
     *  list turns red - "ahead" for a boss booked a good deal further than the raid's other one, so the gap
     *  between them shows without comparing the numbers, and "" for a count worth no attention. */
    emphasis: "" | "full" | "ahead"
}

export interface OpenRaidSummary {
    id: string
    name: string
    dateTime: string
    difficulty: string
    loot: string
    /** How full the raid is, as the panel's raid list shows it - one entry, or one per boss for a curve raid.
     *  Display only: nothing is matched against it and it's never sent to the model. */
    fullness: RaidFullness[]
    /** Each boss a curve raid sells, in the order curveSlots lists them (so the penultimate boss first) -
     *  empty for every other raid type, which has no boss to choose. Both the vocabulary the model picks a
     *  mentioned boss from and what that answer is resolved against afterwards (see resolveCurveBoss). */
    curveBosses: string[]
    /** Which armor types are still unbooked, comma-separated (e.g. "Mail, Plate") - "" for a raid where every
     *  armor type still applies (only VIP raids sell by armor type in the first place). Only shown in the
     *  panel's raid list, to tell apart same-time, same-raid VIP entries differing only in what's left to sell. */
    availableArmorTypes: string
    /** Armor types a VIP raid already sold - internal only, used to never auto-pick a VIP raid for a buyer
     *  whose armor type it can no longer take. Empty for every other raid. */
    bookedArmorTypes: ArmorType[]
    /** Absolute ms timestamp - internal only (never shown or sent to the model), used to prefer sooner raids
     *  when matching. See proximityScore(). */
    instant: number
}

/**
 * One booking a message asks for. A single message routinely asks for several - a buyer booking two of their
 * own characters, or one of theirs and a friend's - and each of those is filled into a booking of its own,
 * so a reading is always a list of these rather than a single set of fields.
 */
export interface BookingIntentBooking {
    /** The open raid this booking matched, or "" when none of them did - the panel then leaves its raid
     *  unpicked for the advertiser to choose, rather than guessing one (see matchOpenRaid). */
    raidId: string
    nameRealm: string
    /** The price the buyer mentioned, in thousands of gold as Dawnhub's Pot field takes it - "" if none was. */
    price: string
    /** Which curve boss the message asked for, as one of the names the model was offered (see
     *  distinctCurveBossNames) or {@link BOTH_CURVE_BOSSES} - "" when it singles none out. Left unresolved on
     *  purpose: the raid can still be changed by hand in the panel before the booking is opened, so which of
     *  that raid's bosses this means is only settled at that point (see resolveCurveBoss). */
    mentionedCurveBoss: string
}

export type BookingIntentResult =
    | {status: "unavailable"}
    | {status: "no_raids_open"}
    /** What the message was read as asking for, one entry per buyer character - never empty: a message naming
     *  no character at all still reads as a single booking with a blank nameRealm, which can still have
     *  matched a raid. An entry whose raidId is "" matched no open raid. */
    | {status: "read", bookings: BookingIntentBooking[], raw: unknown}
    | {status: "error", message: string}

/**
 * How much each matched field counts toward a candidate raid's score, how much evidence is required before a
 * raid is ever auto-picked, and how the "prefer sooner, but not too soon" proximity bonus is shaped. A price
 * mentioned in the DM plays no part: without a price list there's nothing to compare it against.
 */
export const BOOKING_INTENT_SCORING = {
    time: 100,
    name: 25,
    difficulty: 20,
    loot: 15,
    proximityMax: 15,
    minMatchScore: 60,
    proximityWindowHours: 3
} as const

/** Pulls a pasted image out of a paste event's clipboard data, ignoring pastes of anything else (e.g. text). */
export function getImageFromClipboard(clipboardData: DataTransfer | null): Blob | null {
    if (!clipboardData) return null
    for (const item of clipboardData.items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
            return item.getAsFile()
        }
    }
    return null
}

/** How much further along - as a share of its own slots - a boss has to be booked than the raid's other boss
 *  before the gap is worth flagging. A third of the raid: enough that an ordinary booking or two ahead stays
 *  unmarked, while something like 3/4 against 1/4 doesn't have to be read off the numbers. */
const AHEAD_FULLNESS_GAP = 1 / 3

function slotCount(slots: string): number {
    const parsed = Number(slots)
    return Number.isFinite(parsed) ? parsed : 0
}

function bookedShare(fullness: {booked: number, slots: number}): number {
    return fullness.slots > 0 ? fullness.booked / fullness.slots : 0
}

function fullnessEmphasis(fullness: {booked: number, slots: number}, raidFullness: {booked: number, slots: number}[]): RaidFullness["emphasis"] {
    if (fullness.slots > 0 && fullness.booked >= fullness.slots) return "full"
    const others = raidFullness.filter(other => other !== fullness)
    if (others.length === 0) return ""
    return others.every(other => bookedShare(fullness) - bookedShare(other) >= AHEAD_FULLNESS_GAP) ? "ahead" : ""
}

/**
 * One count for a raid sold whole, or one per boss for a curve raid - every boss curveSlots defines, not just
 * the ones `booked` happens to have an entry for, since a boss with no booking to its name yet is otherwise
 * silently dropped (which is most of them).
 */
function raidFullness(raid: RaidData): RaidFullness[] {
    const booked = raid.booked
    if (typeof booked === "number") {
        return [{boss: "", booked, slots: slotCount(raid.buyerSlots), emphasis: ""}]
    }
    const counts = (raid.curveSlots ?? []).map(slot => ({
        boss: slot.name,
        booked: booked[slot.name] ?? 0,
        slots: slotCount(slot.slots)
    }))
    return counts.map(count => ({...count, emphasis: fullnessEmphasis(count, counts)}))
}

/** Only meaningful for VIP raids, which sell one armor type at a time - "" for anything else. */
function availableArmorTypesLabel(raid: RaidData, booked: Set<ArmorType>): string {
    if (raid.loot !== "vip") return ""
    return ARMOR_TYPES.filter(armorType => !booked.has(armorType)).map(capitalize).join(", ")
}

/** Every raid actually bookable right now - both what the model's reading is matched against and what backs
 *  the panel's raid list, before restrictOpenRaidsToProximityWindow narrows it down. */
export function summarizeOpenRaids(raids: RaidData[]): OpenRaidSummary[] {
    return raids.filter(raid => raid.status === "active" && hasOpenSlots(raid)).map(raid => {
        const bookedArmorTypes = raid.loot === "vip" ? getBookedArmorTypes(raid) : new Set<ArmorType>()
        return {
            id: raid._id,
            name: getRaidName(raid),
            dateTime: formatRaidTime(raid),
            instant: getRaidInstant(raid),
            difficulty: capitalize(raid.difficulty),
            loot: capitalize(raid.loot),
            fullness: raidFullness(raid),
            curveBosses: raid.type === "curve" ? (raid.curveSlots ?? []).map(slot => slot.name) : [],
            availableArmorTypes: availableArmorTypesLabel(raid, bookedArmorTypes),
            bookedArmorTypes: [...bookedArmorTypes]
        }
    })
}

/** Narrows down to raids starting within the proximity window - a buyer almost always asks about something
 *  starting soon (see proximityScore), so a raid further out than that is usually not worth matching against
 *  or showing by default. Can come back empty even when openRaids isn't - callers should fall back to the
 *  unfiltered list rather than treat that as "nothing is open". */
export function restrictOpenRaidsToProximityWindow(openRaids: OpenRaidSummary[]): OpenRaidSummary[] {
    const {proximityWindowHours} = BOOKING_INTENT_SCORING
    return openRaids.filter(summary => (summary.instant - Date.now()) / 3_600_000 <= proximityWindowHours)
}

const LOG_PREFIX = "[dawnhub-advertiser-tools][booking-intent]"
const LOG_STYLE = "color:#7c5cff;font-weight:600"

/**
 * A collapsed, labeled console group for one model call's request and reply. Kept in production rather than
 * behind a debug flag - being able to see exactly what a real screenshot or message produced is how matching
 * accuracy gets checked and tuned over time - but collapsed and grouped so it doesn't read as a flat wall of
 * text next to everything else the page logs. Only ever written to this browser's own console.
 */
function logExchange(title: string, render: () => void) {
    console.groupCollapsed(`%c${LOG_PREFIX} ${title}`, LOG_STYLE)
    render()
    console.groupEnd()
}

/** Difficulty and loot type are closed vocabularies, not free text like a raid name or a price - constraining
 *  the schema to them (plus "" for not mentioned) rules out the model answering with some other word entirely. */
const DIFFICULTIES: RaidDifficulty[] = ["normal", "heroic", "mythic"]
const LOOT_TYPES: LootType[] = ["saved", "unsaved", "vip"]

/**
 * Just the distinct raid names, not one entry per open raid instance (there can be dozens of those) - a
 * small, mostly-static list, rather than asking the model to choose between the open raids themselves (see
 * the comment above FIELD_INSTRUCTIONS).
 */
function distinctRaidNames(openRaids: OpenRaidSummary[]): string[] {
    return [...new Set(openRaids.map(raid => raid.name).filter(Boolean))]
}

/**
 * The bosses of every open curve raid, as one flat list the model picks a mentioned boss from - the same
 * reasoning as distinctRaidNames, and the same enum treatment as mentionedRaidName. Which of them belong to
 * the raid that's actually booked is sorted out afterwards (see resolveCurveBoss), so this doesn't need the
 * model to know which raid it's answering about. Empty whenever no curve raid is open at all, in which case
 * the field is left out of the prompt and the schema entirely rather than asked about for nothing.
 */
function distinctCurveBossNames(openRaids: OpenRaidSummary[]): string[] {
    return [...new Set(openRaids.flatMap(raid => raid.curveBosses))]
}

/**
 * mentionedRaidName is constrained to an enum, same as difficulty/loot - left as free text, the model would
 * occasionally answer with outright garbage instead of a real raid name or "". "" is included and is the
 * shortest possible answer, so the model's bias toward short answers leans toward the safe "not sure" answer
 * when nothing in the message clearly names one of these raids. mentionedCurveBoss works the same way, which
 * also does most of the work of turning the shorthand buyers write ("Coiled", "Ula") into a real boss name -
 * resolveCurveBoss still compares loosely afterwards, for the answers where it doesn't.
 */
function buildBookingSchema(openRaids: OpenRaidSummary[]) {
    const curveBossNames = distinctCurveBossNames(openRaids)
    const properties: Record<string, unknown> = {
        mentionedTime: {type: "string"},
        mentionedRaidName: {type: "string", enum: [...distinctRaidNames(openRaids), ""]},
        mentionedDifficulty: {type: "string", enum: [...DIFFICULTIES, ""]},
        mentionedLoot: {type: "string", enum: [...LOOT_TYPES, ""]},
        mentionedPrice: {type: "string"},
        mentionedClass: {type: "string"},
        mentionedArmorType: {type: "string", enum: [...ARMOR_TYPES, ""]},
        nameRealm: {type: "string"}
    }
    if (curveBossNames.length > 0) {
        properties.mentionedCurveBoss = {type: "string", enum: [...curveBossNames, BOTH_CURVE_BOSSES, ""]}
    }
    return {
        type: "object",
        properties,
        // Every field the schema offers is required - the model is told to answer "" rather than leave one
        // out, and keeping the two lists in step by hand is what would eventually go wrong here.
        required: Object.keys(properties),
        additionalProperties: false
    }
}

/**
 * One of the objects above per booking the message asks for, in a plain array - the on-device model compiles
 * this schema into a grammar it has to answer within, so it stays to a handful of basic keywords (an array of
 * flat objects, nothing whose support would have to be taken on trust). How many entries there should be is
 * asked for in words instead (see MULTIPLE_BOOKINGS_INSTRUCTION), and buildResult copes with a model that
 * answers with none of them, or with the same character several times over.
 */
function buildResponseSchema(openRaids: OpenRaidSummary[]) {
    return {
        type: "object",
        properties: {bookings: {type: "array", items: buildBookingSchema(openRaids)}},
        required: ["bookings"],
        additionalProperties: false
    }
}

/**
 * Deliberately asks the model to just read plain facts off the message, rather than asking it to pick the
 * matching raid itself. When asked to choose directly from a list of open raids, Chrome's on-device model
 * kept defaulting to whichever raid came first, almost regardless of what the message actually said - a
 * known weakness of small on-device models. Comparing these plain facts against the open raids afterward
 * (see matchOpenRaid) is both more reliable and can never make up a raid that isn't actually open - and it
 * keeps this prompt small no matter how many raids happen to be open.
 */
const FIELD_INSTRUCTIONS = `- mentionedTime: the raid's own start time as written or clearly implied (e.g. "23:50", "9pm"), else "". This is
  never a chat message timestamp (when something was sent/read) - only a time the buyer is asking or talking
  about for the raid itself.
- mentionedRaidName: whichever of the currently open raids listed below the message is about, else "" if it's
  none of them or no raid is named at all. Never answer with a raid name that isn't in that list.
- mentionedDifficulty: the difficulty mentioned - one of ${DIFFICULTIES.join(", ")} - else "".
- mentionedLoot: the loot type mentioned - one of ${LOOT_TYPES.join(", ")} - else "".
- mentionedPrice: the price/pot agreed or offered, in thousands of gold, as a plain number string (e.g. "200"
  for "200k", "1500" for "1.5m"), else "".
- mentionedClass: the buyer's WoW class if mentioned (e.g. "Death Knight"), else "".
- mentionedArmorType: the armor type mentioned - one of ${ARMOR_TYPES.join(", ")} - else "". Buyers often
  ask about a specific armor type (e.g. "mail at 11:00 still available?") instead of naming a class - that's
  still this field, not mentionedClass.
- nameRealm: the character this entry books, as "Name-Realm", only if clearly and confidently visible, else "".
  This is never the sender's display name shown above a message, or a message timestamp - only a character
  name the buyer actually typed out, together with their realm.`

/** Only asked about when a curve raid is in fact open - most of the time none is, and a field with nothing to
 *  answer it with only makes the prompt longer and the rest of the answers worse. */
const CURVE_BOSS_INSTRUCTION = `- mentionedCurveBoss: which single one of the curve bosses listed below this entry's character is asking for,
  answered with that boss's name exactly as it appears in that list - they usually shorten it to one word of
  the name. Answer "${BOTH_CURVE_BOSSES}" if they ask for both bosses of a raid, or "" if they name no boss at all.`

/**
 * What decides how many entries come back, and the reason the answer is a list at all: buyers routinely book
 * more than one character in a single message - two of their own, or one of theirs and a friend's - and each
 * of those is a booking of its own to fill in. Spelled out at some length because both halves of it can go
 * wrong on a small model: several characters merged into one entry, or a single character split into several.
 */
const MULTIPLE_BOOKINGS_INSTRUCTION = `Answer with one entry per character the message asks to book, in the order they're written: two characters
written on two lines ("Coiled: Foo-Kazzak", "Ula: Bar-TarrenMill") are two entries, never one entry merging
them and never one of them dropped. Characters written out next to each other on one line are one entry each
just the same ("Coiled: Foo-Kazzak & Bar-TarrenMill" is two entries), and whatever that line says about them -
the boss above all - is about every character on it. A message asking for a single character is a single entry,
and one naming no character at all is still a single entry, with nameRealm "". Never add an entry for a
character the message doesn't write out. Whatever the message says once about the run itself - its time, raid,
difficulty, loot type and price - is about every character it books, so answer that on every entry rather than
on the first alone.`

const ACCURACY_INSTRUCTION = `Never guess a field you're not confident about - answer "" instead. If this looks like a raw screenshot
transcription of a chat app rather than plain copy-pasted text, expect it to include sender names and
timestamps mixed in with the actual message text - read past those rather than mistaking them for something
the buyer wrote.`

function buildTextPrompt(dmText: string, openRaids: OpenRaidSummary[]) {
    const raidNames = distinctRaidNames(openRaids)
    const curveBossNames = distinctCurveBossNames(openRaids)
    const fieldInstructions = [FIELD_INSTRUCTIONS, ...(curveBossNames.length > 0 ? [CURVE_BOSS_INSTRUCTION] : [])].join("\n")
    const instructions = [fieldInstructions, MULTIPLE_BOOKINGS_INSTRUCTION, ACCURACY_INSTRUCTION].join("\n\n")
    const raidNamesLine = raidNames.length > 0 ? `\n\nCurrently open raids: ${raidNames.join(", ")}` : ""
    const curveBossNamesLine = curveBossNames.length > 0 ? `\nCurve bosses those raids sell: ${curveBossNames.join(", ")}` : ""
    return `Below is a private message conversation with a buyer about booking a WoW raid run (e.g. from Discord, Battle.net, or in-game whispers), copied and pasted as plain text. Read it and answer with one entry per booking it asks for, each of them holding:\n${instructions}${raidNamesLine}${curveBossNamesLine}\n\nMessage:\n${dmText}`
}

/**
 * Runs the on-device model on a copy-pasted message from a buyer. Reading plain text is faster and far more
 * accurate than reading it off a screenshot - there's no OCR involved, so a stylized display name or a long
 * conversation comes through exactly as typed. Pasting a screenshot (extractBookingIntentFromImage) is for
 * when only an image is at hand.
 */
export async function extractBookingIntentFromText(dmText: string, openRaids: OpenRaidSummary[]): Promise<BookingIntentResult> {
    if (openRaids.length === 0) return {status: "no_raids_open"}

    const availability = await checkPromptApiAvailability()
    if (availability === "unavailable") return {status: "unavailable"}

    const prompt = buildTextPrompt(dmText, openRaids)
    const responseSchema = buildResponseSchema(openRaids)

    let session
    try {
        session = await createRequestSession()
        const responseText = await session.prompt(prompt, {responseConstraint: responseSchema})
        logExchange("read message text", () => {
            console.log("Prompt:\n" + prompt)
            console.log("Schema:", responseSchema)
            console.log("Reply:", responseText)
        })
        return buildResult(JSON.parse(responseText) as unknown, openRaids)
    } catch (error) {
        logExchange("read message text (failed)", () => {
            console.log("Prompt:\n" + prompt)
            console.log("Schema:", responseSchema)
            console.error("Error:", error)
        })
        return {status: "error", message: getErrorMessage(error, "The on-device model failed to respond.")}
    } finally {
        session?.destroy()
    }
}

/**
 * Reads whatever text is visible in a screenshot using Tesseract, a dedicated OCR engine, rather than Chrome's
 * on-device model - see tesseract-ocr.ts for why. The image is passed through untouched - shrinking it first
 * made transcription worse, not better.
 */
async function ocrScreenshotText(image: Blob): Promise<string> {
    try {
        const transcribedText = await recognizeScreenshotText(image)
        logExchange("read screenshot text", () => {
            console.log(`Image: ${image.type}, ${image.size}B`)
            console.log("Transcribed text:\n" + transcribedText)
        })
        return transcribedText
    } catch (error) {
        logExchange("read screenshot text (failed)", () => {
            console.error("Error:", error)
        })
        throw error instanceof Error ? error : new Error("Could not read text from the screenshot.")
    }
}

/**
 * Runs Tesseract on a pasted screenshot - first transcribing its text (ocrScreenshotText), then running that
 * transcription through the same, more accurate path a pasted DM takes (extractBookingIntentFromText).
 */
export async function extractBookingIntentFromImage(image: Blob, openRaids: OpenRaidSummary[]): Promise<BookingIntentResult> {
    if (openRaids.length === 0) return {status: "no_raids_open"}

    const availability = await checkPromptApiAvailability()
    if (availability === "unavailable") return {status: "unavailable"}

    let transcribedText: string
    try {
        transcribedText = await ocrScreenshotText(image)
    } catch (error) {
        return {status: "error", message: getErrorMessage(error, "Could not read text from the screenshot.")}
    }
    return extractBookingIntentFromText(transcribedText, openRaids)
}

interface ExtractedBookingText {
    mentionedTime: string
    mentionedRaidName: string
    mentionedDifficulty: string
    mentionedLoot: string
    mentionedPrice: string
    mentionedClass: string
    mentionedArmorType: string
    nameRealm: string
    mentionedCurveBoss: string
}

function normalizeTime(text: string) {
    const match = /(\d{1,2})[:.](\d{2})/.exec(text)
    return match ? `${match[1]!.padStart(2, "0")}:${match[2]}` : null
}

function normalizeText(text: string) {
    return text.toLowerCase().replace(/[^a-z0-9]/g, "")
}

/** A buyer naming a curve boss hardly ever types it out in full - "Coiled" or "Altar" stands in for "The
 *  Coiled Altar", "Ula" for "Ula'tek" - so either name containing the other is a match, the same loose
 *  comparison scoreCandidate makes on raid names. */
function curveBossMatches(bossName: string, mentionedCurveBoss: string) {
    const boss = normalizeText(bossName)
    const mentioned = normalizeText(mentionedCurveBoss)
    if (!boss || !mentioned) return false
    return boss.includes(mentioned) || mentioned.includes(boss)
}

/**
 * The bosses a booking for `raid` can be split between - empty unless it's a curve raid selling more than one
 * of them, which is the only booking with a boss to choose in the first place: Dawnhub renders boss checkboxes
 * for exactly that case, and none at all for a curve raid down to a single boss or for any other raid type.
 */
export function curveBossChoices(raid: OpenRaidSummary | undefined): string[] {
    return raid && raid.curveBosses.length >= 2 ? raid.curveBosses : []
}

/**
 * Which of `raid`'s own bosses a message singling one out means, as the boss the panel starts off ticked (see
 * BookingIntentEntry.vue): one of the raid's boss names, {@link BOTH_CURVE_BOSSES} when the buyer asked for
 * both, or "" when the message names none - and also when the raid has no boss to choose (curveBossChoices).
 *
 * An answer that fits both of the raid's bosses ("the last one" of a raid whose bosses share a word, say)
 * counts as naming neither, which leaves every boss ticked rather than picking one of them at random.
 */
export function resolveCurveBoss(raid: OpenRaidSummary | undefined, mentionedCurveBoss: string): string {
    const bosses = curveBossChoices(raid)
    if (bosses.length === 0 || !mentionedCurveBoss) return ""
    if (normalizeText(mentionedCurveBoss) === normalizeText(BOTH_CURVE_BOSSES)) return BOTH_CURVE_BOSSES
    const matched = bosses.filter(boss => curveBossMatches(boss, mentionedCurveBoss))
    return matched.length === 1 ? matched[0]! : ""
}

/**
 * A mentioned price in thousands of gold, the unit Dawnhub's Pot field takes - "200", "200k", and "1.5m" all
 * come out as 200, 200 and 1500. The model is asked for a plain number already, but may still echo a suffix.
 */
export function parsePrice(text: string): number | null {
    const match = /^(\d+(?:\.\d+)?)(k|m)?$/i.exec(text.trim().replace(/[,\s]/g, ""))
    if (!match) return null
    const amount = Number(match[1]) * (match[2]?.toLowerCase() === "m" ? 1000 : 1)
    return amount > 0 ? Math.round(amount * 100) / 100 : null
}

/** The buyer's armor type - the one directly mentioned (e.g. "mail at 11:00?") if there is one, else whatever
 *  their class implies. */
function armorTypeFromExtracted(extracted: ExtractedBookingText): ArmorType | null {
    if ((ARMOR_TYPES as string[]).includes(extracted.mentionedArmorType)) return extracted.mentionedArmorType as ArmorType
    return findWowClass(extracted.mentionedClass)?.armorType ?? null
}

/**
 * A small bias toward the sooner of two otherwise-equally-plausible raids - buyers normally ask about runs in
 * the near future, not days out. Highest for a raid starting right now (or one that's just started - still a
 * real candidate), fading out over proximityWindowHours. Capped well below every other signal's weight, so it
 * only ever acts as a tiebreaker or a nudge, never the reason a raid gets picked on its own.
 */
function proximityScore(raid: OpenRaidSummary): number {
    const {proximityMax, proximityWindowHours} = BOOKING_INTENT_SCORING
    const hoursUntil = Math.max(0, (raid.instant - Date.now()) / 3_600_000)
    return proximityMax * Math.max(0, 1 - hoursUntil / proximityWindowHours)
}

function scoreCandidate(raid: OpenRaidSummary, extracted: ExtractedBookingText): number {
    const weights = BOOKING_INTENT_SCORING
    let score = proximityScore(raid)

    const time = normalizeTime(extracted.mentionedTime)
    if (time && time === raid.dateTime) score += weights.time

    if (extracted.mentionedRaidName) {
        const mentioned = normalizeText(extracted.mentionedRaidName)
        const raidName = normalizeText(raid.name)
        if (mentioned && raidName && (raidName.includes(mentioned) || mentioned.includes(raidName))) score += weights.name
    }

    if (extracted.mentionedDifficulty && normalizeText(extracted.mentionedDifficulty) === normalizeText(raid.difficulty)) {
        score += weights.difficulty
    }
    if (extracted.mentionedLoot && normalizeText(extracted.mentionedLoot) === normalizeText(raid.loot)) {
        score += weights.loot
    } else if (extracted.mentionedArmorType && normalizeText(raid.loot) === "vip") {
        // Buyers usually ask about a specific armor type (e.g. "mail at 11:00 still available?") rather than
        // saying "vip" outright, since that's how VIP loot is sold - naming an armor type is just as strong
        // a sign of a VIP run as the word "vip" itself.
        score += weights.loot
    }

    return score
}

/** A VIP raid sells one buyer per armor type - once the buyer's is booked there, it's no longer theirs to take. */
function canTakeBuyer(raid: OpenRaidSummary, buyerArmorType: ArmorType | null) {
    return buyerArmorType === null || !raid.bookedArmorTypes.includes(buyerArmorType)
}

/**
 * Scores every open raid against what the model read off the message and picks the highest-scoring one, if
 * any clears minMatchScore - it can never make up a raid that isn't real (every candidate is genuinely open).
 * A tie is broken by whichever of the tied raids sorts first in openRaids (Array sort is stable) - normally
 * the soonest-starting one, since that's the order Dawnhub lists raids in.
 */
function matchOpenRaid(extracted: ExtractedBookingText, openRaids: OpenRaidSummary[]): OpenRaidSummary | null {
    const buyerArmorType = armorTypeFromExtracted(extracted)
    const scored = openRaids
        .filter(raid => canTakeBuyer(raid, buyerArmorType))
        .map(raid => ({raid, score: scoreCandidate(raid, extracted)}))
        .filter(entry => entry.score >= BOOKING_INTENT_SCORING.minMatchScore)
        .sort((a, b) => b.score - a.score)
    if (scored.length === 0) return null
    return scored[0]!.raid
}

function readExtractedBooking(raw: Record<string, unknown>): ExtractedBookingText {
    const stringField = (key: keyof ExtractedBookingText) => typeof raw[key] === "string" ? raw[key] : ""
    return {
        mentionedTime: stringField("mentionedTime"),
        mentionedRaidName: stringField("mentionedRaidName"),
        mentionedDifficulty: stringField("mentionedDifficulty"),
        mentionedLoot: stringField("mentionedLoot"),
        mentionedPrice: stringField("mentionedPrice"),
        mentionedClass: stringField("mentionedClass"),
        mentionedArmorType: stringField("mentionedArmorType"),
        nameRealm: stringField("nameRealm"),
        mentionedCurveBoss: stringField("mentionedCurveBoss")
    }
}

/**
 * The bookings the model answered with, tidied up: an entry naming no character is only meaningful as the
 * only one (a message that names none still reads as one booking, and can still have picked out a raid), and
 * the same character asked for the same boss twice is one booking however often a model repeats itself inside
 * an array. The same character on two different bosses stays two entries - those genuinely are two bookings.
 */
function readExtractedBookings(response: Record<string, unknown>): ExtractedBookingText[] {
    const rawBookings = Array.isArray(response.bookings) ? response.bookings as unknown[] : []
    const bookings = rawBookings
        .filter((booking): booking is Record<string, unknown> => typeof booking === "object" && booking !== null)
        .map(readExtractedBooking)
    const named = bookings.filter(booking => booking.nameRealm.trim() !== "")
    const alreadyRead = new Set<string>()
    return (named.length > 0 ? named : bookings.slice(0, 1)).filter(booking => {
        const key = `${normalizeText(booking.nameRealm)}|${normalizeText(booking.mentionedCurveBoss)}`
        if (alreadyRead.has(key)) return false
        alreadyRead.add(key)
        return true
    })
}

/** The fields that describe the run rather than the character being booked. */
const RUN_WIDE_FIELDS = ["mentionedTime", "mentionedRaidName", "mentionedDifficulty", "mentionedLoot", "mentionedPrice"] as const

/**
 * Fills each booking's blank run-wide fields in from its siblings. A message states these once ("both at
 * 20:00, 200k each") and then only repeats the character and the boss, so the model routinely answers them on
 * the entry they happened to be written next to and leaves the others' blank - which would leave every
 * booking but one matching no raid at all. A booking that answers a field itself keeps its own answer, so a
 * message that really does ask for two different times still matches two different raids.
 */
function shareRunWideFields(bookings: ExtractedBookingText[]): ExtractedBookingText[] {
    if (bookings.length < 2) return bookings
    return bookings.map(booking => {
        const shared = {...booking}
        for (const field of RUN_WIDE_FIELDS) {
            if (shared[field] === "") shared[field] = bookings.find(other => other[field] !== "")?.[field] ?? ""
        }
        return shared
    })
}

function buildResult(raw: unknown, openRaids: OpenRaidSummary[]): BookingIntentResult {
    if (typeof raw !== "object" || raw === null) return {status: "error", message: "The model returned an unexpected response."}
    const read = readExtractedBookings(raw as Record<string, unknown>)
    // A reading is never empty: a model answering with no bookings at all still leaves the panel one booking
    // to fill in by hand, the same as one that read nothing out of the message it was given.
    const bookings = shareRunWideFields(read.length > 0 ? read : [readExtractedBooking({})])
    return {
        status: "read",
        raw,
        bookings: bookings.map(booking => {
            const price = parsePrice(booking.mentionedPrice)
            return {
                raidId: matchOpenRaid(booking, openRaids)?.id ?? "",
                nameRealm: booking.nameRealm,
                price: price === null ? "" : String(price),
                mentionedCurveBoss: booking.mentionedCurveBoss
            }
        })
    }
}
