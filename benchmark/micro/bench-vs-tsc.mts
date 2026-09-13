/**
 * Apples-to-apples: Nudo warm (analyzeFile / checkSource) vs tsc.
 *
 * tsc 三种口径：
 *  - createProgram 每次新建（CLI/API 一次性）
 *  - LanguageService 同内容缓存查询（buffer 未改）
 *  - LanguageService version bump 强制重检（编辑后）
 *
 * Run: npx tsx benchmark/micro/bench-vs-tsc.mts
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import ts from "typescript";
import { writeFixtures, OUT_DIR, w3Nudo, w3Tsc } from "./fixtures.mjs";

const ROOT = join(import.meta.dirname, "..", "..");

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function stats(samples: number[]) {
  return {
    n: samples.length,
    median: +median(samples).toFixed(3),
    min: +Math.min(...samples).toFixed(3),
    max: +Math.max(...samples).toFixed(3),
  };
}

function checkFileInProcess(fileName: string, source: string): { ms: number; diagnostics: number } {
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
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
  const diags = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];
  return { ms: performance.now() - t0, diagnostics: diags.length };
}

function makeLS(fileName: string, source: string) {
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    lib: ["lib.es2022.d.ts"],
    types: [],
  };
  let version = 0;
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [fileName],
    getScriptVersion: () => String(version),
    getScriptSnapshot: (fn) => {
      if (fn === fileName) return ts.ScriptSnapshot.fromString(source);
      if (!existsSync(fn)) return undefined;
      return ts.ScriptSnapshot.fromString(readFileSync(fn, "utf-8"));
    },
    getCurrentDirectory: () => ROOT,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (fn) => fn === fileName || existsSync(fn),
    readFile: (fn) => (fn === fileName ? source : readFileSync(fn, "utf-8")),
    readDirectory: () => [],
  };
  const ls = ts.createLanguageService(host, ts.createDocumentRegistry());
  const run = () => {
    const t0 = performance.now();
    const diags = [
      ...ls.getSyntacticDiagnostics(fileName),
      ...ls.getSemanticDiagnostics(fileName),
    ];
    return { ms: performance.now() - t0, diagnostics: diags.length };
  };
  return {
    checkCached: run,
    checkInvalidated: () => {
      version++;
      return run();
    },
  };
}

async function main() {
  const files = writeFixtures();
  const { analyzeFile, clearBPathCache, clearAnalysisFileCache } = await import(
    join(ROOT, "packages/service/src/index.ts")
  );
  const { checkSource, pTrue, resetCheckSourceMemo } = await import(
    join(ROOT, "packages/core/src/index.ts")
  );
  const { defaultLoadModule } = await import(join(ROOT, "packages/service/src/load-module.ts"));

  const rows: Array<Record<string, unknown>> = [];
  const fixtures: Array<[string, string, string]> = [
    ["w1", files.w1_nudo!, files.w1_tsc!],
    ["w2", files.w2_nudo!, files.w2_tsc!],
    ["w5", files.w5_nudo!, files.w5_tsc!],
    ["w3x50", files.w3_nudo_50!, files.w3_tsc_50!],
    ["w4x40", files.w4_nudo_40!, files.w4_tsc_40!],
  ];

  console.log("fixture  nudo.an   nudo.chk  tsc.LS$   tsc.LS!   tsc.prog   an/LS!   an/prog");
  for (const [label, nudoPath, tscPath] of fixtures) {
    const nudoSrc = readFileSync(nudoPath, "utf-8");
    const tscSrc = readFileSync(tscPath, "utf-8");
    const reps = label.startsWith("w3") || label.startsWith("w4") ? 10 : 20;

    clearBPathCache();
    clearAnalysisFileCache();
    analyzeFile(nudoPath, nudoSrc);
    const nudoAnalyze: number[] = [];
    for (let i = 0; i < reps; i++) {
      const t = performance.now();
      analyzeFile(nudoPath, nudoSrc);
      nudoAnalyze.push(performance.now() - t);
    }

    resetCheckSourceMemo();
    checkSource(nudoPath, nudoSrc, pTrue, { loadModule: defaultLoadModule, fromFile: nudoPath });
    const nudoCheck: number[] = [];
    for (let i = 0; i < reps; i++) {
      const t = performance.now();
      checkSource(nudoPath, nudoSrc, pTrue, { loadModule: defaultLoadModule, fromFile: nudoPath });
      nudoCheck.push(performance.now() - t);
    }

    checkFileInProcess(tscPath, tscSrc);
    const tscApi: number[] = [];
    for (let i = 0; i < Math.min(reps, 8); i++) {
      tscApi.push(checkFileInProcess(tscPath, tscSrc).ms);
    }

    const ls = makeLS(tscPath, tscSrc);
    ls.checkCached();
    const tscLsCached: number[] = [];
    for (let i = 0; i < reps; i++) tscLsCached.push(ls.checkCached().ms);
    const tscLsInv: number[] = [];
    for (let i = 0; i < Math.min(reps, 8); i++) tscLsInv.push(ls.checkInvalidated().ms);

    const na = stats(nudoAnalyze);
    const nc = stats(nudoCheck);
    const ta = stats(tscApi);
    const tlc = stats(tscLsCached);
    const tli = stats(tscLsInv);
    rows.push({
      label,
      nudo_analyze_warm: na,
      nudo_check_warm: nc,
      tsc_createProgram: ta,
      tsc_ls_cached: tlc,
      tsc_ls_invalidated: tli,
      ratio_analyze_vs_ls_inv: +(na.median / Math.max(tli.median, 0.001)).toFixed(4),
      ratio_analyze_vs_program: +(na.median / ta.median).toFixed(4),
    });
    console.log(
      label.padEnd(8),
      String(na.median).padStart(7),
      String(nc.median).padStart(9),
      String(tlc.median).padStart(9),
      String(tli.median).padStart(9),
      String(ta.median).padStart(9),
      (na.median / Math.max(tli.median, 0.001)).toFixed(3).padStart(8) + "x",
      (na.median / ta.median).toFixed(4).padStart(8) + "x",
    );
  }

  console.log("\nscaling by fn count");
  console.log("   N    nudo.warm   tsc.LS$    tsc.LS!   tsc.prog    an/LS!");
  const scaleRows: Array<Record<string, unknown>> = [];
  for (const n of [50, 200, 400]) {
    const nudoSrc = w3Nudo(n);
    const tscSrc = w3Tsc(n);
    const nudoPath = join(OUT_DIR, `scale_nudo_${n}.js`);
    const tscPath = join(OUT_DIR, `scale_tsc_${n}.ts`);
    writeFileSync(nudoPath, nudoSrc);
    writeFileSync(tscPath, tscSrc);
    const reps = n >= 200 ? 5 : 10;

    clearBPathCache();
    clearAnalysisFileCache();
    analyzeFile(nudoPath, nudoSrc);
    const nudoSamples: number[] = [];
    for (let i = 0; i < reps; i++) {
      const t = performance.now();
      analyzeFile(nudoPath, nudoSrc);
      nudoSamples.push(performance.now() - t);
    }

    const ls = makeLS(tscPath, tscSrc);
    ls.checkCached();
    const lsCached: number[] = [];
    const lsInv: number[] = [];
    for (let i = 0; i < reps; i++) lsCached.push(ls.checkCached().ms);
    for (let i = 0; i < Math.min(reps, 5); i++) lsInv.push(ls.checkInvalidated().ms);

    checkFileInProcess(tscPath, tscSrc);
    const progSamples: number[] = [];
    for (let i = 0; i < Math.min(reps, 5); i++) {
      progSamples.push(checkFileInProcess(tscPath, tscSrc).ms);
    }

    const row = {
      n,
      nudo_warm: stats(nudoSamples),
      tsc_ls_cached: stats(lsCached),
      tsc_ls_invalidated: stats(lsInv),
      tsc_program: stats(progSamples),
      ratio_vs_ls_inv: +(median(nudoSamples) / Math.max(median(lsInv), 0.001)).toFixed(4),
    };
    scaleRows.push(row);
    console.log(
      String(n).padStart(4),
      String(row.nudo_warm.median).padStart(10),
      String(row.tsc_ls_cached.median).padStart(10),
      String(row.tsc_ls_invalidated.median).padStart(10),
      String(row.tsc_program.median).padStart(10),
      (row.ratio_vs_ls_inv + "x").padStart(10),
    );
  }

  {
    const cmdPath = join(ROOT, "node_modules/commander/lib/command.js");
    const cmdSrc = readFileSync(cmdPath, "utf-8");
    const copy = join(OUT_DIR, "command_copy.js");
    writeFileSync(copy, cmdSrc);
    const options: ts.CompilerOptions = {
      allowJs: true,
      checkJs: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
    };
    const host = ts.createCompilerHost(options, true);
    const t0 = performance.now();
    const program = ts.createProgram([copy], options, host);
    program.getSemanticDiagnostics();
    const tscCmd = performance.now() - t0;

    // tsc LS on the js copy
    let ver = 0;
    const lsHost: ts.LanguageServiceHost = {
      getScriptFileNames: () => [copy],
      getScriptVersion: () => String(ver),
      getScriptSnapshot: (fn) => {
        if (fn === copy) return ts.ScriptSnapshot.fromString(cmdSrc);
        if (!existsSync(fn)) return undefined;
        return ts.ScriptSnapshot.fromString(readFileSync(fn, "utf-8"));
      },
      getCurrentDirectory: () => ROOT,
      getCompilationSettings: () => options,
      getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
      fileExists: (fn) => fn === copy || existsSync(fn),
      readFile: (fn) => (fn === copy ? cmdSrc : readFileSync(fn, "utf-8")),
      readDirectory: () => [],
    };
    const cmdLs = ts.createLanguageService(lsHost, ts.createDocumentRegistry());
    cmdLs.getSemanticDiagnostics(copy);
    const cmdLsInv: number[] = [];
    for (let i = 0; i < 5; i++) {
      ver++;
      const t = performance.now();
      cmdLs.getSemanticDiagnostics(copy);
      cmdLsInv.push(performance.now() - t);
    }

    clearAnalysisFileCache();
    clearBPathCache();
    const t1 = performance.now();
    analyzeFile(cmdPath, cmdSrc);
    const nudoCold = performance.now() - t1;
    const nudoAn: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t = performance.now();
      analyzeFile(cmdPath, cmdSrc);
      nudoAn.push(performance.now() - t);
    }
    resetCheckSourceMemo();
    checkSource(cmdPath, cmdSrc, pTrue, { loadModule: defaultLoadModule, fromFile: cmdPath });
    const nudoChk: number[] = [];
    for (let i = 0; i < 10; i++) {
      const t = performance.now();
      checkSource(cmdPath, cmdSrc, pTrue, { loadModule: defaultLoadModule, fromFile: cmdPath });
      nudoChk.push(performance.now() - t);
    }

    console.log("\ncommander/lib/command.js (real package)");
    console.log("  nudo analyze warm ", stats(nudoAn).median, "ms  (cold", nudoCold.toFixed(1) + ")");
    console.log("  nudo check warm   ", stats(nudoChk).median, "ms");
    console.log("  tsc program+check ", tscCmd.toFixed(1), "ms");
    console.log("  tsc LS invalidated", stats(cmdLsInv).median, "ms");
    console.log(
      "  → nudo.an / tsc.LS! =",
      (stats(nudoAn).median / Math.max(stats(cmdLsInv).median, 0.001)).toFixed(4) + "x",
    );
    console.log(
      "  → nudo.an / tsc.prog =",
      (stats(nudoAn).median / tscCmd).toFixed(5) + "x",
    );
  }

  writeFileSync(
    join(OUT_DIR, `vs-tsc-${Date.now()}.json`),
    JSON.stringify({ rows, scaleRows }, null, 2),
  );
}

await main();
