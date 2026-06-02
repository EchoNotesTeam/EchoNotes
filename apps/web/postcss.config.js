// PostCSS config must be plain JS: vite/postcss-load-config can't transpile a
// .ts config without ts-node. Tailwind still loads tailwind.config.ts via jiti.
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
