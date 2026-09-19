/**
 * Abs → 生态 schema 投影（单向有损）。
 *
 * 中间层：SchemaNode（基形态 + refinements + dropped）。
 * Dialect 只负责 Node → 源码字符串；Abs 才是真理源，投影不回读。
 *
 * Pred 可表达子集（与 core projection 同口径）：
 *   number 常数界 / int（`x % 1 === 0`）/ string 长度界 / eq lit
 * 不可表达（符号界、or/not、length 于 number…）→ 基类型 + dropped 注记。
 */

import type { Abs, Pred, Term } from "@nudojs/core";
import { predToString } from "@nudojs/core";
import { SELF } from "@nudojs/core";

export type SchemaDialect = "zod";

export type SchemaRefinement =
  | { kind: "numBound"; op: "gt" | "ge" | "lt" | "le"; n: number }
  | { kind: "int" }
  | { kind: "strMin"; n: number }
  | { kind: "strMax"; n: number }
  | { kind: "dropped"; note: string };

export type SchemaNode =
  | { k: "lit"; value: string | number | boolean | null | undefined }
  | { k: "prim"; type: "number" | "string" | "boolean" | "bigint" | "symbol"; refinements: SchemaRefinement[] }
  | { k: "obj"; slots: Array<{ key: string; node: SchemaNode; optional?: boolean }> }
  | { k: "arr"; element: SchemaNode }
  | { k: "tuple"; elements: SchemaNode[] }
  | { k: "union"; members: SchemaNode[] }
  | { k: "fn" }
  | { k: "promise"; inner: SchemaNode }
  | { k: "brand"; name: string }
  | { k: "never" }
  | { k: "unknown" }
  | { k: "summarized"; source: string }; // dialect 前置兜底（当前未用，预留）

export type SchemaProjection = {
  source: string;
  dialect: SchemaDialect;
  /** 未能落入 dialect 的 pred 注记（展示用，不进 source 字符串） */
  dropped: string[];
};

// --- term helpers（与 core projection 同口径，本地副本避免 service→core 深路径）---

function termEq(a: Term | undefined, b: Term | undefined): boolean {
  if (!a || !b) return false;
  if (a.op !== b.op) return false;
  if (a.op === "lit" && b.op === "lit") return a.value === b.value;
  if (a.op === "var" && b.op === "var") return a.id === b.id;
  if (a.op === "app" && b.op === "app") {
    return (
      a.fn === b.fn &&
      a.args.length === b.args.length &&
      a.args.every((x, i) => termEq(x, b.args[i]))
    );
  }
  return false;
}

function predLeaves(p: Pred | undefined): Pred[] | "unexpressible" {
  if (!p || p.op === "true") return [];
  if (p.op === "and") {
    const out: Pred[] = [];
    for (const x of p.args) {
      const sub = predLeaves(x);
      if (sub === "unexpressible") return "unexpressible";
      out.push(...sub);
    }
    return out;
  }
  if (p.op === "or" || p.op === "not" || p.op === "false") return "unexpressible";
  return [p];
}

function isSelfOrSelfPlaceholder(t: Term): boolean {
  return t.op === "var" && (t.id === "self" || t.id === SELF || t.id.startsWith("__nudo"));
}

function numericBoundOn(
  p: Pred,
  anchors: Term[],
): { op: "gt" | "ge" | "lt" | "le"; n: number } | undefined {
  if (p.op !== "gt" && p.op !== "ge" && p.op !== "lt" && p.op !== "le") return undefined;
  if (p.b.op !== "lit" || typeof p.b.value !== "number") return undefined;
  for (const anchor of anchors) {
    if (termEq(p.a, anchor) || (isSelfOrSelfPlaceholder(p.a) && isSelfOrSelfPlaceholder(anchor))) {
      return { op: p.op, n: p.b.value };
    }
  }
  return undefined;
}

function lengthBoundOn(
  p: Pred,
  self: Term | undefined,
): { dir: "min" | "max"; n: number } | undefined {
  const anchors: Term[] = [];
  if (self) anchors.push({ op: "app", fn: "length", args: [self] });
  anchors.push({ op: "app", fn: "length", args: [{ op: "var", id: SELF }] });
  for (const anchor of anchors) {
    const b = numericBoundOn(p, [anchor]);
    if (!b) continue;
    if (b.op === "ge") return { dir: "min", n: Math.ceil(b.n) };
    if (b.op === "gt") return { dir: "min", n: Math.floor(b.n) + 1 };
    if (b.op === "le") return { dir: "max", n: Math.floor(b.n) };
    if (b.op === "lt") return { dir: "max", n: Math.ceil(b.n) - 1 };
  }
  return undefined;
}

