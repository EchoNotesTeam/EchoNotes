<template>
  <footer class="border-t border-slate-800/60 bg-slate-950 py-8">
    <div class="container-page flex flex-col items-center justify-between gap-4 sm:flex-row">
      <div class="flex items-center gap-2 text-slate-500 text-sm">
        <svg class="h-5 w-5 text-violet-600" viewBox="0 0 32 32" fill="none">
          <path d="M12 24V11l14-3v13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="9" cy="24" r="3" stroke="currentColor" stroke-width="2"/>
          <circle cx="23" cy="21" r="3" stroke="currentColor" stroke-width="2"/>
        </svg>
        <span><strong class="text-slate-400">EchoNotes</strong> — Tesis de Sistemas de Información I, UJAP {{ new Date().getFullYear() }}</span>
      </div>
      <nav class="flex items-center gap-4 text-xs text-slate-600">
        <RouterLink to="/blog" class="hover:text-slate-400 transition-colors">Blog</RouterLink>
        <RouterLink to="/" class="hover:text-slate-400 transition-colors">Inicio</RouterLink>
      </nav>
    </div>
  </footer>
</template>
