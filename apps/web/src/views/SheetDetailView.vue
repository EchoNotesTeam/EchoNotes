<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore } from '@/stores/ui.js'
import {
  apiGetSheet,
  apiGetPublicSheet,
  apiUpdateSheet,
  downloadUrl,
  ApiError,
} from '@/api/index.js'
import StatusBadge from '@/components/StatusBadge.vue'
import BaseSpinner from '@/components/BaseSpinner.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const ui = useUiStore()
const queryClient = useQueryClient()
const sheetId = computed(() => route.params['id'] as string)

// ─── Data fetching ────────────────────────────────────────────────────────────
const { data, isLoading, isError } = useQuery({
  queryKey: ['sheet', sheetId],
  queryFn: async () => {
    if (auth.isLoggedIn) {
      try { return await apiGetSheet(sheetId.value) } catch { /* fall through to public */ }
    }
    return apiGetPublicSheet(sheetId.value)
  },
  retry: false,
  // Poll every 4s while the sheet is still being processed so the UI
  // transitions to "ready" automatically without a manual refresh.
  refetchInterval: (query) => {
    const status = query.state.data?.sheet.status
    if (status === 'pending' || status === 'processing') return 4000
    return false
  },
})

const sheet = computed(() => data.value?.sheet)
const svg = computed(() => data.value?.svg)
const isOwner = computed(() => auth.user?.id === sheet.value?.ownerId)

// ─── Inline editing ───────────────────────────────────────────────────────────
const editing = ref(false)
const editTitle = ref('')
const editVisibility = ref<'private' | 'public'>('private')
const editTags = ref('')

function startEdit() {
  if (!sheet.value) return
  editTitle.value = sheet.value.title
  editVisibility.value = sheet.value.visibility
  editTags.value = sheet.value.tags.join(', ')
  editing.value = true
}

const { mutateAsync: saveEdit, isPending: isSaving } = useMutation({
  mutationFn: () =>
    apiUpdateSheet(sheetId.value, {
      title: editTitle.value.trim(),
      visibility: editVisibility.value,
      tags: editTags.value
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 10),
    }),
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ['sheet', sheetId] })
    void queryClient.invalidateQueries({ queryKey: ['sheets', 'mine'] })
    ui.toast.success('Partitura actualizada')
    editing.value = false
  },
  onError: (e) => {
    ui.toast.error(e instanceof ApiError ? e.message : 'Error al actualizar')
  },
})

// ─── Download helpers ─────────────────────────────────────────────────────────
const downloads = [
  { format: 'svg'      as const, label: 'SVG',     icon: '🖼️', desc: 'Vector editable' },
  { format: 'pdf'      as const, label: 'PDF',      icon: '📄', desc: 'Para imprimir'   },
  { format: 'midi'     as const, label: 'MIDI',     icon: '🎵', desc: 'Para DAW'        },
  { format: 'musicxml' as const, label: 'MusicXML', icon: '🎼', desc: 'Para MuseScore'  },
]

// Static metadata strip for the pipeline info
const pipelineMeta = [
  { label: 'Motor de transcripción', value: 'Basic Pitch v0.3' },
  { label: 'Cuantización',           value: 'librosa beat_track' },
  { label: 'Notación',               value: 'music21' },
  { label: 'Renderizado',            value: 'Verovio' },
]

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-VE', { year: 'numeric', month: 'long', day: 'numeric' })
}
</script>

