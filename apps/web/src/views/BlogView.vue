<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query'
import { apiListBlog } from '@/api/index.js'
import BaseSpinner from '@/components/BaseSpinner.vue'

const { data, isLoading, isError } = useQuery({
  queryKey: ['blog'],
  queryFn: apiListBlog,
  staleTime: 5 * 60 * 1000,
})

function formatDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es-VE', { year: 'numeric', month: 'long', day: 'numeric' })
}
</script>

<template>
  <div class="container-page py-12">
    <!-- Header -->
    <div class="mb-10 max-w-2xl">
      <h1 class="text-3xl font-bold text-slate-100">Blog</h1>
      <p class="mt-2 text-slate-500">
        Artículos sobre transcripción musical, inteligencia artificial y el desarrollo de EchoNotes.
      </p>
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="flex justify-center py-20">
      <BaseSpinner size="lg" />
    </div>

    <!-- Error -->
    <div v-else-if="isError" class="rounded-xl border border-rose-800/40 bg-rose-950/20 p-8 text-center text-rose-400">
      Error al cargar los artículos del blog.
    </div>

    <!-- Empty -->
    <div
      v-else-if="!data?.posts.length"
      class="flex flex-col items-center gap-4 rounded-xl border border-dashed border-slate-800 py-20 text-center"
    >
      <div class="text-5xl">📝</div>
      <p class="text-slate-400 font-medium">No hay artículos publicados todavía</p>
      <p class="text-sm text-slate-600">Los artículos aparecerán aquí una vez que sean publicados.</p>
    </div>

    <!-- Post list -->
    <div v-else class="space-y-6 max-w-3xl">
      <article
        v-for="post in data.posts"
        :key="post.slug"
        class="card-hover p-6 group"
      >
        <RouterLink :to="`/blog/${post.slug}`" class="block">
          <div class="mb-3 flex items-center gap-3 text-xs text-slate-600">
            <span v-if="post.date">{{ formatDate(post.date) }}</span>
            <span v-if="post.author">· por {{ post.author }}</span>
          </div>
          <h2 class="text-lg font-semibold text-slate-100 group-hover:text-violet-300 transition-colors">
            {{ post.title }}
          </h2>
          <p v-if="post.excerpt" class="mt-2 text-sm text-slate-500 line-clamp-2">
            {{ post.excerpt }}
          </p>
          <div class="mt-4 flex items-center gap-1 text-sm font-medium text-violet-400 group-hover:text-violet-300 transition-colors">
            Leer artículo
            <svg class="h-4 w-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/>
            </svg>
          </div>
        </RouterLink>
      </article>
    </div>
  </div>
</template>
