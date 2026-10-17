/**
 * 加减域：add（拼接/数值单调性/any 并集/sum 分发）与 sub（#175 自反
 * 折叠 x−x→0 + subAssumeBounds 同名相关性引理）。
 *
 * 依赖方向不变量：只 import 叶子（shared/coerce/bounds）与 algebra 其它
 * 既有模块；不得 import 兄弟域（muldiv/cmp）或 facade——运算族之间
 * 零互调（sum 分发经 shared 的 eval2 回调自递归，不跨域）。
 */

import type { Term } from "../term.ts";
import { app, lit, simplifyTerm, termEquals, isDeterministicTerm } from "../term.ts";
import { isDomainShared } from "../len-sharing.ts";
import type { Pred, Phi } from "../pred.ts";
import { and, gt, ge, lt, le, pTrue } from "../pred.ts";
import type { Abs } from "../abs.ts";
import { abs, confJoin, isNumPrim, isStrPrim, isBigPrim, litValue, num, numLit, str } from "../abs.ts";
import { concatString, isTemplateLike } from "../template.ts";
import { makeSum, isNullProtoWithoutCoercer } from "../objects.ts";
import { noteDerivationAdd } from "../derivation.ts";
import { isSymbolAbs as isSym } from "../symbol-id.ts";
import { NudoThrow } from "../nudo-throw.ts";
import { errorTypeAbs } from "../may-throw.ts";
import { distributeSumBinOp, strLitResult, synthEndpoint, isAnyLike, coercibleLit, toNumberResult, isNumericLike, assumePremiseList } from "./shared.ts";
import { builtinBrandToPrimitive, noteCoercionMayThrow, noteAbstractArithMayThrow, foldBigintBinOp } from "./coerce.ts";
import { numericBounds, isNonNaN } from "./bounds.ts";

