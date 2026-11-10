/**
 * ABS-14 PR3：函数级带界摘要的快路径（不重跑 body）。
 *
 * sound 口径（计划 §5 决策第 1/2/3 条）：
 * - 摘要来自一次**真实 body 求值**（`summaryScope` 已限定纯上下文：无
 *   refine / inject / 自定义 budget、依赖指纹可信），不是从 AST 发明；
 * - 命中前必须全部满足：顶层形状签名一致、formals 与当前变元数量一致、
 *   post 的所有自由变元都属于 formals、每个 formal 都能映射到当前实参、
 *   形成时的简单界由当前 Φ 蕴含。任一不满足 => 回退 body（fail-closed）；
 * - 命中用 `substAbs(post, map)` 把 formals 整 Abs 换成当前实参，而不是
 *   改名了事；结果必须 ≡ body 路径逐字节一致（等价性门禁）。
 *
 * 三条保守通道：
 * - `crossModule`（默认开）：新 PolyFn 实例首次实例化时复用函数级摘要；
 * - `bodyUnavailable` / `budgetTruncated`（**默认关**）：会把 fail-closed 的
 *   `unknown #opaque` 换成精确结论，与「快路径 ≡ body 路径」门禁口径冲突，
 *   需独立验证后才允许开启。代码路径存在但默认不触发，默认输出不变。
 */
import type { Abs } from "../abs.ts";
import { substAbs } from "../hof.ts";
import { implies, type Phi, type Pred } from "../pred.ts";
import { collectAbsFreeVars } from "./generalize-key.ts";
import type { FnSummaryEntry, FnSummaryFields } from "./fn-summary.ts";
import { collectSimpleBounds } from "./summary-bounds.ts";

export type FastPathChannels = {
  crossModule: boolean;
  bodyUnavailable: boolean;
  budgetTruncated: boolean;
};

const channels: FastPathChannels = {
  crossModule: true,
  bodyUnavailable: false,
  budgetTruncated: false,
};

export function setAbs14FastPathChannels(next: Partial<FastPathChannels>): void {
  Object.assign(channels, next);
}

export function getAbs14FastPathChannels(): Readonly<FastPathChannels> {
  return { ...channels };
}

/** 顶层形状类别签名：忽略 term / pred，只钉结构类别。 */
export function shapeSigOf(args: readonly Abs[]): string {
  return args
    .map((a) => (a.shape.k === "prim" ? `prim:${a.shape.type}` : a.shape.k))
    .join(",");
}

/** 提取「变元 id → 该实参 Abs」；只认顶层 var term，复杂 term 不猜。 */
export function argVarMap(args: readonly Abs[]): Map<string, Abs> {
  const m = new Map<string, Abs>();
  for (const a of args) {
    const t = a.term;
    if (t?.op === "var" && !m.has(t.id)) m.set(t.id, a);
  }
  return m;
}

/** 形成函数级摘要时登记的可选字段（界只保留简单条件）。 */
export function fnLevelFields(
  args: readonly Abs[],
  phi: Phi,
  varOrder: readonly string[],
): FnSummaryFields {
  const bounds: Pred[] =
    varOrder.length > 0
      ? collectSimpleBounds(phi, varOrder, varOrder.length - 1).filter(
          (p) => p.op !== "true",
        )
      : [];
  return {
    formals: [...varOrder],
    bounds,
    pre: phi,
    eff: [],
    shapeSig: shapeSigOf(args),
  };
}

export type FastPathResult = { post: Abs } | { miss: string };

/** 尝试命中函数级摘要；返回 miss 原因（可观测）而不是悄悄放宽。 */
export function tryFnLevelFastPath(
  entry: FnSummaryEntry,
  args: readonly Abs[],
  phi: Phi,
  varOrder: readonly string[],
): FastPathResult {
  const formals = entry.formals ?? entry.varOrder;
  if (formals.length === 0 || formals.length !== varOrder.length) {
    return { miss: "formal-arity" };
  }
  if (entry.shapeSig !== undefined && entry.shapeSig !== shapeSigOf(args)) {
    return { miss: "shape" };
  }
  for (const b of entry.bounds ?? []) {
    if (!implies(phi, b)) return { miss: "bounds" };
  }
  for (const id of collectAbsFreeVars(entry.post)) {
    if (!formals.includes(id)) return { miss: "free-var" };
  }
  const current = argVarMap(args);
  const map = new Map<string, Abs>();
  for (let i = 0; i < formals.length; i++) {
    const cur = current.get(varOrder[i]!);
    if (cur === undefined) return { miss: "unmapped" };
    map.set(formals[i]!, cur);
  }
  return { post: substAbs(entry.post, map) };
}
