/**
 * 约束模板构建器（参数无关）。
 *
 *   number().gt(0)                    → 占位项 self 上的 Pred
 *   number().int().ge(0)              → 整数 + 下界
 *   string().min(1)                   → 非空串（长度）
 *   array(number().gt(0))             → 元素约束
 *   shape({ id: number().gt(0) })     → object 形状约束
 *   lit(42)                           → 字面量（prim + eq(self, 42)）
 *   union(number().gt(0), lit(0))     → 成员析取（or / joinAbs）
 *   fn({ x: number().gt(0) }, number()) → 一等函数约束
 *   number().gt(0).shift(1)           → 界平移（x>0 ⇒ x+n>1）
 *   instantiate("ms")                 → Pred ms > 0 / u.id > 0 ∧ …
 *
 * 在 *.nudo.js 里执行；不是 zod 绑定，是我们自己的运行时 API。
 * 不需要 interface/type 语法——契约用 JS 表达式声明。
 * 注意：本文件的 lit/and 构建器与 term/pred 同名导出在桶导出处冲突，
 * 消费方从 "./constraint.ts" 直接路径导入。
 */

import type { Pred, PrimName } from "./pred.ts";
import { and as pAnd, or, eq, gt, ge, lt, le, ptypeof, pTrue } from "./pred.ts";
import { v as termVar, lit as termLit, app as termApp, type Term } from "./term.ts";
import type { Abs } from "./abs.ts";
import { abs, unknown } from "./abs.ts";
import { joinAbs } from "./objects.ts";

/** 模板占位项；instantiate 时换成真实参数名 */
export const SELF = "__nudo_self__";

function selfTerm(): Term {
  return termVar(SELF);
}

/** 字段访问项：u.id */
export function getTerm(obj: Term, key: string): Term {
  return termApp("get", [obj, termLit(key)]);
}

/** 长度项：length(u) */
export function lenTerm(t: Term): Term {
  return termApp("length", [t]);
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
  /** array 元素约束 */
  readonly element?: NudoConstraint;
  /** 整数（number 链式 .int()） */
  readonly int?: boolean;
  /** 该约束整体可选（shape 字段用；不用 optional 以免与链式方法撞名） */
  readonly isOptional?: boolean;
  /** union 成员（析取）：instantiate 为 or(...)，entry Abs 为成员 join */
  readonly members?: NudoConstraint[];
  /** 一等函数约束（fn() 构建器产出） */
  readonly fn?: NudoFnConstraint;
};

/** fn(params, returns?, { throws? }) 的一等函数约束形态 */
export type NudoFnConstraint = {
  params: Record<string, NudoConstraint>;
  returns?: NudoConstraint;
  throws?: NudoConstraint;
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
  /** number：要求整数 */
  int(): ConstraintBuilder;
  /** string：长度下界 */
  min(n: number): ConstraintBuilder;
  /** string：长度上界 */
  max(n: number): ConstraintBuilder;
  /** string：精确长度 */
  length(n: number): ConstraintBuilder;
  /**
   * 界平移：term 平移 n 后重写常数界（x>0 ⇒ x+n>n）。
   * 仅数值标量界链合法；length 界 / shape / array / union / fn → throw。
   */
  shift(n: number): ConstraintBuilder;
  /** 字段可选（仅在 shape 内有意义） */
  optional(): ConstraintBuilder;
};

/** 已链 .int() 的 builder 对象（int 数据标志与链式方法同名，WeakSet 承载） */
const intFlaggedBuilders = new WeakSet<object>();

/**
 * builder 与纯数据形态统一的 int 标志读取：纯数据看 `int === true`，
 * builder（int 是链式方法）查 WeakSet。toPlainConstraint 归一化后只剩前者。
 */
export function isIntFlag(c: NudoConstraint): boolean {
  return c.int === true || intFlaggedBuilders.has(c as object);
}

