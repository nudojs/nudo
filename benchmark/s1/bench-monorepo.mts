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
 *
 * ABS-16（真实 monorepo 基准）：`pnpm run benchmark:s1:real` = `--corpus .`
 * 额外产出主机信息（node/CPU/内存/峰值 RSS）与**摘要缓存命中率遥测**。
 * 遥测只跑真实语料分支；合成语料模式的报告逐字节不变。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative as pathRelative, resolve as pathResolve } from "node:path";
import { performance } from "node:perf_hooks";
import { arch, cpus, platform, totalmem } from "node:os";
import { generateCorpus, corpusStats, CORPUS_DIR, S1_SCALE } from "./generate-corpus.mts";

const ROOT = join(import.meta.dirname, "..", "..");
const REPORT_DIR = join(ROOT, "docs", "reports");
const regen = process.argv.includes("--regen");
/**
 * `--quick`：慢宿主上的低采样档（ABS-16 真实仓首测用）。
 * 默认档的采样次数**逐字不变**；quick 只减少重复次数，统计里的 n 如实写出。
 * 原因：同一 harness 在 Node v22 宿主上单次全量 analyze 可达数十秒
 * （v24 基线是 1.2s），默认 3/5/3/8/10 次采样会跑 20 分钟以上。
 */
const quick = process.argv.includes("--quick");
const N_COLD = quick ? 1 : 3;
const N_WARM = quick ? 3 : 5;
const N_CHECK = quick ? 2 : 3;
const N_EDIT = quick ? 3 : 8;
const N_LIVE = quick ? 5 : 10;

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
/**
 * ABS-16：跳过明显的打包产物（本仓 `packages/vscode/server/server.js` 是
 * 11.9 MB bundle）。它们是构建输出而非源码，全量分析会拖垮测量且不代表
 * monorepo 的源码规模。跳过数如实写进报告，不静默丢弃。
 */
const CORPUS_FILE_MAX_BYTES = 256 * 1024;

