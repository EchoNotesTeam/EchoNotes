import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { router } from './router/index.js'
import App from './App.vue'
import './index.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(VueQueryPlugin, {
  queryClientConfig: {
    defaultOptions: {
      queries: {
        staleTime: 30_000,       // 30s before refetch in background
        retry: 1,
      },
    },
  },
})

app.mount('#app')
