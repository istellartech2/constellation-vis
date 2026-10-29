import { chmod, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { noticesForModules } from "./third-party-notices";

const projectRoot = resolve(import.meta.dir, "..");
const outputDirectory = join(projectRoot, "dist");
const executablePath = join(outputDirectory, "constelation-cli");
const metafilePath = join(outputDirectory, "cli-metafile.json");

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const build = Bun.spawn([
  "bun",
  "build",
  "--target=bun",
  join(projectRoot, "src/cli/main.ts"),
  "--outfile",
  executablePath,
  `--metafile=${metafilePath}`,
], {
  cwd: projectRoot,
  stdout: "inherit",
  stderr: "inherit",
});

const exitCode = await build.exited;
if (exitCode !== 0) process.exit(exitCode);

const metafile = JSON.parse(await readFile(metafilePath, "utf8")) as { inputs: Record<string, unknown> };
const modules = Object.keys(metafile.inputs).map((input) => resolve(projectRoot, input));
await writeFile(join(outputDirectory, "third-party-licenses.txt"), noticesForModules(modules));
await chmod(executablePath, 0o755);
await rm(metafilePath);

await Promise.all([
  copyFile(join(projectRoot, "LICENSE"), join(outputDirectory, "LICENSE")),
  copyFile(
    join(projectRoot, "docs/constelation-cli-SKILLS.md"),
    join(outputDirectory, "SKILLS.md"),
  ),
  copyFile(
    join(projectRoot, "tests/transporter-tokyo-tsukuba.toml"),
    join(outputDirectory, "example-scenario.toml"),
  ),
]);

console.log("Created Bun-powered CLI distribution in dist/");
