/**
 * 指称：Abs → 运行时谓词（设计 §2.7）。
 * - 无 pred：按 shape 检查（typeof / 结构）
 * - 有 pred：在 `term ↦ v` 下检查可判定的数值比较
 * - sum：任一成员
 */

import type { Abs, Shape } from "./abs.ts";
import type { Pred } from "./pred.ts";
import type { LiteralValue } from "./term.ts";
import { safeMemberAccess } from "./codegen-escape.ts";

/** Abs 上的运行时守卫表达式（JS boolean 布尔串） */
export function denoteGuard(a: Abs, v: string): string {
  // 字面量：等值已蕴含 typeof，短路。litValue 哨兵对 lit(undefined) 也是
  // undefined，必须直接看 term（同 format.ts / leq.ts）。
  if (a.term?.op === "lit" && (!a.pred || a.pred.op === "true")) {
    return eqGuard(v, a.term.value);
  }
  const shape = denoteShape(a.shape, v);
  const pred = denotePred(a, v);
  if (shape === "true") return pred;
  if (pred === "true") return shape;
  return `(${shape}) && (${pred})`;
}

function denoteShape(s: Shape, v: string): string {
  switch (s.k) {
    case "never":
      return "false";
    case "unknown":
    case "any":
      return "true";
    case "prim":
      switch (s.type) {
        case "number":
          return `typeof ${v} === "number"`;
        case "string":
          return `typeof ${v} === "string"`;
        case "boolean":
          return `typeof ${v} === "boolean"`;
        case "bigint":
          return `typeof ${v} === "bigint"`;
        case "symbol":
          return `typeof ${v} === "symbol"`;
        default:
          return "true";
      }
    case "obj": {
      const checks = [`typeof ${v} === "object"`, `${v} !== null`];
      for (const [key, slot] of Object.entries(s.slots)) {
        const access = safeMemberAccess(v, key);
        const inner = denoteGuard(slot.value, access);
        if (slot.optional) {
          if (inner !== "true") checks.push(`(${access} === undefined || ${inner})`);
        } else {
          if (inner !== "true") checks.push(inner);
        }
      }
      return checks.join(" && ");
    }
    case "arr":
      return `Array.isArray(${v}) && ${v}.every((item) => ${denoteGuard(s.element, "item")})`;
    case "tuple": {
      const checks = [`Array.isArray(${v})`];
      const minLen = s.elements.length;
      const holes = new Set(s.holes ?? []);
      checks.push(s.rest ? `${v}.length >= ${minLen}` : `${v}.length === ${minLen}`);
      s.elements.forEach((el, i) => {
        // hole 槽是下标缺席（`i in v` 为 false），不得检成 `v[i] === undefined`
        // （后者对显式 undefined 元素同样成立，会把稀疏位抹平）。
        if (holes.has(i)) {
          checks.push(`!(${i} in ${v})`);
          return;
        }
        const inner = denoteGuard(el, `${v}[${i}]`);
        if (inner !== "true") checks.push(inner);
      });
      for (const i of holes) {
        if (i >= minLen) checks.push(`!(${i} in ${v})`);
      }
      if (s.rest) {
        // rest 槽：长度超出部分统一检查
        const rest = denoteGuard(s.rest, "item");
        if (rest !== "true") {
          checks.push(`${v}.slice(${minLen}).every((item) => ${rest})`);
        }
      }
      return checks.join(" && ");
    }
    case "fn":
      return `typeof ${v} === "function"`;
    case "eff":
      if (s.eff === "promise") return `${v} instanceof Promise`;
      return "true";
    case "brand":
      return denoteShape(s.shape.shape, v);
    case "sum": {
      if (s.members.length === 0) return "false";
      const parts = s.members.map((m) => denoteGuard(m, v));
      return `(${parts.join(" || ")})`;
    }
  }
}

/**
 * 在 `term ↦ v` 下检查 pred。
 * 仅编码可判定的数值比较与字面量等值；不可判定返回 "true"（保守、不撒谎）。
 */
