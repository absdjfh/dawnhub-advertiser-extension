<script setup lang="ts">
import type {ToastType} from "@/utils/toast"

defineProps<{
    state: {toasts: {id: number, message: string, type: ToastType}[]}
}>()
const emit = defineEmits<{dismiss: [id: number]}>()
</script>

<template>
    <div class="dat-toast-container">
        <div
            v-for="toast in state.toasts"
            :key="toast.id"
            class="dat-toast"
            :class="`dat-toast--${toast.type}`"
            :role="toast.type === 'error' ? 'alert' : 'status'"
            @click="emit('dismiss', toast.id)"
        >{{ toast.message }}</div>
    </div>
</template>

<style scoped>
.dat-toast-container {
    position: fixed;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    max-width: min(420px, calc(100vw - 32px));
    pointer-events: none;
}

.dat-toast {
    pointer-events: auto;
    cursor: pointer;
    width: 100%;
    box-sizing: border-box;
    padding: 12px 14px;
    border-radius: var(--pico-border-radius, 8px);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
    font-size: 13px;
    line-height: 1.4;
    white-space: pre-wrap;
}

.dat-toast--error {
    background-color: #fff4f2;
    color: var(--pico-del-color, #b42318);
    border: 1px solid #f3b7ac;
}

.dat-toast--success {
    background-color: #f0faf2;
    color: var(--pico-ins-color, #1a7f37);
    border: 1px solid #a6e3b2;
}
</style>
