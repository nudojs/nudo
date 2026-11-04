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

/**
 * Medium real JS packages: CLI + utility + parser-ish, all resolvable from the
 * monorepo's dependency tree (resolution fails the bench if a package goes missing).
 * Small utilities (eventemitter3/ms/kleur/…) are also pinned zero-FP by
 * `check-real-packages.test.ts`; this bench adds the latency + hub-edit face.
 *
 * `debug` and `@changesets/cli` were re-admitted after the host-global-purity
 * fix (B1/B2): fork/member-write rebinds are gated on `$rebindable`, so
 * analyzing them no longer clobbers the host `process` / `globalThis.Error`.
 *
 * Excluded on purpose (honest boundary — do not re-add casually):
 * - `lodash` — 1000+ module files; blows the bench wall-clock budget.
 * - `@babel/types` — wall-clock, not correctness: the B3 fix (symbolic
 *   host-result normalization) removed the `checkSource` crash, but the corpus
 *   is one ~3 MB bundled lib where a single `checkSource` pass takes ~4 min —
 *   past the per-round budget.
 * - `@babel/parser` / `@babel/traverse` — single-file bundles; cold analyze
 *   (parser: ~45 s for 2 files) dominates a bench round past the budget.
 */
export const OSS_PACKAGES = [
  "commander", // medium CLI library (already zero-FP in unit gold)
  "yargs", // larger CLI surface, more import edges (hub-edit interesting)
  "semver", // mid-size utility with internal graph
  "debug", // env-poking logger (top-level process.env member writes; host-purity canary for B1/B2)
  "@changesets/cli", // bundled CLI with lazy error-code classes (globalThis.Error member writes; canary for B2)
  "eventemitter3", // class-heavy event emitter
  "kleur", // terminal-color utility (chain-call style)
  "ms", // single-file time-formatting util
  "is-plain-obj", // single-file type predicate
  "escape-string-regexp", // single-file string util
  "p-limit", // single-file async concurrency limiter (uses yocto-queue)
  "yocto-queue", // single-file class queue (p-limit dependency)
] as const;

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
