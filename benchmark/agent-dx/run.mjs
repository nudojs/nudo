#!/usr/bin/env node
/**
 * Agent DX 对照评测：Nudo vs TypeScript（成对同 bug）。
 * 指标：diagTokens · rounds · silentGreen · wrongFixGreen
 * Usage: node benchmark/agent-dx/run.mjs [--json]
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync, copyFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const jsonMode = process.argv.includes("--json");
const tasksDir = join(dirname(fileURLToPath(import.meta.url)), "tasks");

function tokensOf(s) {
  return Math.ceil(s.length / 4);
}

function nudoCheck(file, extra = []) {
  const r = spawnSync(
    "pnpm",
    ["exec", "tsx", "packages/nudojs/src/index.ts", "check", file, ...extra],
    { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function tscCheck(file) {
  const r = spawnSync(
    "pnpm",
    ["exec", "tsc", "--noEmit", "--pretty", "false", "--skipLibCheck", file],
    { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function issuesBlock(out) {
  // 取 issues 段（或 tsc 诊断全文）
  const i = out.indexOf("issues");
  return i >= 0 ? out.slice(i) : out;
}

function runTask(name) {
  const dir = join(tasksDir, name);
  const nudoDir = join(dir, "nudo");
  const tsDir = join(dir, "ts");
  const work = mkdtempSync(join(tmpdir(), `agent-dx-${name}-`));

  const nudo = (stem) => {
    const js = join(nudoDir, `${stem}.js`);
    const sc = join(nudoDir, `${stem}.nudo.js`);
    // 复制到 tmp 以隔离侧车
    const outJs = join(work, `${stem}.js`);
    copyFileSync(js, outJs);
    if (existsSync(sc)) copyFileSync(sc, join(work, `${stem}.nudo.js`));
    return nudoCheck(outJs);
  };

  const ts = (stem) => tscCheck(join(tsDir, `${stem}.ts`));

  const nBug = nudo("bug");
  const nFixed = nudo("fixed");
  const nWrong = nudo("wrong-fix");
  const tBug = ts("bug");
  const tFixed = ts("fixed");
  const tWrong = ts("wrong-fix");

  rmSync(work, { recursive: true, force: true });

  return {
    name,
    nudo: {
      diagTokens: tokensOf(issuesBlock(nBug.out)),
      bugExit: nBug.code,
      silentGreen: nBug.code === 0,
      rounds: nFixed.code === 0 && nBug.code !== 0 ? 1 : nFixed.code === 0 ? 0 : 9,
      wrongFixGreen: nWrong.code === 0,
    },
    ts: {
      diagTokens: tokensOf(issuesBlock(tBug.out)),
      bugExit: tBug.code,
      silentGreen: tBug.code === 0,
      rounds: tFixed.code === 0 && tBug.code !== 0 ? 1 : tFixed.code === 0 ? 0 : 9,
      wrongFixGreen: tWrong.code === 0,
    },
  };
}

const names = readdirSync(tasksDir).sort();
const results = names.map(runTask);

function avg(xs) {
  return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0;
}

function sideSummary(side) {
  const detected = results.filter((r) => !r[side].silentGreen);
  return {
    detectRate: `${detected.length}/${results.length}`,
    silentGreen: results.filter((r) => r[side].silentGreen).length,
    wrongFixGreen: results.filter((r) => r[side].wrongFixGreen).length,
    avgDiagTokensWhenDetected: avg(detected.map((r) => r[side].diagTokens)),
    avgRoundsWhenDetected: avg(detected.map((r) => r[side].rounds)),
  };
}

const summary = {
  script: "agent-dx",
  note: "paired same-bug fixtures; diagTokens ≈ chars/4 on first red payload",
  nudo: sideSummary("nudo"),
  ts: sideSummary("ts"),
  results,
};

if (jsonMode) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log("Agent DX bench — Nudo vs TypeScript (same logical bugs)");
  console.log("");
  console.log("task                | detect n/ts | diagTok n/ts (when fired) | wrongFixGreen n/ts | rounds n/ts");
  for (const r of results) {
    const dn = r.nudo.silentGreen ? "SG" : "RED";
    const dt = r.ts.silentGreen ? "SG" : "RED";
    console.log(
      `${r.name.padEnd(18)} | ${`${dn}/${dt}`.padEnd(11)} | ${`${r.nudo.diagTokens}/${r.ts.diagTokens}`.padEnd(23)} | ${`${r.nudo.wrongFixGreen}/${r.ts.wrongFixGreen}`.padEnd(17)} | ${`${r.nudo.rounds}/${r.ts.rounds}`}`,
    );
  }
  console.log("");
  console.log(`detectRate (bug is red at the gate)   nudo=${summary.nudo.detectRate}   ts=${summary.ts.detectRate}`);
  console.log(`silentGreen (bug ships, gate green)   nudo=${summary.nudo.silentGreen}/5   ts=${summary.ts.silentGreen}/5   ← lower is better`);
  console.log(`wrongFixGreen (gate cheats)           nudo=${summary.nudo.wrongFixGreen}/5   ts=${summary.ts.wrongFixGreen}/5`);
  console.log(`avgDiagTokens when detected           nudo=${summary.nudo.avgDiagTokensWhenDetected}   ts=${summary.ts.avgDiagTokensWhenDetected}`);
  console.log(`avgRounds when detected               nudo=${summary.nudo.avgRoundsWhenDetected}   ts=${summary.ts.avgRoundsWhenDetected}`);
  console.log("");
  console.log("Read: TS “cheap” tokens are often silence (SG) — the agent never sees the bug.");
}
