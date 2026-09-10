/**
 * nudo check 门禁：对源码跑 kernel 分析，产出 error/warning。
 * 与 infer 的区别：check 关心「违例」，不是「展示签名」。
 */

import { parse } from "@nudojs/parser";
import type { Node } from "@babel/types";
import {
  analyzeFn,
  generalizeFromAst,
  numLit,
  numVar,
  unknown,
  gtNum,
  v,
  type Abs,
  type Phi,
  pTrue,
  formatShape,
  termToString,
  predToString,
  litValue,
  checkCall,
  type Diagnostic,
} from "@nudojs/kernel";

export type CheckIssue = Diagnostic & {
  fn?: string;
  line?: number;
  column?: number;
};

export type CheckReport = {
  file: string;
  issues: CheckIssue[];
  /** 有 error 则 CI 应失败 */
  ok: boolean;
  functions: Array<{ name: string; display: string; conf: string }>;
};

function listTopFunctions(source: string): string[] {
  const file = parse(source);
  const names: string[] = [];
  for (const stmt of file.program.body) {
    let decl: Node = stmt;
    if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
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
  const functions: CheckReport["functions"] = [];
  const names = listTopFunctions(source);

  for (const name of names) {
    const g = generalizeFromAst(name, source);
    if (!g) {
      issues.push({
        severity: "warning",
        code: "nudo:no-signature",
        message: `无法为 ${name} 推导内涵签名`,
        fn: name,
      });
      continue;
    }
    functions.push({
      name,
      display: g.display,
      conf: g.symbolic.conf,
    });

    // 用 unknown 实参求值，看是否 opaque
    const entryArgs = g.params.map(
      (): Abs => absUnknown(),
    );
    try {
      const r = analyzeFn(source, name, entryArgs, phi);
      if (r.conf === "opaque") {
        issues.push({
          severity: "info",
          code: "nudo:opaque-result",
          message: `${name}(...) 结果 opaque（路径未覆盖或 native）`,
          suggestion: "补充 @nudo:case 或调用点",
          fn: name,
        });
      }
    } catch (e) {
      issues.push({
        severity: "error",
        code: "nudo:eval-error",
        message: `${name} 求值失败: ${(e as Error).message}`,
        fn: name,
      });
    }
  }

  // 扫描源码中的字面量调用，用 checkCall 做约束违例
  const callIssues = scanLiteralCalls(source, names, phi);
  issues.push(...callIssues);

  return {
    file: filePath,
    issues,
    ok: !issues.some((i) => i.severity === "error"),
    functions,
  };
}

function absUnknown(): Abs {
  return { shape: { k: "unknown" }, conf: "partial" };
}

/** 找 `name(literalArgs)` 形态，检查约束 */
function scanLiteralCalls(
  source: string,
  knownFns: string[],
  phi: Phi,
): CheckIssue[] {
  const out: CheckIssue[] = [];
  const file = parse(source);
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown> & {
      type?: string;
      loc?: { start: { line: number; column: number } };
    };
    if (obj.type === "CallExpression") {
      const callee = obj.callee as { type?: string; name?: string };
      const args = obj.arguments as Array<Record<string, unknown>>;
      if (
        callee?.type === "Identifier" &&
        callee.name &&
        knownFns.includes(callee.name)
      ) {
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
        if (allLit && absArgs.length > 0) {
          const reqs = extractParamReqsFromSource(source, callee.name);
          const g = generalizeFromAst(callee.name, source);
          const paramNames = g?.params ?? [];
          for (const [idx, pred] of reqs) {
            const arg = absArgs[idx];
            if (!arg) continue;
            const lv = litValue(arg);
            if (
              lv !== undefined &&
              (pred.op === "gt" ||
                pred.op === "ge" ||
                pred.op === "lt" ||
                pred.op === "le") &&
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
                out.push({
                  severity: "error",
                  code: "nudo:constraint-violated",
                  message: `${callee.name}[${idx}]: 实参 ${JSON.stringify(lv)} 不满足 ${predToString(pred)}`,
                  suggestion: `改用满足约束的值，或调整 ${paramNames[idx] ?? "参数"} 的前置条件`,
                  fn: callee.name,
                  line: obj.loc?.start.line,
                  column: obj.loc?.start.column,
                });
              }
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
  return out;
}

/** 从函数体抽 if (param > n) 形态的前置约束 */
function extractParamReqsFromSource(
  source: string,
  fnName: string,
): Array<[number, import("./pred.ts").Pred]> {
  const g = generalizeFromAst(fnName, source);
  if (!g) return [];
  const paramIndex = new Map(g.params.map((p, i) => [p, i]));
  const file = parse(source);
  const out: Array<[number, import("./pred.ts").Pred]> = [];

  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const obj = n as Record<string, unknown> & { type?: string };
    if (obj.type === "IfStatement") {
      const test = obj.test as Record<string, unknown>;
      if (test?.type === "BinaryExpression") {
        const left = test.left as { type?: string; name?: string };
        const right = test.right as { type?: string; value?: number };
        const op = test.operator as string;
        if (
          left?.type === "Identifier" &&
          left.name &&
          paramIndex.has(left.name) &&
          right?.type === "NumericLiteral" &&
          typeof right.value === "number"
        ) {
          const idx = paramIndex.get(left.name)!;
          const t = { op: "var" as const, id: left.name };
          const b = { op: "lit" as const, value: right.value };
          if (op === ">") out.push([idx, { op: "gt", a: t, b }]);
          else if (op === ">=") out.push([idx, { op: "ge", a: t, b }]);
          else if (op === "<") out.push([idx, { op: "lt", a: t, b }]);
          else if (op === "<=") out.push([idx, { op: "le", a: t, b }]);
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
  return out;
}

export function formatCheckReport(r: CheckReport): string {
  const lines: string[] = [];
  lines.push(`nudo check  ${r.file}`);
  lines.push(r.ok ? "OK" : "FAILED");
  for (const fn of r.functions) {
    lines.push(`  ${fn.name}: ${fn.display}  #${fn.conf}`);
  }
  if (r.issues.length === 0) {
    lines.push("  (no issues)");
  } else {
    for (const i of r.issues) {
      const loc = i.line != null ? `:${i.line}` : "";
      lines.push(`  [${i.severity}]${loc} ${i.message} (${i.code})`);
      if (i.suggestion) lines.push(`      → ${i.suggestion}`);
    }
  }
  return lines.join("\n");
}
