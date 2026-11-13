/**
 * ABS-16 / ABS-17 诊断：把全量 cold analyze 的墙钟按文件 / 依赖加载拆开。
 *
 * 与 benchmark/s1/bench-monorepo.mts 的语料采集、analyzeFile 调用口径一致，
 * 差别是循环里插入逐文件 performance.now()。**只读**，不写仓库任何文件；
 * 原始行数据写到 os.tmpdir()/nudo-cold-profile.json。
 *
 *   pnpm exec tsx benchmark/s1/profile-cold.mts --corpus . [--rounds 2] [--top 30]
 *   pnpm exec tsx benchmark/s1/profile-cold.mts --corpus . --clean-corpus
 *   pnpm exec tsx benchmark/s1/profile-cold.mts --corpus . --instrument-loader
 *   pnpm exec tsx benchmark/s1/profile-cold.mts --corpus . --only packages/vscode/out/extension.js
 *
 * check memo 容量回归对照（MAX_CHECK_MEMO 2026-11-12 由 256 → 1024）：
 *   pnpm exec tsx benchmark/s1/profile-cold.mts --corpus . --clean-corpus \
 *     --mode check --rounds 2 --limit 200 | --limit 260 | --limit 286
 *   修复前：200 → warm 433.70ms；260 / 286 → 40.4s / 41.0s（LRU 抖动，命中率归零）
 *   修复后：286 → warm 436.67ms
 *
 * CPU 栈（ABS-17 复现）：包一层 --cpu-prof，或用 NODE_OPTIONS=--cpu-prof 启动：
 *   node --import tsx --cpu-prof --cpu-prof-dir=/tmp/prof \
 *     --cpu-prof-name=ext.cpuprofile benchmark/s1/profile-cold.mts \
 *     --corpus . --only packages/vscode/out/extension.js --rounds 1
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative as pathRelative, resolve as pathResolve } from "node:path";
import { performance } from "node:perf_hooks";

const ROOT = join(import.meta.dirname, "..", "..");
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};
const has = (name: string): boolean => process.argv.includes(name);
const corpusRoot = pathResolve(arg("--corpus") ?? ".");
const ROUNDS = Number(arg("--rounds") ?? "1");
const TOP = Number(arg("--top") ?? "30");
const instrumentLoader = has("--instrument-loader");
/** analyze（默认，逐文件 analyzeFile）| check（逐文件 checkSource，测整文件 memo） */
const mode = arg("--mode") ?? "analyze";
if (mode !== "analyze" && mode !== "check") {
  console.error("--mode must be `analyze` or `check`");
  process.exit(2);
}
/** 只取排序后的前 N 个文件（check memo 容量阈值对照） */
const limitArg = arg("--limit");
const limit = limitArg === undefined ? undefined : Number(limitArg);
if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
  console.error("--limit requires a positive integer");
  process.exit(2);
}
/** 只测相对路径含该子串的文件（配合 NODE_OPTIONS=--cpu-prof 定位单文件栈） */
const only = arg("--only");
/** 与 bench 的 `--clean-corpus` 同口径：额外跳 out / tmp / .docusaurus */
const cleanCorpus = has("--clean-corpus");
/** 每轮前 resetAllAnalysisCaches()（复刻 bench 的 N_COLD 轮口径；摘要缓存仍不清） */
const resetEachRound = has("--reset-each-round");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".nudo",
  // ABS-17 诊断夹具目录（gitignored）；作为 corpusRoot 本身时不受影响
  ".bundles",
  ...(cleanCorpus ? ["out", "tmp", ".docusaurus"] : []),
]);
const FILE_CAP = 2000;
const MAX_BYTES = 256 * 1024;

function collectJsFiles(rootDir: string): string[] {
  const out: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (out.length >= FILE_CAP) break;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(p);
      } else if (e.isFile() && e.name.endsWith(".js") && !e.name.endsWith(".nudo.js")) {
        try {
          if (statSync(p).size <= MAX_BYTES) out.push(p);
        } catch {
          /* skip */
        }
      }
    }
  }
  return out.sort();
}

function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.floor(s.length * p))]!.toFixed(2);
}

const svc = (await import(join(ROOT, "packages/service/src/index.ts"))) as {
  analyzeFile: (p: string, src: string, ...rest: unknown[]) => unknown;
  resetAllAnalysisCaches: () => void;
  defaultLoadModule: (spec: string, from: string) => string | undefined;
};
const { analyzeFile, resetAllAnalysisCaches, defaultLoadModule } = svc;

/**
 * check 模式单独载入 core 的门禁入口。注意：`checkMemoKey` 用调用方**原始**
 * `opts.loadModule` 做 identity ⇒ 这里必须传 `defaultLoadModule` 本体，
 * 不能用 --instrument-loader 的 wrapper（每次新建会让 memo 键永远不命中）。
 */
const core =
  mode === "check"
    ? ((await import(join(ROOT, "packages/core/src/index.ts"))) as {
        checkSource: (p: string, src: string, phi: unknown, opts?: Record<string, unknown>) => unknown;
        pTrue: unknown;
        resetCheckSourceMemo: () => void;
      })
    : undefined;
core?.resetCheckSourceMemo();