<template>
  <div class="container-page py-10">

    <!-- Loading -->
    <div v-if="isLoading" class="flex justify-center py-24">
      <BaseSpinner size="lg" />
    </div>

    <!-- Not found -->
    <div v-else-if="isError" class="flex flex-col items-center gap-4 py-24 text-center">
      <div class="text-5xl">🎼</div>
      <h2 class="text-xl font-semibold text-slate-300">Partitura no encontrada</h2>
      <p class="text-sm text-slate-500">Puede ser privada o no existir.</p>
      <button class="btn btn-secondary mt-2" @click="router.back()">Volver</button>
    </div>

    <!-- Content -->
    <div v-else-if="sheet" class="space-y-8">

      <!-- Header -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0 flex-1">
          <!-- Meta row -->
          <div class="mb-2 flex flex-wrap items-center gap-3">
            <StatusBadge :status="sheet.status" />
            <span class="text-sm text-slate-500">
              {{ sheet.instrument === 'guitar' ? '🎸 Guitarra' : '🎹 Piano' }}
            </span>
            <span class="text-sm text-slate-600">·</span>
            <span class="text-sm text-slate-500">{{ formatDate(sheet.createdAt) }}</span>
            <span
              class="badge text-xs"
              :class="sheet.visibility === 'public' ? 'bg-sky-500/10 text-sky-400' : 'bg-slate-700/50 text-slate-500'"
            >
              {{ sheet.visibility === 'public' ? '🌍 Pública' : '🔒 Privada' }}
            </span>
          </div>

          <!-- Title (view mode) -->
          <template v-if="!editing">
            <h1 class="break-words text-2xl font-bold text-slate-100">{{ sheet.title }}</h1>
            <div v-if="sheet.tags.length" class="mt-2 flex flex-wrap gap-1.5">
              <span
                v-for="tag in sheet.tags"
                :key="tag"
                class="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400"
              >#{{ tag }}</span>
            </div>
          </template>

          <!-- Edit form -->
          <div v-else class="mt-1 space-y-3">
            <input v-model="editTitle" type="text" class="input text-lg font-bold" maxlength="200" />
            <div class="flex flex-wrap gap-2">
              <button
                v-for="opt in [{ v: 'private', l: '🔒 Privada' }, { v: 'public', l: '🌍 Pública' }]"
                :key="opt.v"
                type="button"
                class="rounded-lg border px-3 py-1.5 text-sm font-medium transition-all"
                :class="editVisibility === opt.v ? 'border-violet-500 bg-violet-500/10 text-violet-300' : 'border-slate-700 text-slate-400'"
                @click="editVisibility = opt.v as 'private' | 'public'"
              >{{ opt.l }}</button>
            </div>
            <input v-model="editTags" type="text" class="input text-sm" placeholder="etiquetas separadas por comas" />
            <div class="flex gap-2">
              <button class="btn btn-primary btn-sm" :disabled="isSaving" @click="() => void saveEdit()">
                <BaseSpinner v-if="isSaving" size="sm" />
                Guardar
              </button>
              <button class="btn btn-ghost btn-sm" @click="editing = false">Cancelar</button>
            </div>
          </div>
        </div>

        <!-- Edit button (owner only) -->
        <div v-if="isOwner && !editing" class="shrink-0">
          <button class="btn btn-secondary btn-sm" @click="startEdit">
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"/>
            </svg>
            Editar
          </button>
        </div>
      </div>

      <!-- Pipeline metadata strip -->
      <div v-if="sheet.status === 'ready'" class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div v-for="meta in pipelineMeta" :key="meta.label" class="card p-3 text-center">
          <p class="mb-1 text-xs text-slate-600">{{ meta.label }}</p>
          <p class="text-sm font-medium text-slate-300">{{ meta.value }}</p>
        </div>
      </div>

      <!-- Download buttons -->
      <div v-if="sheet.status === 'ready'" class="flex flex-wrap gap-3">
        <a
          v-for="dl in downloads"
          :key="dl.format"
          :href="downloadUrl(sheet.id, dl.format)"
          class="btn btn-secondary gap-2"
        >
          <span class="text-base leading-none">{{ dl.icon }}</span>
          <span>{{ dl.label }}</span>
          <span class="text-xs text-slate-500">{{ dl.desc }}</span>
        </a>
      </div>

      <!-- SVG score viewer -->
      <div v-if="svg && sheet.status === 'ready'" class="space-y-2">
        <h2 class="text-xs font-medium uppercase tracking-wide text-slate-500">Partitura</h2>
        <div class="overflow-auto rounded-xl border border-slate-700 bg-white p-4" style="max-height: 80vh">
          <!-- Safe: SVG comes from our own trusted Verovio rendering pipeline -->
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="w-full" v-html="svg" />
        </div>
      </div>

      <!-- Non-ready states -->
      <div v-else-if="sheet.status !== 'ready'" class="card p-10 text-center">
        <div v-if="sheet.status === 'pending' || sheet.status === 'processing'" class="flex flex-col items-center gap-4">
          <BaseSpinner size="lg" />
          <div>
            <p class="font-semibold text-slate-300">
              {{ sheet.status === 'pending' ? 'En espera de procesamiento' : 'Transcribiendo…' }}
            </p>
            <p class="mt-1 text-sm text-slate-500">La partitura estará disponible en unos minutos.</p>
          </div>
        </div>
        <div v-else-if="sheet.status === 'failed'" class="flex flex-col items-center gap-4">
          <div class="text-4xl">❌</div>
          <div>
            <p class="font-semibold text-rose-400">La transcripción falló</p>
            <p class="mt-1 text-sm text-slate-500">Intenta subir el audio nuevamente con una grabación más limpia.</p>
          </div>
          <RouterLink to="/upload" class="btn btn-primary mt-2">Subir audio nuevo</RouterLink>
        </div>
      </div>

    </div>
  </div>
</template>
