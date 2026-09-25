/**
 * Abs → 生态 schema 投影（单向有损）。
 *
 * 优先走 core `absToConstraint`（与 interface/check 同一投影语义），
 * 再转成中间层 SchemaNode；投影失败时退回 shape 尽力提取并记 dropped。
 * Dialect 只负责 Node → 源码字符串；Abs 才是真理源。
 */

import type { Abs, NudoConstraint, Pred, Term } from "@nudojs/core";
import { absToConstraint, isIntFlag, predToString } from "@nudojs/core";

export type SchemaDialect = "zod";

export type SchemaRefinement =
  | { kind: "numBound"; op: "gt" | "ge" | "lt" | "le"; n: number }
  | { kind: "int" }
  | { kind: "strMin"; n: number }
  | { kind: "strMax"; n: number };

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
  | { k: "unknown" };

export type SchemaProjection = {
  source: string;
  dialect: SchemaDialect;
  dropped: string[];
};

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

function isSelfVar(t: Term | undefined): boolean {
  return !!t && t.op === "var";
}

function litOf(t: Term | undefined): string | number | boolean | null | undefined {
  return t && t.op === "lit" ? t.value : undefined;
}

/** eq 的字面量端（任一侧为 lit 即可）；锚定要求另一侧是 var 或 length(var) 等简单项 */
function eqLitValue(p: Pred): string | number | boolean | null | undefined | "unanchored" {
  if (p.op !== "eq") return "unanchored";
  const aLit = litOf(p.a);
  const bLit = litOf(p.b);
  if (aLit !== undefined && (isSelfVar(p.b) || p.b.op === "app")) return aLit;
  if (bLit !== undefined && (isSelfVar(p.a) || p.a.op === "app")) return bLit;
  // 允许 eq(lit, lit) 不常见形态
  if (aLit !== undefined && bLit !== undefined) return aLit === bLit ? aLit : "unanchored";
  return "unanchored";
}

function isIntModOne(p: Pred): boolean {
  if (p.op !== "eq") return false;
  const zero = (t: Term | undefined): boolean => !!t && t.op === "lit" && t.value === 0;
  const isModOne = (t: Term | undefined): boolean =>
    !!t &&
    t.op === "app" &&
    t.fn === "%" &&
    t.args.length === 2 &&
    t.args[1]?.op === "lit" &&
    t.args[1].value === 1 &&
    (isSelfVar(t.args[0]) || t.args[0]!.op === "app");
  return (isModOne(p.a) && zero(p.b)) || (isModOne(p.b) && zero(p.a));
}

function numericBound(p: Pred, allowSelfVar: boolean): { op: "gt" | "ge" | "lt" | "le"; n: number } | "skip" | "drop" {
  if (p.op !== "gt" && p.op !== "ge" && p.op !== "lt" && p.op !== "le") return "drop";
  const n = litOf(p.b);
  if (typeof n !== "number") return "drop";
  if (p.a.op === "app" && p.a.fn === "length") return "skip"; // 交给长度路径
  if (allowSelfVar && isSelfVar(p.a)) return { op: p.op, n };
  if (p.a.op === "app" && (p.a.fn === "get" || p.a.fn === "length")) return "skip";
  return "drop";
}

function lengthBound(p: Pred): { dir: "min" | "max"; n: number } | undefined {
  if (p.op !== "gt" && p.op !== "ge" && p.op !== "lt" && p.op !== "le") return undefined;
  if (p.a.op !== "app" || p.a.fn !== "length") return undefined;
  const n = litOf(p.b);
  if (typeof n !== "number") return undefined;
  if (p.op === "ge") return { dir: "min", n: Math.ceil(n) };
  if (p.op === "gt") return { dir: "min", n: Math.floor(n) + 1 };
  if (p.op === "le") return { dir: "max", n: Math.floor(n) };
  return { dir: "max", n: Math.ceil(n) - 1 };
}

function primOfType(type: string): SchemaNode["k"] extends never ? never : Extract<SchemaNode, { k: "prim" }>["type"] {
  if (type === "number" || type === "string" || type === "boolean" || type === "bigint" || type === "symbol") {
    return type;
  }
  return "unknown" as never;
}

