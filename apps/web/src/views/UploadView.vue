<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useUiStore } from '@/stores/ui.js'
import { apiUploadSheet, ApiError } from '@/api/index.js'
import { useJobSocket } from '@/composables/useJobSocket.js'
import type { WsJobEvent } from '@/composables/useJobSocket.js'
import BaseSpinner from '@/components/BaseSpinner.vue'
import BaseAlert from '@/components/BaseAlert.vue'

const ui = useUiStore()
const router = useRouter()

// ─── Form state ───────────────────────────────────────────────────────────────
const fileInput = ref<HTMLInputElement | null>(null)
const file = ref<File | null>(null)
const title = ref('')
const instrument = ref<'guitar' | 'piano'>('piano')
const visibility = ref<'private' | 'public'>('private')
const tags = ref('')
const isDragOver = ref(false)

// ─── Upload + job state ───────────────────────────────────────────────────────
const uploading = ref(false)
const errorMsg = ref('')
const jobId = ref<string | null>(null)
const progress = ref({ stage: '', pct: 0, message: '' })
const jobDone = ref(false)
const jobFailed = ref(false)
const jobError = ref('')

// ─── Pipeline stages display ──────────────────────────────────────────────────
// Keys match the stage names emitted by the Go worker via WebSocket.
// 'processing' is the first stage (pct=5) before 'transcribing' (pct=15).
const pipelineStages = [
  { key: 'processing',   label: 'Iniciando' },
  { key: 'transcribing', label: 'Basic Pitch' },
  { key: 'saving',       label: 'Cuantización' },
  { key: 'persisting',   label: 'Notación + SVG' },
]
const stageOrder = pipelineStages.map((s) => s.key)

function isStageActive(key: string): boolean {
  return progress.value.stage === key
}
function isStageComplete(key: string, idx: number): boolean {
  const currentIdx = stageOrder.indexOf(progress.value.stage)
  return currentIdx > idx || jobDone.value
}

const stageMessages: Record<string, string> = {
  processing:   'Iniciando pipeline de IA…',
  transcribing: 'Basic Pitch detectando notas…',
  saving:       'Guardando artefactos en disco…',
  persisting:   'Registrando metadatos…',
  done:         '¡Transcripción completada!',
  failed:       'La transcripción falló',
}

// ─── WebSocket subscription ───────────────────────────────────────────────────
useJobSocket(jobId, (event: WsJobEvent) => {
  if (event.type === 'job_progress') {
    progress.value = {
      stage:   event.stage,
      pct:     event.pct,
      message: event.message ?? stageMessages[event.stage] ?? event.stage,
    }
  } else if (event.type === 'job_done') {
    jobDone.value = true
    progress.value = { stage: 'done', pct: 100, message: '¡Transcripción completada!' }
    setTimeout(() => void router.push(`/sheets/${event.sheet_id}`), 1500)
  } else if (event.type === 'job_failed') {
    jobFailed.value = true
    jobError.value = event.message || 'Error desconocido en la transcripción'
    progress.value = { stage: 'failed', pct: 0, message: 'La transcripción falló' }
  }
})

// ─── Drag & drop ─────────────────────────────────────────────────────────────
const ALLOWED = new Set(['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac'])

function ext(name: string) { return name.slice(name.lastIndexOf('.')).toLowerCase() }
function allowed(f: File) { return ALLOWED.has(ext(f.name)) }

function onDragOver(e: DragEvent) { e.preventDefault(); isDragOver.value = true }
function onDragLeave() { isDragOver.value = false }

function onDrop(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = false
  const f = e.dataTransfer?.files[0]
  if (f && allowed(f)) setFile(f)
  else if (f) ui.toast.error('Formato no soportado. Usa WAV, MP3, FLAC, OGG, M4A o AAC.')
}

function onFileInput(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f && allowed(f)) setFile(f)
}

function setFile(f: File) {
  file.value = f
  if (!title.value) title.value = f.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
}

// ─── Submit ───────────────────────────────────────────────────────────────────
const canSubmit = computed(() =>
  file.value !== null && title.value.trim().length > 0 && !uploading.value && !jobId.value,
)

