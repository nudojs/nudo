/**
 * 数值界域（叶子模块）：numericBounds（pred/Φ 双来源区间 + issue #170
 * ne 等值排除端点收紧）与 isNonNaN（自 builtins/math.ts 移入——math 反向
 * 依赖本域，放 arithmetic 侧避免环）。
 *
 * 依赖方向不变量：叶子——不得 import arithmetic/ 内兄弟模块。
 */

import type { Term } from "../term.ts";
import { termEquals, termToString } from "../term.ts";
import type { Pred, Phi } from "../pred.ts";
import { pTrue } from "../pred.ts";
import type { Abs } from "../abs.ts";
import { isNumPrim } from "../abs.ts";

export type NumBounds = {
  lo?: { value: number; strict: boolean };
  hi?: { value: number; strict: boolean };
};

/**
 * 提取 Abs 上相对 term 的数值界。
 * 优先用自身 pred；否则查 Φ（针对 var id）。
 */
export function numericBounds(a: Abs, phi: Phi = pTrue): NumBounds | undefined {
  // sum（fork 合并臂）：成员界的并集。lo 取各成员 lo 的最小值
  // （同值取较弱者：非 strict），hi 对偶；任一成员该侧无界 ⇒
  // 整体该侧无界；成员完全无界信息 ⇒ 整体无界。
  // 此前 sum 直接落 isNumPrim 外的 undefined —— 合并后的字面量臂
  // （如 `s = cond ? 20 : 55`）丢掉全部界信息，下游 min/max 只能
  // 挂 NaN 臂 + 无界臂，对区间契约构成误报。
  if (a.shape.k === "sum") {
    const members = (a.shape as { k: "sum"; members: Abs[] }).members;
    let lo: NumBounds["lo"];
    let hi: NumBounds["hi"];
    let loOpen = false;
    let hiOpen = false;
    for (const m of members) {
      const mb = numericBounds(m, phi);
      if (!mb) return undefined;
      if (mb.lo === undefined) {
        loOpen = true;
      } else if (!loOpen) {
        if (
          lo === undefined ||
          mb.lo.value < lo.value ||
          (mb.lo.value === lo.value && !mb.lo.strict && lo.strict)
        ) {
          lo = mb.lo;
        }
      }
      if (mb.hi === undefined) {
        hiOpen = true;
      } else if (!hiOpen) {
        if (
          hi === undefined ||
          mb.hi.value > hi.value ||
          (mb.hi.value === hi.value && !mb.hi.strict && hi.strict)
        ) {
          hi = mb.hi;
        }
      }
    }
    if (loOpen) lo = undefined;
    if (hiOpen) hi = undefined;
    if (lo === undefined && hi === undefined) return undefined;
    return { lo, hi };
  }
  if (!isNumPrim(a)) return undefined;
  const result: NumBounds = {};

  // 自身 pred 中关于 term 的界
  if (a.pred && a.term) {
    collectBoundsFromPred(a.pred, a.term, result);
  }
  // Φ 中关于 var 的界
  if (a.term?.op === "var") {
    collectBoundsFromPhi(phi, a.term.id, result);
  }
  // 等值排除收紧（issue #170）：rel 界全部收齐后跑——ne 可能在另一来源
  // （pred 收 ge、Φ 收 ne，或反之），顺序无关须两遍。
  if (a.pred && a.term) {
    collectExclusionsFromPred(a.pred, a.term, result);
  }
  if (a.term?.op === "var") {
    collectExclusionsFromPhi(phi, a.term.id, result);
  }
  // 字面量：上下界都是自身（NaN 无序，不得当端点）
  if (a.term?.op === "lit" && typeof a.term.value === "number" && !Number.isNaN(a.term.value)) {
    result.lo = { value: a.term.value, strict: false };
    result.hi = { value: a.term.value, strict: false };
  }

  if (result.lo === undefined && result.hi === undefined) return undefined;
  return result;
}

