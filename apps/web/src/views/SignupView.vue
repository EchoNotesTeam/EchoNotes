<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'
import { useUiStore } from '@/stores/ui.js'
import { ApiError } from '@/api/index.js'
import BaseSpinner from '@/components/BaseSpinner.vue'
import BaseAlert from '@/components/BaseAlert.vue'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()

const form = ref({
  displayName: '',
  username: '',
  email: '',
  password: '',
})
const loading = ref(false)
const errorMsg = ref('')

const usernamePattern = /^[a-z0-9_]{3,30}$/

function validateUsername(val: string): string | null {
  if (!val) return 'El nombre de usuario es requerido'
  if (!usernamePattern.test(val))
    return 'Solo letras minúsculas, números y guion bajo (3-30 caracteres)'
  return null
}

async function handleSubmit() {
  const usernameError = validateUsername(form.value.username)
  if (usernameError) {
    errorMsg.value = usernameError
    return
  }
  if (form.value.password.length < 6) {
    errorMsg.value = 'La contraseña debe tener al menos 6 caracteres'
    return
  }

  loading.value = true
  errorMsg.value = ''

  try {
    await auth.signup(form.value)
    ui.toast.success('¡Cuenta creada exitosamente!')
    void router.push('/workspace')
  } catch (e) {
    errorMsg.value =
      e instanceof ApiError ? e.message : 'Error al crear cuenta. Inténtalo de nuevo.'
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
        <h1 class="text-2xl font-bold text-slate-100">Crear cuenta</h1>
        <p class="mt-2 text-sm text-slate-500">Empieza a transcribir tu música hoy</p>
      </div>

      <!-- Form -->
      <form class="card p-6 space-y-4" @submit.prevent="handleSubmit">
        <BaseAlert v-if="errorMsg" type="error" :message="errorMsg" />

        <div>
          <label for="displayName" class="label">Nombre completo</label>
          <input
            id="displayName"
            v-model="form.displayName"
            type="text"
            class="input"
            placeholder="Juan Pérez"
            autocomplete="name"
            required
            maxlength="60"
          />
        </div>

        <div>
          <label for="username" class="label">
            Nombre de usuario
            <span class="ml-1 text-xs text-slate-600">(letras minúsculas, números, _)</span>
          </label>
          <div class="relative">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm select-none">@</span>
            <input
              id="username"
              v-model="form.username"
              type="text"
              class="input pl-7"
              placeholder="juanperez"
              autocomplete="username"
              required
              minlength="3"
              maxlength="30"
              pattern="[a-z0-9_]+"
            />
          </div>
        </div>

        <div>
          <label for="email" class="label">Correo electrónico</label>
          <input
            id="email"
            v-model="form.email"
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
            v-model="form.password"
            type="password"
            class="input"
            placeholder="Mínimo 6 caracteres"
            autocomplete="new-password"
            required
            minlength="6"
          />
        </div>

        <button type="submit" class="btn btn-primary w-full py-2.5" :disabled="loading">
          <BaseSpinner v-if="loading" size="sm" />
          <span>{{ loading ? 'Creando cuenta…' : 'Crear cuenta gratis' }}</span>
        </button>

        <p class="text-center text-sm text-slate-500">
          ¿Ya tienes cuenta?
          <RouterLink to="/login" class="text-violet-400 hover:text-violet-300 transition-colors font-medium">
            Inicia sesión
          </RouterLink>
        </p>
      </form>
    </div>
  </div>
</template>
