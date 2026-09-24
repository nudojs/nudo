#!/usr/bin/env node
/**
 * LSP 省轮实验 driver — omp, parallel sides, repairLoops/detectRate/silentGreen.
 * Usage: node harness/run.mjs [--seed 1] [--side both|nudo|typescript]
 */
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { summarizeOmpSession } from "./metrics.mjs";
import { startMemSampler, runWithMaxRss, formatMb } from "./mem.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

let seed = 1;
let side = "both";
let ompBin = "/Users/lot/.bun/bin/omp";
/** 单侧 omp 墙钟预算（0=不限）。超时仍对 workdir 事后打分。 */
let timeoutMs = 0;
/** oss = OSS 历史 bug 切片（semver）— 当前唯一任务 */
let task = "oss";
/** 内存对比需要干净采样 → 默认顺序跑（--par 可改回并行） */
let seq = true;
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--seed") seed = Number(process.argv[++i] ?? 1);
  else if (a === "--side") side = process.argv[++i] ?? "both";
  else if (a === "--omp") ompBin = process.argv[++i] ?? ompBin;
  else if (a === "--timeout-ms") timeoutMs = Number(process.argv[++i] ?? 0);
  else if (a === "--task") task = process.argv[++i] ?? "oss";
  else if (a === "--par" || a === "--parallel") seq = false;
  else if (a === "--seq") seq = true;
}

const config = JSON.parse(readFileSync(join(root, "agent", "models.json"), "utf-8"));
const isOss = true;
const fairness = existsSync(join(root, "agent", "FAIRNESS.md"))
  ? readFileSync(join(root, "agent", "FAIRNESS.md"), "utf-8")
  : "";
const prd = readFileSync(join(root, "oss-semver", "BUGS.md"), "utf-8");
const startersDir = join(root, "starters-oss-semver");
const workPrefix = "oss-semver";

const modelPair = {
  nudo: config.models?.nudo || config.model,
  typescript: config.models?.typescript || config.model,
};

function repoEnv() {
  const repoBin = join(root, "..", "..", "node_modules", ".bin");
  return { ...process.env, PATH: `${repoBin}:${process.env.PATH ?? ""}` };
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
    env: repoEnv(),
  });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function runAsync(cmd, args, cwd, timeoutMs = 0) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: repoEnv() });
    let out = "";
    let timedOut = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            try {
              child.kill("SIGTERM");
            } catch {
              /* ignore */
            }
          }, timeoutMs)
        : null;
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: timedOut ? 124 : (code ?? 1), out, timedOut });
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 1, out: String(err), timedOut });
    });
  });
}

function loadOmpEvents(sessionDir) {
  const recs = [];
  if (!existsSync(sessionDir)) return recs;
  for (const name of readdirSync(sessionDir)) {
    if (!name.endsWith(".jsonl")) continue;
    for (const line of readFileSync(join(sessionDir, name), "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        recs.push(JSON.parse(line));
      } catch {
        /* skip */
      }
    }
  }
  return recs;
}

/** 类型面/历史 bug 的测试名关键字 */
const BUG_KEYS = isOss
  ? ["bug#1", "bug#2", "bug#3", "bug#4", "bug#5", "bug#6"]
  : ["bug#1", "bug#2", "bug#3", "bug#4", "bug#5", "bug#6", "bug#7", "bug#8"];

function scoreBugs(testOut) {
  let detectRate = 0;
  const detail = {};
  for (const k of BUG_KEYS) {
    const ok = new RegExp(`✔[^\\n]*${k}`, "i").test(testOut) || new RegExp(`^ok \\d+[^\\n]*${k}`, "im").test(testOut);
    const bad = new RegExp(`✖[^\\n]*${k}`, "i").test(testOut) || new RegExp(`not ok \\d+[^\\n]*${k}`, "i").test(testOut);
    const win = ok && !bad;
    detail[k] = win ? "pass" : "fail";
    if (win) detectRate += 1;
  }
  return { detectRate, detail };
}

