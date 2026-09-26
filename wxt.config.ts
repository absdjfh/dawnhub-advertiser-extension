import {defineConfig} from 'wxt';
import type {UserManifest} from 'wxt';

/** The public site with the user guide and privacy policy - see hosted/. */
const HOMEPAGE_URL = "https://dawn-adv-tools.rolich.net/"

// See https://wxt.dev/api/config.html
export default defineConfig({
    modules: ['@wxt-dev/module-vue'],
    imports: false, // automatic imports break navigation in Intellij IDEA
    // Chrome only: features are free to use Chrome's on-device Prompt API (filling a booking from a DM does),
    // which no other browser has.
    targetBrowsers: ["chrome"],
    vite: ({mode}) => ({
        build: {
            sourcemap: mode === "development" ? "inline" : false,
        }
    }),
    manifestVersion: 3,
    manifest: ({mode}) => {
        const hostPermissions = [
            "https://hub.dawn-boosting.com/*",
            "https://devhub.dawn-boosting.com/*",
        ]
        const manifest: UserManifest = {
            name: "Dawnhub Advertiser Tools",
            homepage_url: HOMEPAGE_URL,
            // Only for remembering the "Show only raids with slots available" tick. Raid data is read from
            // the page's own requests (see host/dawnhub-raids-request.ts), so no webRequest permission.
            permissions: ["storage"],
            host_permissions: hostPermissions,
            // The OCR step runs Tesseract in a worker created from Dawnhub's own page (a blob: URL, so the
            // worker can be constructed at all - see tesseract-ocr.ts). The worker/core/language files it
            // loads from the extension via importScripts need to be reachable from that page, hence
            // web_accessible_resources, scoped to exactly the files and origins that need it.
            web_accessible_resources: [{
                resources: ["tesseract/*"],
                matches: hostPermissions
            }]
        };
        if (mode === "development") {
            manifest.name = '[DEV] ' + manifest.name
        }
        return manifest;
    },
});
