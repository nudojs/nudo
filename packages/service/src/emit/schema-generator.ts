/**
 * Abs → 生态 schema 投影（单向有损）。
 *
 * 优先走 core `absToConstraint`（与 interface/check 同一投影语义），
 * 再转成中间层 SchemaNode；投影失败时退回 shape 尽力提取并记 dropped。
 * Dialect 只负责 Node → 源码字符串；Abs 才是真理源。
 *
 * 不变量：产物必须**永远可 import**——生成源码里出现的每个标识符都得在
 * 模块作用域内可解析（zod 产物只 import zod）。故 brand 名只有落在
 * 「运行时全局构造器」表里才允许进 `z.instanceof(...)`；其余降级
 * z.unknown() 并记 dropped（Bug 233）。
 */

import type { Abs, NudoConstraint, Pred, Term } from "@nudojs/core";
import { absToConstraint, isIntFlag, predToString } from "@nudojs/core";
import { formatObjectKey, toJsBindingIdent, ProjectionBudget } from "@nudojs/core/internal";
import { sanitizeLineCommentText } from "./line-comment.ts";
import { isHiddenInternalSlot, isInvisibleObjSlot } from "./internal-slot.ts";

/**
 * 不确切置信度下的**字面量观测** → 放宽到基类型（Bug 1008）。
 *
 * 「不确切」= widened（多调用点 join 出来的）/ mock（mock 值）/ partial /
 * opaque（分析没拿到确证）。这类观测里的字面量**不是**函数出口域的确证——
 * 逐字投影会把「一次兜底观测」写死成 literal（rest 形参的 `xs.length` 被
 * entry@ 兜底观测成 `1` ⇒ 三个方言把返回值投影成 `literal(1)` ⇒ 导出的
 * 校验器**拒绝被导出函数自己的返回值** ⇒ 消费方假红）。
 *
 * 放宽**只松不紧**（literal(1) → number）：不会造成假红，只少一档精度。
 * 契约面（手写契约的 `lit(42)`）走的是 pred 通道（term 是 var 而非 lit），
 * 不受此规则影响 ⇒ 字面量精度保留。
 *
 * 不在 `emit/index.ts` 的导出清单里（内部工具，非公开 API）。
 */
export function widenUncertainLiteral(a: Abs): Abs | undefined {
  if (a.term?.op !== "lit") return undefined;
  const conf = a.conf;
  if (conf !== "widened" && conf !== "mock" && conf !== "partial" && conf !== "opaque") return undefined;
  const s = a.shape;
  if (s.k !== "prim") return undefined;
  if (s.type !== "number" && s.type !== "string" && s.type !== "boolean") return undefined;
  // 去掉字面量 term（保留 shape / pred）⇒ 投影面按基类型渲染
  return { ...a, term: undefined };
}

export type SchemaDialect = "zod";

export type SchemaRefinement =
  | { kind: "numBound"; op: "gt" | "ge" | "lt" | "le"; n: number }
  | { kind: "int" }
  | { kind: "strMin"; n: number }
  | { kind: "strMax"; n: number };

/** 规范数组下标（"0" / "12"；无前导零）——数组视图的元素槽判据（BUG-258） */
const CANONICAL_INDEX = /^(?:0|[1-9]\d*)$/;

export type SchemaNode =
  | { k: "lit"; value: import("@nudojs/core").LiteralValue }
  | { k: "prim"; type: "number" | "string" | "boolean" | "bigint" | "symbol"; refinements: SchemaRefinement[] }
  // BUG-258：`arrayView` = 数组视图（`Shape.view === "array"`，RegExpExecArray
  // 等）——承载的槽（下标 / length / index / input / groups）与普通对象相同，
  // 但运行时**必须**是数组 ⇒ zod 面用 `z.tuple`（`z.object` 会按对象校验）。
  | { k: "obj"; slots: Array<{ key: string; node: SchemaNode; optional?: boolean }>; arrayView?: boolean }
  // BUG-094：数组**自身**的长度界（`array(T).min(n)` / `.max(n)`）此前无处承载
  // ⇒ zod / standard 面整段丢掉长度域、guard 面保留 ⇒ 跨面矛盾 + 零台账。
  | { k: "arr"; element: SchemaNode; minLen?: number; maxLen?: number }
  | { k: "tuple"; elements: SchemaNode[]; rest?: SchemaNode }
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

function isSelfVar(t: Term | undefined, self?: Term): boolean {
  if (!t || t.op !== "var") return false;
  if (t.id === "__nudo_self__") return true;
  if (self && self.op === "var") return t.id === self.id;
  return false;
}

/** length 参数是否锚定 self（length(self) / length(__nudo_self__)） */
function isLengthSelf(t: Term | undefined, self?: Term): boolean {
  if (!t) return false;
  if (t.op === "var") return isSelfVar(t, self);
  return false;
}

type LitOfResult =
  | { ok: true; value: import("@nudojs/core").LiteralValue }
  | { ok: false };

/** tagged：把「无字面量」与「字面量 undefined」分开（同 core litValue）。 */
function litOf(t: Term | undefined): LitOfResult {
  return t && t.op === "lit" ? { ok: true, value: t.value } : { ok: false };
}

/** eq 的字面量端（任一侧为 lit 即可）；锚定要求另一侧是 self var（与 core anchoredEqLit 同口径）。
 *  裸 app（length(other)、get(self,"x") 等）不是 self 锚定——length(self) 约束应走 length 路径，
 *  否则 eq(length(s),5) 会错投影成 z.literal(5)。 */
