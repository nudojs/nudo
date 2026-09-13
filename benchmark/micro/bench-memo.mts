/** Focused warm/cold bench for checkSource + analyzeFile after memo work. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const ROOT = join(import.meta.dirname, "..", "..");

async function main() {
  const { checkSource, pTrue, resetCheckSourceMemo, getCheckSourceMemoSize, resetParseSourceCache } =
    await import(join(ROOT, "packages/core/src/index.ts"));
  const { analyzeFile, clearBPathCache, clearAnalysisFileCache } =
    await import(join(ROOT, "packages/service/src/index.ts"));
  const { defaultLoadModule } = await import(join(ROOT, "packages/service/src/load-module.ts"));

  const commander = join(ROOT, "node_modules/commander/lib/command.js");
  const src = readFileSync(commander, "utf-8");
  const path = commander;

  function stats(xs: number[]) {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return {
      n: xs.length,
      median: +(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2).toFixed(3),
      min: +Math.min(...xs).toFixed(3),
      max: +Math.max(...xs).toFixed(3),
    };
  }

  // --- checkSource cold (reset all) ---
  resetCheckSourceMemo();
  resetParseSourceCache();
  {
    const t0 = performance.now();
    const r = checkSource(path, src, pTrue, { loadModule: defaultLoadModule, fromFile: path });
    const cold = performance.now() - t0;
    console.log("check cold:", cold.toFixed(1), "ms  fns=", r.summary.functions, "issues=", r.issues.length);

    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      checkSource(path, src, pTrue, { loadModule: defaultLoadModule, fromFile: path });
      samples.push(performance.now() - t);
    }
    console.log("check warm (file memo):", stats(samples), "memoSize=", getCheckSourceMemoSize());
  }

  // --- checkSource with only generalize warm (no file memo) ---
  resetCheckSourceMemo();
  {
    // first populates L0/AST
    checkSource(path, src, pTrue, { loadModule: defaultLoadModule, fromFile: path });
    resetCheckSourceMemo();
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t = performance.now();
      checkSource(path, src, pTrue, { loadModule: defaultLoadModule, fromFile: path });
      samples.push(performance.now() - t);
      resetCheckSourceMemo(); // force recompute with warm L0
    }
    console.log("check recompute (L0 warm, no file memo):", stats(samples));
  }

  // --- analyzeFile ---
  clearBPathCache();
  clearAnalysisFileCache();
  resetParseSourceCache();
  {
    const t0 = performance.now();
    analyzeFile(path, src);
    const cold = performance.now() - t0;
    console.log("analyze cold:", cold.toFixed(1), "ms");

    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      analyzeFile(path, src);
      samples.push(performance.now() - t);
    }
    console.log("analyze warm (file memo):", stats(samples));
  }

  // --- small fixture warm ---
  const w1 = join(ROOT, "benchmark/micro/out/w1_nudo.js");
  try {
    const w1src = readFileSync(w1, "utf-8");
    clearAnalysisFileCache();
    clearBPathCache();
    analyzeFile(w1, w1src);
    const samples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t = performance.now();
      analyzeFile(w1, w1src);
      samples.push(performance.now() - t);
    }
    console.log("analyze warm w1:", stats(samples));
  } catch {
    console.log("(no w1 fixture)");
  }

  // scaling 50/200/400
  for (const n of [50, 200, 400]) {
    const p = join(ROOT, `benchmark/micro/out/scale_nudo_${n}.js`);
    try {
      const s = readFileSync(p, "utf-8");
      clearAnalysisFileCache();
      clearBPathCache();
      analyzeFile(p, s);
      const samples: number[] = [];
      const reps = n >= 200 ? 5 : 10;
      for (let i = 0; i < reps; i++) {
        const t = performance.now();
        analyzeFile(p, s);
        samples.push(performance.now() - t);
      }
      console.log(`analyze warm scale n=${n}:`, stats(samples));
    } catch {
      console.log(`(no scale fixture n=${n})`);
    }
  }
}

await main();
