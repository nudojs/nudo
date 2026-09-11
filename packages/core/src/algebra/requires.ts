/**
 * requires → Pred 编译（最小片段）。
 * 支持：`x > 0` / `x >= 0` / `x < 10` / `x <= 10`（字面量右端）。
 * 非法/不支持 → undefined（调用方回退或报 unproven）。
 */

import type { Pred } from "./pred.ts";
import { v as termVar, lit } from "./term.ts";

const CMP = /^(?<name>[A-Za-z_$][\w$]*)\s*(?<op>>=|<=|>|<)\s*(?<n>-?\d+(?:\.\d+)?)$/;

export function compileRequiresExpr(expr: string): { param: string; pred: Pred } | undefined {
  const m = expr.trim().match(CMP);
  if (!m?.groups) return undefined;
  const name = m.groups.name!;
  const op = m.groups.op!;
  const n = Number(m.groups.n);
  if (!Number.isFinite(n)) return undefined;
  const t = termVar(name);
  const b = lit(n);
  switch (op) {
    case ">":
      return { param: name, pred: { op: "gt", a: t, b } };
    case ">=":
      return { param: name, pred: { op: "ge", a: t, b } };
    case "<":
      return { param: name, pred: { op: "lt", a: t, b } };
    case "<=":
      return { param: name, pred: { op: "le", a: t, b } };
    default:
      return undefined;
  }
}

/** 从源码抽函数上的 @nudo:requires（JSDoc 或 // 行注释） */
export function extractRequiresFromSource(
  source: string,
  fnName: string,
): Array<[number, Pred]> {
  const out: Array<[number, Pred]> = [];
  // 找 function fnName / export default function fnName / const fnName =
  const fnRe = new RegExp(
    `(?:export\\s+default\\s+)?(?:function\\s+${fnName}\\b|const\\s+${fnName}\\s*=)`,
  );
  const m = source.match(fnRe);
  if (!m || m.index === undefined) return out;
  const before = source.slice(0, m.index);
  const lines = before.split("\n");
  // 从函数声明上方向上扫注释块
  const reqs: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line === "" || line === "*/") continue;
    if (line.startsWith("*") || line.startsWith("/*") || line.startsWith("//")) {
      const rm = line.match(/@nudo:requires\s+(.+)$/);
      if (rm) reqs.unshift(rm[1]!.trim().replace(/\*\/$/, "").trim());
      continue;
    }
    break;
  }
  // 也支持同一函数体上方紧邻的 // @nudo:requires
  for (const expr of reqs) {
    // 可能多条用 && 连接
    for (const part of expr.split(/&&/)) {
      const c = compileRequiresExpr(part);
      if (c) {
        // param 下标由调用方按 generalize 参数表解析
        out.push([-1, c.pred]); // -1 = 按名匹配，调用方填
        (out[out.length - 1] as any).param = c.param;
      }
    }
  }
  return out;
}

/** 把按名的 requires 映射到参数下标 */
export function requiresToIndexed(
  source: string,
  fnName: string,
  paramNames: string[],
): Array<[number, Pred]> {
  const raw = extractRequiresFromSource(source, fnName);
  const out: Array<[number, Pred]> = [];
  for (const item of raw) {
    const paramName = (item as any).param as string | undefined;
    if (!paramName) continue;
    const idx = paramNames.indexOf(paramName);
    if (idx >= 0) out.push([idx, item[1]]);
  }
  return out;
}
