import {afterEach} from "vitest"
import {enableAutoUnmount} from "@vue/test-utils"

// Components mounted with @vue/test-utils are unmounted after every test, so the document listeners (Escape,
// paste) and timers they register in onMounted can't leak into the next test.
enableAutoUnmount(afterEach)