function denotePred(a: Abs, v: string): string {
  const p = a.pred;
  if (!p || p.op === "true") {
    // 无 pred：字面量 term 直接等值（term 判定，不用 litValue 哨兵）
    if (a.term?.op === "lit") return eqGuard(v, a.term.value);
    return "true";
  }
  return predAsJs(p, v, a);
}

function predAsJs(p: Pred, v: string, a: Abs): string {
  switch (p.op) {
    case "true":
      return "true";
    case "false":
      return "false";
    case "and":
      return p.args.map((x) => predAsJs(x, v, a)).join(" && ");
    case "or":
      return `(${p.args.map((x) => predAsJs(x, v, a)).join(" || ")})`;
    case "not": {
      const inner = predAsJs(p.arg, v, a);
      return inner === "true" ? "false" : `!(${inner})`;
    }
    case "gt":
    case "ge":
    case "lt":
    case "le":
    case "eq":
    case "ne": {
      // 仅支持 term 侧为值本身（var/lit 与 Abs.term 一致）或字面量比较。
      // lit 判定须看 t.op==="lit"：litValue 哨兵对 lit(undefined) 折成 undefined。
      const op = { gt: ">", ge: ">=", lt: "<", le: "<=", eq: "===", ne: "!==" }[p.op];
      const leftIsValue = termIsValue(p.a, a);
      const rightLitTerm = p.b.op === "lit" ? p.b : undefined;
      if (leftIsValue && rightLitTerm) {
        return cmpOp(v, op, rightLitTerm.value);
      }
      const leftLitTerm = p.a.op === "lit" ? p.a : undefined;
      const rightIsValue = termIsValue(p.b, a);
      if (rightIsValue && leftLitTerm) {
        return cmpLitValue(leftLitTerm.value, op, v);
      }
      // 双字面量：可判定
      if (leftLitTerm && rightLitTerm) {
        return `${jsLit(leftLitTerm.value)} ${op} ${jsLit(rightLitTerm.value)}`;
      }
      return "true";
    }
    default:
      return "true";
  }
}

/** 字面量 → JS 表达式串。NaN/±Infinity 经 JSON.stringify 会得 "null"，须专处理。 */
function jsLit(v: LiteralValue): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "bigint") return `${v}n`;
  if (typeof v === "number") {
    if (Number.isNaN(v)) return "NaN";
    if (v === Infinity) return "Infinity";
    if (v === -Infinity) return "-Infinity";
    return String(v);
  }
  return JSON.stringify(v);
}

/** 等值守卫：NaN 必须走 Number.isNaN（NaN === NaN 为 false），不能 === 比较 */
function eqGuard(v: string, lv: LiteralValue): string {
  if (typeof lv === "number" && Number.isNaN(lv)) return `Number.isNaN(${v})`;
  return `${v} === ${jsLit(lv)}`;
}

/** 比较操作数：NaN 在 ===/!== 上同样不能用 ===，其余交给 jsLit 渲染 */
function cmpOp(v: string, op: string, lit: LiteralValue): string {
  if (typeof lit === "number" && Number.isNaN(lit)) {
    if (op === "===") return `Number.isNaN(${v})`;
    if (op === "!==") return `!Number.isNaN(${v})`;
  }
  return `${v} ${op} ${jsLit(lit)}`;
}

/** 反向比较：lit op v（关系算子不对称，须保持字面量在左） */
function cmpLitValue(lit: LiteralValue, op: string, v: string): string {
  if (typeof lit === "number" && Number.isNaN(lit)) {
    if (op === "===") return `Number.isNaN(${v})`;
    if (op === "!==") return `!Number.isNaN(${v})`;
  }
  return `${jsLit(lit)} ${op} ${v}`;
}

/** term 是否可视为「当前检查值 v」本身 */
function termIsValue(t: import("./term.ts").Term, a: Abs): boolean {
  if (t.op === "var") return true;
  if (t.op === "lit") {
    // litValue 哨兵对 lit(undefined) 折成 undefined，须直接看 term + Object.is
    return a.term?.op === "lit" && Object.is(a.term.value, t.value);
  }
  // app 等复合项：保守不绑到 v
  return false;
}