let files = collectJsFiles(corpusRoot);
if (only !== undefined) files = files.filter((f) => pathRelative(corpusRoot, f).includes(only));
if (limit !== undefined) files = files.slice(0, limit);
const sources = new Map(files.map((f) => [f, readFileSync(f, "utf-8")]));
console.error(`[profile] corpus=${pathRelative(ROOT, corpusRoot) || "."} files=${files.length} rounds=${ROUNDS} mode=${mode} limit=${limit ?? "-"} instrumentLoader=${instrumentLoader && mode === "analyze"} cleanCorpus=${cleanCorpus} only=${only ?? "-"}`);
if (files.length === 0) {
  console.error("[profile] no files matched");
  process.exit(2);
}

type Row = { f: string; ms: number; loadCalls: number; loadMs: number };
const rounds: { total: number; rows: Row[] }[] = [];

for (let r = 0; r < ROUNDS; r++) {
  // check 模式**不**在轮间清 memo：这里测的正是「warm 整文件报告是否命中」。
  // analyze 模式沿用 bench 的每轮 reset 口径。
  if (mode === "analyze" && (r === 0 || resetEachRound)) resetAllAnalysisCaches();
  if (mode === "check" && resetEachRound) core?.resetCheckSourceMemo();
  const rows: Row[] = [];
  let total = 0;
  let loadCalls = 0;
  let loadMs = 0;
  const lm =
    mode === "check" || !instrumentLoader
      ? defaultLoadModule
      : (spec: string, from: string) => {
          const t = performance.now();
          try {
            return defaultLoadModule(spec, from);
          } finally {
            loadCalls++;
            loadMs += performance.now() - t;
          }
        };
  for (const f of files) {
    const c0 = loadCalls;
    const m0 = loadMs;
    const t = performance.now();
    if (core !== undefined) {
      core.checkSource(f, sources.get(f)!, core.pTrue, {
        loadModule: defaultLoadModule,
        fromFile: f,
      });
    } else {
      analyzeFile(f, sources.get(f)!, undefined, undefined, lm);
    }
    const ms = performance.now() - t;
    total += ms;
    rows.push({ f, ms: +ms.toFixed(2), loadCalls: loadCalls - c0, loadMs: +(loadMs - m0).toFixed(2) });
  }
  rounds.push({ total: +total.toFixed(2), rows });
  console.error(`[profile] round ${r + 1} done: ${total.toFixed(2)} ms, loadModule ${loadCalls} calls / ${loadMs.toFixed(2)} ms, rss ${(process.memoryUsage().rss / 1048576).toFixed(0)} MiB`);
}

const main = rounds[0]!;
const byMs = [...main.rows].sort((a, b) => b.ms - a.ms);
const cum = (n: number) => +byMs.slice(0, n).reduce((s, r) => s + r.ms, 0).toFixed(2);
const xs = main.rows.map((r) => r.ms);
console.log(`\n=== round 1 (${mode} cold) total ${main.total} ms / ${files.length} files ===`);
console.log(`per-file ms: p50=${pct(xs, 0.5)} p90=${pct(xs, 0.9)} p95=${pct(xs, 0.95)} p99=${pct(xs, 0.99)} max=${pct(xs, 1)}`);
console.log(`top 1/5/10/20/50 files: ${[1, 5, 10, 20, 50].map((n) => `${n}=${cum(n)}ms (${((cum(n) / main.total) * 100).toFixed(1)}%)`).join("  ")}`);
console.log(`\n--- top ${TOP} slowest files ---`);
for (const r of byMs.slice(0, TOP)) {
  console.log(`${r.ms.toFixed(2).padStart(11)} ms  load=${r.loadMs.toFixed(2).padStart(10)}ms/${String(r.loadCalls).padStart(5)}  ${pathRelative(corpusRoot, r.f)}`);
}

// 按顶层目录聚合，判断是不是某一类语料（生成物 / OSS 副本 / 合成 fixture）在主导
const byDir = new Map<string, { ms: number; n: number }>();
for (const r of main.rows) {
  const rel = pathRelative(corpusRoot, r.f);
  const key = rel.split("/").slice(0, 3).join("/");
  const e = byDir.get(key) ?? { ms: 0, n: 0 };
  e.ms += r.ms;
  e.n++;
  byDir.set(key, e);
}
console.log(`\n--- by directory (top 20) ---`);
for (const [k, v] of [...byDir.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 20)) {
  console.log(`${v.ms.toFixed(2).padStart(11)} ms  ${String(v.n).padStart(4)} files  ${((v.ms / main.total) * 100).toFixed(1).padStart(5)}%  ${k}`);
}

if (rounds.length > 1) {
  console.log(`\n--- round 2 (warm) total ${rounds[1]!.total} ms; slowest 10 ---`);
  for (const r of [...rounds[1]!.rows].sort((a, b) => b.ms - a.ms).slice(0, 10)) {
    console.log(`${r.ms.toFixed(2).padStart(11)} ms  ${pathRelative(corpusRoot, r.f)}`);
  }
}

const rawPath = join(tmpdir(), "nudo-cold-profile.json");
writeFileSync(rawPath, JSON.stringify({ corpusRoot, rounds }, null, 2));
console.error(`[profile] raw rows -> ${rawPath}`);