async function handleSubmit() {
  if (!canSubmit.value || !file.value) return

  uploading.value = true
  errorMsg.value = ''

  const form = new FormData()
  form.append('file', file.value)
  form.append('title', title.value.trim())
  form.append('instrument', instrument.value)
  form.append('visibility', visibility.value)
  if (tags.value.trim()) form.append('tags', tags.value.trim())

  try {
    const res = await apiUploadSheet(form)
    jobId.value = res.jobId
    progress.value = { stage: 'queued', pct: 0, message: 'Job en cola, esperando worker…' }
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? e.message : 'Error al subir el archivo. Inténtalo de nuevo.'
  } finally {
    uploading.value = false
  }
}

function reset() {
  file.value = null
  title.value = ''
  instrument.value = 'piano'
  visibility.value = 'private'
  tags.value = ''
  jobId.value = null
  jobDone.value = false
  jobFailed.value = false
  jobError.value = ''
  errorMsg.value = ''
  progress.value = { stage: '', pct: 0, message: '' }
  if (fileInput.value) fileInput.value.value = ''
}
</script>

<template>
  <div class="container-page py-10">
    <div class="mx-auto max-w-2xl">
      <div class="mb-8">
        <h1 class="text-2xl font-bold text-slate-100">Nueva transcripción</h1>
        <p class="mt-1 text-sm text-slate-500">
          Sube una grabación de guitarra o piano solista — la IA genera la partitura automáticamente.
        </p>
      </div>

      <!-- ─── Upload form ────────────────────────────────────────────────── -->
      <div v-if="!jobId" class="space-y-6">
        <BaseAlert v-if="errorMsg" type="error" :message="errorMsg" />

        <!-- Drop zone -->
        <div
          role="button"
          tabindex="0"
          :class="[
            'relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition-all duration-200 cursor-pointer',
            isDragOver   ? 'border-violet-500 bg-violet-500/5' :
            file         ? 'border-emerald-600 bg-emerald-950/20' :
                           'border-slate-700 hover:border-slate-600',
          ]"
          @dragover="onDragOver"
          @dragleave="onDragLeave"
          @drop="onDrop"
          @click="fileInput?.click()"
          @keydown.enter="fileInput?.click()"
          @keydown.space.prevent="fileInput?.click()"
        >
          <input
            ref="fileInput"
            type="file"
            class="sr-only"
            accept=".wav,.mp3,.flac,.ogg,.m4a,.aac,audio/*"
            @change="onFileInput"
          />

          <template v-if="!file">
            <div class="flex h-14 w-14 items-center justify-center rounded-full bg-slate-800 text-slate-400 mb-3">
              <svg class="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
              </svg>
            </div>
            <p class="font-medium text-slate-300">Arrastra tu audio aquí</p>
            <p class="mt-1 text-sm text-slate-500">o haz clic para seleccionar</p>
            <p class="mt-2 text-xs text-slate-600">WAV · MP3 · FLAC · OGG · M4A · AAC — máx. 25 MB</p>
          </template>

          <template v-else>
            <div class="flex items-center gap-4">
              <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
                </svg>
              </div>
              <div class="min-w-0 text-left">
                <p class="truncate font-medium text-emerald-300">{{ file.name }}</p>
                <p class="text-sm text-slate-500">{{ (file.size / 1024 / 1024).toFixed(2) }} MB · Haz clic para cambiar</p>
              </div>
            </div>
          </template>
        </div>

        <!-- Form fields -->
        <div class="card p-6 space-y-5">
          <div>
            <label for="title" class="label">Título de la partitura</label>
            <input id="title" v-model="title" type="text" class="input" placeholder="Mi composición" required maxlength="200" />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="label">Instrumento</label>
              <div class="flex gap-2">
                <button
                  v-for="opt in [{ v: 'piano', l: '🎹 Piano' }, { v: 'guitar', l: '🎸 Guitarra' }]"
                  :key="opt.v"
                  type="button"
                  class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all"
                  :class="instrument === opt.v ? 'border-violet-500 bg-violet-500/10 text-violet-300' : 'border-slate-700 text-slate-400 hover:border-slate-600'"
                  @click="instrument = opt.v as 'guitar' | 'piano'"
                >{{ opt.l }}</button>
              </div>
            </div>
            <div>
              <label class="label">Visibilidad</label>
              <div class="flex gap-2">
                <button
                  v-for="opt in [{ v: 'private', l: '🔒 Privada' }, { v: 'public', l: '🌍 Pública' }]"
                  :key="opt.v"
                  type="button"
                  class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all"
                  :class="visibility === opt.v ? 'border-violet-500 bg-violet-500/10 text-violet-300' : 'border-slate-700 text-slate-400 hover:border-slate-600'"
                  @click="visibility = opt.v as 'private' | 'public'"
                >{{ opt.l }}</button>
              </div>
            </div>
          </div>

          <div>
            <label for="tags" class="label">
              Etiquetas
              <span class="ml-1 text-xs text-slate-600">(separadas por comas, opcional)</span>
            </label>
            <input id="tags" v-model="tags" type="text" class="input" placeholder="clasica, original, bach" />
          </div>
        </div>

        <!-- Solo-recording warning -->
        <div class="flex gap-3 rounded-lg border border-amber-800/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-300/80">
          <svg class="mt-0.5 h-4 w-4 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
          </svg>
          <span>Sube únicamente grabaciones de <strong>un solo instrumento</strong>. Las grabaciones con múltiples instrumentos afectan la precisión.</span>
        </div>

        <button
          class="btn btn-primary w-full py-3 text-base"
          :disabled="!canSubmit || uploading"
          @click="handleSubmit"
        >
          <BaseSpinner v-if="uploading" size="sm" />
          <svg v-else class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
          </svg>
          {{ uploading ? 'Subiendo audio…' : 'Iniciar transcripción' }}
        </button>
      </div>

      <!-- ─── Progress panel ─────────────────────────────────────────────── -->
      <div v-else class="card p-8">
        <!-- Success -->
        <div v-if="jobDone" class="flex flex-col items-center gap-4 text-center">
          <div class="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
            <svg class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.5 12.75l6 6 9-13.5"/>
            </svg>
          </div>
          <div>
            <h3 class="text-lg font-semibold text-emerald-300">¡Transcripción completada!</h3>
            <p class="mt-1 text-sm text-slate-500">Redirigiendo a tu partitura…</p>
          </div>
        </div>

        <!-- Failed -->
        <div v-else-if="jobFailed" class="flex flex-col items-center gap-6 text-center">
          <div class="flex h-16 w-16 items-center justify-center rounded-full bg-rose-500/10 text-rose-400">
            <svg class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </div>
          <div>
            <h3 class="text-lg font-semibold text-rose-300">La transcripción falló</h3>
            <p class="mt-1 text-sm text-slate-500">{{ jobError }}</p>
          </div>
          <button class="btn btn-secondary" @click="reset">Intentar de nuevo</button>
        </div>

        <!-- In progress -->
        <div v-else class="space-y-6">
          <div class="text-center">
            <h3 class="text-lg font-semibold text-slate-100">Transcribiendo audio…</h3>
            <p class="mt-1 text-sm text-slate-500">El pipeline de IA está procesando tu grabación. Esto puede tardar unos minutos.</p>
          </div>

          <div class="space-y-3">
            <div class="flex items-center justify-between text-sm">
              <span class="text-slate-300 font-medium">{{ progress.message || 'Iniciando…' }}</span>
              <span class="font-mono font-medium text-violet-400">{{ progress.pct }}%</span>
            </div>
            <div class="h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                class="h-full rounded-full bg-gradient-to-r from-violet-600 to-violet-400 transition-all duration-700 ease-out"
                :style="{ width: `${progress.pct}%` }"
              />
            </div>
          </div>

          <!-- Stage bubbles -->
          <div class="grid grid-cols-4 gap-2">
            <div
              v-for="(stage, i) in pipelineStages"
              :key="stage.key"
              class="flex flex-col items-center gap-1.5 text-center"
            >
              <div
                class="flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium ring-2 transition-all duration-300"
                :class="isStageActive(stage.key)
                  ? 'bg-violet-600 text-white ring-violet-500/50'
                  : isStageComplete(stage.key, i)
                  ? 'bg-emerald-600/20 text-emerald-400 ring-emerald-500/20'
                  : 'bg-slate-800 text-slate-600 ring-slate-700'"
              >
                <svg v-if="isStageComplete(stage.key, i)" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4.5 12.75l6 6 9-13.5"/>
                </svg>
                <span v-else>{{ i + 1 }}</span>
              </div>
              <span class="text-xs text-slate-500 leading-tight">{{ stage.label }}</span>
            </div>
          </div>

          <div class="flex justify-center pt-2">
            <BaseSpinner />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
