/**
 * nudo check 门禁：对源码跑代数分析，产出 error/warning。
 *
 * 报告是 **Nudo 原生格式**（Abs 优先），不是 TS 诊断的换皮：
 * - 签名表给出无损 Abs（shape/term/pred/conf）
 * - 违例写清 actual ⊭ expected（实参 Abs vs 前置 Pred）
 * - dts/TS 兼容不是本报告的职责
 */

import { parseSource as parse } from "./parse-source.ts";
import type { Node } from "@babel/types";
import { analyzeFn } from "./ast-eval.ts";
import { generalizeFromAst } from "./generalize.ts";
import { numLit, unknown } from "./abs.ts";
import type { Abs, Confidence } from "./abs.ts";
import type { Phi, Pred } from "./pred.ts";
import { pTrue, predToString } from "./pred.ts";
import { termToString } from "./term.ts";
import { litValue } from "./abs.ts";
import { formatAbs, formatAbsMultiline, formatShape } from "./format.ts";
import { checkCall, type Diagnostic } from "./diagnostics.ts";

/** 无损函数签名（类型即计算） */
export type NudoSig = {
  name: string;
  params: string[];
  /** 符号 Abs 本体 */
  abs: Abs;
  /** formatAbs 单行 */
  display: string;
  /** formatAbsMultiline */
  detail: string;
  conf: Confidence;
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

function listTopFunctions(source: string): string[] {
  const file = parse(source);
  const names: string[] = [];
  for (const stmt of file.program.body) {
    let decl: Node = stmt;
    if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
      decl = stmt.declaration;
    }
    if (stmt.type === "ExportDefaultDeclaration" && stmt.declaration) {
      decl = stmt.declaration;
    }
    if (decl.type === "FunctionDeclaration" && decl.id) names.push(decl.id.name);
    if (decl.type === "VariableDeclaration") {
      for (const d of decl.declarations) {
        if (
          d.id.type === "Identifier" &&
          d.init &&
          (d.init.type === "ArrowFunctionExpression" ||
            d.init.type === "FunctionExpression")
        ) {
          names.push(d.id.name);
        }
      }
    }
  }
  return names;
}

/**
 * 检查一个文件：
 * - 每个顶层函数 generalize；无法得到任何签名 → warning
 * - 若 source 中有字面量调用 `f(负数)` 且 f 有 `>0` 约束 → error
 * - entry 结果 partial/opaque → info
 */
export function checkSource(
  filePath: string,
  source: string,
  phi: Phi = pTrue,
): CheckReport {
  const issues: CheckIssue[] = [];
  const signatures: NudoSig[] = [];
  const names = listTopFunctions(source);

  for (const name of names) {
    const g = generalizeFromAst(name, source);
    if (!g) {
      issues.push({
        severity: "warning",
        code: "nudo:no-signature",
        message: `${name}: 无法归纳符号 Abs`,
        suggestion: "补 @nudo:case 或让函数体可代数求值",
        fn: name,
      });
      continue;
    }
    signatures.push({
      name,
      params: g.params,
      abs: g.symbolic,
      display: formatAbs(g.symbolic),
      detail: formatAbsMultiline(g.symbolic, name),
      conf: g.symbolic.conf,
    });

    const entryArgs = g.params.map((): Abs => absUnknown());
    try {
      const r = analyzeFn(source, name, entryArgs, phi);
      if (r.conf === "opaque") {
        issues.push({
          severity: "info",
          code: "nudo:opaque-result",
          message: `${name}(...): conf=opaque（路径未覆盖或 native）`,
          suggestion: "补 @nudo:case 或调用点",
          fn: name,
        });
      }
    } catch (e) {
      issues.push({
        severity: "error",
        code: "nudo:eval-error",
        message: `${name}: 求值失败 — ${(e as Error).message}`,
        fn: name,
      });
    }
  }

  const callIssues = scanLiteralCalls(source, names, phi);
  issues.push(...callIssues);

  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const infos = issues.filter((i) => i.severity === "info").length;

  return {
    file: filePath,
    issues,
    ok: errors === 0,
    signatures,
    summary: { errors, warnings, infos, functions: signatures.length },
  };
}

function absUnknown(): Abs {
  return { shape: { k: "unknown" }, conf: "partial" };
}

/** 扫描前收集：别名 `const f = fn` 与对象属性 `const api = { fn }` / `{ k: fn }` */
type CallResolve = {
  /** 本地名 → 真实函数名 */
  aliasToFn: Map<string, string>;
  /** 对象名.属性名 → 真实函数名 */
  memberToFn: Map<string, string>;
};