function refinementsFromPreds(
  preds: readonly Pred[],
  opts: { kind: "number" | "string" | "boolean" | "other" },
): { refinements: SchemaRefinement[]; eqLit?: string | number | boolean | null | undefined; dropped: string[] } {
  const refinements: SchemaRefinement[] = [];
  const dropped: string[] = [];
  let eqLit: string | number | boolean | null | undefined;
  for (const p of preds) {
    if (p.op === "typeof") continue;
    if (p.op === "eq") {
      if (opts.kind === "number" && isIntModOne(p)) {
        if (!refinements.some((r) => r.kind === "int")) refinements.push({ kind: "int" });
        continue;
      }
      const v = eqLitValue(p);
      if (v === "unanchored") {
        dropped.push(`pred not projected: ${predToString(p)}`);
        continue;
      }
      if (typeof v === "number" && Number.isNaN(v)) {
        dropped.push(`pred not projected (NaN): ${predToString(p)}`);
        continue;
      }
      if (eqLit !== undefined && eqLit !== v) {
        dropped.push(`conflicting eq preds: ${predToString(p)}`);
        continue;
      }
      eqLit = v;
      continue;
    }
    if (p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le") {
      if (opts.kind === "string") {
        const lb = lengthBound(p);
        if (lb) {
          refinements.push(lb.dir === "min" ? { kind: "strMin", n: lb.n } : { kind: "strMax", n: lb.n });
          continue;
        }
        dropped.push(`pred not projected: ${predToString(p)}`);
        continue;
      }
      const b = numericBound(p, opts.kind === "number" || opts.kind === "other");
      if (b === "skip") continue;
      if (b === "drop") {
        dropped.push(`pred not projected: ${predToString(p)}`);
        continue;
      }
      if (opts.kind === "number" || opts.kind === "other") {
        refinements.push({ kind: "numBound", op: b.op, n: b.n });
        continue;
      }
      dropped.push(`pred not projected: ${predToString(p)}`);
      continue;
    }
    dropped.push(`pred not projected: ${predToString(p)}`);
  }
  return { refinements, ...(eqLit !== undefined ? { eqLit } : {}), dropped };
}

/** NudoConstraint → SchemaNode（与 absToConstraint 投影语义对齐） */
export function constraintToSchemaNode(c: NudoConstraint): SchemaNode {
  if (c.fn) return { k: "fn" };
  if (c.members) {
    return { k: "union", members: c.members.map(constraintToSchemaNode) };
  }
  if (c.fields) {
    return {
      k: "obj",
      slots: Object.entries(c.fields).map(([key, field]) => ({
        key,
        node: constraintToSchemaNode(field.constraint),
        ...(field.optional || field.constraint.isOptional ? { optional: true } : {}),
      })),
    };
  }
  if (c.element) {
    return { k: "arr", element: constraintToSchemaNode(c.element) };
  }

  const preds = c.preds ?? [];
  const kind =
    c.prim === "number"
      ? "number"
      : c.prim === "string"
        ? "string"
        : c.prim === "boolean"
          ? "boolean"
          : c.prim
            ? "other"
            : "other";

  const { refinements, eqLit, dropped } = refinementsFromPreds(preds, { kind: kind as "number" | "string" | "boolean" | "other" });
  // eq 主导 → lit 节点（与 core projectNumber/projectString 一致）
  if (eqLit !== undefined && (kind === "number" || kind === "string" || kind === "boolean" || !c.prim)) {
    return { k: "lit", value: eqLit };
  }
  if (isIntFlag(c) && !refinements.some((r) => r.kind === "int")) {
    refinements.push({ kind: "int" });
  }
  // 不可表达 pred 不进 node；调用方用 fallback dropped
  void dropped;

  if (!c.prim) {
    // 无 prim 且无 eq：可能是 shape({}) 空字段已在 fields 分支；否则 unknown
    if (Object.keys(c.fields ?? {}).length === 0 && !c.element && !c.members) {
      return { k: "unknown" };
    }
  }
  const type = c.prim === "number" || c.prim === "string" || c.prim === "boolean" || c.prim === "bigint" || c.prim === "symbol"
    ? c.prim
    : "unknown";
  if (type === "unknown") return { k: "unknown" };
  return { k: "prim", type, refinements };
}

/** 约束投影路径下未表达的 pred（尽力收集） */
function constraintDropped(c: NudoConstraint, prefix = ""): string[] {
  const out: string[] = [];
  const visit = (n: NudoConstraint, path: string): void => {
    if (n.fields) {
      for (const [k, f] of Object.entries(n.fields)) visit(f.constraint, path ? `${path}.${k}` : k);
      return;
    }
    if (n.members) {
      n.members.forEach((m, i) => visit(m, `${path}[${i}]`));
      return;
    }
    if (n.element) {
      visit(n.element, `${path}[]`);
      return;
    }
    if (n.fn) return;
    const kind =
      n.prim === "number" ? "number" : n.prim === "string" ? "string" : n.prim === "boolean" ? "boolean" : "other";
    const { eqLit, dropped } = refinementsFromPreds(n.preds ?? [], { kind: kind as "number" | "string" | "boolean" | "other" });
    for (const d of dropped) out.push(path ? `${path}: ${d}` : d);
    if (eqLit === undefined && n.preds?.some((p) => p.op === "eq") && !isIntFlag(n)) {
      // eq 已在 refinementsFromPreds 处理
    }
  };
  visit(c, prefix);
  return out;
}