/** repairLoops: edit/write 之后又收到 diagnostic 再 edit 的次数（session 启发式） */
function countRepairLoops(records) {
  let sawDiag = false;
  let repairs = 0;
  for (const r of records) {
    const msg = r?.type === "message" || r?.type === "message_end" ? r.message ?? r : r;
    const content = msg?.content;
    if (!Array.isArray(content)) {
      const blob = JSON.stringify(r);
      if (/LSP Diagnostics|entry-may-throw|error TS|nudo-check|constraint-violated|assign-mismatch/i.test(blob)) {
        sawDiag = true;
      }
      continue;
    }
    for (const c of content) {
      if (!c || typeof c !== "object") continue;
      const blob = JSON.stringify(c);
      if (/LSP Diagnostics|error TS|nudo-check|may throw|constraint-violated/i.test(blob)) sawDiag = true;
      const name = c.name ?? c.tool ?? "";
      if (sawDiag && (name === "edit" || name === "write" || name === "multi_edit")) repairs += 1;
    }
  }
  return repairs;
}

async function runSide(which) {
  const work = mkdtempSync(join(tmpdir(), `${workPrefix}-${which}-`));
  cpSync(join(startersDir, which), work, { recursive: true });
  // starters 自带 AGENT_BRIEF / BUGS / FAIRNESS
  writeFileSync(join(work, "PRD.md"), prd, "utf-8");
  if (which === "typescript") {
    run("npm", ["install", "--no-audit", "--no-fund"], work);
  }
  const sessionDir = join(work, ".omp-session");
  mkdirSync(sessionDir, { recursive: true });
  const brief = [
    "Read AGENT_BRIEF.md, FAIRNESS.md, BUGS.md and test/acceptance.test.js in this directory.",
    `Fix lib/ until npm run ci is green. Task=${task} (real historical bugs, multi-file module graph).`,
    "Use LSP diagnostics. Do not modify test/**, package.json, tsconfig.json, or BUGS.md.",
    "Stop when npm run ci is green — do not polish warnings.",
  ].join("\n");
  const t0 = Date.now();
  const mem = startMemSampler({ sampleMs: 2000 });
  const hb = setInterval(() => {
    const s = existsSync(sessionDir)
      ? readdirSync(sessionDir)
          .filter((n) => n.endsWith(".jsonl"))
          .map((n) => {
            try {
              return readFileSync(join(sessionDir, n), "utf-8").split("\n").length;
            } catch {
              return 0;
            }
          })
          .reduce((a, b) => a + b, 0)
      : 0;
    console.error(`[hb] ${which} +${Math.round((Date.now() - t0) / 1000)}s sessionLines=${s}`);
  }, 30_000);
  const omp = await runAsync(
    ompBin,
    ["-p", "--mode", "json", "--cwd", work, "--model", modelPair[which], "--auto-approve", "--no-prewalk", "--session-dir", sessionDir, brief],
    work,
    timeoutMs,
  );
  clearInterval(hb);
  const memPeak = mem.stop();
  const wallMs = Date.now() - t0;
  writeFileSync(join(work, "omp-print.log"), omp.out, "utf-8");
  const records = loadOmpEvents(sessionDir);
  const metrics = summarizeOmpSession(records, wallMs);
  const gate = runWithMaxRss("npm", ["run", "gate"], work, repoEnv());
  const test = run("npm", ["test"], work);
  const bugs = scoreBugs(test.out);
  const repairLoops = countRepairLoops(records);
  return {
    side: which,
    model: modelPair[which],
    seed,
    metrics: { ...metrics, repairLoops },
    gate: { exit: gate.code, ok: gate.code === 0, maxRssKb: gate.maxRssKb },
    testExit: test.code,
    detectRate: bugs.detectRate,
    bugDetail: bugs.detail,
    silentGreen: gate.code === 0 && bugs.detectRate < BUG_KEYS.length,
    ompExit: omp.code,
    timedOut: !!omp.timedOut,
    mem: {
      lspPeakRssKb: memPeak.lspRssKb,
      nodePeakRssKb: memPeak.nodeRssKb,
      sysTreePeakRssKb: memPeak.treeRssKb,
      gatePeakRssKb: gate.maxRssKb,
      samples: memPeak.samples,
      lspCmd: memPeak.lspCmd,
    },
    workDir: work,
    sessionDir,
  };
}

