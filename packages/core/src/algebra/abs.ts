/** 抽象值 Abs = 形状 × 项 × 约束 × 置信度 */
// ALIGN:cli-semantics → docs/design-cli-semantics.md §2
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
  | { k: "tuple"; elements: Abs[]; rest?: Abs }
  | { k: "fn"; params: string[]; name?: string; paramTypes?: Abs[]; returnType?: Abs }
  | { k: "brand"; name: string; shape: Abs }
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
  const parts: string[] = [shapeToString(a.shape)];
  if (a.term) parts.push(`term=${termToString(a.term)}`);
  if (a.pred && a.pred.op !== "true") parts.push(predToString(a.pred));
  parts.push(`#${a.conf}`);
  return parts.join(" ");
}

export function shapeToString(s: Shape): string {
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
          `${k}${slot.optional ? "?" : ""}: ${absToString(slot.value)}`,
      );
      return `{ ${entries.join(", ")} }`;
    }
    case "arr":
      return `${shapeToString(s.element.shape)}[]`;
    case "tuple":
      return `[${s.elements.map((e) => shapeToString(e.shape)).join(", ")}]`;
    case "fn":
      return `fn(${s.params.join(", ")})${s.name ? ` ${s.name}` : ""}`;
    case "brand":
      return s.name;
    case "eff":
      return `${s.eff}<${shapeToString(s.inner.shape)}>`;
    case "sum":
      return s.members.map(absToString).join(" | ");
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

/** 置信度：字面量全确定 */
export function isExactLit(a: Abs): boolean {
  return a.conf === "exact" && a.term?.op === "lit";
}

export function litValue(a: Abs): LiteralValue | undefined {
  return a.term?.op === "lit" ? a.term.value : undefined;
}
