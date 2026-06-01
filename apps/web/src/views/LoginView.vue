<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore } from '@/stores/ui.js'
import { ApiError } from '@/api/index.js'
import BaseSpinner from '@/components/BaseSpinner.vue'
import BaseAlert from '@/components/BaseAlert.vue'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const loading = ref(false)
const errorMsg = ref('')

async function handleSubmit() {
  if (!email.value || !password.value) return
  loading.value = true
  errorMsg.value = ''

  try {
    await auth.login(email.value, password.value)
    ui.toast.success('¡Bienvenido de vuelta!')
    const redirect = (route.query['redirect'] as string | undefined) ?? '/workspace'
    void router.push(redirect)
  } catch (e) {
    errorMsg.value =
      e instanceof ApiError
        ? e.message
        : 'Error al iniciar sesión. Inténtalo de nuevo.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4 py-16">
    <div class="w-full max-w-sm">
      <!-- Header -->
      <div class="mb-8 text-center">
        <RouterLink to="/" class="inline-flex items-center gap-2 text-violet-400 hover:text-violet-300 transition-colors mb-6">
          <svg class="h-8 w-8" viewBox="0 0 32 32" fill="none">
            <path d="M12 24V11l14-3v13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="9" cy="24" r="3" stroke="currentColor" stroke-width="2"/>
            <circle cx="23" cy="21" r="3" stroke="currentColor" stroke-width="2"/>
          </svg>
        </RouterLink>
        <h1 class="text-2xl font-bold text-slate-100">Iniciar sesión</h1>
        <p class="mt-2 text-sm text-slate-500">Accede a tu workspace de partituras</p>
      </div>

      <!-- Form -->
      <form class="card p-6 space-y-5" @submit.prevent="handleSubmit">
        <BaseAlert v-if="errorMsg" type="error" :message="errorMsg" />

        <div>
          <label for="email" class="label">Correo electrónico</label>
          <input
            id="email"
            v-model="email"
            type="email"
            class="input"
            placeholder="tu@correo.com"
            autocomplete="email"
            required
          />
        </div>

        <div>
          <label for="password" class="label">Contraseña</label>
          <input
            id="password"
            v-model="password"
            type="password"
            class="input"
            placeholder="••••••••"
            autocomplete="current-password"
            required
          />
        </div>

        <button type="submit" class="btn btn-primary w-full py-2.5" :disabled="loading">
          <BaseSpinner v-if="loading" size="sm" />
          <span>{{ loading ? 'Iniciando sesión…' : 'Iniciar sesión' }}</span>
        </button>

        <p class="text-center text-sm text-slate-500">
          ¿No tienes cuenta?
          <RouterLink to="/signup" class="text-violet-400 hover:text-violet-300 transition-colors font-medium">
            Regístrate gratis
          </RouterLink>
        </p>
      </form>
    </div>
  </div>
</template>