const sides = side === "both" ? ["nudo", "typescript"] : [side];
const results = [];
if (seq) {
  for (const s of sides) results.push(await runSide(s));
} else {
  results.push(...(await Promise.all(sides.map((s) => runSide(s)))));
}
const ts = Date.now();
const outDir = join(root, "out");
mkdirSync(outDir, { recursive: true });
for (const r of results) {
  writeFileSync(join(outDir, `${ts}-seed${seed}-${r.side}.json`), JSON.stringify(r, null, 2), "utf-8");
}
const n = results.find((r) => r.side === "nudo");
const t = results.find((r) => r.side === "typescript");
const row = (label, a, b) => `| ${label} | ${a ?? "—"} | ${b ?? "—"} |`;
const md = `# LSP Rounds — ${ts} / seed ${seed} / task=${task}

model: same weights, different accounts — nudo=\`${modelPair.nudo}\` · ts=\`${modelPair.typescript}\`
**tokens only** · metric focus: **repairLoops / detectRate / silentGreen**

## 主表

| 指标 | Nudo | TypeScript |
|------|------|------------|
| **detectRate** (0–${BUG_KEYS.length}) | ${n?.detectRate} | ${t?.detectRate} |
| **silentGreen** | ${n?.silentGreen} | ${t?.silentGreen} |
| **repairLoops** | ${n?.metrics.repairLoops} | ${t?.metrics.repairLoops} |
| tokenTotal | ${n?.metrics.tokenTotal} | ${t?.metrics.tokenTotal} |
| rounds | ${n?.metrics.rounds} | ${t?.metrics.rounds} |
| offscript | ${n?.metrics.offscriptToolCalls ?? 0} | ${t?.metrics.offscriptToolCalls ?? 0} |
| gate | ${n?.gate.exit} | ${t?.gate.exit} |
| tests | ${n?.testExit} | ${t?.testExit} |
| timedOut | ${n?.timedOut} | ${t?.timedOut} |
| **mem LSP peak** | ${formatMb(n?.mem?.lspPeakRssKb)} | ${formatMb(t?.mem?.lspPeakRssKb)} |
| **mem gate peak** | ${formatMb(n?.mem?.gatePeakRssKb)} | ${formatMb(t?.mem?.gatePeakRssKb)} |
| mem node peak | ${formatMb(n?.mem?.nodePeakRssKb)} | ${formatMb(t?.mem?.nodePeakRssKb)} |

### bug 明细

| | Nudo | TS |
|--|------|-----|
${BUG_KEYS.map((k) => row(k, n?.bugDetail?.[k], t?.bugDetail?.[k])).join("\n")}

## 复现

\`\`\`bash
node benchmark/lsp-rounds/harness/run.mjs --seed ${seed}
\`\`\`
`;
writeFileSync(join(outDir, `${ts}-seed${seed}-report.md`), md, "utf-8");
console.log(
  `lsp-rounds: ${results.map((r) => `${r.side} detect=${r.detectRate}/${BUG_KEYS.length} silentGreen=${r.silentGreen} repair=${r.metrics.repairLoops} tok=${r.metrics.tokenTotal} rounds=${r.metrics.rounds} lspMem=${formatMb(r.mem?.lspPeakRssKb)} gateMem=${formatMb(r.mem?.gatePeakRssKb)}`).join("  ")}`,
);
console.log(`report: benchmark/lsp-rounds/out/${ts}-seed${seed}-report.md`);
