<script setup lang="ts">
import {computed, nextTick, onMounted, onUnmounted, ref, watch} from "vue"
import {
    extractBookingIntentFromImage,
    extractBookingIntentFromText,
    getImageFromClipboard,
    type BookingIntentBooking,
    type BookingIntentResult,
    type OpenRaidSummary
} from "@/components/booking-intent/booking-intent"
import {checkPromptApiAvailability, type LanguageModelAvailability} from "@/components/booking-intent/prompt-api"
import type {BookingFillFields} from "@/components/booking-intent/pending-booking"
import BookingIntentEntry from "@/components/ui/booking-intent/BookingIntentEntry.vue"
import {createBookingEntry, fillBookingEntry, type BookingEntry} from "@/components/ui/booking-intent/booking-entry"
import {GUIDE_URL} from "@/utils/constants"
import {getErrorMessage} from "@/utils/error-message"
import {getPasteModifierLabel} from "@/utils/platform"

type PastedInput = {kind: "image", image: Blob} | {kind: "text", text: string}

const props = defineProps<{
    /** What the model matches against and what the raid lists show by default - already narrowed down to
     *  raids starting soon (see openBookingIntentPanel). May be a strict subset of allOpenRaids, in which case
     *  the lists offer a "show all raids" link to fall back to it. */
    openRaids: OpenRaidSummary[]
    /** Every raid with a slot open right now, with none of openRaids' narrowing applied. */
    allOpenRaids: OpenRaidSummary[]
    /** The raid whose own page this is, when it's one of the open raids - a booking starts on it, and a
     *  confident match from a pasted DM still replaces it (unlike a raid picked by hand, which never is). */
    preselectedRaidId: string | null
    initialImage: Blob | null
    /** Opens one booking in a tab of its own with its fields waiting there - see booking-intent-panel.ts. */
    openBooking: (fields: BookingFillFields) => Promise<void>
}>()
const emit = defineEmits<{close: []}>()

const REQUIREMENTS_URL = `${GUIDE_URL}#requirements`
const pasteModifier = getPasteModifierLabel()

// Once true, stays true for the rest of the panel's lifetime - there's no going back to the trimmed list.
const showAllRaids = ref(false)
const raidOptions = computed(() => showAllRaids.value ? props.allOpenRaids : props.openRaids)
const isRaidListTrimmed = computed(() => !showAllRaids.value && props.openRaids.length < props.allOpenRaids.length)

const availability = ref<LanguageModelAvailability | "checking">("checking")
const pasted = ref<PastedInput | null>(props.initialImage ? {kind: "image", image: props.initialImage} : null)
const imageUrl = ref<string | null>(null)
const extracting = ref(false)
const result = ref<BookingIntentResult | null>(null)
const draggingOver = ref(false)
const panelWindow = ref<HTMLElement | null>(null)

// The bookings to fill in, one set of fields each - a message asking for several characters becomes several
// of these, each opened into a booking form of its own. Starts as a single booking, fillable from the moment
// the panel opens whether or not anything's been pasted yet: the on-device model can be slow (or unavailable),
// and the advertiser shouldn't be blocked waiting on it.
const entries = ref<BookingEntry[]>([createBookingEntry(props.preselectedRaidId ?? "")])

/** What was read out of the last paste, or null while nothing has been read (or it failed). */
const readBookings = computed(() => result.value?.status === "read" ? result.value.bookings : null)
const unmatchedBookings = computed(() => readBookings.value?.filter(booking => !booking.raidId).length ?? 0)
const isDownloadingModel = computed(() => availability.value === "downloadable" || availability.value === "downloading")

function addEntry(raidId: string) {
    entries.value.push(createBookingEntry(raidId))
    // The entry as the list now holds it, rather than the one just built: what callers go on to fill in has
    // to be the reactive one, or the fields they set never reach the screen.
    return entries.value[entries.value.length - 1]!
}

/** A booking to fill in from scratch - for a character the reading missed, or before anything is pasted. */
function addEntryByHand() {
    addEntry(props.preselectedRaidId ?? "")
}

function removeEntry(entry: BookingEntry) {
    entries.value = entries.value.filter(other => other.key !== entry.key)
}

