import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const ROOT = join(import.meta.dirname, "..", "..");
const { analyzeFile, clearAnalysisFileCache, clearBPathCache } = await import(
  join(ROOT, "packages/service/src/index.ts")
);
const { checkSource, pTrue, resetCheckSourceMemo } = await import(
  join(ROOT, "packages/core/src/index.ts")
);
const { w3Nudo } = await import("./fixtures.mjs");

function med(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return +(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2).toFixed(2);
}

// body edit: change last function's constant
const base = w3Nudo(400);
const path = join(ROOT, "benchmark/micro/out/scale_nudo_400.js");
writeFileSync(path, base);
clearAnalysisFileCache();
clearBPathCache();
resetCheckSourceMemo();
analyzeFile(path, base);
checkSource(path, base, pTrue, {});

const an: number[] = [];
const ch: number[] = [];
for (let i = 0; i < 8; i++) {
  const edited = base.replace("return x + 399;", `return x + ${399 + i};`);
  let t = performance.now();
  analyzeFile(path, edited);
  an.push(performance.now() - t);
  t = performance.now();
  checkSource(path, edited, pTrue, {});
  ch.push(performance.now() - t);
}
console.log("scale400 BODY-edit analyze", med(an), "check", med(ch));

// command.js body: touch last line of last function-ish by appending a statement inside... 
// simpler: change a numeric literal occurrence at end
const cmd = join(ROOT, "node_modules/commander/lib/command.js");
const cmdSrc = readFileSync(cmd, "utf-8");
clearAnalysisFileCache();
clearBPathCache();
resetCheckSourceMemo();
analyzeFile(cmd, cmdSrc);
checkSource(cmd, cmdSrc, pTrue, {});
const can: number[] = [];
const cch: number[] = [];
for (let i = 0; i < 5; i++) {
  // append a no-op const in a new block at end - real AST change
  const edited = cmdSrc + `\n{\n  const __nudo_touch_${i} = ${i};\n}\n`;
  let t = performance.now();
  analyzeFile(cmd, edited);
  can.push(performance.now() - t);
  t = performance.now();
  checkSource(cmd, edited, pTrue, {});
  cch.push(performance.now() - t);
}
console.log("command.js BODY-edit analyze", med(can), "check", med(cch));
