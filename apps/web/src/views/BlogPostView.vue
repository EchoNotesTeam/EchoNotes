<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import MarkdownIt from 'markdown-it'
import { apiGetBlogPost } from '@/api/index.js'
import BaseSpinner from '@/components/BaseSpinner.vue'

const route = useRoute()
const router = useRouter()
const slug = computed(() => route.params['slug'] as string)

const { data, isLoading, isError } = useQuery({
  queryKey: ['blog', slug],
  queryFn: () => apiGetBlogPost(slug.value),
  retry: false,
})

const md = new MarkdownIt({ html: false, linkify: true, typographer: true })

const renderedContent = computed(() => {
  if (!data.value?.post.content) return ''
  return md.render(data.value.post.content)
})

const post = computed(() => data.value?.post)

function formatDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es-VE', { year: 'numeric', month: 'long', day: 'numeric' })
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
      <div class="text-5xl">📭</div>
      <h2 class="text-xl font-semibold text-slate-300">Artículo no encontrado</h2>
      <button class="btn btn-secondary" @click="router.push('/blog')">Ver todos los artículos</button>
    </div>

    <!-- Post content -->
    <article v-else-if="post" class="mx-auto max-w-2xl">
      <!-- Back -->
      <RouterLink
        to="/blog"
        class="mb-8 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors"
      >
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/>
        </svg>
        Volver al blog
      </RouterLink>

      <!-- Meta -->
      <header class="mb-8">
        <div class="mb-4 flex items-center gap-3 text-sm text-slate-500">
          <span v-if="post.date">{{ formatDate(post.date) }}</span>
          <span v-if="post.author">· por <span class="text-slate-400">{{ post.author }}</span></span>
        </div>
        <h1 class="text-3xl font-bold text-slate-100 leading-tight">{{ post.title }}</h1>
        <p v-if="post.excerpt" class="mt-3 text-lg text-slate-400 leading-relaxed">
          {{ post.excerpt }}
        </p>
        <hr class="mt-6 border-slate-800" />
      </header>

      <!-- Rendered markdown -->
      <div
        class="prose prose-invert prose-violet prose-sm sm:prose-base max-w-none
               prose-headings:text-slate-100 prose-headings:font-semibold
               prose-p:text-slate-400 prose-p:leading-relaxed
               prose-a:text-violet-400 prose-a:no-underline hover:prose-a:text-violet-300
               prose-code:text-violet-300 prose-code:bg-slate-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded
               prose-pre:bg-slate-800 prose-pre:border prose-pre:border-slate-700
               prose-blockquote:border-violet-500 prose-blockquote:text-slate-400
               prose-strong:text-slate-200
               prose-hr:border-slate-800"
        v-html="renderedContent"
      />
    </article>
  </div>
</template>
