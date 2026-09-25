/**
 * Nudo vs tsc micro-benchmark.
 *
 * Separates:
 *  - cold process / CLI spawn
 *  - cold import (process live, first analysis)
 *  - warm in-process analysis (steady state)
 *  - polyvariant / multi-function scan
 *  - tsc --noEmit cold (and incremental second pass when tsbuildinfo exists)
 *
 * Run:  npx tsx benchmark/micro/run.mts
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import ts from "typescript";
import { writeFixtures, OUT_DIR, w3Nudo, w3Tsc, w4Nudo, w4Tsc } from "./fixtures.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
const CLI = join(ROOT, "packages/nudojs/src/index.ts");
const TSC = join(ROOT, "node_modules/typescript/lib/tsc.js");
const TSX = join(ROOT, "node_modules/.bin/tsx");

type Sample = { name: string; ms: number; note?: string; extra?: Record<string, unknown> };

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function stats(samples: number[]) {
  return {
    n: samples.length,
    median: +median(samples).toFixed(2),
    min: +Math.min(...samples).toFixed(2),
    max: +Math.max(...samples).toFixed(2),
    mean: +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(2),
  };
}

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    encoding: "utf-8",
    env: { ...process.env, ...opts.env },
    maxBuffer: 32 * 1024 * 1024,
  });
}

function timeSpawn(cmd: string, args: string[], reps: number, label: string): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    const r = run(cmd, args);
    const ms = performance.now() - t0;
    if (r.status !== 0 && i === 0) {
      out.push({ name: label, ms, note: `exit=${r.status} stderr=${(r.stderr || "").slice(0, 200)}` });
    } else {
      out.push({ name: label, ms });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// In-process Nudo (needs tsx / type-stripping loader)
// ---------------------------------------------------------------------------

async function loadAnalyze() {
  const mod = await import("../../packages/service/src/index.ts");
  return mod.analyzeFile as (path: string, source: string) => unknown;
}

async function measureNudoWarm(files: Record<string, string>) {
  const analyzeFile = await loadAnalyze();
  const results: Record<string, ReturnType<typeof stats> & { samples: number[] }> = {};

  const warmOne = (key: string, pathKey: string, reps: number) => {
    const path = files[pathKey]!;
    const source = readFileSync(path, "utf-8");
    // warmup
    analyzeFile(path, source);
    const samples: number[] = [];
    for (let i = 0; i < reps; i++) {
      const t0 = performance.now();
      analyzeFile(path, source);
      samples.push(performance.now() - t0);
    }
    results[key] = { ...stats(samples), samples: samples.map((x) => +x.toFixed(2)) };
  };

  warmOne("warm_w1_single_case", "w1_nudo", 30);
  warmOne("warm_w2_two_cases", "w2_nudo", 30);
  warmOne("warm_w5_union5", "w5_nudo", 20);
  warmOne("warm_w3_fns50_cases50", "w3_nudo_50", 10);
  warmOne("warm_w4_callsites40", "w4_nudo_40", 10);

  // warm replay of same file (memo quality): 50 sequential on w1
  {
    const path = files.w1_nudo!;
    const source = readFileSync(path, "utf-8");
    analyzeFile(path, source);
    const samples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      analyzeFile(path, source);
      samples.push(performance.now() - t0);
    }
    results["warm_w1_replay50"] = { ...stats(samples), samples: samples.map((x) => +x.toFixed(2)) };
  }

  return results;
}

async function measureNudoColdImport(files: Record<string, string>) {
  // Fresh process: only measures import + first analyze (not full CLI)
  const script = join(OUT_DIR, "cold_import_worker.mts");
  writeFileSync(
    script,
    `import { analyzeFile } from ${JSON.stringify(join(ROOT, "packages/service/src/index.ts"))};
import { readFileSync } from "node:fs";
const path = process.argv[2]!;
const source = readFileSync(path, "utf-8");
const t0 = performance.now();
analyzeFile(path, source);
console.log(JSON.stringify({ ms: performance.now() - t0 }));
`,
  );
  const path = files.w1_nudo!;
  const reps = 5;
  const samples: number[] = [];
  const total: number[] = [];
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    const r = run(TSX, [script, path]);
    total.push(performance.now() - t0);
    if (r.status === 0) {
      const j = JSON.parse(r.stdout.trim().split("\n").pop()!);
      samples.push(j.ms);
    }
  }
  return {
    first_analyze_ms: stats(samples),
    process_total_ms: stats(total),
  };
}

// ---------------------------------------------------------------------------
// tsc
// ---------------------------------------------------------------------------

function measureTsc(file: string, reps = 5, extraArgs: string[] = []) {
  const samples: number[] = [];
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    const r = run(process.execPath, [
      TSC,
      "--noEmit",
      "--strict",
      "--target",
      "es2022",
      "--module",
      "esnext",
      "--moduleResolution",
      "bundler",
      ...extraArgs,
      file,
    ]);
    samples.push(performance.now() - t0);
    if (r.status !== 0 && i === 0 && samples.length === 1) {
      return { ...stats(samples), error: (r.stdout + r.stderr).slice(0, 300) };
    }
  }
  return stats(samples);
}

/**
 * Fair in-process tsc: LanguageService / createProgram — same "analysis only"
 * framing as Nudo analyzeFile. Skips CLI process and most stdlib work via skipLibCheck
 * + no lib DOM by default (target ES2022 still pulls lib.es*.d.ts from typescript package).
 */
