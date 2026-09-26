/**
 * S1 — 中型 monorepo cold / warm / edit 性能基线（A6 延迟证据）。
 *
 * 语料：benchmark/s1/.corpus（生成式，gitignore，不进仓库）。
 * 报告：docs/reports/s1-perf-baseline.{md,json}
 *
 * 用法（monorepo 根）：
 *   pnpm run benchmark:s1
 *   pnpm run benchmark:s1 -- --regen   # 强制重建语料
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { generateCorpus, corpusStats, CORPUS_DIR, S1_SCALE } from "./generate-corpus.mts";

const ROOT = join(import.meta.dirname, "..", "..");
const REPORT_DIR = join(ROOT, "docs", "reports");
const regen = process.argv.includes("--regen");

function med(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return +(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2).toFixed(2);
}

function stats(xs: number[]) {
  return { n: xs.length, median: med(xs), min: +Math.min(...xs).toFixed(2), max: +Math.max(...xs).toFixed(2) };
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
    buildModuleGraph: (files: string[], cache?: Map<string, unknown>) => {
      imports: Map<string, Set<string>>;
      dependents: Map<string, Set<string>>;
    };
    computeDirtySet: (dependents: Map<string, Set<string>>, changed: string) => string[];
    topoSortDirty: (imports: Map<string, Set<string>>, dirty: string[]) => string[];
    resetAllAnalysisCaches: () => void;
    evictAnalysisCachesForFiles: (files: string[]) => void;
    defaultLoadModule: (spec: string, from: string) => string | undefined;
  };
  const { checkSource, pTrue, resetCheckSourceMemo } = core as {
    checkSource: (p: string, src: string, phi: unknown, opts?: Record<string, unknown>) => unknown;
    pTrue: unknown;
    resetCheckSourceMemo: () => void;
  };

  const files = regen ? generateCorpus({ force: true }) : generateCorpus();
  const cstats = corpusStats(files);
  const sources = new Map(files.map((f) => [f, readFileSync(f, "utf-8")]));

  const analyzeAll = (paths: string[]) => {
    for (const f of paths) {
      analyzeFile(f, sources.get(f)!, undefined, undefined, defaultLoadModule);
    }
  };
  const checkAll = (paths: string[]) => {
    for (const f of paths) {
      checkSource(f, sources.get(f)!, pTrue, { loadModule: defaultLoadModule, fromFile: f });
    }
  };

  // --- 模块图 ---
  const g0 = performance.now();
  const graph1 = buildModuleGraph(files);
  const coldGraph = performance.now() - g0;
  const g1 = performance.now();
  buildModuleGraph(files);
  const warmGraph = performance.now() - g1;
  const edgeCache = new Map();
  buildModuleGraph(files, edgeCache);
  const g2 = performance.now();
  buildModuleGraph(files, edgeCache);
  const cachedGraph = performance.now() - g2;

  const { dependents, imports } = graph1;
  let edgeCount = 0;
  for (const set of imports.values()) edgeCount += set.size;

  // --- cold analyze（全量，空缓存）---
  const coldAn: number[] = [];
  for (let i = 0; i < 3; i++) {
    resetAllAnalysisCaches();
    const t = performance.now();
    analyzeAll(files);
    coldAn.push(performance.now() - t);
  }

  // --- warm analyze（同进程、缓存热）---
  resetAllAnalysisCaches();
  analyzeAll(files);
  const warmAn: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    analyzeAll(files);
    warmAn.push(performance.now() - t);
  }

  // --- warm check（gate 路径）---
  resetCheckSourceMemo();
  checkAll(files);
  const warmChk: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    checkAll(files);
    warmChk.push(performance.now() - t);
  }

  // --- edit：leaf（无 dependents）vs hub（高扇入）---
  const hubFile = join(CORPUS_DIR, "packages", "pkg0-util", "mod0.js");
  const leafFile = join(CORPUS_DIR, "packages", "pkg7-index", "mod14.js");
  // 选一个中层：pkg2-store/mod0
  const midFile = join(CORPUS_DIR, "packages", "pkg2-store", "mod0.js");

  async function measureEdit(label: string, target: string) {
    const dirty = topoSortDirty(imports, computeDirtySet(dependents, target));
    // 热稳态
    resetAllAnalysisCaches();
    analyzeAll(files);
    const samples: number[] = [];
    const ideSamples: number[] = [];
    const checkSamples: number[] = [];
    for (let i = 0; i < 8; i++) {
      // 磁盘小编辑（追加注释）→ 定向逐出 → 只重析 dirty
      const prev = sources.get(target)!;
      const edited = prev + `\n// s1-edit-${i}\n`;
      sources.set(target, edited);
      writeFileSync(target, edited);
      const dirtyLive = topoSortDirty(imports, computeDirtySet(dependents, target));
      evictAnalysisCachesForFiles(dirtyLive);
      let t = performance.now();
      analyzeAll(dirtyLive);
      samples.push(performance.now() - t);

      // IDE 型：单文件 analyze（buffer 已改）
      t = performance.now();
      analyzeFile(target, edited, undefined, undefined, defaultLoadModule);
      ideSamples.push(performance.now() - t);

      // IDE 型：单文件 check
      resetCheckSourceMemo();
      t = performance.now();
      checkSource(target, edited, pTrue, { loadModule: defaultLoadModule, fromFile: target });
      checkSamples.push(performance.now() - t);
    }
    // 恢复原文，避免污染后续
    // （sources 里已是带注释版；重新生成即干净——此处直接保留，后续 measure 用各自 target）
    return {
      label,
      target: target.replace(CORPUS_DIR + "/", ""),
      dirtyCount: dirty.length,
      dirty: stats(samples),
      ideAnalyze: stats(ideSamples),
      ideCheck: stats(checkSamples),
    };
  }

  const editLeaf = await measureEdit("leaf", leafFile);
  const editMid = await measureEdit("mid", midFile);
  const editHub = await measureEdit("hub", hubFile);

  // --- live editor：纯内存编辑（不写盘），单文件 ---
  resetAllAnalysisCaches();
  analyzeAll(files);
  const liveSrc = readFileSync(midFile, "utf-8");
  const liveAn: number[] = [];
  const liveChk: number[] = [];
  for (let i = 0; i < 10; i++) {
    const edited = liveSrc + `\n// live-${i}\n`;
    let t = performance.now();
    analyzeFile(midFile, edited, undefined, undefined, defaultLoadModule);
    liveAn.push(performance.now() - t);
    resetCheckSourceMemo();
    t = performance.now();
    checkSource(midFile, edited, pTrue, { loadModule: defaultLoadModule, fromFile: midFile });
    liveChk.push(performance.now() - t);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    scale: S1_SCALE,
    corpus: { ...cstats, importEdges: edgeCount, dir: "benchmark/s1/.corpus (generated, gitignored)" },
    graph: { cold: +coldGraph.toFixed(2), warm: +warmGraph.toFixed(2), warmCached: +cachedGraph.toFixed(2) },
    coldAnalyzeAll: stats(coldAn),
    warmAnalyzeAll: stats(warmAn),
    warmCheckAll: stats(warmChk),
    edit: { leaf: editLeaf, mid: editMid, hub: editHub },
    liveEditor: { analyzeOne: stats(liveAn), checkOne: stats(liveChk), target: "pkg2-store/mod0.js" },
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, "s1-perf-baseline.json"), JSON.stringify(payload, null, 2) + "\n");

  const mb = (cstats.bytes / 1024 / 1024).toFixed(2);
  const md = `# S1 performance baseline — monorepo cold / warm / edit

> **Generated** by \`benchmark/s1/bench-monorepo.mts\` (\`pnpm run benchmark:s1\`).
> Do not hand-edit numbers — regenerate the report.
>
> **Corpus:** deterministic generated monorepo at \`benchmark/s1/.corpus/\` (gitignored).
> Not committed — repo stays small; regenerate with \`--regen\`.

- Generated at: ${payload.generatedAt}
- Scale: ${S1_SCALE.packages} packages × ${S1_SCALE.filesPerPackage} files (**${cstats.files} files**, ${mb} MB, ${edgeCount} import edges)

## Summary

| Phase | Median (ms) | Notes |
|---|---:|---|
| module graph cold | ${payload.graph.cold} | \`buildModuleGraph\` no cache |
| module graph warm | ${payload.graph.warm} | re-parse edges |
| module graph cached | ${payload.graph.warmCached} | mtime edge-cache hit |
| **analyze all — cold** | **${payload.coldAnalyzeAll.median}** | empty session caches |
| analyze all — warm | ${payload.warmAnalyzeAll.median} | file cache hits |
| check all — warm | ${payload.warmCheckAll.median} | \`checkSource\` gate path |

## Edit (dirty-set re-analyze)

| Scenario | Dirty files | dirty median | IDE analyze 1 | IDE check 1 |
|---|---:|---:|---:|---:|
| leaf (\`pkg7-index/mod14.js\`) | ${editLeaf.dirtyCount} | ${editLeaf.dirty.median} | ${editLeaf.ideAnalyze.median} | ${editLeaf.ideCheck.median} |
| mid (\`pkg2-store/mod0.js\`) | ${editMid.dirtyCount} | ${editMid.dirty.median} | ${editMid.ideAnalyze.median} | ${editMid.ideCheck.median} |
| hub (\`pkg0-util/mod0.js\`) | ${editHub.dirtyCount} | ${editHub.dirty.median} | ${editHub.ideAnalyze.median} | ${editHub.ideCheck.median} |

## Live editor (in-memory buffer edit, no disk)

| Op | Median (ms) | min | max | n |
|---|---:|---:|---:|---:|
| analyzeFile (1 file) | ${payload.liveEditor.analyzeOne.median} | ${payload.liveEditor.analyzeOne.min} | ${payload.liveEditor.analyzeOne.max} | ${payload.liveEditor.analyzeOne.n} |
| checkSource (1 file) | ${payload.liveEditor.checkOne.median} | ${payload.liveEditor.checkOne.min} | ${payload.liveEditor.checkOne.max} | ${payload.liveEditor.checkOne.n} |

## Honest boundaries

- Corpus is **synthetic** (deterministic generator), not a real company monorepo — numbers track relative cold/warm/edit cost and scale with size, not absolute product SLOs.
- Host is in-process service API (no CLI process spawn); tsserver-style LS not included (see \`benchmark/micro\` for tsc comparisons).
- Edit scenarios re-analyze the dirty set only (LSP/watch path). Full-tree cold is the adoption "first open" number.
- Machine-dependent: record alongside \`node -v\` / CPU when comparing across hosts. This run: node ${process.version}.
`;
  writeFileSync(join(REPORT_DIR, "s1-perf-baseline.md"), md);

  // stdout 摘要
  console.log(`S1 corpus: ${cstats.files} files, ${mb} MB, ${edgeCount} edges`);
  console.log(`cold analyze all : ${payload.coldAnalyzeAll.median} ms`);
  console.log(`warm analyze all : ${payload.warmAnalyzeAll.median} ms`);
  console.log(`warm check all   : ${payload.warmCheckAll.median} ms`);
  console.log(`edit leaf/mid/hub dirty: ${editLeaf.dirtyCount}/${editMid.dirtyCount}/${editHub.dirtyCount} → ${editLeaf.dirty.median}/${editMid.dirty.median}/${editHub.dirty.median} ms`);
  console.log(`live analyze/check 1: ${payload.liveEditor.analyzeOne.median} / ${payload.liveEditor.checkOne.median} ms`);
  console.log(`report → docs/reports/s1-perf-baseline.md`);
}

await main();
