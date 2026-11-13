import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the built site works from any host or subfolder (e.g. GitHub Pages).
  base: './',
  // Fixed port so the local URL registered in Forma stays the same.
  // Raw source data isn't part of the app; skip watching it (OneDrive can lock those files while syncing).
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/data-sources/**'] } },
})
