<script setup lang="ts">
import {onMounted, ref} from "vue"
import {checkPromptApiAvailability, downloadModel, type LanguageModelAvailability} from "@/components/booking-intent/prompt-api"
import {GUIDE_URL, HOMEPAGE_URL} from "@/utils/constants"
import {getErrorMessage} from "@/utils/error-message"

const RAIDS_URL = "https://hub.dawn-boosting.com/bookings/raids?type=raid"
const PRIVACY_URL = `${HOMEPAGE_URL}/privacy.html`
const REQUIREMENTS_URL = `${GUIDE_URL}#requirements`

/** Every tool the extension adds, each linked to its own section of the user guide. */
const TOOLS = [
    {name: "Fill booking from a DM", description: "Paste a buyer's DM on Dawnhub to fill in their booking.", anchor: "fill-from-dm"},
    {name: "Find a buyer", description: "See which raids a character is booked into.", anchor: "find-a-buyer"},
    {name: "Raids with slots available", description: "Hide every raid that's already full.", anchor: "slots-available"},
    {name: "Raid time links", description: "Middle-click a raid's time to open it in a new tab.", anchor: "raid-links"},
    {name: "Late starts", description: "See when a raid will likely start when the raid before it runs late.", anchor: "late-starts"},
]
// Bound rather than written into the template, where Vue would turn it into a module import of the file.
const ICON_URL = "/icon/48.png"

const availability = ref<LanguageModelAvailability | "checking">("checking")
const downloadProgress = ref<number | null>(null)
const downloadError = ref("")

onMounted(async () => {
    availability.value = await checkPromptApiAvailability().catch(() => "unavailable" as const)
})

/** A click is what Chrome requires before it starts the download - hence a button rather than doing it on open. */
async function startDownload() {
    downloadError.value = ""
    downloadProgress.value = 0
    availability.value = "downloading"
    try {
        await downloadModel(fraction => { downloadProgress.value = fraction })
        availability.value = "available"
    } catch (error) {
        downloadError.value = getErrorMessage(error, "The download could not be started.")
        availability.value = await checkPromptApiAvailability().catch(() => "unavailable" as const)
    } finally {
        downloadProgress.value = null
    }
}
</script>

<template>
    <main class="popup">
        <header class="popup-header">
            <img :src="ICON_URL" alt="" width="32" height="32">
            <div>
                <h1>Dawnhub Advertiser Tools</h1>
                <p>Tools for Dawnhub advertisers</p>
            </div>
        </header>

        <p class="open-dawnhub">Your tools are on Dawnhub's <a :href="RAIDS_URL" target="_blank" rel="noopener">raids list</a> and each raid's own page.</p>

        <ul class="tools">
            <li v-for="tool in TOOLS" :key="tool.anchor">
                <a :href="`${GUIDE_URL}#${tool.anchor}`" target="_blank" rel="noopener">{{ tool.name }}</a>
                <span>{{ tool.description }}</span>
            </li>
        </ul>

        <h2 class="status-heading">Fill booking from a DM</h2>
        <section class="status" :class="`status--${availability}`" aria-live="polite">
            <span class="status-dot" aria-hidden="true"></span>
            <div class="status-text">
                <template v-if="availability === 'checking'">Checking Chrome's on-device AI…</template>
                <template v-else-if="availability === 'available'"><strong>On-device AI is ready.</strong> DMs are read on this computer.</template>
                <template v-else-if="availability === 'downloadable'">
                    <strong>One-time download needed.</strong> Chrome's on-device AI model isn't on this computer yet.
                    <button type="button" class="status-action" @click="startDownload">Download now</button>
                </template>
                <template v-else-if="availability === 'downloading'">
                    <strong>Downloading the on-device AI model…</strong>
                    <span v-if="downloadProgress !== null" class="progress" role="progressbar" :aria-valuenow="Math.round(downloadProgress * 100)" aria-valuemin="0" aria-valuemax="100">
                        <span class="progress-bar" :style="{width: `${Math.round(downloadProgress * 100)}%`}"></span>
                    </span>
                    <span v-else>It continues in the background - you can close this.</span>
                </template>
                <template v-else>
                    <strong>On-device AI isn't available here.</strong> You can still pick the raid and fill the fields
                    yourself. <a :href="REQUIREMENTS_URL" target="_blank" rel="noopener">What does it need?</a>
                </template>
                <p v-if="downloadError" class="status-error">{{ downloadError }}</p>
            </div>
        </section>


        <footer class="links">
            <a :href="GUIDE_URL" target="_blank" rel="noopener">User guide</a>
            <a :href="PRIVACY_URL" target="_blank" rel="noopener">Privacy policy</a>
        </footer>
    </main>
</template>

<style>
body {
    margin: 0;
    background: #ffffff;
    color: #1d2939;
    font: 13px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
</style>

<style scoped>
.popup {
    width: 340px;
    padding: 16px;
    box-sizing: border-box;
}

.popup-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
}

.popup-header img {
    border-radius: 8px;
}

h1 {
    margin: 0;
    font-size: 15px;
    letter-spacing: -0.01em;
}

.popup-header p {
    margin: 0;
    color: #667085;
    font-size: 12px;
}

.status {
    display: flex;
    margin-bottom: 14px;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid #e4e7ec;
    border-radius: 10px;
    background: #f9fafb;
}

.status-dot {
    flex: 0 0 auto;
    width: 9px;
    height: 9px;
    margin-top: 5px;
    border-radius: 50%;
    background: #98a2b3;
}

.status--available .status-dot { background: #12b76a; }
.status--downloadable .status-dot, .status--downloading .status-dot { background: #f79009; }
.status--unavailable .status-dot { background: #f04438; }

.status-text {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
}

.status-action {
    align-self: flex-start;
    padding: 5px 12px;
    border: 0;
    border-radius: 6px;
    background: linear-gradient(135deg, #7c5cff, #5b3fe0);
    color: #ffffff;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
}

.status-action:hover {
    filter: brightness(1.08);
}

.status-error {
    margin: 0;
    color: #b42318;
}

.progress {
    display: block;
    height: 6px;
    border-radius: 3px;
    background: #e4e7ec;
    overflow: hidden;
}

.progress-bar {
    display: block;
    height: 100%;
    background: #7c5cff;
    transition: width 200ms ease;
}

.open-dawnhub {
    margin: 0 0 10px;
    color: #344054;
}

.tools {
    margin: 0 0 14px;
    padding: 0;
    list-style: none;
}

.tools li {
    display: flex;
    flex-direction: column;
    padding: 7px 0;
    border-top: 1px solid #f2f4f7;
}

.tools a {
    font-weight: 600;
    text-decoration: none;
}

.tools a:hover {
    text-decoration: underline;
}

.tools span {
    color: #667085;
    font-size: 12px;
}

.status-heading {
    margin: 0 0 6px;
    color: #344054;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

a {
    color: #6941c6;
}

.links {
    display: flex;
    gap: 16px;
    padding-top: 12px;
    border-top: 1px solid #e4e7ec;
}

.links a {
    font-weight: 600;
    text-decoration: none;
}

.links a:hover {
    text-decoration: underline;
}
</style>