function collectCallResolvers(source: string, knownFns: string[]): CallResolve {
  const aliasToFn = new Map<string, string>();
  const memberToFn = new Map<string, string>();
  const file = parse(source);

  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown> & { type?: string };
    if (obj.type === "VariableDeclaration") {
      for (const d of (obj.declarations as Array<Record<string, unknown>> | undefined) ?? []) {
        const id = d.id as { type?: string; name?: string };
        const init = d.init as Record<string, unknown> | null | undefined;
        if (id?.type !== "Identifier" || !id.name || !init) continue;
        // const f = needsPositive
        if (init.type === "Identifier" && typeof init.name === "string" && knownFns.includes(init.name)) {
          aliasToFn.set(id.name, init.name);
        }
        // const api = { needsPositive } / { needsPositive: needsPositive } / { key: fn }
        if (init.type === "ObjectExpression") {
          for (const p of (init.properties as Array<Record<string, unknown>> | undefined) ?? []) {
            if (p.type !== "ObjectProperty") continue;
            const key = p.key as { type?: string; name?: string; value?: unknown };
            const value = p.value as { type?: string; name?: string } | undefined;
            if (value?.type === "Identifier" && value.name && knownFns.includes(value.name)) {
              const propKey =
                key?.type === "Identifier" ? key.name : key?.type === "StringLiteral" ? String(key.value) : undefined;
              if (propKey) memberToFn.set(`${id.name}.${propKey}`, value.name);
            }
          }
        }
      }
    }
    for (const key of Object.keys(obj)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const val = obj[key];
      if (Array.isArray(val)) val.forEach(visit);
      else if (val && typeof val === "object") visit(val);
    }
  };
  visit(file);
  return { aliasToFn, memberToFn };
}

/** 解析 callee → 真实函数名（直接 / 别名 / 对象属性） */
function resolveCalleeFn(
  callee: Record<string, unknown>,
  resolve: CallResolve,
): string | undefined {
  if (callee.type === "Identifier" && typeof callee.name === "string") {
    return resolve.aliasToFn.get(callee.name) ?? callee.name;
  }
  if (callee.type === "MemberExpression") {
    const obj = callee.object as { type?: string; name?: string } | undefined;
    const prop = callee.property as { type?: string; name?: string } | undefined;
    if (
      !callee.computed &&
      obj?.type === "Identifier" &&
      obj.name &&
      prop?.type === "Identifier" &&
      prop.name
    ) {
      return resolve.memberToFn.get(`${obj.name}.${prop.name}`);
    }
  }
  return undefined;
}

/** 找 `name(literalArgs)` / `alias(lit)` / `obj.fn(lit)`，检查约束 */
function scanLiteralCalls(
  source: string,
  knownFns: string[],
  phi: Phi,
): CheckIssue[] {
  const out: CheckIssue[] = [];
  const file = parse(source);
  const resolve = collectCallResolvers(source, knownFns);

  const checkOneCall = (
    fnName: string,
    args: Array<Record<string, unknown>>,
    loc?: { start: { line: number; column: number } },
  ): void => {
    if (!knownFns.includes(fnName)) return;
    const absArgs: Abs[] = [];
    let allLit = true;
    for (const a of args ?? []) {
      if (a.type === "NumericLiteral" && typeof a.value === "number") {
        absArgs.push(numLit(a.value));
      } else if (
        a.type === "UnaryExpression" &&
        (a as { operator?: string }).operator === "-" &&
        (a as { argument?: Record<string, unknown> }).argument?.type === "NumericLiteral"
      ) {
        const num = (a as { argument: { value: number } }).argument;
        absArgs.push(numLit(-num.value));
      } else {
        allLit = false;
        absArgs.push(absUnknown());
      }
    }
    if (!allLit || absArgs.length === 0) return;
    const reqs = extractParamReqsFromSource(source, fnName);
    const g = generalizeFromAst(fnName, source);
    const paramNames = g?.params ?? [];
    for (const [idx, pred] of reqs) {
      const arg = absArgs[idx];
      if (!arg) continue;
      const lv = litValue(arg);
      if (
        lv !== undefined &&
        (pred.op === "gt" || pred.op === "ge" || pred.op === "lt" || pred.op === "le") &&
        pred.b.op === "lit" &&
        typeof pred.b.value === "number"
      ) {
        const n = pred.b.value;
        let ok = true;
        if (pred.op === "gt") ok = (lv as number) > n;
        if (pred.op === "ge") ok = (lv as number) >= n;
        if (pred.op === "lt") ok = (lv as number) < n;
        if (pred.op === "le") ok = (lv as number) <= n;
        if (!ok) {
          const paramName = paramNames[idx] ?? `arg${idx}`;
          out.push({
            severity: "error",
            code: "nudo:constraint-violated",
            message: `${fnName}[${paramName}]: 实参 ⊭ 前置`,
            actual: formatAbs(arg),
            expected: predToString(pred),
            suggestion: `改用满足 ${predToString(pred)} 的值，或放宽 ${paramName} 的前置`,
            fn: fnName,
            line: loc?.start.line,
            column: loc?.start.column,
          });
        }
      }
    }
  };

  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown> & {
      type?: string;
      loc?: { start: { line: number; column: number } };
    };
    if (obj.type === "CallExpression") {
      const callee = obj.callee as Record<string, unknown>;
      const args = obj.arguments as Array<Record<string, unknown>>;
      const fnName = resolveCalleeFn(callee, resolve);
      if (fnName) {
        checkOneCall(fnName, args ?? [], obj.loc);
      }
    }
    for (const key of Object.keys(obj)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const val = obj[key];
      if (Array.isArray(val)) val.forEach(visit);
      else if (val && typeof val === "object") visit(val);
    }
  };
  visit(file);
  return out;
}

