/**
 * 约束模板构建器（参数无关）。
 *
 *   number().gt(0)     → 占位项 self 上的 Pred
 *   instantiate("ms")  → Pred ms > 0
 *
 * 在 *.nudo.js 里执行；不是 zod 绑定，是我们自己的运行时 API。
 */

import type { Pred, PrimName } from "./pred.ts";
import { and, gt, ge, lt, le, ptypeof } from "./pred.ts";
import { v as termVar, lit, type Term } from "./term.ts";

/** 模板占位项；instantiate 时换成真实参数名 */
export const SELF = "__nudo_self__";

function selfTerm(): Term {
  return termVar(SELF);
}

export type NudoConstraint = {
  readonly __nudoConstraint: true;
  readonly prim?: PrimName;
  readonly preds: Pred[];
};

function isConstraint(x: unknown): x is NudoConstraint {
  return (
    !!x &&
    typeof x === "object" &&
    (x as NudoConstraint).__nudoConstraint === true
  );
}

export function isNudoConstraint(x: unknown): x is NudoConstraint {
  return isConstraint(x);
}

/** 链式约束：不可变，每次 .gt() 返回新对象 */
export type ConstraintBuilder = NudoConstraint & {
  gt(n: number): ConstraintBuilder;
  ge(n: number): ConstraintBuilder;
  lt(n: number): ConstraintBuilder;
  le(n: number): ConstraintBuilder;
};

function makeBuilder(prim: PrimName | undefined, preds: Pred[]): ConstraintBuilder {
  const base: NudoConstraint = {
    __nudoConstraint: true,
    ...(prim ? { prim } : {}),
    preds: [...preds],
  };
  const add = (p: Pred): ConstraintBuilder => makeBuilder(prim, [...preds, p]);
  return Object.assign(Object.create(null), base, {
    gt: (n: number) => add(gt(selfTerm(), lit(n))),
    ge: (n: number) => add(ge(selfTerm(), lit(n))),
    lt: (n: number) => add(lt(selfTerm(), lit(n))),
    le: (n: number) => add(le(selfTerm(), lit(n))),
  }) as ConstraintBuilder;
}

/** number() —— 约束 number 原语 + 后续链式界 */
export function number(): ConstraintBuilder {
  return makeBuilder("number", []);
}

export function string(): ConstraintBuilder {
  return makeBuilder("string", []);
}

export function boolean(): ConstraintBuilder {
  return makeBuilder("boolean", []);
}

/** 把模板绑定到参数名：self → paramName */
export function instantiateConstraint(
  c: NudoConstraint,
  paramName: string,
): Pred {
  const subst = (p: Pred): Pred => {
    switch (p.op) {
      case "gt":
      case "ge":
      case "lt":
      case "le":
      case "eq":
      case "ne": {
        const a = p.a.op === "var" && p.a.id === SELF ? termVar(paramName) : p.a;
        const b = p.b.op === "var" && p.b.id === SELF ? termVar(paramName) : p.b;
        return { op: p.op, a, b };
      }
      case "typeof": {
        const t = p.t.op === "var" && p.t.id === SELF ? termVar(paramName) : p.t;
        return { op: "typeof", t, type: p.type };
      }
      case "and":
        return and(...p.args.map(subst));
      default:
        return p;
    }
  };
  const preds = c.preds.map(subst);
  // prim 可作为 typeof 约束补上（optional）
  if (c.prim && c.preds.length === 0) {
    return ptypeof(termVar(paramName), c.prim);
  }
  return preds.length === 0 ? { op: "true" } : preds.length === 1 ? preds[0]! : and(...preds);
}
