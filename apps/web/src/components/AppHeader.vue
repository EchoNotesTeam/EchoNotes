<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore } from '@/stores/ui.js'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const profileOpen = ref(false)
const dropdownEl = ref<HTMLElement | null>(null)

// Close dropdown when clicking outside of it
let docListener: ((e: MouseEvent) => void) | null = null
watch(profileOpen, (open) => {
  if (open) {
    docListener = (e: MouseEvent) => {
      if (dropdownEl.value && !dropdownEl.value.contains(e.target as Node)) {
        profileOpen.value = false
      }
    }
    document.addEventListener('click', docListener, { capture: true, passive: true })
  } else if (docListener) {
    document.removeEventListener('click', docListener, true)
    docListener = null
  }
})
onUnmounted(() => {
  if (docListener) document.removeEventListener('click', docListener, true)
})

async function handleLogout() {
  profileOpen.value = false
  try {
    await auth.logout()
    void router.push('/')
    ui.toast.success('Sesión cerrada correctamente')
  } catch {
    ui.toast.error('Error al cerrar sesión')
  }
}
</script>

<template>
  <header class="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
    <div class="container-page flex h-16 items-center gap-6">

      <!-- Logo -->
      <RouterLink
        to="/"
        class="flex shrink-0 items-center gap-2.5 text-slate-100 hover:text-violet-300 transition-colors"
      >
        <svg class="h-7 w-7" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 24V11l14-3v13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="9" cy="24" r="3" stroke="currentColor" stroke-width="2"/>
          <circle cx="23" cy="21" r="3" stroke="currentColor" stroke-width="2"/>
        </svg>
        <span class="text-lg font-semibold tracking-tight">EchoNotes</span>
      </RouterLink>

      <!-- Primary navigation -->
      <nav class="flex items-center gap-1 text-sm">
        <!-- Usar exact-active-class en "/" para que solo se active en esa ruta exacta -->
        <RouterLink
          to="/"
          class="rounded-md px-3 py-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-all"
          active-class=""
          exact-active-class="text-slate-100 bg-slate-800"
        >
          Inicio
        </RouterLink>
        <RouterLink
          to="/blog"
          class="rounded-md px-3 py-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-all"
          active-class="text-slate-100 bg-slate-800"
        >
          Blog
        </RouterLink>
        <RouterLink
          v-if="auth.isLoggedIn"
          to="/workspace"
          class="rounded-md px-3 py-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-all"
          active-class="text-slate-100 bg-slate-800"
        >
          Workspace
        </RouterLink>
      </nav>

      <!-- Auth area -->
      <div class="ml-auto flex items-center gap-3">

        <!-- Guest buttons -->
        <template v-if="!auth.isLoggedIn">
          <RouterLink to="/login" class="btn btn-ghost btn-sm">
            Iniciar sesión
          </RouterLink>
          <RouterLink to="/signup" class="btn btn-primary btn-sm">
            Registrarse
          </RouterLink>
        </template>

        <!-- Logged-in controls -->
        <template v-else>
          <RouterLink to="/upload" class="btn btn-primary btn-sm">
            <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
            </svg>
            Subir audio
          </RouterLink>

          <!-- Profile dropdown -->
          <div ref="dropdownEl" class="relative">
            <button
              class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-all"
              :aria-expanded="profileOpen"
              aria-haspopup="true"
              @click="profileOpen = !profileOpen"
            >
              <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600/20 text-violet-400 font-medium text-xs ring-1 ring-violet-500/30">
                {{ auth.user?.displayName.charAt(0).toUpperCase() }}
              </div>
              <span class="hidden sm:inline max-w-[120px] truncate">{{ auth.user?.displayName }}</span>
              <svg
                class="h-3.5 w-3.5 transition-transform duration-150"
                :class="{ 'rotate-180': profileOpen }"
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
              </svg>
            </button>

            <Transition
              enter-active-class="transition-all duration-150 ease-out"
              enter-from-class="scale-95 opacity-0 -translate-y-1"
              enter-to-class="scale-100 opacity-100 translate-y-0"
              leave-active-class="transition-all duration-100 ease-in"
              leave-from-class="scale-100 opacity-100"
              leave-to-class="scale-95 opacity-0"
            >
              <div
                v-if="profileOpen"
                class="absolute right-0 mt-1 w-48 origin-top-right rounded-xl border border-slate-700 bg-slate-900 py-1 shadow-2xl"
              >
                <RouterLink
                  :to="`/u/${auth.user?.username}`"
                  class="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-slate-100 transition-colors"
                  @click="profileOpen = false"
                >
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/>
                  </svg>
                  Mi perfil público
                </RouterLink>
                <RouterLink
                  to="/workspace"
                  class="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-slate-100 transition-colors"
                  @click="profileOpen = false"
                >
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
                  </svg>
                  Mis partituras
                </RouterLink>
                <hr class="my-1 border-slate-700/60" />
                <button
                  class="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-rose-400 hover:bg-slate-800 transition-colors"
                  @click="handleLogout"
                >
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9"/>
                  </svg>
                  Cerrar sesión
                </button>
              </div>
            </Transition>
          </div>
        </template>
      </div>
    </div>
  </header>
</template>
