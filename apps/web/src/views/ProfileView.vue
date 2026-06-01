<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { apiGetProfile } from '@/api/index.js'
import SheetCard from '@/components/SheetCard.vue'
import BaseSpinner from '@/components/BaseSpinner.vue'

const route = useRoute()
const username = computed(() => route.params['username'] as string)

const { data, isLoading, isError } = useQuery({
  queryKey: ['profile', username],
  queryFn: () => apiGetProfile(username.value),
  retry: false,
})

const user = computed(() => data.value?.user)
const sheets = computed(() => data.value?.sheets ?? [])

function formatJoined(iso: string) {
  return new Date(iso).toLocaleDateString('es-VE', { year: 'numeric', month: 'long' })
}
</script>

<template>
  <div class="container-page py-12">

    <!-- Loading -->
    <div v-if="isLoading" class="flex justify-center py-24">
      <BaseSpinner size="lg" />
    </div>

    <!-- Not found -->
    <div v-else-if="isError" class="flex flex-col items-center gap-4 py-24 text-center">
      <div class="text-5xl">👤</div>
      <h2 class="text-xl font-semibold text-slate-300">Usuario no encontrado</h2>
      <p class="text-slate-500 text-sm">@{{ username }} no existe o no tiene perfil público.</p>
      <RouterLink to="/" class="btn btn-secondary mt-2">Volver al inicio</RouterLink>
    </div>

    <!-- Profile -->
    <div v-else-if="user" class="space-y-10">

      <!-- User card -->
      <div class="flex items-start gap-6">
        <div class="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-violet-600/10 text-violet-400 text-3xl font-bold ring-2 ring-violet-500/20">
          {{ user.displayName.charAt(0).toUpperCase() }}
        </div>
        <div>
          <h1 class="text-2xl font-bold text-slate-100">{{ user.displayName }}</h1>
          <p class="mt-0.5 text-slate-500">@{{ user.username }}</p>
          <p class="mt-2 text-sm text-slate-600">
            Miembro desde {{ formatJoined(user.createdAt) }}
          </p>
        </div>
      </div>

      <!-- Public sheets -->
      <div>
        <div class="mb-6 flex items-baseline justify-between">
          <h2 class="text-lg font-semibold text-slate-200">
            Partituras públicas
            <span v-if="sheets.length" class="ml-2 text-sm font-normal text-slate-500">
              ({{ sheets.length }})
            </span>
          </h2>
        </div>

        <div v-if="!sheets.length" class="rounded-xl border border-dashed border-slate-800 py-14 text-center">
          <p class="text-slate-500">{{ user.displayName }} no tiene partituras públicas todavía.</p>
        </div>

        <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SheetCard
            v-for="sheet in sheets"
            :key="sheet.id"
            :sheet="sheet"
          />
        </div>
      </div>
    </div>
  </div>
</template>