function eqLitValue(p: Pred, self?: Term): import("@nudojs/core").LiteralValue | "unanchored" {
  if (p.op !== "eq") return "unanchored";
  const aLit = litOf(p.a);
  const evalLit = litOf(p.b);
  if (aLit.ok && isSelfVar(p.b, self)) return aLit.value;
  if (evalLit.ok && isSelfVar(p.a, self)) return evalLit.value;
  // 允许 eq(lit, lit) 不常见形态
  if (aLit.ok && evalLit.ok) return aLit.value === evalLit.value ? aLit.value : "unanchored";
  return "unanchored";
}

function isIntModOne(p: Pred, self?: Term): boolean {
  if (p.op !== "eq") return false;
  const zero = (t: Term | undefined): boolean => !!t && t.op === "lit" && t.value === 0;
  const isModOne = (t: Term | undefined): boolean =>
    !!t &&
    t.op === "app" &&
    t.fn === "%" &&
    t.args.length === 2 &&
    t.args[1]?.op === "lit" &&
    t.args[1].value === 1 &&
    isSelfVar(t.args[0], self);
  return (isModOne(p.a) && zero(p.b)) || (isModOne(p.b) && zero(p.a));
}

function numericBound(p: Pred, self: Term | undefined, allowSelfVar: boolean): { op: "gt" | "ge" | "lt" | "le"; n: number } | "skip" | "drop" {
  if (p.op !== "gt" && p.op !== "ge" && p.op !== "lt" && p.op !== "le") return "drop";
  const nR = litOf(p.b);
  const n = nR.ok ? nR.value : undefined;
  if (typeof n !== "number") return "drop";
  // 非有限界（NaN/±Infinity）不进生成源（.gt(NaN) 恒假且不可表达）——
  // 与 eq 通道 NaN 处理对称：drop 即调用方记 "pred not projected"
  if (!Number.isFinite(n)) return "drop";
  if (p.a.op === "app" && p.a.fn === "length") return "skip"; // 交给长度路径
  if (allowSelfVar && isSelfVar(p.a, self)) return { op: p.op, n };
  if (p.a.op === "app" && (p.a.fn === "get" || p.a.fn === "length")) return "skip";
  return "drop";
}

function lengthBound(p: Pred, self?: Term): { dir: "min" | "max"; n: number } | undefined {
  if (p.op !== "gt" && p.op !== "ge" && p.op !== "lt" && p.op !== "le") return undefined;
  if (p.a.op !== "app" || p.a.fn !== "length") return undefined;
  if (!isLengthSelf(p.a.args[0], self)) return undefined;
  const nR = litOf(p.b);
  const n = nR.ok ? nR.value : undefined;
  if (typeof n !== "number") return undefined;
  if (!Number.isFinite(n)) return undefined; // 非有限界不进 strMin/strMax
  if (p.op === "ge") return { dir: "min", n: Math.ceil(n) };
  if (p.op === "gt") return { dir: "min", n: Math.floor(n) + 1 };
  if (p.op === "le") return { dir: "max", n: Math.floor(n) };
  return { dir: "max", n: Math.ceil(n) - 1 };
}

/**
 * BUG-094：数组**自身**的长度界（`length(self) op n`）→ `minLen` / `maxLen`。
 *
 * 两条投影路径（约束 `c.element` 分支 / 形状兜底）此前都直接 `return` 元素节点
 * ⇒ 数组级 preds 静默消失（zod / standard 面放行违约数组）且**零 dropped 台账**
 * ⇒ 与 guard 面矛盾。不可投影的数组级 pred 一律进 `dropped`（有损必须可观测）。
 */
function arrayLengthBounds(
  preds: Pred | readonly Pred[] | undefined,
  self: Term | undefined,
): { minLen?: number; maxLen?: number; dropped: string[] } {
  const dropped: string[] = [];
  let minLen: number | undefined;
  let maxLen: number | undefined;
  // 单条 pred 可能是 and 链（Abs 面）⇒ 先展平；展不平的（or/not）原样记账
  const list = preds === undefined ? [] : Array.isArray(preds) ? preds : [preds];
  const leaves: Pred[] = [];
  for (const p of list) {
    const sub = predLeaves(p);
    if (sub === "unexpressible") leaves.push(p);
    else leaves.push(...sub);
  }
  for (const p of leaves) {
    if (p.op === "true" || p.op === "typeof") continue;
    const lb = lengthBound(p, self);
    if (!lb) {
      dropped.push(`pred not projected: ${predToString(p)}`);
      continue;
    }
    if (lb.dir === "min") minLen = minLen === undefined ? lb.n : Math.max(minLen, lb.n);
    else maxLen = maxLen === undefined ? lb.n : Math.min(maxLen, lb.n);
  }
  return { minLen, maxLen, dropped };
}

function primOfType(type: string): SchemaNode["k"] extends never ? never : Extract<SchemaNode, { k: "prim" }>["type"] {
  if (type === "number" || type === "string" || type === "boolean" || type === "bigint" || type === "symbol") {
    return type;
  }
  return "unknown" as never;
}

