/**
 * B5 — common library no-mock / infer coverage gate.
 *
 * Asserts that infer/check can run on real JS packages from node_modules
 * **without handwritten mocks**:
 * 1. checkSource scans their JS sources with FP=0 (same ERROR_CODES as
 *    check-real-packages — that suite remains the precision lock).
 * 2. analyzeFile does not crash and produces structured output.
 * 3. At least one scanned file yields a case whose formatShape is **not**
 *    a whole-page `unknown` — signatures must be inductively useful, not
 *    merely "did not throw".
 *
 * Resolution uses packages/core's node_modules (pnpm isolated layout)
 * because those fixture packages are core devDependencies.
 * `analyzeFile` is imported via the vitest alias → service src (not dist).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { checkSource, formatShape } from "@nudojs/core";
import { analyzeFile } from "../index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const monorepoRoot = resolveUp(here, 4);
const requireFromCore = createRequire(
  join(monorepoRoot, "packages/core/package.json"),
);

const ERROR_CODES = [
  "nudo:constraint-violated",
  "nudo:assign-mismatch",
  "nudo:arg-structure",
  "nudo:case-inconsistency",
] as const;

type InferOutcome = {
  pkg: string;
  file: string;
  scanned: boolean;
  analyzeThrew?: string;
  fnCount?: number;
  caseCount?: number;
  sampleFormat?: string;
  formats: string[];
  violations: string[];
};

function resolveUp(from: string, levels: number): string {
  let p = from;
  for (let i = 0; i < levels; i++) p = dirname(p);
  return p;
}

function resolvePkgRoot(pkgName: string): string | undefined {
  try {
    return dirname(requireFromCore.resolve(`${pkgName}/package.json`));
  } catch {
    try {
      let p = requireFromCore.resolve(pkgName);
      for (let i = 0; i < 4; i++) {
        const parent = dirname(p);
        if (existsSync(join(parent, "package.json"))) return parent;
        p = parent;
      }
    } catch {
      // not installed
    }
  }
  return undefined;
}

function isUsefulFormat(fmt: string | undefined): boolean {
  if (!fmt) return false;
  const t = fmt.trim();
  return t !== "unknown" && t !== "any" && t !== "·" && t !== "";
}

function scanInfer(pkgName: string, maxFiles = 4): InferOutcome[] {
  const pkgRoot = resolvePkgRoot(pkgName);
  if (!pkgRoot) return [];
  const out: InferOutcome[] = [];

  const candidates: string[] = [];
  const entryTries = [
    "index.js",
    "index.mjs",
    "index.cjs",
    "ms.js",
    "debug.js",
    "src/index.js",
    "lib/index.js",
    "lib/ms.js",
    "lib/debug.js",
  ];
  for (const name of entryTries) {
    const p = join(pkgRoot, name);
    if (existsSync(p)) candidates.push(p);
  }
  const libDir = join(pkgRoot, "lib");
  if (existsSync(libDir) && candidates.length === 0) {
    try {
      for (const f of readdirSync(libDir)) {
        if (f.endsWith(".js") && candidates.length < maxFiles) {
          candidates.push(join(libDir, f));
        }
      }
    } catch {
      // ignore
    }
  }
  if (candidates.length === 0) {
    try {
      const main = requireFromCore.resolve(pkgName);
      if (existsSync(main)) candidates.push(main);
    } catch {
      // ignore
    }
  }

  for (const file of candidates.slice(0, maxFiles)) {
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const label = `${pkgName}/${file.slice(pkgRoot.length + 1)}`;
    const violations: string[] = [];
    try {
      const r = checkSource(label, source);
      for (const i of r.issues) {
        if (i.severity === "error" && (ERROR_CODES as readonly string[]).includes(i.code)) {
          violations.push(`${label}:${i.line ?? "?"} [${i.code}] ${i.message}`);
        }
      }
    } catch (e) {
      out.push({
        pkg: pkgName,
        file: label,
        scanned: false,
        analyzeThrew: `checkSource: ${(e as Error).message}`,
        formats: [],
        violations,
      });
      continue;
    }

    let analyzeThrew: string | undefined;
    let fnCount = 0;
    let caseCount = 0;
    let sampleFormat: string | undefined;
    const formats: string[] = [];
    try {
      const result = analyzeFile(file, source);
      fnCount = result.functions?.length ?? 0;
      for (const fn of result.functions ?? []) {
        caseCount += fn.cases?.length ?? 0;
        for (const c of fn.cases ?? []) {
          const fmt = formatShape(c.abs);
          formats.push(fmt);
          if (!sampleFormat) sampleFormat = fmt;
        }
      }
    } catch (e) {
      analyzeThrew = `analyzeFile: ${(e as Error).message}`;
    }

    out.push({
      pkg: pkgName,
      file: label,
      scanned: true,
      analyzeThrew,
      fnCount,
      caseCount,
      sampleFormat,
      formats,
      violations,
    });
  }
  return out;
}

describe("real package no-mock infer gate (B5)", () => {
  /**
   * requireUsefulSignature: at least one case format is not whole-page `unknown`.
   * `ms` has call-site-ish surface that inducts concrete leaves without mocks.
   * `commander` / `escape-string-regexp` / `debug` currently yield honest
   * `entry@`/`unknown` under default exports-mode with no call sites — that is
   * a design-limitations ceiling, not a crash; B5 still locks FP=0 + structured run.
   * The suite-level pin requires *at least one* installed package to show useful leaves.
   */
  const packages = [
    { name: "ms", minFiles: 1, requireUsefulSignature: true, requireCases: true },
    { name: "commander", minFiles: 1, requireUsefulSignature: false, requireCases: true },
    { name: "escape-string-regexp", minFiles: 1, requireUsefulSignature: false, requireCases: true },
    { name: "debug", minFiles: 1, requireUsefulSignature: false, requireCases: false },
  ];

  for (const { name, minFiles, requireUsefulSignature, requireCases } of packages) {
    it(`${name}: checkSource + analyzeFile run without mocks; FP=0; structured`, () => {
      const root = resolvePkgRoot(name);
      if (!root) {
        console.info(`[infer-real] SKIP ${name}: not on packages/core node_modules path`);
        return;
      }
      const outcomes = scanInfer(name, 6);
      const scanned = outcomes.filter((o) => o.scanned);
      expect(scanned.length, `${name}: expected ≥${minFiles} scanned files`).toBeGreaterThan(
        minFiles - 1,
      );
      const allViolations = outcomes.flatMap((o) => o.violations);
      expect(allViolations, allViolations.join("\n").slice(0, 2000)).toEqual([]);
      const threw = outcomes.filter((o) => o.analyzeThrew);
      expect(
        threw,
        threw.map((t) => t.analyzeThrew).join("\n").slice(0, 2000),
      ).toEqual([]);

      if (requireCases) {
        const caseSum = outcomes.reduce((s, o) => s + (o.caseCount ?? 0), 0);
        expect(caseSum, `${name}: expected structured analyzeFile cases`).toBeGreaterThan(0);
      }

      const allFormats = outcomes.flatMap((o) => o.formats);
      const useful = allFormats.filter(isUsefulFormat);
      console.info(
        `[infer-real] ${name}: scanned=${scanned.length} formats=${allFormats.length} useful=${useful.length} sample=${allFormats[0] ?? "—"}`,
      );
      if (requireUsefulSignature) {
        expect(
          useful.length,
          `${name}: expected ≥1 case format that is not whole-page unknown; got ${JSON.stringify(allFormats.slice(0, 8))}`,
        ).toBeGreaterThan(0);
      }
    });
  }

  it("records at least one installed package producing a useful (non-unknown) signature", () => {
    const installed = ["ms", "commander", "debug", "escape-string-regexp"].filter(
      (n) => !!resolvePkgRoot(n),
    );
    if (installed.length === 0) {
      console.info("[infer-real] no fixture packages installed — skip signature signal");
      return;
    }
    let sawUseful = false;
    for (const name of installed) {
      for (const o of scanInfer(name, 2)) {
        if (o.formats.some(isUsefulFormat)) sawUseful = true;
      }
    }
    console.info(`[infer-real] saw useful analyzeFile signature: ${sawUseful}`);
    // Soft when every fixture is missing useful leaves would be a product regression —
    // hard-fail when any fixture package is installed (ms currently supplies the pin).
    expect(sawUseful, "at least one real package must yield non-unknown case formats").toBe(true);
  });
});
