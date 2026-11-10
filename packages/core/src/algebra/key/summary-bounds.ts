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
 * `TypeParam.bounds`，**只存不读**，默认输出逐字节不变。
 */
import type { Pred } from "../pred.ts";
import type { Term } from "../term.ts";

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
