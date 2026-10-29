# Releasing

## Versioning

The project is in initial development. The first planned release is `0.1.0`; until `1.0.0`, saved scenarios, CLI behavior and output, and the AI API may change incompatibly. Increase the minor version for feature changes (`0.1.0` → `0.2.0`) and the patch version for bug fixes (`0.1.0` → `0.1.1`). Describe breaking changes and migration steps in the release notes, including when a bug fix is incompatible. Decide what compatibility is promised before adopting `1.0.0`.

`package.json` is the source of the app and CLI version; CLI help, `--version`, and the result's `generator.version` use it. The result's `schemaVersion` describes the output format, not the application release, and changes only when its schema requires it.

## Prepare a release

1. Choose a version and review the proposed changes, compatibility impacts, known limitations, and third-party notices. Update `package.json` and relevant documentation in a release PR; do not create a tag yet.
2. From a clean checkout of the proposed commit, run `bun install --frozen-lockfile`, `bun run lint`, `bun run test`, `bun run build`, and `bun run build:cli`. Check the generated CLI runs the example scenario and its distribution includes `LICENSE` and `third-party-licenses.txt`. Build commands replace `dist/`; do not commit it.
3. Exercise the relevant flows in a preview: save/load a scenario, import data, use the analyses, and run the CLI. Check desktop and mobile layouts. If AI sessions are in scope, verify creation, updates and termination using the preview environment.
4. Prepare concise release notes: highlights, breaking changes and migrations, known limitations, and how to run the CLI. Note that it needs Bun installed separately.
5. Have the release PR reviewed when possible and merge after required checks pass. Merging to `main` triggers production deployment; verify the deployed version and core flows before announcing the release. See [deployment](deployment.md).

## Publish

With authorization to release, confirm the intended commit is on the remote `main` and has passed checks. Create an annotated `v<version>` tag on that exact commit, push the tag, and create a GitHub Release with the prepared notes. Attach a CLI archive only if distributing one; include the generated license files and verify the archive's contents. Never commit `dist/` or move an already published tag to different content. If a release needs correction, publish a new version.

Use `0.1.0-rc.1` or another pre-release identifier for a candidate if useful; mark it as a pre-release and do not present it as the final `0.1.0`. A tag or GitHub Release does not itself deploy this application's production site: deployment follows `main` as described above.
