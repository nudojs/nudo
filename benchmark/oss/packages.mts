/**
 * Real OSS package set for S1-upgrade baseline (not synthetic).
 * Resolution walks Node require from the monorepo; missing packages fail the bench.
 */
import { createRequire } from "node:module";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

const require = createRequire(join(import.meta.dirname, "../../packages/core/src/index.ts"));

export type OssFile = { label: string; path: string; source: string; bytes: number };
export type OssPackage = {
  name: string;
  root: string;
  files: OssFile[];
  bytes: number;
};

/** Medium real JS packages: CLI + utility + parser-ish (commander family). */
export const OSS_PACKAGES = ["commander", "yargs", "semver"] as const;

export function resolvePackageRoot(pkg: string): string {
  try {
    return dirname(require.resolve(`${pkg}/package.json`));
  } catch {
    // exports may omit ./package.json — walk from main
    let p = require.resolve(pkg);
    for (let i = 0; i < 5; i++) {
      const parent = dirname(p);
      if (existsSync(join(parent, "package.json"))) return parent;
      p = parent;
    }
    throw new Error(`cannot resolve package root for ${pkg}`);
  }
}

function walkJs(root: string, out: string[], dir = root): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "test" || e.name === "tests" || e.name === "typings") {
      continue;
    }
    const p = join(dir, e.name);
    if (e.isDirectory()) walkJs(root, out, p);
    else if (/\.(mjs|cjs)$/.test(e.name) || e.name.endsWith(".js")) out.push(p);
  }
}

export function loadOssPackages(names: readonly string[] = OSS_PACKAGES): OssPackage[] {
  return names.map((name) => {
    const root = resolvePackageRoot(name);
    const paths: string[] = [];
    walkJs(root, paths);
    paths.sort();
    const files: OssFile[] = paths.map((p) => {
      const source = readFileSync(p, "utf8");
      return {
        label: `${name}/${p.slice(root.length + 1)}`,
        path: p,
        source,
        bytes: statSync(p).size,
      };
    });
    const bytes = files.reduce((s, f) => s + f.bytes, 0);
    return { name, root, files, bytes };
  });
}
