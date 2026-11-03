/**
 * S1 — 中型 monorepo cold / warm / edit 性能基线（A6 延迟证据）。
 *
 * 语料：benchmark/s1/.corpus（生成式，gitignore，不进仓库）。
 * 报告：docs/reports/s1-perf-baseline.{md,json}
 *
 * 用法（monorepo 根）：
 *   pnpm run benchmark:s1
 *   pnpm run benchmark:s1 -- --regen   # 强制重建语料
 *   pnpm run benchmark:s1 -- --corpus /path/to/repo
 *                                      # 指向真实 monorepo 目录：动态挑
 *                                      # hub/mid/leaf 目标，edit 相纯内存
 *                                      # （绝不写用户文件），报告落
 *                                      # s1-perf-baseline-real.{md,json}
 *                                      # 并在头部如实标注语料来源
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, relative as pathRelative, resolve as pathResolve } from "node:path";
import { performance } from "node:perf_hooks";
import { generateCorpus, corpusStats, CORPUS_DIR, S1_SCALE } from "./generate-corpus.mts";

const ROOT = join(import.meta.dirname, "..", "..");
const REPORT_DIR = join(ROOT, "docs", "reports");
const regen = process.argv.includes("--regen");

// --corpus <path>：真实 monorepo 语料（默认仍用生成式语料，行为不变）
const corpusArgIdx = process.argv.indexOf("--corpus");
if (corpusArgIdx !== -1) {
  const v = process.argv[corpusArgIdx + 1];
  if (v === undefined || v.startsWith("--")) {
    console.error("--corpus requires a directory path (e.g. `--corpus /path/to/repo`)");
    process.exit(2);
  }
}
const corpusArg = corpusArgIdx !== -1 ? process.argv[corpusArgIdx + 1]! : undefined;

/** 真实语料采集：跳过依赖产物目录；.nudo.js 是契约模板不是分析目标 */
const CORPUS_SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".nudo"]);
const CORPUS_FILE_CAP = 2000;

