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
 * Usage:
 *   node scripts/dx-metrics.mjs
 *   node scripts/dx-metrics.mjs --json
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jsonMode = process.argv.includes("--json");

const SIDECAR = `import { number, fn } from "@nudojs/core";

export const setDelay = fn({ ms: number().gt(0) }, number());
`;

function runCheck(file) {
  const r = spawnSync(
    "pnpm",
    ["exec", "tsx", "packages/nudojs/src/index.ts", "check", file],
    { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return {
    status: r.status ?? 1,
    stdout: `${r.stdout ?? ""}${r.stderr ?? ""}`,
  };
}

const dir = mkdtempSync(join(tmpdir(), "nudo-dx-metrics-"));
const samples = [];

function scenario(name, body, fixBody) {
  const file = join(dir, `${name}.js`);
  const sidecar = join(dir, `${name}.nudo.js`);
  writeFileSync(sidecar, SIDECAR, "utf-8");

  writeFileSync(file, body, "utf-8");
  const t0 = performance.now();
  const red = runCheck(file);
  const tRed = performance.now();

  writeFileSync(file, fixBody, "utf-8");
  const green = runCheck(file);
  const tGreen = performance.now();

  const redOk = red.status !== 0 && red.stdout.includes("constraint-violated");
  const greenOk = green.status === 0;
  samples.push({
    name,
    redOk,
    greenOk,
    fixRate: redOk && greenOk ? 1 : 0,
    timeToGreenMs: Math.round(tGreen - t0),
    redMs: Math.round(tRed - t0),
    fixMs: Math.round(tGreen - tRed),
  });
}

// 场景 1：改调用点（错误面给的「use a value satisfying …」）
scenario(
  "fix-callsite",
  `export function setDelay(ms) {
  return ms;
}

setDelay(0);
`,
  `export function setDelay(ms) {
  return ms;
}

setDelay(250);
`,
);

// 场景 2：放宽契约（错误面给的「or relax the precondition」）——侧车改为 ge(0)
{
  const name = "relax-contract";
  const file = join(dir, `${name}.js`);
  const src = `export function setDelay(ms) {
  return ms;
}

setDelay(0);
`;
  writeFileSync(file, src, "utf-8");
  writeFileSync(join(dir, `${name}.nudo.js`), SIDECAR, "utf-8");
  const t0 = performance.now();
  const red = runCheck(file);
  const tRed = performance.now();
  writeFileSync(
    join(dir, `${name}.nudo.js`),
    `import { number, fn } from "@nudojs/core";

export const setDelay = fn({ ms: number().ge(0) }, number());
`,
    "utf-8",
  );
  const green = runCheck(file);
  const tGreen = performance.now();
  const redOk = red.status !== 0 && red.stdout.includes("constraint-violated");
  const greenOk = green.status === 0;
  samples.push({
    name,
    redOk,
    greenOk,
    fixRate: redOk && greenOk ? 1 : 0,
    timeToGreenMs: Math.round(tGreen - t0),
    redMs: Math.round(tRed - t0),
    fixMs: Math.round(tGreen - tRed),
  });
}

rmSync(dir, { recursive: true, force: true });

const fixed = samples.filter((s) => s.fixRate === 1).length;
const fixRate = samples.length === 0 ? 0 : fixed / samples.length;
const ttg = samples.map((s) => s.timeToGreenMs);
const avgTtg = ttg.length ? Math.round(ttg.reduce((a, b) => a + b, 0) / ttg.length) : 0;
const maxTtg = ttg.length ? Math.max(...ttg) : 0;

const report = {
  script: "dx-metrics",
  note: "internal baseline, not a CI gate",
  fixRate,
  avgTimeToGreenMs: avgTtg,
  maxTimeToGreenMs: maxTtg,
  samples,
};

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Nudo DX metrics (internal, not a CI gate)");
  console.log("");
  for (const s of samples) {
    console.log(
      `  ${s.name}: fixRate=${s.fixRate}  timeToGreen=${s.timeToGreenMs}ms  (red ${s.redMs}ms + fix ${s.fixMs}ms)`,
    );
  }
  console.log("");
  console.log(`  fix-rate: ${(fixRate * 100).toFixed(0)}% (${fixed}/${samples.length})`);
  console.log(`  time-to-green: avg ${avgTtg}ms · max ${maxTtg}ms`);
  console.log("");
  console.log("Targets (rev 5 ops): fix-rate 100% on documented paths · time-to-green < 2s local");
}

process.exit(fixRate === 1 ? 0 : 1);