function isIntModOne(p: Pred, _self: Term | undefined): boolean {
  if (p.op !== "eq") return false;
  const zero = (t: Term): boolean => t.op === "lit" && t.value === 0;
  const isModOne = (t: Term): boolean =>
    t.op === "app" && t.fn === "%" && t.args.length === 2 && t.args[1]?.op === "lit" && t.args[1].value === 1;
  return (isModOne(p.a) && zero(p.b)) || (isModOne(p.b) && zero(p.a));
}

function extractPrimRefinements(a: Abs): {
  refinements: SchemaRefinement[];
  dropped: string[];
} {
  const refinements: SchemaRefinement[] = [];
  const dropped: string[] = [];
  const leaves = predLeaves(a.pred);
  if (leaves === "unexpressible") {
    if (a.pred && a.pred.op !== "true") {
      dropped.push(`pred not projected: ${predToString(a.pred)}`);
    }
    return { refinements, dropped };
  }
  const self = a.term;
  const shapeType = a.shape.k === "prim" ? a.shape.type : undefined;

  for (const p of leaves) {
    if (p.op === "typeof") continue; // 与 shape 冗余
    if (p.op === "eq") {
      if (shapeType === "number" && isIntModOne(p, self)) {
        if (!refinements.some((r) => r.kind === "int")) refinements.push({ kind: "int" });
        continue;
      }
      // eq(self, lit) 由 lit term 路径处理；无 term 时丢弃注记
      if (self && p.b.op === "lit" && termEq(p.a, self)) continue;
      if (self && p.a.op === "lit" && termEq(p.b, self)) continue;
      dropped.push(`pred not projected: ${predToString(p)}`);
      continue;
    }
    if (p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le") {
      if (shapeType === "string") {
        const lb = lengthBoundOn(p, self);
        if (lb) {
          refinements.push(lb.dir === "min" ? { kind: "strMin", n: lb.n } : { kind: "strMax", n: lb.n });
          continue;
        }
        dropped.push(`pred not projected: ${predToString(p)}`);
        continue;
      }
      const anchors: Term[] = [];
      if (self) anchors.push(self);
      // constraint 模板占位：SELF 上的数值界（instantiate 前）
      anchors.push({ op: "var", id: SELF });
      const b = numericBoundOn(p, anchors);
      if (b && (shapeType === "number" || shapeType === undefined)) {
        refinements.push({ kind: "numBound", op: b.op, n: b.n });
        continue;
      }
      dropped.push(`pred not projected: ${predToString(p)}`);
      continue;
    }
    dropped.push(`pred not projected: ${predToString(p)}`);
  }
  return { refinements, dropped };
}

/** Abs → SchemaNode + dropped 注记（尽力投影，不因单点 pred 失败而丢整个 shape） */
export function absToSchemaNode(a: Abs): { node: SchemaNode; dropped: string[] } {
  const dropped: string[] = [];

  // lit 优先
  if (a.term?.op === "lit") {
    const v = a.term.value;
    if (
      v === null ||
      v === undefined ||
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    ) {
      return { node: { k: "lit", value: v }, dropped };
    }
    if (typeof v === "bigint") {
      // dialect 侧可能无法字面量表达；仍记为 unknown + dropped
      dropped.push(`lit bigint not projected: ${String(v)}`);
      return { node: { k: "unknown" }, dropped };
    }
  }

  const s = a.shape;
  switch (s.k) {
    case "never":
      return { node: { k: "never" }, dropped };
    case "any":
    case "unknown":
      return { node: { k: "unknown" }, dropped };
    case "prim": {
      const { refinements, dropped: d } = extractPrimRefinements(a);
      dropped.push(...d);
      return { node: { k: "prim", type: s.type, refinements }, dropped };
    }
    case "obj": {
      const slots: Array<{ key: string; node: SchemaNode; optional?: boolean }> = [];
      for (const [key, slot] of Object.entries(s.slots)) {
        const sub = absToSchemaNode(slot.value);
        dropped.push(...sub.dropped.map((n) => `${key}: ${n}`));
        slots.push({
          key,
          node: sub.node,
          ...(slot.optional ? { optional: true } : {}),
        });
      }
      return { node: { k: "obj", slots }, dropped };
    }
    case "arr": {
      const sub = absToSchemaNode(s.element);
      dropped.push(...sub.dropped);
      return { node: { k: "arr", element: sub.node }, dropped };
    }
    case "tuple": {
      const elements = s.elements.map((e) => {
        const sub = absToSchemaNode(e);
        dropped.push(...sub.dropped);
        return sub.node;
      });
      return { node: { k: "tuple", elements }, dropped };
    }
    case "sum": {
      const members = s.members.map((m) => {
        const sub = absToSchemaNode(m);
        dropped.push(...sub.dropped);
        return sub.node;
      });
      return { node: { k: "union", members }, dropped };
    }
    case "fn":
      return { node: { k: "fn" }, dropped };
    case "eff": {
      if (s.eff === "promise") {
        const sub = absToSchemaNode(s.inner);
        dropped.push(...sub.dropped);
        return { node: { k: "promise", inner: sub.node }, dropped };
      }
      const sub = absToSchemaNode(s.inner);
      dropped.push(...sub.dropped);
      return { node: sub.node, dropped };
    }
    case "brand":
      return { node: { k: "brand", name: s.name }, dropped };
    default:
      return { node: { k: "unknown" }, dropped };
  }
}

