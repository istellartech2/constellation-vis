import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { Plugin } from "vite";

const root = resolve(import.meta.dirname, "..");
const overrides = join(root, "scripts/license-overrides");

function packageDirectory(moduleId: string): string | null {
  const clean = moduleId.split("?")[0];
  if (!clean.includes(`${sep}node_modules${sep}`)) return null;
  let dir = dirname(clean);
  while (dir.includes(`${sep}node_modules${sep}`)) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      const data = JSON.parse(readFileSync(pkg, "utf8"));
      if (data.name && data.version) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function noticesForModules(moduleIds: Iterable<string>): string {
  const dirs = new Set<string>();
  for (const id of moduleIds) {
    const dir = packageDirectory(id);
    if (dir) dirs.add(dir);
  }
  const groups = new Map<string, string[]>();
  for (const dir of dirs) {
    const meta = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const files = readdirSync(dir).filter((f) => /^(license|licence|copying|notice)(\.(md|txt))?$/i.test(f));
    const parts = files.sort().map((f) => `--- ${f} ---\n${readFileSync(join(dir, f), "utf8").trim()}`);
    if (existsSync(join(dir, "licenses"))) {
      for (const f of readdirSync(join(dir, "licenses")).sort()) {
        parts.push(`--- licenses/${f} ---\n${readFileSync(join(dir, "licenses", f), "utf8").trim()}`);
      }
    }
    if (!parts.length && meta.name.startsWith("@radix-ui/")) {
      parts.push(readFileSync(join(overrides, "radix-LICENSE"), "utf8").trim());
    }
    if (!parts.length && meta.name === "react-remove-scroll-bar" && meta.version === "2.3.8") {
      if (meta.license !== "MIT") {
        throw new Error(`Unexpected license for ${meta.name}@${meta.version}: ${meta.license}`);
      }
      // The npm package omits LICENSE. This copy is from upstream commit
      // 7301c160fda44cb8cf2b9fdfde61efad35736196.
      parts.push(readFileSync(join(overrides, "react-remove-scroll-bar-LICENSE"), "utf8").trim());
    }
    if (!parts.length && meta.name === "isarray" && meta.version === "1.0.0") {
      // This published package embeds the full MIT notice in README.md.
      const readme = readFileSync(join(dir, "README.md"), "utf8");
      const license = readme.split("## License\n")[1]?.trim();
      if (meta.license !== "MIT" || !license?.includes("Permission is hereby granted")) {
        throw new Error("Unexpected license notice for isarray@1.0.0");
      }
      parts.push(`--- README.md license ---\n${license.replaceAll("&lt;", "<").replaceAll("&gt;", ">")}`);
    }
    if (!parts.length && meta.name === "@nodable/entities" && meta.version === "3.1.0") {
      // npm omits LICENSE; upstream nodable/val-parsers commit
      // 4fe544c219e52cb6e302c43a88824a8333babe3e contains the MIT notice.
      if (meta.license !== "MIT") throw new Error("Unexpected license for @nodable/entities@3.1.0");
      parts.push(readFileSync(join(overrides, "nodable-entities-LICENSE"), "utf8").trim());
    }
    if (!parts.length) {
      throw new Error(`Missing license notice for ${meta.name}@${meta.version}; verify upstream terms and add a version-specific override.`);
    }
    if (meta.name === "katex") {
      parts.push(`--- KaTeX fonts: SIL Open Font License 1.1 ---\nCopyright (c) 2009-2010 Design Science, Inc.\nCopyright (c) 2014-2018 Khan Academy\n\n${readFileSync(join(overrides, "OFL-1.1.txt"), "utf8").trim()}`);
    }
    const content = parts.join("\n\n");
    const names = groups.get(content) ?? [];
    names.push(`${meta.name}@${meta.version} (${meta.license || "unknown"})`);
    groups.set(content, names);
  }
  const sections = [...groups].map(([content, names]) =>
    `${names.sort().join("\n")}\n${"=".repeat(60)}\n${content}`,
  );
  return `Copyright 2026 Interstellar Technologies Inc.\nProject-authored material is licensed under Apache-2.0; see LICENSE.\nThird-party components retain their own licenses; see below and docs/THIRD-PARTY.md in the source repository.\n\n${sections.sort().join("\n\n")}\n`;
}

const webModules = new Set<string>();

export function thirdPartyNotices(worker = false): Plugin {
  return {
    name: worker ? "third-party-worker-notices" : "third-party-notices",
    moduleParsed(module) {
      webModules.add(module.id);
    },
    generateBundle() {
      if (!worker) {
        this.emitFile({ type: "asset", fileName: "LICENSE", source: readFileSync(join(root, "LICENSE"), "utf8") });
        this.emitFile({ type: "asset", fileName: "third-party-licenses.txt", source: noticesForModules(webModules) });
      }
    },
  };
}