function collectJsFiles(rootDir: string): {
  files: string[];
  truncated: boolean;
  skippedLarge: number;
} {
  const out: string[] = [];
  let skippedLarge = 0;
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
        let size: number;
        try {
          size = statSync(p).size;
        } catch {
          continue; // 不可 stat 的文件：跳过（bench 不因此失败）
        }
        if (size > CORPUS_FILE_MAX_BYTES) {
          skippedLarge++;
          continue;
        }
        out.push(p);
      }
    }
  }
  out.sort();
  return { files: out, truncated: out.length >= CORPUS_FILE_CAP, skippedLarge };
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
  /** 报告里只写相对仓库根的路径：避免把本机绝对路径提交进仓库。 */
  const corpusDisplay =
    realCorpusRoot !== undefined
      ? pathRelative(ROOT, realCorpusRoot) || "."
      : undefined;
  let files: string[];
  let cstats: { files: number; bytes: number; packages: number | null; filesPerPackage: number | null };
  let corpusTruncated = false;
  let corpusSkippedLarge = 0;
  if (realCorpusRoot !== undefined) {
    const collected = collectJsFiles(realCorpusRoot);
    files = collected.files;
    corpusTruncated = collected.truncated;
    corpusSkippedLarge = collected.skippedLarge;
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

  // --- ABS-16 缓存遥测（仅真实语料模式；合成模式连模块都不加载） ---
  // 摘要缓存是**进程级** Map，`resetAllAnalysisCaches()` 不清它 ⇒ 用计数
  // delta 采集、绝不中途 reset 缓存（否则会污染 warm 语义）。测量前清一次，
  // 让 cold#1 成为「摘要层也空」的真冷，cold#2/3 自然展示跨 cold 复用。
  type Telemetry = {
    inst: { hits: number; misses: number; stores: number };
    fn: { hits: number; misses: number; stores: number };
  };
  const summaryMod =
    realCorpusRoot !== undefined
      ? ((await import(join(ROOT, "packages/core/src/algebra/key/fn-summary.ts"))) as {
          fnSummaryStats: () => { hits: number; misses: number; stores: number; size: number };
          fnSummaryFnLevelStats: () => { hits: number; misses: number; stores: number };
          resetFnSummaryCache: () => void;
        })
      : undefined;
  let rssPeak = 0;
  const touchRss = () => {
    rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
  };
  const snap = (): Telemetry | undefined => {
    if (summaryMod === undefined) return undefined;
    const i = summaryMod.fnSummaryStats();
    const f = summaryMod.fnSummaryFnLevelStats();
    return {
      inst: { hits: i.hits, misses: i.misses, stores: i.stores },
      fn: { hits: f.hits, misses: f.misses, stores: f.stores },
    };
  };
  const delta = (from: Telemetry, to: Telemetry): Telemetry => ({
    inst: {
      hits: to.inst.hits - from.inst.hits,
      misses: to.inst.misses - from.inst.misses,
      stores: to.inst.stores - from.inst.stores,
    },
    fn: {
      hits: to.fn.hits - from.fn.hits,
      misses: to.fn.misses - from.fn.misses,
      stores: to.fn.stores - from.fn.stores,
    },
  });
  /** 计时 + 该窗口的摘要缓存计数增量（合成模式只计时）。 */
  const measure = (fn: () => void): { ms: number; tel?: Telemetry } => {
    const before = snap();
    const t = performance.now();
    fn();
    const ms = performance.now() - t;
    touchRss();
    const after = snap();
    return before !== undefined && after !== undefined
      ? { ms, tel: delta(before, after) }
      : { ms };
  };
  summaryMod?.resetFnSummaryCache();

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
  const coldTel: Telemetry[] = [];
  for (let i = 0; i < N_COLD; i++) {
    resetAllAnalysisCaches();
    const m = measure(() => analyzeAll(files));
    coldAn.push(m.ms);
    if (m.tel !== undefined) coldTel.push(m.tel);
  }

  // --- warm analyze（同进程、缓存热）---
  resetAllAnalysisCaches();
  analyzeAll(files);
  const warmAn: number[] = [];
  const warmTel: Telemetry[] = [];
  for (let i = 0; i < N_WARM; i++) {
    const m = measure(() => analyzeAll(files));
    warmAn.push(m.ms);
    if (m.tel !== undefined) warmTel.push(m.tel);
  }

  // --- warm check（gate 路径）---
  resetCheckSourceMemo();
  checkAll(files);
  const warmChk: number[] = [];
  const checkTel: Telemetry[] = [];
  for (let i = 0; i < N_CHECK; i++) {
    const m = measure(() => checkAll(files));
    warmChk.push(m.ms);
    if (m.tel !== undefined) checkTel.push(m.tel);
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
    for (let i = 0; i < N_EDIT; i++) {
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
  for (let i = 0; i < N_LIVE; i++) {
    const edited = liveSrc + `\n// live-${i}\n`;
    let t = performance.now();
    analyzeFile(midFile, edited, undefined, undefined, defaultLoadModule);
    liveAn.push(performance.now() - t);
    resetCheckSourceMemo();
    t = performance.now();
    checkSource(midFile, edited, pTrue, { loadModule: defaultLoadModule, fromFile: midFile });
    liveChk.push(performance.now() - t);
  }

  const cpuModel = cpus()[0]?.model ?? "unknown";
  const coreCount = cpus().length;
  const host =
    summaryMod !== undefined
      ? {
          node: process.version,
          platform: platform(),
          arch: arch(),
          cpu: cpuModel,
          cores: coreCount,
          totalMemGiB: +(totalmem() / 1024 ** 3).toFixed(1),
          peakRssMiB: +(rssPeak / 1024 ** 2).toFixed(1),
        }
      : undefined;

  const payload = {
    generatedAt: new Date().toISOString(),
    // 真实语料没有均质 packages×files 布局 ⇒ scale 如实置 null（头部标注来源）
    scale: realCorpusRoot !== undefined ? null : S1_SCALE,
    corpus:
      realCorpusRoot !== undefined
        ? {
            kind: "real" as const,
            source: corpusDisplay,
            files: cstats.files,
            bytes: cstats.bytes,
            importEdges: edgeCount,
            truncated: corpusTruncated,
            fileCap: CORPUS_FILE_CAP,
            skippedLarge: corpusSkippedLarge,
            fileMaxBytes: CORPUS_FILE_MAX_BYTES,
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
    // ABS-16：仅真实语料模式追加；合成基线的 payload 逐字节不变
    ...(host !== undefined
      ? {
          host,
          cacheTelemetry: {
            note:
              `fn-summary counters are process-global; deltas are taken per phase without resetting the cache mid-run. One resetFnSummaryCache() before the run makes cold#1 truly cold. ${N_COLD > 1 ? "Later cold rounds keep the summary layer hot and show cross-cold reuse." : "Only one cold round was sampled (--quick), so cross-cold reuse is not measured here."}`,
            cold: coldTel,
            warm: warmTel,
            check: checkTel,
          },
        }
      : {}),
  };

  // 报告分流：真实语料落独立文件（-real 后缀），绝不覆盖生成式基线
  const reportBase = realCorpusRoot !== undefined ? "s1-perf-baseline-real" : "s1-perf-baseline";
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, `${reportBase}.json`), JSON.stringify(payload, null, 2) + "\n");

  const mb = (cstats.bytes / 1024 / 1024).toFixed(2);
  const corpusHeader =
    realCorpusRoot !== undefined
      ? `> **Corpus:** **real monorepo** at \`${corpusDisplay}\` (path relative to repo root; \`--corpus\`)${corpusTruncated ? ` — **truncated at ${CORPUS_FILE_CAP} files**` : ""}.
> Numbers describe **this checkout** (its layout, its dependencies), not the synthetic scale baseline — compare only across runs on the same corpus.`
      : `> **Corpus:** deterministic generated monorepo at \`benchmark/s1/.corpus/\` (gitignored).
> Not committed — repo stays small; regenerate with \`--regen\`.`;
  const scaleLine =
    realCorpusRoot !== undefined
      ? `- Scale: **${cstats.files} files**, ${mb} MB, ${edgeCount} import edges (real corpus — no uniform packages × files-per-package shape)`
      : `- Scale: ${S1_SCALE.packages} packages × ${S1_SCALE.filesPerPackage} files (**${cstats.files} files**, ${mb} MB, ${edgeCount} import edges)`;
  // --- ABS-16 报告增量（全部只在真实语料模式下有内容） ---
  const title =
    realCorpusRoot !== undefined
      ? "ABS-16 real-monorepo baseline"
      : "S1 performance baseline";
  const hostLine =
    host !== undefined
      ? `\n- Host: node ${host.node} · ${host.platform} ${host.arch} · ${host.cpu} (${host.cores} cores) · ${host.totalMemGiB} GiB RAM · peak RSS ${host.peakRssMiB} MiB`
      : "";
  const skippedLine =
    corpusSkippedLarge > 0
      ? `\n- Skipped **${corpusSkippedLarge}** file(s) > ${CORPUS_FILE_MAX_BYTES / 1024} KiB — bundled build output, not source. The skip count is reported, not silently dropped.`
      : "";
  const samplingLine = quick
    ? `\n- **Sampling: \`--quick\`** — cold ${N_COLD} / warm ${N_WARM} / check ${N_CHECK} / edit ${N_EDIT} / live ${N_LIVE} repetitions (fewer than the default S1 profile). Medians use the reported \`n\`; interpret accordingly.`
    : "";
  const rate = (h: number, m: number): string =>
    h + m === 0 ? "n/a" : `${((h / (h + m)) * 100).toFixed(1)}%`;
  const telRow = (label: string, t: Telemetry, i: number): string =>
    `| ${label} #${i + 1} | ${t.inst.hits} / ${t.inst.misses} | ${rate(t.inst.hits, t.inst.misses)} | ${t.fn.hits} / ${t.fn.misses} | ${rate(t.fn.hits, t.fn.misses)} | ${t.inst.stores} / ${t.fn.stores} |`;
  const telemetryRows = [
    ...coldTel.map((t, i) => telRow("cold", t, i)),
    ...warmTel.map((t, i) => telRow("warm", t, i)),
    ...checkTel.map((t, i) => telRow("check", t, i)),
  ].join("\n");
  const telemetryMd =
    host === undefined
      ? ""
      : `## Cache hit telemetry (ABS-16)

Deltas of the two process-global \`fn-summary\` counters per measurement window.
One \`resetFnSummaryCache()\` before the run makes **cold #1 truly cold**${N_COLD > 1
        ? "; later cold rounds keep the summary layer hot and show cross-cold reuse."
        : " (only one cold round sampled with \`--quick\` — cross-cold reuse is not measured here)." }

| Phase | instance hits / misses | instance hit rate | fn-level hits / misses | fn hit rate | stores (inst / fn) |
|---|---:|---:|---:|---:|---:|---|
${telemetryRows}

- **instance-level** = ABS-10 per-shape post cache; **fn-level** = ABS-14 bounded summary fast path.
- \`n/a\` means **no summary lookup happened** in that window (not a miss): warm/check mostly hit the service file cache before reaching core.
- Edit / live phases are **not** instrumented — their windows mix targeted evictions with single-file re-analysis, so a hit rate there would be misleading.
- The service file / AST / evaluator caches have no counter API; their effect is visible only through the cold → warm wall-clock ratio.

`;
  const realBoundaryExtra =
    realCorpusRoot !== undefined
      ? `- **Cache telemetry** covers the two process-global \`fn-summary\` layers only; it is not a whole-engine cache hit rate.\n`
      : "";

  const md = `# ${title} — monorepo cold / warm / edit

> **Generated** by \`benchmark/s1/bench-monorepo.mts\` (\`pnpm run benchmark:s1\`).
> Do not hand-edit numbers — regenerate the report.
>
${corpusHeader}

- Generated at: ${payload.generatedAt}
${scaleLine}${hostLine}${skippedLine}${samplingLine}

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

${telemetryMd}## Honest boundaries

${
  realCorpusRoot !== undefined
    ? `- Corpus is **real** (\`--corpus ${corpusDisplay}\`)${corpusTruncated ? `, truncated at ${CORPUS_FILE_CAP} files` : ""} — numbers describe this checkout's absolute cost; compare only against other runs of the same corpus.`
    : `- Corpus is **synthetic** (deterministic generator), not a real company monorepo — numbers track relative cold/warm/edit cost and scale with size, not absolute product SLOs.`
}
- Host is in-process service API (no CLI process spawn); tsserver-style LS not included (see \`benchmark/micro\` for tsc comparisons).
- Edit scenarios re-analyze the dirty set only (LSP/watch path). Full-tree cold is the adoption "first open" number.
- Machine-dependent: record alongside \`node -v\` / CPU when comparing across hosts. This run: node ${process.version}.
${realBoundaryExtra}${
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
  if (host !== undefined) {
    const agg = (xs: Telemetry[], kind: "inst" | "fn") => ({
      hits: xs.reduce((n, t) => n + t[kind].hits, 0),
      misses: xs.reduce((n, t) => n + t[kind].misses, 0),
      stores: xs.reduce((n, t) => n + t[kind].stores, 0),
    });
    const c = agg(coldTel, "inst");
    const cf = agg(coldTel, "fn");
    const w = agg(warmTel, "inst");
    console.log(
      `host: ${host.node} · ${host.cpu} (${host.cores} cores) · ${host.totalMemGiB} GiB · peak RSS ${host.peakRssMiB} MiB`,
    );
    console.log(
      `cache telemetry: cold inst ${c.hits}/${c.misses} (${rate(c.hits, c.misses)}), cold fn ${cf.hits}/${cf.misses} (${rate(cf.hits, cf.misses)}), warm inst ${w.hits}/${w.misses} (${rate(w.hits, w.misses)})`,
    );
  }
}

await main();