function refinementsFromPreds(
  preds: readonly Pred[],
  opts: { kind: "number" | "string" | "boolean" | "other"; self?: Term },
): { refinements: SchemaRefinement[]; eqLit?: import("@nudojs/core").LiteralValue; hasEqLit: boolean; dropped: string[] } {
  const refinements: SchemaRefinement[] = [];
  const dropped: string[] = [];
  const self = opts.self;
  let eqLit: import("@nudojs/core").LiteralValue | undefined = undefined;
  let hasEqLit = false;
  for (const p of preds) {
    if (p.op === "typeof") continue;
    if (p.op === "eq") {
      if (opts.kind === "number" && isIntModOne(p, self)) {
        if (!refinements.some((r) => r.kind === "int")) refinements.push({ kind: "int" });
        continue;
      }
      const v = eqLitValue(p, self);
      if (v === "unanchored") {
        dropped.push(`pred not projected: ${predToString(p)}`);
        continue;
      }
      if (typeof v === "number" && Number.isNaN(v)) {
        dropped.push(`pred not projected (NaN): ${predToString(p)}`);
        continue;
      }
      if (hasEqLit && !Object.is(eqLit, v)) {
        dropped.push(`conflicting eq preds: ${predToString(p)}`);
        continue;
      }
      eqLit = v;
      hasEqLit = true;
      continue;
    }
    if (p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le") {
      if (opts.kind === "string") {
        const lb = lengthBound(p, self);
        if (lb) {
          refinements.push(lb.dir === "min" ? { kind: "strMin", n: lb.n } : { kind: "strMax", n: lb.n });
          continue;
        }
        dropped.push(`pred not projected: ${predToString(p)}`);
        continue;
      }
      const b = numericBound(p, self, opts.kind === "number" || opts.kind === "other");
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
  // hasEqLit 是「有 eq」的 tagged 判据（BUG-019/S6-004）：eqLit 值域含
  // undefined，`eqLit !== undefined` 哨兵会把 eq(x, lit(undefined)) 静默
  // 吞掉——历史 litValue tagged 化修过 4 次，本通道是汇总残留。
  return { refinements, ...(hasEqLit ? { eqLit } : {}), hasEqLit, dropped };
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
    // BUG-094：数组级 preds（`length(self) op n`）必须落进节点——此前直接
    // `return` 元素节点 ⇒ 长度域整段丢失（zod / standard 面放行违约数组）。
    const { minLen, maxLen } = arrayLengthBounds(c.preds, undefined);
    return {
      k: "arr",
      element: constraintToSchemaNode(c.element),
      ...(minLen !== undefined ? { minLen } : {}),
      ...(maxLen !== undefined ? { maxLen } : {}),
    };
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

  const { refinements, eqLit, hasEqLit, dropped } = refinementsFromPreds(preds, {
    kind: kind as "number" | "string" | "boolean" | "other",
    // constraint 路径：absToConstraint 已把 self 改写成 __nudo_self__
  });
  // eq 主导 → lit 节点（与 core projectNumber/projectString 一致；
  // hasEqLit 为 tagged 判据——eq(x, lit(undefined)) → z.undefined()）
  if (hasEqLit && (kind === "number" || kind === "string" || kind === "boolean" || !c.prim)) {
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
      // BUG-094：数组级 preds 也要进台账（不可投影的长度界 / 其它 pred）。
      // 投影进 `minLen` / `maxLen` 的不记账；其余逐条记 —— 有损投影必须可观测。
      const bounds = arrayLengthBounds(n.preds, undefined);
      for (const d of bounds.dropped) out.push(path ? `${path}: ${d}` : d);
      visit(n.element, `${path}[]`);
      return;
    }
    if (n.fn) return;
    const kind =
      n.prim === "number" ? "number" : n.prim === "string" ? "string" : n.prim === "boolean" ? "boolean" : "other";
    const { dropped } = refinementsFromPreds(n.preds ?? [], {
      kind: kind as "number" | "string" | "boolean" | "other",
    });
    for (const d of dropped) out.push(path ? `${path}: ${d}` : d);
  };
  visit(c, prefix);
  return out;
}

/** Abs → SchemaNode + dropped（优先 core absToConstraint；失败则 shape 尽力） */
export function absToSchemaNode(a: Abs): { node: SchemaNode; dropped: string[] } {
  return absToSchemaNodeB(a, new ProjectionBudget());
}

function absToSchemaNodeB(a: Abs, budget: ProjectionBudget): { node: SchemaNode; dropped: string[] } {
  const dropped: string[] = [];

  // Bug 1008：不确切置信度的字面量观测**不是**出口域 ⇒ 放宽到基类型
  // （放宽只松不紧 ⇒ 不会假红）。契约面（pred 通道）不受影响。
  const widened = widenUncertainLiteral(a);
  if (widened) {
    dropped.push(`literal observation widened to the base type (uncertain confidence: ${a.conf})`);
    a = widened;
  }

  // lit term 优先（与 projection 一致；NaN 不产 lit）
  if (a.term?.op === "lit") {
    const v = a.term.value;
    if (typeof v === "number" && Number.isNaN(v)) {
      dropped.push("lit NaN not projected (widened to the number domain)");
    } else if (
      v === null ||
      v === undefined ||
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean"
    ) {
      return { node: { k: "lit", value: v }, dropped };
    } else if (typeof v === "bigint") {
      // BUG-032：bigint 字面量保**基类型**（`z.bigint()` / `{"k":"prim","type":"bigint"}`）。
      // 退化成 `unknown` 会让 zod / standard 两个方言接受**任何**值（字符串 /
      // 对象 / 数字都行）⇒ 校验器与 guard 面（`data === 10n`）接受集不相交。
      // 字面量精度另记台账（有损投影必须可观测）。
      dropped.push(`lit bigint not projected: ${String(v)}`);
      return { node: { k: "prim", type: "bigint", refinements: [] }, dropped };
    }
  }

  // conf 门槛：与 core PROJECTABLE_CONF 对齐；widened 等仍尽量给 shape，但记 dropped
  const conf = a.conf;
  const lowConf = conf !== "exact" && conf !== "path";

  // 主路径：core 契约投影（eq-lit / or-lit union / bounds / shape 字段）。
  // 共享预算（DESIGN-001）：absToConstraint 自管 enter/exit——环 / 超深返回
  // undefined（不可表达），落到下方 shape 尽力路径。
  const projected = absToConstraint(a, budget);
  if (projected) {
    let node = constraintToSchemaNode(projected);
    // BUG-094：core 的 `projectArr` 只投影元素域，**不承载数组自身的 preds**
    // ⇒ 长度界在契约通道上整段消失。这里按 Abs 自身的 preds 补挂长度界，
    // 并把它表达不了的数组级 pred 记进 dropped（与形状兜底同口径）。
    if (node.k === "arr" && a.shape.k === "arr") {
      const bounds = arrayLengthBounds(a.pred, a.term);
      dropped.push(...bounds.dropped);
      if (bounds.minLen !== undefined || bounds.maxLen !== undefined) {
        node = {
          ...node,
          ...(bounds.minLen !== undefined ? { minLen: bounds.minLen } : {}),
          ...(bounds.maxLen !== undefined ? { maxLen: bounds.maxLen } : {}),
        };
      }
    }
    // BUG-130 / BUG-131：core 的约束投影（`projectObj`）只剔 `internal` 槽，
    // **不看 `symbolKey`**、也保留「数字下标」例外 ⇒ symbol 槽与生成器元素槽
    // 仍会以字符串字段进产物（运行时不存在的属性 / 生成器没有任何自有属性）。
    // 这里按 Abs 槽表把不可见槽从节点上摘掉（与形状兜底路径同判据）。
    if (node.k === "obj" && a.shape.k === "obj") {
      const objSlots = a.shape.slots;
      node = {
        ...node,
        slots: node.slots.filter((s) => {
          const slot = objSlots[s.key];
          if (!slot) return true;
          const hidden = isInvisibleObjSlot(s.key, slot, objSlots);
          if (hidden) dropped.push(`${s.key}: hidden slot not projected (symbol/internal key)`);
          return !hidden;
        }),
      };
    }
    dropped.push(...constraintDropped(projected));
    return { node, dropped };
  }

  if (lowConf) {
    dropped.push(`conf=${conf}: contract projection skipped; shape-only fallback`);
  }

  // fallback：shape 尽力 + pred 提取；预算在此接管（环 / 超深 → unknown + 台账）
  const stop = budget.enter(a);
  if (stop) {
    dropped.push(`shape truncated (${stop}) projected as unknown`);
    return { node: { k: "unknown" }, dropped };
  }
  try {
    return absToSchemaShape(a, budget, dropped);
  } finally {
    budget.exit();
  }
}

function absToSchemaShape(a: Abs, budget: ProjectionBudget, dropped: string[]): { node: SchemaNode; dropped: string[] } {
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
      const { refinements, eqLit, hasEqLit, dropped: d } = refinementsFromPreds(leaves, {
        kind: kind as "number" | "string" | "boolean" | "other",
        self: a.term,
      });
      dropped.push(...d);
      // hasEqLit 为 tagged 判据（BUG-019）；NaN eq 已在通道内 drop 记录，
      // 防御性 !isNaN 只挡 NaN（不再误挡 undefined）
      if (hasEqLit && (eqLit === undefined || !Number.isNaN(eqLit as number))) {
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
        // Bug 240 / BUG-130 / BUG-131：symbol 槽与生成器元素槽不是自有属性 ⇒
        // 不进产物面（与 core 的约束面 / guard 面 / format 面同判据；判据见
        // `internal-slot.ts`）。约束投影（`absToConstraint`）漏掉的槽在此兜住。
        if (isInvisibleObjSlot(key, slot, s.slots)) continue;
        const sub = absToSchemaNodeB(slot.value, budget);
        dropped.push(...sub.dropped.map((n) => `${key}: ${n}`));
        slots.push({ key, node: sub.node, ...(slot.optional ? { optional: true } : {}) });
      }
      return {
        node: {
          k: "obj",
          slots,
          // BUG-258：数组视图 facet 必须进节点——丢了它，zod 面就按
          // `z.object({...})` 校验真实数组（拒绝实现自己的返回值）。
          ...(s.view === "array" ? { arrayView: true } : {}),
        },
        dropped,
      };
    }
    case "arr": {
      // BUG-094：数组自身 preds → minLen / maxLen；表达不了的进台账（不静默丢）
      const bounds = arrayLengthBounds(a.pred, a.term);
      dropped.push(...bounds.dropped);
      const sub = absToSchemaNodeB(s.element, budget);
      dropped.push(...sub.dropped);
      return {
        node: {
          k: "arr",
          element: sub.node,
          ...(bounds.minLen !== undefined ? { minLen: bounds.minLen } : {}),
          ...(bounds.maxLen !== undefined ? { maxLen: bounds.maxLen } : {}),
        },
        dropped,
      };
    }
    case "tuple": {
      // hole 槽（`in` 为 false）≠ 显式 undefined 槽。zod tuple 无空槽概念，
      // 映射 z.unknown() 而非 z.undefined()，并把洞记入 dropped（有损投影台账）。
      const holes = s.holes ?? [];
      const elements = s.elements.map((e, i) => {
        if (holes.includes(i)) {
          dropped.push(`tuple hole at ${i} not projected (slot absent ≠ undefined)`);
          return { k: "unknown" } as const;
        }
        const sub = absToSchemaNodeB(e, budget);
        dropped.push(...sub.dropped);
        return sub.node;
      });
      // rest 槽（`[1, ...number]`）：SchemaNode 携带（standard-schema 据此校验超长元素），
      // zod 渲染 `.rest(...)`——不得静默丢弃（有损投影必须可观测）
      let rest: SchemaNode | undefined;
      if (s.rest) {
        const sub = absToSchemaNodeB(s.rest, budget);
        dropped.push(...sub.dropped);
        rest = sub.node;
      }
      return { node: { k: "tuple", elements, ...(rest ? { rest } : {}) }, dropped };
    }
    case "sum": {
      const members = s.members.map((m) => {
        const sub = absToSchemaNodeB(m, budget);
        dropped.push(...sub.dropped);
        return sub.node;
      });
      return { node: { k: "union", members }, dropped };
    }
    case "fn":
      return { node: { k: "fn" }, dropped };
    case "eff": {
      const inner = absToSchemaNodeB(s.inner, budget);
      dropped.push(...inner.dropped);
      return {
        node: s.eff === "promise" ? { k: "promise", inner: inner.node } : inner.node,
        dropped,
      };
    }
    case "brand":
      // Bug 233：brand 名不等于运行时值时**不得**走 z.instanceof——brand 名
      // 原样当标识符插进产物，模块求值期即抛 ReferenceError，整个产物作废
      // （GeneratorFunction / AsyncGeneratorFunction / 用户类名 / X.prototype …）。
      // 降级 z.unknown()（放行不拒收）并把损失记进 dropped 台账。
      if (!isRuntimeGlobalCtorName(s.name)) {
        dropped.push(`brand not projected (no runtime constructor): ${s.name}`);
        return { node: { k: "unknown" }, dropped };
      }
      return { node: { k: "brand", name: s.name }, dropped };
    default:
      return { node: { k: "unknown" }, dropped };
  }
}

