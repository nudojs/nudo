#!/usr/bin/env node
/**
 * DX 度量（常驻口径）：watch 编辑回路的反馈延迟。
 *
 * 与 `scripts/dx-metrics.mjs` 互补 —— 后者测「每次新起一个 CLI 进程」的
 * time-to-green（进程启动主导），本脚本测**常驻 watch 会话里保存到结果刷新**
 * 的延迟（进程不重启，只重算脏集）。
 *
 * 拆两段，因为它们的可优化性完全不同：
 *   debounceMs = 写入 → `incremental` banner      （200ms 去抖 + fs 事件调度）
 *   analyzeMs  = `incremental` → `Watching again` （真实增量重算）
 *
 * 改动方式是**追加一行注释**（语义不变、错误面不变），只驱动「文件变了」，
 * 避免把「错误数变化导致的输出差异」误读成延迟差异。语料在结束时**还原**。
 *
 * Usage:
 *   node scripts/edit-loop-metrics.mjs [--corpus <dir>] [--target <file>]
 *        [--rounds 3] [--mode dist|tsx] [--json] [--keep]
 *
 * 退出码：0 = 全部轮次拿到结果；1 = 有轮次超时或首轮未起来（不假绿）。
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
function argValue(name) {
  const i = argv.indexOf(name);
  if (i !== -1) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : undefined;
}

const mode = argValue("--mode") ?? "dist";
if (!["dist", "tsx"].includes(mode)) {
  console.error(`unknown --mode "${mode}" (expected dist|tsx)`);
  process.exit(2);
}
const rounds = Number(argValue("--rounds") ?? "3");
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) {
  console.error("--rounds requires an integer in [1, 20]");
  process.exit(2);
}
const corpus = argValue("--corpus") ?? join(root, "benchmark", "lsp-rounds", "starters-oss-semver", "nudo");
const keep = has("--keep");
const jsonMode = has("--json");
/**
 * `--profile`：给 watch 进程设 `NUDO_WATCH_PROFILE=1`，把增量轮的分相计时
 * （getFiles / dirtyCalc / evict / 逐文件 analyze / graph）与逐文件耗时
 * 收集起来。默认不开启 ⇒ 子进程输出与计时行为完全不变。
 */
const profile = has("--profile") || process.env.NUDO_WATCH_PROFILE === "1";

if (!existsSync(corpus) || !statSync(corpus).isDirectory()) {
  console.error(`corpus not found: ${corpus}`);
  process.exit(2);
}

/** 语料里的 .js（跳过 node_modules 与 .nudo.js 契约模板） */
function collectJs(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) collectJs(p, out);
    else if (e.name.endsWith(".js") && !e.name.endsWith(".nudo.js")) out.push(p);
  }
  return out;
}

/** 目标文件：显式指定优先；否则挑一个 lib/ 下的文件（更适合当编辑对象），再退回第一个 */
function pickTarget() {
  const explicit = argValue("--target");
  if (explicit !== undefined) {
    const p = explicit.startsWith("/") ? explicit : join(root, explicit);
    if (!existsSync(p)) {
      console.error(`--target not found: ${explicit}`);
      process.exit(2);
    }
    return p;
  }
  const files = collectJs(corpus).sort();
  if (files.length === 0) {
    console.error(`no .js under corpus: ${corpus}`);
    process.exit(2);
  }
  return files.find((f) => /[/\\]lib[/\\]/.test(f)) ?? files[0];
}

const target = pickTarget();
const original = readFileSync(target, "utf-8");

const entry =
  mode === "dist"
    ? [join(root, "packages", "nudojs", "dist", "index.js")]
    : ["--import", "tsx", join(root, "packages", "nudojs", "src", "index.ts")];

/** `--cpu-prof-dir <dir>`：给被测量的 watch 进程开 CPU 采样（排障用，不参与计时） */
const profDir = argValue("--cpu-prof-dir");
const nodeFlags = profDir !== undefined ? [`--cpu-prof`, `--cpu-prof-dir=${profDir}`] : [];

if (mode === "dist" && !existsSync(entry[0])) {
  console.error(`dist entry missing: ${entry[0]} — run \`pnpm run build\` first`);
  process.exit(2);
}

const t0 = performance.now();
const el = () => performance.now() - t0;
const child = spawn(process.execPath, [...nodeFlags, ...entry, "check", "--watch", corpus], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
  env: profile ? { ...process.env, NUDO_WATCH_PROFILE: "1" } : process.env,
});

let firstReady = false;
let waitingFirst = null;
let waitingIncremental = null;
let waitingDone = null;
let bufErr = "";

/** `[watch-profile]` 行（仅在 `--profile` 时被打印；始终收集以便 JSON 面一致） */
const profileLines = [];

/** 每轮：writeAt → incrementalAt → doneAt */
const samples = [];
let current = null;
let roundIdx = 0;

const FIRST_TIMEOUT = 120_000;
const ROUND_TIMEOUT = 30_000;

let finished = false;

function finish(code) {
  if (finished) return;
  finished = true;
  try {
    // SIGINT 而非 SIGTERM：让 Node 有机会把 --cpu-prof 的 profile 落盘
    child.kill("SIGINT");
  } catch {
    /* already gone */
  }
  if (!keep) writeFileSync(target, original, "utf-8");
  report();
  const wait = profDir !== undefined ? 1500 : 0;
  setTimeout(() => process.exit(code), wait);
}

