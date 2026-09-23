/**
 * 语言表面运算（仍在 Abs 上）：typeof / 一元- / ! / nullish 相等。
 * 类型即计算——一元与控制流判定与二元算术同一运算域。
 */

import type { Abs, Shape, Confidence } from "./abs.ts";
import { abs, litValue, confJoin, num, bool, boolLit, strLit, bigintLit } from "./abs.ts";
import { classNameOfValue } from "./class-mark.ts";
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

// --- 位运算 / 移位 / 幂 / ToNumber（B-path $bitand 等与 ast-eval 同口径） ---

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
 * 双字面量二元折叠：双方 bigint → bigint 算子；其余走 number 算子
 * （JS 位运算/移位自身完成 ToInt32/ToUint32&31）。混合 bigint⊗number
 * 原生恒抛 TypeError；bigint 上未定义的算子（如 >>>）或抛错（如 2n**-1n）
 * 一律返回 unknown，不得回落成 bigint 形状。number 侧不可折叠返回 undefined。
 */
function foldNumericBinOp(
  a: Abs,
  b: Abs,
  numOp: (x: number, y: number) => number,
  bigOp?: (x: bigint, y: bigint) => bigint,
): Abs | undefined {
  const va = litValue(a);
  const vb = litValue(b);
  if (typeof va === "bigint" || typeof vb === "bigint") {
    if (typeof va === "bigint" && typeof vb === "bigint") {
      if (!bigOp) return unknownPartial();
      try {
        return abs(
          { k: "prim", type: "bigint" },
          lit(bigOp(va, vb) as never),
          pTrue,
          "exact",
        );
      } catch {
        return unknownPartial();
      }
    }
    return unknownPartial();
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
    if (!bigOp) return unknownPartial();
    try {
      return abs({ k: "prim", type: "bigint" }, lit(bigOp(v) as never), pTrue, "exact");
    } catch {
      return unknownPartial();
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

/** 一元 + —— ToNumber 折叠；bigint 原生恒抛 TypeError → 不可折叠 */
export function toNumberAbs(a: Abs): Abs {
  const v = litValue(a);
  if (typeof v === "bigint") {
    // +5n 原生抛 TypeError，不得折出数值
    return abs({ k: "unknown" }, undefined, undefined, "partial");
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

/** 一元负号：字面量折叠；符号数翻转不等式 */
export function negAbs(a: Abs, _phi: Phi = pTrue): Abs {
  const v = litValue(a);
  if (typeof v === "number") return numLitAbs(-v);
  if (typeof v === "bigint") return bigintLit(-(v as bigint));
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
      return s.type === "symbol" || s.type === "bigint";
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
  const bNullish = vb === null || (b.term?.op === "lit" && b.term.value === undefined);
  if (bNullish && definitelyNotNullishShape(a.shape)) return false;
  if (aNullish && definitelyNotNullishShape(b.shape)) return false;
  // 同 var 恒等
  if (a.term && b.term && a.term.op === "var" && b.term.op === "var" && a.term.id === b.term.id) {
    return true;
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
