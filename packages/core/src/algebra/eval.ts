/**
 * 抽象求值：把「函数」应用到 Abs 上。
 * Phase A：内置算术 fn + 极简表达式体（a + b 等）。
 */

import type { Term } from "./term.ts";
import { lit, app as termApp, simplifyTerm } from "./term.ts";
import type { Pred, Phi } from "./pred.ts";
import { and, pTrue, ptypeof } from "./pred.ts";
import type { Abs, Confidence, Shape } from "./abs.ts";
import {
  abs,
  confJoin,
  num,
  numLit,
  numVar,
  obj,
  unknown,
  boolLit,
  litValue,
} from "./abs.ts";
import { add, sub, mul, cmp, trueConstraint, falseConstraint } from "./arithmetic.ts";

/** 极简表达式 AST（够示例 0 / Phase A 使用） */
export type Expr =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "var"; name: string }
  | { kind: "bin"; op: "+" | "-" | "*" | "<" | "<=" | ">" | ">=" | "===" | "!=="; left: Expr; right: Expr }
  | { kind: "call"; callee: string; args: Expr[] }
  | { kind: "fn"; params: string[]; body: Expr };

export type Env = Map<string, Abs>;

export function envOf(pairs: Array<[string, Abs]>): Env {
  return new Map(pairs);
}

/** 求值表达式，产出 Abs（term/pred 尽量保留） */
export function evalExpr(expr: Expr, env: Env, phi: Phi = pTrue): Abs {
  switch (expr.kind) {
    case "num":
      return numLit(expr.value);
    case "str":
      return {
        shape: { k: "prim", type: "string" },
        term: lit(expr.value),
        conf: "exact",
      };
    case "bool":
      return boolLit(expr.value);
    case "var": {
      const v = env.get(expr.name);
      if (!v) return unknown;
      return v;
    }
    case "bin": {
      const l = evalExpr(expr.left, env, phi);
      const r = evalExpr(expr.right, env, phi);
      switch (expr.op) {
        case "+":
          return add(l, r, phi);
        case "-":
          return sub(l, r, phi);
        case "*":
          return mul(l, r, phi);
        case "<":
          return cmp("lt", l, r, phi);
        case "<=":
          return cmp("le", l, r, phi);
        case ">":
          return cmp("gt", l, r, phi);
        case ">=":
          return cmp("ge", l, r, phi);
        case "===":
          return cmp("eq", l, r, phi);
        case "!==":
          return cmp("ne", l, r, phi);
      }
      break;
    }
    case "call": {
      const args = expr.args.map((a) => evalExpr(a, env, phi));
      return applyNamed(expr.callee, args, phi);
    }
    case "fn":
      return {
        shape: { k: "fn", params: expr.params },
        term: undefined,
        conf: "exact",
      };
  }
  return unknown;
}

/** 按名字应用内置 / 已注册函数 */
const registry = new Map<string, { params: string[]; body: Expr }>();

export function defineFn(name: string, params: string[], body: Expr): void {
  registry.set(name, { params, body });
}

// 内置：add(a,b) = a + b
defineFn("add", ["a", "b"], {
  kind: "bin",
  op: "+",
  left: { kind: "var", name: "a" },
  right: { kind: "var", name: "b" },
});

export function applyNamed(name: string, args: Abs[], phi: Phi = pTrue): Abs {
  const def = registry.get(name);
  if (!def) return unknown;
  if (args.length < def.params.length) {
    // 欠应用：Phase A 不支持，返回 unknown
    return unknown;
  }
  const env: Env = new Map();
  def.params.forEach((p, i) => {
    env.set(p, args[i]!);
  });
  // 多余参数忽略（Phase A）
  return evalExpr(def.body, env, phi);
}

/** 应用一个 fn-shape Abs（Phase A：仅 registry 名或闭包表达式） */
export function applyFn(fn: Abs, args: Abs[], phi: Phi = pTrue): Abs {
  if (fn.shape.k !== "fn") return unknown;
  // shape.fn 带 name 时走 registry
  const name = (fn.shape as { k: "fn"; name?: string }).name;
  if (name) return applyNamed(name, args, phi);
  return unknown;
}

/**
 * 条件分支：if (test) cons else alt
 * test 为 true/false 字面量时单边求值；
 * 否则两边求值后 join，并把 test 的约束并入对应分支的 Φ。
 */
export function evalIf(
  test: Expr,
  cons: Expr,
  alt: Expr,
  env: Env,
  phi: Phi = pTrue,
): Abs {
  const t = evalExpr(test, env, phi);
  const tv = litValue(t);

  if (tv === true) {
    return evalExpr(cons, env, phi);
  }
  if (tv === false) {
    return evalExpr(alt, env, phi);
  }

  const tCons = trueConstraint(t);
  const fCons = falseConstraint(t);
  const a = evalExpr(cons, env, tCons ? and(phi, tCons) : phi);
  const b = evalExpr(alt, env, fCons ? and(phi, fCons) : phi);
  return joinAbs(a, b);
}

/** Abs 的 join：同 prim 数则保 term 为 sum 或丢 term；Phase A 保守 */
export function joinAbs(a: Abs, b: Abs): Abs {
  if (a.shape.k === "never") return b;
  if (b.shape.k === "never") return a;

  // 双方 exact 字面量且相等
  const va = litValue(a);
  const vb = litValue(b);
  if (va !== undefined && va === vb) return a;

  // 同为 number prim
  if (
    a.shape.k === "prim" &&
    b.shape.k === "prim" &&
    a.shape.type === b.shape.type
  ) {
    // 无法并项时丢 term，置信度取并
    return abs(
      a.shape,
      undefined,
      undefined,
      confJoin(confJoin(a.conf, b.conf), "widened"),
    );
  }

  // 异 kind → unknown（Phase A 不做 sum）
  return abs(
    { k: "unknown" },
    undefined,
    undefined,
    confJoin(confJoin(a.conf, b.conf), "partial"),
  );
}

/** 便捷：以符号参数调用 add */
export function callAdd(a: Abs, b: Abs, phi: Phi = pTrue): Abs {
  return applyNamed("add", [a, b], phi);
}
