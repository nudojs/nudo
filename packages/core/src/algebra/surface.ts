/**
 * 语言表面运算（仍在 Abs 上）：typeof / 一元- / ! / nullish 相等。
 * 类型即计算——一元与控制流判定与二元算术同一运算域。
 */

import type { Abs, Shape, Confidence } from "./abs.ts";
import { abs, litValue, confJoin, num, numLit, bool, boolLit, strLit, bigintLit, isStrPrim, isBigPrim } from "./abs.ts";
import { classNameOfValue } from "./class-mark.ts";
import { builtinCtorNameOf, hostBuiltinCtorName } from "./builtins.ts";
import { symbolIdOf } from "./symbol-id.ts";
import type { Term } from "./term.ts";
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
import { NudoThrow } from "./exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "./exec/may-throw.ts";

// --- 位运算 / 移位 / 幂 / ToNumber（evaluator $bitand 等运算符路由） ---

/** 数值可被 JS ToNumber/ToNumeric 折叠的字面量；undefined 字面量不在此列（+undefined → unknown/NaN 不折） */
function coercibleNumberLit(v: ReturnType<typeof litValue>): v is number | string | boolean | null {
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
  const va = litValue(a);
  if (typeof va === "number" || typeof va === "boolean" || va === null) return true;
  if (a.term?.op === "lit" && a.term.value === undefined) return true;
  return a.shape.k === "prim" && (a.shape.type === "number" || a.shape.type === "boolean");
}

/** 可能经 ToPrimitive 变成 bigint（any/unknown/obj/fn/brand/sum）——不得硬抛成 never */
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
  const va = litValue(a);
  const vb = litValue(b);
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
          lit(op(va, vb) as never),
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
  if (coercibleNumberLit(va) && coercibleNumberLit(vb)) {
    return abs(
      { k: "prim", type: "number" },
      lit(numOp(Number(va), Number(vb))),
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
  const v = litValue(a);
  if (typeof v === "bigint") {
    // bigint 上无此一元算子（如 unary +）→ TypeError；折叠失败同口径硬抛
    if (!bigOp) throw new NudoThrow(errorTypeAbs("TypeError"));
    try {
      return abs({ k: "prim", type: "bigint" }, lit(bigOp(v) as never), pTrue, "exact");
    } catch (e) {
      if (e instanceof RangeError) throw new NudoThrow(errorTypeAbs("RangeError"));
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  }
  if (coercibleNumberLit(v)) {
    return abs({ k: "prim", type: "number" }, lit(numOp(Number(v))), pTrue, "exact");
  }
  return undefined;
}

/** 位运算结果的抽象形状：双方 bigint → bigint；含任一 bigint（混合）→ unknown；否则 number */
function bitwiseResultShape(a: Abs, b: Abs): Abs {
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
  const v = litValue(a);
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
 * （bigint→1n，number→1）。不得走 `$add` 的字符串拼接臂。
 */
export function updateAddAbs(a: Abs): Abs {
  const n = toNumericAbs(a);
  const one = n.shape.k === "prim" && n.shape.type === "bigint" ? bigintLit(1n) : numLit(1);
  if (n.shape.k === "prim" && n.shape.type === "bigint" && !n.term) {
    return abs({ k: "prim", type: "bigint" }, undefined, undefined, confJoin(n.conf, "exact"));
  }
  // 双方已是 numeric 面：add 的 number/bigint 臂（无 string concat）
  return addNumeric(n, one);
}

/** UpdateExpression 的 `oldValue - 1`（与 updateAddAbs 同口径） */
export function updateSubAbs(a: Abs): Abs {
  const n = toNumericAbs(a);
  const one = n.shape.k === "prim" && n.shape.type === "bigint" ? bigintLit(1n) : numLit(1);
  if (n.shape.k === "prim" && n.shape.type === "bigint" && !n.term) {
    return abs({ k: "prim", type: "bigint" }, undefined, undefined, confJoin(n.conf, "exact"));
  }
  return subNumeric(n, one);
}

/** numeric 面加法（调用方保证无 string 拼接臂）：lit 折叠，否则 number|bigint prim */
function addNumeric(a: Abs, b: Abs): Abs {
  const va = litValue(a) as number | bigint | undefined;
  const vb = litValue(b) as number | bigint | undefined;
  if (typeof va === "bigint" && typeof vb === "bigint") return bigintLit(va + vb);
  if (typeof va === "number" && typeof vb === "number") return numLit(va + vb);
  const big = (a.shape.k === "prim" && a.shape.type === "bigint") || typeof va === "bigint";
  return abs(
    { k: "prim", type: big ? "bigint" : "number" },
    undefined,
    undefined,
    confJoin(confJoin(a.conf, b.conf), "path"),
  );
}

function subNumeric(a: Abs, b: Abs): Abs {
  const va = litValue(a) as number | bigint | undefined;
  const vb = litValue(b) as number | bigint | undefined;
  if (typeof va === "bigint" && typeof vb === "bigint") return bigintLit(va - vb);
  if (typeof va === "number" && typeof vb === "number") return numLit(va - vb);
  const big = (a.shape.k === "prim" && a.shape.type === "bigint") || typeof va === "bigint";
  return abs(
    { k: "prim", type: big ? "bigint" : "number" },
    undefined,
    undefined,
    confJoin(confJoin(a.conf, b.conf), "path"),
  );
}

/** 一元 + —— ToNumber 折叠；bigint（含抽象 prim）原生恒抛 TypeError → 硬抛 */
export function toNumberAbs(a: Abs): Abs {
  const v = litValue(a);
  if (typeof v === "bigint" || isBigPrim(a)) {
    // +5n / +bigPrim 原生抛 TypeError（catch 可吸收），不得静默 unknown
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (coercibleNumberLit(v)) {
    return abs({ k: "prim", type: "number" }, lit(Number(v)), pTrue, "exact");
  }
  if (a.shape.k === "prim") {
    if (a.shape.type === "number") return a;
    if (a.shape.type === "string" || a.shape.type === "boolean") {
      return abs({ k: "prim", type: "number" }, undefined, undefined, confJoin(a.conf, "widened"));
    }
  }
  // obj/arr/tuple/brand：ToPrimitive 后恒为 number（或自定义 valueOf 抛——partial 近似）
  if (a.shape.k === "obj" || a.shape.k === "arr" || a.shape.k === "tuple" || a.shape.k === "brand") {
    return abs({ k: "prim", type: "number" }, undefined, undefined, "partial");
  }
  return abs({ k: "unknown" }, undefined, undefined, "partial");
}

/** JS typeof：结果域永远是 string */
export function typeofAbs(a: Abs): Abs {
  const v = litValue(a);
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

function typeofName(s: Shape): string {
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
  const v = litValue(a);
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
  const va = litValue(a);
  const vb = litValue(b);
  if (va !== undefined && vb !== undefined) return va === vb;
  const aNullish = va === null || (a.term?.op === "lit" && a.term.value === undefined);
  const evalNullish = vb === null || (b.term?.op === "lit" && b.term.value === undefined);
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
