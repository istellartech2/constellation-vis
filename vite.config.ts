import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
const env = (globalThis as unknown as { process?: { env?: { BASE_URL?: string; PORT?: string } } }).process?.env;
const base = env?.BASE_URL || '/constellation-vis/';
// Honor a PORT assigned by the environment (e.g. preview tooling) so the dev
// server binds where the proxy expects it; otherwise fall back to Vite's default.
const port = env?.PORT ? Number(env.PORT) : undefined;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base,
  server: port ? { port } : undefined,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
