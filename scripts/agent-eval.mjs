#!/usr/bin/env node
/**
 * AI5 — 固定 10 题 agent 改红评测（内部基线，不是 CI 门禁）。
 *
 * 每题：已知红 → 按 agents.md few-shot / actions[] 的文档路径修 → 再 check。
 * 报告 go 率、轮次（文档路径 1 轮内闭环计 1）、time-to-green。
 * 对照：tsc 在同逻辑上是否沉默（假绿）作为 TS 基线列。
 *
 * Usage:
 *   node scripts/agent-eval.mjs
 *   node scripts/agent-eval.mjs --json
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jsonMode = process.argv.includes("--json");
const dir = mkdtempSync(join(tmpdir(), "nudo-agent-eval-"));

function nudoCheck(file) {
  const r = spawnSync(
    "pnpm",
    ["exec", "tsx", "packages/cli/src/index.ts", "check", file],
    { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function tscCheck(file) {
  // TS 基线：仅当同逻辑改写成 .ts 注解形态时对照；无 typescript 则跳过
  try {
    const r = spawnSync(
      "pnpm",
      ["exec", "tsc", "--noEmit", "--pretty", "false", "--skipLibCheck", file],
      { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  } catch {
    return null;
  }
}

/** 10 题：name · red 源 · green 源 · 预期 red code · 文档动作 kind */
const TASKS = [
  {
    name: "01-callsite",
    kind: "callsite",
    expect: "nudo:constraint-violated",
    sidecar: `import { number, fn } from "@nudojs/core";\nexport const setDelay = fn({ ms: number().gt(0) }, number());\n`,
    red: `export function setDelay(ms) {\n  return ms;\n}\nsetDelay(0);\n`,
    green: `export function setDelay(ms) {\n  return ms;\n}\nsetDelay(250);\n`,
  },
  {
    name: "02-relax",
    kind: "relax",
    expect: "nudo:constraint-violated",
    sidecar: `import { number, fn } from "@nudojs/core";\nexport const setDelay = fn({ ms: number().gt(0) }, number());\n`,
    red: `export function setDelay(ms) {\n  return ms;\n}\nsetDelay(0);\n`,
    green: `export function setDelay(ms) {\n  return ms;\n}\nsetDelay(0);\n`,
    sidecarGreen: `import { number, fn } from "@nudojs/core";\nexport const setDelay = fn({ ms: number().ge(0) }, number());\n`,
  },
  {
    name: "03-entry-shape",
    kind: "relax",
    expect: "nudo:entry-may-throw",
    red: `export function getName(user) {\n  return user.name;\n}\ngetName({ name: "ada" });\n`,
    green: `export function getName(user) {\n  return user.name;\n}\ngetName({ name: "ada" });\n`,
    sidecarGreen: `import { fn, shape, string } from "@nudojs/core";\nexport const getName = fn({ user: shape({ name: string() }) }, string());\n`,
  },
  {
    name: "04-ignore-throws",
    kind: "ignore-throws",
    expect: "nudo:entry-may-throw",
    red: `export function getName(user) {\n  return user.name;\n}\n`,
    green: `export function getName(user) {\n  return user.name;\n}\n`,
    checkArgsGreen: ["--ignore-throws", "TypeError"],
  },
  {
    name: "05-assign-field",
    kind: "callsite",
    expect: "nudo:assign-mismatch",
    red: `export let config = { host: "localhost", port: 8080 };\nconfig = { host: "y" };\n`,
    green: `export let config = { host: "localhost", port: 8080 };\nconfig = { host: "y", port: 8080 };\n`,
  },
  {
    name: "06-return-refine",
    kind: "callsite",
    expect: "nudo:constraint-violated",
    sidecar: `import { number, fn } from "@nudojs/core";\nexport const bad = fn({}, number().gt(0));\n`,
    red: `export function bad() {\n  return 0;\n}\nbad();\n`,
    green: `export function bad() {\n  return 1;\n}\nbad();\n`,
  },
  {
    name: "07-length-bound",
    kind: "callsite",
    expect: "nudo:constraint-violated",
    sidecar: `import { string, fn } from "@nudojs/core";\nexport const tag = fn({ s: string().min(1) }, string());\n`,
    red: `export function tag(s) {\n  return "[" + s + "]";\n}\ntag("");\n`,
    green: `export function tag(s) {\n  return "[" + s + "]";\n}\ntag("ok");\n`,
  },
  {
    name: "08-unknown-body",
    kind: "callsite",
    expect: "nudo:unknown-inference",
    // 文档路径：让返回面可计算（禁止用假 @returns 消 unknown）
    red: `export function fmt(v) {\n  return __nudoMissingNative(v);\n}\nfmt(1);\n`,
    green: `export function fmt(v) {\n  return String(v);\n}\nfmt(1);\n`,
  },
  {
    name: "09-shape-missing",
    kind: "callsite",
    expect: "nudo:constraint-violated",
    sidecar: `import { shape, string, fn } from "@nudojs/core";\nexport const greet = fn({ u: shape({ name: string() }) }, string());\n`,
    red: `export function greet(u) {\n  return u.name + "!";\n}\ngreet({ id: 2 });\n`,
    green: `export function greet(u) {\n  return u.name + "!";\n}\ngreet({ id: 2, name: "ada" });\n`,
  },
  {
    name: "10-dual-fix-path",
    kind: "draft",
    expect: "nudo:constraint-violated",
    sidecar: `import { number, fn } from "@nudojs/core";\nexport const arm = fn({ x: number().gt(0) }, number());\nexport const bump = fn({ n: number().gt(0) }, number());\n`,
    red: `export function arm(x) {\n  return x;\n}\nexport function bump(n) {\n  return n;\n}\narm(-1);\nbump(0);\n`,
    green: `export function arm(x) {\n  return x;\n}\nexport function bump(n) {\n  return n;\n}\narm(1);\nbump(1);\n`,
  },
];

