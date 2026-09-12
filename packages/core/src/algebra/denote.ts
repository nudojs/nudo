/**
 * 指称：Abs → 运行时谓词（设计 §2.7）。
 * - 无 pred：按 shape 检查（typeof / 结构）
 * - 有 pred：在 `term ↦ v` 下检查可判定的数值比较
 * - sum：任一成员
 */

import type { Abs, Shape } from "./abs.ts";
import { litValue } from "./abs.ts";
import type { Pred } from "./pred.ts";

/** Abs 上的运行时守卫表达式（JS boolean 布尔串） */
export function denoteGuard(a: Abs, v: string): string {
  // 字面量：等值已蕴含 typeof，短路
  const lv = litValue(a);
  if (lv !== undefined && (!a.pred || a.pred.op === "true")) {
    return `${v} === ${JSON.stringify(lv)}`;
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
        const access = `${v}.${key}`;
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
      checks.push(s.rest ? `${v}.length >= ${minLen}` : `${v}.length === ${minLen}`);
      s.elements.forEach((el, i) => {
        const inner = denoteGuard(el, `${v}[${i}]`);
        if (inner !== "true") checks.push(inner);
      });
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
    // 无 pred：字面量 term 直接等值
    const lv = litValue(a);
    if (lv !== undefined) return `${v} === ${JSON.stringify(lv)}`;
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
      // 仅支持 term 侧为值本身（var/lit 与 Abs.term 一致）或字面量比较
      const op = { gt: ">", ge: ">=", lt: "<", le: "<=", eq: "===", ne: "!==" }[p.op];
      const leftIsValue = termIsValue(p.a, a);
      const rightLit = litOfTerm(p.b);
      if (leftIsValue && rightLit !== undefined) {
        return `${v} ${op} ${JSON.stringify(rightLit)}`;
      }
      const leftLit = litOfTerm(p.a);
      const rightIsValue = termIsValue(p.b, a);
      if (rightIsValue && leftLit !== undefined) {
        return `${JSON.stringify(leftLit)} ${op} ${v}`;
      }
      // 双字面量：可判定
      if (leftLit !== undefined && rightLit !== undefined) {
        return `${JSON.stringify(leftLit)} ${op} ${JSON.stringify(rightLit)}`;
      }
      return "true";
    }
    default:
      return "true";
  }
}

function litOfTerm(t: import("./term.ts").Term): unknown {
  return t.op === "lit" ? t.value : undefined;
}

/** term 是否可视为「当前检查值 v」本身 */
function termIsValue(t: import("./term.ts").Term, a: Abs): boolean {
  if (t.op === "var") return true;
  if (t.op === "lit") {
    const lv = litValue(a);
    return lv !== undefined && Object.is(lv, t.value);
  }
  // app 等复合项：保守不绑到 v
  return false;
}
