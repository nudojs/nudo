import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const ROOT = join(import.meta.dirname, "..", "..");

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return {
    n: xs.length,
    median: +(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2).toFixed(3),
    min: +Math.min(...xs).toFixed(3),
  };
}

async function main() {
  const { analyzeFile, clearBPathCache, clearAnalysisFileCache } = await import(
    join(ROOT, "packages/service/src/index.ts")
  );

  for (const [label, p] of [
    ["w1", "benchmark/micro/out/w1_nudo.js"],
    ["w3-50", "benchmark/micro/out/w3_nudo_50.js"],
    ["scale50", "benchmark/micro/out/scale_nudo_50.js"],
    ["scale200", "benchmark/micro/out/scale_nudo_200.js"],
    ["scale400", "benchmark/micro/out/scale_nudo_400.js"],
  ] as const) {
    const path = join(ROOT, p);
    const src = readFileSync(path, "utf-8");
    clearAnalysisFileCache();
    clearBPathCache();
    const t0 = performance.now();
    analyzeFile(path, src);
    const cold = performance.now() - t0;
    const samples: number[] = [];
    const reps = label.includes("400") || label.includes("200") ? 5 : 15;
    for (let i = 0; i < reps; i++) {
      const t = performance.now();
      analyzeFile(path, src);
      samples.push(performance.now() - t);
    }
    console.log(label.padEnd(10), "cold", cold.toFixed(1), "warm", stats(samples));
  }

  // command.js analyze
  {
    const path = join(ROOT, "node_modules/commander/lib/command.js");
    const src = readFileSync(path, "utf-8");
    clearAnalysisFileCache();
    clearBPathCache();
    const t0 = performance.now();
    try {
      analyzeFile(path, src);
      const cold = performance.now() - t0;
      const samples: number[] = [];
      for (let i = 0; i < 10; i++) {
        const t = performance.now();
        analyzeFile(path, src);
        samples.push(performance.now() - t);
      }
      console.log("command.js ".padEnd(10), "cold", cold.toFixed(1), "warm", stats(samples));
    } catch (e) {
      console.log("command.js analyze failed after", (performance.now() - t0).toFixed(1), "ms:", (e as Error).message);
    }
  }
}

await main();
