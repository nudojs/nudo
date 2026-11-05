/** 抽象值 Abs = 形状 × 项 × 约束 × 置信度 */
// ALIGN:cli-semantics → docs/design/cli-semantics.md §2
// 本文件 any/unknown 定义是产品语义锚点：any=无约束并集；unknown=推导失败。
// CLI/文档展示与 check L2 应对齐此处，而不是改掉此处。

import type { Term, LiteralValue } from "./term.ts";
import { lit, simplifyTerm, termEquals, termToString } from "./term.ts";
import type { Pred, PrimName } from "./pred.ts";
import {
  and,
  predToString,
  pTrue,
  ptypeof,
  implies,
  type Phi,
} from "./pred.ts";
import { ProjectionBudget } from "./interface/projection-budget.ts";

export type Confidence = "exact" | "path" | "widened" | "mock" | "partial" | "opaque";

/**
 * A6：单条重载 arm（声明序 = TS overload 解析序）。见 fn shape 的 `overloads` 槽。
 */
export type FnOverload = {
  paramTypes: Abs[];
  returnType: Abs;
};

export type Shape =
  | { k: "never" }
  /**
   * any：JS 里可以是任意值（无约束参数）。
   * 运算按真实 JS 语义取并集，不是「分析失败」。
   */
  | { k: "any" }
  /** unknown：分析拿不到信息（求值失败/泄漏），不是「任意值」 */
  | { k: "unknown" }
  | { k: "prim"; type: PrimName }
  | {
      k: "obj";
      /** 槽形与 objects.ts Slot 同构（含 Bug 84 internal 私有槽标记 /
       *  Bug 73 symbolKey 计算符号键标记 / Bug 66 inherited 原型链解析槽） */
      slots: Record<string, { value: Abs; optional?: boolean; readonly?: boolean; internal?: boolean; symbolKey?: boolean; inherited?: boolean }>;
      index?: { key: Abs; value: Abs };
      open?: boolean;
      /**
       * 「数组视图」facet：引擎按 obj 形状建模（自有下标槽 "0".."n-1" +
       * length 槽读面）、原生却是**数组 exotic**（IsArray = true）的值——
       * RegExpExecArray / String.match 结果 / 标签模板对象。消费方
       * （Array.isArray / JSON 序列化视图 / 数组方法派发 / emit 产物）只读
       * 本 facet：形状是唯一事实源，不再有身份侧表；浅拷贝（`{ ...abs }`）
       * 天然携带。
       */
      view?: "array";
    }
  | { k: "arr"; element: Abs }
  | {
      k: "tuple";
      elements: Abs[];
      rest?: Abs;
      /** 已删除下标（delete a[i] / 字面量空洞）：读值为 undefined，`in` 判定 false */
      holes?: number[];
    }
  | {
      k: "fn";
      params: string[];
      name?: string;
      paramTypes?: Abs[];
      returnType?: Abs;
      /**
       * Bug 399：逐位「可省略」标记（与 `params` 同下标，true = 该位有默认值 /
       * 可省）。缺省 = 无标记（必选元数按名字后缀 `...` / `?` 判）。
       *
       * 为什么需要：默认形参（`f(a, b = 1)`）在形参表面上只是光秃秃的名字
       * （`b`）⇒ 被计成必选元数 ⇒ `f = (x = 1) => x` 触发
       * `nudo:assign-mismatch` 假红（JS 语义下 `(x = 1) => x` 的 `length` 是 0）。
       *
       * 与 `ctor` 同纪律：形态信息，不进指纹 / 展示串；`leq` 读它算必选元数。
       */
      optionalParams?: boolean[];
      /**
       * Dual-facet globals (Number/Array/…): callable AND carries static members.
       * `$get` reads these before falling back to Function.prototype names.
       */
      slots?: Record<string, { value: Abs; optional?: boolean; readonly?: boolean }>;
      /**
       * 可构造性 facet（Bug 9）：true = 可 new（函数声明/表达式、类表达式值）；
       * false = 不可 new（箭头/方法/generator/async）。缺省 = 未知
       * （mock/relation/桥接/宿主包装）→ `$new` 记 may-throw。
       * 与 pathNote 同纪律：展示/非值信息，不进 leq / 指纹 / check 等价。
       */
      ctor?: boolean;
      /**
       * A6：重载集承载位（声明侧 TS overload 列表的逐 arm 面）。
       *
       * **只是派发精化，不是赋值语义**：`paramTypes` / `returnType`（逐位 union
       * + 返回并集）仍是该 fn 的**权威外延面** —— leq / 展示 / dts / schema /
       * guard 全部只读它，本槽缺省不出现时旧形状逐字节不变。
       *
       * 消费点：`instantiateReturn` 在**实参能唯一命中某 arm**（逐参 leq +
       * 同元数）时用该 arm 的返回位（TS 口径：按声明序取**首个**命中 arm），
       * 否则回落到 union 返回面（不新造 may-throw）。arm 内可含 α（各自
       * bind/subst 独立）。进 `absKey`（不同重载集不得共享 memo/fingerprint），
       * 但**不进** relation fingerprint（relationFn 无重载面）。
       */
      overloads?: FnOverload[];
    }
  | { k: "brand"; name: string; shape: Abs; ctor?: true; tv?: number }
  // rejected（Bug 36）：promise 的拒绝通道——携带已知拒绝 reason。inner 为
  // never 时表示确定拒绝（fulfilled 臂不可能）；inner 非 never 时两臂均可能
  //（executor fork 一臂 resolve 一臂 reject）。generator 不使用该槽。
  // unsettled（R3）：settle 态未知——引擎未建模的 settle 面（外部 promise /
  // 未知 thenable 采纳 / withResolvers 未捕获 resolve / import() 加载失败）。
  // 无该标记且无 rejected 通道 = 确定 fulfilled（catch/then 的 onRejected
  // 原生死代码，R3a 直通）。展示/态信息，不进 leq / 指纹。
  | {
      k: "eff";
      eff: "promise" | "generator";
      inner: Abs;
      rejected?: Abs;
      unsettled?: boolean;
    }
  | { k: "sum"; members: Abs[] };

