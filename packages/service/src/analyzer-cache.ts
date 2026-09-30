/**
 * cache 背面：整文件 memo 键（含 dep 指纹）+ 结果克隆/行号平移。
 * 自 analyzer.ts 机械拆出；语义未改。
 */
import { loadModuleDepsFingerprint, hashSource, stableAnalyzeKeySource, stablePathKey } from "@nudojs/core/internal";
import { defaultLoadModule } from "./load-module.ts";
import { absStructureKey, type CallRecord } from "./evaluator/call-record.ts";
import type {
  AnalysisResult,
  AnalyzeLoadModule,
  Diagnostic,
  DirectiveCaseMode,
  FunctionAnalysis,
  SourceLocation,
} from "./analyzer-types.ts";

// --- 整文件 AnalysisResult memo（warm analyzeFile / LSP 重复文档） ---

/**
 * externalCallRecords 内容指纹（与 dep contents 同类：内容变 → miss）。
 * 不用数组身份：CLI `--from` 每次重建数组会让身份键永不命中；
 * 同数组原地改写元素又会让身份键陈旧命中。
 */
function externalRecordsFingerprint(records: CallRecord[]): string {
  const parts = records.map((r) =>
    [
      r.fnName,
      r.targetModule ?? "",
      r.targetExport ?? "",
      (r.targetAliases ?? []).join(","),
      r.fnModule ?? "",
      r.callLoc ? `${r.callLoc.line}:${r.callLoc.column}` : "",
      r.argAbs.map(absStructureKey).join(","),
      absStructureKey(r.resultAbs),
      absStructureKey(r.throwsAbs),
    ].join("\u0001"),
  );
  return hashSource(parts.join("\u0002"));
}

export function analysisFileCacheKey(
  filePath: string,
  source: string,
  activeCases?: Map<string, number>,
  externalCallRecords?: CallRecord[],
  analysisCfg?: {
    mode: string;
    evalMissingSlot: string;
    callSiteBudget: number;
    diagnostics: string;
    /** fork 预算——截断 widen 结果，变更必须 miss */
    maxForks?: number;
  },
  loadModule?: AnalyzeLoadModule,
  projectEnvNames?: string[],
  /** ambient 侧车绑定：变更必须 miss（dep 指纹故意不编码 autoBind） */
  autoBind?: boolean,
  caseMode: DirectiveCaseMode = "all",
): { filePath: string; source: string; auxKey: string; noCache?: boolean } {
  let cases = "-";
  if (activeCases && activeCases.size > 0) {
    cases = [...activeCases.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
  }
  let ext = "-";
  if (externalCallRecords && externalCallRecords.length > 0) {
    ext = `n${externalCallRecords.length}#${externalRecordsFingerprint(externalCallRecords)}`;
  }
  // analysisConfig 维度进键：package.json#nudo.analysis 变更必须 miss
  const cfg = analysisCfg
    ? `m=${analysisCfg.mode}|e=${analysisCfg.evalMissingSlot}|b=${analysisCfg.callSiteBudget}|d=${analysisCfg.diagnostics}|f=${analysisCfg.maxForks ?? "-"}`
    : "-";
  // custom loadModule (e.g. LSP buffer-aware) can produce different analysis
  // than the default disk loader — distinguish in the memo key
  const lm = loadModule !== undefined && loadModule !== defaultLoadModule ? "lm1" : "lm0";
  // project nudo.env 变更必须 miss（fn 级键已有 envNames，文件级对齐）
  const envSeg = projectEnvNames && projectEnvNames.length > 0 ? projectEnvNames.join(",") : "-";
  const abSeg = autoBind === false ? "ab0" : autoBind === true ? "ab1" : "ab?";
  // dep 内容变更（入口 source 未变）也必须 miss——default loader 同样进指纹。
  // 指纹失败/truncated → 禁用共享命中（fail-closed，见 noCache）。
  const effectiveLoader = loadModule ?? defaultLoadModule;
  let depSeg = "-";
  let noCache = false;
  try {
    const fp = loadModuleDepsFingerprint(source, effectiveLoader, filePath);
    if (fp.truncated) {
      noCache = true;
      depSeg = `trunc:${fp.paths.length}`;
    } else {
      // fingerprint is path=hash,… — hash the whole blob so long abs paths still flip
      depSeg = hashSource(fp.fp);
    }
  } catch {
    noCache = true;
    depSeg = "fperr";
  }
  return {
    // 键身份统一 stablePathKey：`/c:/x` 与 `c:/x` 同键（FIX-RESIDUAL-4）。
    // 加载/指纹仍用调用方原 filePath；本字段只作 memo 键。
    filePath: stablePathKey(filePath),
    // 尾部无 @nudo 注释/空行不进键：comment-only 编辑命中 AnalysisResult
    source: stableAnalyzeKeySource(source),
    auxKey: `${cases}\0${ext}\0${cfg}\0${lm}\0${envSeg}\0${abSeg}\0${depSeg}\0cm=${caseMode}`,
    noCache,
  };
}

export function cloneAnalysisResult(r: AnalysisResult): AnalysisResult {
  return {
    functions: r.functions.map(cloneFunctionAnalysis),
    diagnostics: r.diagnostics.map((d) => ({ ...d })),
    bindings: new Map(r.bindings),
    // Node 键与 AST LRU 共享身份；Map 浅拷贝即可
    nodeAbsMap: new Map(r.nodeAbsMap),
    caseHints: r.caseHints.map((h) => ({ ...h })),
    ...(r.externalFunctions
      ? { externalFunctions: r.externalFunctions.map(cloneFunctionAnalysis) }
      : {}),
  };
}

// --- 函数级 FunctionAnalysis 缓存（body-edit：只重算脏函数及其调用者） ---

export function cloneFunctionAnalysis(a: FunctionAnalysis): FunctionAnalysis {
  return {
    ...a,
    paramNames: [...a.paramNames],
    ...(a.formals ? { formals: a.formals.map((f) => ({ ...f })) } : {}),
    cases: a.cases.map((c) => ({
      ...c,
      argAbs: [...c.argAbs],
      ...(c.intension ? { intension: { ...c.intension } } : {}),
    })),
    loc: { start: { ...a.loc.start }, end: { ...a.loc.end } },
    ...(a.hof
      ? {
          hof: {
            ...(a.hof.fnRels ? { fnRels: a.hof.fnRels.map((r) => ({ ...r })) } : {}),
            ...(a.hof.entryShapes
              ? { entryShapes: a.hof.entryShapes.map((s) => ({ ...s })) }
              : {}),
            ...(a.hof.symbolic ? { symbolic: a.hof.symbolic } : {}),
          },
        }
      : {}),
  };
}

export function shiftSourceLoc(loc: SourceLocation, lineDelta: number): SourceLocation {
  return {
    start: { line: loc.start.line + lineDelta, column: loc.start.column },
    end: { line: loc.end.line + lineDelta, column: loc.end.column },
  };
}

export function shiftDiagnosticLines(d: Diagnostic, lineDelta: number): Diagnostic {
  if (lineDelta === 0) return { ...d };
  const out: Diagnostic = { ...d, range: shiftSourceLoc(d.range, lineDelta) };
  if (d.origin) {
    out.origin = { line: d.origin.line + lineDelta, column: d.origin.column };
  }
  return out;
}

export function shiftCallRecordLines(r: CallRecord, lineDelta: number): CallRecord {
  if (lineDelta === 0 || !r.callLoc) return { ...r };
  return {
    ...r,
    callLoc: { line: r.callLoc.line + lineDelta, column: r.callLoc.column },
  };
}
