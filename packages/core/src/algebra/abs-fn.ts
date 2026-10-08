/**
 * Abs 上的一等函数：shape 是 fn，实现在旁路（不污染 Shape）。
 * 与 term-registry 同一纪律：不给共享单例挂 impl。
 */

import type { Node } from "@babel/types";
import type { Abs, Confidence, Shape } from "./abs.ts";
import { abs } from "./abs.ts";
import type { Term } from "./term.ts";
import { litKeyString } from "./term.ts";
import type { Pred } from "./pred.ts";
import type { AstEnv } from "./hof-types.ts";

/** Abs 原生 env/builtin 实现（evaluator 优先） */
export type AbsSigImpl = (args: Abs[], thisVal?: Abs) => Abs | undefined;

/**
 * 已知不抛的 apply 返回面（裸 Abs，无 throws 通道）。
 * 等价 `Abs`，仅作意图标注：impl 作者写死「本 apply 不抛」时用它收窄签名，
 * 调用侧仍应经 `absOnly` / `isAbsApplyResult` 取 abs（`AbsFnImpl.apply` 静态面是宽的）。
 */
export type AbsApplyNoThrow = Abs;

/**
 * 已知不抛的 apply 实现签名（`AbsSigImpl` 的 apply 对偶）。
 * 返回裸 `Abs` = 不抛；需要 throws 面时改用 `AbsFnImpl["apply"]`（`AbsApplyReturn`）。
 */
export type AbsApplyNoThrowFn = (args: Abs[], thisVal?: Abs) => AbsApplyNoThrow;

/**
 * apply 契约返回的 throws 通道（H1 / DESIGN-003）。
 * `throws` 必填：不抛传 `never`。$call 统一路由——
 * always-throw（abs=never）→ NudoThrow 由调用边界收成 throws；
 * may-throw → pushThrowExit 记入调用方 throwExits（try/catch 可吸收）。
 * 包装 `callTranspiledExportFull` 必须走 `callTranspiledExportApply`，
 * 不得手拆 `.result`（会静默丢 throws 面）。
 *
 * 构造只经 `makeAbsApplyResult`（打上 brand）；`isAbsApplyResult` 只认 brand，
 * 避免裸对象靠 `!shape` 误判成 apply 结果、吞掉 throws 面。
 */
export type AbsApplyResult = {
  abs: Abs;
  throws: Abs;
  /** Discriminator stamped by makeAbsApplyResult. */
  readonly applyResult: true;
};

/** apply 可返回裸 Abs（无 throws）或带 throws 通道的 AbsApplyResult */
export type AbsApplyReturn = Abs | AbsApplyResult;

/** 唯一构造入口：打上 applyResult brand。 */
export function makeAbsApplyResult(abs: Abs, throws: Abs): AbsApplyResult {
  return { abs, throws, applyResult: true };
}

/** AbsApplyResult 判别：只认 brand（不靠 !shape 结构猜）。 */
export function isAbsApplyResult(v: AbsApplyReturn): v is AbsApplyResult {
  return (
    !!v &&
    typeof v === "object" &&
    (v as { applyResult?: unknown }).applyResult === true
  );
}

/**
 * apply 返回值取 abs 面（已知不抛 / 测试面只想看结果时用）。
 * 丢弃 throws 通道——若 impl 可能抛，必须走 `$call` 统一路由，不得用本函数吞 throws。
 */
export function absOnly(r: AbsApplyReturn): AbsApplyNoThrow {
  return isAbsApplyResult(r) ? r.abs : r;
}

export type AbsFnImpl = {
  params: string[];
  /** 可选：无 body 时走 relation（纯关系 fn） */
  body?: Node;
  async?: boolean;
  /** 声明时捕获的环境（闭包） */
  env?: AstEnv;
  kind?: string;
  /**
   * Bug 9：原生 fn.length（首个默认值/rest 形参前的形参数）——静态已知时
   * 记录（宿主函数 v.length / 全 Identifier 形参的 AST），$len / $get 的
   * f.length 折 exact；未记录（默认值/嵌套默认模式不可判）→ 保守 number≥0。
   */
  length?: number;
  /**
   * 调用时直接派发（mock withArgs 等），优先于 body。
   * 返回裸 Abs = 不抛；返回 AbsApplyResult 时 throws 面经 $call 统一路由，
   * 不得在 apply 内自行 re-throw / pushThrowExit（会与 $call 路由叠算）。
   */
  apply?: (args: Abs[], thisVal?: Abs) => AbsApplyReturn;
  /**
   * 对象方法（ObjectMethod / 方法型 FunctionExpression）：$invoke 时把
   * receiver 作为 apply 的**首参**注入。shape.params 仍是用户可见形参
   * （不含 receiver），自由调用不注入 → this 为 unbound（JS 语义）。
   */
  bindThis?: boolean;
  /**
   * Optional content key for cache fingerprints. formatAbs cannot see
   * WeakMap-side mock semantics (returns/withArgs/callsFake), so hosts that
   * build mocks should stamp a stable fingerprint here.
   * relation-only 必填（未传时 relationFn 自动生成）。
   */
  fingerprint?: string;
  /** 无 body 时，按 paramTypes 做 α 替换得到返回 */
  relation?: {
    paramTypes: Abs[];
    returnType: Abs;
    /**
     * 条件类型 infer：绑定 fromVar 后从 via 投出 inferVar
     * （`T extends (infer E)[]` → via: "arr"；`T extends Promise<infer U>` → "promise"）。
     */
    inferFrom?: { fromVar: string; via: "arr" | "promise"; inferVar: string };
    /** extends 不成立时的假分支（如 never） */
    condFallback?: Abs;
  };
  /** `@nudo:pure`：调用结果按实参记忆化（无副作用契约） */
  pureName?: string;
};

