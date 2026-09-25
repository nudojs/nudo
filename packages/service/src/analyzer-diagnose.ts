/**
 * diagnose 背面：mock 校验 / unreachable 汇总 / 跨文件 call@ 合成 / import loc。
 * 自 analyzer.ts 机械拆出；语义未改。
 */
import type { Node } from "@babel/types";
import type { FunctionWithDirectives } from "@nudojs/parser";
import {
  absStructureKey,
  collapseAbsLits,
  isOversizedCallRecord,
  joinAllAbs,
  undefAbs,
  widenJoinAbs,
  type CallRecord,
} from "./evaluator/call-record.ts";
import type {
  CaseResult,
  Diagnostic,
  FunctionAnalysis,
  SourceLocation,
} from "./analyzer-types.ts";

/** mock 指令静态校验（B hosted 也要报 mock-invalid） */
export function validateMockDirectives(
  directives: FunctionWithDirectives["directives"],
  diagnostics: Diagnostic[],
): void {
  for (const d of directives) {
    if (d.kind !== "mock" || !d.expression) continue;
    // 已被 parser 识别为 arrow / sinon / nudoMock 形态 → 不是无法解析的表达式
    if (d.arrowFn || d.sinonExpr || d.nudoMock) continue;
    const expr = d.expression.trim();
    // constraint builders / literals / structure are valid raw mock RHS
    const isTypeExpr =
      /^(number|string|boolean|any|array|shape|lit|union|fn|partial|pick|omit|record|required|readonly|nonNullable|and)\s*\(/.test(expr) ||
      expr === "unknown" ||
      expr === "any" ||
      expr === "never" ||
      expr === "true" ||
      expr === "false" ||
      expr === "null" ||
      expr === "undefined" ||
      /^-?\d+(\.\d+)?$/.test(expr) ||
      ((expr.startsWith('"') && expr.endsWith('"')) || (expr.startsWith("'") && expr.endsWith("'"))) ||
      expr.startsWith("{") ||
      expr.startsWith("[");
    const looksLikeCall = (expr.includes("(") && expr.includes(")")) || expr.includes("=>");
    if (looksLikeCall && !isTypeExpr) {
      diagnostics.push({
        range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
        severity: "warning",
        message: `Mock expression "${expr}" could not be parsed as a known pattern`,
        code: "nudo:mock-invalid",
        suggestions: [
          "Supported formats: stub(), stub().returns(value), spy(), mock()",
          "Arrow functions: (args) => expression or (args) => { statements; return value; }",
          "Type expressions: number(), string(), shape({...}), union(...), or concrete literals",
        ],
      });
    }
  }
}

export function rangeKey(r: SourceLocation): string {
  return `${r.start.line}:${r.start.column}-${r.end.line}:${r.end.column}`;
}

export function findCommonUnreachable(perCase: SourceLocation[][]): SourceLocation[] {
  if (perCase.length === 0) return [];
  const counts = new Map<string, { count: number; range: SourceLocation }>();
  for (const ranges of perCase) {
    for (const r of ranges) {
      const key = rangeKey(r);
      const existing = counts.get(key);
      if (existing) {
        existing.count++;
      } else {
        counts.set(key, { count: 1, range: r });
      }
    }
  }
  return [...counts.values()]
    .filter((v) => v.count === perCase.length)
    .map((v) => v.range);
}

export const DEFAULT_CALLSITE_BUDGET = 3;
export const COLLAPSE_LITERAL_THRESHOLD = 4;

export function dedupeCallRecords(records: CallRecord[]): CallRecord[] {
  const seen = new Set<string>();
  const out: CallRecord[] = [];
  for (const rec of records) {
    // Abs DAG 共享会指数膨胀树形 key；超大记录在 key 前丢弃。
    if (isOversizedCallRecord(rec)) continue;
    // key 必须含结果形态：同实参形状但不同结果（错误路径 never+throws vs
    // 成功路径 Promise<...>）是不同的 case，只按实参去重会把成功记录吞进
    // 首条错误记录里（parseChunked 的 Promise 记录曾被 L203 的 throw 吞掉）。
    const key =
      rec.argAbs.map(absStructureKey).join(",") +
      "=>" +
      absStructureKey(rec.resultAbs) +
      "!" +
      absStructureKey(rec.throwsAbs);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }
  return out;
}

export function locFromCallLoc(loc: { line: number; column: number } | undefined): SourceLocation {
  const p = loc ?? { line: 0, column: 0 };
  return { start: { line: p.line, column: p.column }, end: { line: p.line, column: p.column } };
}

/**
 * Cross-file call-site aggregation: call records whose callee is a function
 * exported by another module (tagged by the evaluator's export side table)
 * are grouped by (targetModule, targetExport) and synthesized directly into
 * FunctionAnalysis entries — no re-evaluation needed, each CallRecord already
 * carries the resultAbs/throwsAbs computed when this file was evaluated.
 *
 * Named-import direct calls and member calls (`obj.fn` / `Class.method`,
 * including `import * as ns` members via dotted name resolution) reach this
 * synthesis.
 */
export function synthesizeExternalFunctions(
  records: CallRecord[],
  currentFile: string,
  callSiteBudget: number = DEFAULT_CALLSITE_BUDGET,
): FunctionAnalysis[] {
  const groups = new Map<string, { module: string; exportName: string; records: CallRecord[] }>();
  for (const rec of records) {
    if (!rec.targetModule || !rec.targetExport) continue;
    if (rec.targetModule === currentFile) continue;
    const key = `${rec.targetModule}\0${rec.targetExport}`;
    let group = groups.get(key);
    if (!group) {
      group = { module: rec.targetModule, exportName: rec.targetExport, records: [] };
      groups.set(key, group);
    }
    group.records.push(rec);
  }

  const out: FunctionAnalysis[] = [];
  for (const { module, exportName, records } of groups.values()) {
    const deduped = dedupeCallRecords(records);
    const arity = Math.max(...deduped.map((r) => r.argAbs.length));
    const analysis: FunctionAnalysis = {
      name: exportName,
      loc: locFromCallLoc(deduped[0].callLoc),
      paramNames: Array.from({ length: arity }, (_, i) => `arg${i}`),
      cases: [],
      fromModule: module,
    };

    // Same capping as local synthesis: at most budget precise cases.
    // The symbolic aggregate cannot re-evaluate the foreign
    // function (its AST belongs to another file's analysis), so it unions the
    // observed argument/result/throws Abs of the remaining records instead.
    const precise = deduped.slice(0, callSiteBudget);
    for (const rec of precise) {
      analysis.cases.push({
        name: `call@L${rec.callLoc?.line ?? 0}`,
        argAbs: [...rec.argAbs],
        abs: rec.resultAbs,
        throwsAbs: rec.throwsAbs,
        source: "callsite",
      });
    }
    const remaining = deduped.slice(callSiteBudget);
    if (remaining.length > 0) {
      const symArgsAbs = Array.from({ length: arity }, (_, i) =>
        // 缺参按真实 JS 语义 widen 成 undefined 而非 unknown——可选参守卫
        // （target || [] 等）对 unknown 全塌，对 undefined 正常走默认分支
        widenJoinAbs(remaining.map((rec) => rec.argAbs[i] ?? undefAbs)),
      );
      const symResultAbs = collapseAbsLits(
        remaining.map((r) => r.resultAbs),
        COLLAPSE_LITERAL_THRESHOLD,
      );
      const symThrowsAbs = joinAllAbs(remaining.map((r) => r.throwsAbs));
      analysis.cases.push({
        name: "call@symbolic",
        argAbs: symArgsAbs,
        abs: symResultAbs,
        throwsAbs: symThrowsAbs,
        source: "callsite",
        aggregatedFrom: remaining.length,
      });
    }

    if (deduped.length > 1) {
      analysis.combinedAbs = collapseAbsLits(
        deduped.map((r) => r.resultAbs),
        COLLAPSE_LITERAL_THRESHOLD,
      );
    } else {
      analysis.combinedAbs = deduped[0].resultAbs;
    }
    out.push(analysis);
  }
  return out;
}

/** 0-based loc of the first import/require specifier for `module` (or null). */
export function findModuleImportLoc(
  source: string,
  module: string,
): { line: number; column: number; length: number } | null {
  const bare = module.startsWith("node:") ? module.slice("node:".length) : module;
  const alts = [...new Set([module, bare, `node:${bare}`])];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const alt of alts) {
      const re = new RegExp(
        `["'\`]${alt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`,
      );
      const m = re.exec(line);
      if (m && m.index !== undefined) {
        return { line: i, column: m.index, length: m[0].length };
      }
    }
  }
  return null;
}
