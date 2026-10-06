/**
 * 语言表面运算（仍在 Abs 上）：typeof / 一元- / ! / nullish 相等。
 * 类型即计算——一元与控制流判定与二元算术同一运算域。
 */

import type { Abs, Shape, Confidence } from "./abs.ts";
import { abs, litValue, confJoin, num, numLit, bool, boolLit, strLit, bigintLit, isStrPrim, isBigPrim } from "./abs.ts";
import { classNameOfValue } from "./class-mark.ts";
import { builtinCtorNameOf, hostBuiltinCtorName } from "./builtins.ts";
import { symbolIdOf, isSymbolAbs as isSym } from "./symbol-id.ts";
import type { LiteralValue, Term } from "./term.ts";
import { lit, simplifyTerm, app } from "./term.ts";
import type { Pred } from "./pred.ts";
import {
  pTrue,
  gt,
  ge,
  lt,
  le,
  and,
  type Phi,
} from "./pred.ts";
import { implies } from "./pred.ts";
import { add, sub } from "./arithmetic.ts";
import { NudoThrow } from "./nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "./may-throw.ts";

// --- 位运算 / 移位 / 幂 / ToNumber（evaluator $bitand 等运算符路由） ---

/** 数值可被 JS ToNumber/ToNumeric 折叠的字面量；undefined 字面量不在此列（+undefined → unknown/NaN 不折） */
function coercibleNumberLit(v: LiteralValue): v is number | string | boolean | null {
  return (
    typeof v === "number" ||
    typeof v === "string" ||
    typeof v === "boolean" ||
    v === null
  );
}

function unknownPartial(): Abs {
  return abs({ k: "unknown" }, undefined, undefined, "partial");
}

/**
 * 已知非 bigint 的数值面（number/bool/null/undefined 字面量或 prim）——与 bigint 混型恒 TypeError。
 */
function isKnownNonBigintNumeric(a: Abs): boolean {
  const vaR = litValue(a);
  const va = vaR.ok ? vaR.value : undefined;
  if (typeof va === "number" || typeof va === "boolean" || va === null) return true;
  if (a.term?.op === "lit" && a.term.value === undefined) return true;
  return a.shape.k === "prim" && (a.shape.type === "number" || a.shape.type === "boolean");
}

/** lit(null)/lit(undefined) 操作数：一切隐式强转下 total（ToNumber→0/NaN、ToInt32→0），不可能是 bigint/Symbol（issue #119，与 arithmetic.ts 同口径）。 */
function isNullishLitOperand(a: Abs): boolean {
  const r = litValue(a);
  return r.ok && (r.value === null || r.value === undefined);
}

/** 可能经 ToPrimitive 变成 bigint（any/unknown/obj/fn/brand/sum）——不得硬抛成 never */
function isMaybeBigintOperand(a: Abs): boolean {
  // issue #119：optional()/nullable() 槽读出的 nullish 字面量成员
  // （shape k:"unknown" 携带 lit 项）不得连坐 may-throw。只排 nullish
  // 字面量：bigint 字面量保持原判定（混型 TypeError 真实可能）。
  if (isNullishLitOperand(a)) return false;
  const k = a.shape.k;
  if (k === "sum") {
    // Bug 25（与 arithmetic.ts 同口径）：sum 成员感知——纯 prim 成员
    // （number|string）不可能 bigint/Symbol；空 sum 保守真。
    const members = (a.shape as { members: Abs[] }).members;
    return members.length === 0 || members.some((m) => isMaybeBigintOperand(m));
  }
  return k === "any" || k === "unknown" || k === "obj" || k === "fn" || k === "brand";
}

/**
 * Bug 8：抽象操作数（any/obj/fn/brand/sum；unknown 是引擎 fail-closed 令牌，
 * wave 1 口径不记）经 ToNumeric/ToInt32 可能 bigint 混型 / Symbol 强转 →
 * 位运算/移位/幂原生 may TypeError（`x & 1`、`x ** 2`，x=1n / Symbol()）。
 * 只补 throws 效果，值域不变。
 */
