<script setup lang="ts">
import {computed, nextTick, onMounted, onUnmounted, ref} from "vue"
import {reportError} from "@/utils/report-error"
import {fetchRaidsInRange, getRaidDetails, type BookingData, type RaidData} from "@/components/api/dawn-api"
import {findWowClass} from "@/components/wow-classes"
import {BASE_URL} from "@/utils/constants"
import {getBookingPageUrl, getInputValueByLabel} from "@/host/dawnhub-page"
import {capitalize, getRaidName} from "@/utils/raid-utils"
import {formatRaidTime} from "@/utils/raid-time"
import {debounce} from "@/utils/timers"

interface SearchParams {dateFrom: string, dateTo: string, type: string, region: string}
interface SearchMatch {raid: RaidData, booking: BookingData}

const MAX_SHOWN_MATCHES = 200

const searchInput = ref<HTMLInputElement | null>(null)
const term = ref("")
const status = ref("Type to search.")
const cachedRaids = ref<RaidData[] | null>(null)
const cachedKey = ref("")
const emit = defineEmits<{close: []}>()

const matches = computed<SearchMatch[]>(() => {
    const normalizedTerm = term.value.trim().toLowerCase()
    if (!normalizedTerm || !cachedRaids.value) return []
    return cachedRaids.value.flatMap(raid => (raid.bookings ?? [])
        .filter(booking => booking.nameRealm?.trim().toLowerCase() !== "encrypted" && booking.nameRealm?.toLowerCase().includes(normalizedTerm))
        .map(booking => ({raid, booking})))
})

onMounted(async () => {
    document.addEventListener("keydown", onKeydown)
    await nextTick()
    searchInput.value?.focus()
    await ensureDataLoaded()
})

onUnmounted(() => {
    document.removeEventListener("keydown", onKeydown)
    queueSearch.cancel()
})

function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") close()
}

function close() {
    emit("close")
}

async function refresh() {
    cachedKey.value = ""
    cachedRaids.value = null
    status.value = "Refreshing raid data..."
    await ensureDataLoaded()
    await runSearch()
}

const queueSearch = debounce(() => void runSearch(), 150)

async function runSearch() {
    await ensureDataLoaded()
    if (!term.value.trim()) {
        status.value = cachedRaids.value ? `Loaded ${cachedRaids.value.length} raids. Type to search.` : "Type to search."
    } else if (!cachedRaids.value) {
        status.value = "Loading raid data..."
    } else {
        status.value = matches.value.length ? `Found ${matches.value.length} bookings.` : "No matches found."
    }
}

async function ensureDataLoaded() {
    const params = getSearchParamsFromPage()
    if (!params) {
        status.value = "Unable to find the date range on the page."
        cachedRaids.value = []
        return
    }
    const key = `${params.dateFrom}|${params.dateTo}|${params.type}|${params.region}`
    if (key === cachedKey.value && cachedRaids.value) return
    cachedKey.value = key
    cachedRaids.value = null
    status.value = "Loading raid data..."
    try {
        cachedRaids.value = await fetchRaidSearchData(params)
        status.value = `Loaded ${cachedRaids.value.length} raids. Type to search.`
    } catch (error) {
        reportError("Failed to load raid search data", error)
        status.value = "Failed to load raid data. Try again."
        cachedRaids.value = []
    }
}

/** The same range Dawnhub's own raids list shows - its Start Date / End Date filters and region/type tab. */
function getSearchParamsFromPage(): SearchParams | null {
    const start = getInputValueByLabel("Start Date")
    const end = getInputValueByLabel("End Date")
    if (!start || !end) return null
    const url = new URL(window.location.href)
    return {
        dateFrom: `${formatApiDate(start)} 00:00:00`,
        dateTo: `${formatApiDate(end)} 23:59:59`,
        type: url.searchParams.get("type") ?? "raid",
        region: url.searchParams.get("region") ?? "eu"
    }
}

function formatApiDate(value: string) {
    const [day, month, year] = value.split("/")
    return day && month && year ? `${year}-${month}-${day}` : value
}

/** The raids list leaves bookings out for some raids; those are completed from each raid's own details. */
async function fetchRaidSearchData(params: SearchParams) {
    const raids = await fetchRaidsInRange(params)
    const incompleteRaids = raids.filter(raid => !raid.bookings)
    if (incompleteRaids.length === 0) return raids
    const detailedRaids = await Promise.all(incompleteRaids.map(raid => getRaidDetails(raid._id)))
    const detailsById = new Map(detailedRaids.map(raid => [raid._id, raid]))
    return raids.map(raid => detailsById.get(raid._id) ?? raid)
}

function raidLink(raid: RaidData) {
    return BASE_URL ? getBookingPageUrl(BASE_URL, raid._id) : undefined
}

function classLabel(className: string) {
    return findWowClass(className)?.label ?? className
}
</script>

<template>
    <div class="dat-search-row">
        <div class="dat-search-popup" role="dialog" aria-label="Find a buyer">
            <div class="dat-search-header-row">
                <div class="dat-search-header">Find a buyer by Name-Realm</div>
                <button class="dat-search-action" type="button" @click="refresh">Refresh</button>
                <button class="dat-search-action" type="button" @click="close">Close</button>
            </div>
            <input ref="searchInput" v-model="term" class="dat-search-input" type="text" placeholder="Type a name-realm (partial match)" @input="queueSearch">
            <div class="dat-search-status" role="status">{{ status }}</div>
            <div class="dat-search-results">
                <div v-for="match in matches.slice(0, MAX_SHOWN_MATCHES)" :key="`${match.raid._id}-${match.booking._id}`" class="dat-search-result">
                    <a class="dat-search-link" :href="raidLink(match.raid)" target="_blank">{{ formatRaidTime(match.raid) }} - {{ getRaidName(match.raid) }} - {{ capitalize(match.raid.difficulty) }} - {{ match.raid.groupType }}</a>
                    <div class="dat-search-meta">{{ match.booking.nameRealm }}{{ match.booking.advertiserName ? ' - ' + match.booking.advertiserName : '' }} - {{ classLabel(match.booking.class) }} - pot {{ match.booking.pot }}k - deposit {{ match.booking.deposit }}k - paid: {{ capitalize(match.booking.paid) }} - source {{ match.booking.source.toUpperCase() }}</div>
                </div>
                <div v-if="matches.length > MAX_SHOWN_MATCHES" class="dat-search-more">Showing first {{ MAX_SHOWN_MATCHES }} of {{ matches.length }} matches.</div>
            </div>
        </div>
    </div>
</template>