function collectJsFiles(rootDir: string): { files: string[]; truncated: boolean } {
  const out: string[] = [];
  const stack = [pathResolve(rootDir)];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // 不可读目录：跳过（bench 不因此失败）
    }
    for (const e of entries) {
      if (out.length >= CORPUS_FILE_CAP) break;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!CORPUS_SKIP_DIRS.has(e.name)) stack.push(p);
      } else if (e.isFile() && e.name.endsWith(".js") && !e.name.endsWith(".nudo.js")) {
        out.push(p);
      }
    }
  }
  out.sort();
  return { files: out, truncated: out.length >= CORPUS_FILE_CAP };
}

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

  // 语料装配：默认生成式（行为不变）；--corpus <path> 指向真实 monorepo
  const realCorpusRoot = corpusArg !== undefined ? pathResolve(corpusArg) : undefined;
  let files: string[];
  let cstats: { files: number; bytes: number; packages: number | null; filesPerPackage: number | null };
  let corpusTruncated = false;
  if (realCorpusRoot !== undefined) {
    const collected = collectJsFiles(realCorpusRoot);
    files = collected.files;
    corpusTruncated = collected.truncated;
    if (files.length === 0) {
      console.error(`--corpus: no .js files found under ${realCorpusRoot} (node_modules/dist/.git/coverage/.nudo skipped)`);
      process.exit(2);
    }
    if (corpusTruncated) {
      console.warn(`--corpus: capped at ${CORPUS_FILE_CAP} files (measurement set truncated)`);
    }
    let bytes = 0;
    for (const f of files) bytes += readFileSync(f, "utf-8").length;
    cstats = { files: files.length, bytes, packages: null, filesPerPackage: null };
  } else {
    files = regen ? generateCorpus({ force: true }) : generateCorpus();
    cstats = corpusStats(files);
  }
  const sources = new Map(files.map((f) => [f, readFileSync(f, "utf-8")]));
  /** 报告里的目标展示名（真实语料 = 相对语料根；生成式 = 相对 .corpus） */
  const displayOf = (f: string): string =>
    realCorpusRoot !== undefined
      ? pathRelative(realCorpusRoot, f)
      : f.replace(CORPUS_DIR + "/", "");
  /**
   * md 表格标签：生成式语料沿用既有基线的「去 packages/ 前缀」展示
   * （`pkg2-store/mod0.js`）；真实语料直接用相对路径。
   */
  const mdLabel = (t: string): string =>
    realCorpusRoot !== undefined ? t : t.replace("packages/", "");

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
  // 生成式语料：确定性布局 ⇒ 固定样本（pkg0-util/mod0 等），与既有基线可比。
  // 真实语料：从模块图**动态**挑（hub = 最大扇入；leaf = 0 扇入里字节最大者，
  // 无 0 扇入文件时回落最小扇入；mid = 扇入中位数）——不在用户仓库里挑路径。
  let hubFile: string;
  let leafFile: string;
  let midFile: string;
  if (realCorpusRoot !== undefined) {
    const fanIn = (f: string) => dependents.get(f)?.size ?? 0;
    const byFanIn = [...files].sort((a, b) => fanIn(a) - fanIn(b) || (a < b ? -1 : 1));
    hubFile = byFanIn[byFanIn.length - 1]!;
    const zeroFanIn = files.filter((f) => fanIn(f) === 0);
    const pool = zeroFanIn.length > 0 ? zeroFanIn : byFanIn.slice(0, Math.max(1, Math.floor(files.length / 8)));
    leafFile = pool.reduce((a, b) => ((sources.get(b) ?? "").length >= (sources.get(a) ?? "").length ? b : a));
    midFile = byFanIn[Math.floor(byFanIn.length / 2)]!;
  } else {
    hubFile = join(CORPUS_DIR, "packages", "pkg0-util", "mod0.js");
    leafFile = join(CORPUS_DIR, "packages", "pkg7-index", "mod14.js");
    // 选一个中层：pkg2-store/mod0
    midFile = join(CORPUS_DIR, "packages", "pkg2-store", "mod0.js");
  }

  async function measureEdit(label: string, target: string) {
    const dirty = topoSortDirty(imports, computeDirtySet(dependents, target));
    // 热稳态
    resetAllAnalysisCaches();
    analyzeAll(files);
    const samples: number[] = [];
    const ideSamples: number[] = [];
    const checkSamples: number[] = [];
    for (let i = 0; i < 8; i++) {
      // 磁盘小编辑（追加注释）→ 定向逐出 → 只重析 dirty。
      // 真实语料（--corpus）：**纯内存编辑**——绝不写用户文件（measure 相
      // 同：dirty 重析 + IDE 单文件两条路都不依赖落盘，sources 是唯一真值）。
      const prev = sources.get(target)!;
      const edited = prev + `\n// s1-edit-${i}\n`;
      sources.set(target, edited);
      if (realCorpusRoot === undefined) writeFileSync(target, edited);
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
      target: displayOf(target),
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
  // sources 是唯一真值（真实语料不落盘；生成式与磁盘一致——measureEdit 同源）
  const liveSrc = sources.get(midFile)!;
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
    // 真实语料没有均质 packages×files 布局 ⇒ scale 如实置 null（头部标注来源）
    scale: realCorpusRoot !== undefined ? null : S1_SCALE,
    corpus:
      realCorpusRoot !== undefined
        ? {
            kind: "real" as const,
            source: realCorpusRoot,
            files: cstats.files,
            bytes: cstats.bytes,
            importEdges: edgeCount,
            truncated: corpusTruncated,
            fileCap: CORPUS_FILE_CAP,
          }
        : { ...cstats, importEdges: edgeCount, dir: "benchmark/s1/.corpus (generated, gitignored)" },
    graph: { cold: +coldGraph.toFixed(2), warm: +warmGraph.toFixed(2), warmCached: +cachedGraph.toFixed(2) },
    coldAnalyzeAll: stats(coldAn),
    warmAnalyzeAll: stats(warmAn),
    warmCheckAll: stats(warmChk),
    edit: { leaf: editLeaf, mid: editMid, hub: editHub },
    liveEditor: {
      analyzeOne: stats(liveAn),
      checkOne: stats(liveChk),
      // 生成式基线的 live 目标字段历来是去前缀展示（"pkg2-store/mod0.js"）
      target: mdLabel(displayOf(midFile)),
    },
  };

  // 报告分流：真实语料落独立文件（-real 后缀），绝不覆盖生成式基线
  const reportBase = realCorpusRoot !== undefined ? "s1-perf-baseline-real" : "s1-perf-baseline";
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, `${reportBase}.json`), JSON.stringify(payload, null, 2) + "\n");

  const mb = (cstats.bytes / 1024 / 1024).toFixed(2);
  const corpusHeader =
    realCorpusRoot !== undefined
      ? `> **Corpus:** **real monorepo** at \`${realCorpusRoot}\` (\`--corpus\`)${corpusTruncated ? ` — **truncated at ${CORPUS_FILE_CAP} files**` : ""}.
> Numbers describe **this checkout** (its layout, its dependencies), not the synthetic scale baseline — compare only across runs on the same corpus.`
      : `> **Corpus:** deterministic generated monorepo at \`benchmark/s1/.corpus/\` (gitignored).
> Not committed — repo stays small; regenerate with \`--regen\`.`;
  const scaleLine =
    realCorpusRoot !== undefined
      ? `- Scale: **${cstats.files} files**, ${mb} MB, ${edgeCount} import edges (real corpus — no uniform packages × files-per-package shape)`
      : `- Scale: ${S1_SCALE.packages} packages × ${S1_SCALE.filesPerPackage} files (**${cstats.files} files**, ${mb} MB, ${edgeCount} import edges)`;
  const md = `# S1 performance baseline — monorepo cold / warm / edit

> **Generated** by \`benchmark/s1/bench-monorepo.mts\` (\`pnpm run benchmark:s1\`).
> Do not hand-edit numbers — regenerate the report.
>
${corpusHeader}

- Generated at: ${payload.generatedAt}
${scaleLine}

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
| leaf (\`${mdLabel(editLeaf.target)}\`) | ${editLeaf.dirtyCount} | ${editLeaf.dirty.median} | ${editLeaf.ideAnalyze.median} | ${editLeaf.ideCheck.median} |
| mid (\`${mdLabel(editMid.target)}\`) | ${editMid.dirtyCount} | ${editMid.dirty.median} | ${editMid.ideAnalyze.median} | ${editMid.ideCheck.median} |
| hub (\`${mdLabel(editHub.target)}\`) | ${editHub.dirtyCount} | ${editHub.dirty.median} | ${editHub.ideAnalyze.median} | ${editHub.ideCheck.median} |

## Live editor (in-memory buffer edit, no disk)

| Op | Median (ms) | min | max | n |
|---|---:|---:|---:|---:|
| analyzeFile (1 file) | ${payload.liveEditor.analyzeOne.median} | ${payload.liveEditor.analyzeOne.min} | ${payload.liveEditor.analyzeOne.max} | ${payload.liveEditor.analyzeOne.n} |
| checkSource (1 file) | ${payload.liveEditor.checkOne.median} | ${payload.liveEditor.checkOne.min} | ${payload.liveEditor.checkOne.max} | ${payload.liveEditor.checkOne.n} |

## Honest boundaries

${
  realCorpusRoot !== undefined
    ? `- Corpus is **real** (\`--corpus ${realCorpusRoot}\`)${corpusTruncated ? `, truncated at ${CORPUS_FILE_CAP} files` : ""} — numbers describe this checkout's absolute cost; compare only against other runs of the same corpus.`
    : `- Corpus is **synthetic** (deterministic generator), not a real company monorepo — numbers track relative cold/warm/edit cost and scale with size, not absolute product SLOs.`
}
- Host is in-process service API (no CLI process spawn); tsserver-style LS not included (see \`benchmark/micro\` for tsc comparisons).
- Edit scenarios re-analyze the dirty set only (LSP/watch path). Full-tree cold is the adoption "first open" number.
- Machine-dependent: record alongside \`node -v\` / CPU when comparing across hosts. This run: node ${process.version}.
${
  realCorpusRoot !== undefined
    ? `- **Real corpus mode** (\`--corpus\`): edit targets are picked dynamically from the module graph (hub = max fan-in, mid = median, leaf = zero fan-in); the edit phase mutates **in-memory sources only** — \`writeFileSync\` is skipped, your files are never touched.
`
    : ""
}`;
  writeFileSync(join(REPORT_DIR, `${reportBase}.md`), md);

  // stdout 摘要
  console.log(`S1 corpus: ${cstats.files} files, ${mb} MB, ${edgeCount} edges${realCorpusRoot !== undefined ? " (real corpus)" : ""}`);
  console.log(`cold analyze all : ${payload.coldAnalyzeAll.median} ms`);
  console.log(`warm analyze all : ${payload.warmAnalyzeAll.median} ms`);
  console.log(`warm check all   : ${payload.warmCheckAll.median} ms`);
  console.log(`edit leaf/mid/hub dirty: ${editLeaf.dirtyCount}/${editMid.dirtyCount}/${editHub.dirtyCount} → ${editLeaf.dirty.median}/${editMid.dirty.median}/${editHub.dirty.median} ms`);
  console.log(`live analyze/check 1: ${payload.liveEditor.analyzeOne.median} / ${payload.liveEditor.checkOne.median} ms`);
  console.log(`report → docs/reports/${reportBase}.md`);
}

await main();