function checkFileInProcess(fileName: string, source: string): { ms: number; diagnostics: number } {
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    // Avoid pulling full default lib set when possible — still needs ES2022 libs.
    lib: ["lib.es2022.d.ts"],
    types: [],
  };
  const host = ts.createCompilerHost(options, true);
  const orig = host.getSourceFile.bind(host);
  host.getSourceFile = (fn, lang, onErr, create) => {
    if (fn === fileName || fn.endsWith(fileName)) {
      return ts.createSourceFile(fn, source, lang, true);
    }
    return orig(fn, lang, onErr, create);
  };
  host.fileExists = (fn) => fn === fileName || existsSync(fn);
  host.readFile = (fn) => (fn === fileName ? source : readFileSync(fn, "utf-8"));

  const t0 = performance.now();
  const program = ts.createProgram([fileName], options, host);
  const diags = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
  ];
  const ms = performance.now() - t0;
  return { ms, diagnostics: diags.length };
}

function measureTscApiInProcess(
  files: Record<string, string>,
  key: string,
  pathKey: string,
  reps = 15,
) {
  const path = files[pathKey]!;
  const source = readFileSync(path, "utf-8");
  // warmup
  checkFileInProcess(path, source);
  const samples: number[] = [];
  for (let i = 0; i < reps; i++) {
    samples.push(checkFileInProcess(path, source).ms);
  }
  return { ...stats(samples), samples: samples.map((x) => +x.toFixed(2)) };
}

function measureTscIncremental(projectDir: string, entry: string, reps = 5) {
  // Full project check with incremental; first cold, then warm rebuild
  const tsconfig = join(projectDir, "tsconfig.json");
  writeFileSync(
    tsconfig,
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: "es2022",
          module: "esnext",
          moduleResolution: "bundler",
          noEmit: true,
          incremental: true,
          tsBuildInfoFile: join(projectDir, ".tsbuildinfo"),
          skipLibCheck: true,
        },
        include: ["*.ts"],
      },
      null,
      2,
    ),
  );
  const buildinfo = join(projectDir, ".tsbuildinfo");
  if (existsSync(buildinfo)) rmSync(buildinfo);

  const cold: number[] = [];
  const warm: number[] = [];
  for (let i = 0; i < reps; i++) {
    if (existsSync(buildinfo)) rmSync(buildinfo);
    const t0 = performance.now();
    run(process.execPath, [TSC, "-p", projectDir]);
    cold.push(performance.now() - t0);
    const t1 = performance.now();
    run(process.execPath, [TSC, "-p", projectDir]);
    warm.push(performance.now() - t1);
  }
  return { cold: stats(cold), warm_incremental: stats(warm) };
}

