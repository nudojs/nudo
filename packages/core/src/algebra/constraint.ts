/**
 * 约束模板构建器（参数无关）。
 *
 *   number().gt(0)                    → 占位项 self 上的 Pred
 *   shape({ id: number().gt(0) })     → object 形状约束
 *   instantiate("ms")                 → Pred ms > 0 / u.id > 0 ∧ …
 *
 * 在 *.nudo.js 里执行；不是 zod 绑定，是我们自己的运行时 API。
 * 不需要 interface/type 语法——契约用 JS 表达式声明。
 */

import type { Pred, PrimName } from "./pred.ts";
import { and, gt, ge, lt, le, ptypeof } from "./pred.ts";
import { v as termVar, lit, app as termApp, type Term } from "./term.ts";
import type { Abs } from "./abs.ts";
import { abs } from "./abs.ts";

/** 模板占位项；instantiate 时换成真实参数名 */
export const SELF = "__nudo_self__";

function selfTerm(): Term {
  return termVar(SELF);
}

/** 字段访问项：u.id */
export function getTerm(obj: Term, key: string): Term {
  return termApp("get", [obj, lit(key)]);
}

export type NudoField = {
  constraint: NudoConstraint;
  optional?: boolean;
};

export type NudoConstraint = {
  readonly __nudoConstraint: true;
  readonly prim?: PrimName;
  readonly preds: Pred[];
  /** object 形状：字段名 → 嵌套约束 */
  readonly fields?: Record<string, NudoField>;
  /** 该约束整体可选（shape 字段用；不用 optional 以免与链式方法撞名） */
  readonly isOptional?: boolean;
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
  /** 字段可选（仅在 shape 内有意义） */
  optional(): ConstraintBuilder;
};