// --- zod dialect ---

/**
 * 生成模块里可直接引用的**运行时全局构造器名**。
 *
 * zod 产物是一个独立模块（只 import zod），因此 `z.instanceof(X)` 的实参 X
 * 只能是该模块作用域内可解析的绑定——即全局。brand 名若是「没有运行时值的
 * 名字」（GeneratorFunction / AsyncGeneratorFunction / Intl.* / 用户类名 /
 * `X.prototype` / `Object.prototype` …），原样插进产物会让模块**求值即抛**
 * ReferenceError（Bug 233：整个 zod 产物作废，一个校验器都拿不到）。
 *
 * 只收「全局 + 可当构造器用」的名字：Proxy / Math / JSON / Reflect / Intl /
 * Atomics 是全局但**不是构造器**（`x instanceof Proxy` 抛 TypeError），
 * 不收——`z.instanceof` 的实参在模块求值期求值，非构造器同样炸。
 */
const RUNTIME_GLOBAL_CTOR_NAMES: ReadonlySet<string> = new Set([
  "Array", "Object", "Function", "Boolean", "Number", "String", "Symbol", "BigInt",
  "Date", "RegExp",
  "Error", "EvalError", "RangeError", "ReferenceError", "SyntaxError",
  "TypeError", "URIError", "AggregateError",
  "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "FinalizationRegistry",
  "Promise",
  "ArrayBuffer", "SharedArrayBuffer", "DataView",
  "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
  "Int32Array", "Uint32Array", "Float32Array", "Float64Array",
  "BigInt64Array", "BigUint64Array",
  "URL", "URLSearchParams", "TextEncoder", "TextDecoder",
]);

