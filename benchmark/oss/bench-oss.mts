/**
 * S1-upgrade — real OSS package perf + precision baseline.
 *
 * Packages: commander / yargs / semver (real node_modules, not synthetic corpus).
 * Metrics: cold analyze · warm analyze · warm check · hub-edit dirty set · L1 FP count.
 * Report: docs/reports/oss-perf-baseline.{md,json}
 * Gate:   node benchmark/oss/gate.mjs  (regression only — never fails on "faster")
 *
 * Usage (monorepo root):
 *   node --import tsx benchmark/oss/bench-oss.mts
 *   pnpm run benchmark:oss
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync as readFs } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import ts from "typescript";
import { loadOssPackages, type OssPackage, type OssFile } from "./packages.mts";

const ROOT = join(import.meta.dirname, "..", "..");
const REPORT_DIR = join(ROOT, "docs", "reports");
const BASELINE_PATH = join(import.meta.dirname, "baseline.json");

/** L1 error codes that must stay zero-FP on real packages (same as check-real-packages). */
const ERROR_CODES = [
  "nudo:constraint-violated",
  "nudo:assign-mismatch",
  "nudo:arg-structure",
  "nudo:case-inconsistency",
  "nudo:interface-load",
  "nudo:interface-cycle",
  "nudo:interface-conflict",
  "nudo:interface-domain-exceeds",
  "nudo:interface-name-clash",
] as const;

/**
 * tsc **工具链载入**参考（不进 gate、不进产品对比）。
 *
 * 语料是**无注解纯 JS**——tsc 只能走 `allowJs+checkJs` 弱模式，
 * 与 Nudo 的 Abs/Pred 产品面不是同一问题。此处只记「同一批字节的
 * createProgram+诊断墙钟」，**不得**写成 Nudo vs TS 产品胜负。
 * 产品级 TS 对照见 `benchmark/agent-dx`（同 bug 的 detect/silentGreen）；
 * 合成延迟对照见 `benchmark/micro/bench-vs-tsc.mts`。
 */
function measureTscLoadOnly(files: OssFile[]): {
  createProgramMs: number;
  diagnosticsMs: number;
  totalMs: number;
  diagnostics: number;
  note: string;
} {
  const rootNames = files.map((f) => f.path);
  const options: ts.CompilerOptions = {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    types: [],
  };
  const host = ts.createCompilerHost(options, true);
  const t0 = performance.now();
  const program = ts.createProgram(rootNames, options, host);
  const tCreate = performance.now() - t0;
  const t1 = performance.now();
  const diags = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
  ];
  const tDiag = performance.now() - t1;
  return {
    createProgramMs: +tCreate.toFixed(2),
    diagnosticsMs: +tDiag.toFixed(2),
    totalMs: +(tCreate + tDiag).toFixed(2),
    diagnostics: diags.length,
    note: "UNANNOTATED JS — tsc is in weak checkJs mode. Tooling-load reference only, NOT a Nudo-vs-TS product comparison.",
  };
}

function med(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return +(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2).toFixed(2);
}

function stats(xs: number[]) {
  return {
    n: xs.length,
    median: med(xs),
    min: +Math.min(...xs).toFixed(2),
    max: +Math.max(...xs).toFixed(2),
  };
}

type DepGraph = {
  imports: Map<string, Set<string>>;
  dependents: Map<string, Set<string>>;
};

/** Pick hub (max dependents) and leaf (min dependents, preferably 0) by import graph. */
function pickHubLeaf(graph: DepGraph, files: OssFile[]): { hub: OssFile; leaf: OssFile; hubDependents: number; leafDependents: number } {
  const byPath = new Map(files.map((f) => [f.path, f]));
  let hub: OssFile | undefined;
  let leaf: OssFile | undefined;
  let hubN = -1;
  let leafN = Number.POSITIVE_INFINITY;
  for (const f of files) {
    const n = graph.dependents.get(f.path)?.size ?? 0;
    if (n > hubN) {
      hubN = n;
      hub = f;
    }
    if (n < leafN) {
      leafN = n;
      leaf = f;
    }
  }
  if (!hub || !leaf) throw new Error("empty file set");
  // leaf must differ from hub
  if (leaf.path === hub.path) {
    const alt = files.find((f) => f.path !== hub!.path && (graph.dependents.get(f.path)?.size ?? 0) <= 1);
    if (alt) leaf = alt;
  }
  return { hub, leaf, hubDependents: hubN, leafDependents: graph.dependents.get(leaf.path)?.size ?? 0 };
}

