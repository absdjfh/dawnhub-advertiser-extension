import {defineConfig} from 'wxt';
import type {UserManifest} from 'wxt';

/** The public site with the user guide and privacy policy - see hosted/. */
const HOMEPAGE_URL = "https://dawn-adv-tools.rolich.net/"

// See https://wxt.dev/api/config.html
export default defineConfig({
    modules: ['@wxt-dev/module-vue'],
    imports: false, // automatic imports break navigation in Intellij IDEA
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
            // Remembers the open-slots filter and recent raid locks. Raid data is read from
            // the page's own requests (see host/dawnhub-raids-request.ts), so no webRequest permission.
            permissions: ["storage"],
            host_permissions: hostPermissions
        };
        if (mode === "development") {
            manifest.name = '[DEV] ' + manifest.name
        }
        return manifest;
    },
});
