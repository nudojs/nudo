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
import { ProjectionBudget } from "./projection-budget.ts";

export type Confidence = "exact" | "path" | "widened" | "mock" | "partial" | "opaque";

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
      slots: Record<string, { value: Abs; optional?: boolean; readonly?: boolean }>;
      index?: { key: Abs; value: Abs };
      open?: boolean;
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
    }
  | { k: "brand"; name: string; shape: Abs; ctor?: true }
  | { k: "eff"; eff: "promise" | "generator"; inner: Abs }
  | { k: "sum"; members: Abs[] };

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
};

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
