/**
 * TypeValue IR ⇄ Abs 代数的路由。
 *
 * 唯一计算路径：算术/比较/相等/一元语言表面先走 Abs；
 * 仅 refined 宿主扩展（/ % 自定义 ops、方法表）与代数无法建模的操作数才回落。
 */

import type { TypeValue } from "@nudojs/core";
import {
  typeValueToAbs,
  absToTypeValue,
  simplifyUnion,
  add as kAdd,
  sub as kSub,
  mul as kMul,
  div as kDiv,
  mod as kMod,
  cmp as kCmp,
  typeofAbs as kTypeof,
  negAbs as kNeg,
  notAbs as kNot,
  strictEqAbs as kStrictEq,
  type Abs,
  type Pred,
  pTrue,
  and as predAnd,
  ge as predGe,
  le as predLe,
  lit as termLit,
  spread as kSpread,
  joinAbs as kJoinAbs,
  abs as makeAbs,
  boolLit,
  currentPhi,
  pushPhi,
  popPhi,
  resetPhi,
  withPhiConstraint,
  describePhi,
} from "@nudojs/core";
import { getTerm, getPred } from "./term-registry.ts";

export { currentPhi, pushPhi, popPhi, resetPhi, withPhiConstraint, describePhi };

const ARITH_OPS = new Set(["+", "-", "*", "/", "%"]);
const CMP_OPS = new Set(["<", "<=", ">", ">="]);
const EQ_OPS = new Set(["===", "!=="]);
const UNARY_OPS = new Set(["typeof", "!", "-"]);

function isNumericOperand(tv: TypeValue): boolean {
  if (!tv) return false;
  if (tv.kind === "literal") return typeof tv.value === "number";
  if (tv.kind === "primitive") return tv.type === "number";
  if (tv.kind === "refined") return isNumericOperand(tv.base);
  return false;
}

function isStringOperand(tv: TypeValue): boolean {
  if (!tv) return false;
  if (tv.kind === "literal") return typeof tv.value === "string";
  if (tv.kind === "primitive") return tv.type === "string";
  if (tv.kind === "refined") return isStringOperand(tv.base);
  return false;
}

/** 比较：数值或字符串字面量 */
function isComparableOperand(tv: TypeValue): boolean {
  if (tv.kind === "literal") {
    return typeof tv.value === "number" || typeof tv.value === "string";
  }
  if (tv.kind === "primitive") return tv.type === "number" || tv.type === "string";
  if (tv.kind === "refined") return isComparableOperand(tv.base);
  return false;
}

/**
 * 宿主 refinement 自定义了该运算 → 让位。
 * 仅限代数未覆盖的运算（/ %）：template 的 + 等仍走代数（concatString）。
 */
function hasCustomRefinementOp(tv: TypeValue, op: string): boolean {
  if (op !== "/" && op !== "%") return false;
  let cur: TypeValue | undefined = tv;
  while (cur && cur.kind === "refined") {
    if (cur.refinement.ops?.[op]) return true;
    cur = cur.base;
  }
  return false;
}

/** `+` 可接受：双数值；或任一侧 string/template（拼接） */
function canAdd(left: TypeValue, right: TypeValue): boolean {
  if (isNumericOperand(left) && isNumericOperand(right)) return true;
  if (isStringOperand(left) || isStringOperand(right)) return true;
  if (left.kind === "refined" && isStringOperand(left.base)) return true;
  if (right.kind === "refined" && isStringOperand(right.base)) return true;
  return false;
}

/**
 * 带 term 旁路的 TypeValue → Abs。
 * range refined 已随 TypeValue refinements 删除；仅 term/pred 旁路。
 */
function toAbsWithTerms(tv: TypeValue): Abs {
  const base = typeValueToAbs(tv);
  const term = getTerm(tv);
  const pred = getPred(tv);
  const abs: Abs =
    !term && !pred
      ? base
      : makeAbs(base.shape, term ?? base.term, pred ?? base.pred, base.conf);
  return abs;
}

/**
 * 代数计算二元算术/比较/相等。
 * - union：逐成员代数后 simplifyUnion（约束不丢）
 * - undefined = 不可处理 → 调用方走 refined 扩展 / 形状兜底
 */