/**
 * Drops the bookings already opened in a tab of their own - they're done with. The panel stays open after a
 * booking is opened, so the next message is routinely pasted into a panel still showing the last one's
 * bookings; leaving those in would line the new message up against them. A booking that was never opened is
 * kept, filled in by hand or not - nothing about a new paste says the advertiser is done with it.
 */
function dropOpenedEntries() {
    entries.value = entries.value.filter(entry => !entry.opened)
    if (entries.value.length === 0) addEntryByHand()
}

watch(pasted, (newValue, oldValue) => {
    if (oldValue?.kind === "image" && imageUrl.value) URL.revokeObjectURL(imageUrl.value)
    imageUrl.value = newValue?.kind === "image" ? URL.createObjectURL(newValue.image) : null
    if (newValue) void runExtraction(newValue)
}, {immediate: true})

onMounted(async () => {
    document.addEventListener("keydown", onKeydown)
    document.addEventListener("paste", onPaste)
    await nextTick()
    panelWindow.value?.focus({preventScroll: true})
    availability.value = await checkPromptApiAvailability()
})

onUnmounted(() => {
    document.removeEventListener("keydown", onKeydown)
    document.removeEventListener("paste", onPaste)
    if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
})

function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") close()
}

function onPaste(event: ClipboardEvent) {
    const pastedImage = getImageFromClipboard(event.clipboardData)
    if (pastedImage) {
        event.preventDefault()
        pasted.value = {kind: "image", image: pastedImage}
        return
    }
    // Pasting text directly into one of this panel's own inputs (Name-Realm, Pot) should just paste into that
    // field like normal - only treat a text paste as a new DM when it didn't land in one.
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
    const text = event.clipboardData?.getData("text/plain").trim()
    if (!text) return
    event.preventDefault()
    pasted.value = {kind: "text", text}
}

/** A screenshot saved to a file, dragged in from Explorer/Finder or straight from a chat app. */
function onDrop(event: DragEvent) {
    draggingOver.value = false
    const image = Array.from(event.dataTransfer?.files ?? []).find(file => file.type.startsWith("image/"))
    if (image) {
        pasted.value = {kind: "image", image}
        return
    }
    const text = event.dataTransfer?.getData("text/plain").trim()
    if (text) pasted.value = {kind: "text", text}
}

/**
 * Lines what was read up with the bookings already on screen: the first reading fills the first booking, the
 * second the one after it, and anything read beyond the bookings there adds one of its own - so a message
 * asking for four characters ends up as four bookings to check and open one after the other. Bookings are
 * only ever filled where they're still blank (see fillBookingEntry), which keeps a single booking behaving
 * as it always has, including when the advertiser typed into it while the message was being read.
 */
function fillEntriesFromReading(bookings: BookingIntentBooking[]) {
    bookings.forEach((booking, index) => {
        fillBookingEntry(entries.value[index] ?? addEntry(""), booking)
    })
}

async function runExtraction(input: PastedInput) {
    extracting.value = true
    result.value = null
    dropOpenedEntries()
    try {
        const extracted = input.kind === "image"
            ? await extractBookingIntentFromImage(input.image, props.openRaids)
            : await extractBookingIntentFromText(input.text, props.openRaids)
        result.value = extracted
        if (extracted.status === "read") fillEntriesFromReading(extracted.bookings)
    } finally {
        extracting.value = false
    }
}

function close() {
    emit("close")
}

/**
 * Opens one booking in a tab of its own, leaving the panel up and every other booking untouched - so the
 * ones read alongside it can still be checked and opened afterwards.
 */
async function openEntry(entry: BookingEntry, fields: BookingFillFields) {
    try {
        await props.openBooking(fields)
        entry.opened = true
    } catch (error) {
        entry.error = `Could not open this booking: ${getErrorMessage(error)}`
    }
}
</script>

