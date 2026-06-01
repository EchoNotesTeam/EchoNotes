import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth.js'

// Extend Vue Router's RouteMeta so TypeScript knows our custom fields.
declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    guestOnly?: boolean
  }
}

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior() {
    return { top: 0, behavior: 'smooth' }
  },
  routes: [
    {
      path: '/',
      component: () => import('@/views/LandingView.vue'),
    },
    {
      path: '/login',
      component: () => import('@/views/LoginView.vue'),
      meta: { guestOnly: true },
    },
    {
      path: '/signup',
      component: () => import('@/views/SignupView.vue'),
      meta: { guestOnly: true },
    },
    {
      path: '/workspace',
      component: () => import('@/views/WorkspaceView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/upload',
      component: () => import('@/views/UploadView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/sheets/:id',
      component: () => import('@/views/SheetDetailView.vue'),
    },
    {
      path: '/blog',
      component: () => import('@/views/BlogView.vue'),
    },
    {
      path: '/blog/:slug',
      component: () => import('@/views/BlogPostView.vue'),
    },
    {
      path: '/u/:username',
      component: () => import('@/views/ProfileView.vue'),
    },
    // Catch-all redirect
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

// Navigation guard — initialises auth once per session
router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.ready) await auth.init()

  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  if (to.meta.guestOnly && auth.isLoggedIn) {
    return { path: '/workspace' }
  }
})
