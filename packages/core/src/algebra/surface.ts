/**
 * 语言表面运算（仍在 Abs 上）：typeof / 一元- / ! / nullish 相等。
 * 类型即计算——一元与控制流判定与二元算术同一运算域。
 */

import type { Abs, Shape, Confidence } from "./abs.ts";
import { abs, litValue, confJoin, num, bool, boolLit, strLit } from "./abs.ts";
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

/** JS typeof：结果域永远是 string */
export function typeofAbs(a: Abs): Abs {
  const v = litValue(a);
  if (v === null) return strLit("object");
  // lit(undefined) 与「无 lit」在 litValue 上都是 undefined，须看 term
  if (a.term?.op === "lit" && a.term.value === undefined) {
    return strLit("undefined");
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

export function isNullishLitAbs(a: Abs): boolean {
  const v = litValue(a);
  if (v === null || v === undefined) return true;
  // shape 层：无 lit 的 unknown 不判 nullish
  return false;
}

/**
 * 严格相等（Abs）：双字面量折叠；nullish 与 definitely-not-nullish → false。
 * 返回 undefined = 无法判定（交给 boolean + 调用方）。
 */
export function strictEqAbs(a: Abs, b: Abs): boolean | undefined {
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
function abstractEq(x: unknown, y: unknown): boolean {
  if (x === y) return true;
  if (x === null && y === undefined) return true;
  if (x === undefined && y === null) return true;
  if (typeof x === "number" && Number.isNaN(x)) return false;
  if (typeof y === "number" && Number.isNaN(y)) return false;
  if (typeof x === "boolean") return abstractEq(x ? 1 : 0, y);
  if (typeof y === "boolean") return abstractEq(x, y ? 1 : 0);
  if (typeof x === "number" && typeof y === "string") return x === Number(y);
  if (typeof x === "string" && typeof y === "number") return Number(x) === y;
  // bigint/symbol/object 字面量：仅引用/同值相等（已在 x===y 处理）
  return false;
}

/**
 * 宽松相等 `==`（C2.3）：双 lit 走 Abstract Equality；否则回落严格相等判定。
 * 返回 undefined = 无法判定。
 */
export function looseEqAbs(a: Abs, b: Abs): boolean | undefined {
  const bothLit = a.term?.op === "lit" && b.term?.op === "lit";
  if (bothLit) {
    return abstractEq(a.term.value, b.term.value);
  }
  return strictEqAbs(a, b);
}
