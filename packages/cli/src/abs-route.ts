/**
 * TypeValue IR ⇄ Abs 代数的路由。
 *
 * 唯一计算路径：算术 / 比较 / 对象 spread 先走 Abs；代数未覆盖的语言表面
 * （除法、%、===、无结构字符串、union 分发）才回落外延 Ops。
 * TypeValue 是评估 IR，不是平行类型系统。
 */

import type { TypeValue } from "@nudojs/core";
import {
  typeValueToAbs,
  absToTypeValue,
  add as kAdd,
  sub as kSub,
  mul as kMul,
  cmp as kCmp,
  type Abs,
  type Pred,
  pTrue,
  and as predAnd,
  ge as predGe,
  le as predLe,
  lit as termLit,
  getRangeMeta,
  spread as kSpread,
  joinAbs as kJoinAbs,
  abs as makeAbs,
  currentPhi,
  pushPhi,
  popPhi,
  resetPhi,
  withPhiConstraint,
  describePhi,
} from "@nudojs/core";
import { getTerm, getPred } from "./term-registry.ts";

export { currentPhi, pushPhi, popPhi, resetPhi, withPhiConstraint, describePhi };

const ARITH_OPS = new Set(["+", "-", "*"]);
const CMP_OPS = new Set(["<", "<=", ">", ">="]);

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
 * range refined 编码为 term 上的 Pred（唯一约束通道），不再靠 refinement.ops。
 */
function toAbsWithTerms(tv: TypeValue): Abs {
  const base = typeValueToAbs(tv);
  const term = getTerm(tv);
  const pred = getPred(tv);
  let abs: Abs =
    !term && !pred && !getRangeMeta(tv)
      ? base
      : makeAbs(base.shape, term ?? base.term, pred ?? base.pred, base.conf);

  const range = getRangeMeta(tv);
  if (range && abs.term) {
    const facts: Pred[] = [];
    if (range.min != null) facts.push(predGe(abs.term, termLit(range.min)));
    if (range.max != null) facts.push(predLe(abs.term, termLit(range.max)));
    if (facts.length > 0) {
      const existing = abs.pred && abs.pred.op !== "true" ? abs.pred : undefined;
      abs = makeAbs(
        abs.shape,
        abs.term,
        existing ? predAnd(existing, ...facts) : predAnd(...facts),
        abs.conf,
      );
    }
  }
  return abs;
}

/**
 * 代数计算二元算术/比较。
 * undefined = 不可处理（union、非数/串操作数）→ 外延路径兜底。
 */
export function tryAbsBinary(
  op: string,
  left: TypeValue,
  right: TypeValue,
): TypeValue | undefined {
  if (!ARITH_OPS.has(op) && !CMP_OPS.has(op)) return undefined;

  if (op === "+") {
    if (!canAdd(left, right)) return undefined;
  } else if (op === "-" || op === "*") {
    if (!isNumericOperand(left) || !isNumericOperand(right)) return undefined;
  } else {
    if (!isNumericOperand(left) || !isNumericOperand(right)) return undefined;
  }

  try {
    const la = toAbsWithTerms(left);
    const ra = toAbsWithTerms(right);
    const phi = currentPhi();
    let result: Abs;

    if (op === "+") result = kAdd(la, ra, phi);
    else if (op === "-") result = kSub(la, ra, phi);
    else if (op === "*") result = kMul(la, ra, phi);
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
