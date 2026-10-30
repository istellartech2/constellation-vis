# Contributing

Thanks for helping improve Constellation Visualizer. Use [Bun](https://bun.sh/) 1.3.11 or later.

## Pull requests

1. Start from an up-to-date `main` and use a short-lived branch. Keep each PR focused; a draft PR is welcome for work in progress.
2. Describe the problem, the change, and how you verified it. Call out changes to saved scenarios, CLI output, the AI API, or calculation results and any migration users need. For UI changes, include a screenshot when it helps explain the change.
3. Run the checks below and resolve CI failures before merging. Add focused tests for behavior changes, especially orbital propagation and visibility. Update documentation when behavior or assumptions change.
4. Request review when a reviewer is available. After approval and passing checks, merge into `main` and delete the finished branch when it is no longer needed. A merge to `main` triggers a production deployment; check the deployment before considering the change complete.

```sh
bun install --frozen-lockfile
bun run lint
bun run test
bun run build
bun run build:cli
```

`build:cli` replaces `dist/` with the CLI distribution. Do not commit `dist/`, `node_modules/`, secrets, or local experiment outputs. Satellite data is generated from TOML; update the inputs and regenerate instead of editing `src/lib/satellites.generated.ts` by hand. See [AGENTS.md](../AGENTS.md) for project conventions and [releasing](releasing.md) for version and release procedures.
