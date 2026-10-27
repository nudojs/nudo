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
 * 命名：litC/andC 与 term.ts 的 lit、pred.ts 的 and 消歧（桶导出不再冲突）。
 * 侧车注入表仍以 `lit`/`and` 为键名（*.nudo.js 用户写法不变）。
 */

import type { Pred, PrimName } from "./pred.ts";
import {
  and as pAnd,
  or,
  eq,
  gt,
  ge,
  lt,
  le,
  primToTypeof,
  ptypeof,
  pTrue,
} from "./pred.ts";
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
  /**
   * 自引用模板 thunk（issue #120）：侧车以真 JS 执行，thunk 闭包引用的
   * const 在 derefConstraint 调用时已初始化——递归结构一句声明。
   * 消费端按 LAZY_TEMPLATE_DEPTH 预算展开；derefConstraint 按 thunk 记忆化。
   */
  readonly lazy?: () => NudoConstraint | ConstraintBuilder;
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

/**
 * 数值界实参守卫（issue #152 脚枪）：`.le("max")` 等变量引用此前静默产出
 * le(self, lit("max")) 字符串字面量 pred（不报错也不参与证明）——显式 throw。
 */
function finiteBoundArg(method: string, n: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) {
    const shown = typeof n === "string" ? JSON.stringify(n) : String(n);
    throw new Error(
      `nudo ${method}(): finite numeric bound expected, got ${shown} — variable references are not supported; express cross-variable lemmas with @nudo:assume (issue #152)`,
    );
  }
  return n;
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
    lazy?: () => NudoConstraint | ConstraintBuilder;
  },
): ConstraintBuilder {
  const fields = extra?.fields;
  const element = extra?.element;
  const isInt = extra?.int;
  const optional = extra?.optional;
  const members = extra?.members;
  const fnSlot = extra?.fn;
  const lazySlot = extra?.lazy;
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
    ...(lazySlot ? { lazy: lazySlot } : {}),
  };
  const add = (p: Pred): ConstraintBuilder =>
    makeBuilder(prim, [...preds, p], extra);
  /**
   * 数值界链（gt / ge / lt / le）只在**数值**链上成立。
   *
   * 此前 `string().gt(1)` / `boolean().gt(1)` 静默产出 `gt(self, 1)` ⇒
   * ① 域面（`domain-membership.ts`）与 Abs 面（`constraintOnTermAbs`）给出
   * **两个裁决**（同 1113 的口径分裂）；② 该约束**恒假**（字符串 / 布尔不可能
   * `> 1`）⇒ 每个合法实参都被判违例 = **假红**。
   *
   * ⇒ 与 `shift()` 同口径拒绝（非数值链 / 结构链上直接报错），不再静默产出
   * 恒假契约。
   */
  const numericBound = (method: string, n: number): number => {
    if (fields || element || members || fnSlot || lazySlot)
      throw new Error(
        `nudo ${method}(): only numeric scalar constraint chains are allowed (shape/array/union/fn are not supported)`,
      );
    if (prim !== undefined && prim !== "number")
      throw new Error(`nudo ${method}(): only numeric chains are allowed (prim=${prim})`);
    return finiteBoundArg(method, n);
  };
  /**
   * 长度界链（min / max / length）只在**有长度语义**的链上成立：`string()` 与
   * `array(...)`（+ 无 prim 的开放链 `any()`）。
   *
   * BUG-211：此前 `number().min(1)` 静默产出 `ge(length(self), 1)` ⇒
   * ① 该约束对数字**恒假**（`data.length` 是 undefined）⇒ 发布的 guard 产物拒绝
   * **全部**合法输出；② 同一约束在两个执法通道给出**相反**结论（参数位把
   * `length(x)` 当普通数值比较 ⇒ 假绿；返回位按长度语义 ⇒ 假红）。
   * ⇒ 与 `gt/ge/lt/le`、`.int()` 同口径：不可能满足的链在**构造期**拒绝。
   *
   * 允许的形态：`prim === "string"`（长度界的主体）、无 prim 的 `array(...)`
   * （`element` 在场，Bug 922 的数组自身长度界）与 `any()`；`shape` / `union` /
   * `fn` 是结构型，长度界无意义 ⇒ 与数值界同口径拒绝。
   */
  const lengthChain = (method: string): void => {
    if (fields || members || fnSlot || lazySlot)
      throw new Error(
        `nudo ${method}(): only string / array length chains are allowed (shape/union/fn are not supported)`,
      );
    if (prim !== undefined && prim !== "string")
      throw new Error(
        `nudo ${method}(): only string / array length chains are allowed (prim=${prim})`,
      );
  };
  /**
   * 长度界链（min / max / length）的界必须**非负**。
   *
   * 此前 `string().length(-3)` 产出 `len(self) === -3` ⇒ **恒假** ⇒ 每个合法
   * 字符串都被判违例 = 假红；`max(-3)` 同理。⇒ 负界直接报错。
   *
   * 注：非整数界（如 `length(2.5)`）**保持现状**（既有门禁 Bug 336 明确钉住
   * 「2.5 合法」⇒ 只护栏 NaN / Infinity，不加严）。
   */
  const lengthBound = (method: string, n: number): number => {
    // 实参形态守卫先行（issue #152 的既有口径：**非有限数值实参**的提示优先——
    // `number().min(Infinity)` 先报「finite numeric bound」，与既有门禁一致）
    const bound = finiteBoundArg(method, n);
    // 再判链的 prim 语义（BUG-211：数值 / 布尔链上不可能有长度语义）
    lengthChain(method);
    if (bound < 0)
      throw new Error(
        `nudo ${method}(): length bound must be a non-negative integer, got ${bound}`,
      );
    return bound;
  };
  // base 先赋、方法后赋：所有链式方法（含 .int() 的重复幂等调用）恒可用；
  // int 数据可见性由 isIntFlag 统一读取（域判定 / 显示 / 归一化）。
  const builder = Object.assign(
    Object.create(null),
    base,
    {
      gt: (n: number) => add(gt(selfTerm(), termLit(numericBound("gt", n)))),
      ge: (n: number) => add(ge(selfTerm(), termLit(numericBound("ge", n)))),
      lt: (n: number) => add(lt(selfTerm(), termLit(numericBound("lt", n)))),
      le: (n: number) => add(le(selfTerm(), termLit(numericBound("le", n)))),
      int: () => {
        // `.int()` 只在**数值**链上成立（Bug 1113）：此前 int 标志对**所有** builder
        // 暴露 ⇒ `string().int()` 造出「域面忽略 / Abs 面生成 `x % 1 === 0`」的
        // **同一约束两个裁决**（口径分裂）。此处与 `shift()` 同口径拒绝 ⇒ 非数值链
        // 上 `.int()` 直接报错，不再静默产出互相矛盾的契约。
        if (fields || element || members || fnSlot || lazySlot)
          throw new Error(
            "nudo int(): only numeric scalar constraint chains are allowed (shape/array/union/fn are not supported)",
          );
        if (prim !== undefined && prim !== "number")
          throw new Error(`nudo int(): only numeric chains are allowed (prim=${prim})`);
        return makeBuilder(prim ?? "number", preds, { ...extra, int: true });
      },
      min: (n: number) => add(ge(lenTerm(selfTerm()), termLit(lengthBound("min", n)))),
      max: (n: number) => add(le(lenTerm(selfTerm()), termLit(lengthBound("max", n)))),
      length: (n: number) => {
        // 有限数值界护栏（Bug 336 / 341）：与 gt/ge/lt/le/min/max 同源。
        // 缺护栏时 length(NaN) 造出恒假契约（每个合法字符串都判违规 = 假红），
        // length("3") 这类笔误把整条契约静默废掉（门禁零诊断 = 假绿）。
        const bound = lengthBound("length", n);
        return add(
          pAnd(
            ge(lenTerm(selfTerm()), termLit(bound)),
            le(lenTerm(selfTerm()), termLit(bound)),
          ),
        );
      },
      shift: (n: number) => {
        finiteBoundArg("shift", n);
        if (fields || element || members || fnSlot || lazySlot)
          throw new Error("nudo shift(): only numeric scalar constraint chains are allowed (shape/array/union/fn are not supported)");
        if (prim !== undefined && prim !== "number")
          throw new Error(`nudo shift(): only numeric chains are allowed (prim=${prim})`);
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
      throw new Error(`nudo shift(): predicate ${p.op} is not supported (only gt/ge/lt/le constant bounds)`);
    const { a, b } = p;
    if (b.op !== "lit" || typeof b.value !== "number")
      throw new Error("nudo shift(): the right-hand side of a constant bound must be a numeric literal");
    if (termHasApp(a, "length") || termHasApp(b, "length"))
      throw new Error("nudo shift(): length(...) bounds are not supported");
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

/**
 * array(item) —— 数组，元素满足 item；item 亦可为具体字面量（指令文法）。
 *
 * 元素约束**必填**（Bug 354）：少传元素时旧实现把 `undefined` 交给
 * asNestedConstraint ⇒ 静默变成 `lit(undefined)` ⇒ 契约变成「元素必须是
 * undefined」⇒ 任何合法数组实参都被判违反（假红），且零诊断说明缺参。
 * 「元素可为 undefined」有显式写法：`array(lit(undefined))`。
 */
export function array(
  item: NudoConstraint | ConstraintBuilder | number | string | boolean | null | undefined,
  ...rest: unknown[]
): ConstraintBuilder {
  if (item === undefined)
    throw new Error(
      "nudo array(): an element constraint is required (e.g. array(number())); write array(lit(undefined)) to allow undefined elements",
    );
  // 多余实参此前被**静默丢弃**（`array(1, 2)` ⇒ 只认第一个）⇒ 用户的第二个
  // 元素约束从未生效（契约被悄悄削弱 = 假绿）⇒ 显式报错。
  if (rest.length > 0)
    throw new Error(
      `nudo array(): takes exactly one element constraint, got ${rest.length + 1} argument(s)`,
    );
  return makeBuilder(undefined, [], {
    element: asNestedConstraint(item, "array(item)"),
  });
}

/**
 * object 形状约束（契约规范形状，无需 interface）：
 *
 *   shape({ id: number().gt(0), name: string() })
 *
 * 字段值亦可为具体字面量（指令文法）。
 *
 * 实参守卫（Bug 352 / 353）：缺参 ⇒ 点名构造器 + 说明缺参；非对象 ⇒ 点名
 * 构造器 + 实际类型。旧实现把实参直接交给 `Object.entries`：`shape(42)` ⇒
 * `[]` ⇒ 整条参数契约退化成空 shape（域放宽到任意对象 = 假绿）；`shape()`
 * ⇒ 宿主 TypeError「Cannot convert undefined or null to object」原文进诊断。
 */
export function shape(
  fields: Record<
    string,
    NudoConstraint | ConstraintBuilder | number | string | boolean | null | undefined
  >,
): ConstraintBuilder {
  const source = requireFieldsObject("shape", fields);
  // 无原型字段表（Bug 1027）：普通对象上 `mapped["__proto__"] = …` 触发
  // Object.prototype.__proto__ 的 setter ⇒ 字段被写成原型而非自有键 ⇒
  // 契约被静默削弱成空 shape（门禁假绿 + 契约面 / dts / zod 三面丢字段）。
  const mapped: Record<string, NudoField> = Object.create(null);
  for (const [k, v] of Object.entries(source)) {
    const constraint = asNestedConstraint(v, `shape 字段 '${k}'`);
    mapped[k] = {
      constraint,
      ...(constraint.isOptional ? { optional: true } : {}),
    };
  }
  assertFieldTableIntact("shape", Object.keys(source).length, mapped);
  return makeBuilder(undefined, [], { fields: mapped });
}

/**
 * 对象型构造器实参守卫（Bug 352 / 353）——**切片① 的共用校验**，
 * S2 切片的 `fn()` 实参守卫可直接复用（本函数在同文件内可见）。
 *
 * 缺参 ⇒ 点名构造器 + 说明缺参；非对象 ⇒ 点名构造器 + 实际类型。
 * 宿主的 "Cannot convert undefined or null to object" 原文不进产品诊断。
 */
function requireFieldsObject(ctor: string, arg: unknown): Record<string, unknown> {
  if (arg === undefined)
    throw new Error(
      `nudo ${ctor}(): a fields object is required (e.g. ${ctor}({ id: number() }))`,
    );
  if (arg === null || typeof arg !== "object" || Array.isArray(arg))
    throw new Error(
      `nudo ${ctor}(): the fields argument must be an object of field constraints, got ${describeValue(arg)}`,
    );
  return arg as Record<string, unknown>;
}

/**
 * 字段表装配完整性断言（Bug 1027）：装配后自有键数必须等于**应有**键数。
 * 键数不符 ⇒ 某个字段名被原型访问器吞掉（写侧回退成普通对象的症状）
 * ⇒ **明确报错**，而不是静默降级成一个更宽的契约。
 */
function assertFieldTableIntact(
  who: string,
  expected: number,
  table: Record<string, NudoField>,
): void {
  const got = Object.keys(table).length;
  if (got !== expected)
    throw new Error(
      `nudo ${who}(): the field table lost ${expected - got} field(s) while being assembled — a field name collided with a prototype accessor`,
    );
}

/** 归一化为纯数据约束（剥掉 builder 方法——成员快照不可再链式改写） */
function toPlainConstraint(c: NudoConstraint): NudoConstraint {
  if (!isConstraint(c))
    throw new Error("nudo: expected a constraint value (number()/string()/… or a combinator)");
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
    ...(c.lazy ? { lazy: c.lazy } : {}),
  };
}

/** litC(v)：字面量契约——prim 按 v 类型、eq(self, v) pred 编码（不开新字段） */
export function litC(v: import("./term.ts").LiteralValue): ConstraintBuilder {
  const prim: PrimName | undefined =
    typeof v === "number" ? "number"
    : typeof v === "string" ? "string"
    : typeof v === "boolean" ? "boolean"
    // Bug 1046：bigint 字面量此前**不给 prim** ⇒ `constraintOnTermAbs` 落到
    // 「有界但无 prim ⇒ 按 number 处理」的兜底 ⇒ Abs 的 shape 说 number、
    // pred 说 bigint ⇒ guard 面渲染 `typeof data === "number" && data === 1n`
    // ⇒ **假红**（拒收契约申报的唯一合法值）。
    : typeof v === "bigint" ? "bigint"
    : undefined;
  return makeBuilder(prim, [eq(selfTerm(), termLit(v))]);
}

/**
 * union/array/shape/fn 嵌套位接受：约束构建器，或指令文法的具体字面量
 * （5 / "hi" / true / null / undefined）。字面量归一为 litC(v) 约束。
 */
function asNestedConstraint(x: unknown, ctx: string): NudoConstraint {
  if (isConstraint(x)) return toPlainConstraint(x);
  if (
    x === null ||
    x === undefined ||
    typeof x === "number" ||
    typeof x === "string" ||
    typeof x === "boolean"
  ) {
    return toPlainConstraint(litC(x));
  }
  throw new Error(
    `nudo: ${ctx} expects a constraint value (number()/string()/…) or a concrete literal; received a non-constraint`,
  );
}

/** union(...cs)：成员析取；instantiate 为 or(...)，entry Abs 为成员 joinAbs。空参 throw */
export function union(
  ...cs: (NudoConstraint | ConstraintBuilder | number | string | boolean | null | undefined)[]
): ConstraintBuilder {
  if (cs.length === 0)
    throw new Error("nudo union(): at least one member constraint is required");
  return makeBuilder(undefined, [], {
    members: cs.map((c) => asNestedConstraint(c, "union member")),
  });
}

/**
 * nullable(c)：允许 null / undefined 的约束（nullish 显式化）。
 * 糖 = union(c, lit(null), lit(undefined))。
 * `return null` / `return undefined` 只对含 nullish 的契约合法；
 * 对不含 nullish 的契约（如 number().gt(0)）报 constraint-violated。
 */
export function nullable(
  c: NudoConstraint | ConstraintBuilder | number | string | boolean,
): ConstraintBuilder {
  return makeBuilder(undefined, [], {
    members: [
      asNestedConstraint(c, "nullable()"),
      toPlainConstraint(litC(null)),
      toPlainConstraint(litC(undefined)),
    ],
  });
}

/**
 * lazy(() => constraint)：自引用约束模板（issue #120）。
 * 侧车以真 JS 执行——thunk 闭包里引用的 const 在 derefConstraint 调用时
 * 已初始化，递归结构一句声明：
 *
 *   export const astNode = shape({
 *     type: string(),
 *     object: lazy(() => astNode).optional(),
 *   });
 *
 * 消费端（instantiate / entry Abs / 显示）按 LAZY_TEMPLATE_DEPTH 预算展开，
 * 预算耗尽的字段位渲染为「缺席槽」——与手写有限层模板同语义，
 * 守卫递归（`if (node.object == null) …`）在边界处干净剪枝。
 */
export function lazy(
  thunk: () => NudoConstraint | ConstraintBuilder,
): ConstraintBuilder {
  if (typeof thunk !== "function")
    throw new Error("nudo lazy(): expects a thunk function () => constraint");
  return makeBuilder(undefined, [], { lazy: thunk });
}

/**
 * lazy 模板展开预算（issue #120）：递归层数上限。导出仅供测试钉住语义，
 * 不经公共入口再导出。
 */
export const LAZY_TEMPLATE_DEPTH = 3;

/** derefConstraint 按 thunk 记忆化——同一闭包反复展开得到同一对象身份（leq/缓存稳定） */
const lazyDerefMemo = new WeakMap<object, NudoConstraint>();

/**
 * 解一层 lazy：调用 thunk 一次、校验产物是约束、toPlainConstraint 归一化，
 * 并按 thunk 记忆化（重复 deref 同一闭包 → 同一对象）。
 * 不递归展开——递归层数由消费端的 depth 预算控制。
 */
export function derefConstraint(c: NudoConstraint): NudoConstraint {
  const thunk = c.lazy;
  if (!thunk) return c;
  const memoized = lazyDerefMemo.get(thunk);
  if (memoized) return memoized;
  const out = thunk();
  if (!isConstraint(out))
    throw new Error(
      "nudo lazy(): the thunk must return a constraint (number()/string()/shape()/…)",
    );
  const normalized = toPlainConstraint(out);
  lazyDerefMemo.set(thunk, normalized);
  return normalized;
}

/**
 * 契约域是否包含 nullish（null / undefined）。
 * union 任一成员含 nullish 即含；lit(null)/lit(undefined) 的 eq 谓词识别。
 * lazy 包装先 deref；环经 seen（thunk 身份）终止——nullish 只出现在
 * 有限位置，DFS-with-seen 判定可靠，无需层数预算。
 */
export function constraintAdmitsNullish(
  c: NudoConstraint,
  seen?: Set<object>,
): boolean {
  // lazy 包装必须在 any()-形判定之前 deref：lazy 包装自身无 prim/preds/结构，
  // 会被误判成 any()（接受一切）——对 lazy(() => shape(...)) 是假阳性。
  if (c.lazy) {
    const s = seen ?? new Set<object>();
    if (s.has(c.lazy)) return false;
    s.add(c.lazy);
    return constraintAdmitsNullish(derefConstraint(c), s);
  }
  // Bug 088：`.optional()` 位**可为 undefined**（可缺省）⇒ 契约域含 nullish。
  // 此前整条丢失 ⇒ 返回位把 `return undefined`（契约**明确允许**）判成违约
  // （假红），且修复建议把用户引向 `nullable(number().optional())` 绕过
  // ——因为引擎**没读懂** `.optional()`。
  if (c.isOptional) return true;
  if (c.members)
    return c.members.some((m) => constraintAdmitsNullish(m, seen));
  // any()（无 prim、无 preds、无 shape）接受一切含 nullish
  if (!c.prim && c.preds.length === 0 && !c.fields && !c.element && !c.fn) return true;
  // eq(self, null) / eq(self, undefined) 谓词
  for (const p of c.preds) {
    for (const flat of p.op === "and" ? p.args : [p]) {
      if (flat.op !== "eq") continue;
      for (const side of [flat.a, flat.b] as const) {
        if (side.op === "lit" && (side.value === null || side.value === undefined)) return true;
      }
    }
  }
  return false;
}

/**
 * fn(params, returns?, { throws? })：一等函数约束。
 * Phase 1 只展示不执法：参数位 instantiate 恒真（pTrue），
 * 逐参约束经 fnConstraintToEntryReqs 消费。
 *
 * 第三实参（opts）做**形态校验**（Bug 357）：
 * - opts 必须是对象 —— 否则整条 throws 申报被静默丢弃（零诊断假红）；
 * - opts.throws 归一后必须能抽出至少一个错误名（throwConstraintToKinds 非
 *   undefined）—— 否则 throws 义务无声消失，用户已申报却仍报 may-throw。
 */
export function fn(
  params: Record<string, NudoConstraint | ConstraintBuilder | number | string | boolean | null | undefined>,
  returns?: NudoConstraint | ConstraintBuilder | number | string | boolean | null | undefined,
  opts?: { throws?: NudoConstraint | ConstraintBuilder | number | string | boolean | null | undefined },
): ConstraintBuilder {
  // 字段表实参守卫（Bug 352 / 353 同源，Bug 1112）：缺参 / 非对象 ⇒ 点名构造器 +
  // 说明缺参，**不把宿主原文**（"Cannot convert undefined or null to object"）
  // 泄进产品诊断；`fn(42)` 也不再静默变成 `fn({})`（契约被悄悄削弱 = 假绿）。
  const fields = requireFieldsObject("fn", params);
  const normalized: Record<string, NudoConstraint> = {};
  for (const [k, v] of Object.entries(fields)) {
    normalized[k] = asNestedConstraint(v, `fn param '${k}'`);
  }
  let throwsSlot: NudoConstraint | undefined;
  if (opts !== undefined) {
    if (typeof opts !== "object" || opts === null || Array.isArray(opts)) {
      throw new Error(
        `nudo fn(): the third argument must be an options object ({ throws: … }), got ${describeValue(opts)}`,
      );
    }
    if (opts.throws !== undefined) {
      const declared = asNestedConstraint(opts.throws, "fn throws");
      if (throwConstraintToKinds(declared) === undefined) {
        throw new Error(
          'nudo fn(): the throws declaration does not name an error kind — use lit("TypeError"), "TypeError", or a union of them (a numeric / nullish literal carries no error name)',
        );
      }
      throwsSlot = declared;
    }
  }
  return makeBuilder(undefined, [], {
    fn: {
      params: normalized,
      ...(returns !== undefined
        ? { returns: asNestedConstraint(returns, "fn return value") }
        : {}),
      ...(throwsSlot !== undefined ? { throws: throwsSlot } : {}),
    },
  });
}

/**
 * andC(...cs)：标量合取（Phase 1 最小实现）。
 * prim 一致（缺省 prim 视为无 prim 约束、可与任意 prim 合并）→ preds 拼接；
 * prim 不一致或任一含 fields/element/members/fn → throw。
 */
export function andC(
  ...cs: (NudoConstraint | ConstraintBuilder)[]
): ConstraintBuilder {
  if (cs.length === 0)
    throw new Error("nudo and(): at least one constraint is required");
  let prim: PrimName | undefined;
  let isInt = false;
  let allOptional = true;
  const preds: Pred[] = [];
  for (const c0 of cs) {
    if (!isConstraint(c0))
      throw new Error("nudo: expected a constraint value (number()/string()/… or a combinator)");
    // lazy 包装先解一层：lazy(() => shape(...)) 与直接 shape 同样 throw，
    // 不因包装静默并入 preds（issue #120）
    const c = derefConstraint(c0);
    if (c.fields || c.element || c.members || c.fn)
      throw new Error("nudo and(): Phase 1 supports scalar constraint conjunction only (shape/array/union/fn are not supported)");
    if (c.prim) {
      if (prim !== undefined && prim !== c.prim)
        throw new Error(`nudo and(): inconsistent prim (${prim} vs ${c.prim})`);
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

/**
 * partial(c)：shape 全字段变可选；非 shape throw（lazy 包装先解一层）。
 *
 * 写侧用**无原型字段表**（Bug 1027）：partial 是「读旧表 ⇒ 写新表」，
 * 若新表是普通对象，字段名 `__proto__` 会被原型 setter 吞掉 ⇒ 经 partial
 * 转一道仍二次吞键 ⇒ 契约被削弱成空 shape。
 */
export function partial(c: NudoConstraint | ConstraintBuilder): ConstraintBuilder {
  if (!isConstraint(c))
    throw new Error("nudo partial(): only shape(...) constraints are accepted");
  const d = derefConstraint(c);
  if (!d.fields)
    throw new Error("nudo partial(): only shape(...) constraints are accepted");
  const fields: Record<string, NudoField> = Object.create(null);
  for (const [k, f] of Object.entries(d.fields)) {
    fields[k] = {
      constraint: { ...toPlainConstraint(f.constraint), isOptional: true },
      optional: true,
    };
  }
  assertFieldTableIntact("partial", Object.keys(d.fields).length, fields);
  // Bug 209：partial 是**纯结构变换**（字段全可选）⇒ **被包进去的那个 shape
  // 自身的可选性必须保留**（此前只搬 fields ⇒ `d.isOptional` 被丢弃 ⇒
  // `shape({ s: partial(shape({…}).optional()) })` 的 `s` 变必填 ⇒ 契约被
  // 静默收紧 ⇒ 合法调用被判违约（假红）+ 签名 / dts 少一个 `?`）。
  return makeBuilder(d.prim, d.preds, {
    fields,
    ...(d.isOptional ? { optional: true } : {}),
  });
}

/** 值的可读描述（DSL 诊断用；不外泄宿主原文） */
function describeValue(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) return `an array (${v.length} item(s))`;
  return typeof v;
}

/**
 * keys 实参形态校验（Bug 358）：必须是**字符串数组**。
 * 字符串可迭代 ⇒ `for...of` / `new Set(keys)` 会把它当字符列表逐字迭代：
 * pick 把契约**放松成空**（假绿），omit 让约束**变严**（假红），两向都错且零诊断。
 * 这里显式 throw，给出 Nudo 原生诊断（不是宿主的 "is not iterable" TypeError）。
 */
function assertKeysArray(who: string, keys: unknown): string[] {
  if (!Array.isArray(keys)) {
    throw new Error(
      `nudo ${who}(): keys must be an array of strings, got ${describeValue(keys)} (a bare string is iterated character by character)`,
    );
  }
  for (const k of keys) {
    if (typeof k !== "string") {
      throw new Error(
        `nudo ${who}(): keys must be an array of strings, got ${describeValue(k)} inside the array`,
      );
    }
  }
  return keys as string[];
}

/**
 * pick(c, keys)：shape 子形状（不存在的 key 忽略）；非 shape throw（lazy 包装先解一层）。
 *
 * 字段读取用**自有属性**判定（Bug 347）：`d.fields[k]` 沿原型链读，
 * "constructor" / "toString" 会命中 Object.prototype 成员并被当成字段塞进
 * 新字段表 ⇒ 后续读 `f.constraint` 拿到 undefined ⇒ contract / export 面裸崩、
 * check 面静默作废整条契约。
 */
export function pick(
  c: NudoConstraint | ConstraintBuilder,
  keys: string[],
): ConstraintBuilder {
  if (!isConstraint(c))
    throw new Error("nudo pick(): only shape(...) constraints are accepted");
  const d = derefConstraint(c);
  if (!d.fields)
    throw new Error("nudo pick(): only shape(...) constraints are accepted");
  const wanted = assertKeysArray("pick", keys);
  // 无原型字段表（Bug 1027）：pick 是「读旧表 ⇒ 写新表」，新表若是普通
  // 对象，字段名 `__proto__` 会被原型 setter 吞掉 ⇒ 契约被削弱成空 shape。
  const fields: Record<string, NudoField> = Object.create(null);
  let kept = 0;
  for (const k of wanted) {
    if (!Object.hasOwn(d.fields, k)) continue;
    const f = d.fields[k];
    if (!f) continue;
    fields[k] = f;
    kept++;
  }
  assertFieldTableIntact("pick", kept, fields);
  // Bug 209：pick 是**纯结构变换**（选子集）⇒ 被包进去的 shape 自身的
  // 可选性必须保留（此前只搬 fields ⇒ `d.isOptional` 被丢弃 ⇒ 契约被静默
  // 收紧 ⇒ 合法调用被判违约（假红）+ 签名 / dts 少一个 `?`）。
  return makeBuilder(d.prim, d.preds, {
    fields,
    ...(d.isOptional ? { optional: true } : {}),
  });
}

/**
 * omit(c, keys)：shape 去字段；非 shape throw（lazy 包装先解一层）。
 *
 * 写侧用**无原型字段表**（Bug 1027）：omit 是「读旧表 ⇒ 写新表」，
 * 若新表是普通对象，字段名 `__proto__` 会被原型 setter 吞掉 ⇒ 经 omit
 * 转一道仍二次吞键 ⇒ 契约被削弱成空 shape。
 */
export function omit(
  c: NudoConstraint | ConstraintBuilder,
  keys: string[],
): ConstraintBuilder {
  if (!isConstraint(c))
    throw new Error("nudo omit(): only shape(...) constraints are accepted");
  const d = derefConstraint(c);
  if (!d.fields)
    throw new Error("nudo omit(): only shape(...) constraints are accepted");
  const drop = new Set(assertKeysArray("omit", keys));
  const fields: Record<string, NudoField> = Object.create(null);
  let kept = 0;
  for (const [k, f] of Object.entries(d.fields)) {
    if (drop.has(k)) continue;
    fields[k] = f;
    kept++;
  }
  assertFieldTableIntact("omit", kept, fields);
  // Bug 209：omit 是**纯结构变换**（删字段）⇒ 被包进去的 shape 自身的
  // 可选性必须保留（此前只搬 fields ⇒ `d.isOptional` 被丢弃 ⇒ 契约被静默
  // 收紧 ⇒ 合法调用被判违约（假红）+ 签名 / dts 少一个 `?`）。
  return makeBuilder(d.prim, d.preds, {
    fields,
    ...(d.isOptional ? { optional: true } : {}),
  });
}

/**
 * 约束构建器表面名表（单一真源）：case 实参文法、mock 类型表达式识别与
 * 侧车注入共用的名字 → 实现映射。键名是 *.nudo.js / 指令里的用户写法
 * （`lit`/`and` 而非内部的 litC/andC）。
 *
 * 任何「构建器名单」硬编码（CONSTRAINT_EXPR_RE 一类的识别正则）必须由
 * `CONSTRAINT_BUILDER_NAMES` 生成，禁止再手维护一份。
 */
export const CONSTRAINT_BUILDERS: Record<string, unknown> = {
  number,
  string,
  boolean,
  any,
  array,
  shape,
  lit: litC,
  union,
  nullable,
  lazy,
  fn,
  and: andC,
  partial,
  pick,
  omit,
};

/** 构建器表面名（供文法正则 / 测试枚举；顺序即表定义顺序） */
export const CONSTRAINT_BUILDER_NAMES: readonly string[] = Object.keys(
  CONSTRAINT_BUILDERS,
);

/**
 * 约束表达式头：`name(` 形态。由 CONSTRAINT_BUILDER_NAMES 生成——
 * 名单只在 CONSTRAINT_BUILDERS 一处维护。
 *
 * 注意：这只是**前缀预筛**（快速判定「像不像构建器调用」），不是安全门禁。
 * 整条表达式在进入 execNudoModule/new Function 前必须过 AST 白名单
 * （parser 的 isSafeTypeExprSource）——否则 `number(), process.exit(1)`
 * 这类拼接可以借前缀骗过本正则并执行任意 JS。
 */
export const CONSTRAINT_EXPR_RE: RegExp = new RegExp(
  `^(${CONSTRAINT_BUILDER_NAMES.join("|")})\\s*\\(`,
);

/**
 * 把模板项里的 SELF 占位符递归换成目标项（Bug 337）。
 *
 * 旧实现只认 `var SELF` 与 `app("get", …)` 两种形态，`app("length", [SELF])`
 * 这类**应用项的实参**不递归 ⇒ `__nudo_self__` 原样进入实例化谓词与产品
 * `expected` 文本（内部占位符泄漏进用户可见输出）。
 */
function substSelf(t: Term, target: Term): Term {
  if (t.op === "var" && t.id === SELF) return target;
  if (t.op === "app") {
    if (t.fn === "get" && t.args.length === 2) {
      return getTerm(
        substSelf(t.args[0]!, target),
        String(t.args[1]!.op === "lit" ? t.args[1]!.value : ""),
      );
    }
    if (t.args.length === 0) return t;
    return termApp(t.fn, t.args.map((a) => substSelf(a, target)));
  }
  return t;
}

/** 把模板项里的 SELF 占位符换成参数名项 */
function substTerm(t: Term, paramName: string): Term {
  return substSelf(t, termVar(paramName));
}

/**
 * 谓词里的 SELF 占位符替换（递归进 and / or / not 分支）。
 * or / not 分支此前整体跳过 ⇒ union 契约实例化时分支里的 SELF 同样泄漏。
 */
function substPredOn(p: Pred, target: Term): Pred {
  switch (p.op) {
    case "gt":
    case "ge":
    case "lt":
    case "le":
    case "eq":
    case "ne": {
      return {
        op: p.op,
        a: substSelf(p.a, target),
        b: substSelf(p.b, target),
      };
    }
    case "typeof": {
      return { op: "typeof", t: substSelf(p.t, target), type: p.type };
    }
    case "and":
      return pAnd(...p.args.map((x) => substPredOn(x, target)));
    case "or":
      return { op: "or", args: p.args.map((x) => substPredOn(x, target)) };
    case "not":
      return { op: "not", arg: substPredOn(p.arg, target) };
    default:
      return p;
  }
}

function substPred(p: Pred, paramName: string): Pred {
  return substPredOn(p, termVar(paramName));
}

/**
 * Bug 088：`.optional()` 位的**可缺省 / 可为 undefined** 语义折进实例化谓词。
 *
 * 顶层标量位的 `.optional()`（`number().optional()`）此前在实例化时**整条丢失**
 * ⇒ 调用点前置条件只剩 `typeof x = "number"` ⇒ 契约**明确允许**的 `undefined`
 * 实参被判违约（**假红**，直接卡 CI）。
 *
 * 编码口径 = `union(lit(undefined), <base>)` 的同款析取（另一条等价写法，
 * 实测正常）⇒ 两种写法结论一致。
 *
 * ⚠ `base` 恒真（`any()` 之类无义务的约束）时**不**加析取支——无义务的契约
 * 本就接受一切（含 undefined）。
 */
function optionalizePred(base: Pred, paramName: string): Pred {
  if (base.op === "true") return base;
  return or(base, eq(termVar(paramName), termLit(undefined)));
}

/** 把模板绑定到参数名：self → paramName；shape 展开为字段访问 Pred（lazy 按 depth 预算展开） */
export function instantiateConstraint(
  c: NudoConstraint,
  paramName: string,
  depth: number = LAZY_TEMPLATE_DEPTH,
): Pred {
  // lazy（issue #120）：预算内解一层递归；预算耗尽 → 恒真（宽松——
  // optional 字段本就不进硬 pred，必选 lazy 字段截断处不误报）
  if (c.lazy) {
    if (depth <= 0) return pTrue;
    return instantiateConstraint(derefConstraint(c), paramName, depth - 1);
  }
  // shape：展开为 and(字段 preds)。optional 字段不进硬 pred（缺省可接受）——
  // 与 constraintToEntryAbs 的 slot.optional 对齐，避免缺失可选字段误报。
  if (c.fields) {
    const parts: Pred[] = [];
    for (const [key, field] of Object.entries(c.fields)) {
      if (field.optional || field.constraint.isOptional) continue;
      const fieldTerm = getTerm(termVar(paramName), key);
      parts.push(instantiateOnTerm(field.constraint, fieldTerm, depth));
    }
    if (c.prim) parts.push(ptypeof(termVar(paramName), primToTypeof(c.prim)));
    if (parts.length === 0) return { op: "true" };
    return parts.length === 1 ? parts[0]! : pAnd(...parts);
  }

  // union：各成员实例化后 or 并（节点自身 preds 一并合取；
  // 与标量链同口径——有实质谓词时节点 prim 不再补 typeof）
  if (c.members) {
    const disj = or(
      ...c.members.map((m) => instantiateOnTerm(m, termVar(paramName), depth)),
    );
    const own = c.preds.map((p) => substPred(p, paramName));
    const base = own.length === 0 ? disj : pAnd(...own, disj);
    // Bug 088：union 自身 `.optional()` ⇒ 整个位可为 undefined
    return c.isOptional ? optionalizePred(base, paramName) : base;
  }

  // fn 形态出现在参数位：Phase 1 只展示不执法 → 恒真
  if (c.fn) {
    const own = c.preds.map((p) => substPred(p, paramName));
    return own.length === 0 ? pTrue : pAnd(...own);
  }

  const preds = c.preds.map((p) => substPred(p, paramName));
  // prim 的类型义务与界**合取**（Bug 333/335）：旧口径是「有 preds 就不补
  // typeof」——「prim + 界」契约（number().gt(0) / string().max(3)）实例化后
  // 只剩界，类型义务整条丢失 ⇒ 类型错配的实参被静默放行（假绿），
  // 且报错时给出误导性 expected（把数字当长度比）。
  if (c.prim) {
    const typePred = ptypeof(termVar(paramName), primToTypeof(c.prim));
    const base = preds.length === 0 ? typePred : pAnd(typePred, ...preds);
    // Bug 088：顶层标量位 `.optional()` ⇒ 该位可为 undefined（可缺省）
    return c.isOptional ? optionalizePred(base, paramName) : base;
  }
  const tail: Pred =
    preds.length === 0 ? pTrue : preds.length === 1 ? preds[0]! : pAnd(...preds);
  // Bug 088：无 prim 的标量位（`lit(null)` 等）`.optional()` ⇒ 同样可为 undefined
  return c.isOptional ? optionalizePred(tail, paramName) : tail;
}

/** 在给定项上实例化约束（shape 字段/union 成员递归用；assertImplies 统一证明通道；lazy 按 depth 预算展开） */
export function instantiateOnTerm(
  c: NudoConstraint,
  t: Term,
  depth: number = LAZY_TEMPLATE_DEPTH,
): Pred {
  // lazy（issue #120）：预算内解一层；预算耗尽 → 恒真
  if (c.lazy) {
    if (depth <= 0) return pTrue;
    return instantiateOnTerm(derefConstraint(c), t, depth - 1);
  }
  // SELF 占位符替换（递归进 app 实参 / or / not 分支——同 instantiateConstraint）
  const subst = (p: Pred): Pred => substPredOn(p, t);
  if (c.fields) {
    const parts: Pred[] = [];
    for (const [key, field] of Object.entries(c.fields)) {
      if (field.optional || field.constraint.isOptional) continue;
      parts.push(instantiateOnTerm(field.constraint, getTerm(t, key), depth));
    }
    if (parts.length === 0) return { op: "true" };
    return parts.length === 1 ? parts[0]! : pAnd(...parts);
  }
  // union：各成员在该项上实例化后 or 并
  if (c.members) {
    const disj = or(...c.members.map((m) => instantiateOnTerm(m, t, depth)));
    const own = c.preds.map(subst);
    return own.length === 0 ? disj : pAnd(...own, disj);
  }
  // fn 形态：Phase 1 只展示不执法 → 恒真
  if (c.fn) {
    const own = c.preds.map(subst);
    return own.length === 0 ? pTrue : pAnd(...own);
  }
  const preds = c.preds.map(subst);
  // prim 的类型义务：只在**无其它谓词**时补 typeof（与改前口径一致）。
  // 这里**不能**改成「有 preds 也补 typeof」：
  // - union 成员的实例化走本函数，补了 typeof 会把成员谓词变成 "and"，
  //   执法侧 or 分支的 judgeLiteralPred 遇 "and" 返回 unknown ⇒ 整条 union
  //   约束被跳过 ⇒ 假绿（union(lit(1), lit(2)) 的 f(5) 违例丢失）；
  // - shape 字段的类型义务由执法侧的字段 prim 检查单独兜住，不靠本谓词。
  if (c.prim && c.preds.length === 0) return ptypeof(t, primToTypeof(c.prim));
  return preds.length === 0 ? { op: "true" } : preds.length === 1 ? preds[0]! : pAnd(...preds);
}

/**
 * 契约 → 函数入口 param Abs（infer/hover 用）。
 * 标量：prim + pred；shape：obj slots 递归；union：成员 joinAbs；
 * fn 形态：一等 fn shape（paramTypes/returnType），供 refine→error / 展示。
 *
 * Bug 088：**顶层标量位**的 `.optional()`（可缺省 / 可为 undefined）在入口 Abs
 * 投影里此前**整条丢失** ⇒ 下游全部按「该位必填且非 undefined」执法：
 *   - L1 调用点前置条件 ⇒ 契约**明确允许**的 `undefined` 实参被判违约（假红）；
 *   - L1 返回后置条件 ⇒ 同款假红；
 *   - check 签名面渲染 `f(x: number)` ⇒ 与 .d.ts 的 `f(x?: number)` 矛盾。
 *
 * 修法：可选位的入口 Abs 带 **undefined 臂**（与 `union(lit(undefined), <base>)`
 * 这条等价写法**同构**——该写法实测正常 ⇒ 两种写法结论一致）。
 *
 * ⚠ **只作用于顶层位**：对象**字段位**的 `.optional()` 语义是「键可缺席」，
 * 由槽位的 `optional` 标记承载（`constraintOnTermAbs` 不加 undefined 臂）——
 * 否则字段槽渲染从 `{ a?: number }` 变成 `{ a?: number | undefined }`
 * （与 dts 面的 `k?: T` 约定冲突）。
 */
export function constraintToEntryAbs(
  c: NudoConstraint,
  paramName: string,
  depth: number = LAZY_TEMPLATE_DEPTH,
): Abs {
  const t = termVar(paramName);
  if (c.fields) {
    const slots: Record<string, { value: Abs; optional?: boolean }> = {};
    for (const [key, field] of Object.entries(c.fields)) {
      // lazy 字段预算耗尽 → 缺席槽（整键不发；不伪造 undefined 值槽）——
      // 与手写有限层模板同语义：缺席键读出 undefined，守卫递归干净剪枝
      if (field.constraint.lazy && depth <= 0) continue;
      const fieldTerm = getTerm(t, key);
      slots[key] = {
        value: constraintOnTermAbs(field.constraint, fieldTerm, depth),
        ...(field.optional || field.constraint.isOptional
          ? { optional: true }
          : {}),
      };
    }
    const objAbs = abs({ k: "obj", slots }, t, undefined, "path");
    return c.isOptional ? joinAbs(objAbs, undefinedArmAbs(t)) : objAbs;
  }
  // lazy（issue #120）：预算内解一层 ⇒ 内层的可选位语义随之而来
  if (c.lazy) {
    if (depth <= 0) return abs({ k: "any" }, t, undefined, "path");
    const inner = constraintToEntryAbs(derefConstraint(c), paramName, depth - 1);
    return c.isOptional ? joinAbs(inner, undefinedArmAbs(t)) : inner;
  }
  const base = constraintOnTermAbs(c, t, depth);
  return c.isOptional ? joinAbs(base, undefinedArmAbs(t)) : base;
}

/**
 * undefined 臂的 Abs（`lit(undefined)` 的入口 Abs 形态）：
 * unknown 形状 + term = 字面量 undefined + pred 锚在参数项上
 * （与 `constraintOnTermAbs(litC(undefined))` 同款 ⇒ 渲染面显示 "undefined"）。
 */
function undefinedArmAbs(t: Term): Abs {
  return abs({ k: "unknown" }, termLit(undefined), eq(t, termLit(undefined)), "path");
}

/**
 * lit(v) 形态提取：prim + 唯一 eq(self, v)（and 展平一层）。
 * 非字面量形态 → { ok: false }。
 * ok:true 时 v 可为 undefined（lit(undefined) 合法，不得与「无字面量」混同）。
 */
function memberLitValue(m: NudoConstraint):
  | { ok: true; v: number | string | boolean | null | undefined }
  | { ok: false } {
  const leaves: Pred[] = [];
  const visit = (p: Pred): void => {
    if (p.op === "and") {
      p.args.forEach(visit);
      return;
    }
    leaves.push(p);
  };
  m.preds.forEach(visit);
  if (leaves.length !== 1) return { ok: false };
  const p = leaves[0]!;
  if (p.op !== "eq") return { ok: false };
  if (p.a.op === "var" && p.b.op === "lit") {
    return { ok: true, v: p.b.value as number | string | boolean | null | undefined };
  }
  if (p.b.op === "var" && p.a.op === "lit") {
    return { ok: true, v: p.a.value as number | string | boolean | null | undefined };
  }
  return { ok: false };
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
    const mk = memberLitValue(m);
    // 非字面量 / lit(undefined)（无 prim）：不走同 prim 字面量集快路径
    if (!mk.ok) return undefined;
    const v = mk.v;
    if (v === undefined || v === null) return undefined;
    const mp = m.prim ?? (typeof v === "number" ? "number" : typeof v === "string" ? "string" : "boolean");
    if (prim === undefined) prim = mp;
    else if (prim !== mp) return undefined;
    values.push(v as number | string | boolean);
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

/**
 * int 标志 → 整性 pred（Bug 342）。
 *
 * 编码口径 = 投影层解码器 `projection.ts` 的 `isIntZeroModOne`：
 * `eq(self % 1, 0)`（app 项 fn = "%"）。解码器**早于**本编码存在，生产路径上
 * 一直命中不了——整性在 Abs 面上没有任何承载位。
 *
 * ⚠ **单一编码源**：返回后置通道（`postcondition.ts` 的 `assertScalar`）也
 * 需要同一份整性编码（Bug 002：`.int()` 是**数据标志**，不带 pred ⇒ 返回
 * 义务在非字面量返回值上被整条蒸发 ⇒ 假绿）⇒ 本函数导出给同包消费
 * （**不进公共 barrel** ⇒ 公共 API 面不变）。
 */
export function intPredOnTerm(t: Term): Pred {
  return eq(termApp("%", [t, termLit(1)]), termLit(0));
}

/** 两个 pred 合取（缺省侧不算约束）；两侧都在 → and */
function andPreds(a: Pred | undefined, b: Pred | undefined): Pred | undefined {
  if (!a) return b;
  if (!b) return a;
  return pAnd(a, b);
}

function constraintOnTermAbs(c: NudoConstraint, t: Term, depth: number): Abs {
  // lazy（issue #120）：预算内解一层递归；值位预算耗尽 → any
  // （参数项保留，conf=path——守卫可继续收窄）
  if (c.lazy) {
    if (depth <= 0) return abs({ k: "any" }, t, undefined, "path");
    return constraintOnTermAbs(derefConstraint(c), t, depth - 1);
  }
  if (c.fields) {
    const slots: Record<string, { value: Abs; optional?: boolean }> = {};
    for (const [key, field] of Object.entries(c.fields)) {
      // lazy 字段预算耗尽 → 缺席槽（同 constraintToEntryAbs）
      if (field.constraint.lazy && depth <= 0) continue;
      slots[key] = {
        value: constraintOnTermAbs(field.constraint, getTerm(t, key), depth),
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
      .map((m) => constraintOnTermAbs(m, t, depth))
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
      return abs({ k: "prim", type }, t, ptypeof(t, primToTypeof(type)), "path");
    }
    return joined;
  }
  // fn 形态 → 一等 fn shape（paramTypes/returnType 进外延槽）。
  // refine→error 可测路径依赖 shape.k === "fn"（generalize 归入 fnRels[source=refine]）。
  // 不 attachFnImpl（提升/refine 产物禁止挂 relation；apply 走 shape-only 路径）。
  if (c.fn) {
    const paramNames = Object.keys(c.fn.params);
    const paramTypes = paramNames.map((p, i) =>
      constraintOnTermAbs(c.fn!.params[p]!, termVar(`x${i}`), depth),
    );
    const returnType = c.fn.returns
      ? constraintOnTermAbs(c.fn.returns, termVar("ret"), depth)
      : unknown;
    return abs(
      { k: "fn", params: paramNames, paramTypes, returnType },
      t,
      undefined,
      "path",
    );
  }
  // array(item) → arr(element)；元素项独立，不继承外层 term
  if (c.element) {
    const elem = constraintOnTermAbs(c.element, termVar("x[]"), depth);
    // 数组**自身**的长度界（`array(number()).min(3)` → ge(length(self), 3)）
    // 不能随元素投影一起蒸发（Bug 922）：pred 槽承载它（与 prim 分支同款）
    // ⇒ 契约面 / 产物面看得见这条界，执法面也能按数组长度判。
    const arrPred = instantiateOnTerm(c, t, depth);
    return abs(
      { k: "arr", element: elem },
      t,
      arrPred.op === "true" ? undefined : arrPred,
      "path",
    );
  }
  const pred = instantiateOnTerm(c, t, depth);
  // int 标志 → 整性 pred（Bug 342）：`.int()` 是**数据标志**，不产 pred ⇒
  // 约束 → Abs 投影把整性整条蒸发 ⇒ zod / standard 产物面静默放行 3.5，
  // 而门禁（读约束）仍判红 ⇒ 两道门对同一事实给出相反裁决。编码口径与投影层
  // 解码器 `projection.ts` 的 isIntZeroModOne 一致：eq(self % 1, 0)。
  //
  // Bug 1113：**只在数值域上**生成整性 pred —— 域面（domain-membership.ts）本就
  // 只在 `prim === "number"` 时执法 int；这里若对任何 int 位都生成 `x % 1 === 0`
  // ⇒ 非数值约束上出现「域面接受 / Abs 面带整数谓词」的双裁决。`.int()` 已在
  // builder 侧拒绝非数值链（构造期即报错），此处再按域口径收口 ⇒ 两面一致。
  const intPred = isIntFlag(c) && c.prim === "number" ? intPredOnTerm(t) : undefined;
  const predOut = andPreds(pred.op === "true" ? undefined : pred, intPred);
  if (c.prim) {
    return abs({ k: "prim", type: c.prim }, t, predOut, "path");
  }
  // lit(null) / lit(undefined)：无 prim 域（prim 缺失 + eq(self, null/undefined)）
  // ——与对象 union 的 nullish 成员同款编码（Bug 24）：shape unknown +
  // term lit(null/undefined)，formatShape 渲染 "null"/"undefined"，
  // $removeNull/$removeNullish/$narrowTypeOf/strictEq 按 term 识别剪枝。
  // 不落 number 回退（typeof null ≠ "number"，undefined 更不是；否则
  // leq/契约把 undefined 误报成 number）。
  const allEqNullish =
    c.preds.length > 0 &&
    c.preds.every(
      (p) =>
        p.op === "eq" &&
        ((p.b.op === "lit" && (p.b.value === null || p.b.value === undefined)) ||
          (p.a.op === "lit" && (p.a.value === null || p.a.value === undefined))),
    );
  if (allEqNullish) {
    let nullish: null | undefined = null;
    for (const p of c.preds) {
      if (p.op !== "eq") continue;
      if (p.b.op === "lit" && (p.b.value === null || p.b.value === undefined)) {
        nullish = p.b.value as null | undefined;
        break;
      }
      if (p.a.op === "lit" && (p.a.value === null || p.a.value === undefined)) {
        nullish = p.a.value as null | undefined;
        break;
      }
    }
    // term 即字面量本身（值域完全确定，渲染面靠它把「null」与「真 unknown」
    // 区分开）；pred 锚定参数项 t（eq(t, null)）——**不再丢弃**（Bug 965）：
    // 整条约束随 pred 槽一起蒸发 ⇒ 形参退化成 unknown、调用点前置条件不再
    // 执法（假绿），而 dts / zod / standard 三个面各说各话。
    return abs({ k: "unknown" }, termLit(nullish), predOut, "path");
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
  if (!c.fn) throw new Error("nudo fnConstraintToEntryReqs(): constraint is not in fn() form");
  return Object.entries(c.fn.params).map(([param, constraint]) => ({
    param,
    constraint,
  }));
}

/**
 * fn(..., { throws }) / throws 约束 → 申报的 throws 类型名。
 * `"Error"` / `lit("Error")` / brand / union 成员 / `*` 全收。
 *
 * Bug 208：**字符串字面量的 kind 名按分隔符拆分**（`,` / 空白 / `|`）——
 * 与指令面 `@nudo:throws` 的切分口径**同源**（`directive-scan.ts` 的
 * `scanThrowsDecl` 用同一个分隔符集 `/[,\s|]+/`）。
 * 此前侧车槽把整串当成**一个** kind 名（`"TypeError, RangeError"` ⇒ 一个名
 * `TypeError, RangeError`）⇒ 申报**静默失效零诊断** ⇒ L2 门禁把「已申报
 * TypeError」的代码判成「未申报」⇒ **假红**；而**完全等价**的
 * `@nudo:throws TypeError, RangeError` 与 `union("TypeError","RangeError")`
 * 都是绿的 ⇒ 同一语义两种写法结论不同。
 */
export function throwConstraintToKinds(
  c: NudoConstraint | undefined,
): string[] | "*" | undefined {
  if (!c) return undefined;
  const out = new Set<string>();
  let any = false;
  // lazy 环经 thunk 身份 seen 终止（issue #120）：union(lazy(() => self), lit("Error"))
  const seen = new Set<() => NudoConstraint | ConstraintBuilder>();
  const note = (raw: string): void => {
    if (!raw) return;
    // Bug 208：按分隔符拆（与 `scanThrowsDecl` 同口径）⇒ 一个 kind 名里
    // 不得再藏第二个错误名（整串当一名 ⇒ 声明静默失效 ⇒ L2 假红）。
    for (const part of raw
      .split(/[,\s|]+/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      if (part === "*" || part === "any") any = true;
      else out.add(part);
    }
  };
  const walk = (x: NudoConstraint): void => {
    if (x.lazy) {
      if (seen.has(x.lazy)) return;
      seen.add(x.lazy);
      walk(derefConstraint(x));
      return;
    }
    if (x.members) {
      for (const m of x.members) walk(m);
      return;
    }
    // `"Error"` / lit("Error") → eq(self, lit)；从 preds 抠字面量名
    for (const p of x.preds) {
      if (p.op !== "eq" && p.op !== "ne") continue;
      for (const side of [p.a, p.b] as const) {
        if (side.op === "lit" && typeof side.value === "string") note(side.value);
      }
    }
  };
  walk(c);
  if (any) return "*";
  if (out.size > 0) return [...out];
  return undefined;
}