/**
 * brand 名能否用 `z.instanceof(<name>)` 表达（须是运行时全局构造器名）。
 *
 * 同名单也是 **dts 面的 TS 全局类型名名单**（族 15 S11 的 zod 白名单同源）：
 * 这些名字在 TS 里是环境内建类型名（Date / RegExp / Error / URL …）⇒ 产物里
 * 原样引用即可，无需声明（dts 面见 `dts-generator.ts` 的 `brandTSType`）。
 */
export function isRuntimeGlobalCtorName(name: string): boolean {
  return RUNTIME_GLOBAL_CTOR_NAMES.has(name);
}

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
        // BUG-203：Abs 的长度语义 = `length(x)`（**UTF-16 码元**，与 JS
        // `.length` / guard 面 `data.length >= n` / standard 面 `strMin` 同源），
        // 而 zod v4 的 `.min()/.max()` 按 **Unicode 码点**计 ⇒ 含星平面字符时
        // zod 面与另外三面裁决相反（min 假红 / max 假绿）。
        // ⇒ 用 `refine` 显式写 UTF-16 长度，不得直接映射 `.min()/.max()`。
        out += `.refine((s) => s.length >= ${r.n})`;
        break;
      case "strMax":
        out += `.refine((s) => s.length <= ${r.n})`;
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * BUG-093：带 refinement 的 number prim 里，**哪些非有限值仍满足全部 refinement**
 * ⇒ 追加 `.or(z.literal(±Infinity))`（保留 refinement 语义，不退化成 `z.number()`）。
 *
 * 判据逐条按运行时语义求值（与 standard 面的 `numBound` 实现同判据）：
 * - `int`（`Number.isInteger`）对 ±Infinity 为假 ⇒ 整个不放宽；
 * - `numBound`（`gt/ge/lt/le`）对 ±Infinity 按数学比较 ⇒ `gt/ge` 只允许
 *   `+Infinity`、`lt/le` 只允许 `-Infinity`；
 * - 其余 refinement（`strMin/strMax`）对 number 不适用（standard 面亦不检查）⇒ 不影响。
 */
function widenZodNumberInfinities(refinements: SchemaRefinement[], source: string): string {
  if (refinements.some((r) => r.kind === "int")) return source;
  const bounds = refinements.filter(
    (r): r is Extract<SchemaRefinement, { kind: "numBound" }> => r.kind === "numBound",
  );
  if (bounds.length === 0) return source;
  const satisfies = (v: number): boolean =>
    bounds.every((r) => {
      if (r.op === "gt") return v > r.n;
      if (r.op === "ge") return v >= r.n;
      if (r.op === "lt") return v < r.n;
      return v <= r.n;
    });
  let out = source;
  if (satisfies(Infinity)) out += ".or(z.literal(Infinity))";
  if (satisfies(-Infinity)) out += ".or(z.literal(-Infinity))";
  return out;
}

/**
 * 字面量值的安全描述（**不抛**、bigint 带 `n` 后缀）——降级台账用。
 */
function describeLitValue(v: unknown): string {
  try {
    if (typeof v === "bigint") return `${v.toString()}n`;
    if (typeof v === "string") return JSON.stringify(v);
    if (typeof v === "symbol") return v.toString();
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    if (typeof v === "number" && Number.isNaN(v)) return "NaN";
    return String(v);
  } catch {
    return "<unserializable>";
  }
}

