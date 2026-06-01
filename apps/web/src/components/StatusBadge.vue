<script setup lang="ts">
import type { Sheet } from '@/api/index.js'

defineProps<{ status: Sheet['status'] }>()

const labels: Record<string, string> = {
  pending: 'En espera',
  processing: 'Procesando',
  ready: 'Lista',
  failed: 'Error',
}
</script>

<template>
  <span
    :class="{
      'badge bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20': status === 'pending',
      'badge bg-sky-500/10 text-sky-400 ring-1 ring-sky-500/20': status === 'processing',
      'badge bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20': status === 'ready',
      'badge bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20': status === 'failed',
    }"
  >
    <!-- Animated dot for processing -->
    <span
      v-if="status === 'processing'"
      class="relative flex h-1.5 w-1.5"
    >
      <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
      <span class="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-500" />
    </span>
    <span v-else class="h-1.5 w-1.5 rounded-full" :class="{
      'bg-amber-400': status === 'pending',
      'bg-emerald-400': status === 'ready',
      'bg-rose-400': status === 'failed',
    }" />
    {{ labels[status] ?? status }}
  </span>
</template>