/** Scaling curve: N functions × 1 case, Nudo warm vs tsc API in-process */
async function measureScaling() {
  const analyzeFile = (await loadAnalyze()) as (p: string, s: string) => unknown;
  const sizes = [10, 50, 200, 400];
  const rows: Array<Record<string, unknown>> = [];

  for (const n of sizes) {
    const nudoSrc = w3Nudo(n);
    const tscSrc = w3Tsc(n);
    const nudoPath = join(OUT_DIR, `scale_nudo_${n}.js`);
    const tscPath = join(OUT_DIR, `scale_tsc_${n}.ts`);
    writeFileSync(nudoPath, nudoSrc);
    writeFileSync(tscPath, tscSrc);

    // nudo warm
    analyzeFile(nudoPath, nudoSrc);
    const nudoSamples: number[] = [];
    const reps = n >= 200 ? 5 : 10;
    for (let i = 0; i < reps; i++) {
      const t0 = performance.now();
      analyzeFile(nudoPath, nudoSrc);
      nudoSamples.push(performance.now() - t0);
    }

    // tsc API in-process
    checkFileInProcess(tscPath, tscSrc);
    const tscSamples: number[] = [];
    for (let i = 0; i < reps; i++) {
      tscSamples.push(checkFileInProcess(tscPath, tscSrc).ms);
    }

    rows.push({
      n_fns: n,
      nudo_warm: stats(nudoSamples),
      tsc_api: stats(tscSamples),
      ratio_nudo_over_tsc: +(median(nudoSamples) / median(tscSamples)).toFixed(3),
    });
  }

  // callsite scaling
  const csRows: Array<Record<string, unknown>> = [];
  for (const sites of [10, 40, 80, 160]) {
    const nudoSrc = w4Nudo(sites);
    const tscSrc = w4Tsc(sites);
    const nudoPath = join(OUT_DIR, `cs_nudo_${sites}.js`);
    const tscPath = join(OUT_DIR, `cs_tsc_${sites}.ts`);
    writeFileSync(nudoPath, nudoSrc);
    writeFileSync(tscPath, tscSrc);

    analyzeFile(nudoPath, nudoSrc);
    const nudoSamples: number[] = [];
    const reps = sites >= 80 ? 5 : 10;
    for (let i = 0; i < reps; i++) {
      const t0 = performance.now();
      analyzeFile(nudoPath, nudoSrc);
      nudoSamples.push(performance.now() - t0);
    }
    checkFileInProcess(tscPath, tscSrc);
    const tscSamples: number[] = [];
    for (let i = 0; i < reps; i++) {
      tscSamples.push(checkFileInProcess(tscPath, tscSrc).ms);
    }
    csRows.push({
      call_sites: sites,
      nudo_warm: stats(nudoSamples),
      tsc_api: stats(tscSamples),
      ratio_nudo_over_tsc: +(median(nudoSamples) / median(tscSamples)).toFixed(3),
    });
  }

  return { by_fn_count: rows, by_callsites: csRows };
}