const results = [];
let idx = 0;
for (const t of TASKS) {
  idx += 1;
  const stem = `${idx}-${t.name}`;
  const js = join(dir, `${stem}.js`);
  writeFileSync(js, t.red, "utf-8");
  if (t.sidecar) writeFileSync(join(dir, `${stem}.nudo.js`), t.sidecar, "utf-8");

  const t0 = performance.now();
  const red = nudoCheck(js);
  // unknown-inference 是 warning（exit 0）——红 = 出现该码
  const redOk = red.out.includes(t.expect) && (t.expect.includes("unknown") || red.code !== 0);

  // 文档路径 1 轮：替换源 + 可选侧车 / check 参数
  writeFileSync(js, t.green, "utf-8");
  if (t.sidecarGreen) {
    writeFileSync(join(dir, `${stem}.nudo.js`), t.sidecarGreen, "utf-8");
  }
  let green;
  if (t.checkArgsGreen) {
    const r = spawnSync(
      "pnpm",
      ["exec", "tsx", "packages/cli/src/index.ts", "check", js, ...t.checkArgsGreen],
      { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    green = { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  } else {
    green = nudoCheck(js);
  }
  const ttg = Math.round(performance.now() - t0);
  const greenOk = t.expect.includes("unknown")
    ? !green.out.includes(t.expect) && green.code === 0
    : green.code === 0;
  const go = redOk && greenOk;

  // TS 对照：仅 01 用 number 注解（同逻辑）看 tsc 是否沉默
  let tsSilent = null;
  if (t.name === "01-callsite") {
    const ts = join(dir, `${stem}-ts.ts`);
    writeFileSync(
      ts,
      `function setDelay(ms: number): number {\n  return ms;\n}\nsetDelay(0);\n`,
      "utf-8",
    );
    const tsr = tscCheck(ts);
    tsSilent = tsr ? tsr.code === 0 : null;
  }

  results.push({
    name: t.name,
    kind: t.kind,
    expect: t.expect,
    redOk,
    greenOk,
    go,
    rounds: go ? 1 : 0,
    timeToGreenMs: ttg,
    tsSilent,
  });
}

rmSync(dir, { recursive: true, force: true });

const goes = results.filter((r) => r.go).length;
const goRate = results.length ? goes / results.length : 0;
const rounds = results.filter((r) => r.go).map((r) => r.rounds);
const avgRounds = rounds.length
  ? Math.round((rounds.reduce((a, b) => a + b, 0) / rounds.length) * 100) / 100
  : 0;
const ttgs = results.filter((r) => r.go).map((r) => r.timeToGreenMs);
const avgTtg = ttgs.length ? Math.round(ttgs.reduce((a, b) => a + b, 0) / ttgs.length) : 0;

const report = {
  script: "agent-eval",
  note: "internal baseline, not a CI gate",
  goRate,
  avgRounds,
  avgTimeToGreenMs: avgTtg,
  results,
};

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Nudo agent-eval (10 fixed red→green tasks; internal, not a CI gate)");
  console.log("");
  for (const r of results) {
    const ts =
      r.tsSilent === null ? "" : r.tsSilent ? "  [tsc SILENT=green on number]" : "  [tsc errors]";
    console.log(
      `  ${r.go ? "GO " : "MISS"} ${r.name} (${r.kind})  ${r.timeToGreenMs}ms${ts}`,
    );
  }
  console.log("");
  console.log(`  go-rate: ${(goRate * 100).toFixed(0)}% (${goes}/${results.length})  avgRounds=${avgRounds}  avgTTG=${avgTtg}ms`);
  console.log("  target: go-rate 100% on documented actions[] / few-shot paths");
}

process.exit(goRate === 1 ? 0 : 1);
