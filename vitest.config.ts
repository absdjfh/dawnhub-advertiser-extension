// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';
import vuePlugin from "@vitejs/plugin-vue";

export default defineConfig({
    plugins: [...await WxtVitest(), vuePlugin()],
    test: {
        environment: "happy-dom",
        // On Dawnhub's own origin, the way the content script runs - BASE_URL and every link built from it
        // come out as they do on the real site.
        environmentOptions: {happyDOM: {url: "https://hub.dawn-boosting.com/bookings/raids?type=raid"}},
        setupFiles: ["vitest.setup.ts"],
        coverage: {
            reportsDirectory: ".output/coverage",
            include: [
                'components/**',
                'host/**',
                'utils/**',
            ]
        }
    }
});
