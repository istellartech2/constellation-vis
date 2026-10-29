# Deployment and local API development

The [live application](https://constellation-vis-rho.vercel.app/) is hosted in the Interstellar Technologies Inc Vercel team. The GitHub repository is connected to Vercel: pushes to `main` deploy production, while other branches receive preview deployments. `vercel.json` runs lint, the Bun test suite, TypeScript and Vite before publishing. GitHub Actions also runs CI, including the CLI build.

The Vite base path is `/`. The retained GitHub Pages workflow is for manual legacy deployments and sets `BASE_URL=/constellation-vis/`.

## AI sessions

In the scenario menu, start **AI連携**, copy the connection instructions, and give them to an external AI. Sessions use independent browser/controller bearer tokens, encrypted Redis data, a fixed one-hour TTL and optimistic revisions. Ending a session deletes the live record. See the [AI session API guide](../public/ai-api.md) for the protocol, privacy boundaries, and examples.

The server uses these environment variables:

- `KV_REST_API_URL` and `KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, supplied by the project's Upstash integration.
- `SESSION_ENCRYPTION_KEY`: 32 random bytes encoded as 64 hexadecimal characters. Set it as a sensitive production/preview variable, never with a `VITE_` prefix. Changing it invalidates existing encrypted sessions.

For local API development, use `vercel dev` with development Redis credentials and a separate local encryption key. `bun run dev` runs only the Vite frontend. Production and preview Redis keys are namespaced separately. Secrets, local environments, simulation run outputs and local datasets are excluded from deploy uploads.