function makeBuilder(
  prim: PrimName | undefined,
  preds: Pred[],
  extra?: {
    fields?: Record<string, NudoField>;
    element?: NudoConstraint;
    int?: boolean;
    optional?: boolean;
    members?: NudoConstraint[];
    fn?: NudoFnConstraint;
  },
): ConstraintBuilder {
  const fields = extra?.fields;
  const element = extra?.element;
  const isInt = extra?.int;
  const optional = extra?.optional;
  const members = extra?.members;
  const fnSlot = extra?.fn;
  // base 不携带 int 键（methods-last 下会被同名方法覆盖，信息反而丢失）：
  // int 标志经 intFlaggedBuilders WeakSet 承载，归一化时由 isIntFlag 落回数据
  const base: NudoConstraint = {
    __nudoConstraint: true,
    ...(prim ? { prim } : {}),
    preds: [...preds],
    ...(fields ? { fields } : {}),
    ...(element ? { element } : {}),
    ...(optional ? { isOptional: true } : {}),
    ...(members ? { members } : {}),
    ...(fnSlot ? { fn: fnSlot } : {}),
  };
  const add = (p: Pred): ConstraintBuilder =>
    makeBuilder(prim, [...preds, p], extra);
  // base 先赋、方法后赋：所有链式方法（含 .int() 的重复幂等调用）恒可用；
  // int 数据可见性由 isIntFlag 统一读取（域判定 / 显示 / 归一化）。
  const builder = Object.assign(
    Object.create(null),
    base,
    {
      gt: (n: number) => add(gt(selfTerm(), termLit(n))),
      ge: (n: number) => add(ge(selfTerm(), termLit(n))),
      lt: (n: number) => add(lt(selfTerm(), termLit(n))),
      le: (n: number) => add(le(selfTerm(), termLit(n))),
      int: () => makeBuilder(prim ?? "number", preds, { ...extra, int: true }),
      min: (n: number) => add(ge(lenTerm(selfTerm()), termLit(n))),
      max: (n: number) => add(le(lenTerm(selfTerm()), termLit(n))),
      length: (n: number) =>
        add(pAnd(ge(lenTerm(selfTerm()), termLit(n)), le(lenTerm(selfTerm()), termLit(n)))),
      shift: (n: number) => {
        if (!Number.isFinite(n))
          throw new Error("nudo shift(): offset must be a finite number");
        if (fields || element || members || fnSlot)
          throw new Error("nudo shift(): 仅数值标量约束链合法（不支持 shape/array/union/fn）");
        if (prim !== undefined && prim !== "number")
          throw new Error(`nudo shift(): 仅数值链合法（prim=${prim}）`);
        return makeBuilder(prim, shiftBoundPreds(preds, n), extra);
      },
      optional: () => makeBuilder(prim, preds, { ...extra, optional: true }),
    },
  ) as ConstraintBuilder;
  if (isInt) intFlaggedBuilders.add(builder as object);
  return builder;
}

/** 常数界平移：每个 gt/ge/lt/le 右端数字 lit +n；非法形态 throw */
function shiftBoundPreds(preds: Pred[], n: number): Pred[] {
  return preds.map((p): Pred => {
    if (p.op !== "gt" && p.op !== "ge" && p.op !== "lt" && p.op !== "le")
      throw new Error(`nudo shift(): 不支持 ${p.op} 谓词（仅 gt/ge/lt/le 常数界）`);
    const { a, b } = p;
    if (b.op !== "lit" || typeof b.value !== "number")
      throw new Error("nudo shift(): 常数界右端须为数字字面量");
    if (termHasApp(a, "length") || termHasApp(b, "length"))
      throw new Error("nudo shift(): 不支持 length(...) 界");
    return { op: p.op, a, b: termLit(b.value + n) };
  });
}

