<script setup lang="ts">
import {computed, nextTick, ref, watch} from "vue"
import {curveBossChoices, resolveCurveBoss, type OpenRaidSummary, type RaidFullness} from "@/components/booking-intent/booking-intent"
import type {BookingFillFields} from "@/components/booking-intent/pending-booking"
import {BOTH_CURVE_BOSSES} from "@/host/dawnhub-booking-form"
import {capitalize} from "@/utils/raid-utils"
import type {BookingEntry} from "@/components/ui/booking-intent/booking-entry"
import {runFitMarks} from "@/components/ui/booking-intent/run-fit"

const props = defineProps<{
    /** The booking this collects - held by the panel, filled in here and by whatever it reads. */
    entry: BookingEntry
    /** Every booking in the panel, this one included - a raid has to have room for all of them (see run-fit.ts). */
    bookings: BookingEntry[]
    /** How this booking is named in the panel's list, e.g. "Booking 2". */
    label: string
    /** The raids to pick from, as the panel currently offers them. */
    raidOptions: OpenRaidSummary[]
    /** Whether those are only some of the open raids, in which case the list offers to fall back to all of
     *  them - the panel widens the list for every booking at once. */
    raidListTrimmed: boolean
    /** Whether a pasted screenshot or message is still being read - spinners next to what it may still fill. */
    extracting: boolean
    /** Whether this booking can be dropped - the last one left offers no Remove, so that the panel always has
     *  somewhere to type a booking in by hand. */
    removable: boolean
}>()
const emit = defineEmits<{apply: [fields: BookingFillFields], remove: [], showAllRaids: []}>()

const raid = computed(() => props.raidOptions.find(option => option.id === props.entry.raidId))
/** Radios only group within the same name, and every booking has a raid list of its own - sharing one name
 *  would turn every list on screen into a single group where picking a raid unpicks another booking's. */
const raidGroupName = computed(() => `dat-booking-intent-raid-${props.entry.key}`)
const raidList = ref<HTMLElement | null>(null)

/** Everything a raid row says apart from how full it is, which is shown count by count so each can be colored
 *  on its own (see fullnessClass), and apart from the armor types a VIP raid still has left to sell. */
function raidLabel(option: OpenRaidSummary) {
    return `${option.dateTime} - ${option.name} - ${option.difficulty} ${option.loot}`
}

/** " - Mail, Plate" for a VIP raid, "" for one that doesn't sell by armor type. */
function openArmorTypesLabel(option: OpenRaidSummary) {
    return option.openArmorTypes ? ` - ${option.openArmorTypes.map(capitalize).join(", ")}` : ""
}

/** "Ula'tek: 4/4" for one boss of a curve raid, "4/10" for a raid sold whole rather than by boss. */
function fullnessText(fullness: RaidFullness) {
    const count = `${fullness.booked}/${fullness.slots}`
    return fullness.boss ? `${fullness.boss}: ${count}` : count
}

/** A sold-out boss is shown red, the way Dawnhub's own raid list does - the raid list here is built out of rows
 *  rather than a native <select> precisely so one boss of a raid can be colored without coloring the line. */
function fullnessClass(fullness: RaidFullness) {
    return fullness.emphasis ? `dat-fullness-${fullness.emphasis}` : ""
}

/**
 * Whether the whole raid list is on screen for this booking, rather than just the raid it's set to. One
 * message regularly asks for several bookings at once, and full raid lists stacked on top of each other bury
 * everything below them - so a booking that already has a raid shows that one row until its list is asked
 * for. A booking with no raid yet starts open, since picking one is exactly what's left to do on it.
 */
const picking = ref(!props.entry.raidId)
const shownRaidOptions = computed(() => {
    if (picking.value) return props.raidOptions
    return props.raidOptions.filter(option => option.id === props.entry.raidId)
})

/** The raids on screen that may not take this booking, and why - see run-fit.ts. */
const fitMarks = computed(() => new Map(shownRaidOptions.value.map(option => [option.id, runFitMarks(option, props.entry, props.bookings)])))

// Settling on a raid closes the list again - whether it was clicked here or filled in from a message read
// while this booking was still waiting for one.
watch(() => props.entry.raidId, raidId => {
    picking.value = !raidId
})

// The raid a booking is set to can be well down a long list - bring it into view when the list opens.
watch(picking, async opened => {
    if (!opened) return
    await nextTick()
    raidList.value?.querySelector(".dat-raid-option-picked")?.scrollIntoView({block: "nearest"})
})

/** The bosses the picked raid can be booked for, each shown as a checkbox - empty for every raid that has no
 *  boss to choose, which is most of them (see curveBossChoices). */
const curveBosses = computed(() => curveBossChoices(raid.value))

/** Ticks the boss the message was read as asking for, so the advertiser can see what it made of it and
 *  correct it before the booking is opened - every boss of the raid when it singled none of them out. */
function resetCurveBossTicks() {
    const readBoss = resolveCurveBoss(raid.value, props.entry.mentionedCurveBoss)
    props.entry.checkedCurveBosses = readBoss && readBoss !== BOTH_CURVE_BOSSES ? [readBoss] : [...curveBosses.value]
}

watch(() => props.entry.raidId, () => {
    props.entry.curveBossesPickedByHand = false
    resetCurveBossTicks()
}, {immediate: true})

