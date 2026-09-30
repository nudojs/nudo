/**
 * 算术核：单调性 + 常量折叠 + 约束传播。
 * 这是「类型即计算」的主武器——x>0 时 x+1 必须得到 >1。
 */

import type { LiteralValue, Term } from "./term.ts";
import { app, lit, simplifyTerm, termToString } from "./term.ts";
import type { Pred } from "./pred.ts";
import {
  and,
  gt,
  ge,
  lt,
  le,
  implies,
  negatePred,
  totalOrderDual,
  predToString,
  pTrue,
  ptypeof,
  type Phi,
} from "./pred.ts";
import type { Abs } from "./abs.ts";
import {
  abs,
  confJoin,
  isNumPrim,
  isStrPrim,
  isBigPrim,
  bigintLit,
  litValue,
  num,
  numLit,
  str,
  bool,
  boolLit,
  never,
} from "./abs.ts";
import { concatString, isTemplateLike } from "./template.ts";
import { makeSum, absShapeKey } from "./objects.ts";
import { noteDerivationAdd } from "./derivation.ts";
import { isSymbolAbs as isSym } from "./symbol-id.ts";
import { NudoThrow } from "./exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "./exec/may-throw.ts";

/**
 * 抽象加法：eval(a + b) —— 跟真实 JS，不无根据地假定 number。
 * 1. 双方字面量 → 直接求值
 * 2. 双方 number prim → term + 单调性 pred，shape=number
 * 3. 含 string/template → 拼接
 * 4. any / type-var 参与 → 按 JS + 的可能结果取并集：number | string
 *    （bool/null 走 ToNumber→number；object 默认 ToPrimitive→string；
 *      bigint/symbol 边角不在默认并集里，由调用点实例化再收窄）
 *    无契约的 score(x){return x+1}：score("x") 合法，不得钉成 number。
 */
