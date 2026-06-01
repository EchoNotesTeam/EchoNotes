import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiMe, apiLogin, apiSignup, apiLogout } from '@/api/index.js'
import type { User } from '@/api/index.js'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  // ready is true once we've fetched /api/me at least once (regardless of outcome)
  const ready = ref(false)

  async function init() {
    if (ready.value) return
    try {
      const { user: me } = await apiMe()
      user.value = me
    } catch {
      user.value = null
    } finally {
      ready.value = true
    }
  }

  async function login(email: string, password: string) {
    const { user: me } = await apiLogin(email, password)
    user.value = me
    return me
  }

  async function signup(data: {
    email: string
    username: string
    password: string
    displayName: string
  }) {
    const { user: me } = await apiSignup(data)
    user.value = me
    return me
  }

  async function logout() {
    await apiLogout()
    user.value = null
  }

  const isLoggedIn = computed(() => user.value !== null)

  return { user, ready, isLoggedIn, init, login, signup, logout }
})
