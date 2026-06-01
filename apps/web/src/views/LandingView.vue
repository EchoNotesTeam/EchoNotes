<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { useAuthStore } from '@/stores/auth.js'
import { apiListPublicSheets } from '@/api/index.js'
import SheetCard from '@/components/SheetCard.vue'
import BaseSpinner from '@/components/BaseSpinner.vue'

const auth = useAuthStore()

const { data: publicSheets, isLoading } = useQuery({
  queryKey: ['sheets', 'public', 'landing'],
  queryFn: () => apiListPublicSheets(1, 6),
})

const steps = [
  {
    title: 'Basic Pitch',
    desc: 'Detecta cada nota usando la red neuronal de Spotify entrenada en millones de grabaciones.',
    lib: 'TensorFlow · ICASSP 2022',
  },
  {
    title: 'Cuantización rítmica',
    desc: 'Estima el tempo y alinea las notas al grid de beats para producir duraciones exactas.',
    lib: 'librosa beat_track',
  },
  {
    title: 'Notación musical',
    desc: 'Convierte el MIDI a MusicXML con tonalidad, compases, ligaduras y notación legible.',
    lib: 'music21',
  },
  {
    title: 'Renderizado SVG',
    desc: 'Produce una partitura vectorial de alta calidad lista para el navegador y para descargar.',
    lib: 'Verovio',
  },
]

const formats = [
  {
    icon: '🎸',
    label: 'Guitarra',
    desc: 'Optimizado para guitarra clásica y acústica solista en afinación estándar.',
  },
  {
    icon: '🎹',
    label: 'Piano',
    desc: 'Transcripción de piano solista con detección de melodía y acompañamiento.',
  },
  {
    icon: '📄',
    label: 'Múltiples formatos',
    desc: 'Descarga en SVG, PDF, MusicXML y MIDI para usar en cualquier software.',
  },
]
</script>

<template>
  <!-- Hero -->
  <section class="relative overflow-hidden py-24 sm:py-32">
    <div class="pointer-events-none absolute inset-0 -z-10">
      <div class="absolute left-1/2 top-0 h-[600px] w-[800px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-violet-600/10 blur-[120px]" />
    </div>

    <div class="container-page text-center">
      <div class="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-4 py-1.5 text-sm text-violet-300">
        <span class="relative flex h-2 w-2">
          <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
          <span class="relative inline-flex h-2 w-2 rounded-full bg-violet-500" />
        </span>
        Powered by Basic Pitch · music21 · Verovio
      </div>

      <h1 class="mb-6 text-4xl font-bold tracking-tight text-slate-100 sm:text-5xl lg:text-6xl">
        Tu música,
        <span class="bg-gradient-to-r from-violet-400 to-sky-400 bg-clip-text text-transparent">
          en papel
        </span>
      </h1>
      <p class="mx-auto mb-10 max-w-2xl text-lg text-slate-400">
        EchoNotes convierte grabaciones de audio de guitarra o piano en partituras editables
        usando inteligencia artificial. Sube tu audio y obtén la partitura completa en segundos.
      </p>

      <div class="flex flex-col items-center justify-center gap-4 sm:flex-row">
        <RouterLink v-if="!auth.isLoggedIn" to="/signup" class="btn btn-primary px-8 py-3 text-base">
          Comenzar gratis
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/>
          </svg>
        </RouterLink>
        <RouterLink v-else to="/upload" class="btn btn-primary px-8 py-3 text-base">
          Subir audio
          <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
          </svg>
        </RouterLink>
        <RouterLink to="/blog" class="btn btn-secondary px-8 py-3 text-base">
          Leer el blog
        </RouterLink>
      </div>
    </div>
  </section>

  <!-- How it works -->
  <section class="border-t border-slate-800/50 py-20">
    <div class="container-page">
      <h2 class="mb-3 text-center text-2xl font-bold text-slate-100">¿Cómo funciona?</h2>
      <p class="mb-12 text-center text-slate-500">Cuatro etapas de IA, un resultado profesional</p>

      <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <div v-for="(step, i) in steps" :key="i" class="card p-6">
          <div class="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400 text-lg font-bold ring-1 ring-violet-500/20">
            {{ i + 1 }}
          </div>
          <h3 class="mb-2 font-semibold text-slate-100">{{ step.title }}</h3>
          <p class="text-sm text-slate-500 leading-relaxed">{{ step.desc }}</p>
          <div class="mt-3 font-mono text-xs text-slate-600">{{ step.lib }}</div>
        </div>
      </div>
    </div>
  </section>

  <!-- Supported formats -->
  <section class="border-t border-slate-800/50 py-16">
    <div class="container-page">
      <div class="grid gap-8 text-center sm:grid-cols-3">
        <div v-for="f in formats" :key="f.label" class="flex flex-col items-center gap-3">
          <div class="text-4xl">{{ f.icon }}</div>
          <h3 class="font-semibold text-slate-200">{{ f.label }}</h3>
          <p class="text-sm text-slate-500">{{ f.desc }}</p>
        </div>
      </div>
    </div>
  </section>

  <!-- Public sheets gallery -->
  <section class="border-t border-slate-800/50 py-20">
    <div class="container-page">
      <div class="mb-10 flex items-baseline justify-between">
        <div>
          <h2 class="text-2xl font-bold text-slate-100">Partituras recientes</h2>
          <p class="mt-1 text-sm text-slate-500">Compartidas por la comunidad</p>
        </div>
      </div>

      <div v-if="isLoading" class="flex justify-center py-16">
        <BaseSpinner size="lg" />
      </div>

      <div v-else-if="publicSheets?.sheets.length" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SheetCard
          v-for="sheet in publicSheets.sheets"
          :key="sheet.id"
          :sheet="sheet"
          :show-owner="true"
        />
      </div>

      <div v-else class="rounded-xl border border-dashed border-slate-800 py-16 text-center text-slate-600">
        <p>Todavía no hay partituras públicas. ¡Sé el primero en compartir una!</p>
      </div>
    </div>
  </section>

  <!-- CTA banner -->
  <section class="border-t border-slate-800/50 py-20">
    <div class="container-page text-center">
      <h2 class="mb-4 text-3xl font-bold text-slate-100">¿Listo para ver tu música en papel?</h2>
      <p class="mb-8 text-slate-400">
        Crea tu cuenta gratis y transcribe tu primera grabación en minutos.
      </p>
      <RouterLink v-if="!auth.isLoggedIn" to="/signup" class="btn btn-primary px-10 py-3 text-base">
        Crear cuenta gratis
      </RouterLink>
      <RouterLink v-else to="/upload" class="btn btn-primary px-10 py-3 text-base">
        Subir audio ahora
      </RouterLink>
    </div>
  </section>
</template>