/** Abs → SchemaNode + dropped（优先 core absToConstraint；失败则 shape 尽力） */
export function absToSchemaNode(a: Abs): { node: SchemaNode; dropped: string[] } {
  const dropped: string[] = [];

  // lit term 优先（与 projection 一致；NaN 不产 lit）
  if (a.term?.op === "lit") {
    const v = a.term.value;
    if (typeof v === "number" && Number.isNaN(v)) {
      dropped.push("lit NaN not projected");
    } else if (
      v === null ||
      v === undefined ||
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    ) {
      return { node: { k: "lit", value: v }, dropped };
    } else if (typeof v === "bigint") {
      dropped.push(`lit bigint not projected: ${String(v)}`);
      return { node: { k: "unknown" }, dropped };
    }
  }

  // conf 门槛：与 core PROJECTABLE_CONF 对齐；widened 等仍尽量给 shape，但记 dropped
  const conf = a.conf;
  const lowConf = conf !== "exact" && conf !== "path";

  // 主路径：core 契约投影（eq-lit / or-lit union / bounds / shape 字段）
  const projected = absToConstraint(a);
  if (projected) {
    const node = constraintToSchemaNode(projected);
    dropped.push(...constraintDropped(projected));
    return { node, dropped };
  }

  if (lowConf) {
    dropped.push(`conf=${conf}: contract projection skipped; shape-only fallback`);
  }

  // fallback：shape 尽力 + pred 提取
  const s = a.shape;
  switch (s.k) {
    case "never":
      return { node: { k: "never" }, dropped };
    case "any":
    case "unknown":
      return { node: { k: "unknown" }, dropped };
    case "prim": {
      const kind = s.type === "number" ? "number" : s.type === "string" ? "string" : s.type === "boolean" ? "boolean" : "other";
      const leaves = predLeaves(a.pred);
      if (leaves === "unexpressible") {
        if (a.pred && a.pred.op !== "true") {
          dropped.push(`pred not projected: ${predToString(a.pred)}`);
        }
        return { node: { k: "prim", type: s.type, refinements: [] }, dropped };
      }
      const { refinements, eqLit, dropped: d } = refinementsFromPreds(leaves, { kind: kind as "number" | "string" | "boolean" | "other" });
      dropped.push(...d);
      if (eqLit !== undefined && !Number.isNaN(eqLit as number)) {
        return { node: { k: "lit", value: eqLit }, dropped };
      }
      return { node: { k: "prim", type: s.type, refinements }, dropped };
    }
    case "obj": {
      if (s.open || s.index) {
        dropped.push("open/index object not fully projected (known slots only)");
      }
      if (a.pred && a.pred.op !== "true") {
        dropped.push(`obj pred not projected: ${predToString(a.pred)}`);
      }
      const slots: Array<{ key: string; node: SchemaNode; optional?: boolean }> = [];
      for (const [key, slot] of Object.entries(s.slots)) {
        const sub = absToSchemaNode(slot.value);
        dropped.push(...sub.dropped.map((n) => `${key}: ${n}`));
        slots.push({ key, node: sub.node, ...(slot.optional ? { optional: true } : {}) });
      }
      return { node: { k: "obj", slots }, dropped };
    }
    case "arr": {
      if (a.pred && a.pred.op !== "true") {
        dropped.push(`arr pred not projected: ${predToString(a.pred)}`);
      }
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
      const inner = absToSchemaNode(s.inner);
      dropped.push(...inner.dropped);
      return {
        node: s.eff === "promise" ? { k: "promise", inner: inner.node } : inner.node,
        dropped,
      };
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
  if (refinements.some((r) => r.kind === "int")) out += ".int()";
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
      default:
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
    case "prim":
      return zodApplyRefinements(`z.${node.type}()`, node.refinements);
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
    default:
      return "z.unknown()";
  }
}

const DIALECT_RENDERERS: Record<SchemaDialect, (n: SchemaNode) => string> = {
  zod: schemaNodeToZod,
};

export function projectAbsToSchema(a: Abs, opts?: { dialect?: SchemaDialect }): SchemaProjection {
  const dialect: SchemaDialect = opts?.dialect ?? "zod";
  const { node, dropped } = absToSchemaNode(a);
  const render = DIALECT_RENDERERS[dialect] ?? schemaNodeToZod;
  return { source: render(node), dialect, dropped };
}

export function absToSchemaSource(a: Abs, opts?: { dialect?: SchemaDialect }): string {
  return projectAbsToSchema(a, opts).source;
}

export { termEq };
