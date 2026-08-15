#!/usr/bin/env node
// 真实项目试炼 harness：对目录内所有 .js 逐文件跑 nudo infer --json，汇总指标
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const dir = process.argv[2];
const files = readdirSync(dir, { recursive: true })
  .map((f) => join(dir, f))
  .filter((f) => f.endsWith(".js"));

const agg = {
  files: 0, functions: 0, cases: 0,
  resultsUnknown: 0, resultsPrecise: 0, entryOnly: 0,
  diagnostics: { error: 0, warning: 0 },
  errors: [], walls: [], crash: [],
};

for (const file of files) {
  const t0 = performance.now();
  try {
    const out = execFileSync("node_modules/.bin/tsx", [
      "packages/cli/src/index.ts", "infer", file, "--json",
    ], { encoding: "utf8", timeout: 60000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    const wall = performance.now() - t0;
    agg.walls.push(wall);
    agg.files++;
    const r = JSON.parse(out);
    for (const fn of r.functions ?? []) {
      agg.functions++;
      const cases = fn.cases ?? [];
      agg.cases += cases.length;
      if (fn.entryOnly) agg.entryOnly++;
      for (const c of cases) {
        const res = c.result ?? "";
        if (res === "unknown") agg.resultsUnknown++;
        else agg.resultsPrecise++;
      }
    }
    for (const d of r.diagnostics ?? []) {
      agg.diagnostics[d.severity] = (agg.diagnostics[d.severity] ?? 0) + 1;
      if (d.severity === "error") agg.errors.push(`${file.split("/").pop()}:${d.range?.start?.line ?? "?"} ${d.message} [${d.code}]`);
    }
  } catch (e) {
    agg.crash.push(`${file}: ${(e.stderr || e.message).slice(0, 200)}`);
  }
}

const total = agg.resultsUnknown + agg.resultsPrecise;
console.log(JSON.stringify({
  dir,
  files: agg.files, functions: agg.functions, cases: agg.cases,
  entryOnlyFns: agg.entryOnly,
  preciseResults: agg.resultsPrecise, unknownResults: agg.resultsUnknown,
  preciseRate: total ? (agg.resultsPrecise / total * 100).toFixed(1) + "%" : "n/a",
  diagnostics: agg.diagnostics,
  wallMsAvg: agg.walls.length ? Math.round(agg.walls.reduce((a, b) => a + b, 0) / agg.walls.length) : 0,
  wallMsTotal: Math.round(agg.walls.reduce((a, b) => a + b, 0)),
  crashes: agg.crash.length,
}, null, 2));
console.log("--- errors (first 25) ---");
console.log(agg.errors.slice(0, 25).join("\n") || "(none)");
if (agg.crash.length) { console.log("--- crashes ---"); console.log(agg.crash.join("\n")); }
