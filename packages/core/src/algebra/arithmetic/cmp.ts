/**
 * 比较折叠域：cmp（双字面量/pred 蕴含/界判定 + eq/ne 符号面）、
 * trueConstraint/falseConstraint（if 分支约束提取）、refineAbsForRelTrue、
 * matchRelIdentLit。
 *
 * 依赖方向不变量：只 import 叶子（coerce/bounds）；不得 import 兄弟域
 * （addsub/muldiv）或 facade。
 */

import type { Term } from "../term.ts";
import { lit } from "../term.ts";
import type { Pred, Phi } from "../pred.ts";
import { and, gt, ge, lt, le, implies, negatePred, totalOrderDual, pTrue } from "../pred.ts";
import type { Abs } from "../abs.ts";
import { abs, confJoin, isNumPrim, isStrPrim, litValue, boolLit } from "../abs.ts";
import { makeSum } from "../objects.ts";
import { isSymbolAbs as isSym } from "../symbol-id.ts";
import { NudoThrow } from "../nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../may-throw.ts";
import { builtinBrandToPrimitive, isMaybeCoercionThrowOperand } from "./coerce.ts";
import { numericBounds } from "./bounds.ts";

/** 比较：返回 boolean Abs；若双字面量则 exact */
export function cmp(
  op: "lt" | "le" | "gt" | "ge" | "eq" | "ne",
  a: Abs,
  b: Abs,
  phi: Phi = pTrue,
): Abs {
  // Bug 25：内建 brand ToPrimitive（hint number：关系比较先 valueOf——
  // `new Date(0) < new Date(1)` → time value 比较，total）。
  // eq/ne **不走**此块：=== 无强制转换（`new Number(5) === 5` 原生 false，
  // 解箱比较会折假 true——#170 $eq 符号化后 eq 路径可达，此门必须先于解箱）。
  if (op !== "eq" && op !== "ne") {
    const fa = builtinBrandToPrimitive(a, "number");
    const fb = builtinBrandToPrimitive(b, "number");
    if (fa || fb) return cmp(op, fa ?? a, fb ?? b, phi);
  }
  // Symbol 参与关系比较：ToNumber/ToNumeric 原生 TypeError（与 add 同口径）。
  // eq/ne 不走此守卫：Symbol() === Symbol() 合法，由 strictEqAbs/looseEqAbs 分流。
  if (op !== "eq" && op !== "ne" && (isSym(a) || isSym(b))) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // 双 lit 用 term 值（含 undefined）：litValue 哨兵会把 lit(undefined)
  // 误判成「无字面量」。关系比较 ToNumber(undefined)=NaN → 恒 false。
  const ta = a.term;
  const tb = b.term;
  if (ta?.op === "lit" && tb?.op === "lit") {
    const result = compareLits(op, ta.value, tb.value);
    if (result !== undefined) return boolLit(result);
  } else {
    const ra = litValue(a);
    const rb = litValue(b);
    if (ra.ok && rb.ok) {
      const result = compareLits(op, ra.value, rb.value);
      if (result !== undefined) return boolLit(result);
    }
  }

  // 符号比较：构造 pred 挂在 boolean 上，供 if 分支消费
  if (a.term && b.term) {
    // Bug 31：关系比较的抽象操作数（any/obj/fn/brand/sum，可能持有 Symbol）
    // —— ToPrimitive(x, hint Number) 原生 may TypeError（`x < 1`，x=Symbol()）。
    // bigint 混型在关系比较中合法（`1n < 2`），只有 Symbol 维度；值域 boolean
    // 不变；unknown 令牌不记（wave 1 口径）。放在 pred 化简/界判定之前：
    // 无论值域是否被 Φ 决定，原生先做 ToPrimitive 才可能得值。
    if (op !== "eq" && op !== "ne" && (isMaybeCoercionThrowOperand(a) || isMaybeCoercionThrowOperand(b))) {
      recordMayThrow({
        kind: "TypeError",
        cause: "ToPrimitive of abstract relational operand (Symbol)",
      });
    }
    const pred: Pred =
      op === "lt"
        ? lt(a.term, b.term)
        : op === "le"
          ? le(a.term, b.term)
          : op === "gt"
            ? gt(a.term, b.term)
            : op === "ge"
              ? ge(a.term, b.term)
              : op === "eq"
                ? { op: "eq", a: a.term, b: b.term }
                : { op: "ne", a: a.term, b: b.term };

    // 若 Φ 已蕴含该比较 → true
    // 若蕴含否定（¬pred，或全序对偶作正向事实）→ false
    if (implies(phi, pred)) return boolLit(true);
    if (implies(phi, negatePred(pred))) return boolLit(false);
    const dual: Pred | undefined = totalOrderDual(pred) ??
      (op === "eq"
        ? { op: "ne", a: a.term, b: b.term }
        : op === "ne"
          ? { op: "eq", a: a.term, b: b.term }
          : undefined);
    if (dual && implies(phi, dual)) return boolLit(false);

    // 数值界判定：range pred / Φ 中的 min·max 足以决定字面比较
    const decided = decideByBounds(op, a, b, phi);
    if (decided !== undefined) return boolLit(decided);

    return {
      shape: { k: "prim", type: "boolean" },
      term: undefined,
      pred,
      conf: confJoin(confJoin(a.conf, b.conf), "path"),
    };
  }

  // Bug 31：抽象回退臂（`x < 1`，x:any 无 term）与 both-terms 臂同口径 ——
  // ToPrimitive 可能撞 Symbol → may TypeError；值域 partial boolean 不变。
  if (op !== "eq" && op !== "ne" && (isMaybeCoercionThrowOperand(a) || isMaybeCoercionThrowOperand(b))) {
    recordMayThrow({
      kind: "TypeError",
      cause: "ToPrimitive of abstract relational operand (Symbol)",
    });
  }
  return abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial");
}