function isMaybeCoercionThrowOperand(a: Abs): boolean {
  return isMaybeBigintOperand(a) && a.shape.k !== "unknown";
}

/**
 * 双字面量二元折叠：双方 bigint → bigint 算子；其余走 number 算子
 * （JS 位运算/移位自身完成 ToInt32/ToUint32&31）。
 * 混合 bigint⊗确定非 bigint（number/bool/null/undefined/string）→ 硬抛 TypeError。
 * 混合 bigint⊗抽象面（any/obj/…）→ 记 soft may-throw 并回退，不得硬抛成 never
 * （`1n & x` 在 x 实为 2n 时得 0n）。bigint 上无此算子（>>>）一侧是 bigint 即 TypeError。
 * 不得回落成 bigint 形状除非双方确实同型。number 侧不可折叠返回 undefined。
 */
function foldNumericBinOp(
  a: Abs,
  b: Abs,
  numOp: (x: number, y: number) => number,
  bigOp?: (x: bigint, y: bigint) => bigint,
): Abs | undefined {
  // Symbol 参与位运算/移位/幂：ToNumeric 原生 TypeError（与 add 同口径）
  if (isSym(a) || isSym(b)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  const ra = litValue(a);
  const rb = litValue(b);
  const va = ra.ok ? ra.value : undefined;
  const vb = rb.ok ? rb.value : undefined;
  // 无 bigint 重载的算子（>>>）：任一侧是 bigint（字面量或抽象 prim）即恒 TypeError
  if (!bigOp && (typeof va === "bigint" || typeof vb === "bigint" || isBigPrim(a) || isBigPrim(b))) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (typeof va === "bigint" || typeof vb === "bigint") {
    if (typeof va === "bigint" && typeof vb === "bigint") {
      // 折叠失败（2n**-1n）→ RangeError；上方已排除 !bigOp
      const op = bigOp!;
      try {
        return abs(
          { k: "prim", type: "bigint" },
          lit(op(va, vb)),
          pTrue,
          "exact",
        );
      } catch (e) {
        if (e instanceof RangeError) throw new NudoThrow(errorTypeAbs("RangeError"));
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
    }
    const other = typeof va === "bigint" ? b : a;
    // bigint prim 对面：交抽象回退（bitwiseResultShape 分流）
    if (isBigPrim(other)) return undefined;
    // 无 bigint 重载的算子（>>>）：一侧是 bigint 即恒 TypeError
    if (!bigOp) throw new NudoThrow(errorTypeAbs("TypeError"));
    // 确定非 bigint 数值面 / string（ToNumber 后混型）→ TypeError
    if (isKnownNonBigintNumeric(other) || isStrPrim(other)) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    // 抽象面：可能同为 bigint（成功）或混型（TypeError）——soft may-throw + 回退
    if (isMaybeBigintOperand(other)) {
      recordMayThrow({
        kind: "TypeError",
        cause: "mixed bigint ⊗ abstract operand",
      });
      return undefined;
    }
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (ra.ok && rb.ok && coercibleNumberLit(ra.value) && coercibleNumberLit(rb.value)) {
    return abs(
      { k: "prim", type: "number" },
      lit(numOp(Number(ra.value), Number(rb.value))),
      pTrue,
      "exact",
    );
  }
  return undefined;
}

/** 一元数值折叠（~ / 一元 + 的结果 Abs） */
function foldNumericUnOp(
  a: Abs,
  numOp: (x: number) => number,
  bigOp?: (x: bigint) => bigint,
): Abs | undefined {
  // Symbol 参与一元数值运算（~ / +）：ToNumber 原生 TypeError（与 add 同口径）
  if (isSym(a)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  const r = litValue(a);
  const v = r.ok ? r.value : undefined;
  if (typeof v === "bigint") {
    // bigint 上无此一元算子（如 unary +）→ TypeError；折叠失败同口径硬抛
    if (!bigOp) throw new NudoThrow(errorTypeAbs("TypeError"));
    try {
      return abs({ k: "prim", type: "bigint" }, lit(bigOp(v)), pTrue, "exact");
    } catch (e) {
      if (e instanceof RangeError) throw new NudoThrow(errorTypeAbs("RangeError"));
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  }
  if (r.ok && coercibleNumberLit(r.value)) {
    return abs({ k: "prim", type: "number" }, lit(numOp(Number(r.value))), pTrue, "exact");
  }
  // Bug 8：抽象回退（`~x`，x:any / obj…）—— ToNumeric 可能撞 Symbol / bigint
  // 混型（`~Symbol()` 原生 TypeError）→ may TypeError；bigint prim 不在此列
  // （`~1n` 合法折叠），值域不变。
  if (isMaybeCoercionThrowOperand(a)) {
    recordMayThrow({
      kind: "TypeError",
      cause: "ToNumeric coercion of abstract operand (~)",
    });
  }
  return undefined;
}

/** 位运算结果的抽象形状：双方 bigint → bigint；含任一 bigint（混合）→ unknown；否则 number */
function bitwiseResultShape(a: Abs, b: Abs): Abs {
  // Bug 8：抽象回退臂（foldNumericBinOp 不可折叠）—— 抽象操作数可能
  // bigint 混型 / Symbol（`x & 1`、`x ** 2`，x=1n / Symbol() 原生 TypeError）
  // → may TypeError，值域不变。bigint 字面量面已由 foldNumericBinOp 记过
  // （`1n & x` 控制组），不重复。
  const ra = litValue(a);
  const rb = litValue(b);
  if (
    !(ra.ok && typeof ra.value === "bigint") &&
    !(rb.ok && typeof rb.value === "bigint") &&
    (isMaybeCoercionThrowOperand(a) || isMaybeCoercionThrowOperand(b))
  ) {
    recordMayThrow({
      kind: "TypeError",
      cause: "ToNumeric/ToInt32 coercion of abstract operand",
    });
  }
  const numLike = (x: Abs): boolean =>
    x.shape.k === "prim" &&
    (x.shape.type === "number" || x.shape.type === "string" || x.shape.type === "boolean");
  const bigLike = (x: Abs): boolean => x.shape.k === "prim" && x.shape.type === "bigint";
  if (bigLike(a) || bigLike(b)) {
    return bigLike(a) && bigLike(b)
      ? abs({ k: "prim", type: "bigint" }, undefined, undefined, confJoin(a.conf, b.conf))
      : abs({ k: "unknown" }, undefined, undefined, "partial");
  }
  if (numLike(a) && numLike(b)) {
    return abs({ k: "prim", type: "number" }, undefined, undefined, confJoin(a.conf, b.conf));
  }
  return abs({ k: "unknown" }, undefined, undefined, "partial");
}

/** & —— ToInt32 两侧后按位与 */
export function bitandAbs(a: Abs, b: Abs): Abs {
  return (
    foldNumericBinOp(a, b, (x, y) => x & y, (x, y) => x & y) ??
    bitwiseResultShape(a, b)
  );
}

/** | —— ToInt32 两侧后按位或 */
export function bitorAbs(a: Abs, b: Abs): Abs {
  return (
    foldNumericBinOp(a, b, (x, y) => x | y, (x, y) => x | y) ??
    bitwiseResultShape(a, b)
  );
}

/** ^ —— ToInt32 两侧后按位异或 */
export function bitxorAbs(a: Abs, b: Abs): Abs {
  return (
    foldNumericBinOp(a, b, (x, y) => x ^ y, (x, y) => x ^ y) ??
    bitwiseResultShape(a, b)
  );
}

/** ~ —— ToInt32 后按位取反（bigint 无符号截断） */
export function bitnotAbs(a: Abs): Abs {
  const folded = foldNumericUnOp(a, (x) => ~x, (x) => ~x);
  if (folded) return folded;
  if (a.shape.k === "prim") {
    if (a.shape.type === "bigint") {
      return abs({ k: "prim", type: "bigint" }, undefined, undefined, confJoin(a.conf, "widened"));
    }
    if (a.shape.type === "number" || a.shape.type === "string" || a.shape.type === "boolean") {
      return abs({ k: "prim", type: "number" }, undefined, undefined, confJoin(a.conf, "widened"));
    }
  }
  return abs({ k: "unknown" }, undefined, undefined, "partial");
}

/** << —— 左移（rhs ToUint32 & 31；bigint 不限位宽） */
export function shlAbs(a: Abs, b: Abs): Abs {
  return (
    foldNumericBinOp(a, b, (x, y) => x << y, (x, y) => x << y) ??
    bitwiseResultShape(a, b)
  );
}

/** >> —— 算术右移（rhs ToUint32 & 31；bigint 不限位宽） */
export function shrAbs(a: Abs, b: Abs): Abs {
  return (
    foldNumericBinOp(a, b, (x, y) => x >> y, (x, y) => x >> y) ??
    bitwiseResultShape(a, b)
  );
}

/** >>> —— 逻辑右移（rhs ToUint32 & 31；bigint 无此运算符 → 不可折叠） */
export function ushrAbs(a: Abs, b: Abs): Abs {
  return (
    foldNumericBinOp(a, b, (x, y) => x >>> y) ?? bitwiseResultShape(a, b)
  );
}

/** ** —— 幂（右结合由 AST 保证）；负指数 bigint 原生 RangeError → 不可折叠 */
export function powAbs(a: Abs, b: Abs): Abs {
  return (
    foldNumericBinOp(a, b, (x, y) => x ** y, (x, y) => x ** y) ??
    bitwiseResultShape(a, b)
  );
}

/**
 * ES ToNumeric：number | bigint（UpdateExpression 的 oldValue）。
 * bigint 保持（`1n++` 是 2n，不得 ToNumber 硬抛）；其余走 ToNumber。
 * 结果域恒为 number|bigint——unknown 是推断失败，不得当作 ToNumeric 结果。
 */
export function toNumericAbs(a: Abs): Abs {
  const vR = litValue(a);
  const v = vR.ok ? vR.value : undefined;
  if (typeof v === "bigint") return bigintLit(v);
  if (isBigPrim(a)) return a;
  // lit(undefined)：litValue 哨兵吞成「无 lit」，必须看 term
  if (a.term?.op === "lit" && a.term.value === undefined) {
    return abs({ k: "prim", type: "number" }, lit(NaN), pTrue, "exact");
  }
  const n = toNumberAbs(a);
  if (n.shape.k === "unknown") {
    return abs({ k: "prim", type: "number" }, undefined, undefined, "partial");
  }
  return n;
}

/**
 * UpdateExpression 的 `oldValue + 1`：ToNumeric 后按 numeric type 加 1
 * （bigint→1n，number→1）。走 arithmetic.add——与 `x += 1`（$add）同一
 * 约束传播路径（`x>0 ⇒ x+1>1` 两条语法同权）。toNumericAbs 后操作数恒为
 * number|bigint 面，add 不会进 string 拼接臂。
 */
export function updateAddAbs(a: Abs, phi: Phi = pTrue): Abs {
  const n = toNumericAbs(a);
  const one = n.shape.k === "prim" && n.shape.type === "bigint" ? bigintLit(1n) : numLit(1);
  return add(n, one, phi);
}

/** UpdateExpression 的 `oldValue - 1`（与 updateAddAbs 同口径，走 arithmetic.sub） */
export function updateSubAbs(a: Abs, phi: Phi = pTrue): Abs {
  const n = toNumericAbs(a);
  const one = n.shape.k === "prim" && n.shape.type === "bigint" ? bigintLit(1n) : numLit(1);
  return sub(n, one, phi);
}

/** 一元 + —— ToNumber 折叠；bigint（含抽象 prim）原生恒抛 TypeError → 硬抛 */
export function toNumberAbs(a: Abs): Abs {
  // Symbol 参与一元 + / ToNumber：原生 TypeError（与 add 同口径）
  if (isSym(a)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  const r = litValue(a);
  const v = r.ok ? r.value : undefined;
  if (typeof v === "bigint" || isBigPrim(a)) {
    // +5n / +bigPrim 原生抛 TypeError（catch 可吸收），不得静默 unknown
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (r.ok && coercibleNumberLit(r.value)) {
    return abs({ k: "prim", type: "number" }, lit(Number(r.value)), pTrue, "exact");
  }
  if (a.shape.k === "prim") {
    if (a.shape.type === "number") return a;
    if (a.shape.type === "string" || a.shape.type === "boolean") {
      return abs({ k: "prim", type: "number" }, undefined, undefined, confJoin(a.conf, "widened"));
    }
  }
  // Bug 8：抽象面（any/obj/fn/brand/sum）经 ToNumber 可能撞 Symbol / bigint
  // （`+x`，x=Symbol() / {valueOf(){return 1n}} 原生 TypeError）→ may TypeError；
  // arr/tuple 默认 ToPrimitive 恒 string→number，不在此列。值域不变。
  if (isMaybeCoercionThrowOperand(a)) {
    recordMayThrow({
      kind: "TypeError",
      cause: "ToNumber coercion of abstract operand (Symbol/bigint)",
    });
  }
  // obj/arr/tuple/brand：ToPrimitive 后恒为 number（或自定义 valueOf 抛——partial 近似）
  if (a.shape.k === "obj" || a.shape.k === "arr" || a.shape.k === "tuple" || a.shape.k === "brand") {
    return abs({ k: "prim", type: "number" }, undefined, undefined, "partial");
  }
  return abs({ k: "unknown" }, undefined, undefined, "partial");
}

/** JS typeof：结果域永远是 string */
export function typeofAbs(a: Abs): Abs {
  // DEC-006 B/C：free identifier 可能把宿主值/undefined 漏进来（typeof process…）——
  // 非 Abs 入参 fail-closed 为 partial string，禁止读 .shape 炸宿主 TypeError
  if (!a || typeof a !== "object" || !("shape" in (a as object))) {
    return abs({ k: "prim", type: "string" }, undefined, undefined, "partial");
  }
  const vR = litValue(a);
  const v = vR.ok ? vR.value : undefined;
  if (v === null) return strLit("object");
  // lit(undefined) 与「无 lit」在 litValue 上都是 undefined，须看 term
  if (a.term?.op === "lit" && a.term.value === undefined) {
    return strLit("undefined");
  }
  // class 声明值本身是 constructor 函数（标记见 class-mark.ts）
  if ((a as object) && classNameOfValue(a as object) !== undefined) {
    return strLit("function");
  }
  if (a.shape.k === "any" || a.shape.k === "unknown") {
    // any/unknown：typeof 只能确定是 string，具体名未知
    return abs({ k: "prim", type: "string" }, undefined, undefined, "partial");
  }
  if (a.shape.k === "sum") {
    const names = [...new Set(a.shape.members.map((m) => typeofName(m.shape)))];
    if (names.length === 1 && names[0] !== "unknown") return strLit(names[0]!);
    return abs({ k: "prim", type: "string" }, undefined, undefined, "partial");
  }
  return strLit(typeofName(a.shape));
}

export function typeofName(s: Shape): string {
  switch (s.k) {
    case "never":
      return "undefined";
    case "any":
      return "unknown";
    case "unknown":
      return "unknown";
    case "prim":
      return s.type;
    case "obj":
    case "arr":
    case "tuple":
    case "brand":
      return "object";
    case "fn":
      return "function";
    case "eff":
      return "object";
    case "sum": {
      const names = [...new Set(s.members.map((m) => typeofName(m.shape)))];
      if (names.length === 1) return names[0]!;
      return "unknown";
    }
    default:
      return "unknown";
  }
}

/** 一元负号：字面量折叠（含 ToNumber 强制）；符号数翻转不等式 */
export function negAbs(a: Abs, _phi: Phi = pTrue): Abs {
  // Symbol 参与一元 -：ToNumber 原生 TypeError（与 add 同口径）
  if (isSym(a)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  const vR = litValue(a);
  const v = vR.ok ? vR.value : undefined;
  if (typeof v === "number") return numLitAbs(-v);
  if (typeof v === "bigint") return bigintLit(-(v as bigint));
  // ToNumber 强制（与 unary + / ~ 的 coercibleNumberLit 同族）：
  // -'5'=-5、-true=-1、-null=-0。lit(undefined) 不折（与 +undefined 同口径）。
  if (a.term?.op === "lit") {
    const tv = a.term.value;
    if (typeof tv === "string" || typeof tv === "boolean" || tv === null) {
      return numLitAbs(-Number(tv));
    }
  }
  if (a.shape.k === "prim" && a.shape.type === "number") {
    if (!a.term) {
      return abs(num().shape, undefined, undefined, confJoin(a.conf, "widened"));
    }
    const term = simplifyTerm(app("-", [a.term]));
    // -x：lo/hi 互换并取负
    const facts: Pred[] = [];
    // 从自身 pred 推：若 x > c ⇒ -x < -c
    if (a.pred && a.pred.op !== "true" && a.term) {
      flipBounds(a.pred, a.term, term, facts);
    }
    return abs(
      num().shape,
      term,
      facts.length ? and(...facts) : undefined,
      confJoin(a.conf, "path"),
    );
  }
  // Bug 8：抽象回退（`-x`，x:any / obj…）—— ToNumeric 可能撞 Symbol
  // （`-Symbol()` 原生 TypeError；bigint 取负合法，仅 Symbol 维度）→
  // may TypeError；bigint prim 值域不变不记。值域 unknown 不变。
  if (isMaybeCoercionThrowOperand(a)) {
    recordMayThrow({
      kind: "TypeError",
      cause: "ToNumeric coercion of abstract operand (Symbol)",
    });
  }
  return abs({ k: "unknown" }, undefined, undefined, "partial");
}

function numLitAbs(n: number): Abs {
  return abs(num().shape, lit(n), pTrue, "exact");
}

function flipBounds(pred: Pred, src: Term, dst: Term, out: Pred[]): void {
  const apply = (p: Pred): void => {
    if (p.op === "and") {
      p.args.forEach(apply);
      return;
    }
    if (
      p.op !== "gt" && p.op !== "ge" && p.op !== "lt" && p.op !== "le"
    ) {
      return;
    }
    if (termKey(p.a) !== termKey(src)) return;
    if (p.b.op !== "lit" || typeof p.b.value !== "number") return;
    const n = p.b.value;
    // x > n ⇒ -x < -n；x ≥ n ⇒ -x ≤ -n；对称
    if (p.op === "gt") out.push(lt(dst, lit(-n)));
    else if (p.op === "ge") out.push(le(dst, lit(-n)));
    else if (p.op === "lt") out.push(gt(dst, lit(-n)));
    else if (p.op === "le") out.push(ge(dst, lit(-n)));
  };
  apply(pred);
}

function termKey(t: Term): string {
  if (t.op === "lit") return `lit:${JSON.stringify(t.value)}`;
  if (t.op === "var") return `var:${t.id}`;
  return `app:${t.fn}`;
}

/** 逻辑非 */
export function notAbs(a: Abs): Abs {
  // 字面量（含 null/undefined/0/""）：直接折叠
  if (a.term?.op === "lit") {
    return boolLit(!a.term.value);
  }
  if (a.shape.k === "prim" && a.shape.type === "boolean") {
    return abs(bool().shape, undefined, undefined, confJoin(a.conf, "widened"));
  }
  // 对象恒真
  if (isDefinitelyTruthyShape(a.shape)) return boolLit(false);
  if (isDefinitelyFalsyShape(a.shape)) return boolLit(true);
  return abs(bool().shape, undefined, undefined, "partial");
}

function isDefinitelyTruthyShape(s: Shape): boolean {
  switch (s.k) {
    case "obj":
    case "arr":
    case "tuple":
    case "fn":
    case "brand":
    case "eff":
      return true;
    case "prim":
      // 0n 为 falsy，bigint 不可判恒真；symbol 恒真
      return s.type === "symbol";
    default:
      return false;
  }
}

function isDefinitelyFalsyShape(s: Shape): boolean {
  return s.k === "never";
}

/** 该 shape 在 JS 上一定不是 null/undefined */
export function definitelyNotNullishShape(s: Shape): boolean {
  switch (s.k) {
    case "prim":
    case "obj":
    case "arr":
    case "tuple":
    case "fn":
    case "brand":
    case "eff":
      return true;
    case "sum":
      return s.members.every((m) => definitelyNotNullishShape(m.shape));
    default:
      return false;
  }
}

/** 仅当 term 确为 lit null/undefined 时为 true；非 lit 的 litValue===undefined 不得当 nullish */
export function isNullishLitAbs(a: Abs): boolean {
  const t = a.term;
  if (!t || t.op !== "lit") return false;
  return t.value === null || t.value === undefined;
}

/**
 * 严格相等（Abs）：双字面量折叠；nullish 与 definitely-not-nullish → false。
 * 返回 undefined = 无法判定（交给 boolean + 调用方）。
 */
export function strictEqAbs(a: Abs, b: Abs): boolean | undefined {
  // 内建构造器身份：Abs ctor ↔ 宿主 Number/String/Promise… 按名折叠
  // （(42).constructor === Number / Promise.resolve(1).constructor === Promise）
  {
    const an = builtinCtorNameOf(a) ?? hostBuiltinCtorName(a);
    const bn = builtinCtorNameOf(b) ?? hostBuiltinCtorName(b);
    if (an !== undefined && bn !== undefined) return an === bn;
  }
  // 宿主值泄漏进 ===（非 Abs）：同引用恒等，否则不可判——不得裸读 .shape
  const aIsAbs = !!(a && typeof a === "object" && "shape" in (a as object));
  const evalIsAbs = !!(b && typeof b === "object" && "shape" in (b as object));
  if (!aIsAbs || !evalIsAbs) {
    return a === b ? true : undefined;
  }
  // 双字面量折叠必须先看 term.op === "lit"：litValue 无法区分
  //「字面量 undefined」与「非字面量」（两者都返回 undefined），
  // undefined === undefined / null === null 此前落无法判定。
  if (a.term?.op === "lit" && b.term?.op === "lit") {
    return a.term.value === b.term.value;
  }
  // 同一 Abs 引用：对象/函数/Symbol 恒等（NaN 字面量例外——NaN !== NaN）。
  // unknown/any 共享单例不得据此折 true（Object.getPrototypeOf 未建模时会假精确）。
  if (a === b) {
    if (a.term?.op === "lit" && typeof a.term.value === "number" && Number.isNaN(a.term.value)) {
      return false;
    }
    const k = a.shape.k;
    if (k === "obj" || k === "arr" || k === "tuple" || k === "fn" || k === "brand" || k === "eff") {
      return true;
    }
    if (k === "prim" && a.shape.type === "symbol") return true;
  }
  // Symbol 身份：同 Abs 引用 → true；两个独立 Symbol() → false（侧表 id）
  if (a.shape.k === "prim" && a.shape.type === "symbol" && b.shape.k === "prim" && b.shape.type === "symbol") {
    const ia = symbolIdOf(a);
    const ib = symbolIdOf(b);
    if (ia !== undefined && ib !== undefined) return ia === ib;
    return undefined;
  }
  const vaR = litValue(a);
  const vbR = litValue(b);
  // 「是否字面量」必须看 ok（abs.ts LitValueResult 契约）：
  // lit(undefined) 的 value 就是 undefined，不得用 value !== undefined 当门闩。
  if (vaR.ok && vbR.ok) return vaR.value === vbR.value;
  const aNullish = vaR.ok && (vaR.value === null || vaR.value === undefined);
  const evalNullish = vbR.ok && (vbR.value === null || vbR.value === undefined);
  if (evalNullish && definitelyNotNullishShape(a.shape)) return false;
  if (aNullish && definitelyNotNullishShape(b.shape)) return false;
  // 同 var 恒等：number/any/unknown 可能是 NaN，x === x 对 NaN 为 false
  //（与同 Abs 引用路径一致——只对引用语义/非 number 原语恒等）。
  if (a.term && b.term && a.term.op === "var" && b.term.op === "var" && a.term.id === b.term.id) {
    const k = a.shape.k;
    if (k === "obj" || k === "arr" || k === "tuple" || k === "fn" || k === "brand" || k === "eff") {
      return true;
    }
    if (k === "prim" && a.shape.type !== "number") return true;
    return undefined;
  }
  // 对象面 ⊗ 函数面：对象与函数是两类不同的值，原生永不恒等
  // （new C() === C → false；此前落 undefined → 调用方折 boolean，
  // 欠精确）。obj/arr/tuple/brand/eff 与 fn 的跨形态比较直接折 false。
  {
    const ak = a.shape.k;
    const bk = b.shape.k;
    const aObjLike =
      ak === "obj" || ak === "arr" || ak === "tuple" || ak === "brand" || ak === "eff";
    const bObjLike =
      bk === "obj" || bk === "arr" || bk === "tuple" || bk === "brand" || bk === "eff";
    if ((aObjLike && bk === "fn") || (ak === "fn" && bObjLike)) return false;
  }
  // 实例 brand ⊗ 类值 brand：实例（无 ctor facet）永不是构造器值
  // （$class 类值带 ctor: true facet）——跨 facet 比较直接折 false
  // （new C() === C / new D() === C 均原生 false）。
  if (a.shape.k === "brand" && b.shape.k === "brand") {
    const aCtor = a.shape.ctor === true;
    const bCtor = b.shape.ctor === true;
    if (aCtor !== bCtor) return false;
  }
  return undefined;
}

/** JS Abstract Equality（仅对可判定的字面量；NaN ≠ 一切，null == undefined） */
function abstractEq(x: unknown, y: unknown): boolean | undefined {
  if (x === y) return true;
  if (x === null && y === undefined) return true;
  if (x === undefined && y === null) return true;
  if (typeof x === "number" && Number.isNaN(x)) return false;
  if (typeof y === "number" && Number.isNaN(y)) return false;
  if (typeof x === "boolean") return abstractEq(x ? 1 : 0, y);
  if (typeof y === "boolean") return abstractEq(x, y ? 1 : 0);
  if (typeof x === "number" && typeof y === "string") return x === Number(y);
  if (typeof x === "string" && typeof y === "number") return Number(x) === y;
  // number ⊗ bigint：数学值比较（number 须为整数；BigInt(非整数) 抛）
  if (typeof x === "number" && typeof y === "bigint") {
    return Number.isInteger(x) && BigInt(x) === y;
  }
  if (typeof x === "bigint" && typeof y === "number") {
    return Number.isInteger(y) && x === BigInt(y);
  }
  // string ⊗ bigint：StringToBigInt（失败即 false；解析歧义不折）
  if (typeof x === "string" && typeof y === "bigint") {
    try {
      return BigInt(x) === y;
    } catch {
      return undefined;
    }
  }
  if (typeof x === "bigint" && typeof y === "string") {
    try {
      return x === BigInt(y);
    } catch {
      return undefined;
    }
  }
  // bigint/symbol/object 字面量：仅引用/同值相等（已在 x===y 处理）
  return false;
}

/**
 * 宽松相等 `==`（C2.3）：双 lit 走 Abstract Equality；否则回落严格相等判定。
 * 返回 undefined = 无法判定。
 */
export function looseEqAbs(a: Abs, b: Abs): boolean | undefined {
  const ta = a.term;
  const tb = b.term;
  if (ta?.op === "lit" && tb?.op === "lit") {
    return abstractEq(ta.value, tb.value);
  }
  return strictEqAbs(a, b);
}
