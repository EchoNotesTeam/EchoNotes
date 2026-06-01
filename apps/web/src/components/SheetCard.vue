<script setup lang="ts">
import { useRouter } from 'vue-router'
import StatusBadge from '@/components/StatusBadge.vue'
import type { Sheet } from '@/api/index.js'

const props = defineProps<{
  sheet: Sheet
  showOwner?: boolean
}>()

const router = useRouter()

function navigate() {
  void router.push(`/sheets/${props.sheet.id}`)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-VE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

const instrumentIcon = { guitar: '🎸', piano: '🎹' }
</script>

<template>
  <article
    class="card-hover group flex cursor-pointer flex-col gap-4 p-5"
    role="button"
    tabindex="0"
    :aria-label="`Ver partitura: ${sheet.title}`"
    @click="navigate"
    @keydown.enter="navigate"
    @keydown.space.prevent="navigate"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-base font-semibold text-slate-100 group-hover:text-violet-300 transition-colors">
          {{ sheet.title }}
        </h3>
        <p v-if="showOwner && sheet.owner" class="mt-0.5 text-xs text-slate-500">
          por {{ sheet.owner.displayName }}
        </p>
      </div>
      <StatusBadge :status="sheet.status" />
    </div>

    <div class="flex items-center gap-3 text-sm text-slate-500">
      <span class="text-base leading-none">{{ instrumentIcon[sheet.instrument] ?? '🎵' }}</span>
      <span class="capitalize">{{ sheet.instrument === 'guitar' ? 'Guitarra' : 'Piano' }}</span>
      <span class="ml-auto text-xs">{{ formatDate(sheet.createdAt) }}</span>
    </div>

    <div v-if="sheet.tags.length" class="flex flex-wrap gap-1.5">
      <span
        v-for="tag in sheet.tags.slice(0, 5)"
        :key="tag"
        class="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400"
      >
        #{{ tag }}
      </span>
    </div>
  </article>
</template>