const implByAbs = new WeakMap<object, AbsFnImpl>();

export function attachFnImpl(a: Abs, impl: AbsFnImpl): void {
  if (a && typeof a === "object") implByAbs.set(a as object, impl);
}

export function getFnImpl(a: Abs): AbsFnImpl | undefined {
  if (!a || typeof a !== "object") return undefined;
  return implByAbs.get(a as object);
}

/** 标记纯函数（@nudo:pure）：调用结果可按实参记忆化 */
export function markPureFn(target: object, name: string): void {
  if (!target || typeof target !== "object") return;
  (target as { _memoize?: string })._memoize = name;
  const impl = implByAbs.get(target);
  if (impl) impl.pureName = name;
}

/** 读纯函数标记（Abs impl 或对象属性 `_memoize`） */
export function pureFnNameOf(fn: unknown): string | undefined {
  if (!fn || (typeof fn !== "object" && typeof fn !== "function")) return undefined;
  const impl = implByAbs.get(fn as object);
  if (impl?.pureName) return impl.pureName;
  return (fn as { _memoize?: string })._memoize;
}

/** 造一个带实现的 Abs 函数值 */
export function absFunction(
  params: string[],
  impl: Omit<AbsFnImpl, "params">,
  opts?: {
    name?: string;
    paramTypes?: Abs[];
    returnType?: Abs;
    slots?: Record<string, { value: Abs; optional?: boolean; readonly?: boolean }>;
    conf?: Confidence;
    /** Bug 9 可构造性 facet：true/false 已知，缺省未知（见 Shape k:"fn".ctor） */
    ctor?: boolean;
    /** Bug 9：原生 fn.length（impl.length 落地，$len 折 exact） */
    length?: number;
  },
): Abs {
  const a: Abs = {
    shape: {
      k: "fn",
      params,
      ...(opts?.name ? { name: opts.name } : {}),
      ...(opts?.paramTypes ? { paramTypes: opts.paramTypes } : {}),
      ...(opts?.returnType ? { returnType: opts.returnType } : {}),
      ...(opts?.slots ? { slots: opts.slots } : {}),
      ...(opts?.ctor !== undefined ? { ctor: opts.ctor } : {}),
    },
    conf: opts?.conf ?? "exact",
  };
  attachFnImpl(a, {
    params,
    ...impl,
    ...(opts?.length !== undefined ? { length: opts.length } : {}),
  });
  return a;
}

/**
 * 宿主 JS 函数的可构造性（Bug 9）：generator/async/async-generator 声明、
 * 箭头、内建方法（无 .prototype）不可 new；bind 产物取决于目标（未知）。
 * 函数声明/宿主构造器 → 可构造。求值引擎的函数声明编译成真实宿主函数，
 * `$new` / `$class(extends)` / 桥接包装按此 stamping。
 */
export function hostFnCtorFacet(v: Function): boolean | undefined {
  // Bug 9 求值引擎标记：transpile 把 generator/async 声明去种类化成普通
  // function——声明后挂 __nudoNonCtor，运行时按此识别不可 new
  if ((v as { __nudoNonCtor?: unknown }).__nudoNonCtor === 1) return false;
  const protoCtor = Object.getPrototypeOf(v)?.constructor?.name;
  if (
    protoCtor === "GeneratorFunction" ||
    protoCtor === "AsyncFunction" ||
    protoCtor === "AsyncGeneratorFunction"
  ) {
    return false;
  }
  if (typeof v.name === "string" && v.name.startsWith("bound ")) return undefined;
  // 箭头与内建方法（Array.prototype.map 等）没有 prototype 属性
  if (!(v as { prototype?: unknown }).prototype) return false;
  return true;
}

// --- stable key（relationFn fingerprint）---

function termKey(t: Term): string {
  // -0/0 身份不同：键走 litKeyString（String(-0)==="0" 会折叠）
  if (t.op === "lit") return `L:${typeof t.value}:${litKeyString(t.value)}`;
  if (t.op === "var") return `V:${t.id}`;
  return `A:${t.fn}(${t.args.map(termKey).join(",")})`;
}

function predKey(p: Pred): string {
  switch (p.op) {
    case "true":
      return "T";
    case "false":
      return "F";
    case "eq":
    case "ne":
    case "lt":
    case "le":
    case "gt":
    case "ge":
      return `${p.op}(${termKey(p.a)},${termKey(p.b)})`;
    case "and":
    case "or":
      return `${p.op}(${p.args.map(predKey).sort().join(",")})`;
    case "not":
      return `not(${predKey(p.arg)})`;
    case "typeof":
      return `typeof(${termKey(p.t)},${p.type})`;
    case "assumeFinite":
      return `assumeFinite(${termKey(p.t)})`;
  }
}