/**
 * 父进程被杀（Ctrl-C / CI 取消 / SIGHUP）也必须还原语料：
 * `finish` 只在正常收尾/超时路径被调用，探针注释若残留会污染语料与
 * 后续基准（脚本约定「语料在结束时还原」）。
 */
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => finish(1));
}
process.on("exit", () => {
  if (!finished && !keep) writeFileSync(target, original, "utf-8");
});

function report() {
  const ok = samples.filter((s) => s.doneAt !== null);
  if (jsonMode) {
    const val = ok.map((s) => s.doneAt - s.writeAt);
    console.log(
      JSON.stringify(
        {
          mode,
          corpus: relative(root, corpus) || ".",
          target: relative(root, target),
          files: collectJs(corpus).length,
          rounds,
          samples,
          ...(profile ? { profile: profileLines } : {}),
          summary:
            ok.length === 0
              ? null
              : {
                  completed: ok.length,
                  avgMs: Math.round(val.reduce((a, b) => a + b, 0) / val.length),
                  minMs: Math.round(Math.min(...val)),
                  maxMs: Math.round(Math.max(...val)),
                  avgDebounceMs: Math.round(
                    ok.reduce((a, s) => a + (s.incrementalAt - s.writeAt), 0) / ok.length,
                  ),
                  avgAnalyzeMs: Math.round(
                    ok.reduce((a, s) => a + (s.doneAt - s.incrementalAt), 0) / ok.length,
                  ),
                },
        },
        null,
        2,
      ),
    );
    return;
  }
  if (ok.length === 0) {
    console.log("\nno completed round — nothing measured");
    return;
  }
  const val = ok.map((s) => s.doneAt - s.writeAt);
  const avg = (arr) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  console.log(
    `\n  ${mode} · ${relative(root, corpus) || "."} · ${collectJs(corpus).length} files · target ${relative(root, target)}`,
  );
  console.log(`  ${"round".padEnd(6)} ${"debounce".padStart(9)} ${"analyze".padStart(9)} ${"total".padStart(8)}`);
  for (const s of ok) {
    console.log(
      `  ${String(s.round).padEnd(6)} ${String(Math.round(s.incrementalAt - s.writeAt)).padStart(9)} ${String(
        Math.round(s.doneAt - s.incrementalAt),
      ).padStart(9)} ${String(Math.round(s.doneAt - s.writeAt)).padStart(8)}`,
    );
  }
  console.log(
    `  ${"avg".padEnd(6)} ${String(avg(ok.map((s) => s.incrementalAt - s.writeAt))).padStart(9)} ${String(
      avg(ok.map((s) => s.doneAt - s.incrementalAt)),
    ).padStart(9)} ${String(avg(val)).padStart(8)}    (ms, ${ok.length}/${rounds} rounds)`,
  );
  if (profile && profileLines.length > 0) {
    console.log("\n  watch / check profile（子进程 stderr：每轮分相 + 逐文件段耗时）:");
    for (const l of profileLines) console.log(`    ${l}`);
  }
}

// stdout 只丢弃但必须消费：不读管道会让子进程写满缓冲后阻塞，把延迟测成死锁
child.stdout.resume();
child.stderr.on("data", (d) => {
  bufErr += d.toString();
  const lines = bufErr.split("\n");
  bufErr = lines.pop() ?? "";
  for (const line of lines) handleErrLine(line);
});

function handleErrLine(line) {
  if (line.startsWith("[watch-profile] ") || line.startsWith("[check-profile] ")) {
    profileLines.push(line);
    return;
  }
  if (line.includes("Watching for changes...")) {
    if (!firstReady) {
      firstReady = true;
      clearTimeout(waitingFirst);
      nextRound();
      return;
    }
    if (current !== null && waitingDone !== null) {
      clearTimeout(waitingDone);
      waitingDone = null;
      current.doneAt = el();
      samples.push(current);
      current = null;
      nextRound();
    }
    return;
  }
  if (line.includes("(incremental)")) {
    if (current !== null && waitingIncremental !== null) {
      clearTimeout(waitingIncremental);
      waitingIncremental = null;
      current.incrementalAt = el();
      waitingDone = setTimeout(() => finish(1), ROUND_TIMEOUT);
    }
  }
}

/**
 * 安全间隔：`Watching for changes...` 打印后，该轮还有 `buildModuleGraph()` 未完成，
 * 而 `recordVersions()`（记录指纹基线）在该轮 resolve 之后才跑。若在两者之间写入，
 * 新指纹会被记成基线 ⇒ 改动被判「未变」而吞掉。
 * 这里主动避让，测的是**延迟**而不是那个竞态（竞态另见 plan §5 的记录）。
 */
const SETTLE_MS = Number(argValue("--settle") ?? "800");

function nextRound() {
  if (roundIdx >= rounds) {
    finish(0);
    return;
  }
  roundIdx++;
  setTimeout(() => {
    current = { round: roundIdx, writeAt: el(), incrementalAt: null, doneAt: null };
    // 追加一行注释：语义与错误面都不变，只驱动「文件变了」
    writeFileSync(target, `${original}\n// edit-loop probe round ${roundIdx} ${Date.now()}\n`, "utf-8");
    waitingIncremental = setTimeout(() => finish(1), ROUND_TIMEOUT);
  }, SETTLE_MS);
}

waitingFirst = setTimeout(() => {
  console.error(`first watch round did not complete within ${FIRST_TIMEOUT}ms`);
  finish(1);
}, FIRST_TIMEOUT);