/** 项里是否出现 fn 应用（如 length(u)） */
function termHasApp(t: Term, fn: string): boolean {
  if (t.op !== "app") return false;
  if (t.fn === fn) return true;
  return t.args.some((x) => termHasApp(x, fn));
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

/** any() —— 无约束；formatConstraint / draft import 与显示同源 */
export function any(): ConstraintBuilder {
  return makeBuilder(undefined, []);
}

/** array(item) —— 数组，元素满足 item */
export function array(item: NudoConstraint | ConstraintBuilder): ConstraintBuilder {
  if (!isConstraint(item))
    throw new Error("nudo: array(item) 期望约束值（number()/string()/…或其组合子）");
  return makeBuilder(undefined, [], { element: item });
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
    if (!isConstraint(v))
      throw new Error(
        `nudo: shape 字段 '${k}' 期望约束值（number()/string()/…或其组合子），收到非约束`,
      );
    mapped[k] = {
      constraint: v,
      ...(v.isOptional ? { optional: true } : {}),
    };
  }
  return makeBuilder(undefined, [], { fields: mapped });
}

/** 归一化为纯数据约束（剥掉 builder 方法——成员快照不可再链式改写） */
function toPlainConstraint(c: NudoConstraint): NudoConstraint {
  if (!isConstraint(c))
    throw new Error("nudo: 期望约束值（number()/string()/…或其组合子）");
  return {
    __nudoConstraint: true,
    ...(c.prim ? { prim: c.prim } : {}),
    preds: [...c.preds],
    ...(c.fields ? { fields: c.fields } : {}),
    ...(c.element ? { element: c.element } : {}),
    // isIntFlag 统一读取：builder（int 是方法）查 WeakSet，纯数据看 === true
    ...(isIntFlag(c) ? { int: true } : {}),
    ...(c.isOptional ? { isOptional: true } : {}),
    ...(c.members ? { members: c.members } : {}),
    ...(c.fn ? { fn: c.fn } : {}),
  };
}

/** lit(v)：字面量契约——prim 按 v 类型、eq(self, v) pred 编码（不开新字段） */
export function lit(v: number | string | boolean | null): ConstraintBuilder {
  const prim: PrimName | undefined =
    typeof v === "number" ? "number"
    : typeof v === "string" ? "string"
    : typeof v === "boolean" ? "boolean"
    : undefined;
  return makeBuilder(prim, [eq(selfTerm(), termLit(v))]);
}

/** union(...cs)：成员析取；instantiate 为 or(...)，entry Abs 为成员 joinAbs。空参 throw */
export function union(
  ...cs: (NudoConstraint | ConstraintBuilder)[]
): ConstraintBuilder {
  if (cs.length === 0)
    throw new Error("nudo union(): 至少需要一个成员约束");
  return makeBuilder(undefined, [], { members: cs.map(toPlainConstraint) });
}

/**
 * fn(params, returns?, { throws? })：一等函数约束。
 * Phase 1 只展示不执法：参数位 instantiate 恒真（pTrue），
 * 逐参约束经 fnConstraintToEntryReqs 消费。
 */
export function fn(
  params: Record<string, NudoConstraint | ConstraintBuilder>,
  returns?: NudoConstraint | ConstraintBuilder,
  opts?: { throws?: NudoConstraint | ConstraintBuilder },
): ConstraintBuilder {
  const normalized: Record<string, NudoConstraint> = {};
  for (const [k, v] of Object.entries(params)) normalized[k] = toPlainConstraint(v);
  return makeBuilder(undefined, [], {
    fn: {
      params: normalized,
      ...(returns !== undefined ? { returns: toPlainConstraint(returns) } : {}),
      ...(opts?.throws !== undefined ? { throws: toPlainConstraint(opts.throws) } : {}),
    },
  });
}

/**
 * and(...cs)：标量合取（Phase 1 最小实现）。
 * prim 一致（缺省 prim 视为无 prim 约束、可与任意 prim 合并）→ preds 拼接；
 * prim 不一致或任一含 fields/element/members/fn → throw。
 */
