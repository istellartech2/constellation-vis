import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { thirdPartyNotices } from './scripts/third-party-notices.ts'

// https://vite.dev/config/
const env = (globalThis as unknown as { process?: { env?: { BASE_URL?: string; PORT?: string } } }).process?.env;
const base = env?.BASE_URL || '/';
// Honor a PORT assigned by the environment (e.g. preview tooling) so the dev
// server binds where the proxy expects it; otherwise fall back to Vite's default.
const port = env?.PORT ? Number(env.PORT) : undefined;

export default defineConfig({
  plugins: [react(), tailwindcss(), thirdPartyNotices(), {
    name: 'local-session-api-loader',
    apply: 'serve',
    async configureServer(server) {
      const { configureLocalSession } = await server.ssrLoadModule('/src/server/localSessionPlugin.ts')
      configureLocalSession(server)
    },
  }],
  worker: { format: 'es', plugins: () => [thirdPartyNotices(true)] },
  build: {
    rolldownOptions: {
      output: { strictExecutionOrder: true, codeSplitting: { groups: [
        { name: 'vendor', test: /node_modules/, maxSize: 600_000 },
        { name: 'analysis', test: /[\\/]src[\\/]components[\\/]analysis[\\/]/, maxSize: 600_000 },
      ] } },
    },
  },
  base,
  server: port ? { port } : undefined,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "size-sensor": path.resolve(import.meta.dirname, "./src/lib/chartResizeObserver.ts"),
      "stream": "stream-browserify",
      "events": "events/",
      "process": "process/browser",
    },
  },
})