async function measureCheckWarm(files: Record<string, string>) {
  const { checkSource, pTrue, resetCheckSourceMemo } = await import(
    "../../packages/core/src/index.ts"
  );
  const { defaultLoadModule } = await import("../../packages/service/src/load-module.ts");
  const path = files.w3_nudo_50!;
  const source = readFileSync(path, "utf-8");
  const opts = { loadModule: defaultLoadModule, fromFile: path };

  resetCheckSourceMemo();
  const t0 = performance.now();
  checkSource(path, source, pTrue, opts);
  const cold = performance.now() - t0;

  const samples: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    checkSource(path, source, pTrue, opts);
    samples.push(performance.now() - t);
  }

  const cmdPath = join(ROOT, "node_modules/commander/lib/command.js");
  let commander: Record<string, unknown> | undefined;
  try {
    const cmdSrc = readFileSync(cmdPath, "utf-8");
    resetCheckSourceMemo();
    const tc = performance.now();
    checkSource(cmdPath, cmdSrc, pTrue, { loadModule: defaultLoadModule, fromFile: cmdPath });
    const cmdCold = performance.now() - tc;
    const cmdWarm: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      checkSource(cmdPath, cmdSrc, pTrue, { loadModule: defaultLoadModule, fromFile: cmdPath });
      cmdWarm.push(performance.now() - t);
    }
    commander = { cold_ms: +cmdCold.toFixed(1), warm: stats(cmdWarm) };
  } catch {
    /* commander not installed */
  }

  return {
    w3_50_cold_ms: +cold.toFixed(1),
    w3_50_warm: stats(samples),
    ...(commander ? { commander } : {}),
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Nudo vs tsc micro-benchmark");
  console.log("root:", ROOT);
  const files = writeFixtures();

  const report: Record<string, unknown> = {
    meta: {
      node: process.version,
      typescript: ts.version,
      cwd: ROOT,
      at: new Date().toISOString(),
    },
  };

  // --- cold spawn: empty-ish node / tsx / full CLI ---
  console.log("\n[cold]");
  const coldTsxHello = timeSpawn(TSX, ["-e", "console.log(1)"], 5, "cold_tsx_empty");
  const coldCliW1 = timeSpawn(TSX, [CLI, "infer", files.w1_nudo!], 5, "cold_cli_infer_w1");
  const coldCliW3 = timeSpawn(TSX, [CLI, "infer", files.w3_nudo_50!], 3, "cold_cli_infer_w3_50");
  report["cold"] = {
    tsx_empty: stats(coldTsxHello.map((s) => s.ms)),
    cli_infer_w1: stats(coldCliW1.map((s) => s.ms)),
    cli_infer_w3_50: stats(coldCliW3.map((s) => s.ms)),
    notes: coldCliW1[0]?.note ?? coldCliW3[0]?.note,
  };

  // --- cold import + first analyze ---
  console.log("[cold import]");
  report["nudo_cold_import"] = await measureNudoColdImport(files);

  // --- warm in-process ---
  console.log("[warm nudo]");
  report["nudo_warm"] = await measureNudoWarm(files);

  console.log("[warm checkSource]");
  report["nudo_check_warm"] = await measureCheckWarm(files);

  // --- tsc ---
  console.log("[tsc cli]");
  report["tsc"] = {
    w1: measureTsc(files.w1_tsc!, 5),
    w2: measureTsc(files.w2_tsc!, 5),
    w5: measureTsc(files.w5_tsc!, 5),
    w3_50: measureTsc(files.w3_tsc_50!, 5),
    w4_40: measureTsc(files.w4_tsc_40!, 5),
    w3_project_incremental: measureTscIncremental(OUT_DIR, files.w3_tsc_50!, 3),
  };

  console.log("[tsc api in-process]");
  report["tsc_api_warm"] = {
    w1: measureTscApiInProcess(files, "w1", "w1_tsc", 20),
    w2: measureTscApiInProcess(files, "w2", "w2_tsc", 20),
    w5: measureTscApiInProcess(files, "w5", "w5_tsc", 15),
    w3_50: measureTscApiInProcess(files, "w3", "w3_tsc_50", 10),
    w4_40: measureTscApiInProcess(files, "w4", "w4_tsc_40", 10),
  };

  console.log("[scaling]");
  report["scaling"] = await measureScaling();

  const outPath = join(OUT_DIR, `micro-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  printSummary(report);
  console.log("\nWrote", outPath);
}

function fmt(s: { median: number; min: number; max: number; n: number } | undefined) {
  if (!s) return "n/a";
  return `med ${s.median}ms  (min ${s.min} / max ${s.max}, n=${s.n})`;
}

function printSummary(r: Record<string, any>) {
  console.log("\n" + "=".repeat(64));
  console.log("SUMMARY (median unless noted)");
  console.log("=".repeat(64));

  console.log("\n— Cold (process spawn) —");
  console.log("  tsx empty          ", fmt(r.cold.tsx_empty));
  console.log("  CLI infer w1       ", fmt(r.cold.cli_infer_w1));
  console.log("  CLI infer w3×50    ", fmt(r.cold.cli_infer_w3_50));

  console.log("\n— Cold import (process + first analyze w1) —");
  console.log("  process total      ", fmt(r.nudo_cold_import.process_total_ms));
  console.log("  first analyze only ", fmt(r.nudo_cold_import.first_analyze_ms));

  console.log("\n— Nudo warm (in-process analyzeFile) —");
  for (const [k, v] of Object.entries(r.nudo_warm)) {
    console.log(" ", k.padEnd(22), fmt(v as any));
  }

  console.log("\n— checkSource warm (whole-file memo) —");
  const cw = r.nudo_check_warm;
  if (cw) {
    console.log("  w3x50 cold           ", cw.w3_50_cold_ms, "ms");
    console.log("  w3x50 warm           ", fmt(cw.w3_50_warm));
    if (cw.commander) {
      console.log("  commander cold       ", cw.commander.cold_ms, "ms");
      console.log("  commander warm       ", fmt(cw.commander.warm));
    }
  }

  console.log("\n— tsc CLI --noEmit (fresh process each rep; dominated by compiler load) —");
  for (const k of ["w1", "w2", "w5", "w3_50", "w4_40"] as const) {
    const v = r.tsc[k];
    console.log(" ", k.padEnd(22), fmt(v), v?.error ? `ERR ${v.error}` : "");
  }
  const inc = r.tsc.w3_project_incremental;
  console.log("  w3 project cold    ", fmt(inc.cold));
  console.log("  w3 project warm    ", fmt(inc.warm_incremental));

  console.log("\n— tsc API in-process (fair vs analyzeFile) —");
  for (const [k, v] of Object.entries(r.tsc_api_warm)) {
    console.log(" ", k.padEnd(22), fmt(v as any));
  }

  console.log("\n— Scaling by function count —");
  console.log(
    "  N".padStart(5),
    "nudo_warm".padStart(12),
    "tsc_api".padStart(12),
    "nudo/tsc".padStart(10),
  );
  for (const row of r.scaling.by_fn_count) {
    console.log(
      String(row.n_fns).padStart(5),
      String(row.nudo_warm.median + "ms").padStart(12),
      String(row.tsc_api.median + "ms").padStart(12),
      String(row.ratio_nudo_over_tsc + "x").padStart(10),
    );
  }
  console.log("\n— Scaling by call sites (polyvariant) —");
  console.log(
    "  sites".padStart(7),
    "nudo_warm".padStart(12),
    "tsc_api".padStart(12),
    "nudo/tsc".padStart(10),
  );
  for (const row of r.scaling.by_callsites) {
    console.log(
      String(row.call_sites).padStart(7),
      String(row.nudo_warm.median + "ms").padStart(12),
      String(row.tsc_api.median + "ms").padStart(12),
      String(row.ratio_nudo_over_tsc + "x").padStart(10),
    );
  }

  console.log("\n— Ratio hints (warm, apples-to-apples) —");
  const pairs: Array<[string, any, any]> = [
    ["w1", r.nudo_warm.warm_w1_single_case, r.tsc_api_warm.w1],
    ["w2", r.nudo_warm.warm_w2_two_cases, r.tsc_api_warm.w2],
    ["w5", r.nudo_warm.warm_w5_union5, r.tsc_api_warm.w5],
    ["w3x50", r.nudo_warm.warm_w3_fns50_cases50, r.tsc_api_warm.w3_50],
    ["w4x40", r.nudo_warm.warm_w4_callsites40, r.tsc_api_warm.w4_40],
  ];
  for (const [name, n, t] of pairs) {
    if (n?.median && t?.median) {
      console.log(`  ${name.padEnd(8)} nudo ${String(n.median).padStart(8)}ms  tsc ${String(t.median).padStart(8)}ms  →  nudo/tsc = ${(n.median / t.median).toFixed(3)}x`);
    }
  }
  const coldCli = r.cold.cli_infer_w1?.median;
  const warm1 = r.nudo_warm.warm_w1_single_case?.median;
  if (coldCli && warm1) {
    console.log(`  cold CLI / warm analyze = ${(coldCli / warm1).toFixed(0)}x  (spawn+import dominates)`);
  }
  const tscCli = r.tsc.w1?.median;
  const tscApi = r.tsc_api_warm.w1?.median;
  if (tscCli && tscApi) {
    console.log(`  tsc CLI / tsc API w1    = ${(tscCli / tscApi).toFixed(0)}x  (compiler process load dominates)`);
  }
}

await main();