export function and(
  ...cs: (NudoConstraint | ConstraintBuilder)[]
): ConstraintBuilder {
  if (cs.length === 0)
    throw new Error("nudo and(): 至少需要一个约束");
  let prim: PrimName | undefined;
  let isInt = false;
  let allOptional = true;
  const preds: Pred[] = [];
  for (const c of cs) {
    if (!isConstraint(c))
      throw new Error("nudo: 期望约束值（number()/string()/…或其组合子）");
    if (c.fields || c.element || c.members || c.fn)
      throw new Error("nudo and(): Phase 1 仅支持标量约束合取（不支持 shape/array/union/fn）");
    if (c.prim) {
      if (prim !== undefined && prim !== c.prim)
        throw new Error(`nudo and(): prim 不一致（${prim} vs ${c.prim}）`);
      prim = c.prim;
    }
    preds.push(...c.preds);
    // isIntFlag 统一读取：builder（int 是方法）查 WeakSet，纯数据看 === true
    if (isIntFlag(c)) isInt = true;
    if (!c.isOptional) allOptional = false;
  }
  return makeBuilder(prim, preds, {
    ...(isInt ? { int: true } : {}),
    ...(allOptional ? { optional: true } : {}),
  });
}

/** partial(c)：shape 全字段变可选；非 shape throw */
export function partial(c: NudoConstraint | ConstraintBuilder): ConstraintBuilder {
  if (!isConstraint(c) || !c.fields)
    throw new Error("nudo partial(): 仅接受 shape(...) 约束");
  const fields: Record<string, NudoField> = {};
  for (const [k, f] of Object.entries(c.fields)) {
    fields[k] = {
      constraint: { ...toPlainConstraint(f.constraint), isOptional: true },
      optional: true,
    };
  }
  return makeBuilder(c.prim, c.preds, { fields });
}

/** pick(c, keys)：shape 子形状（不存在的 key 忽略）；非 shape throw */
export function pick(
  c: NudoConstraint | ConstraintBuilder,
  keys: string[],
): ConstraintBuilder {
  if (!isConstraint(c) || !c.fields)
    throw new Error("nudo pick(): 仅接受 shape(...) 约束");
  const fields: Record<string, NudoField> = {};
  for (const k of keys) {
    const f = c.fields[k];
    if (f) fields[k] = f;
  }
  return makeBuilder(c.prim, c.preds, { fields });
}

/** omit(c, keys)：shape 去字段；非 shape throw */
export function omit(
  c: NudoConstraint | ConstraintBuilder,
  keys: string[],
): ConstraintBuilder {
  if (!isConstraint(c) || !c.fields)
    throw new Error("nudo omit(): 仅接受 shape(...) 约束");
  const drop = new Set(keys);
  const fields: Record<string, NudoField> = {};
  for (const [k, f] of Object.entries(c.fields)) {
    if (!drop.has(k)) fields[k] = f;
  }
  return makeBuilder(c.prim, c.preds, { fields });
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
      return pAnd(...p.args.map((x) => substPred(x, paramName)));
    default:
      return p;
  }
}

/** 把模板绑定到参数名：self → paramName；shape 展开为字段访问 Pred */
export function instantiateConstraint(
  c: NudoConstraint,
  paramName: string,
): Pred {
  // shape：展开为 and(字段 preds)。optional 字段不进硬 pred（缺省可接受）——
  // 与 constraintToEntryAbs 的 slot.optional 对齐，避免缺失可选字段误报。
  if (c.fields) {
    const parts: Pred[] = [];
    for (const [key, field] of Object.entries(c.fields)) {
      if (field.optional || field.constraint.isOptional) continue;
      const fieldTerm = getTerm(termVar(paramName), key);
      parts.push(instantiateOnTerm(field.constraint, fieldTerm));
    }
    if (c.prim) parts.push(ptypeof(termVar(paramName), c.prim));
    if (parts.length === 0) return { op: "true" };
    return parts.length === 1 ? parts[0]! : pAnd(...parts);
  }

  // union：各成员实例化后 or 并（节点自身 preds 一并合取；
  // 与标量链同口径——有实质谓词时节点 prim 不再补 typeof）
  if (c.members) {
    const disj = or(
      ...c.members.map((m) => instantiateOnTerm(m, termVar(paramName))),
    );
    const own = c.preds.map((p) => substPred(p, paramName));
    return own.length === 0 ? disj : pAnd(...own, disj);
  }

  // fn 形态出现在参数位：Phase 1 只展示不执法 → 恒真
  if (c.fn) {
    const own = c.preds.map((p) => substPred(p, paramName));
    return own.length === 0 ? pTrue : pAnd(...own);
  }

  const preds = c.preds.map((p) => substPred(p, paramName));
  // prim 可作为 typeof 约束补上（optional）
  if (c.prim && c.preds.length === 0) {
    return ptypeof(termVar(paramName), c.prim);
  }
  return preds.length === 0 ? { op: "true" } : preds.length === 1 ? preds[0]! : pAnd(...preds);
}

