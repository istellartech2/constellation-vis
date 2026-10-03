/** Vercel runs native Node ESM: bundle shared domain imports into one module. */
const result = await Bun.build({
  entrypoints: ["server/vercelHandler.ts"],
  outdir: "server/generated",
  naming: "sessionHandler.mjs",
  target: "node",
  format: "esm",
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
