import {mount, type VueWrapper} from "@vue/test-utils"
import type {Component} from "vue"
import type {PropsOf} from "@/utils/mount-vue"

interface MountOptions<C> {
    props?: PropsOf<C>
    /** Mounts into the page, for a component whose behavior depends on events bubbling up to the document. */
    attachTo?: Element
}

/**
 * @vue/test-utils' `mount` for a `.vue` component. The lint parser cannot resolve `.vue` imports, so there `mount`
 * returns a wrapper typed with `any`, and passing it to a test helper trips the unsafe-argument lint rule; returning a
 * plain `VueWrapper` keeps the helpers typed without any eslint-disable, while props are still checked by vue-tsc.
 */
export function mountVue<C extends Component>(component: C, options: MountOptions<C> = {}): VueWrapper {
    const untypedComponent: Component = component
    return mount(untypedComponent, options as {props?: Record<string, unknown>, attachTo?: Element}) as VueWrapper
}