function makeBuilder(
  prim: PrimName | undefined,
  preds: Pred[],
  fields?: Record<string, NudoField>,
  optional?: boolean,
): ConstraintBuilder {
  const base: NudoConstraint = {
    __nudoConstraint: true,
    ...(prim ? { prim } : {}),
    preds: [...preds],
    ...(fields ? { fields } : {}),
    ...(optional ? { isOptional: true } : {}),
  };
  const add = (p: Pred): ConstraintBuilder =>
    makeBuilder(prim, [...preds, p], fields, optional);
  return Object.assign(Object.create(null), base, {
    gt: (n: number) => add(gt(selfTerm(), lit(n))),
    ge: (n: number) => add(ge(selfTerm(), lit(n))),
    lt: (n: number) => add(lt(selfTerm(), lit(n))),
    le: (n: number) => add(le(selfTerm(), lit(n))),
    optional: () => makeBuilder(prim, preds, fields, true),
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

/**
 * object 形状约束（契约规范形状，无需 interface）：
 *
 *   shape({ id: number().gt(0), name: string() })
 */
export function shape(
  fields: Record<string, NudoConstraint | ConstraintBuilder>,
): ConstraintBuilder {
  const mapped: Record<string, NudoField> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!isConstraint(v)) continue;
    mapped[k] = {
      constraint: v,
      ...(v.isOptional ? { optional: true } : {}),
    };
  }
  return makeBuilder(undefined, [], mapped, false);
}

function substTerm(t: Term, paramName: string): Term {
  if (t.op === "var" && t.id === SELF) return termVar(paramName);
  if (t.op === "app" && t.fn === "get" && t.args.length === 2) {
    return getTerm(substTerm(t.args[0]!, paramName), String(
      t.args[1]!.op === "lit" ? t.args[1]!.value : "",
    ));
  }
  return t;
}

function substPred(p: Pred, paramName: string): Pred {
  switch (p.op) {
    case "gt":
    case "ge":
    case "lt":
    case "le":
    case "eq":
    case "ne": {
      return { op: p.op, a: substTerm(p.a, paramName), b: substTerm(p.b, paramName) };
    }
    case "typeof": {
      return { op: "typeof", t: substTerm(p.t, paramName), type: p.type };
    }
    case "and":
      return and(...p.args.map((x) => substPred(x, paramName)));
    default:
      return p;
  }
}

/** 把模板绑定到参数名：self → paramName；shape 展开为字段访问 Pred */
export function instantiateConstraint(
  c: NudoConstraint,
  paramName: string,
): Pred {
  // shape：展开为 and(字段 preds)
  if (c.fields) {
    const parts: Pred[] = [];
    for (const [key, field] of Object.entries(c.fields)) {
      const fieldTerm = getTerm(termVar(paramName), key);
      parts.push(instantiateOnTerm(field.constraint, fieldTerm));
    }
    if (c.prim) parts.push(ptypeof(termVar(paramName), c.prim));
    if (parts.length === 0) return { op: "true" };
    return parts.length === 1 ? parts[0]! : and(...parts);
  }

  const preds = c.preds.map((p) => substPred(p, paramName));
  // prim 可作为 typeof 约束补上（optional）
  if (c.prim && c.preds.length === 0) {
    return ptypeof(termVar(paramName), c.prim);
  }
  return preds.length === 0 ? { op: "true" } : preds.length === 1 ? preds[0]! : and(...preds);
}

/** 在给定项上实例化约束（shape 字段递归用） */
function instantiateOnTerm(c: NudoConstraint, t: Term): Pred {
  if (c.fields) {
    const parts: Pred[] = [];
    for (const [key, field] of Object.entries(c.fields)) {
      parts.push(instantiateOnTerm(field.constraint, getTerm(t, key)));
    }
    if (parts.length === 0) return { op: "true" };
    return parts.length === 1 ? parts[0]! : and(...parts);
  }
  const subst = (p: Pred): Pred => {
    switch (p.op) {
      case "gt":
      case "ge":
      case "lt":
      case "le":
      case "eq":
      case "ne": {
        const a = p.a.op === "var" && p.a.id === SELF ? t : p.a;
        const b = p.b.op === "var" && p.b.id === SELF ? t : p.b;
        return { op: p.op, a, b };
      }
      case "typeof": {
        const tt = p.t.op === "var" && p.t.id === SELF ? t : p.t;
        return { op: "typeof", t: tt, type: p.type };
      }
      case "and":
        return and(...p.args.map(subst));
      default:
        return p;
    }
  };
  const preds = c.preds.map(subst);
  if (c.prim && c.preds.length === 0) return ptypeof(t, c.prim);
  return preds.length === 0 ? { op: "true" } : preds.length === 1 ? preds[0]! : and(...preds);
}

/**
 * 契约 → 函数入口 param Abs（infer/hover 用）。
 * 标量：prim + pred；shape：obj slots 递归。
 */
export function constraintToEntryAbs(
  c: NudoConstraint,
  paramName: string,
): Abs {
  const t = termVar(paramName);
  if (c.fields) {
    const slots: Record<string, { value: Abs; optional?: boolean }> = {};
    for (const [key, field] of Object.entries(c.fields)) {
      const fieldTerm = getTerm(t, key);
      slots[key] = {
        value: constraintOnTermAbs(field.constraint, fieldTerm),
        ...(field.optional || field.constraint.isOptional
          ? { optional: true }
          : {}),
      };
    }
    return abs({ k: "obj", slots }, t, undefined, "path");
  }
  return constraintOnTermAbs(c, t);
}

function constraintOnTermAbs(c: NudoConstraint, t: Term): Abs {
  if (c.fields) {
    const slots: Record<string, { value: Abs; optional?: boolean }> = {};
    for (const [key, field] of Object.entries(c.fields)) {
      slots[key] = {
        value: constraintOnTermAbs(field.constraint, getTerm(t, key)),
        ...(field.optional || field.constraint.isOptional
          ? { optional: true }
          : {}),
      };
    }
    return abs({ k: "obj", slots }, t, undefined, "path");
  }
  const pred = instantiateOnTerm(c, t);
  const predOut = pred.op === "true" ? undefined : pred;
  if (c.prim) {
    return abs({ k: "prim", type: c.prim }, t, predOut, "path");
  }
  // 有界但无 prim：按 number 处理（number().gt(0) 已带 prim）
  if (c.preds.length > 0) {
    return abs({ k: "prim", type: "number" }, t, predOut, "path");
  }
  return abs({ k: "any" }, t, undefined, "path");
}