// --- zod dialect ---

function zodApplyRefinements(base: string, refinements: SchemaRefinement[]): string {
  let out = base;
  const int = refinements.some((r) => r.kind === "int");
  if (int) out += ".int()";
  for (const r of refinements) {
    switch (r.kind) {
      case "numBound":
        if (r.op === "gt") out += `.gt(${r.n})`;
        else if (r.op === "ge") out += `.gte(${r.n})`;
        else if (r.op === "lt") out += `.lt(${r.n})`;
        else out += `.lte(${r.n})`;
        break;
      case "strMin":
        out += `.min(${r.n})`;
        break;
      case "strMax":
        out += `.max(${r.n})`;
        break;
      case "int":
        break; // already applied
      case "dropped":
        break;
    }
  }
  return out;
}

export function schemaNodeToZod(node: SchemaNode): string {
  switch (node.k) {
    case "lit": {
      const v = node.value;
      if (v === null) return "z.null()";
      if (v === undefined) return "z.undefined()";
      if (typeof v === "string") return `z.literal(${JSON.stringify(v)})`;
      if (typeof v === "boolean") return `z.literal(${v})`;
      if (typeof v === "number") return `z.literal(${v})`;
      return "z.unknown()";
    }
    case "prim": {
      const base = `z.${node.type}()`;
      return zodApplyRefinements(base, node.refinements);
    }
    case "obj": {
      const entries = node.slots
        .map((slot) => {
          const inner = schemaNodeToZod(slot.node);
          return `${slot.key}: ${slot.optional ? `${inner}.optional()` : inner}`;
        })
        .join(", ");
      return `z.object({ ${entries} })`;
    }
    case "arr":
      return `z.array(${schemaNodeToZod(node.element)})`;
    case "tuple":
      return `z.tuple([${node.elements.map(schemaNodeToZod).join(", ")}])`;
    case "union":
      return `z.union([${node.members.map(schemaNodeToZod).join(", ")}])`;
    case "fn":
      return "z.function()";
    case "promise":
      return `z.promise(${schemaNodeToZod(node.inner)})`;
    case "brand":
      return `z.instanceof(${node.name})`;
    case "never":
      return "z.never()";
    case "unknown":
    case "summarized":
    default:
      return "z.unknown()";
  }
}

const DIALECT_RENDERERS: Record<SchemaDialect, (n: SchemaNode) => string> = {
  zod: schemaNodeToZod,
};

export function projectAbsToSchema(
  a: Abs,
  opts?: { dialect?: SchemaDialect },
): SchemaProjection {
  const dialect: SchemaDialect = opts?.dialect ?? "zod";
  const { node, dropped } = absToSchemaNode(a);
  const render = DIALECT_RENDERERS[dialect] ?? schemaNodeToZod;
  return { source: render(node), dialect, dropped };
}

/** Abs → dialect schema 源码字符串（默认 zod）。 */
export function absToSchemaSource(a: Abs, opts?: { dialect?: SchemaDialect }): string {
  return projectAbsToSchema(a, opts).source;
}

/**
 * Abs → zod schema 源码。
 * @deprecated 请用 `absToSchemaSource(a, { dialect: "zod" })`；本别名保留至 next major。
 */
export function absToZodSchema(a: Abs): string {
  return absToSchemaSource(a, { dialect: "zod" });
}

