/**
 * After-edit path: tiny source change → full Nudo re-analyze vs tsc LS invalidated.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import ts from "typescript";
import { writeFixtures, OUT_DIR, w3Nudo, w3Tsc } from "./fixtures.mjs";

const ROOT = join(import.meta.dirname, "..", "..");

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return {
    n: xs.length,
    median: +(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2).toFixed(2),
    min: +Math.min(...xs).toFixed(2),
  };
}

function makeLSMut(fileName: string, source: string) {
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
  let current = source;
  let version = 0;
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [fileName],
    getScriptVersion: () => String(version),
    getScriptSnapshot: (fn) => {
      if (fn === fileName) return ts.ScriptSnapshot.fromString(current);
      if (!existsSync(fn)) return undefined;
      return ts.ScriptSnapshot.fromString(readFileSync(fn, "utf-8"));
    },
    getCurrentDirectory: () => ROOT,
    getCompilationSettings: () => options,
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (fn) => fn === fileName || existsSync(fn),
    readFile: (fn) => (fn === fileName ? current : readFileSync(fn, "utf-8")),
    readDirectory: () => [],
  };
  const ls = ts.createLanguageService(host, ts.createDocumentRegistry());
  ls.getSemanticDiagnostics(fileName);
  return {
    checkAfterEdit: (next: string) => {
      current = next;
      version++;
      const t0 = performance.now();
      const diags = [
        ...ls.getSyntacticDiagnostics(fileName),
        ...ls.getSemanticDiagnostics(fileName),
      ];
      return { ms: performance.now() - t0, diagnostics: diags.length };
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

  const cases: Array<[string, string, string]> = [
    ["w1", files.w1_nudo!, files.w1_tsc!],
    ["w3x50", files.w3_nudo_50!, files.w3_tsc_50!],
  ];
  // add scale fixtures
  for (const n of [200, 400]) {
    writeFileSync(join(OUT_DIR, `scale_nudo_${n}.js`), w3Nudo(n));
    writeFileSync(join(OUT_DIR, `scale_tsc_${n}.ts`), w3Tsc(n));
    cases.push([
      `scale${n}`,
      join(OUT_DIR, `scale_nudo_${n}.js`),
      join(OUT_DIR, `scale_tsc_${n}.ts`),
    ]);
  }

  console.log("after tiny edit (1 space appended)");
  console.log("label     nudo.analyze  nudo.check   tsc.LS!    an/LS!");
  for (const [label, nudoPath, tscPath] of cases) {
    const base = readFileSync(nudoPath, "utf-8");
    const tscBase = readFileSync(tscPath, "utf-8");
    const reps = label.startsWith("scale4") || label.startsWith("w3") ? 8 : 15;

    clearBPathCache();
    clearAnalysisFileCache();
    analyzeFile(nudoPath, base);
    resetCheckSourceMemo();
    checkSource(nudoPath, base, pTrue, { loadModule: defaultLoadModule, fromFile: nudoPath });

    const nudoAn: number[] = [];
    const nudoChk: number[] = [];
    for (let i = 0; i < reps; i++) {
      const edited = base + `\n// t${i}\n`;
      let t = performance.now();
      analyzeFile(nudoPath, edited);
      nudoAn.push(performance.now() - t);
      t = performance.now();
      checkSource(nudoPath, edited, pTrue, { loadModule: defaultLoadModule, fromFile: nudoPath });
      nudoChk.push(performance.now() - t);
    }

    const ls = makeLSMut(tscPath, tscBase);
    const tscInv: number[] = [];
    for (let i = 0; i < Math.min(reps, 8); i++) {
      tscInv.push(ls.checkAfterEdit(tscBase + `\n// t${i}\n`).ms);
    }

    const na = stats(nudoAn);
    const nc = stats(nudoChk);
    const tl = stats(tscInv);
    console.log(
      label.padEnd(10),
      String(na.median).padStart(10),
      String(nc.median).padStart(11),
      String(tl.median).padStart(10),
      (na.median / Math.max(tl.median, 0.01)).toFixed(3).padStart(8) + "x",
    );
  }

  // command.js after edit
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
    let current = cmdSrc;
    let ver = 0;
    const host: ts.LanguageServiceHost = {
      getScriptFileNames: () => [copy],
      getScriptVersion: () => String(ver),
      getScriptSnapshot: (fn) => {
        if (fn === copy) return ts.ScriptSnapshot.fromString(current);
        if (!existsSync(fn)) return undefined;
        return ts.ScriptSnapshot.fromString(readFileSync(fn, "utf-8"));
      },
      getCurrentDirectory: () => ROOT,
      getCompilationSettings: () => options,
      getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
      fileExists: (fn) => fn === copy || existsSync(fn),
      readFile: (fn) => (fn === copy ? current : readFileSync(fn, "utf-8")),
      readDirectory: () => [],
    };
    const ls = ts.createLanguageService(host, ts.createDocumentRegistry());
    ls.getSemanticDiagnostics(copy);
    const tscInv: number[] = [];
    for (let i = 0; i < 5; i++) {
      current = cmdSrc + `\n// t${i}\n`;
      ver++;
      const t = performance.now();
      ls.getSemanticDiagnostics(copy);
      tscInv.push(performance.now() - t);
    }

    clearAnalysisFileCache();
    clearBPathCache();
    analyzeFile(cmdPath, cmdSrc);
    resetCheckSourceMemo();
    checkSource(cmdPath, cmdSrc, pTrue, { loadModule: defaultLoadModule, fromFile: cmdPath });
    const nudoAn: number[] = [];
    const nudoChk: number[] = [];
    for (let i = 0; i < 5; i++) {
      const edited = cmdSrc + `\n// t${i}\n`;
      let t = performance.now();
      analyzeFile(cmdPath, edited);
      nudoAn.push(performance.now() - t);
      t = performance.now();
      checkSource(cmdPath, edited, pTrue, { loadModule: defaultLoadModule, fromFile: cmdPath });
      nudoChk.push(performance.now() - t);
    }
    console.log("\ncommand.js after edit");
    console.log("  nudo analyze", stats(nudoAn), "check", stats(nudoChk));
    console.log("  tsc LS!    ", stats(tscInv));
  }
}

await main();
