/**
 * ABS-14 PR2：界（bounds）的**简单条件 + 单向依赖**校验。
 *
 * 口径（计划 §5 决策第 1 条）：
 * - 界只用现有 `Pred` 词汇，Term 只允许 `var` / `lit`（不引入算术 app，
 *   不引入新求解器）；
 * - α–α 只允许按声明序单向依赖：第 i 个占位符的界只能引用
 *   `formals[0..i]`，反向依赖（β 的界写进 α）或未声明变元一律拒绝；
 * - 校验失败是 fail-closed 诊断，不静默放宽、不退化成 any。
 *
 * 本模块是 internal 面（不进公共 index）：PR2 只把通过校验的界登记到
 * `TypeParam.bounds`，不改变分析结果。
 *
 * 2026-11-11 续修：入口契约的 Pred 用**实参名**（`typeof x ∧ x > 0`），
 * 而 `TypeParam.id` / formals 是 **α 名**（`A1`）。此前直接拿 α ids 校验
 * ⇒ 每个 var 都判 unbound ⇒ `TypeParam.bounds` 恒空。现在统一由
 * `alignSimpleBounds` 先重锚到 α 空间再校验（见函数注释）。
 */
import type { Pred } from "../pred.ts";
import type { Term } from "../term.ts";
import { renamePred, type VarRename } from "./generalize-key.ts";

export type BoundsCheck = { ok: boolean; reason?: string };

function predTerms(p: Pred): Term[] {
  switch (p.op) {
    case "true":
    case "false":
      return [];
    case "and":
    case "or":
      return p.args.flatMap(predTerms);
    case "not":
      return predTerms(p.arg);
    case "assumeFinite":
    case "typeof":
      return [p.t];
    default:
      return [p.a, p.b];
  }
}

/** 校验单条界：简单词汇 + 按声明序单向依赖。 */
export function checkSimpleBounds(
  pred: Pred,
  formals: readonly string[],
  atIndex: number,
): BoundsCheck {
  const allowed = new Set(formals.slice(0, atIndex + 1));
  for (const t of predTerms(pred)) {
    if (t.op === "app") {
      return { ok: false, reason: "complex term (app) is not a simple bound" };
    }
    if (t.op === "var" && !allowed.has(t.id)) {
      return {
        ok: false,
        reason: formals.includes(t.id)
          ? "reverse alpha dependency"
          : "unbound variable in bound",
      };
    }
  }
  return { ok: true };
}

/** 从入口谓词里挑出可用的简单界（and 拆分，逐条校验，不通过就丢）。 */
export function collectSimpleBounds(
  pred: Pred,
  formals: readonly string[],
  atIndex: number,
): Pred[] {
  const parts = pred.op === "and" ? pred.args : [pred];
  return parts.filter((p) => checkSimpleBounds(p, formals, atIndex).ok);
}

/**
 * 入口契约界 → `TypeParam.bounds`（α 空间）。
 *
 * 两套变量空间必须显式对齐：`entryReqs[].pred` 由
 * `instantiateConstraint(c, paramName)` 生成，self var 是**实参名**（`x`）；
 * 而 `TypeParam.id` 与决策第 1 条的 formals 都是 **α 名**（`A1`）。直接
 * `collectSimpleBounds(pred, ids, idx)` 会把 `x` 判成 unbound 全部丢弃 ——
 * 这正是 2026-11-10 记录的「bounds 恒空」缺陷。
 *
 * 纪律：
 * - 只映射 `params[i] → ids[i]`（同声明序），其余 var（binder 名
 *   `bind:A`、ref 目标、未声明名）保持原样，交给 `checkSimpleBounds`
 *   判 unbound 丢弃 —— 不猜、不静默放宽；
 * - `app` term 同样由 `checkSimpleBounds` 拒绝，不引入算术求解；
 * - `entryReqs` 与 Φ 保持实参名空间原貌（展示层 / body 内单调性传播
 *   依赖它），本函数只产出**另存**的 α 空间界，零行为变化。
 */
export function alignSimpleBounds(
  pred: Pred,
  params: readonly string[],
  ids: readonly string[],
  atIndex: number,
): Pred[] {
  const rename: VarRename = new Map(
    params.map((p, i) => [p, ids[i] ?? p] as const),
  );
  return collectSimpleBounds(renamePred(pred, rename), ids, atIndex);
}
