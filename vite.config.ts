import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { thirdPartyNotices } from './scripts/third-party-notices'

// https://vite.dev/config/
const env = (globalThis as unknown as { process?: { env?: { BASE_URL?: string; PORT?: string } } }).process?.env;
const base = env?.BASE_URL || '/';
// Honor a PORT assigned by the environment (e.g. preview tooling) so the dev
// server binds where the proxy expects it; otherwise fall back to Vite's default.
const port = env?.PORT ? Number(env.PORT) : undefined;

export default defineConfig({
  plugins: [react(), tailwindcss(), thirdPartyNotices()],
  worker: { plugins: () => [thirdPartyNotices(true)] },
  base,
  server: port ? { port } : undefined,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "size-sensor": path.resolve(__dirname, "./src/lib/chartResizeObserver.ts"),
    },
  },
})
