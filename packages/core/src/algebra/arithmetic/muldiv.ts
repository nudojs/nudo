/**
 * 乘除模域：mul/div/mod 的区间单调性折叠；divAssumeBounds（issue #152
 * 同名相关性除法界）与 div 的 0/x 字面量折叠（#170）在此消费。
 *
 * 依赖方向不变量：只 import 叶子（shared/coerce/bounds）；不得 import
 * 兄弟域（addsub/cmp）或 facade。
 */

import type { Term } from "../term.ts";
import { app, lit, simplifyTerm, termEquals } from "../term.ts";
import type { Pred, Phi } from "../pred.ts";
import { and, gt, ge, lt, le, pTrue } from "../pred.ts";
import type { Abs } from "../abs.ts";
import { abs, confJoin, isStrPrim, isBigPrim, litValue, num, numLit } from "../abs.ts";
import { isSymbolAbs as isSym } from "../symbol-id.ts";
import { NudoThrow } from "../nudo-throw.ts";
import { errorTypeAbs } from "../may-throw.ts";
import { distributeSumBinOp, ieeeBound, isAnyLike, coercibleLit, toNumberResult, isNumericLike, assumePremiseList } from "./shared.ts";
import { builtinBrandToPrimitive, noteAbstractArithMayThrow, foldBigintBinOp } from "./coerce.ts";
import { numericBounds } from "./bounds.ts";

