/**
 * check 报告/JSON 映射（纯）：缓存重建、诊断码、issue 注入与 summary 聚合。
 */
import type { CheckIssue, CheckJson, CheckReport, NudoSig } from "@nudojs/core";

export function issueFromCachedJson(i: CheckJson["issues"][number]): CheckIssue {
  return {
    severity: i.severity as "error" | "warning" | "info",
    code: i.code,
    message: i.message,
    ...(i.fn !== undefined ? { fn: i.fn } : {}),
    ...(i.line !== undefined ? { line: i.line } : {}),
    ...(i.column !== undefined ? { column: i.column } : {}),
    ...(i.actual !== undefined ? { actual: i.actual } : {}),
    ...(i.expected !== undefined ? { expected: i.expected } : {}),
    ...(i.suggestion !== undefined ? { suggestion: i.suggestion } : {}),
  };
}

export function signatureFromCachedJson(s: CheckJson["signatures"][number]): NudoSig {
  return {
    name: s.name,
    params: s.params,
    ...(s.paramTypes ? { paramTypes: s.paramTypes } : {}),
    // CheckJson abs 是 formatAbs 字符串；重建时不要伪造成 unknown（§2）
    abs: { shape: { k: "any" as const }, conf: s.conf as never },
    display: s.display,
    detail: s.detail,
    conf: s.conf as never,
    ...(s.throws ? { throws: s.throws } : {}),
    ...(s.entry ? { entry: true } : {}),
  };
}

export function reportFromCachedJson(cached: CheckJson): CheckReport {
  return {
    file: cached.file,
    issues: cached.issues.map(issueFromCachedJson),
    ok: cached.ok,
    signatures: cached.signatures.map(signatureFromCachedJson),
    summary: { ...cached.summary },
  };
}

/** 诊断 → 文档深链：问题码 → reference/diagnostics.md 锚点 id 列表 */
export function docsDiagnosticCodes(issues: Array<{ code?: string }>): string[] {
  return [
    ...new Set(
      issues
        .map((i) => i.code)
        .filter((c): c is string => !!c && /^nudo[\w:-]+$/.test(c)),
    ),
  ];
}

export function mockFromErrorIssues(
  mockFromErrors: Array<{ name: string; fromPath: string; message: string }>,
): CheckIssue[] {
  return mockFromErrors.map((fe) => ({
    severity: "error" as const,
    code: "nudo:module-missing" as const,
    message: fe.message,
    suggestion: `Create the mock file or fix the path in @nudo:mock ${fe.name} from "${fe.fromPath}"`,
  }));
}

export type DomainDiagnosticLike = {
  code?: string;
  severity: string;
  message: string;
  range: { start: { line: number; column: number } };
  data?: unknown;
  suggestions?: string[];
};

export function domainIssuesFromDiagnostics(
  diagnostics: readonly DomainDiagnosticLike[],
): CheckIssue[] {
  return diagnostics
    .filter((d) => d.code === "nudo:interface-domain-exceeds")
    .map((d) => {
      const data = (d.data ?? {}) as { actual?: unknown; expected?: unknown };
      return {
        severity: d.severity === "error" ? ("error" as const) : ("warning" as const),
        code: "nudo:interface-domain-exceeds" as const,
        message: d.message,
        line: d.range.start.line,
        column: d.range.start.column,
        actual: typeof data.actual === "string" ? data.actual : undefined,
        expected: typeof data.expected === "string" ? data.expected : undefined,
        suggestion: d.suggestions?.[0],
      };
    });
}

export function dualEntryIssue(dual: {
  message: string;
  line?: number;
  column?: number;
  suggestion?: string;
}): CheckIssue {
  return {
    severity: "info",
    code: "nudo:dual-entry",
    message: dual.message,
    line: dual.line,
    column: dual.column,
    suggestion: dual.suggestion,
  };
}

type Summarized = {
  issues: CheckIssue[];
  ok: boolean;
  summary: { errors: number; warnings: number; infos: number; functions: number };
};

/** 追加 issues 并同步 summary/ok（有新 error 则 ok=false） */
export function mergeCheckIssues<T extends Summarized>(report: T, issues: CheckIssue[]): T {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const infos = issues.filter((i) => i.severity === "info").length;
  return {
    ...report,
    issues: [...report.issues, ...issues],
    ok: report.ok && errors === 0,
    summary: {
      ...report.summary,
      errors: report.summary.errors + errors,
      warnings: report.summary.warnings + warnings,
      infos: report.summary.infos + infos,
    },
  };
}

type JsonSummarized = {
  issues: CheckJson["issues"];
  summary: { errors: number; warnings: number; infos: number; functions: number };
};

/** CheckJson 面上追加 issues 并同步 summary（不改 ok） */
export function mergeJsonIssues<T extends JsonSummarized>(
  json: T,
  issues: CheckJson["issues"],
): T {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const infos = issues.filter((i) => i.severity === "info").length;
  return {
    ...json,
    issues: [...json.issues, ...issues],
    summary: {
      ...json.summary,
      errors: json.summary.errors + errors,
      warnings: json.summary.warnings + warnings,
      infos: json.summary.infos + infos,
    },
  };
}
