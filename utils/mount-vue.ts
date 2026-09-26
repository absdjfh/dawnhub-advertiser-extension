import type {App, Component} from "vue"
import {createApp} from "#imports"

export interface MountedComponent {
    app: App
    unmount: () => void
}

export type PropsOf<C> = C extends abstract new (...args: never[]) => {$props: infer P} ? P : Record<string, unknown>

/**
 * Mounts a Vue component as its own app on `target` (element or selector). The lint parser cannot resolve `.vue`
 * imports, so passing a component straight to `createApp` trips the unsafe-argument lint rule; taking it as a generic
 * `Component` here keeps the call sites typed (props are checked by vue-tsc) without any eslint-disable.
 */
export function mountComponent<C extends Component>(component: C, props: PropsOf<C>, target: string | Element): MountedComponent {
    const app = createApp(component, props as Record<string, unknown>)
    app.mount(target)
    return {app, unmount: () => app.unmount()}
}