function compareLits(
  op: "lt" | "le" | "gt" | "ge" | "eq" | "ne",
  a: string | number | boolean | bigint | null | undefined,
  b: string | number | boolean | bigint | null | undefined,
): boolean | undefined {
  if (op === "eq") return a === b;
  if (op === "ne") return a !== b;
  if (typeof a === "number" && typeof b === "number") {
    switch (op) {
      case "lt":
        return a < b;
      case "le":
        return a <= b;
      case "gt":
        return a > b;
      case "ge":
        return a >= b;
    }
  }
  // 字符串字面量比较（JS 词法序）
  if (typeof a === "string" && typeof b === "string") {
    switch (op) {
      case "lt":
        return a < b;
      case "le":
        return a <= b;
      case "gt":
        return a > b;
      case "ge":
        return a >= b;
    }
  }
  // 混合/非字符串原始字面量：JS 关系比较先 ToNumber（NaN 参与时结果恒 false）
  // e.g. `"a" > 3` → false, `"10" < 9` → false, `true > 0` → true
  if (op === "lt" || op === "le" || op === "gt" || op === "ge") {
    // as number: TS 不让对 null/undefined 做关系比较；运行时仍走 JS 语义
    const x = a as number;
    const y = b as number;
    switch (op) {
      case "lt":
        return x < y;
      case "le":
        return x <= y;
      case "gt":
        return x > y;
      case "ge":
        return x >= y;
    }
  }
  return undefined;
}

/**
 * 用数值界判定比较（range Pred / Φ）。
 * 仅当界足以推出结果时返回 true/false，否则 undefined。
 */
function decideByBounds(
  op: "lt" | "le" | "gt" | "ge" | "eq" | "ne",
  a: Abs,
  b: Abs,
  phi: Phi,
): boolean | undefined {
  if (op === "eq" || op === "ne") return undefined;
  const aB = numericBounds(a, phi);
  const bB = numericBounds(b, phi);
  if (!aB && !bB) return undefined;

  // 一侧/两侧字面量界已含在 numericBounds；用 lo/hi 推
  const aLo = aB?.lo;
  const aHi = aB?.hi;
  const bLo = bB?.lo;
  const bHi = bB?.hi;

  // 等值处必须看 strict：x<5 ∧ y>5 仍推出 x<y（旧实现 5<5 漏判）。
  // 一侧 open 的等界同样能定假：x>5 ∧ y≤5 ⇒ x>y（对 le）。
  const tighterHi = (x: { value: number; strict: boolean }, y: { value: number; strict: boolean }): boolean =>
    x.value < y.value || (x.value === y.value && (x.strict || y.strict));
  const tighterLo = (x: { value: number; strict: boolean }, y: { value: number; strict: boolean }): boolean =>
    x.value > y.value || (x.value === y.value && (x.strict || y.strict));

  // a < b：a.hi < b.lo 或等值+至少一侧 open ⇒ true；a.lo ≥ b.hi ⇒ false
  if (op === "lt") {
    if (aHi && bLo && tighterHi(aHi, bLo)) return true;
    if (aLo && bHi && aLo.value >= bHi.value) return false;
    return undefined;
  }
  if (op === "le") {
    if (aHi && bLo && aHi.value <= bLo.value) return true;
    if (aLo && bHi && tighterLo(aLo, bHi)) return false;
    return undefined;
  }
  if (op === "gt") {
    if (aLo && bHi && tighterLo(aLo, bHi)) return true;
    if (aHi && bLo && aHi.value <= bLo.value) return false;
    return undefined;
  }
  if (op === "ge") {
    if (aLo && bHi && aLo.value >= bHi.value) return true;
    if (aHi && bLo && tighterHi(aHi, bLo)) return false;
    return undefined;
  }
  return undefined;
}