/** 乘法：字面量直接求值；×正数同向缩放；×负数翻转不等式；×0 归零 */
export function mul(a: Abs, b: Abs, phi: Phi = pTrue): Abs {
  // Bug 25：内建 brand ToPrimitive（hint number）——见 sub 同款注释
  {
    const fa = builtinBrandToPrimitive(a, "number");
    const fb = builtinBrandToPrimitive(b, "number");
    if (fa || fb) return mul(fa ?? a, fb ?? b, phi);
  }
  // Symbol 参与算术/位运算：ToNumber/ToNumeric 原生 TypeError（与 add 同口径）
  if (isSym(a) || isSym(b)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  const ra = litValue(a);
  const rb = litValue(b);
  const big = foldBigintBinOp(a, b, (x, y) => x * y);
  if (big) return big;
  if (isBigPrim(a) && isBigPrim(b)) {
    return abs({ k: "prim", type: "bigint" }, undefined, undefined, confJoin(a.conf, b.conf));
  }
  if (ra.ok && rb.ok && typeof ra.value === "number" && typeof rb.value === "number") {
    return numLit(ra.value * rb.value);
  }
  if (ra.ok && rb.ok && coercibleLit(ra.value) && coercibleLit(rb.value)) {
    return numLit(Number(ra.value) * Number(rb.value));
  }
  if (isNumericLike(a) && isNumericLike(b) && a.term && b.term) {
    const term = simplifyTerm(app("*", [a.term, b.term]));
    // × 常数 k（不可用 ×0=0：NaN*0 / Infinity*0 为 NaN）
    let k: number | undefined;
    let base: Abs | undefined;
    if (b.term.op === "lit" && typeof b.term.value === "number") {
      k = b.term.value;
      base = a;
    } else if (a.term.op === "lit" && typeof a.term.value === "number") {
      k = a.term.value;
      base = b;
    }
    if (k !== undefined && base !== undefined && k !== 0 && Number.isFinite(k)) {
      // |k|≥1 不会把正值下溢成 0，strict 0 端点可保留（x>0 * 2 ⇒ >0）
      const strictZeroOk = Math.abs(k) >= 1;
      const ab = numericBounds(base, phi);
      const facts: Pred[] = [];
      if (ab?.lo !== undefined) {
        if (k > 0) {
          const lo = ieeeBound(ab.lo.value * k, ab.lo.strict, strictZeroOk);
          if (lo !== undefined) facts.push(ab.lo.strict ? gt(term, lit(lo)) : ge(term, lit(lo)));
        } else {
          // 负数：lo * k 变成上界
          const hi = ieeeBound(ab.lo.value * k, ab.lo.strict, strictZeroOk);
          if (hi !== undefined) facts.push(ab.lo.strict ? lt(term, lit(hi)) : le(term, lit(hi)));
        }
      }
      if (ab?.hi !== undefined) {
        if (k > 0) {
          const hi = ieeeBound(ab.hi.value * k, ab.hi.strict, strictZeroOk);
          if (hi !== undefined) facts.push(ab.hi.strict ? lt(term, lit(hi)) : le(term, lit(hi)));
        } else {
          const lo = ieeeBound(ab.hi.value * k, ab.hi.strict, strictZeroOk);
          if (lo !== undefined) facts.push(ab.hi.strict ? gt(term, lit(lo)) : ge(term, lit(lo)));
        }
      }
      return abs(
        { k: "prim", type: "number" },
        term,
        facts.length ? and(...facts) : undefined,
        term.op === "lit" ? "exact" : confJoin(a.conf, "path"),
      );
    }
    return abs(
      { k: "prim", type: "number" },
      term,
      undefined,
      term.op === "lit" ? "exact" : confJoin(confJoin(a.conf, b.conf), "path"),
    );
  }
  // number prim（无 term）× number prim → number（与 TypeValue 对齐）
  if (isNumericLike(a) && isNumericLike(b)) {
    return abs({ k: "prim", type: "number" }, undefined, undefined, "partial");
  }
  // Bug 25：抽象 string prim ⊗ 数值面（内建 brand ToPrimitive → toString 折
  // string 域后落此；ToNumber(string) → number）——恒 total（string prim
  // 不可能是 Symbol/bigint）
  if (isStrPrim(a) || isStrPrim(b)) {
    return abs({ k: "prim", type: "number" }, undefined, undefined, "partial");
  }
  if (isAnyLike(a) || isAnyLike(b)) {
    return toNumberResult(a, b, "*");
  }
  // sum 分发（与 add 同口径）：2 * (cond ? 20 : 55) → 40 | 110
  const distributed = distributeSumBinOp("*", a, b, phi, mul);
  if (distributed) return distributed;
  // Bug 8：obj/fn/brand 抽象面回退（`x.a * 2`，valueOf 可能产 bigint/Symbol）→ may TypeError
  noteAbstractArithMayThrow(a, b);
  return abs({ k: "unknown" }, undefined, undefined, "partial");
}

/**
 * assume 引理的同名相关性除法界（issue #152 `@nudo:assume d <= max`）：
 * 分子分母同名相关是独立区间传播证不出的——独立代入 a.hi/b.lo 会得 ±∞，
 * 只有用户引理提供的相关性可折。前提归一化为 le(lhs, rhs)（`a >= b`
 * 构造期已翻转），项匹配用 termEquals（var 名恒等 / app 结构等价）。
 *   正分母（b > 0，须**严格**——b ≥ 0 非严格不排除 0，n/0=±Inf 界失效）：
 *     a ≤ b ⇒ a/b ≤ 1；a ≥ b ⇒ a/b ≥ 1；a ≥ 0 ⇒ a/b ≥ 0；a ≤ 0 ⇒ a/b ≤ 0
 *   负分母（b < 0）镜像：除以负数不等号反向——a ≤ b < 0 ⇒ a/b ≥ 1，
 *     a ≥ 0 ∧ b < 0 ⇒ a/b ≤ 0 等。
 * 分子侧符号界与关系界按区间语义合取（and 合并；strict 随分子界保留）。
 * ±Inf 同名端点对（a=b=±Inf ⇒ a/b=NaN）与既有 path facts 同约定，不另设防。
 * 无前提命中（项不匹配）/无分母符号知识 → undefined（保守回退，与现状一致）。
 */
function divAssumeBounds(
  a: Abs,
  b: Abs,
  resultTerm: Term,
  phi: Phi,
  assume: Phi | undefined,
): Pred | undefined {
  const premises = assumePremiseList(assume);
  if (premises.length === 0) return undefined;
  if (!a.term || !b.term) return undefined;
  const bb = numericBounds(b, phi);
  const posDen = bb?.lo !== undefined && (bb.lo.value > 0 || (bb.lo.value === 0 && bb.lo.strict));
  const negDen = bb?.hi !== undefined && (bb.hi.value < 0 || (bb.hi.value === 0 && bb.hi.strict));
  if (!posDen && !negDen) return undefined;
  let aLeB = false; // a ≤ b（le(a.term, b.term) 命中）
  let bLeA = false; // a ≥ b（le(b.term, a.term) 命中）
  for (const p of premises) {
    if (p.op !== "le") continue;
    if (termEquals(p.a, a.term) && termEquals(p.b, b.term)) aLeB = true;
    else if (termEquals(p.a, b.term) && termEquals(p.b, a.term)) bLeA = true;
  }
  // soundness：引理与操作数项不匹配 → 不得产生任何界
  if (!aLeB && !bLeA) return undefined;
  const facts: Pred[] = [];
  if (aLeB) facts.push(posDen ? le(resultTerm, lit(1)) : ge(resultTerm, lit(1)));
  if (bLeA) facts.push(posDen ? ge(resultTerm, lit(1)) : le(resultTerm, lit(1)));
  const ab = numericBounds(a, phi);
  if (ab?.lo !== undefined && (ab.lo.value > 0 || ab.lo.value === 0)) {
    // a ≥ 0（strict 时 a > 0）
    if (posDen) facts.push(ab.lo.strict ? gt(resultTerm, lit(0)) : ge(resultTerm, lit(0)));
    else facts.push(ab.lo.strict ? lt(resultTerm, lit(0)) : le(resultTerm, lit(0)));
  }
  if (ab?.hi !== undefined && (ab.hi.value < 0 || ab.hi.value === 0)) {
    // a ≤ 0
    if (posDen) facts.push(ab.hi.strict ? lt(resultTerm, lit(0)) : le(resultTerm, lit(0)));
    else facts.push(ab.hi.strict ? gt(resultTerm, lit(0)) : ge(resultTerm, lit(0)));
  }
  return facts.length ? and(...facts) : undefined;
}

/**
 * 除法：字面量折叠；除以正/负常数时按单调性推界。
 * 除以 0：JS 语义为 ±Infinity / NaN，shape 仍 number（不报违例）。
 */
export function div(a: Abs, b: Abs, phi: Phi = pTrue, assume?: Phi): Abs {
  // Bug 25：内建 brand ToPrimitive（hint number）——见 sub 同款注释
  {
    const fa = builtinBrandToPrimitive(a, "number");
    const fb = builtinBrandToPrimitive(b, "number");
    if (fa || fb) return div(fa ?? a, fb ?? b, phi);
  }
  // Symbol 参与算术/位运算：ToNumber/ToNumeric 原生 TypeError（与 add 同口径）
  if (isSym(a) || isSym(b)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  const ra = litValue(a);
  const rb = litValue(b);
  const va = ra.ok ? ra.value : undefined;
  const vb = rb.ok ? rb.value : undefined;
  const big = foldBigintBinOp(a, b, (x, y) => x / y);
  if (big) return big;
  if (isBigPrim(a) && isBigPrim(b)) {
    return abs({ k: "prim", type: "bigint" }, undefined, undefined, confJoin(a.conf, b.conf));
  }
  if (typeof va === "number" && typeof vb === "number") {
    if (vb === 0) {
      // JS：0/0=NaN，n/0=±Infinity —— 保留字面量语义
      return numLit(va / vb);
    }
    return numLit(va / vb);
  }
  // issue #170：`0 / x`（+0 字面量分子，x 可证非零且非 NaN）= +0。
  // 叉积 sum 的字面量 0 臂（`d = cond ? 0 : …; d / max`）无项可匹配
  // assume 引理 / 单调性界，join 后污染整体上界；分母界一旦排除 0
  // （端点严格或整体在同号半轴）即可字面量折叠。界存在本身排除 NaN
  // （比较 pred 对 NaN 全假）；-0 分子不折（-0/x = -0，lit 归一化会丢负零）。
  if (va === 0 && !Object.is(va, -0)) {
    const bb = numericBounds(b, phi);
    const excludesZero =
      bb !== undefined &&
      ((bb.lo !== undefined && (bb.lo.value > 0 || (bb.lo.value === 0 && bb.lo.strict))) ||
        (bb.hi !== undefined && (bb.hi.value < 0 || (bb.hi.value === 0 && bb.hi.strict))));
    if (excludesZero) return numLit(0);
  }
  if (ra.ok && rb.ok && coercibleLit(ra.value) && coercibleLit(rb.value)) {
    return numLit(Number(va) / Number(vb));
  }
  if (isNumericLike(a) && isNumericLike(b) && a.term && b.term) {
    const term = simplifyTerm(app("/", [a.term, b.term]));
    if (
      b.term.op === "lit" &&
      typeof b.term.value === "number" &&
      b.term.value !== 0 &&
      Number.isFinite(b.term.value)
    ) {
      const k = b.term.value;
      // |k|≤1 时 x/k 不会把正值下溢成 0；|k|>1 可以（5e-324/2→0）
      const strictZeroOk = Math.abs(k) <= 1;
      const ab = numericBounds(a, phi);
      const facts: Pred[] = [];
      if (ab?.lo !== undefined) {
        const lo = ieeeBound(ab.lo.value / k, ab.lo.strict, strictZeroOk);
        if (lo !== undefined) {
          if (k > 0) facts.push(ab.lo.strict ? gt(term, lit(lo)) : ge(term, lit(lo)));
          else facts.push(ab.lo.strict ? lt(term, lit(lo)) : le(term, lit(lo)));
        }
      }
      if (ab?.hi !== undefined) {
        const hi = ieeeBound(ab.hi.value / k, ab.hi.strict, strictZeroOk);
        if (hi !== undefined) {
          if (k > 0) facts.push(ab.hi.strict ? lt(term, lit(hi)) : le(term, lit(hi)));
          else facts.push(ab.hi.strict ? gt(term, lit(hi)) : ge(term, lit(hi)));
        }
      }
      return abs(
        num().shape,
        term,
        facts.length ? and(...facts) : undefined,
        term.op === "lit" ? "exact" : confJoin(confJoin(a.conf, b.conf), "path"),
      );
    }
    // assume 引理（issue #152）：同名相关性界。下游 sub 等折叠经
    // numericBounds 消费本界 → `1 - d/max ∈ [0,1]` 这类返回契约可证。
    const assumePred = divAssumeBounds(a, b, term, phi, assume);
    return abs(
      num().shape,
      term,
      assumePred,
      confJoin(confJoin(a.conf, b.conf), "path"),
    );
  }
  if (isNumericLike(a) && isNumericLike(b)) {
    return abs(num().shape, undefined, undefined, "partial");
  }
  // Bug 25：抽象 string prim ⊗ 数值面（内建 brand ToPrimitive → toString 折
  // string 域后落此；ToNumber(string) → number）——恒 total（string prim
  // 不可能是 Symbol/bigint）
  if (isStrPrim(a) || isStrPrim(b)) {
    return abs({ k: "prim", type: "number" }, undefined, undefined, "partial");
  }
  if (isAnyLike(a) || isAnyLike(b)) {
    return toNumberResult(a, b, "/");
  }
  // sum 分发（与 add 同口径）；成员级同构透传 assume——成员臂内项匹配仍以
  // termEquals 为准（不匹配的成员不产生界），soundness 不变
  const distributed = distributeSumBinOp("/", a, b, phi, (x, y, p) => div(x, y, p, assume));
  if (distributed) return distributed;
  // Bug 8：obj/fn/brand 抽象面回退（`x.a / 2`，valueOf 可能产 bigint/Symbol）→ may TypeError
  noteAbstractArithMayThrow(a, b);
  return abs({ k: "unknown" }, undefined, undefined, "partial");
}

/**
 * 取模：字面量折叠；`x % k`（k 为有限非零字面量）仅当被除数有限时
 * 结果界在 (−|k|, |k|)。整数模可收紧到 [0, k)，此处先做保守实数界。
 * `n % 0` / `x % 0` / `x % NaN` 恒为 NaN（JS）。
 */
export function mod(a: Abs, b: Abs, phi: Phi = pTrue): Abs {
  // Bug 25：内建 brand ToPrimitive（hint number）——见 sub 同款注释
  {
    const fa = builtinBrandToPrimitive(a, "number");
    const fb = builtinBrandToPrimitive(b, "number");
    if (fa || fb) return mod(fa ?? a, fb ?? b, phi);
  }
  // Symbol 参与算术/位运算：ToNumber/ToNumeric 原生 TypeError（与 add 同口径）
  if (isSym(a) || isSym(b)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  const ra = litValue(a);
  const rb = litValue(b);
  const va = ra.ok ? ra.value : undefined;
  const vb = rb.ok ? rb.value : undefined;
  const big = foldBigintBinOp(a, b, (x, y) => x % y);
  if (big) return big;
  if (isBigPrim(a) && isBigPrim(b)) {
    return abs({ k: "prim", type: "bigint" }, undefined, undefined, confJoin(a.conf, b.conf));
  }
  if (typeof va === "number" && typeof vb === "number") {
    // JS：n % 0 === NaN（含 0%0 / NaN%0 / ±Infinity%0）——直接折字面量
    return numLit(va % vb);
  }
  if (ra.ok && rb.ok && coercibleLit(ra.value) && coercibleLit(rb.value)) {
    return numLit(Number(va) % Number(vb));
  }
  if (isNumericLike(a) && isNumericLike(b) && a.term && b.term) {
    const term = simplifyTerm(app("%", [a.term, b.term]));
    // number 域：x % 0 与 x % NaN 恒 NaN
    if (b.term.op === "lit") {
      const bv = b.term.value;
      if (typeof bv === "number" && (bv === 0 || Number.isNaN(bv))) {
        return numLit(NaN);
      }
    }
    if (b.term.op === "lit" && typeof b.term.value === "number" && Number.isFinite(b.term.value) && b.term.value !== 0) {
      const k = Math.abs(b.term.value);
      // (−k, k) 只对有限被除数成立：Inf%k 与 NaN%k 皆为 NaN，不在界内
      const ab = numericBounds(a, phi);
      const finiteDividend =
        ab?.lo !== undefined &&
        ab?.hi !== undefined &&
        Number.isFinite(ab.lo.value) &&
        Number.isFinite(ab.hi.value);
      if (finiteDividend) {
        return abs(
          num().shape,
          term,
          and(gt(term, lit(-k)), lt(term, lit(k))),
          confJoin(confJoin(a.conf, b.conf), "path"),
        );
      }
    }
    return abs(num().shape, term, undefined, confJoin(confJoin(a.conf, b.conf), "path"));
  }
  if (isNumericLike(a) && isNumericLike(b)) {
    return abs(num().shape, undefined, undefined, "partial");
  }
  // Bug 25：抽象 string prim ⊗ 数值面（内建 brand ToPrimitive → toString 折
  // string 域后落此；ToNumber(string) → number）——恒 total（string prim
  // 不可能是 Symbol/bigint）
  if (isStrPrim(a) || isStrPrim(b)) {
    return abs({ k: "prim", type: "number" }, undefined, undefined, "partial");
  }
  if (isAnyLike(a) || isAnyLike(b)) {
    return toNumberResult(a, b, "%");
  }
  // sum 分发（与 add 同口径）
  const distributed = distributeSumBinOp("%", a, b, phi, mod);
  if (distributed) return distributed;
  // Bug 8：obj/fn/brand 抽象面回退（`x.a % 2`，valueOf 可能产 bigint/Symbol）→ may TypeError
  noteAbstractArithMayThrow(a, b);
  return abs({ k: "unknown" }, undefined, undefined, "partial");
}

