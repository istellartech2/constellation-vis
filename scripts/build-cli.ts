import { copyFile, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const outputDirectory = join(projectRoot, "dist");
const executablePath = join(outputDirectory, "constelation-cli");

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const build = Bun.spawn([
  "bun",
  "build",
  "--compile",
  join(projectRoot, "src/cli/main.ts"),
  "--outfile",
  executablePath,
], {
  cwd: projectRoot,
  stdout: "inherit",
  stderr: "inherit",
});

const exitCode = await build.exited;
if (exitCode !== 0) process.exit(exitCode);

await Promise.all([
  copyFile(
    join(projectRoot, "docs/constelation-cli-SKILLS.md"),
    join(outputDirectory, "SKILLS.md"),
  ),
  copyFile(
    join(projectRoot, "tests/transporter-tokyo-tsukuba.toml"),
    join(outputDirectory, "example-scenario.toml"),
  ),
]);

console.log("Created clean CLI distribution in dist/");
