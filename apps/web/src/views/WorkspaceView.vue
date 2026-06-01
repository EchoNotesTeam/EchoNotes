<script setup lang="ts">
import { ref } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { useUiStore } from '@/stores/ui.js'
import { useAuthStore } from '@/stores/auth.js'
import { apiListSheets, apiDeleteSheet, ApiError } from '@/api/index.js'
import type { Sheet } from '@/api/index.js'
import SheetCard from '@/components/SheetCard.vue'
import BaseSpinner from '@/components/BaseSpinner.vue'

const ui = useUiStore()
const auth = useAuthStore()
const queryClient = useQueryClient()

const page = ref(1)
const statusFilter = ref<string | undefined>(undefined)
const confirmDelete = ref<Sheet | null>(null)

const { data, isLoading, isError } = useQuery({
  queryKey: ['sheets', 'mine', page, statusFilter],
  queryFn: () => apiListSheets(page.value, 20, statusFilter.value),
})

const { mutateAsync: deleteSheet, isPending: isDeleting } = useMutation({
  mutationFn: (id: string) => apiDeleteSheet(id),
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ['sheets', 'mine'] })
    ui.toast.success('Partitura eliminada')
    confirmDelete.value = null
  },
  onError: (e) => {
    ui.toast.error(e instanceof ApiError ? e.message : 'Error al eliminar')
  },
})

const statusTabs = [
  { label: 'Todas', value: undefined },
  { label: 'Listas', value: 'ready' },
  { label: 'Procesando', value: 'processing' },
  { label: 'En espera', value: 'pending' },
  { label: 'Con error', value: 'failed' },
] as const

function changeStatus(val: string | undefined) {
  statusFilter.value = val
  page.value = 1
}

async function confirmAndDelete() {
  if (!confirmDelete.value) return
  await deleteSheet(confirmDelete.value.id)
}
</script>

<template>
  <div class="container-page py-10">
    <!-- Page header -->
    <div class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-slate-100">Mis partituras</h1>
        <p class="mt-1 text-sm text-slate-500">
          Hola, <span class="text-slate-300">{{ auth.user?.displayName }}</span> — aquí están tus transcripciones
        </p>
      </div>
      <RouterLink to="/upload" class="btn btn-primary">
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
        </svg>
        Nueva transcripción
      </RouterLink>
    </div>

    <!-- Status filter tabs -->
    <div class="mb-6 flex flex-wrap gap-2">
      <button
        v-for="tab in statusTabs"
        :key="String(tab.value)"
        class="rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-150"
        :class="statusFilter === tab.value
          ? 'bg-violet-600 text-white'
          : 'border border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200'"
        @click="changeStatus(tab.value)"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="flex justify-center py-24">
      <BaseSpinner size="lg" />
    </div>

    <!-- Error -->
    <div v-else-if="isError" class="rounded-xl border border-rose-800 bg-rose-950/30 p-8 text-center text-rose-400">
      Error al cargar tus partituras. Recarga la página e inténtalo de nuevo.
    </div>

    <!-- Empty state -->
    <div
      v-else-if="!data?.sheets.length"
      class="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 py-20 text-center"
    >
      <div class="mb-4 text-5xl">🎵</div>
      <p class="text-slate-400 font-medium">
        {{ statusFilter ? 'No hay partituras con ese estado' : 'Aún no tienes partituras' }}
      </p>
      <p class="mt-1 text-sm text-slate-600">
        {{ statusFilter ? 'Prueba otro filtro' : 'Sube tu primera grabación y la transcripción comenzará automáticamente' }}
      </p>
      <RouterLink v-if="!statusFilter" to="/upload" class="btn btn-primary mt-6">
        Subir primer audio
      </RouterLink>
    </div>

    <!-- Sheet grid -->
    <div v-else class="space-y-6">
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="sheet in data.sheets"
          :key="sheet.id"
          class="relative group"
        >
          <SheetCard :sheet="sheet" />
          <!-- Delete button overlay -->
          <button
            class="absolute right-3 top-3 rounded-lg p-1.5 text-slate-600 opacity-0 transition-all group-hover:opacity-100 hover:bg-rose-950 hover:text-rose-400"
            title="Eliminar partitura"
            @click.stop="confirmDelete = sheet"
          >
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Pagination -->
      <div
        v-if="data.pagination.pages > 1"
        class="flex items-center justify-center gap-3 pt-4"
      >
        <button
          class="btn btn-secondary btn-sm"
          :disabled="page <= 1"
          @click="page--"
        >← Anterior</button>
        <span class="text-sm text-slate-500">
          Página {{ page }} de {{ data.pagination.pages }}
        </span>
        <button
          class="btn btn-secondary btn-sm"
          :disabled="page >= data.pagination.pages"
          @click="page++"
        >Siguiente →</button>
      </div>
    </div>

    <!-- Delete confirmation modal -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition-all duration-200"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition-all duration-150"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div
          v-if="confirmDelete"
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          @click.self="confirmDelete = null"
        >
          <div class="card w-full max-w-sm p-6 animate-slide-up">
            <h3 class="mb-2 text-lg font-semibold text-slate-100">Eliminar partitura</h3>
            <p class="mb-6 text-sm text-slate-400">
              ¿Estás seguro de que deseas eliminar
              <strong class="text-slate-200">{{ confirmDelete.title }}</strong>?
              Esta acción no se puede deshacer.
            </p>
            <div class="flex justify-end gap-3">
              <button class="btn btn-secondary" @click="confirmDelete = null">Cancelar</button>
              <button
                class="btn btn-danger"
                :disabled="isDeleting"
                @click="confirmAndDelete"
              >
                <BaseSpinner v-if="isDeleting" size="sm" />
                Eliminar
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
