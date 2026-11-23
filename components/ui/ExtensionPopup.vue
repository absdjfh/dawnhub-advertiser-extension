<script setup lang="ts">
import {GUIDE_URL, HOMEPAGE_URL} from "@/utils/constants"

const RAIDS_URL = "https://hub.dawn-boosting.com/bookings/raids?type=raid"
const PRIVACY_URL = `${HOMEPAGE_URL}/privacy.html`

/** Every tool the extension adds, each linked to its own section of the user guide. */
const TOOLS = [
    {name: "Find a buyer", description: "See which raids a character is booked into.", anchor: "find-a-buyer"},
    {name: "Raids with slots available", description: "Hide every raid that's already full.", anchor: "slots-available"},
    {name: "Raid time links", description: "Middle-click a raid's time to open it in a new tab.", anchor: "raid-links"},
    {name: "Late starts", description: "See when a raid will likely start when the raid before it runs late.", anchor: "late-starts"},
]
// Bound rather than written into the template, where Vue would turn it into a module import of the file.
const ICON_URL = "/icon/48.png"
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

        <p class="open-dawnhub">Your tools are on Dawnhub's <a :href="RAIDS_URL" target="_blank" rel="noopener">raids list</a>.</p>

        <ul class="tools">
            <li v-for="tool in TOOLS" :key="tool.anchor">
                <a :href="`${GUIDE_URL}#${tool.anchor}`" target="_blank" rel="noopener">{{ tool.name }}</a>
                <span>{{ tool.description }}</span>
            </li>
        </ul>

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