export function add(a: Abs, b: Abs, phi: Phi = pTrue): Abs {
  // Bug 25：内建 brand 操作数先经 ToPrimitive 强转（引擎已知 total——原型
  // 方法表固定，无用户 valueOf/@@toPrimitive 面）；折成 prim 后走既有
  // 数值/拼接臂，假 unknown / 错误 number|string 并集 / 假 may-throw 全消
  const fa = builtinBrandToPrimitive(a, "default");
  const fb = builtinBrandToPrimitive(b, "default");
  if (fa || fb) return add(fa ?? a, fb ?? b, phi);
  // Symbol 参与 + / 模板：隐式 ToString 原生 TypeError（String(sym) 走 evalGlobalFn 不抛）
  if (isSym(a) || isSym(b)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // 闭 null-proto 无自有 coercer（toString/valueOf/@@toPrimitive）→
  // ToPrimitive 定抛 TypeError（`''+o` / `o+1` / `${o}` 全臂，node 实测
  // "Cannot convert object to primitive value"）。open/index 形可能含
  // coercer 由 helper 排除，落下方抽象臂。
  if (isNullProtoWithoutCoercer(a) || isNullProtoWithoutCoercer(b)) {
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
    // Bug 8：拼接臂的抽象操作数可能为 Symbol（`"" + Symbol()` / `${Symbol()}`
    // 原生 TypeError；`${1n}` 合法 ToString，bigint 不在此维度）。值域不变。
    noteCoercionMayThrow(a, b, "ToString coercion of abstract operand (Symbol)");
    return concatString(a, b);
  }
  // boolean/null/undefined 字面量与数字混合：ToNumber 折叠（与 sub/mul/div/mod
  // 同口径；native 10 + true = 11、2 + null = 2、undefined + 1 = NaN——恒 number）
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
    // 数组侧恒 string，但对面抽象操作数可能为 Symbol（`[] + Symbol()` 原生 TypeError）
    noteCoercionMayThrow(a, b, "ToString coercion of abstract operand (Symbol)");
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

  // lit(undefined) ⊗ 数值面（含抽象 number）：ToNumber(undefined)=NaN，数值
  // 加法恒 number（Bug 10 同源——string 臂不可能；string 操作数已在前述拼接
  // 臂拦截）。`x + undefined`（x:number）→ NaN 域，不得落 isAnyLike 并集。
  if (
    (ra.ok && ra.value === undefined && isNumPrim(b)) ||
    (rb.ok && rb.value === undefined && isNumPrim(a))
  ) {
    const term =
      a.term && b.term ? simplifyTerm(app("+", [a.term, b.term])) : undefined;
    return abs({ k: "prim", type: "number" }, term, undefined, "partial");
  }

  // any / type-var：JS + 的并集，不是 unknown，也不是 number。
  // 一侧是 bigint 面时结果只能是 bigint（对面实为 bigint）或 string（ToString），
  // 不是 number——`1n + 1` 已在上游 TypeError。
  if (isAnyLike(a) || isAnyLike(b)) {
    // Bug 8：抽象操作数可能为 bigint / Symbol —— `x + 1`（x=1n / Symbol()）
    // 原生 may TypeError（此前 throws=never，L2 假阴性）。值域 number|string 不变。
    noteAbstractArithMayThrow(a, b);
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
  const distributed = distributeSumBinOp("+", a, b, phi, add);
  if (distributed) return distributed;

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
    // Bug 8：obj/fn/brand 抽象面（valueOf/@@toPrimitive 可能产 bigint/Symbol）
    // —— `x.a + 1` 类原生 may TypeError；unknown 令牌不记（wave 1 口径）
    noteAbstractArithMayThrow(a, b);
    return abs({ k: "sum", members: [num(), str()] }, undefined, undefined, "partial");
  }

  return abs({ k: "unknown" }, undefined, undefined, "partial");
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
  // 溢出到 ±Inf 的和不能当端点（x>1e308 + y>1e308 ⊬ x+y > Infinity）。
  // strict 端点经 IEEE 见证校准（Bug A）：fl(1 + 1e-16) = 1 恰撞端点时
  // gt(sum, 1) 是假证明（x=1、y=2^-53 时 IEEE 和 === 1），端点退一步。
  if (aBounds?.lo !== undefined && evalBounds?.lo !== undefined) {
    const strict = aBounds.lo.strict || evalBounds.lo.strict;
    const loSum = synthEndpoint(
      (x, y) => x + y,
      aBounds.lo,
      "up",
      "lo",
      evalBounds.lo,
      "up",
    );
    if (loSum !== undefined) {
      facts.push(strict ? gt(sumTerm, lit(loSum)) : ge(sumTerm, lit(loSum)));
    }
  }
  if (aBounds?.hi !== undefined && evalBounds?.hi !== undefined) {
    const strict = aBounds.hi.strict || evalBounds.hi.strict;
    const hiSum = synthEndpoint(
      (x, y) => x + y,
      aBounds.hi,
      "down",
      "hi",
      evalBounds.hi,
      "down",
    );
    if (hiSum !== undefined) {
      facts.push(strict ? lt(sumTerm, lit(hiSum)) : le(sumTerm, lit(hiSum)));
    }
  }

  // 保留原 Φ 中可平移的事实：若 a 是 var(x) 且 Φ ⊢ x>0，则 sum=x+b 时
  // numericBounds 已处理。此处直接返回 and(facts)。
  if (facts.length === 0) return undefined;
  return and(...facts);
}

/** 减法：a - b = a + (-b)，数值上做单调性 */
export function sub(a: Abs, b: Abs, phi: Phi = pTrue, assume?: Phi): Abs {
  // Bug 25：内建 brand ToPrimitive（hint number：Date → time value、
  // 装箱 → prim、其余 → string 面）——折 prim 后走既有数值臂
  // （assume 随递归透传：brand 解箱不丢用户引理——div 的同型递归未传
  // 是既有小瑕疵，此处带齐）
  {
    const fa = builtinBrandToPrimitive(a, "number");
    const fb = builtinBrandToPrimitive(b, "number");
    if (fa || fb) return sub(fa ?? a, fb ?? b, phi, assume);
  }
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
    // issue #175：同一函数体内「字面相同的纯子表达式」双次求值无相等
    // 事实——`max - d` 证不出 ge(0)。自反折叠（区间折叠之前）：
    // 结构相等项 ∧ isDeterministicTerm（len#N 唯一铸造 + 确定性宿主
    // 白名单 ⇒ 结构相等 ⇒ 同值）⇒ x - x = 0。
    // soundness 门（三层）：
    // ① **不使用**「同一 Abs 对象 ⇒ 同值」——adoption 面（#123 把多个
    //   无信息实参重锚到同一 callee 形参面）与同质元素域（arr(E) 的
    //   xs[0]/xs[1] 共享 E）都会让**不同具体值**共享同一 Abs 对象
    //   （实测 y-x 假折 {NaN,0}），值身份只骑在确定性项相等上；
    // ② 同值不折 NaN——x 为 NaN 时 x-x=NaN，isNonNaN（比较 pred 排除
    //   NaN）不成立时结果取真值域 {NaN, 0}（minMaxAbs 的 NaN 臂同款）；
    //   ±Inf-±Inf=NaN 的角落与既有区间算术同口径（比较 pred 本就不排除
    //   ±Inf 端点，len#N 根的项在具体层有限）；
    // ③ 结构相等必须过确定性门：adoption 重锚的 callee 形参名 var、get
    //   成员读、minMaxAbs 的 arg 占位都可能跨值同结构碰撞，一律不折。
    // 域共享残留已修（len-sharing.ts）：元素域分发位（$idx 具体下标读 /
    //   elemsOf arr 臂 / 回调元素实参）标记域共享，abstractLen 对标记
    //   接收者不 memo——xs[0].length 与 xs[1].length 各铸独立 len#N，
    //   本折叠不再过度承诺 0。
    if (
      termEquals(a.term, b.term) &&
      isDeterministicTerm(a.term) &&
      // 域共享门（len-sharing.ts，第二类洞）：同一带项 Abs 经元素域分发
      // 到两个下标位（xs.map(s=>s.length) 的 a[0] 与 a[1]）——term 结构
      // 相同但代表不同具体值，$idx/回调实参分发位已标记，此处拒绝折叠。
      !isDomainShared(a) &&
      !isDomainShared(b)
    ) {
      // 值相等 ⇒ 任一侧证得非 NaN 即整体非 NaN
      return isNonNaN(a, phi) || isNonNaN(b, phi)
        ? numLit(0)
        : makeSum(numLit(NaN), numLit(0));
    }
    const term = simplifyTerm(app("-", [a.term, b.term]));
    // a.lo - b.hi  <  a-b  <  a.hi - b.lo
    // strict 端点经 IEEE 见证校准（Bug A，与 add 同口径）：减数侧 hi 的
    // 见证方向是 nextDown（b < b.hi ⟺ b ≤ nextDown(b.hi)）。
    const ab = numericBounds(a, phi);
    const bb = numericBounds(b, phi);
    const facts: Pred[] = [];
    if (ab?.lo !== undefined && bb?.hi !== undefined) {
      const strict = ab.lo.strict || bb.hi.strict;
      const lo = synthEndpoint(
        (x, y) => x - y,
        ab.lo,
        "up",
        "lo",
        bb.hi,
        "down",
      );
      if (lo !== undefined) {
        facts.push(strict ? gt(term, lit(lo)) : ge(term, lit(lo)));
      }
    }
    if (ab?.hi !== undefined && bb?.lo !== undefined) {
      const strict = ab.hi.strict || bb.lo.strict;
      const hi = synthEndpoint(
        (x, y) => x - y,
        ab.hi,
        "down",
        "hi",
        bb.lo,
        "up",
      );
      if (hi !== undefined) {
        facts.push(strict ? lt(term, lit(hi)) : le(term, lit(hi)));
      }
    }
    // assume 引理（issue #175）：le(b,a)/le(a,b) 同名相关性 ⇒ 半轴界，
    // 与区间 facts 合取（两者各自独立成立，合取仍 sound）
    const assumePred = subAssumeBounds(a, b, term, assume);
    if (assumePred) facts.push(assumePred);
    const conf =
      term.op === "lit"
        ? "exact"
        : confJoin(confJoin(a.conf, b.conf), facts.length ? "path" : "path");
    return abs({ k: "prim", type: "number" }, term, facts.length ? and(...facts) : undefined, conf);
  }
  if (isNumericLike(a) && isNumericLike(b)) {
    return abs({ k: "prim", type: "number" }, undefined, undefined, "partial");
  }
  // Bug 25：抽象 string prim ⊗ 数值面（内建 brand ToPrimitive → toString 折
  // string 域后落此；`new Map() - 1` → ToNumber(string) → number）——恒
  // total（string prim 不可能是 Symbol/bigint）
  if (isStrPrim(a) || isStrPrim(b)) {
    return abs({ k: "prim", type: "number" }, undefined, undefined, "partial");
  }
  // any：JS ToNumber → number（可能 NaN）
  if (isAnyLike(a) || isAnyLike(b)) {
    return toNumberResult(a, b, "-");
  }
  // sum 分发（与 add 同口径）：100 - (cond ? 20 : 55) → 45 | 80。
  // 成员级同构透传 assume（div 同型先例）——d 的成员臂上项匹配仍以
  // termEquals 为准（不匹配的成员不产生界），soundness 不变
  const distributed = distributeSumBinOp("-", a, b, phi, (x, y, p) => sub(x, y, p, assume));
  if (distributed) return distributed;
  // Bug 8：obj/fn/brand 抽象面回退（`x.a - 1`，valueOf 可能产 bigint/Symbol）→ may TypeError
  noteAbstractArithMayThrow(a, b);
  return abs({ k: "unknown" }, undefined, undefined, "partial");
}

