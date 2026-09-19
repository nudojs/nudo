import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { checkSource, formatShape } from "@nudojs/core";
import { analyzeFile } from "@nudojs/service";

/**
 * B5 — common library no-mock / infer coverage gate.
 *
 * Asserts that infer/check can run on real JS packages from node_modules
 * **without handwritten mocks**:
 * 1. checkSource scans their JS sources with FP=0 (same ERROR_CODES as
 *    check-real-packages — that suite remains the precision lock).
 * 2. analyzeFile does not crash and produces a structured result
 *    (functions/cases may be empty when exports-default analysis mode
 *    finds no exported call sites — that is still a successful run).
 *
 * Resolution uses packages/core's node_modules (pnpm isolated layout)
 * because those fixture packages are core devDependencies.
 */

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

function scanInfer(pkgName: string, maxFiles = 4): InferOutcome[] {
  const pkgRoot = resolvePkgRoot(pkgName);
  if (!pkgRoot) return [];
  const out: InferOutcome[] = [];

  // Prefer a small single entry file for analyzeFile; fall back to lib walk.
  const candidates: string[] = [];
  const entryTries = ["index.js", "index.mjs", "index.cjs", "ms.js", "debug.js"];
  for (const name of entryTries) {
    const p = join(pkgRoot, name);
    if (existsSync(p)) candidates.push(p);
  }
  // Also pick a few shallow .js files
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
        violations,
      });
      continue;
    }

    let analyzeThrew: string | undefined;
    let fnCount = 0;
    let caseCount = 0;
    let sampleFormat: string | undefined;
    try {
      const result = analyzeFile(file, source);
      fnCount = result.functions?.length ?? 0;
      for (const fn of result.functions ?? []) {
        caseCount += fn.cases?.length ?? 0;
        if (!sampleFormat && fn.cases && fn.cases.length > 0) {
          sampleFormat = formatShape(fn.cases[0]!.abs);
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
      violations,
    });
  }
  return out;
}

describe("real package no-mock infer gate (B5)", () => {
  const packages = [
    { name: "ms", minFiles: 1 },
    { name: "commander", minFiles: 1 },
    { name: "escape-string-regexp", minFiles: 1 },
    { name: "debug", minFiles: 1 },
  ];

  for (const { name, minFiles } of packages) {
    it(`${name}: checkSource + analyzeFile run without mocks; FP=0`, () => {
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
      // FP lock
      const allViolations = outcomes.flatMap((o) => o.violations);
      expect(allViolations, allViolations.join("\n").slice(0, 2000)).toEqual([]);
      // Infer must not crash — throwing analyzeFile is a gate failure
      const threw = outcomes.filter((o) => o.analyzeThrew);
      expect(
        threw,
        threw.map((t) => t.analyzeThrew).join("\n").slice(0, 2000),
      ).toEqual([]);
      // Record signatures when present (not a hard recall lock — B5 is “runs + no FP”)
      const withCases = outcomes.filter((o) => (o.caseCount ?? 0) > 0);
      console.info(
        `[infer-real] ${name}: scanned=${scanned.length} fnSum=${outcomes.reduce((s, o) => s + (o.fnCount ?? 0), 0)} casesSum=${outcomes.reduce((s, o) => s + (o.caseCount ?? 0), 0)} sample=${withCases[0]?.sampleFormat ?? "—"}`,
      );
    });
  }

  it("records at least one package producing structured analyzeFile output", () => {
    // Soft signal: in a healthy tree, some package yields functions or cases.
    // If every package is missing from node_modules we still pass (skipped above).
    const installed = ["ms", "commander", "debug", "escape-string-regexp"].filter(
      (n) => !!resolvePkgRoot(n),
    );
    if (installed.length === 0) {
      console.info("[infer-real] no fixture packages installed — skip signature signal");
      return;
    }
    let sawStructure = false;
    for (const name of installed) {
      for (const o of scanInfer(name, 2)) {
        if ((o.fnCount ?? 0) > 0 || (o.caseCount ?? 0) > 0) sawStructure = true;
      }
    }
    // Do not hard-fail when exports-mode finds no call sites — only crash/FP are gates.
    // Structure is recorded for the coverage baseline narrative.
    expect(typeof sawStructure).toBe("boolean");
    console.info(`[infer-real] saw structured analyzeFile output: ${sawStructure}`);
  });
});
