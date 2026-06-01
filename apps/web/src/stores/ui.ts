import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: string
  type: ToastType
  message: string
}

export const useUiStore = defineStore('ui', () => {
  const toasts = ref<Toast[]>([])

  function addToast(type: ToastType, message: string, duration = 5000) {
    const id = crypto.randomUUID()
    toasts.value.push({ id, type, message })
    setTimeout(() => removeToast(id), duration)
  }

  function removeToast(id: string) {
    const idx = toasts.value.findIndex((t) => t.id === id)
    if (idx !== -1) toasts.value.splice(idx, 1)
  }

  const toast = {
    success: (msg: string) => addToast('success', msg),
    error: (msg: string) => addToast('error', msg),
    info: (msg: string) => addToast('info', msg),
    warning: (msg: string) => addToast('warning', msg),
  }

  return { toasts, toast, removeToast }
})