/**
 * assume 引理的减法界（issue #175 `@nudo:assume d <= max` ⇒ max-d ≥ 0）：
 * 与 divAssumeBounds 同型的同名相关性折叠——独立区间传播对 `max - d`
 * 只能得 ±∞（无界减无界），用户引理提供的相关性是唯一界源。减法无
 * 分母符号问题，前提命中即得半轴界：
 *   le(b, a)（减数 ≤ 被减数）⇒ a-b ≥ 0；le(a, b)（被减数 ≤ 减数）
 *     ⇒ a-b ≤ 0。
 * 项匹配用 termEquals（var 名恒等 / app 结构等价）；前提归一化为 le
 * 原子（`a >= b` 构造期已翻转）。无前提命中 → undefined（保守回退）。
 */
function subAssumeBounds(
  a: Abs,
  b: Abs,
  resultTerm: Term,
  assume: Phi | undefined,
): Pred | undefined {
  const premises = assumePremiseList(assume);
  if (premises.length === 0) return undefined;
  if (!a.term || !b.term) return undefined;
  const facts: Pred[] = [];
  for (const p of premises) {
    if (p.op !== "le") continue;
    if (termEquals(p.a, a.term) && termEquals(p.b, b.term)) {
      // 前提 le(a, b)：被减数 ≤ 减数 ⇒ a-b ≤ 0
      facts.push(le(resultTerm, lit(0)));
    } else if (termEquals(p.a, b.term) && termEquals(p.b, a.term)) {
      // 前提 le(b, a)：减数 ≤ 被减数 ⇒ a-b ≥ 0
      facts.push(ge(resultTerm, lit(0)));
    }
  }
  return facts.length ? and(...facts) : undefined;
}