/**
 * zod 方言渲染（内部）：返回**源码 + 渲染层自己的降级台账**。
 *
 * 不变量（Bug 1046）：**渲染层不得把可表达的形态静默放宽成 `z.unknown()`** ——
 * 降级必须**留痕**（进 `dropped` ⇒ 出现在产物的
 * `// dropped preds (not projected into zod):` 块里 ⇒ 用户可见）。
 *
 * 两层台账各管一段：节点层（`absToSchemaNode`）管「Abs → 节点」的损失；
 * 这里管「节点 → zod 源码」的损失。改前 bigint 契约字面量恰好**两层都失声**：
 * 节点层认为「投影成功」（节点是 `{k:"lit",value:1n}`）⇒ 不进 dropped；
 * 渲染层认不出 bigint 的 lit ⇒ 静默 `z.unknown()` ⇒ **零台账 + 假绿**
 * ⇒ 与 standard / guard 面的接受集自相矛盾。
 */
function renderZod(node: SchemaNode): { source: string; dropped: string[] } {
  switch (node.k) {
    case "lit": {
      const v = node.value;
      if (v === null) return { source: "z.null()", dropped: [] };
      if (v === undefined) return { source: "z.undefined()", dropped: [] };
      if (typeof v === "string") return { source: `z.literal(${JSON.stringify(v)})`, dropped: [] };
      if (typeof v === "boolean") return { source: `z.literal(${v})`, dropped: [] };
      if (typeof v === "number") {
        // Bug 1065：`-0` 与 `0` 身份不同（Object.is / 1/x 可观察），而
        // `String(-0) === "0"` ⇒ 负号被抹掉 ⇒ 产物写 `z.literal(0)`
        // ⇒ **比门禁宽**（门禁按 `lit(-0)` 判红、zod 放行 `0`）⇒ 假绿。
        // ⇒ 这里必须**保真**写 `-0`（不许静默放宽成 `0`）。
        // ⚠ zod 的 literal 走 `===` 口径 ⇒ `-0` 与 `0` 在运行时**不可区分**
        // ⇒ 该处**已知有损** ⇒ 就地标注（消费方看得见），不许无声无息。
        // （zod 运行时行为本次**未独立复现**——环境无 zod 依赖。）
        if (Object.is(v, -0)) {
          return {
            source:
              "z.literal(-0) /* known lossy: zod literal uses ===, so -0 and 0 are indistinguishable at runtime */",
            dropped: [],
          };
        }
        return { source: `z.literal(${v})`, dropped: [] };
      }
      // Bug 1046：bigint 字面量——zod 的 `z.literal` **原生支持 bigint**
      // （真 zod v4.6.7 实测：`z.literal(10n)` 收 10n、拒 10 / 42 / "x" / null）。
      // 改前此处落到兜底 `z.unknown()` ⇒ **契约申报的 bigint 被静默放宽**（假绿）
      // 且**零台账**（节点已是「投影成功」的 lit 节点 ⇒ 不进 dropped）⇒ 与
      // standard 面（`{"k":"lit","value":1n}` 保真）**接受集不相交**。
      if (typeof v === "bigint") {
        return { source: `z.literal(${v.toString()}n)`, dropped: [] };
      }
      // 兜底：字面量值域超出 `LiteralValue`（类型外的运行期值）⇒ 降级 + **留痕**
      // （静默放宽 = 假绿 ⇒ 降级必须可观测）。
      return {
        source: "z.unknown()",
        dropped: [`lit not projected: ${describeLitValue(v)}`],
      };
    }
    case "prim":
      // Bug 1001：Abs 的 `number` prim 域 = **全部 JS number**（含 NaN / ±Infinity）
      // ——`typeof v === "number"` 对 NaN / Infinity 都成立（standard / guard 面
      // 同口径，门禁面也渲染 `nanZero() => NaN`）。而 zod 的 `z.number()`
      // **只收有限数**（v4 的 parse：`!Number.isNaN(input) && Number.isFinite(input)`）
      // ⇒ 直接 `z.number()` 是**收窄**映射（不是合法超近似）⇒ 导出的 schema
      // **拒绝被导出函数自己的返回值**（`nanZero()` 恒返 NaN）⇒ 消费方假红。
      // 放宽成「有限数 ∪ NaN ∪ ±Infinity」。
      //
      // 带 refinement 的 number **不一律**放宽（见下方 BUG-093 的逐条判定）。
      if (node.type === "number" && node.refinements.length === 0) {
        return {
          source: "z.number().or(z.nan()).or(z.literal(Infinity)).or(z.literal(-Infinity))",
          dropped: [],
        };
      }
      // BUG-093：只有 `int`（`Number.isInteger`）真的排除非有限值。`gt / ge /
      // lt / le` 对 ±Infinity **按数学语义成立**（`Infinity > 5` 为真、
      // `-Infinity < 5` 也为真）⇒ 不放宽就是**收窄**：`number().gt(0)` 的 zod 面
      // 拒绝 `Infinity`（被导出函数自己的返回值）而 guard / standard / dts 三面
      // 接受 ⇒ 假红。逐条按「该端是否满足全部 numBound」判定，只放宽真正允许的
      // 那一端（`lt(n)` 只放宽 `-Infinity`，不把违约的 `Infinity` 放进来）；
      // NaN 不放宽——任何 numBound 对 NaN 都为假（与 guard / standard 同判据）。
      return {
        source: widenZodNumberInfinities(
          node.refinements,
          zodApplyRefinements(`z.${node.type}()`, node.refinements),
        ),
        dropped: [],
      };
    case "obj": {
      const dropped: string[] = [];
      // BUG-258：**数组视图**（RegExpExecArray 等）→ `z.tuple([...])`。
      // `z.object({...})` 把真实数组按对象校验 ⇒ zod 面拒绝实现自己的返回值，
      // 而 guard / standard / dts 三面都判定它是数组。`z.tuple` 自带
      // `Array.isArray` + 定长 + 逐位校验 ⇒ 四面同判据。
      // - `length` 由元组长度隐含（在 exec 结果上与下标槽数恒相等）；
      // - 其余非下标槽（`index` / `input` / `groups`）`z.tuple` 不校验，进台账
      //   （不静默丢：guard / standard 面仍逐槽判）。
      if (node.arrayView) {
        const idx = node.slots
          .filter((slot) => CANONICAL_INDEX.test(slot.key))
          .sort((x, y) => Number(x.key) - Number(y.key));
        const last = idx.length > 0 ? Number(idx[idx.length - 1]!.key) : -1;
        const elements: string[] = [];
        let holes = false;
        for (let i = 0; i <= last; i++) {
          const slot = idx.find((s) => Number(s.key) === i);
          if (slot === undefined) {
            // 洞位（缺下标槽）：元组无空槽语法 ⇒ 不校验该位。
            elements.push("z.unknown()");
            holes = true;
            continue;
          }
          const inner = renderZod(slot.node);
          dropped.push(...inner.dropped);
          elements.push(inner.source);
        }
        if (holes) dropped.push("array view: hole slots rendered as z.unknown()");
        const sideKeys = node.slots
          .filter((slot) => !CANONICAL_INDEX.test(slot.key) && slot.key !== "length")
          .map((slot) => slot.key);
        if (sideKeys.length > 0) {
          dropped.push(
            `array view: non-index slots not validated by z.tuple (${sideKeys.join(", ")})`,
          );
        }
        return {
          source: elements.length > 0 ? `z.tuple([${elements.join(", ")}])` : "z.array(z.unknown())",
          dropped,
        };
      }
      // BUG-156：zod v4 在 shape 阶段对 `__proto__` **整条跳过**
      // （`if (key === "__proto__") continue;`）⇒ 声明的必填字段**从不被校验**
      // ⇒ 违约值被静默放行（假绿），而 dts / guard / standard 三面都要求它。
      // 故把该槽剔出 shape，改用 `.superRefine()` 显式校验**自有数据属性**。
      const protoSlots: Array<{ key: string; node: SchemaNode; optional?: boolean }> = [];
      const entries = node.slots
        .filter((slot) => (slot.key === "__proto__" ? (protoSlots.push(slot), false) : true))
        .map((slot) => {
          const inner = renderZod(slot.node);
          dropped.push(...inner.dropped);
          // 非标识符键必须 JSON 引号，否则生成非法 JS（foo-bar / a b / 1x）
          const key = formatJsObjectKey(slot.key);
          return `${key}: ${slot.optional ? `${inner.source}.optional()` : inner.source}`;
        })
        .join(", ");
      let source = `z.object({ ${entries} })`;
      // BUG-096：键存在性口径三面统一 —— 规则是「自有属性 或 原型链上的键，
      // 但 `Object.prototype` 自身的成员（污染键 `toString` / `valueOf` /
      // `constructor` / `hasOwnProperty` …）不算在场」。guard 面
      // （core `denote.ts` 的 `hasPropertyClause`）与 standard 面
      // （`standard-schema.ts` 的 `hasProperty` / `__nudoHasProperty`）都按
      // 这条子句判；`z.object` 原生按 `in` 判在场（含 Object.prototype 成员）
      // ⇒ 槽名撞污染键时 zod 比另两面**松**（`Object.create({ toString: "s" })`
      // 被放行）。这里用 `.superRefine` 补上同一条子句 ⇒ 三面逐值同裁决。
      //
      // 只对**必填**的污染键槽补：其余键 `!(k in Object.prototype)` ⇒ 子句
      // 退化成 `k in value`（即 zod 原生判据），无需额外代码。
      for (const slot of node.slots) {
        if (slot.optional) continue;
        if (!Object.hasOwn(Object.prototype, slot.key)) continue;
        const k = JSON.stringify(slot.key);
        source +=
          `\n  .superRefine((value, ctx) => {\n` +
          `    if (!(Object.hasOwn(value, ${k}) || (${k} in value && !Object.hasOwn(Object.prototype, ${k})))) {\n` +
          `      ctx.addIssue({ code: "custom", message: "required", path: [${k}] });\n` +
          `    }\n` +
          `  })`;
      }
      for (const slot of protoSlots) {
        const inner = renderZod(slot.node);
        dropped.push(...inner.dropped);
        dropped.push(
          `__proto__: zod v4 skips this key in object shapes ⇒ validated via .superRefine (own data property only)`,
        );
        source +=
          `\n  .superRefine((value, ctx) => {\n` +
          `    const desc = Object.getOwnPropertyDescriptor(value, "__proto__");\n` +
          (slot.optional
            ? `    if (!desc) return;\n`
            : `    if (!desc) { ctx.addIssue({ code: "custom", message: "required", path: ["__proto__"] }); return; }\n`) +
          `    const parsed = (${inner.source}).safeParse(desc.value);\n` +
          `    if (!parsed.success) ctx.addIssue({ code: "custom", message: parsed.error.issues.map((i) => i.message).join("; ") || "invalid", path: ["__proto__"] });\n` +
          `  })`;
      }
      return { source, dropped };
    }
    case "arr": {
      const inner = renderZod(node.element);
      // BUG-094：数组长度界必须落成 `.min() / .max()`（zod 原生支持 ⇒ 不是
      // 「不可表达」，不得静默丢）。guard 面一直保留它 ⇒ 丢掉即跨面矛盾。
      let bounds = "";
      if (node.minLen !== undefined) bounds += `.min(${node.minLen})`;
      if (node.maxLen !== undefined) bounds += `.max(${node.maxLen})`;
      return { source: `z.array(${inner.source})${bounds}`, dropped: inner.dropped };
    }
    case "tuple": {
      const dropped: string[] = [];
      const elements = node.elements.map((e) => {
        const inner = renderZod(e);
        dropped.push(...inner.dropped);
        return inner.source;
      });
      // rest：zod 3/4 均支持 `.rest()`（`[1, ...number]` → z.tuple([z.literal(1)]).rest(z.number())）
      let rest = "";
      if (node.rest) {
        const inner = renderZod(node.rest);
        dropped.push(...inner.dropped);
        rest = `.rest(${inner.source})`;
      }
      return { source: `z.tuple([${elements.join(", ")}])${rest}`, dropped };
    }
    case "union": {
      const dropped: string[] = [];
      const members = node.members.map((m) => {
        const inner = renderZod(m);
        dropped.push(...inner.dropped);
        return inner.source;
      });
      return { source: `z.union([${members.join(", ")}])`, dropped };
    }
    case "fn":
      return { source: "z.function()", dropped: [] };
    case "promise": {
      const inner = renderZod(node.inner);
      return { source: `z.promise(${inner.source})`, dropped: inner.dropped };
    }
    case "brand":
      // 防御：brand 节点只允许全局构造器名（z.instanceof 的实参在模块求值期
      // 求值——名字不在作用域内则整个产物 ReferenceError，Bug 233）
      // 兜底降级 z.unknown() 必须**留痕**（渲染层不许静默放宽）。
      return isRuntimeGlobalCtorName(node.name)
        ? { source: `z.instanceof(${node.name})`, dropped: [] }
        : {
            source: "z.unknown()",
            dropped: [`brand not projected (no runtime constructor): ${node.name}`],
          };
    case "never":
      return { source: "z.never()", dropped: [] };
    case "unknown":
    default:
      return { source: "z.unknown()", dropped: [] };
  }
}