/** 在给定项上实例化约束（shape 字段/union 成员递归用） */
function instantiateOnTerm(c: NudoConstraint, t: Term): Pred {
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
        return pAnd(...p.args.map(subst));
      default:
        return p;
    }
  };
  if (c.fields) {
    const parts: Pred[] = [];
    for (const [key, field] of Object.entries(c.fields)) {
      if (field.optional || field.constraint.isOptional) continue;
      parts.push(instantiateOnTerm(field.constraint, getTerm(t, key)));
    }
    if (parts.length === 0) return { op: "true" };
    return parts.length === 1 ? parts[0]! : pAnd(...parts);
  }
  // union：各成员在该项上实例化后 or 并
  if (c.members) {
    const disj = or(...c.members.map((m) => instantiateOnTerm(m, t)));
    const own = c.preds.map(subst);
    return own.length === 0 ? disj : pAnd(...own, disj);
  }
  // fn 形态：Phase 1 只展示不执法 → 恒真
  if (c.fn) {
    const own = c.preds.map(subst);
    return own.length === 0 ? pTrue : pAnd(...own);
  }
  const preds = c.preds.map(subst);
  if (c.prim && c.preds.length === 0) return ptypeof(t, c.prim);
  return preds.length === 0 ? { op: "true" } : preds.length === 1 ? preds[0]! : pAnd(...preds);
}

/**
 * 契约 → 函数入口 param Abs（infer/hover 用）。
 * 标量：prim + pred；shape：obj slots 递归；union：成员 joinAbs；
 * fn 形态：退化 unknown（不是参数位标量值），逐参约束由 fnConstraintToEntryReqs 消费。
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

/**
 * lit(v) 形态提取：prim + 唯一 eq(self, v)（and 展平一层）。
 * 非字面量形态 → undefined。
 */
function memberLitValue(m: NudoConstraint): number | string | boolean | null | undefined {
  const leaves: Pred[] = [];
  const visit = (p: Pred): void => {
    if (p.op === "and") {
      p.args.forEach(visit);
      return;
    }
    leaves.push(p);
  };
  m.preds.forEach(visit);
  if (leaves.length !== 1) return undefined;
  const p = leaves[0]!;
  if (p.op !== "eq") return undefined;
  if (p.a.op === "var" && p.b.op === "lit") return p.b.value as number | string | boolean | null;
  if (p.b.op === "var" && p.a.op === "lit") return p.a.value as number | string | boolean | null;
  return undefined;
}

/**
 * 全员同 prim 字面量 union → prim + or(eq(self, v)…)。
 * 绕开 joinValues 对同 prim 双字面量的急切塌缩（裸 prim、丢 term/pred），
 * 否则 union(lit(5),lit(7)) 与 union(lit(5),lit(7),lit(-1)) 的 entry Abs
 * 不可区分——drift / leq 漏报。非该形态 → undefined。
 */