/** 从比较结果 Abs 提取「若为真」的额外约束（供 if 使用） */
export function trueConstraint(c: Abs): Pred | undefined {
  if (c.term?.op === "lit" && c.term.value === true) return pTrue;
  if (c.term?.op === "lit" && c.term.value === false) return undefined;
  return c.pred;
}

/**
 * 关系比较为真时收窄操作数 shape。
 * `x > k` 对 any：JS 只允许 number（n>k）或数字字符串（ToNumber(s)>k）。
 * 粗化展示为 `number>… | string`；string 臂不挂 ToNumber pred（Pred 无该构造）。
 */
export function refineAbsForRelTrue(
  a: Abs,
  op: "gt" | "ge" | "lt" | "le",
  k: number,
): Abs {
  const bound = (t: Term): Pred =>
    op === "gt"
      ? gt(t, lit(k))
      : op === "ge"
        ? ge(t, lit(k))
        : op === "lt"
          ? lt(t, lit(k))
          : le(t, lit(k));

  if (isNumPrim(a) && a.term) {
    const pred =
      a.pred && a.pred.op !== "true" ? and(a.pred, bound(a.term)) : bound(a.term);
    return abs(a.shape, a.term, pred, a.conf);
  }
  // string prim：比较已真，shape 保持 string（ToNumber(s) rel k 无法进 Pred）
  if (isStrPrim(a)) return a;
  if ((a.shape.k === "any" || a.shape.k === "unknown") && a.term) {
    const numArm = abs({ k: "prim", type: "number" }, a.term, bound(a.term), "path");
    const strArm = abs({ k: "prim", type: "string" }, a.term, undefined, "path");
    return makeSum(numArm, strArm);
  }
  return a;
}

/**
 * 从 Identifier 在比较中的位置解析「对哪个变量、用哪个关系」。
 * 支持 `x > 3` 与 `3 < x`（后者关系翻转）。
 */
export function matchRelIdentLit(
  test: unknown,
): { name: string; op: "gt" | "ge" | "lt" | "le"; k: number } | undefined {
  const t = test as {
    type?: string;
    operator?: string;
    left?: { type?: string; name?: string; value?: number };
    right?: { type?: string; name?: string; value?: number };
  };
  if (t?.type !== "BinaryExpression") return undefined;
  const rel =
    t.operator === ">"
      ? "gt"
      : t.operator === ">="
        ? "ge"
        : t.operator === "<"
          ? "lt"
          : t.operator === "<="
            ? "le"
            : undefined;
  if (!rel) return undefined;
  if (t.left?.type === "Identifier" && t.left.name && t.right?.type === "NumericLiteral" && typeof t.right.value === "number") {
    return { name: t.left.name, op: rel, k: t.right.value };
  }
  if (t.right?.type === "Identifier" && t.right.name && t.left?.type === "NumericLiteral" && typeof t.left.value === "number") {
    const flipped =
      rel === "gt" ? "lt" : rel === "ge" ? "le" : rel === "lt" ? "gt" : "ge";
    return { name: t.right.name, op: flipped, k: t.left.value };
  }
  return undefined;
}

export function falseConstraint(c: Abs): Pred | undefined {
  if (c.term?.op === "lit" && c.term.value === true) return undefined;
  if (c.term?.op === "lit" && c.term.value === false) return pTrue;
  if (!c.pred) return undefined;
  // 否定 pred（De Morgan 展开见 pred.negatePred）
  return negatePred(c.pred);
}

