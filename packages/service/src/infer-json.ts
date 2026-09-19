/**
 * Case facts JSON（`nudo test --json` / `nudo check --json` 同源序列化）。
 * 曾用名 InferJson v1（`nudo infer --json`）；字段只增不改语义。
 *
 * - args / result / throws / combined：formatShape 外延投影（有损，兼容）
 *   入口无约束参数展示为 any；unknown 仅表示推导失败
 * - intension.abs*：无损 Abs 展示（主线）
 * - argsAbs / resultAbs：CaseResult 上的无损 Abs（formatAbs）；有则补齐
 */

import { formatAbs, formatShape, type Abs } from "@nudojs/core";
import type { AnalysisResult, CaseResult, FunctionAnalysis, SourceLocation } from "./analyzer.ts";

export type InferJsonCase = {
  name: string;
  /** TypeValue 投影（有损外延） */
  args: string[];
  result: string;
  throws: string | null;
  source: string | null;
  aggregatedFrom?: number;
  /** 无损参数 Abs 展示（与 args 对齐；缺失位省略） */
  argsAbs?: string[];
  /** 无损结果 Abs 展示 */
  resultAbs?: string;
  /** 无损内涵（Abs）；无则省略 */
  intension?: {
    display?: string;
    abs?: string;
    absMultiline?: string;
    term?: string;
    pred?: string;
    conf?: string;
  };
};

export type InferJsonFunction = {
  name: string;
  loc: SourceLocation;
  entryOnly: boolean;
  noDeclaration?: boolean;
  cases: InferJsonCase[];
  combined?: string;
  /** 无损 combined Abs 展示 */
  combinedAbs?: string;
};

export type InferJson = {
  version: 1;
  file: string;
  summary: {
    functions: number;
    externalFunctions: number;
    cases: number;
    diagnostics: number;
  };
  functions: InferJsonFunction[];
  externalFunctions?: Array<{
    name: string;
    fromModule?: string;
    cases: InferJsonCase[];
  }>;
  diagnostics: Array<{
    range: SourceLocation;
    severity: string;
    message: string;
    code?: string;
    suggestions?: string[];
    tags?: string[];
    origin?: { line: number; column: number };
  }>;
};

function mapCase(c: CaseResult): InferJsonCase {
  const out: InferJsonCase = {
    name: c.name,
    args: c.argAbs.map((a: Abs) => formatShape(a)),
    result: formatShape(c.abs),
    throws: c.throwsAbs.shape.k !== "never" ? formatShape(c.throwsAbs) : null,
    source: c.source ?? null,
  };
  if (c.aggregatedFrom !== undefined) out.aggregatedFrom = c.aggregatedFrom;
  if (c.argAbs.length > 0) {
    out.argsAbs = c.argAbs.map((a: Abs) => {
      try {
        return formatAbs(a);
      } catch {
        return "unknown";
      }
    });
  }
  try {
    out.resultAbs = formatAbs(c.abs);
  } catch {
    /* skip */
  }
  if (c.intension) {
    const i = c.intension;
    out.intension = {
      ...(i.display !== undefined ? { display: i.display } : {}),
      ...(i.abs !== undefined ? { abs: i.abs } : {}),
      ...(i.absMultiline !== undefined ? { absMultiline: i.absMultiline } : {}),
      ...(i.term !== undefined ? { term: i.term } : {}),
      ...(i.pred !== undefined ? { pred: i.pred } : {}),
      ...(i.conf !== undefined ? { conf: i.conf } : {}),
    };
  }
  return out;
}

function mapFunction(f: FunctionAnalysis): InferJsonFunction {
  const out: InferJsonFunction = {
    name: f.name,
    loc: f.loc,
    entryOnly: f.entryOnly ?? false,
    cases: f.cases.map(mapCase),
  };
  if (f.noDeclaration) out.noDeclaration = true;
  if (f.combinedAbs) {
    out.combined = formatShape(f.combinedAbs);
    try {
      out.combinedAbs = formatAbs(f.combinedAbs);
    } catch {
      /* skip */
    }
  }
  return out;
}

export function serializeInferJson(
  result: AnalysisResult,
  file: string,
): InferJson {
  const functions = result.functions.map(mapFunction);
  const external = result.externalFunctions?.map((f) => ({
    name: f.name,
    fromModule: f.fromModule,
    cases: f.cases.map(mapCase),
  }));
  const caseCount =
    functions.reduce((n, f) => n + f.cases.length, 0) +
    (external ?? []).reduce((n, f) => n + f.cases.length, 0);

  const json: InferJson = {
    version: 1,
    file,
    summary: {
      functions: functions.length,
      externalFunctions: external?.length ?? 0,
      cases: caseCount,
      diagnostics: result.diagnostics.length,
    },
    functions,
    diagnostics: result.diagnostics.map((d) => ({
      range: d.range,
      severity: d.severity,
      message: d.message,
      ...(d.code !== undefined ? { code: d.code } : {}),
      ...(d.suggestions ? { suggestions: d.suggestions } : {}),
      ...(d.tags ? { tags: d.tags } : {}),
      ...(d.origin ? { origin: d.origin } : {}),
    })),
  };
  if (external) json.externalFunctions = external;
  return json;
}