export function add(a: Abs, b: Abs, phi: Phi = pTrue): Abs {
  // Symbol 参与 + / 模板：隐式 ToString 原生 TypeError（String(sym) 走 evalGlobalFn 不抛）
  if (isSym(a) || isSym(b)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // 字面量快速路径（tagged：.ok 才是字面量，含 lit(undefined)）
  const ra = litValue(a);
  const rb = litValue(b);
  if (ra.ok && rb.ok) {
    const va = ra.value;
    const vb = rb.value;
    if (typeof va === "number" && typeof vb === "number") {
      return numLit(va + vb);
    }
    // 含 string → 走 ToString 拼接（bigint 也可 ToString：10n+'' === "10"）
    if (typeof va === "string" || typeof vb === "string") {
      return strLitResult(String(va) + String(vb));
    }
    // 非 string 的混合 bigint⊗number/bool/null/undefined：ToNumeric 混型 TypeError
    if (
      (typeof va === "bigint" && typeof vb !== "bigint") ||
      (typeof vb === "bigint" && typeof va !== "bigint")
    ) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  }
  // 字符串拼接（含 template parts）—— JS + 优先走 string：
  // `1n + "s" === "1s"`（ToString），不得落进 bigint 混型硬抛。
  if (isStrPrim(a) || isStrPrim(b) || isTemplateLike(a) || isTemplateLike(b)) {
    return concatString(a, b);
  }
  // boolean/null 字面量与数字混合：ToNumber 折叠（与 sub/mul/div/mod 同口径；
  // native 10 + true = 11、2 + null = 2；undefined 参与恒 NaN 不折）
  if (ra.ok && rb.ok && coercibleLit(ra.value) && coercibleLit(rb.value)) {
    return numLit(Number(ra.value) + Number(rb.value));
  }
  const big = foldBigintBinOp(a, b, (x, y) => x + y);
  if (big) return big;
  if (isBigPrim(a) && isBigPrim(b)) {
    return abs({ k: "prim", type: "bigint" }, undefined, undefined, confJoin(a.conf, b.conf));
  }

  // 数组 ToPrimitive = join(",")，结果恒 string：`[] + []`→""、`[1] + 1`→"11"
  //（不得落进 number|string 并集——数组侧不会产出 number）
  if (a.shape.k === "tuple" || a.shape.k === "arr" || b.shape.k === "tuple" || b.shape.k === "arr") {
    return concatString(a, b);
  }

  // 双方 number prim：数值加法 + 约束传播
  if (isNumPrim(a) && isNumPrim(b)) {
    if (!a.term || !b.term) {
      return abs(num().shape, undefined, undefined, confJoin(a.conf, "widened"));
    }
    const term = simplifyTerm(app("+", [a.term, b.term]));
    const pred = addPred(a, b, term, phi);
    const conf =
      term.op === "lit" ? "exact" : confJoin(confJoin(a.conf, b.conf), "path");
    const result = abs({ k: "prim", type: "number" }, term, pred, conf);
    // 推导图打点（§14.3#6）：a+k 且 a 带 root/shift 标签 → 结果挂 shift 边
    noteDerivationAdd(a, b, result);
    return result;
  }

  // any / type-var：JS + 的并集，不是 unknown，也不是 number。
  // 一侧是 bigint 面时结果只能是 bigint（对面实为 bigint）或 string（ToString），
  // 不是 number——`1n + 1` 已在上游 TypeError。
  if (isAnyLike(a) || isAnyLike(b)) {
    const term =
      a.term && b.term ? simplifyTerm(app("+", [a.term, b.term])) : undefined;
    const bigFace = isBigPrim(a) || isBigPrim(b);
    return abs(
      {
        k: "sum",
        members: bigFace
          ? [abs({ k: "prim", type: "bigint" }, undefined, undefined, "exact"), str()]
          : [num(), str()],
      },
      term,
      undefined,
      "partial",
    );
  }

  // sum 分发：对每个成员做 +，再 join（(x+1)+1 在 any 上仍是 number|string）
  if (a.shape.k === "sum" || b.shape.k === "sum") {
    const parts: Abs[] = [];
    const as = a.shape.k === "sum" ? a.shape.members : [a];
    const bs = b.shape.k === "sum" ? b.shape.members : [b];
    for (const x of as) {
      for (const y of bs) {
        const r = add(x, y, phi);
        if (r.shape.k === "never") continue;
        if (r.shape.k === "sum") parts.push(...r.shape.members);
        else parts.push(r);
      }
    }
    const uniq = dedupAbsMembers(parts);
    const term =
      a.term && b.term ? simplifyTerm(app("+", [a.term, b.term])) : undefined;
    if (uniq.length === 0) {
      return abs({ k: "unknown" }, term, undefined, "partial");
    }
    if (uniq.length === 1) {
      return abs(uniq[0]!.shape, term, uniq[0]!.pred, confJoin(a.conf, b.conf));
    }
    return abs({ k: "sum", members: uniq }, term, undefined, "partial");
  }

  // 混合/无法判定：JS + 经 ToPrimitive 可能 number 或 string
  // （obj/unknown/fn 与 number 拼接等）——诚实并集，不折纯 unknown
  if (
    isNumPrim(a) ||
    isNumPrim(b) ||
    isBigPrim(a) ||
    isBigPrim(b) ||
    a.shape.k === "unknown" ||
    b.shape.k === "unknown" ||
    a.shape.k === "obj" ||
    b.shape.k === "obj" ||
    a.shape.k === "fn" ||
    b.shape.k === "fn" ||
    a.shape.k === "brand" ||
    b.shape.k === "brand"
  ) {
    return abs({ k: "sum", members: [num(), str()] }, undefined, undefined, "partial");
  }

  return abs({ k: "unknown" }, undefined, undefined, "partial");
}

/**
 * 已知不是 bigint 的操作数面：number/bool/null/undefined 字面量或 prim。
 * 与 bigint 做算术/位运算时 ToNumeric 后是 number，混型恒 TypeError。
 * string 不在此列——`+` 的 string 臂走拼接，其余算子在调用点单独判。
 */
function isKnownNonBigintNumeric(a: Abs): boolean {
  const r = litValue(a);
  if (r.ok && (typeof r.value === "number" || typeof r.value === "boolean" || r.value === null)) return true;
  if (r.ok && r.value === undefined) return true;
  return a.shape.k === "prim" && (a.shape.type === "number" || a.shape.type === "boolean");
}

/**
 * 可能经 ToPrimitive 变成 bigint 的操作数（any/unknown/obj/fn/brand/sum）。
 * `1n + x`（x:any）在 x 实为 2n 时得 3n、x 为 "s" 时得 "1s"、x 为 1 时才 TypeError——
 * 不得硬抛成 never。
 */
function isMaybeBigintOperand(a: Abs): boolean {
  return (
    a.shape.k === "any" ||
    a.shape.k === "unknown" ||
    a.shape.k === "obj" ||
    a.shape.k === "fn" ||
    a.shape.k === "brand" ||
    a.shape.k === "sum"
  );
}

/** 双方 bigint 字面量折叠；÷0n / 负指数等原生 RangeError、确定混型原生 TypeError——硬抛（catch 可吸收），不得静默 unknown */
function foldBigintBinOp(
  a: Abs,
  b: Abs,
  op: (x: bigint, y: bigint) => bigint,
): Abs | undefined {
  const ra = litValue(a);
  const rb = litValue(b);
  const va = ra.ok ? ra.value : undefined;
  const vb = rb.ok ? rb.value : undefined;
  if (typeof va !== "bigint" && typeof vb !== "bigint") return undefined;
  if (typeof va === "bigint" && typeof vb === "bigint") {
    try {
      return bigintLit(op(va, vb));
    } catch (e) {
      if (e instanceof RangeError) throw new NudoThrow(errorTypeAbs("RangeError"));
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  }
  // 一侧 bigint 字面量：另一侧为 bigint prim（无字面量）→ 交抽象回退
  const other = typeof va === "bigint" ? b : a;
  if (isBigPrim(other)) return undefined;
  // 已知非 bigint 数值面（number/bool/null/undefined）：混型恒 TypeError
  if (isKnownNonBigintNumeric(other)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // string prim：非 `+` 的算术/位运算 ToNumber 后混型恒 TypeError；
  // `+` 的 string 臂已在 add() 上游分流，到这里即算术算子。
  if (isStrPrim(other)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // any/unknown/obj/…：可能 ToPrimitive 成 bigint（成功）或 number（TypeError）——
  // 记 soft may-throw，交回上层分流，不得硬抛成 never
  if (isMaybeBigintOperand(other)) {
    recordMayThrow({
      kind: "TypeError",
      cause: "mixed bigint ⊗ abstract operand",
    });
    return undefined;
  }
  throw new NudoThrow(errorTypeAbs("TypeError"));
}

function dedupAbsMembers(ms: Abs[]): Abs[] {
  const seen = new Set<string>();
  const out: Abs[] = [];
  for (const m of ms) {
    const key = absShapeKey(m);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

function strLitResult(s: string): Abs {
  return {
    shape: { k: "prim", type: "string" },
    term: lit(s),
    conf: "exact",
  };
}

/** -0 与 0 在约束里等价 */
function normalizeNegZero(n: number): number {
  return n === 0 ? 0 : n;
}

/**
 * IEEE 安全的不等式端点。
 * - 非有限（NaN/±Inf）：不能当端点（NaN 恒假、Inf 与溢出值比较失真）
 * - 0 作 strict 端点仅当运算不会把正值下溢成 0（见各调用点的 strictZeroOk）
 */
function ieeeBound(n: number, strict: boolean, strictZeroOk: boolean): number | undefined {
  if (!Number.isFinite(n)) return undefined;
  const z = normalizeNegZero(n);
  if (z === 0 && strict && !strictZeroOk) return undefined;
  return z;
}

/** any / unknown（含无 term 的裸 unknown）：JS ToNumber 语义用于 - * / % */
function isAnyLike(a: Abs): boolean {
  if (a.shape.k === "any") return true;
  if (a.shape.k === "unknown") return true;
  return false;
}

/**
 * 具体原始字面量（number/string/boolean/null/undefined）——
 * `- * / %` 上可按 JS ToNumber 折叠：`"a"*2`→NaN，`true*2`→2，`"3"*2`→6。
 */
function coercibleLit(
  v: LiteralValue,
): v is number | string | boolean | null {
  // 值域判定（调用方已 .ok）：lit(undefined) 是合法字面量，但 + 参与
  // 恒 NaN 且历史口径不折（见 add 注释）；bigint 走 foldBigintBinOp。
  return (
    typeof v === "number" ||
    typeof v === "string" ||
    typeof v === "boolean" ||
    v === null
  );
}

/**
 * 减乘除模在 any 上走 JS ToNumber：结果恒为 number（可能 NaN）。
 * 与 + 不同——+ 可能拼接；减乘除模不会。
 * 一侧是 bigint 面时成功路径恒为 bigint（对面须同为 bigint），不得折 number。
 */
function toNumberResult(
  a: Abs,
  b: Abs,
  op: "-" | "*" | "/" | "%",
): Abs {
  // 不用 simplifyTerm：x*1=x / x-0=x 只对 number 成立；any 参与时 ToNumber
  // 后值已变（"5"*1→5），不得把结果项认成原 any 变量（strictEqAbs 同 var 会折 true）。
  const term = a.term && b.term ? app(op, [a.term, b.term]) : undefined;
  const bigFace = isBigPrim(a) || isBigPrim(b);
  return abs(
    bigFace ? { k: "prim", type: "bigint" } : { k: "prim", type: "number" },
    term,
    undefined,
    term ? confJoin(confJoin(a.conf, b.conf), "partial") : "partial",
  );
}

/**
 * 可参与数值运算（- * / %）：number prim。
 * any 不算数——那会把 score("x") 误判成 number 路径。
 */
function isNumericLike(a: Abs): boolean {
  return isNumPrim(a);
}

/**
 * 加法约束单调性：
 *   a > p ∧ b > q  ⇒  a+b > p+q
 *   a > p ∧ b = lit(q)  ⇒  a+b > p+q
 *   a = var(x) ∧ x>0 ∧ b=lit(1)  ⇒  term=x+1, pred: term>1
 */
function addPred(a: Abs, b: Abs, sumTerm: Term, phi: Phi): Pred | undefined {
  // 双方都已有「相对自身 term」的数值下界/上界，且能从 Φ 或自身 pred 得到
  const aBounds = numericBounds(a, phi);
  const evalBounds = numericBounds(b, phi);
  if (!aBounds && !evalBounds) return undefined;

  const facts: Pred[] = [];

  // (a.lo + b.lo) < sum  或  ≤
  // 溢出到 ±Inf 的和不能当端点（x>1e308 + y>1e308 ⊬ x+y > Infinity）
  // 正数之和不会下溢成 0，strict 0 端点可保留
  if (aBounds?.lo !== undefined && evalBounds?.lo !== undefined) {
    const strict = aBounds.lo.strict || evalBounds.lo.strict;
    const loSum = ieeeBound(aBounds.lo.value + evalBounds.lo.value, strict, true);
    if (loSum !== undefined) {
      facts.push(strict ? gt(sumTerm, lit(loSum)) : ge(sumTerm, lit(loSum)));
    }
  }
  if (aBounds?.hi !== undefined && evalBounds?.hi !== undefined) {
    const strict = aBounds.hi.strict || evalBounds.hi.strict;
    const hiSum = ieeeBound(aBounds.hi.value + evalBounds.hi.value, strict, true);
    if (hiSum !== undefined) {
      facts.push(strict ? lt(sumTerm, lit(hiSum)) : le(sumTerm, lit(hiSum)));
    }
  }

  // 保留原 Φ 中可平移的事实：若 a 是 var(x) 且 Φ ⊢ x>0，则 sum=x+b 时
  // numericBounds 已处理。此处直接返回 and(facts)。
  if (facts.length === 0) return undefined;
  return and(...facts);
}

type NumBounds = {
  lo?: { value: number; strict: boolean };
  hi?: { value: number; strict: boolean };
};

/**
 * 提取 Abs 上相对 term 的数值界。
 * 优先用自身 pred；否则查 Φ（针对 var id）。
 */
function numericBounds(a: Abs, phi: Phi = pTrue): NumBounds | undefined {
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

/** 减法：a - b = a + (-b)，数值上做单调性 */
export function sub(a: Abs, b: Abs, phi: Phi = pTrue): Abs {
  // Symbol 参与算术/位运算：ToNumber/ToNumeric 原生 TypeError（与 add 同口径）
  if (isSym(a) || isSym(b)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  const ra = litValue(a);
  const rb = litValue(b);
  const big = foldBigintBinOp(a, b, (x, y) => x - y);
  if (big) return big;
  if (isBigPrim(a) && isBigPrim(b)) {
    return abs({ k: "prim", type: "bigint" }, undefined, undefined, confJoin(a.conf, b.conf));
  }
  if (ra.ok && rb.ok && typeof ra.value === "number" && typeof rb.value === "number") {
    return numLit(ra.value - rb.value);
  }
  if (ra.ok && rb.ok && coercibleLit(ra.value) && coercibleLit(rb.value)) {
    return numLit(Number(ra.value) - Number(rb.value));
  }
  if (isNumericLike(a) && isNumericLike(b) && a.term && b.term) {
    const term = simplifyTerm(app("-", [a.term, b.term]));
    // a.lo - b.hi  <  a-b  <  a.hi - b.lo
    const ab = numericBounds(a, phi);
    const bb = numericBounds(b, phi);
    const facts: Pred[] = [];
    if (ab?.lo !== undefined && bb?.hi !== undefined) {
      const strict = ab.lo.strict || bb.hi.strict;
      const lo = ieeeBound(ab.lo.value - bb.hi.value, strict, true);
      if (lo !== undefined) {
        facts.push(strict ? gt(term, lit(lo)) : ge(term, lit(lo)));
      }
    }
    if (ab?.hi !== undefined && bb?.lo !== undefined) {
      const strict = ab.hi.strict || bb.lo.strict;
      const hi = ieeeBound(ab.hi.value - bb.lo.value, strict, true);
      if (hi !== undefined) {
        facts.push(strict ? lt(term, lit(hi)) : le(term, lit(hi)));
      }
    }
    const conf =
      term.op === "lit"
        ? "exact"
        : confJoin(confJoin(a.conf, b.conf), facts.length ? "path" : "path");
    return abs({ k: "prim", type: "number" }, term, facts.length ? and(...facts) : undefined, conf);
  }
  if (isNumericLike(a) && isNumericLike(b)) {
    return abs({ k: "prim", type: "number" }, undefined, undefined, "partial");
  }
  // any：JS ToNumber → number（可能 NaN）
  if (isAnyLike(a) || isAnyLike(b)) {
    return toNumberResult(a, b, "-");
  }
  return abs({ k: "unknown" }, undefined, undefined, "partial");
}

/** 乘法：字面量直接求值；×正数同向缩放；×负数翻转不等式；×0 归零 */
export function mul(a: Abs, b: Abs, phi: Phi = pTrue): Abs {
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
  if (isAnyLike(a) || isAnyLike(b)) {
    return toNumberResult(a, b, "*");
  }
  return abs({ k: "unknown" }, undefined, undefined, "partial");
}

/**
 * 除法：字面量折叠；除以正/负常数时按单调性推界。
 * 除以 0：JS 语义为 ±Infinity / NaN，shape 仍 number（不报违例）。
 */
export function div(a: Abs, b: Abs, phi: Phi = pTrue): Abs {
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
    return abs(num().shape, term, undefined, confJoin(confJoin(a.conf, b.conf), "path"));
  }
  if (isNumericLike(a) && isNumericLike(b)) {
    return abs(num().shape, undefined, undefined, "partial");
  }
  if (isAnyLike(a) || isAnyLike(b)) {
    return toNumberResult(a, b, "/");
  }
  return abs({ k: "unknown" }, undefined, undefined, "partial");
}

/**
 * 取模：字面量折叠；`x % k`（k 为有限非零字面量）仅当被除数有限时
 * 结果界在 (−|k|, |k|)。整数模可收紧到 [0, k)，此处先做保守实数界。
 * `n % 0` / `x % 0` / `x % NaN` 恒为 NaN（JS）。
 */
export function mod(a: Abs, b: Abs, phi: Phi = pTrue): Abs {
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
  if (isAnyLike(a) || isAnyLike(b)) {
    return toNumberResult(a, b, "%");
  }
  return abs({ k: "unknown" }, undefined, undefined, "partial");
}

/** 比较：返回 boolean Abs；若双字面量则 exact */
export function cmp(
  op: "lt" | "le" | "gt" | "ge" | "eq" | "ne",
  a: Abs,
  b: Abs,
  phi: Phi = pTrue,
): Abs {
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