/** 从函数体抽 if (param ≷ n) return param 形态的前置约束（含 && 双侧） */
function extractParamReqsFromSource(
  source: string,
  fnName: string,
): Array<[number, import("./pred.ts").Pred]> {
  const g = generalizeFromAst(fnName, source);
  if (!g) return [];
  const paramIndex = new Map(g.params.map((p, i) => [p, i]));
  const file = parse(source);
  const out: Array<[number, import("./pred.ts").Pred]> = [];

  const pushCmp = (
    test: Record<string, unknown>,
    consequent: Record<string, unknown> | undefined,
  ): void => {
    if (test?.type !== "BinaryExpression") return;
    const left = test.left as { type?: string; name?: string };
    const right = test.right as { type?: string; value?: number };
    const op = test.operator as string;
    if (
      left?.type !== "Identifier" ||
      !left.name ||
      !paramIndex.has(left.name) ||
      right?.type !== "NumericLiteral" ||
      typeof right.value !== "number"
    ) {
      return;
    }
    // 仅 `if (param ≷ n) return param` 视为成功路径前置；
    // `if (id > 9999) return 9999` 是 clamp，不是调用前置。
    const isReturnParam =
      consequent?.type === "ReturnStatement" &&
      (consequent.argument as { type?: string; name?: string })?.type ===
        "Identifier" &&
      (consequent.argument as { name?: string }).name === left.name;
    if (!isReturnParam) return;
    const idx = paramIndex.get(left.name)!;
    const t = { op: "var" as const, id: left.name };
    const b = { op: "lit" as const, value: right.value };
    if (op === ">") out.push([idx, { op: "gt", a: t, b }]);
    else if (op === ">=") out.push([idx, { op: "ge", a: t, b }]);
    else if (op === "<") out.push([idx, { op: "lt", a: t, b }]);
    else if (op === "<=") out.push([idx, { op: "le", a: t, b }]);
  };

  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown> & { type?: string };
    if (obj.type === "IfStatement") {
      const test = obj.test as Record<string, unknown>;
      const consequent = obj.consequent as Record<string, unknown> | undefined;
      pushCmp(test, consequent);
      // `if (a > 0 && a <= 100) return a`
      if (test?.type === "LogicalExpression" && test.operator === "&&") {
        pushCmp(test.left as Record<string, unknown>, consequent);
        pushCmp(test.right as Record<string, unknown>, consequent);
      }
    }
    for (const key of Object.keys(obj)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const val = obj[key];
      if (Array.isArray(val)) val.forEach(visit);
      else if (val && typeof val === "object") visit(val);
    }
  };
  visit(file);
  return out;
}

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

  if (r.signatures.length > 0) {
    lines.push("");
    lines.push("signatures");
    for (const s of r.signatures) {
      lines.push(`  ${s.name}(${s.params.join(", ")})  ${s.display}`);
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
      if (i.suggestion) lines.push(`      → ${i.suggestion}`);
    }
  }
  return lines.join("\n");
}