/**
 * A2+A8 / A10 / A11：Abs 的**可扩展槽位容器**。
 *
 * 设计纪律（照抄 A6 的 `overloads?` 范式，见 [`docs/design/architecture-debt.md`]
 * 「剩余槽位的受控 minor 执行方案」）：
 * - **缺省不出现** ⇒ 旧 Abs 逐字节不变，所有外延投影 / `leqAbs` 的接受集不变。
 * - 新槽位只加字段，不再改 Shape 判别联合；未来无需为每种能力动 `leqAbs`。
 * - `substAbs` / `snapshotAbs` / `renameAbs` / `absKey` 必须**整包搬运**（A7
 *   的教训：重建只搬四件套会把侧表面静默抹掉）。
 * - 槽位只参与运行期精化与投影增强；`leqAbs` / `formatShape` / dts / schema /
 *   guard 在槽位启用前**不读**它。
 */
export type AbsFacets = {
  /**
   * A2+A8：**无 `new` 的 [[Call]] 是否会成功**。false = 定抛 TypeError
   * （用户类构造器）。⚠️ 与规范 `IsCallable` **不是同一概念**：class
   * constructor 的 IsCallable 为 true（它有 [[Call]] 槽，只是调用时抛），
   * 因此 `exec/call.ts::callableFacetOf`（Proxy [[Call]] 判定）**不读**
   * 本槽位；消费点是 `isClassValueCallee`（裸调用定抛判据）。
   */
  callable?: boolean;
  /** A10：原型对象的自有键集（含符号键）。缺省 = 保守域（旧行为）。 */
  protoOwnKeys?: { strings: string[]; symbols?: string[] };
  /** A11：生成器对象身份。缺省 = 与空对象同形（旧行为）。 */
  brand?: string;
  /**
   * A11 残余：`Generator<T, TReturn, TNext>` 的 **TReturn**。
   * 由 `makeGenObject` 的 `retVal` 填入；缺省 = 不建模（dts 仍只投影 `T`）。
   * 只读投影面，搬运时按引用共享（与 shape 槽值同口径）。
   */
  genReturn?: Abs;
  /**
   * A11 残余：**TNext**（`.next(v)` 的入参域）。引擎目前**不建模** `.next(v)`
   * 的入参（`$yield` 恒返 `unknown`、`next` 槽零形参）⇒ `makeGenObject`
   * 填最保守的 `unknown`（与 TS 默认值类型等价，不是精度承诺）。
   * 槽位 / 搬运 / `facetKey` / dts 第三实参投影已接通；填**真实** v 域
   * 依赖 A1 步骤 4 的真挂起求值模型。手工构造的 Abs 缺省 ≡ 不投影。
   */
  genNext?: Abs;
};