/** 等值处收紧界：更紧的值 / 等值时 strict 胜出（le→gt 顺序无关） */
function tightenLo(acc: NumBounds, n: number, strict: boolean): void {
  if (acc.lo === undefined || n > acc.lo.value || (n === acc.lo.value && strict && !acc.lo.strict)) {
    acc.lo = { value: n, strict };
  }
}

function tightenHi(acc: NumBounds, n: number, strict: boolean): void {
  if (acc.hi === undefined || n < acc.hi.value || (n === acc.hi.value && strict && !acc.hi.strict)) {
    acc.hi = { value: n, strict };
  }
}

/**
 * 关系原子 → 对 term 的数值界。两侧都认：
 *   t > n / n < t → lo strict；t ≥ n / n ≤ t → lo
 *   t < n / n > t → hi strict；t ≤ n / n ≥ t → hi
 * （旧实现只认「变量在左」，`0 < x` / `5 > x` 的界被整段丢掉。）
 */
function noteBoundFromRel(p: Pred, isTarget: (t: Term) => boolean, acc: NumBounds): void {
  if (p.op !== "gt" && p.op !== "ge" && p.op !== "lt" && p.op !== "le") return;
  let op = p.op;
  let litSide: Term;
  if (isTarget(p.a) && p.b.op === "lit" && typeof p.b.value === "number") {
    litSide = p.b;
  } else if (isTarget(p.b) && p.a.op === "lit" && typeof p.a.value === "number") {
    // 翻转：`n < t` ≡ `t > n`
    op = op === "gt" ? "lt" : op === "lt" ? "gt" : op === "ge" ? "le" : "ge";
    litSide = p.a;
  } else {
    return;
  }
  const n = (litSide as { value: number }).value;
  // Bug B：NaN 无序——gt(x, NaN) / x ≤ NaN 等恒假，NaN 不是端点（与
  // exclusionLitOf 口径对齐）。修复前 NaN 先到先得占住端点（tighten 的
  // NaN 比较恒 false 改不动它），再向区间合成传播，只能靠下游
  // ieeeBound 的 NaN→undefined 消毒。
  if (Number.isNaN(n)) return;
  if (op === "gt") tightenLo(acc, n, true);
  else if (op === "ge") tightenLo(acc, n, false);
  else if (op === "lt") tightenHi(acc, n, true);
  else tightenHi(acc, n, false);
}

function collectBoundsFromPred(pred: Pred, term: Term, acc: NumBounds): void {
  const isTarget = (t: Term): boolean => termToString(t) === termToString(term);
  const apply = (p: Pred): void => {
    if (p.op === "and") {
      p.args.forEach(apply);
      return;
    }
    noteBoundFromRel(p, isTarget, acc);
  };
  apply(pred);
}

function collectBoundsFromPhi(phi: Phi, id: string, acc: NumBounds): void {
  const isTarget = (t: Term): boolean => t.op === "var" && t.id === id;
  const conjs = phi.op === "and" ? phi.args : [phi];
  for (const p of conjs) {
    noteBoundFromRel(p, isTarget, acc);
  }
}

/**
 * 等值排除收紧端点（issue #170）：`ne(t, n)` 与已收端点同值时非严格界
 * 变严格——`x !== 0` 守卫假臂 ∧ `x ≥ 0` ⇒ `x > 0`（`max === 0 ? 1 :
 * 1 - d/max` 的分母正性由此供出；else 臂 Φ 经 falseConstraint 得
 * ne(var, lit)）。端点不同值时区间减点不可表示 → 不动。ne(t, NaN) 是
 * 非 NaN 事实而非端点排除（NaN 无序），跳过。
 */
function noteStrictExclusion(p: Pred, isTarget: (t: Term) => boolean, acc: NumBounds): void {
  if (p.op !== "ne") return;
  const num = exclusionLitOf(p, isTarget);
  if (num === undefined) return;
  if (acc.lo !== undefined && acc.lo.value === num && !acc.lo.strict) {
    acc.lo = { value: num, strict: true };
  }
  if (acc.hi !== undefined && acc.hi.value === num && !acc.hi.strict) {
    acc.hi = { value: num, strict: true };
  }
}

