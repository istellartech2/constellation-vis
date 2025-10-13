# Claude Code Guide

These instructions tailor the general `AGENTS.md` playbook for claude.ai/code. Keep them handy whenever you spin up a new Claude task inside this repository.

## 1. Prep Checklist
- Skim `AGENTS.md` first—treat it as the source of truth for project structure, tooling, and conventions.
- Confirm dependencies with `bun install` if the workspace is fresh; Bun scripts expect Bun ≥1.0.
- If the task touches satellite/constellation data, open the TOML files under `public/` and check whether schema updates will require changes to `scripts/generate-satellites.ts`.

## 2. Editing Workflow
- Let prehooks regenerate data: `bun run dev`/`bun run build` will call `scripts/generate-satellites.ts`. Run the script manually only when you need to inspect the generated file.
- Keep diffs scoped and typed—extend the domain models in `src/lib/*.ts` rather than sprinkling loose objects inside components.
- Reuse the existing UI primitives in `src/components/ui` and chart helpers in `src/components/analysis/utils` before introducing new third-party components.
- Avoid manual edits to `src/lib/satellites.generated.ts`; instead, tweak the TOML inputs or the generator.

## 3. Validation Routine
- For logic changes run `bun run test`; for UI or config adjustments at least run `bun run lint`. Mention every command you executed in your final message.
- When orbit/visibility math is impacted, add or update Vitest specs in `tests/`, mirroring the deterministic fixtures already present.
- Execute `bun run build` for major refactors to ensure both the TypeScript project references and Vite build succeed.

## 4. Communication Tips
- Summaries should lead with the change impact, call out generated artifacts, and list validations. Flag any steps you could not run.
- If you modify TOML or generator logic, remind the reviewer that `predev/prebuild` regenerate `src/lib/satellites.generated.ts`.
- Point to relevant files using repo-relative paths in backticks (e.g., `src/lib/visibility.ts:42`), matching the house style.

## 5. Common Pitfalls
- Missing UTC quoting in TOML epochs causes the generator to throw—mirror the `preprocessToml` logic if new date fields are added.
- New Three.js resources must be disposed inside the cleanup returned from `useSatelliteScene` to prevent GPU leaks.
- Tailwind v4 configuration lives inside `src/index.css`; do not add a separate `tailwind.config.js`.

Follow this flow and Claude Code will stay aligned with the rest of the tooling used on this project.