/**
 * 等价副本用的深拷贝（不共享数组；缺省不出现时返回 undefined）。
 * `genReturn` / `genNext` 是**只读投影面**：按引用共享（与 shape 槽值同
 * 口径），不在本叶子模块做 Abs 深拷贝 —— 那会反向依赖 `hof.ts` 成环。
 */
export function cloneAbsFacets(f: AbsFacets | undefined): AbsFacets | undefined {
  if (f === undefined) return undefined;
  const out: AbsFacets = { ...f };
  if (f.protoOwnKeys) {
    out.protoOwnKeys = {
      strings: [...f.protoOwnKeys.strings],
      ...(f.protoOwnKeys.symbols ? { symbols: [...f.protoOwnKeys.symbols] } : {}),
    };
  }
  return out;
}

export type Abs = {
  shape: Shape;
  term?: Term;
  pred?: Pred;
  conf: Confidence;
  /**
   * C2.4：分支 join 可解释标注（如 `join(number | string)`）。
   * 仅展示用：不进 leq / 指纹 / check 等价；formatAbs 读取。
   */
  pathNote?: string;
  /** 可扩展槽位容器（缺省不出现）。搬运纪律见 `AbsFacets`。 */
  facets?: AbsFacets;
};

/**
 * 统一非-Abs 守卫（exec 域判定面单源；与 exec/run.ts isAbsVal 同判定面）。
 * 求值引擎的宿主边界（transpile 泄漏的宿主函数 / 绑定层漏出的 JS 值 /
 * 缺参 undefined）会把非 Abs 送进按 Abs 写的运行时入口——裸读 `.shape`
 * 会炸宿主 TypeError（引擎缺陷伪装成用户缺陷）。
 *
 * DEC-006 非 Abs 入参的 fail-closed 退路表（三选一，按入口语义）：
 * - **退原值透传**：宿主值无信息可加工 ⇒ 原样返回。窄化/拷贝族入口——
 *   exec/runtime/narrow.ts `$removeNull`、runtime/containers/obj.ts
 *   `$copy`（`if (!isAbsLike(a)) return a`）。
 * - **退 unknown**：结果必须是 Abs 且无信息 ⇒ unknown（分析失败令牌，
 *   不是 any）。读侧入口——runtime/containers/arr-index.ts `$idx`
 *   （DEC-006 B/C：禁止读 `.shape` 炸宿主 TypeError）、surface.ts
 *   `$toStr`（退 partial string）。
 * - **硬抛 TypeError**：原生语义该抛（fail-closed 硬抛 NudoThrow）——
 *   runtime/containers/obj.ts `privateNameGuard`（宿主值作私有名接收者）、
 *   exec/class/declare.ts `new <宿主值>`。
 */
export function isAbsLike(v: unknown): v is Abs {
  return typeof v === "object" && v !== null && "shape" in v && "conf" in v;
}

// --- 工厂 ---

export const never: Abs = { shape: { k: "never" }, conf: "exact" };
/** 分析无信息 */
export const unknown: Abs = { shape: { k: "unknown" }, conf: "partial" };
/**
 * 无约束 JS 值（未标注入口参数 / 显式 any()）。
 * ≠ unknown：unknown 表示引擎推导失败，any 表示开发者未写契约。
 */
export const anyAbs: Abs = { shape: { k: "any" }, conf: "path" };

/** 带 term 的 any（generalize type-var） */
export function anyVar(id: string, conf: Confidence = "path"): Abs {
  return { shape: { k: "any" }, term: { op: "var", id }, conf };
}

export function num(): Abs {
  return { shape: { k: "prim", type: "number" }, conf: "exact" };
}

export function str(): Abs {
  return { shape: { k: "prim", type: "string" }, conf: "exact" };
}

export function bool(): Abs {
  return { shape: { k: "prim", type: "boolean" }, conf: "exact" };
}

export function numLit(value: number): Abs {
  return {
    shape: { k: "prim", type: "number" },
    term: lit(value),
    pred: pTrue,
    conf: "exact",
  };
}