/**
 * SchemaNode → zod 源码（**只给源码**；渲染层的降级台账见
 * `schemaNodeToZodProjection` / `projectAbsToSchema`）。
 */
export function schemaNodeToZod(node: SchemaNode): string {
  return renderZod(node).source;
}

/**
 * SchemaNode → zod 源码 + **渲染层**降级台账。
 *
 * 内部面（公开面在 `emit/index.ts`）：`projectAbsToSchema` 用它把「节点 → zod
 * 源码」这一段的损失并进**既有** dropped 通道 ⇒ 产物的
 * `// dropped preds (not projected into zod):` 块里可见（用户可见的台账）。
 */
export function schemaNodeToZodProjection(node: SchemaNode): { source: string; dropped: string[] } {
  return renderZod(node);
}

const DIALECT_RENDERERS: Record<
  SchemaDialect,
  (n: SchemaNode) => { source: string; dropped: string[] }
> = {
  zod: renderZod,
};

export function projectAbsToSchema(a: Abs, opts?: { dialect?: SchemaDialect }): SchemaProjection {
  const dialect: SchemaDialect = opts?.dialect ?? "zod";
  const { node, dropped } = absToSchemaNode(a);
  const render = DIALECT_RENDERERS[dialect] ?? renderZod;
  const rendered = render(node);
  // 两层台账合并：节点层（Abs → 节点）+ 渲染层（节点 → zod 源码）
  return { source: rendered.source, dialect, dropped: [...dropped, ...rendered.dropped] };
}

