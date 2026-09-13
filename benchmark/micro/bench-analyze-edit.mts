import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const ROOT = join(import.meta.dirname, "..", "..");
const { analyzeFile, clearAnalysisFileCache, clearBPathCache } = await import(
  join(ROOT, "packages/service/src/index.ts")
);
const { w3Nudo } = await import("./fixtures.mjs");

const base = w3Nudo(400);
const path = join(ROOT, "benchmark/micro/out/scale_nudo_400.js");

function med(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return +(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2).toFixed(2);
}

// warm
writeFileSync(path, base);
clearAnalysisFileCache();
clearBPathCache();
analyzeFile(path, base);

const samples: number[] = [];
for (let i = 0; i < 8; i++) {
  const edited = base + `\n// t${i}\n`;
  writeFileSync(path, edited);
  const t = performance.now();
  analyzeFile(path, edited);
  samples.push(performance.now() - t);
}
console.log("scale400 analyze after-edit median", med(samples), "ms", samples.map((x) => +x.toFixed(1)));

// command.js
const cmd = join(ROOT, "node_modules/commander/lib/command.js");
const cmdSrc = readFileSync(cmd, "utf-8");
clearAnalysisFileCache();
clearBPathCache();
analyzeFile(cmd, cmdSrc);
const cmdS: number[] = [];
for (let i = 0; i < 5; i++) {
  const edited = cmdSrc + `\n// t${i}\n`;
  const t = performance.now();
  analyzeFile(cmd, edited);
  cmdS.push(performance.now() - t);
}
console.log("command.js analyze after-edit median", med(cmdS), "ms");