export function strLit(value: string): Abs {
  return {
    shape: { k: "prim", type: "string" },
    term: lit(value),
    pred: pTrue,
    conf: "exact",
  };
}

export function boolLit(value: boolean): Abs {
  return {
    shape: { k: "prim", type: "boolean" },
    term: lit(value),
    pred: pTrue,
    conf: "exact",
  };
}

export function bigintLit(value: bigint): Abs {
  return {
    shape: { k: "prim", type: "bigint" },
    term: lit(value),
    pred: pTrue,
    conf: "exact",
  };
}

/** 带项的符号数，例如参数 x */
export function numVar(id: string, pred?: Pred, conf: Confidence = "path"): Abs {
  return {
    shape: { k: "prim", type: "number" },
    term: { op: "var", id },
    pred: pred ?? pTrue,
    conf,
  };
}

export function obj(
  slots: Record<string, { value: Abs; optional?: boolean }>,
): Abs {
  return { shape: { k: "obj", slots }, conf: "exact" };
}

/**
 * 标注**数组视图**（原生数组 exotic，形状仍是 obj）：不可变替换 shape ——
 * facet 成为形状的一部分，浅拷贝（`{ ...abs }` / `{ ...shape }`）天然携带
 * （身份侧表会在这里丢失）。非 obj 形状不标注（数组视图只对按 obj 建模的
 * 数组 exotic 有意义）。
 */
export function markArrayView(a: Abs): void {
  if (a.shape.k !== "obj") return;
  a.shape = { ...a.shape, view: "array" };
}

/** 数组视图判定（形状 facet 为唯一事实源） */
export function isArrayView(a: Abs): boolean {
  return a.shape.k === "obj" && a.shape.view === "array";
}

export function confJoin(a: Confidence, b: Confidence): Confidence {
  const rank: Confidence[] = ["exact", "path", "widened", "mock", "partial", "opaque"];
  const ia = rank.indexOf(a);
  const ib = rank.indexOf(b);
  // 取更差的
  return rank[Math.max(ia < 0 ? 5 : ia, ib < 0 ? 5 : ib)]!;
}

export function absToString(a: Abs): string {
  return absToStringB(a, new ProjectionBudget());
}

function absToStringB(a: Abs, budget: ProjectionBudget): string {
  // DESIGN-001：环 / 超深截断标记（与 formatShape 同口径）
  const stop = budget.enter(a);
  if (stop) return stop === "cycle" ? "…cycle" : "…";
  try {
    const parts: string[] = [shapeToStringB(a.shape, budget)];
    if (a.term) parts.push(`term=${termToString(a.term)}`);
    if (a.pred && a.pred.op !== "true") parts.push(predToString(a.pred));
    parts.push(`#${a.conf}`);
    return parts.join(" ");
  } finally {
    budget.exit();
  }
}

export function shapeToString(s: Shape): string {
  return shapeToStringB(s, new ProjectionBudget());
}

function shapeToStringB(s: Shape, budget: ProjectionBudget): string {
  // shape 级递归（arr element / tuple element / eff inner 直接下钻 .shape）
  // 也入预算：环可能只出现在 shape 对象层面（enter 接受任意 object）。
  const stop = budget.enter(s);
  if (stop) return stop === "cycle" ? "…cycle" : "…";
  try {
    return shapeToStringInner(s, budget);
  } finally {
    budget.exit();
  }
}

function shapeToStringInner(s: Shape, budget: ProjectionBudget): string {
  switch (s.k) {
    case "never":
      return "never";
    case "any":
      return "any";
    case "unknown":
      return "unknown";
    case "prim":
      return s.type;
    case "obj": {
      const entries = Object.entries(s.slots).map(
        ([k, slot]) =>
          `${k}${slot.optional ? "?" : ""}: ${absToStringB(slot.value, budget)}`,
      );
      return `{ ${entries.join(", ")} }`;
    }
    case "arr":
      return `${shapeToStringB(s.element.shape, budget)}[]`;
    case "tuple":
      return `[${s.elements.map((e) => shapeToStringB(e.shape, budget)).join(", ")}]`;
    case "fn":
      return `fn(${s.params.join(", ")})${s.name ? ` ${s.name}` : ""}`;
    case "brand":
      return s.name;
    case "eff":
      return `${s.eff}<${shapeToStringB(s.inner.shape, budget)}>`;
    case "sum":
      return s.members.map((m) => absToStringB(m, budget)).join(" | ");
    default:
      return "·";
  }
}