function samePrimLiteralUnionAbs(
  members: NudoConstraint[],
  t: Term,
): Abs | undefined {
  if (members.length === 0) return undefined;
  const values: Array<number | string | boolean> = [];
  let prim: PrimName | undefined;
  for (const m of members) {
    const v = memberLitValue(m);
    if (v === undefined) return undefined;
    // lit(null) 无 prim；与有 prim 成员混排不算「同 prim 字面量集」
    if (v === null) return undefined;
    const mp = m.prim ?? (typeof v === "number" ? "number" : typeof v === "string" ? "string" : "boolean");
    if (prim === undefined) prim = mp;
    else if (prim !== mp) return undefined;
    values.push(v);
  }
  if (prim === undefined) return undefined;
  // 去重（union(lit(1), lit(1)) ≡ lit(1)）
  const uniq: Array<number | string | boolean> = [];
  for (const v of values) {
    if (!uniq.some((u) => Object.is(u, v))) uniq.push(v);
  }
  const disj = or(
    ...uniq.map((v) => eq(t, termLit(v))),
  );
  return abs({ k: "prim", type: prim }, t, disj, "path");
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
  // union：成员析取
  if (c.members) {
    // 全员同 prim 字面量 → or(eq…) 保留字面量域（见 samePrimLiteralUnionAbs）
    const litUnion = samePrimLiteralUnionAbs(c.members, t);
    if (litUnion) return litUnion;
    // 混合形态（界 / 跨 prim / shape…）：joinAbs 折叠
    const joined = c.members
      .map((m) => constraintOnTermAbs(m, t))
      .reduce((a, b) => joinAbs(a, b));
    // 同 prim 非字面量成员经 joinValues 塌缩丢 term/pred——重锚定参数项并补
    // typeof，与裸 prim 链（number()/string()）的 entry Abs 同构（drift 双向
    // leq 的锚定对称性）
    if (
      joined.shape.k === "prim" &&
      joined.pred === undefined &&
      c.members.every((m) => m.prim === (joined.shape as { type: unknown }).type)
    ) {
      const type = (joined.shape as { type: PrimName }).type;
      return abs({ k: "prim", type }, t, ptypeof(t, type), "path");
    }
    return joined;
  }
  // fn 形态出现在参数位：无标量 entry 表达，退化 unknown（不 throw——
  // entry@ 生成等入口会把任意约束喂进来；逐参约束由 fnConstraintToEntryReqs 消费）
  if (c.fn) {
    return unknown;
  }
  // array(item) → arr(element)；元素项独立，不继承外层 term
  if (c.element) {
    const elem = constraintOnTermAbs(c.element, termVar("x[]"));
    return abs({ k: "arr", element: elem }, t, undefined, "path");
  }
  const pred = instantiateOnTerm(c, t);
  const predOut = pred.op === "true" ? undefined : pred;
  if (c.prim) {
    return abs({ k: "prim", type: c.prim }, t, predOut, "path");
  }
  // lit(null)：null 无 prim 域（prim 缺失 + eq(self, null)）——unknown 形状
  // 挂 eq 谓词，不落 number 回退（typeof null ≠ "number"，污染 join/leq 锚定）
  const allEqNull =
    c.preds.length > 0 &&
    c.preds.every(
      (p) =>
        p.op === "eq" &&
        ((p.b.op === "lit" && p.b.value === null) ||
          (p.a.op === "lit" && p.a.value === null)),
    );
  if (allEqNull) {
    return abs({ k: "unknown" }, t, predOut, "path");
  }
  // 有界但无 prim：按 number 处理（number().gt(0) 已带 prim）
  if (c.preds.length > 0) {
    return abs({ k: "prim", type: "number" }, t, predOut, "path");
  }
  return abs({ k: "any" }, t, undefined, "path");
}

/**
 * fn 约束 → 逐参约束表（interface 推导 / 入口签名消费）。
 * 非 fn() 形态 throw——调用方应先判 c.fn。
 */
export function fnConstraintToEntryReqs(
  c: NudoConstraint,
): Array<{ param: string; constraint: NudoConstraint }> {
  if (!c.fn) throw new Error("nudo fnConstraintToEntryReqs(): 约束不是 fn() 形态");
  return Object.entries(c.fn.params).map(([param, constraint]) => ({
    param,
    constraint,
  }));
}
