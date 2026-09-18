import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    tsconfigPaths: true
  },
  build: {
    minify: true
  },
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    cloudflare(),
  ],

})
