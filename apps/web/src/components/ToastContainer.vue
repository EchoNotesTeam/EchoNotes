<script setup lang="ts">
import { useUiStore } from '@/stores/ui.js'

const ui = useUiStore()

const icons = {
  success: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.5 12.75l6 6 9-13.5"/>`,
  error: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>`,
  warning: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/>`,
  info: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"/>`,
}
</script>

<template>
  <Teleport to="body">
    <div
      aria-live="polite"
      aria-atomic="false"
      class="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
    >
      <TransitionGroup
        enter-active-class="transition-all duration-300 ease-out"
        enter-from-class="translate-x-8 opacity-0"
        enter-to-class="translate-x-0 opacity-100"
        leave-active-class="transition-all duration-200 ease-in"
        leave-from-class="translate-x-0 opacity-100"
        leave-to-class="translate-x-8 opacity-0"
      >
        <div
          v-for="toast in ui.toasts"
          :key="toast.id"
          role="status"
          :class="{
            'border-emerald-800 bg-emerald-950 text-emerald-200': toast.type === 'success',
            'border-rose-800 bg-rose-950 text-rose-200': toast.type === 'error',
            'border-amber-800 bg-amber-950 text-amber-200': toast.type === 'warning',
            'border-sky-800 bg-sky-950 text-sky-200': toast.type === 'info',
          }"
          class="pointer-events-auto flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 shadow-xl"
        >
          <svg class="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <!-- eslint-disable-next-line vue/no-v-html -->
            <g v-html="icons[toast.type]" />
          </svg>
          <p class="text-sm">{{ toast.message }}</p>
          <button
            class="ml-auto -mr-1 rounded p-0.5 opacity-60 hover:opacity-100 transition-opacity"
            :aria-label="`Cerrar notificación: ${toast.message}`"
            @click="ui.removeToast(toast.id)"
          >
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
