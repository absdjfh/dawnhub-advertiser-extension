import Toast from "@/components/ui/Toast.vue";
import {reactive} from "#imports";
import {mountComponent} from "@/utils/mount-vue";

const TOAST_DURATION_MS = 8000

const state = reactive<{toasts: {id: number, message: string, type: ToastType}[]}>({toasts: []})

let root: HTMLDivElement | null = null
let nextId = 0

export type ToastType = "error" | "success"

/**
 * Shows a brief, non-blocking notification in place of a blocking `alert()`. Callable from anywhere - Vue
 * components, plain modules, and content scripts alike - since it owns its own Vue island rather than relying
 * on one already being mounted.
 */
export function showToast(message: string, type: ToastType = "error") {
    if (!canRender()) {
        console.error(message)
        return
    }
    mount()
    const id = nextId++
    state.toasts.push({id, message, type})
    setTimeout(() => dismiss(id), TOAST_DURATION_MS)
}

function dismiss(id: number) {
    const index = state.toasts.findIndex(toast => toast.id === id)
    if (index !== -1) state.toasts.splice(index, 1)
}

function canRender() {
    return typeof document !== "undefined" && typeof window !== "undefined" && Boolean(document.body)
}

function mount() {
    if (root?.isConnected) return
    root = document.createElement("div")
    root.className = "dat-toast-root"
    document.body.appendChild(root)
    mountComponent(Toast, {state, onDismiss: dismiss}, root)
}
