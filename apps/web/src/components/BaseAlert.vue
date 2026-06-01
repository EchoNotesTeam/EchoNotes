<script setup lang="ts">
defineProps<{
  type?: 'error' | 'warning' | 'success' | 'info'
  message: string
}>()
</script>

<template>
  <div
    role="alert"
    :class="{
      'border-rose-800 bg-rose-950/60 text-rose-300': type === 'error' || !type,
      'border-amber-800 bg-amber-950/60 text-amber-300': type === 'warning',
      'border-emerald-800 bg-emerald-950/60 text-emerald-300': type === 'success',
      'border-sky-800 bg-sky-950/60 text-sky-300': type === 'info',
    }"
    class="flex items-start gap-3 rounded-lg border px-4 py-3 text-sm"
  >
    <!-- Error icon -->
    <svg v-if="type === 'error' || !type" class="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
    </svg>
    <!-- Warning icon -->
    <svg v-else-if="type === 'warning'" class="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
    </svg>
    <!-- Success icon -->
    <svg v-else-if="type === 'success'" class="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.5 12.75l6 6 9-13.5"/>
    </svg>
    <!-- Info icon -->
    <svg v-else-if="type === 'info'" class="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"/>
    </svg>
    <span>{{ message }}</span>
  </div>
</template>