export function absToSchemaSource(a: Abs, opts?: { dialect?: SchemaDialect }): string {
  return projectAbsToSchema(a, opts).source;
}

// --- zod JS module ---

export type ZodModuleProjection = {
  source: string;
  dialect: SchemaDialect;
  dropped: string[];
};

function zodExportIdent(name: string, used?: Set<string>): string {
  return toJsBindingIdent(name, used);
}

/** JS 对象字面量键：ident / 规范数字键可裸写，其余 JSON 引号（与 dts formatPropKey 同口径） */
export function formatJsObjectKey(k: string): string {
  return formatObjectKey(k);
}

/**
 * 生成代码里的 export/function 名：合法绑定标识符（含 Unicode）原样；
 * 保留字加 `_` 前缀；其余清洗。传入 `used` 时模块内去重（`a_b` / `a_b_2`）。
 */
export function safeExportIdent(name: string, used?: Set<string>): string {
  return zodExportIdent(name, used);
}

/**
 * Abs 导出表 → 可 import 的 zod JS 模块源码。
 * 形如 `import { z } from "zod"; export const name = z...;`
 */
export function absToZodSchemaModule(
  exports: Record<string, Abs>,
  opts?: { banner?: string },
): ZodModuleProjection {
  const dropped: string[] = [];
  const decls: string[] = [];
  const used = new Set<string>();
  for (const [name, abs] of Object.entries(exports)) {
    const p = projectAbsToSchema(abs, { dialect: "zod" });
    dropped.push(...p.dropped.map((n) => `${name}: ${n}`));
    decls.push(`export const ${zodExportIdent(name, used)} = ${p.source};`);
  }
  const banner =
    opts?.banner ??
    `// @generated by nudo export --format schema — dialect: zod\n// One-way lossy projection of Abs; do not edit. nudo check remains the gate.`;
  const droppedBlock =
    dropped.length > 0
      ? `\n// dropped preds (not projected into zod):\n${dropped
          .map((d) => `//   ${sanitizeLineCommentText(d)}`)
          .join("\n")}\n`
      : "";
  const source = `${banner}\n\nimport { z } from "zod";\n${droppedBlock}\n${decls.join("\n\n")}\n`;
  return { source, dialect: "zod", dropped };
}

export { termEq };
