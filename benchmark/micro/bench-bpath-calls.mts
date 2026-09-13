import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const ROOT = join(import.meta.dirname, "..", "..");
const { tryRunBPath, tryBPathCallFull, clearBPathCache } = await import(
  join(ROOT, "packages/service/src/index.ts")
);
const { typeValueToAbs, T } = await import(join(ROOT, "packages/core/src/index.ts"));
const { w3Nudo } = await import("./fixtures.mjs");

const base = w3Nudo(400);
const path = join(ROOT, "benchmark/micro/out/scale_nudo_400.js");
writeFileSync(path, base);

function med(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return +(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2).toFixed(2);
}

// warm run
clearBPathCache();
tryRunBPath(base, path, {});

const one: number[] = [];
const all: number[] = [];
for (let i = 0; i < 5; i++) {
  let t = performance.now();
  tryBPathCallFull(base, path, "f399", [typeValueToAbs(T.number)], {
    collectCalls: true,
  });
  one.push(performance.now() - t);

  t = performance.now();
  for (let f = 0; f < 400; f++) {
    tryBPathCallFull(base, path, `f${f}`, [typeValueToAbs(T.number)], {
      collectCalls: true,
    });
  }
  all.push(performance.now() - t);
}
console.log("one call", med(one), "ms; 400 calls", med(all), "ms; per-call", (med(all) / 400).toFixed(4));

// without collectCalls
const all2: number[] = [];
for (let i = 0; i < 5; i++) {
  const t = performance.now();
  for (let f = 0; f < 400; f++) {
    tryBPathCallFull(base, path, `f${f}`, [typeValueToAbs(T.number)], {});
  }
  all2.push(performance.now() - t);
}
console.log("400 calls no-collect", med(all2), "ms; per-call", (med(all2) / 400).toFixed(4));