function shapeStableKey(s: Shape, seen: Set<object>): string {
  switch (s.k) {
    case "never":
    case "any":
    case "unknown":
      return s.k;
    case "prim":
      return `p:${s.type}`;
    case "brand":
      return `b:${s.name}(${absStableKey(s.shape, seen)})`;
    case "eff":
      return `e:${s.eff}<${absStableKey(s.inner, seen)}>`;
    case "arr":
      return `arr(${absStableKey(s.element, seen)})`;
    case "tuple": {
      const els = s.elements.map((e) => absStableKey(e, seen)).join(",");
      const rest = s.rest ? `...${absStableKey(s.rest, seen)}` : "";
      return `tup[${els}${rest}]`;
    }
    case "fn": {
      const pts = (s.paramTypes ?? []).map((t) => absStableKey(t, seen)).join(",");
      const ret = s.returnType ? absStableKey(s.returnType, seen) : "?";
      const name = s.name ? `#${s.name}` : "";
      const slots = s.slots
        ? `{${Object.keys(s.slots)
            .sort()
            .map((k) => `${k}:${absStableKey(s.slots![k]!.value, seen)}`)
            .join(",")}}`
        : "";
      return `fn${name}(${s.params.join(",")}|${pts})=>${ret}${slots}`;
    }
    case "sum":
      return `sum(${s.members.map((m) => absStableKey(m, seen)).join("|")})`;
    case "obj": {
      const slots = Object.keys(s.slots)
        .sort()
        .map((k) => {
          const slot = s.slots[k]!;
          const flags = (slot.optional ? "?" : "") + (slot.readonly ? "r" : "");
          return `${k}${flags}:${absStableKey(slot.value, seen)}`;
        })
        .join(",");
      const idx = s.index
        ? `idx(${absStableKey(s.index.key, seen)}→${absStableKey(s.index.value, seen)})`
        : "";
      return `obj{${slots}}${idx}${s.open ? "open" : ""}`;
    }
  }
}

function absStableKey(a: Abs, seen: Set<object> = new Set()): string {
  if (seen.has(a)) return "cycle";
  seen.add(a);
  const t = a.term ? `=${termKey(a.term)}` : "";
  const p = a.pred ? `@${predKey(a.pred)}` : "";
  return `${shapeStableKey(a.shape, seen)}${t}${p}`;
}

/** relationFn 稳定 fingerprint（同签名共享，见 §3.3 已知限制） */
export function relationFingerprint(
  paramTypes: Abs[],
  returnType: Abs,
): string {
  return `rel(${paramTypes.map((p) => absStableKey(p)).join(",")})=>${absStableKey(returnType)}`;
}

/**
 * 无 body、纯关系的 fn Abs。params 仅记 arity。
 *
 * **双写纪律：** 同一份关系数据必须同时写到——
 *   1. `shape.paramTypes` / `shape.returnType`  —— format / leq / 展示读这里
 *   2. `impl.relation`                         —— D 路径应用读这里
 * 两槽共享同一数组/对象引用（防内容分叉）；构造后请勿原地 mutate。
 *
 * 默认 conf="path"（与提升产物一致）。禁止静默对齐 absFunction 的 "exact"。
 * fingerprint 必填（call-budget）；未传时由 paramTypes+returnType 稳定序列化生成。
 * 同签名 relationFn 共享 fingerprint → 共享 budget 键（见 design §3.3 已知限制）。
 */
export function relationFn(
  paramTypes: Abs[],
  returnType: Abs,
  opts?: {
    params?: string[];
    conf?: Confidence;
    fingerprint?: string;
    inferFrom?: { fromVar: string; via: "arr" | "promise"; inferVar: string };
    condFallback?: Abs;
  },
): Abs {
  const params = opts?.params ?? paramTypes.map((_, i) => `x${i}`);
  const conf = opts?.conf ?? "path";
  const fingerprint =
    opts?.fingerprint ?? relationFingerprint(paramTypes, returnType);
  const a: Abs = {
    shape: {
      k: "fn",
      params,
      paramTypes,
      returnType,
    },
    conf,
  };
  attachFnImpl(a, {
    params,
    relation: {
      paramTypes,
      returnType,
      ...(opts?.inferFrom ? { inferFrom: opts.inferFrom } : {}),
      ...(opts?.condFallback ? { condFallback: opts.condFallback } : {}),
    },
    fingerprint,
  });
  return a;
}

/** 仅写 shape 槽（E 路径 / §5.2 提升产物）；禁止 attachFnImpl */
export function shapeOnlyFn(
  paramTypes: Abs[],
  returnType: Abs,
  opts?: { params?: string[]; conf?: Confidence },
): Abs {
  const params = opts?.params ?? paramTypes.map((_, i) => `x${i}`);
  return abs(
    { k: "fn", params, paramTypes, returnType },
    undefined,
    undefined,
    opts?.conf ?? "path",
  );
}