/** 从 term 反推 prim shape */
export function shapeOfTerm(t: Term): Shape {
  if (t.op === "lit") {
    const v = t.value;
    if (typeof v === "number") return { k: "prim", type: "number" };
    if (typeof v === "string") return { k: "prim", type: "string" };
    if (typeof v === "boolean") return { k: "prim", type: "boolean" };
    if (typeof v === "bigint") return { k: "prim", type: "bigint" };
    return { k: "unknown" };
  }
  return { k: "unknown" };
}

/** 构造带项的结果 Abs；pred 相对 term */
export function abs(
  shape: Shape,
  term: Term | undefined,
  pred: Pred | undefined,
  conf: Confidence,
): Abs {
  return {
    shape,
    term,
    pred: pred && pred.op !== "true" ? pred : undefined,
    conf,
  };
}

export function isNumPrim(a: Abs): boolean {
  return a.shape.k === "prim" && a.shape.type === "number";
}

export function isStrPrim(a: Abs): boolean {
  return a.shape.k === "prim" && a.shape.type === "string";
}

export function isBigPrim(a: Abs): boolean {
  return a.shape.k === "prim" && a.shape.type === "bigint";
}

/** 置信度：字面量全确定 */
export function isExactLit(a: Abs): boolean {
  return a.conf === "exact" && a.term?.op === "lit";
}

/**
 * tagged result：把「无字面量」与「字面量 undefined」分开。
 * 判定是否是字面量必须看 `ok`，禁止用 `value !== undefined` / `(litValue(...).ok ? litValue(...).value : undefined) !== undefined`。
 */
export type LitValueResult =
  | { ok: true; value: LiteralValue }
  | { ok: false };

export function litValue(a: Abs): LitValueResult {
  // DEC-006 B/C：绑定层可能漏出 JS undefined（缺参/spread 未展开）——
  // fail-closed 视为无字面量，禁止宿主 TypeError 冒进 internal
  return a?.term?.op === "lit" ? { ok: true, value: a.term.value } : { ok: false };
}

// --- 字面量助手（env 声明 + harvester .d.ts 物化共享，经 /internal 面）---
// 抽取方向：Abs → JS 值（absNumLit / absStrLit / allAbsStr）；
// 构造方向：JS 值 → Abs（absLit）。

/** 抽取 number 字面量值；入参缺省 / term 非 lit / 值非 number → undefined */
export function absNumLit(a: Abs | undefined): number | undefined {
  if (!a) return undefined;
  const vR = litValue(a);
  const v = vR.ok ? vR.value : undefined;
  return typeof v === "number" ? v : undefined;
}

/** 抽取 string 字面量值；入参缺省 / term 非 lit / 值非 string → undefined */
export function absStrLit(a: Abs | undefined): string | undefined {
  if (!a) return undefined;
  const vR = litValue(a);
  const v = vR.ok ? vR.value : undefined;
  return typeof v === "string" ? v : undefined;
}

/** 全员 string 字面量才命中（variadic 内建折叠，如 path.join）；任一未命中 → undefined */
export function allAbsStr(args: Abs[]): string[] | undefined {
  const result: string[] = [];
  for (const a of args) {
    const s = absStrLit(a);
    if (s === undefined) return undefined;
    result.push(s);
  }
  return result;
}

/**
 * 具体值 → 字面量 Abs（.d.ts 字面量类型节点物化）：
 * num/str/bool → lit 构造；bigint → 无 term 的 exact prim（d.ts 不保数值）；
 * null/undefined → unknown 叶子（不 brand —— 与 env 显示层的 branded null 区分）。
 */
export function absLit(value: string | number | boolean | bigint | null | undefined): Abs {
  if (typeof value === "number") return numLit(value);
  if (typeof value === "string") return strLit(value);
  if (typeof value === "boolean") return boolLit(value);
  if (typeof value === "bigint") return abs({ k: "prim", type: "bigint" }, undefined, undefined, "exact");
  if (value === null) return abs({ k: "unknown" }, lit(null), undefined, "exact");
  return abs({ k: "unknown" }, lit(undefined), undefined, "exact");
}
