import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
const base = (globalThis as any).process?.env?.BASE_URL || '/constellation-vis/';

export default defineConfig({
  plugins: [react()],
  base,
})