async function main() {
  const svc = await import(join(ROOT, "packages/service/src/index.ts"));
  const core = await import(join(ROOT, "packages/core/src/index.ts"));
  const {
    analyzeFile,
    buildModuleGraph,
    computeDirtySet,
    topoSortDirty,
    resetAllAnalysisCaches,
    evictAnalysisCachesForFiles,
    defaultLoadModule,
  } = svc as {
    analyzeFile: (p: string, src: string, ...rest: unknown[]) => unknown;
    buildModuleGraph: (files: string[]) => DepGraph;
    computeDirtySet: (dependents: Map<string, Set<string>>, changed: string) => string[];
    topoSortDirty: (imports: Map<string, Set<string>>, dirty: string[]) => string[];
    resetAllAnalysisCaches: () => void;
    evictAnalysisCachesForFiles: (files: string[]) => void;
    defaultLoadModule: (spec: string, from: string) => string | undefined;
  };
  const { checkSource, pTrue, resetCheckSourceMemo } = core as {
    checkSource: (p: string, src: string, phi: unknown, opts?: Record<string, unknown>) => {
      issues: Array<{ severity: string; code: string; message: string; line?: number }>;
    };
    pTrue: unknown;
    resetCheckSourceMemo: () => void;
  };

  const packages = loadOssPackages();
  const nodeV = process.version;

  const packageResults: Array<Record<string, unknown>> = [];
  const allFiles: OssFile[] = [];
  const sources = new Map<string, string>();

  for (const pkg of packages) {
    for (const f of pkg.files) {
      allFiles.push(f);
      sources.set(f.path, f.source);
    }

    // --- precision: L1 zero-FP on this package ---
    const violations: string[] = [];
    const scanErrors: string[] = [];
    let scanned = 0;
    let checkMs = 0;
    for (const f of pkg.files) {
      let r;
      const t0 = performance.now();
      try {
        r = checkSource(f.label, f.source, pTrue, {
          entryThrows: "off",
          loadModule: defaultLoadModule,
          fromFile: f.path,
        });
      } catch (e) {
        scanErrors.push(`${f.label}: ${(e as Error).message}`);
        continue;
      }
      checkMs += performance.now() - t0;
      scanned++;
      for (const i of r.issues) {
        if (i.severity === "error" && (ERROR_CODES as readonly string[]).includes(i.code)) {
          violations.push(`${f.label} [${i.code}] ${i.message}`);
        }
      }
    }

    // --- per-package cold / warm analyze ---
    resetAllAnalysisCaches();
    let t = performance.now();
    for (const f of pkg.files) analyzeFile(f.path, f.source, undefined, undefined, defaultLoadModule);
    const cold = performance.now() - t;

    const warmSamples: number[] = [];
    for (let i = 0; i < 5; i++) {
      t = performance.now();
      for (const f of pkg.files) analyzeFile(f.path, f.source, undefined, undefined, defaultLoadModule);
      warmSamples.push(performance.now() - t);
    }

    const graph = buildModuleGraph(pkg.files.map((f) => f.path));
    let edgeCount = 0;
    for (const set of graph.imports.values()) edgeCount += set.size;
    const { hub, leaf, hubDependents, leafDependents } = pickHubLeaf(graph, pkg.files);

    // hub-edit: touch hub → dirty set re-analyze
    const warm = stats(warmSamples);
    const hubDirty = topoSortDirty(graph.imports, computeDirtySet(graph.dependents, hub.path));
    const leafDirty = topoSortDirty(graph.imports, computeDirtySet(graph.dependents, leaf.path));

    const hubEditSamples: number[] = [];
    const hubIde: number[] = [];
    resetAllAnalysisCaches();
    for (const f of pkg.files) analyzeFile(f.path, f.source, undefined, undefined, defaultLoadModule);
    for (let i = 0; i < 5; i++) {
      const edited = hub.source + `\n// oss-edit-${i}\n`;
      sources.set(hub.path, edited);
      evictAnalysisCachesForFiles(hubDirty);
      t = performance.now();
      for (const p of hubDirty) {
        const src = sources.get(p) ?? "";
        analyzeFile(p, src, undefined, undefined, defaultLoadModule);
      }
      hubEditSamples.push(performance.now() - t);
      t = performance.now();
      analyzeFile(hub.path, edited, undefined, undefined, defaultLoadModule);
      hubIde.push(performance.now() - t);
    }

    const tsc = measureTscLoadOnly(pkg.files);

    packageResults.push({
      name: pkg.name,
      files: pkg.files.length,
      bytes: pkg.bytes,
      importEdges: edgeCount,
      scanned,
      scanErrors,
      falsePositives: violations,
      fpCount: violations.length,
      coldAnalyzeMs: +cold.toFixed(2),
      warmAnalyzeMs: warm,
      checkAllMs: +checkMs.toFixed(2),
      tsc,
      hub: {
        file: hub.label,
        dependents: hubDependents,
        dirtyCount: hubDirty.length,
        dirtyMedianMs: stats(hubEditSamples).median,
        ideAnalyzeMedianMs: stats(hubIde).median,
      },
      leaf: {
        file: leaf.label,
        dependents: leafDependents,
        dirtyCount: leafDirty.length,
      },
    });
  }

  const totals = {
    packages: packages.length,
    files: allFiles.length,
    bytes: allFiles.reduce((s, f) => s + f.bytes, 0),
    fpCount: packageResults.reduce((s, p) => s + (p as { fpCount: number }).fpCount, 0),
    scanned: packageResults.reduce((s, p) => s + (p as { scanned: number }).scanned, 0),
    coldAnalyzeMs: +packageResults.reduce((s, p) => s + (p as { coldAnalyzeMs: number }).coldAnalyzeMs, 0).toFixed(2),
    checkAllMs: +packageResults.reduce((s, p) => s + (p as { checkAllMs: number }).checkAllMs, 0).toFixed(2),
    tscTotalMs: +packageResults.reduce((s, p) => s + (p as { tsc: { totalMs: number } }).tsc.totalMs, 0).toFixed(2),
  };

  const payload = {
    generatedAt: new Date().toISOString(),
    node: nodeV,
    kind: "oss-real-packages",
    totals,
    packages: packageResults,
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, "oss-perf-baseline.json"), JSON.stringify(payload, null, 2) + "\n");

  const rows = packageResults
    .map((p) => {
      const pr = p as {
        name: string;
        files: number;
        scanned: number;
        fpCount: number;
        coldAnalyzeMs: number;
        checkAllMs: number;
        hub: { file: string; dirtyCount: number; dirtyMedianMs: number; dependents: number };
      };
      return `| \`${pr.name}\` | ${pr.files} | ${pr.scanned} | **${pr.fpCount}** | ${pr.coldAnalyzeMs} | ${pr.checkAllMs} | ${pr.hub.dirtyCount} (${pr.hub.dependents} deps) | ${pr.hub.dirtyMedianMs} |`;
    })
    .join("\n");

  const tscRows = packageResults
    .map((p) => {
      const pr = p as {
        name: string;
        tsc: { totalMs: number; diagnostics: number };
      };
      return `| \`${pr.name}\` | ${pr.tsc.totalMs} | ${pr.tsc.diagnostics} |`;
    })
    .join("\n");

  const md = `# OSS package performance & precision baseline (real JS packages)

> **Generated** by \`benchmark/oss/bench-oss.mts\` (\`pnpm run benchmark:oss\`).
> Do not hand-edit numbers — regenerate.
>
> **Corpus:** real \`node_modules\` **JavaScript** packages (**${packages.map((p) => p.name).join(" / ")}**).
> This baseline is **Nudo’s product face** (JS-first analysis + L1 zero-FP). Regression gate: \`pnpm run benchmark:oss:gate\`.

- Generated at: ${payload.generatedAt}
- Node: ${nodeV}
- Scale: ${totals.packages} packages · **${totals.files} JS files** · ${(totals.bytes / 1024).toFixed(0)} KB source

## Summary (Nudo product metrics — gated)

| Package | Files | Scanned | **L1 FP** | Cold analyze (ms) | Check all (ms) | Hub dirty | Hub edit (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|
${rows}

| Total | Files | Scanned | **L1 FP** | Cold analyze | Check all |
|---|---:|---:|---:|---:|---:|
| | ${totals.files} | ${totals.scanned} | **${totals.fpCount}** | ${totals.coldAnalyzeMs} | ${totals.checkAllMs} |

## Why this is **not** a “Nudo vs TypeScript” table

Corpus is **unannotated pure JS**. tsc can only enter weak \`allowJs+checkJs\` mode here —
it is not running on its product surface (typed sources, project references, assignability).

**Do not read the tooling-load numbers below as a product comparison.**

| Where a real TS comparison lives | What it measures |
|----------------------------------|------------------|
| \`benchmark/agent-dx\` | Same bugs, Nudo gate vs \`tsc --noEmit\`: detectRate / silentGreen / rounds |
| \`benchmark/micro/bench-vs-tsc.mts\` | Synthetic workload latency (analyzeFile vs createProgram / LS) |
| \`benchmark/lsp-rounds\` | OSS bug-repair / PRD race with TS pair harness |

### Tooling-load appendix (not gated, not product)

Same bytes through tsc \`createProgram\` + diagnostics (\`allowJs+checkJs\`, no LanguageService reuse):

| Package | tsc total (ms) | tsc diagnostic count |
|---|---:|---:|
${tscRows}

Total tsc load: **${totals.tscTotalMs} ms** (ts ${ts.version}) — host/tooling sensitive.

## What is pinned (gate)

| Metric | Meaning |
|--------|---------|
| **L1 FP** | Error-level false positives on real code (\`entryThrows: off\`) — must stay **0** |
| Cold analyze | Empty session caches, analyze every file once |
| Check all | \`checkSource\` gate path over the same files |
| Hub dirty set | Import-graph hub edit → dirty-set re-analyze (LSP/watch path) |
| Hub edit | Median wall-clock of dirty-set re-analyze after touching hub |

## Honest boundaries

- Packages are **real OSS** from this workspace's dependency tree — numbers track scale of those packages, not a company monorepo.
- L2 entry may-throw is **off** here (same layering as \`check-real-packages\`); L2 is covered by gold L2 cases + CLI \`--ignore-throws\`.
- Host is in-process service API (no CLI spawn). Machine-dependent — compare alongside \`node -v\`.
- Gate thresholds live in \`benchmark/oss/baseline.json\` (written from a trusted run). Only regressions fail.
`;

  writeFileSync(join(REPORT_DIR, "oss-perf-baseline.md"), md);

  // Seed baseline if missing (first run writes a generous envelope)
  try {
    const { readFileSync } = await import("node:fs");
    readFileSync(BASELINE_PATH, "utf8");
  } catch {
    const baseline = {
      note: "Regression envelope — gate fails only when worse than these. Regenerate with a trusted run.",
      generatedAt: payload.generatedAt,
      node: nodeV,
      totals: {
        maxFpCount: 0,
        // 3x headroom for host noise; gate uses max(baseline, current*1) policy on first tight fit
        maxColdAnalyzeMs: +(totals.coldAnalyzeMs * 3).toFixed(1),
        maxCheckAllMs: +(totals.checkAllMs * 3).toFixed(1),
      },
      packages: packageResults.map((p) => {
        const pr = p as {
          name: string;
          files: number;
          fpCount: number;
          coldAnalyzeMs: number;
          checkAllMs: number;
          hub: { dirtyMedianMs: number; dirtyCount: number };
        };
        return {
          name: pr.name,
          minFiles: Math.max(1, Math.floor(pr.files * 0.8)),
          maxFpCount: 0,
          maxColdAnalyzeMs: +(pr.coldAnalyzeMs * 3).toFixed(1),
          maxCheckAllMs: +(pr.checkAllMs * 3).toFixed(1),
          maxHubDirtyMedianMs: +(pr.hub.dirtyMedianMs * 3).toFixed(1),
        };
      }),
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`baseline seeded → ${BASELINE_PATH}`);
  }

  console.log(`OSS packages: ${packages.map((p) => `${p.name}(${p.files.length})`).join(", ")}`);
  console.log(`L1 FP total   : ${totals.fpCount}`);
  console.log(`cold analyze  : ${totals.coldAnalyzeMs} ms`);
  console.log(`check all     : ${totals.checkAllMs} ms`);
  console.log(`tsc load (ref): ${totals.tscTotalMs} ms  — unannotated JS, NOT product vs TS`);
  for (const p of packageResults) {
    const pr = p as {
      name: string;
      tsc: { totalMs: number };
      hub: { file: string; dirtyCount: number; dirtyMedianMs: number };
    };
    console.log(`  ${pr.name} tsc-load=${pr.tsc.totalMs}ms  hub-edit dirty=${pr.hub.dirtyCount} → ${pr.hub.dirtyMedianMs} ms`);
  }
  console.log(`report → docs/reports/oss-perf-baseline.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
