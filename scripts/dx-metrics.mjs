#!/usr/bin/env node
/**
 * C4 — fix-rate / time-to-green（内部运营基线，不是 CI 门禁）。
 *
 * 度量「看到违例 → 按文档修 → 变绿」：
 *   1. 造一个 L1 违例（setDelay(0) + refine ms>0）
 *   2. 跑 check（红）并计时
 *   3. 按错误面上的文档路径修（改调用点 / 放宽契约）后再 check（绿）
 *   4. 报告 fix-rate（文档路径是否变绿）与 time-to-green
 *
 * 双口径（--mode）——同一套场景、两种 CLI 传输：
 *   tsx  — pnpm exec tsx packages/nudojs/src/index.ts（开发回路，tsx 冷启动主导）
 *   dist — node packages/nudojs/dist/index.js（构建产物，用户口径，跳过 tsx 冷启动）
 *   both — 先 tsx 后 dist（默认）。dist 缺失时 honest skip 并说明，不伪造数字。
 *
 * Usage:
 *   node scripts/dx-metrics.mjs [--mode tsx|dist|both]
 *   node scripts/dx-metrics.mjs --json [--mode …]      # 机器可读报告（含 byMode/skipped）
 *   node scripts/dx-metrics.mjs --md [--lang en|zh|both]  # 带 <!-- dx-metrics:begin/end --> 标记的 markdown 块
 *                                                        # --lang both：一次测量同时出 en+zh 两块（镜像同数字）
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jsonMode = process.argv.includes("--json");
const mdMode = process.argv.includes("--md");

// --md 的语言（zh 镜像同数字、镜像文案）：`--lang zh` / `--lang=zh` / `--lang both`（一次测量出 en+zh 两块，镜像同数字），默认 en
function argValue(name) {
  const i = process.argv.indexOf(name);
  if (i !== -1) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : undefined;
}
const langArg = argValue("--lang");
if (langArg !== undefined && !["en", "zh", "both"].includes(langArg)) {
  console.error(`unknown --lang "${langArg}" (expected en|zh|both)`);
  process.exit(1);
}
const lang = langArg ?? "en";

const DIST_ENTRY = join(root, "packages", "nudojs", "dist", "index.js");
const modeArg = argValue("--mode");
if (modeArg !== undefined && !["tsx", "dist", "both"].includes(modeArg)) {
  console.error(`unknown --mode "${modeArg}" (expected tsx|dist|both)`);
  process.exit(1);
}
const mode = modeArg ?? "both";

const SIDECAR = `import { number, fn } from "@nudojs/core";

export const setDelay = fn({ ms: number().gt(0) }, number());
`;

const RELAXED_SIDECAR = `import { number, fn } from "@nudojs/core";

export const setDelay = fn({ ms: number().ge(0) }, number());
`;

const SRC = `export function setDelay(ms) {
  return ms;
}

setDelay(0);
`;

const SRC_FIXED = `export function setDelay(ms) {
  return ms;
}

setDelay(250);
`;

// dist 缺失的 honest-skip 说明（token 进 JSON；文案按输出语言渲染）
const SKIP_REASONS = {
  "dist-missing": {
    en: `packages/nudojs/dist/index.js not found — run \`pnpm run build\` first (numbers pending until rebuilt)`,
    zh: `未找到 packages/nudojs/dist/index.js —— 先跑 \`pnpm run build\`（重建后再测该口径）`,
  },
};

function runCheckTsx(file) {
  const r = spawnSync(
    "pnpm",
    ["exec", "tsx", "packages/nudojs/src/index.ts", "check", file],
    { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return { status: r.status ?? 1, stdout: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function runCheckDist(file) {
  const r = spawnSync(process.execPath, [DIST_ENTRY, "check", file], {
    cwd: root,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: r.status ?? 1, stdout: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// 需要跑哪些口径；dist 缺失 → honest skip（默认 both 下 tsx 照跑，dist 行如实标注）
const modes = [];
const skipped = [];
if (mode === "tsx" || mode === "both") modes.push("tsx");
if (mode === "dist" || mode === "both") {
  if (existsSync(DIST_ENTRY)) modes.push("dist");
  else skipped.push({ mode: "dist", reason: "dist-missing" });
}
if (modes.length === 0) {
  // 显式 --mode dist 且 dist 缺失：无法测量该口径，诚实失败而非假绿
  console.error(`dist mode unavailable: ${SKIP_REASONS["dist-missing"].en}`);
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "nudo-dx-metrics-"));
const samples = [];

function scenario(runMode, name, writeRed, writeFix) {
  const file = join(dir, `${name}.js`);
  const runCheck = runMode === "dist" ? runCheckDist : runCheckTsx;

  writeRed(file);
  const t0 = performance.now();
  const red = runCheck(file);
  const tRed = performance.now();

  writeFix(file);
  const green = runCheck(file);
  const tGreen = performance.now();

  const redOk = red.status !== 0 && red.stdout.includes("constraint-violated");
  const greenOk = green.status === 0;
  samples.push({
    mode: runMode,
    name,
    redOk,
    greenOk,
    fixRate: redOk && greenOk ? 1 : 0,
    timeToGreenMs: Math.round(tGreen - t0),
    redMs: Math.round(tRed - t0),
    fixMs: Math.round(tGreen - tRed),
  });
}

for (const m of modes) {
  // 场景 1：改调用点（错误面给的「use a value satisfying …」）
  scenario(
    m,
    "fix-callsite",
    (file) => {
      writeFileSync(join(dir, "fix-callsite.nudo.js"), SIDECAR, "utf-8");
      writeFileSync(file, SRC, "utf-8");
    },
    (file) => {
      writeFileSync(file, SRC_FIXED, "utf-8");
    },
  );

  // 场景 2：放宽契约（错误面给的「or relax the precondition」）——侧车改为 ge(0)
  scenario(
    m,
    "relax-contract",
    (file) => {
      writeFileSync(file, SRC, "utf-8");
      writeFileSync(join(dir, "relax-contract.nudo.js"), SIDECAR, "utf-8");
    },
    () => {
      writeFileSync(join(dir, "relax-contract.nudo.js"), RELAXED_SIDECAR, "utf-8");
    },
  );
}

rmSync(dir, { recursive: true, force: true });

function aggregate(list) {
  const fixed = list.filter((s) => s.fixRate === 1).length;
  const ttg = list.map((s) => s.timeToGreenMs);
  return {
    fixRate: list.length === 0 ? 0 : fixed / list.length,
    fixed,
    total: list.length,
    avgTimeToGreenMs: ttg.length ? Math.round(ttg.reduce((a, b) => a + b, 0) / ttg.length) : 0,
    maxTimeToGreenMs: ttg.length ? Math.max(...ttg) : 0,
  };
}

const overall = aggregate(samples);
const byMode = {};
for (const m of modes) byMode[m] = aggregate(samples.filter((s) => s.mode === m));

const report = {
  script: "dx-metrics",
  note: "internal baseline, not a CI gate",
  mode,
  modesExecuted: modes,
  skipped,
  fixRate: overall.fixRate,
  avgTimeToGreenMs: overall.avgTimeToGreenMs,
  maxTimeToGreenMs: overall.maxTimeToGreenMs,
  byMode,
  samples,
};

const pct = `${(overall.fixRate * 100).toFixed(0)}%`;

// 供 vs-typescript.md（en）/ 其 zh 镜像粘贴的带标记块；钉面测试
// packages/website/tests/dx-metrics-publication.test.ts 钉结构 + fix-rate
// （time-to-green 只钉 sanity 上界，秒数不钉——机器相关量）。
// mdBlock(l) 从同一份 samples/byMode 渲染——`--lang both` 一次测量出两块，镜像同数字。
function mdBlock(l) {
  const date = new Date().toISOString().slice(0, 10);
  const tsxLabel = l === "zh" ? "tsx（源码）" : "tsx (src)";
  const distLabel = l === "zh" ? "dist（构建产物）" : "dist (built)";
  const rows = [];
  for (const m of modes) {
    const a = byMode[m];
    rows.push(
      l === "zh"
        ? `| ${m === "tsx" ? tsxLabel : distLabel} | ${(a.fixRate * 100).toFixed(0)}%（${a.fixed}/${a.total} 条文档修复路径） | ${a.avgTimeToGreenMs} ms | ${a.maxTimeToGreenMs} ms |`
        : `| ${m === "tsx" ? tsxLabel : distLabel} | ${(a.fixRate * 100).toFixed(0)}% (${a.fixed}/${a.total} documented fix paths) | ${a.avgTimeToGreenMs} ms | ${a.maxTimeToGreenMs} ms |`,
    );
  }
  for (const s of skipped) {
    // honest skip：dist 行如实标注缺失原因，不伪造数字
    rows.push(
      l === "zh"
        ? `| ${distLabel} | 跳过 —— ${SKIP_REASONS[s.reason]?.zh ?? s.reason} | — | — |`
        : `| ${distLabel} | skipped — ${SKIP_REASONS[s.reason]?.en ?? s.reason} | — | — |`,
    );
  }
  const lines =
    l === "zh"
      ? [
          `<!-- 由 \`pnpm run dx-metrics -- --md --lang zh\` 生成于 ${date} —— 请再生，勿手改。内部运营基线，非 CI 门禁。 -->`,
          `| 模式 | fix-rate | time-to-green 平均 | time-to-green 最大 |`,
          `| --- | --- | --- | --- |`,
          ...rows,
          ``,
          `tsx = 开发回路（tsx 直跑源码 CLI）；dist = 构建产物 CLI，无 tsx 冷启动。`,
          ``,
          `目标（rev 5 运营）：fix-rate 文档路径 100% · time-to-green 本地 < 2 s。`,
        ]
      : [
          `<!-- Generated by \`pnpm run dx-metrics -- --md\` on ${date} — regenerate, do not hand-edit. Internal ops baseline, not a CI gate. -->`,
          `| mode | fix-rate | time-to-green avg | time-to-green max |`,
          `| --- | --- | --- | --- |`,
          ...rows,
          ``,
          `tsx = dev loop (CLI from source via tsx); dist = built CLI, no tsx cold start.`,
          ``,
          `Target (rev 5 ops): fix-rate 100% on documented paths · time-to-green < 2 s local.`,
        ];
  return [`<!-- dx-metrics:begin -->`, lines.join("\n"), `<!-- dx-metrics:end -->`].join("\n");
}

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else if (mdMode) {
  // `--lang both`：一次测量、两块输出（en+zh 同数字）——zh 镜像纪律的生成侧保证
  console.log(lang === "both" ? `${mdBlock("en")}\n\n${mdBlock("zh")}` : mdBlock(lang));
} else {
  console.log("Nudo DX metrics (internal, not a CI gate)");
  console.log("");
  for (const m of modes) {
    console.log(`  [${m}] ${m === "tsx" ? "pnpm exec tsx packages/nudojs/src/index.ts" : `node packages/nudojs/dist/index.js`}`);
    for (const s of samples.filter((x) => x.mode === m)) {
      console.log(
        `    ${s.name}: fixRate=${s.fixRate}  timeToGreen=${s.timeToGreenMs}ms  (red ${s.redMs}ms + fix ${s.fixMs}ms)`,
      );
    }
    const a = byMode[m];
    console.log(
      `    → ${m}: fix-rate ${(a.fixRate * 100).toFixed(0)}% (${a.fixed}/${a.total}) · time-to-green avg ${a.avgTimeToGreenMs}ms · max ${a.maxTimeToGreenMs}ms`,
    );
  }
  for (const s of skipped) {
    console.log(`  [${s.mode}] skipped — ${SKIP_REASONS[s.reason]?.en ?? s.reason}`);
  }
  console.log("");
  console.log(
    `  fix-rate: ${pct} (${overall.fixed}/${overall.total} executed samples across ${modes.length} mode(s))`,
  );
  console.log(`  time-to-green: avg ${overall.avgTimeToGreenMs}ms · max ${overall.maxTimeToGreenMs}ms (aggregate; per mode above)`);
  console.log("");
  console.log("Targets (rev 5 ops): fix-rate 100% on documented paths · time-to-green < 2s local");
}

process.exit(overall.fixRate === 1 ? 0 : 1);
