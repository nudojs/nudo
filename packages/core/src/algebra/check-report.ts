/**
 * check 报告面：数据模型 + 渲染/序列化。
 *
 * 分析在 check.ts（Abs 优先的 Nudo 原生诊断），这里只投影：
 * - formatCheckReport → 人类可读文本
 * - serializeCheckJson → `nudo check --json` 稳定契约（CI / Agent，v1）
 */

import type { Diagnostic } from "./diagnostics.ts";
import type { Abs, Confidence } from "./abs.ts";
import { formatAbs, formatShape } from "./format.ts";

/** 无损函数签名（类型即计算） */
export type NudoSig = {
  name: string;
  params: string[];
  /** 形参类型展示（入口无约束 = any） */
  paramTypes?: string[];
  /** 符号 Abs 本体 */
  abs: Abs;
  /** formatAbs 单行 */
  display: string;
  /** formatAbsMultiline */
  detail: string;
  conf: Confidence;
  /** throws 域展示（如 TypeError）；省略 = 无 may-throw */
  throws?: string;
  /** 模块边界入口（export / default / CJS exports） */
  entry?: boolean;
};

export type CheckIssue = Diagnostic & {
  fn?: string;
  line?: number;
  column?: number;
  /** 实参 / 实际值的 Abs 展示 */
  actual?: string;
  /** 期望约束（Pred 或 Abs 展示） */
  expected?: string;
};

export type CheckReport = {
  file: string;
  issues: CheckIssue[];
  /** 有 error 则 CI 应失败 */
  ok: boolean;
  /** Abs 优先的签名表（替代 TS 式 display-only） */
  signatures: NudoSig[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
    functions: number;
  };
};

/**
 * `nudo check --json` 稳定契约（供 CI / Agent）。
 * 字段只增不改语义；Abs 以 formatAbs 字符串给出，不序列化内部 shape 图。
 */
export type CheckJson = {
  version: 1;
  file: string;
  ok: boolean;
  summary: CheckReport["summary"];
  signatures: Array<{
    name: string;
    params: string[];
    paramTypes?: string[];
    display: string;
    detail: string;
    conf: string;
    abs: string;
    throws?: string;
    entry?: boolean;
  }>;
  issues: Array<{
    severity: string;
    code: string;
    message: string;
    fn?: string;
    line?: number;
    column?: number;
    actual?: string;
    expected?: string;
    suggestion?: string;
  }>;
};

/** 多文件 `check --json` 信封（CI / monorepo）。单文件仍输出裸 CheckJson。 */
export type CheckJsonMulti = {
  version: 1;
  kind: "multi";
  ok: boolean;
  summary: CheckReport["summary"] & { files: number };
  reports: CheckJson[];
};

export function serializeCheckJson(r: CheckReport): CheckJson {
  return {
    version: 1,
    file: r.file,
    ok: r.ok,
    summary: { ...r.summary },
    signatures: r.signatures.map((s) => ({
      name: s.name,
      params: [...s.params],
      ...(s.paramTypes ? { paramTypes: [...s.paramTypes] } : {}),
      display: s.display,
      detail: s.detail,
      conf: s.conf,
      abs: formatAbs(s.abs),
      ...(s.throws ? { throws: s.throws } : {}),
      ...(s.entry ? { entry: true } : {}),
    })),
    issues: r.issues.map((i) => ({
      severity: i.severity,
      code: i.code,
      message: i.message,
      ...(i.fn !== undefined ? { fn: i.fn } : {}),
      ...(i.line !== undefined ? { line: i.line } : {}),
      ...(i.column !== undefined ? { column: i.column } : {}),
      ...(i.actual !== undefined ? { actual: i.actual } : {}),
      ...(i.expected !== undefined ? { expected: i.expected } : {}),
      ...(i.suggestion !== undefined ? { suggestion: i.suggestion } : {}),
    })),
  };
}

