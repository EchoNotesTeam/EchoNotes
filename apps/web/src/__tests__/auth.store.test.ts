import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock the API module before importing the store so Pinia picks up the mock.
vi.mock('@/api/index.js', () => ({
  apiMe: vi.fn(),
  apiLogin: vi.fn(),
  apiSignup: vi.fn(),
  apiLogout: vi.fn(),
}))

import { useAuthStore } from '@/stores/auth.js'
import { apiMe, apiLogin, apiLogout, apiSignup } from '@/api/index.js'
import type { User } from '@echonotes/shared-types'

const MOCK_USER: User = {
  id: 'u-123',
  email: 'test@echonotes.app',
  username: 'testuser',
  displayName: 'Test User',
}

describe('useAuthStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  // ─── Initial state ──────────────────────────────────────────────────────────

  it('starts with no user, not ready, not logged in', () => {
    const store = useAuthStore()
    expect(store.user).toBeNull()
    expect(store.ready).toBe(false)
    expect(store.isLoggedIn).toBe(false)
  })

  // ─── init() ────────────────────────────────────────────────────────────────

  it('init(): sets user when /api/me succeeds', async () => {
    vi.mocked(apiMe).mockResolvedValueOnce({ user: MOCK_USER })
    const store = useAuthStore()
    await store.init()

    expect(store.user).toEqual(MOCK_USER)
    expect(store.isLoggedIn).toBe(true)
    expect(store.ready).toBe(true)
  })

  it('init(): keeps user=null and marks ready when /api/me returns 401', async () => {
    vi.mocked(apiMe).mockRejectedValueOnce(new Error('Unauthorized'))
    const store = useAuthStore()
    await store.init()

    expect(store.user).toBeNull()
    expect(store.isLoggedIn).toBe(false)
    expect(store.ready).toBe(true)
  })

  it('init() is idempotent — second call skips the network request', async () => {
    vi.mocked(apiMe).mockResolvedValue({ user: MOCK_USER })
    const store = useAuthStore()
    await store.init()
    await store.init()

    expect(apiMe).toHaveBeenCalledOnce()
  })

  // ─── login() ────────────────────────────────────────────────────────────────

  it('login(): updates user and isLoggedIn', async () => {
    vi.mocked(apiLogin).mockResolvedValueOnce({ user: MOCK_USER })
    const store = useAuthStore()
    const returned = await store.login('test@echonotes.app', 'password123')

    expect(store.user).toEqual(MOCK_USER)
    expect(store.isLoggedIn).toBe(true)
    expect(returned).toEqual(MOCK_USER)
  })

  it('login(): propagates API errors', async () => {
    vi.mocked(apiLogin).mockRejectedValueOnce(new Error('Invalid credentials'))
    const store = useAuthStore()
    await expect(store.login('bad@email.com', 'wrong')).rejects.toThrow('Invalid credentials')
    expect(store.user).toBeNull()
  })

  // ─── signup() ──────────────────────────────────────────────────────────────

  it('signup(): sets user on success', async () => {
    vi.mocked(apiSignup).mockResolvedValueOnce({ user: MOCK_USER })
    const store = useAuthStore()
    await store.signup({
      email: 'test@echonotes.app',
      username: 'testuser',
      password: 'pass123',
      displayName: 'Test User',
    })
    expect(store.user).toEqual(MOCK_USER)
    expect(store.isLoggedIn).toBe(true)
  })

  // ─── logout() ──────────────────────────────────────────────────────────────

  it('logout(): clears user and isLoggedIn', async () => {
    vi.mocked(apiMe).mockResolvedValueOnce({ user: MOCK_USER })
    vi.mocked(apiLogout).mockResolvedValueOnce({ success: true })
    const store = useAuthStore()
    await store.init()
    expect(store.isLoggedIn).toBe(true)

    await store.logout()
    expect(store.user).toBeNull()
    expect(store.isLoggedIn).toBe(false)
  })
})