/** ne 原子中面向 target 的数值字面量（两侧对称；NaN 排除） */
function exclusionLitOf(p: Pred & { op: "ne" }, isTarget: (t: Term) => boolean): number | undefined {
  if (isTarget(p.a) && p.b.op === "lit" && typeof p.b.value === "number" && !Number.isNaN(p.b.value)) {
    return p.b.value;
  }
  if (isTarget(p.b) && p.a.op === "lit" && typeof p.a.value === "number" && !Number.isNaN(p.a.value)) {
    return p.a.value;
  }
  return undefined;
}

function collectExclusionsFromPred(pred: Pred, term: Term, acc: NumBounds): void {
  const isTarget = (t: Term): boolean => termToString(t) === termToString(term);
  const apply = (p: Pred): void => {
    if (p.op === "and") {
      p.args.forEach(apply);
      return;
    }
    noteStrictExclusion(p, isTarget, acc);
  };
  apply(pred);
}

function collectExclusionsFromPhi(phi: Phi, id: string, acc: NumBounds): void {
  const isTarget = (t: Term): boolean => t.op === "var" && t.id === id;
  const conjs = phi.op === "and" ? phi.args : [phi];
  for (const p of conjs) {
    noteStrictExclusion(p, isTarget, acc);
  }
}

/**
 * 操作数是否确定不是 NaN：非 NaN 字面量 / 数值界 / ne(t,NaN) / assumeFinite。
 * （自 builtins/math.ts 移入——arithmetic 的 sub 自反折叠（#175）要消费，
 * math 侧 min/max/rounding 同用；math 反向依赖 arithmetic（numericBounds），
 * 放此处避免环。）
 */
export function isNonNaN(a: Abs, phi: Phi): boolean {
  if (a.term?.op === "lit") {
    return typeof a.term.value === "number" && !Number.isNaN(a.term.value);
  }
  // sum（fork 合并臂）：所有成员均可证非 NaN ⇒ 整体非 NaN。
  // 此前 sum 落到 term/pred 检查全失败 ⇒ mayNaN ⇒ min/max 误挂
  // NaN 臂，区间契约（number().ge(0).le(100)）被误报违反。
  if (a.shape.k === "sum") {
    return (a.shape as { k: "sum"; members: Abs[] }).members.every((m) =>
      isNonNaN(m, phi),
    );
  }
  const hasNonNaNFact = (p: Pred | undefined): boolean => {
    if (!p) return false;
    if (p.op === "and") return p.args.some(hasNonNaNFact);
    if (p.op === "assumeFinite") {
      // termless Abs 无法对齐具体 assumeFinite —— 不得采信
      return !!a.term && termEquals(p.t, a.term);
    }
    if (p.op === "ne") {
      // ne(t, NaN) ≡ t 不是 NaN
      if (
        p.b.op === "lit" &&
        typeof p.b.value === "number" &&
        Number.isNaN(p.b.value) &&
        a.term &&
        termEquals(p.a, a.term)
      ) {
        return true;
      }
    }
    if (p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le") {
      // 数值界排除 NaN（NaN 比较全假）
      if (a.term && (termEquals(p.a, a.term) || termEquals(p.b, a.term))) return true;
    }
    return false;
  };
  if (hasNonNaNFact(a.pred)) return true;
  if (a.term?.op === "var") {
    const id = (a.term as { id: string }).id;
    const conjs = phi.op === "and" ? phi.args : [phi];
    for (const p of conjs) {
      if (p.op === "assumeFinite" && p.t.op === "var" && (p.t as { id: string }).id === id) {
        return true;
      }
      if (p.op === "ne") {
        const b = p.b;
        if (
          b.op === "lit" &&
          typeof b.value === "number" &&
          Number.isNaN(b.value) &&
          p.a.op === "var" &&
          (p.a as { id: string }).id === id
        ) {
          return true;
        }
      }
      if (p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le") {
        const sides = [p.a, p.b];
        if (
          sides.some((t) => t.op === "var" && (t as { id: string }).id === id) &&
          sides.some((t) => t.op === "lit" && typeof t.value === "number")
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