<template>
    <div class="dat-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="dat-booking-intent-title" @click.self="close">
        <section
            ref="panelWindow"
            class="dat-dialog dat-booking-intent"
            tabindex="-1"
            @dragover.prevent="draggingOver = true"
            @dragleave.self="draggingOver = false"
            @drop.prevent="onDrop"
        >
            <header class="dat-dialog-header">
                <div>
                    <h2 id="dat-booking-intent-title">Fill booking from a DM</h2>
                    <p class="dat-dialog-subtitle">Read entirely on your device - nothing is uploaded.</p>
                </div>
                <button type="button" class="dat-dialog-close" aria-label="Close" @click="close">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
            </header>

            <p v-if="availability === 'unavailable'" class="dat-notice dat-notice--warning">
                Chrome's on-device AI isn't available in this browser or on this device, so DMs can't be read
                automatically - fill in the fields below yourself.
                <a :href="REQUIREMENTS_URL" target="_blank" rel="noopener">What does it need?</a>
            </p>
            <div v-else-if="!pasted" class="dat-dropzone" :class="{'dat-dropzone--active': draggingOver}">
                <svg class="dat-dropzone-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                    <rect x="8" y="2" width="8" height="4" rx="1"/>
                    <path d="M8 12h8M8 16h5"/>
                </svg>
                <strong>Paste the buyer's DM</strong>
                <span>Press <kbd>{{ pasteModifier }}</kbd>+<kbd>V</kbd> with a screenshot or the copied message text, or drop an image here.
                    Copied text reads more accurately than a screenshot.</span>
            </div>

            <template v-if="pasted">
                <div class="dat-booking-intent-preview">
                    <img v-if="pasted.kind === 'image'" :src="imageUrl!" alt="Pasted screenshot">
                    <pre v-else class="dat-booking-intent-pasted-text">{{ pasted.text }}</pre>
                </div>

                <p v-if="extracting" class="dat-notice dat-notice--progress" role="status">
                    <span class="dat-spinner" aria-hidden="true"></span>
                    {{ isDownloadingModel ? "Downloading Chrome's on-device AI model (first use only), then reading it…" : "Reading it…" }}
                </p>
                <template v-else-if="result">
                    <template v-if="readBookings">
                        <p v-if="unmatchedBookings === readBookings.length" class="dat-notice" role="status">
                            No open raid clearly matches this DM - pick the raid below yourself.
                        </p>
                        <p v-else-if="unmatchedBookings > 0" class="dat-notice" role="status">
                            {{ unmatchedBookings }} of {{ readBookings.length }} bookings matched no open raid - pick a raid for those below, or remove them.
                        </p>
                        <p v-else-if="readBookings.length > 1" class="dat-notice dat-notice--success" role="status">
                            This asks for {{ readBookings.length }} bookings - check each one below, then open it.
                        </p>
                        <p v-else class="dat-notice dat-notice--success" role="status">
                            Found it - check the fields below. Paste again to replace it.
                        </p>
                    </template>
                    <p v-else-if="result.status === 'error'" class="dat-notice dat-notice--error" role="alert">
                        Could not read this: {{ result.message }}
                    </p>
                    <p v-else-if="result.status === 'no_raids_open'" class="dat-notice dat-notice--error" role="alert">
                        No open raids to match against.
                    </p>
                </template>
            </template>

            <div class="dat-bookings-header">
                <span class="dat-field-label">Bookings</span>
                <button type="button" class="dat-link-button" @click="addEntryByHand">Add booking</button>
            </div>
            <div class="dat-bookings">
                <BookingIntentEntry
                    v-for="(entry, index) in entries"
                    :key="entry.key"
                    :entry="entry"
                    :bookings="entries"
                    :label="`Booking ${index + 1}`"
                    :raid-options="raidOptions"
                    :raid-list-trimmed="isRaidListTrimmed"
                    :extracting="extracting"
                    :removable="entries.length > 1"
                    @apply="fields => openEntry(entry, fields)"
                    @remove="removeEntry(entry)"
                    @show-all-raids="showAllRaids = true"
                />
            </div>

            <footer class="dat-dialog-actions">
                <span class="dat-dialog-footnote">Each booking opens in a new tab. Nothing is submitted - you check it first.</span>
                <button type="button" class="dat-button dat-button--secondary" @click="close">Close</button>
            </footer>
        </section>
    </div>
</template>