export function tryAbsBinary(
  op: string,
  left: TypeValue,
  right: TypeValue,
): TypeValue | undefined {
  if (!ARITH_OPS.has(op) && !CMP_OPS.has(op) && !EQ_OPS.has(op)) return undefined;

  if (left.kind === "union" || right.kind === "union") {
    const ls = left.kind === "union" ? left.members : [left];
    const rs = right.kind === "union" ? right.members : [right];
    const results: TypeValue[] = [];
    for (const l of ls) {
      for (const r of rs) {
        const one = tryAbsBinary(op, l, r);
        if (one === undefined) return undefined;
        results.push(one);
      }
    }
    return simplifyUnion(results);
  }

  if (hasCustomRefinementOp(left, op) || hasCustomRefinementOp(right, op)) {
    return undefined;
  }

  if (op === "+") {
    if (!canAdd(left, right)) return undefined;
  } else if (op === "-" || op === "*" || op === "/" || op === "%") {
    if (!isNumericOperand(left) || !isNumericOperand(right)) return undefined;
  } else if (op === "===" || op === "!==") {
    // 任意操作数：先 strictEqAbs（字面量 / nullish / 同 var）
  } else {
    // 比较：数值或字符串
    if (!isComparableOperand(left) || !isComparableOperand(right)) return undefined;
  }

  try {
    const la = toAbsWithTerms(left);
    const ra = toAbsWithTerms(right);
    const phi = currentPhi();

    if (op === "===" || op === "!==") {
      const eq = kStrictEq(la, ra);
      if (eq !== undefined) {
        return absToTypeValue(op === "===" ? boolLit(eq) : boolLit(!eq));
      }
      // 无法判定：数值同型走 cmp 挂 pred；否则交还调用方
      if (isNumericOperand(left) && isNumericOperand(right)) {
        return absToTypeValue(kCmp(op === "===" ? "eq" : "ne", la, ra, phi));
      }
      return undefined;
    }

    let result: Abs;
    if (op === "+") result = kAdd(la, ra, phi);
    else if (op === "-") result = kSub(la, ra, phi);
    else if (op === "*") result = kMul(la, ra, phi);
    else if (op === "/") result = kDiv(la, ra, phi);
    else if (op === "%") result = kMod(la, ra, phi);
    else if (op === "<") result = kCmp("lt", la, ra, phi);
    else if (op === "<=") result = kCmp("le", la, ra, phi);
    else if (op === ">") result = kCmp("gt", la, ra, phi);
    else if (op === ">=") result = kCmp("ge", la, ra, phi);
    else return undefined;

    return absToTypeValue(result);
  } catch {
    return undefined;
  }
}

/**
 * 一元语言表面经代数：typeof / ! / -。
 * 返回 undefined 表示调用方自行处理（union 分发等）。
 */
export function tryAbsUnary(
  op: string,
  operand: TypeValue,
): TypeValue | undefined {
  if (!UNARY_OPS.has(op)) return undefined;
  if (operand.kind === "union") {
    const outs: TypeValue[] = [];
    for (const m of operand.members) {
      const one = tryAbsUnary(op, m);
      if (one === undefined) return undefined;
      outs.push(one);
    }
    return simplifyUnion(outs);
  }
  try {
    const a = toAbsWithTerms(operand);
    if (op === "typeof") return absToTypeValue(kTypeof(a));
    if (op === "!") return absToTypeValue(kNot(a));
    if (op === "-") {
      if (!isNumericOperand(operand) && operand.kind !== "unknown") return undefined;
      return absToTypeValue(kNeg(a, currentPhi()));
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * 对象 spread 经代数（右侧覆盖，保留字面量）。
 * 返回 undefined 表示走 Object.assign 路径。
 */
export function tryAbsObjectSpread(
  base: TypeValue,
  over: TypeValue,
): TypeValue | undefined {
  if (base.kind !== "object" && base.kind !== "union") return undefined;
  if (over.kind !== "object" && over.kind !== "union") return undefined;
  try {
    const ba = toAbsWithTerms(base);
    const oa = toAbsWithTerms(over);
    const r = kSpread(ba, oa);
    return absToTypeValue(r);
  } catch {
    return undefined;
  }
}

/**
 * 对象 join（异 key 保持 sum，不折 optional）。
 */
export function tryAbsJoinObjects(
  a: TypeValue,
  b: TypeValue,
): TypeValue | undefined {
  if (a.kind !== "object" || b.kind !== "object") return undefined;
  try {
    const r = kJoinAbs(toAbsWithTerms(a), toAbsWithTerms(b));
    return absToTypeValue(r);
  } catch {
    return undefined;
  }
}