watch(() => props.entry.mentionedCurveBoss, () => {
    if (!props.entry.curveBossesPickedByHand) resetCurveBossTicks()
})

function curveBossToggled() {
    props.entry.curveBossesPickedByHand = true
    props.entry.error = ""
}

function raidPicked() {
    props.entry.raidPickedByHand = true
    props.entry.error = ""
}

/** What the ticked boxes mean to the booking form: the single boss ticked, {@link BOTH_CURVE_BOSSES} when
 *  both are, or "" for a raid with no boss to choose. */
function pickedCurveBoss() {
    if (curveBosses.value.length === 0) return ""
    return props.entry.checkedCurveBosses.length === 1 ? props.entry.checkedCurveBosses[0]! : BOTH_CURVE_BOSSES
}

function apply() {
    if (!props.entry.raidId) {
        props.entry.error = "Select a raid before continuing."
        return
    }
    if (curveBosses.value.length > 0 && props.entry.checkedCurveBosses.length === 0) {
        props.entry.error = "Tick at least one boss before continuing."
        return
    }
    const price = props.entry.price.trim()
    if (price && !/^\d+(\.\d+)?$/.test(price)) {
        props.entry.error = "Pot must be a number, in thousands of gold (e.g. 250 for 250k)."
        return
    }
    props.entry.error = ""
    emit("apply", {
        raidId: props.entry.raidId,
        nameRealm: props.entry.nameRealm.trim(),
        price,
        curveBoss: pickedCurveBoss()
    })
}
</script>

<template>
    <section class="dat-booking-entry" :aria-label="label">
        <div class="dat-booking-entry-header">
            <span class="dat-booking-entry-label">
                {{ label }}
                <span v-if="entry.opened" class="dat-booking-entry-opened">opened in a new tab</span>
            </span>
            <span class="dat-booking-entry-actions">
                <button v-if="removable" type="button" class="dat-button dat-button--small dat-button--secondary" @click="emit('remove')">Remove</button>
                <button type="button" class="dat-button dat-button--small dat-button--primary" @click="apply">Open &amp; fill</button>
            </span>
        </div>

        <div class="dat-field-group">
            <span class="dat-field-label">
                Raid
                <span v-if="extracting" class="dat-spinner" title="Filling in automatically once read…"></span>
                <button v-if="entry.raidId" type="button" class="dat-link-button" @click="picking = !picking">{{ picking ? "keep this raid" : "change raid" }}</button>
                <button v-if="raidListTrimmed && picking" type="button" class="dat-link-button" @click="emit('showAllRaids')">show all raids</button>
            </span>
            <div ref="raidList" class="dat-raid-options" role="radiogroup" aria-label="Raid">
                <label v-for="option in shownRaidOptions" :key="option.id" class="dat-raid-option" :class="{'dat-raid-option-picked': option.id === entry.raidId}">
                    <input v-model="entry.raidId" type="radio" :name="raidGroupName" :value="option.id" @change="raidPicked">
                    <span>
                        <span class="dat-raid-option-summary">{{ raidLabel(option) }} (<template v-for="(fullness, index) in option.fullness" :key="fullness.boss">{{ index > 0 ? ", " : "" }}<span :class="fullnessClass(fullness)">{{ fullnessText(fullness) }}</span></template>){{ openArmorTypesLabel(option) }}</span>
                        <span v-for="mark in fitMarks.get(option.id)" :key="mark.text" class="dat-fit-mark" :class="`dat-fit-${mark.kind}`" :title="mark.reason">{{ mark.text }}</span>
                    </span>
                </label>
                <p v-if="shownRaidOptions.length === 0" class="dat-raid-options-empty">No open raids to pick from.</p>
            </div>
        </div>
        <div v-if="curveBosses.length > 0" class="dat-field-group">
            <span class="dat-field-label">
                Bosses
                <span v-if="extracting" class="dat-spinner" title="Filling in automatically once read…"></span>
            </span>
            <div class="dat-boss-options">
                <label v-for="boss in curveBosses" :key="boss" class="dat-boss-option">
                    <input v-model="entry.checkedCurveBosses" type="checkbox" :value="boss" @change="curveBossToggled">
                    {{ boss }}
                </label>
            </div>
        </div>
        <div class="dat-fields">
            <label class="dat-field">
                <span class="dat-field-label">
                    Name-Realm
                    <span v-if="extracting" class="dat-spinner" title="Filling in automatically once read…"></span>
                </span>
                <input v-model="entry.nameRealm" type="text" placeholder="e.g. Arthas-Silvermoon" autocomplete="off">
                <span class="dat-field-hint">Dawnhub's own search looks the character up</span>
            </label>
            <label class="dat-field">
                <span class="dat-field-label">
                    Pot
                    <span v-if="extracting" class="dat-spinner" title="Filling in automatically once read…"></span>
                </span>
                <span class="dat-input-suffix">
                    <input v-model="entry.price" type="text" inputmode="decimal" placeholder="Only if the DM names one" autocomplete="off">
                    <span aria-hidden="true">k</span>
                </span>
                <span class="dat-field-hint">Left as Dawnhub has it when blank</span>
            </label>
        </div>

        <p v-if="entry.error" class="dat-notice dat-notice--error" role="alert">{{ entry.error }}</p>
    </section>
</template>
