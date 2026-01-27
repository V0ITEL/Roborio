import { defineConfig } from 'vite'
import handlebars from 'vite-plugin-handlebars'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    handlebars({
      partialDirectory: resolve(__dirname, 'partials'),
    }),
  ],

  resolve: {
    alias: {
      buffer: 'buffer/',
      process: 'process/browser',
    },
  },

  define: {
    global: 'globalThis',
  },

  optimizeDeps: {
    include: ['buffer', 'process'],
  },

  
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },

  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': {
        target: 'https://roborio.vercel.app',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
