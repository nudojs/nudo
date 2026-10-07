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

/** array(item) —— 数组，元素满足 item；item 亦可为具体字面量（指令文法） */
export function array(
  item: NudoConstraint | ConstraintBuilder | number | string | boolean | null | undefined,
): ConstraintBuilder {
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
 */
export function shape(
  fields: Record<
    string,
    NudoConstraint | ConstraintBuilder | number | string | boolean | null | undefined
  >,
): ConstraintBuilder {
  const mapped: Record<string, NudoField> = {};
  for (const [k, v] of Object.entries(fields)) {
    const constraint = asNestedConstraint(v, `shape 字段 '${k}'`);
    mapped[k] = {
      constraint,
      ...(constraint.isOptional ? { optional: true } : {}),
    };
  }
  return makeBuilder(undefined, [], { fields: mapped });
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
 */
export function fn(
  params: Record<string, NudoConstraint | ConstraintBuilder | number | string | boolean | null | undefined>,
  returns?: NudoConstraint | ConstraintBuilder | number | string | boolean | null | undefined,
  opts?: { throws?: NudoConstraint | ConstraintBuilder | number | string | boolean | null | undefined },
): ConstraintBuilder {
  const normalized: Record<string, NudoConstraint> = {};
  for (const [k, v] of Object.entries(params)) {
    normalized[k] = asNestedConstraint(v, `fn param '${k}'`);
  }
  return makeBuilder(undefined, [], {
    fn: {
      params: normalized,
      ...(returns !== undefined
        ? { returns: asNestedConstraint(returns, "fn return value") }
        : {}),
      ...(opts?.throws !== undefined
        ? { throws: asNestedConstraint(opts.throws, "fn throws") }
        : {}),
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

/** partial(c)：shape 全字段变可选；非 shape throw（lazy 包装先解一层） */
export function partial(c: NudoConstraint | ConstraintBuilder): ConstraintBuilder {
  if (!isConstraint(c))
    throw new Error("nudo partial(): only shape(...) constraints are accepted");
  const d = derefConstraint(c);
  if (!d.fields)
    throw new Error("nudo partial(): only shape(...) constraints are accepted");
  const fields: Record<string, NudoField> = {};
  for (const [k, f] of Object.entries(d.fields)) {
    fields[k] = {
      constraint: { ...toPlainConstraint(f.constraint), isOptional: true },
      optional: true,
    };
  }
  return makeBuilder(d.prim, d.preds, { fields });
}

/** pick(c, keys)：shape 子形状（不存在的 key 忽略）；非 shape throw（lazy 包装先解一层） */
export function pick(
  c: NudoConstraint | ConstraintBuilder,
  keys: string[],
): ConstraintBuilder {
  if (!isConstraint(c))
    throw new Error("nudo pick(): only shape(...) constraints are accepted");
  const d = derefConstraint(c);
  if (!d.fields)
    throw new Error("nudo pick(): only shape(...) constraints are accepted");
  const fields: Record<string, NudoField> = {};
  for (const k of keys) {
    const f = d.fields[k];
    if (f) fields[k] = f;
  }
  return makeBuilder(d.prim, d.preds, { fields });
}

/** omit(c, keys)：shape 去字段；非 shape throw（lazy 包装先解一层） */
export function omit(
  c: NudoConstraint | ConstraintBuilder,
  keys: string[],
): ConstraintBuilder {
  if (!isConstraint(c))
    throw new Error("nudo omit(): only shape(...) constraints are accepted");
  const d = derefConstraint(c);
  if (!d.fields)
    throw new Error("nudo omit(): only shape(...) constraints are accepted");
  const drop = new Set(keys);
  const fields: Record<string, NudoField> = {};
  for (const [k, f] of Object.entries(d.fields)) {
    if (!drop.has(k)) fields[k] = f;
  }
  return makeBuilder(d.prim, d.preds, { fields });
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
    return ptypeof(termVar(paramName), primToTypeof(c.prim));
  }
  return preds.length === 0 ? { op: "true" } : preds.length === 1 ? preds[0]! : pAnd(...preds);
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
  if (c.prim && c.preds.length === 0) return ptypeof(t, primToTypeof(c.prim));
  return preds.length === 0 ? { op: "true" } : preds.length === 1 ? preds[0]! : pAnd(...preds);
}

/**
 * 契约 → 函数入口 param Abs（infer/hover 用）。
 * 标量：prim + pred；shape：obj slots 递归；union：成员 joinAbs；
 * fn 形态：一等 fn shape（paramTypes/returnType），供 refine→error / 展示。
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
    return abs({ k: "obj", slots }, t, undefined, "path");
  }
  return constraintOnTermAbs(c, t, depth);
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
    return abs({ k: "arr", element: elem }, t, undefined, "path");
  }
  const pred = instantiateOnTerm(c, t, depth);
  const predOut = pred.op === "true" ? undefined : pred;
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
    // term 即字面量本身（值域完全确定）；pred eq(参数项, null) 锚定的是 t，
    // 与 lit term 不一致，不再随行。
    return abs({ k: "unknown" }, termLit(nullish), undefined, "path");
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
 */
export function throwConstraintToKinds(
  c: NudoConstraint | undefined,
): string[] | "*" | undefined {
  if (!c) return undefined;
  const out = new Set<string>();
  let any = false;
  // lazy 环经 thunk 身份 seen 终止（issue #120）：union(lazy(() => self), lit("Error"))
  const seen = new Set<() => NudoConstraint | ConstraintBuilder>();
  const note = (s: string): void => {
    if (s === "*" || s === "any") any = true;
    else if (s) out.add(s);
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