/** 多文件信封：汇总 summary，`ok` = 全部文件 ok。 */
export function serializeCheckJsonMulti(reports: CheckJson[]): CheckJsonMulti {
  const summary = {
    errors: 0,
    warnings: 0,
    infos: 0,
    functions: 0,
    files: reports.length,
  };
  for (const r of reports) {
    summary.errors += r.summary.errors;
    summary.warnings += r.summary.warnings;
    summary.infos += r.summary.infos;
    summary.functions += r.summary.functions;
  }
  return {
    version: 1,
    kind: "multi",
    ok: reports.every((r) => r.ok),
    summary,
    reports,
  };
}

/** 契约/门禁类诊断：终端应给出可执行修复路径（draft 侧车 / refine）。 */
const CONTRACT_FIX_CODES = new Set([
  "nudo:constraint-violated",
  "nudo:assign-mismatch",
  "nudo:arg-structure",
  "nudo:interface-domain-exceeds",
  "nudo:entry-may-throw",
  "nudo:missing-slot",
]);

/**
 * Nudo 原生报告：Abs 签名表 + actual ⊭ expected。
 * 不是 tsc 输出的换皮。
 */
export function formatCheckReport(r: CheckReport, opts: { verbose?: boolean } = {}): string {
  const lines: string[] = [];
  lines.push(`nudo check  ${r.file}`);
  lines.push(r.ok ? "OK" : "FAILED");
  lines.push(
    `  ${r.summary.errors} error · ${r.summary.warnings} warning · ${r.summary.infos} info · ${r.summary.functions} fn`,
  );

  // 签名始终上屏（成功也不静默）；入口 any 不得打成 unknown（design §1.1）
  if (r.signatures.length > 0) {
    lines.push("");
    lines.push("signatures");
    for (const s of r.signatures) {
      const paramStr =
        s.paramTypes && s.paramTypes.length > 0
          ? s.params.map((p, i) => `${p}: ${s.paramTypes![i] ?? "any"}`).join(", ")
          : s.params.join(", ");
      const throwsStr = s.throws ? `  throws ${s.throws}` : "";
      // display 是 formatAbs(返回 Abs)，可含嵌套 `=>` / ` #conf`；
      // 禁止用 `=>` regex 抠返回（HOF 会误截成 `? }`）。
      const displayBase = s.display.replace(/\s+throws\s+[\s\S]+$/, "").trim();
      const shapeK = s.abs?.shape?.k;
      const looksLikeFakeAny =
        shapeK === "any" && displayBase.length > 0 && !/^any(\b|$)/.test(displayBase);
      const retStr =
        !looksLikeFakeAny && shapeK
          ? formatShape(s.abs) || displayBase.replace(/\s+#\w+$/, "").trim()
          : displayBase.replace(/\s+#\w+$/, "").trim();
      lines.push(`  ${s.name}(${paramStr}) => ${retStr}${throwsStr}`);
      if (opts.verbose) {
        for (const ln of s.detail.split("\n").slice(1)) {
          lines.push(`  ${ln}`);
        }
      }
    }
  }

  if (r.issues.length === 0) {
    lines.push("");
    lines.push("(no issues)");
  } else {
    lines.push("");
    lines.push("issues");
    for (const i of r.issues) {
      const loc = i.line != null ? `L${i.line}` : "";
      const head = [i.severity.toUpperCase(), loc, i.fn].filter(Boolean).join(" ");
      lines.push(`  [${head}] ${i.message}  (${i.code})`);
      if (i.actual) lines.push(`      actual:   ${i.actual}`);
      if (i.expected) lines.push(`      expected: ${i.expected}`);
      if (i.suggestion) {
        lines.push(`      → ${i.suggestion}`);
      } else if (CONTRACT_FIX_CODES.has(i.code)) {
        lines.push(`      → add a refine / sidecar contract, or fix the call-site value`);
      }
      if (CONTRACT_FIX_CODES.has(i.code)) {
        lines.push(`      fix:  nudo contract --draft  (emit a sidecar draft you can edit)`);
      }
    }
  }
  return lines.join("\n");
}
