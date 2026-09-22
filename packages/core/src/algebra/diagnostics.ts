/**
 * 约束诊断：检查调用点实参是否满足函数的前置约束 / 参数 shape。
 * 输出可行动的建议，而不是 TS 式「类型不匹配」。
 */

import type { Abs } from "./abs.ts";
import { litValue } from "./abs.ts";
import type { Pred, Phi } from "./pred.ts";
import { implies, predToString, pTrue, gt, ge, lt, le } from "./pred.ts";
import type { Term } from "./term.ts";
import { termToString, v as termVar, lit } from "./term.ts";
import { generalizeFromAst, type PolyFn } from "./generalize.ts";

import { formatShape } from "./format.ts";

export type Diagnostic = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  suggestion?: string;
  fn?: string;
  argIndex?: number;
};

/**
 * 检查实参是否满足「期望约束」。
 * expect: 相对参数 term 的 pred，例如 term > 0
 * arg: 实际实参 Abs
 */
export function checkArg(
  arg: Abs,
  expect: Pred | undefined,
  phi: Phi = pTrue,
): Diagnostic | undefined {
  if (!expect || expect.op === "true") return undefined;
  if (arg.shape.k === "unknown" && !arg.term) {
    return {
      severity: "warning",
      code: "nudo:arg-opaque",
      message: `实参类型 unknown，无法验证约束 ${predToString(expect)}`,
      suggestion: "补充调用点、@nudo:case，或 --assume 提供前置条件",
    };
  }
  // 若 Φ 与实参自身 pred 已蕴含 expect → OK
  const combined: Phi =
    arg.pred && arg.pred.op !== "true"
      ? phi.op === "true"
        ? arg.pred
        : { op: "and", args: [phi, arg.pred] }
      : phi;
  if (implies(combined, expect)) return undefined;

  // 字面量直接判定
  const lv = litValue(arg);
  if (
    lv !== undefined &&
    (expect.op === "gt" || expect.op === "ge" || expect.op === "lt" || expect.op === "le")
  ) {
    const ok = decideLitCmp(lv, expect);
    if (ok === true) return undefined;
    if (ok === false) {
      return {
        severity: "error",
        code: "nudo:constraint-violated",
        message: `实参 ${JSON.stringify(lv)} 不满足 ${predToString(expect)}`,
        suggestion: `改用满足约束的值，或放宽函数前置条件`,
      };
    }
  }

  return {
    severity: "warning",
    code: "nudo:constraint-unproven",
    message: `无法证明实参满足 ${predToString(expect)}`,
    suggestion: `已知信息不足；可 --assume 或补 case`,
  };
}

function decideLitCmp(
  lv: string | number | boolean | null | undefined,
  p: Extract<Pred, { op: "gt" | "ge" | "lt" | "le" }>,
): boolean | undefined {
  if (typeof lv !== "number" || p.b.op !== "lit" || typeof p.b.value !== "number") {
    return undefined;
  }
  const n = p.b.value;
  switch (p.op) {
    case "gt":
      return lv > n;
    case "ge":
      return lv >= n;
    case "lt":
      return lv < n;
    case "le":
      return lv <= n;
    default:
      return undefined;
  }
}

/**
 * 对一次函数调用做诊断：实参 shape + 约束。
 */
export function checkCall(
  source: string,
  fnName: string,
  args: Abs[],
  phi: Phi = pTrue,
): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const g = generalizeFromAst(fnName, source);
  if (!g) {
    diags.push({
      severity: "error",
      code: "nudo:fn-not-found",
      message: `未找到函数 ${fnName}`,
    });
    return diags;
  }

  // 参数个数
  if (args.length !== g.params.length) {
    diags.push({
      severity: "error",
      code: "nudo:arg-count",
      message: `${fnName} 期望 ${g.params.length} 个参数，实际 ${args.length}`,
      fn: fnName,
    });
    return diags;
  }

  // 从符号执行结果提取「对参数的隐含要求」：
  // 若 symbolic.pred 形如 (A1 > 0)，则要求对应实参满足
  const required = extractParamRequirements(g);
  args.forEach((arg, i) => {
    const req = required.get(i);
    const d = checkArg(arg, req, phi);
    if (d) diags.push({ ...d, fn: fnName, argIndex: i });
  });

  // fail-closed：partial 置信度直接用 symbolic（generalize 已求值；不再
  // 重复 analyzeFn 探针）
  if (g.symbolic.conf === "partial" || g.symbolic.conf === "opaque") {
    diags.push({
      severity: "info",
      code: "nudo:partial-result",
      message: `${fnName}(...) 结果置信度 ${g.symbolic.conf}`,
      suggestion: "补充调用点或约束可提高精度",
      fn: fnName,
    });
  }

  return diags;
}

/**
 * 从 generalize 的 symbolic.pred 提取对每个参数位置的要求。
 * 例如 scale 的 pred 若是 (A1+1)>1，则不直接是 A1 的约束；
 * 若 pred 是 A1>0，则要求实参 >0。
 * Phase C 简化：只识别 pred 中直接比较 type-param 的形式。
 */
function extractParamRequirements(g: PolyFn): Map<number, Pred> {
  const map = new Map<number, Pred>();
  const pred = g.symbolic.pred;
  if (!pred || pred.op === "true") return map;

  const paramIndex = new Map<string, number>();
  g.typeParams.forEach((t, i) => paramIndex.set(t.id, i));

  const consider = (p: Pred): void => {
    if (p.op === "and") {
      p.args.forEach(consider);
      return;
    }
    if (
      (p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le") &&
      p.a.op === "var" &&
      paramIndex.has(p.a.id) &&
      p.b.op === "lit"
    ) {
      // 把 A1 换成 term 占位 —— checkArg 时用实参 term 比较
      // 这里存的是「相对 type-param」的 pred；checkArg 期望的是相对实参 term
      // 简化：存为对参数位置的数值界
      map.set(paramIndex.get(p.a.id)!, p as Pred);
    }
  };
  consider(pred);
  return map;
}

export function formatDiagnostics(diags: Diagnostic[]): string {
  if (diags.length === 0) return "No issues found.";
  return diags
    .map((d) => {
      const loc = d.fn ? `${d.fn}${d.argIndex !== undefined ? `[${d.argIndex}]` : ""}: ` : "";
      let s = `[${d.severity}] ${loc}${d.message} (${d.code})`;
      if (d.suggestion) s += `\n    → ${d.suggestion}`;
      return s;
    })
    .join("\n");
}
