/**
 * Abs → NudoConstraint 投影（Phase 1，interface 分层推导的生成侧半边）。
 *
 * 只投影可表达子集，其余一律 undefined——诚实缺口，不产垃圾约束
 * （调用方据此标 partial/skip，见设计文档 §4.2）：
 *
 *   numLit(42) / strLit("a") / boolLit(true)   → lit(v)
 *   prim number + 常数界（gt/ge/lt/le 于 self 项）→ number().gt(…) 链
 *   prim string + 长度界（length(self) 与常数比较）→ string().min/max
 *   prim + eq(self, lit v)                      → lit(v)
 *   sum 形态 / or-pred 字面量集                  → union(lit…)（全员字面量才投影）
 *   obj slots                                   → shape({ 字段递归 })（任一字段
 *     不可投影 → 整体 undefined；空对象 → shape({})）
 *   arr                                         → array(item)（元素可投影）；
 *     元素不可投影但 prim 均匀无 preds → array(number()) 之类退化
 *
 * conf ∈ {exact, path} 才投影；widened/partial/opaque/mock → undefined。
 * preds 中含不可表达形态（length 于 number、ne、未锚定 self 的项、
 * 嵌套 or/not）→ undefined。bigint/symbol、tuple、fn、eff、brand、
 * any（无 or-pred）、never、unknown → undefined。
 *
 * 注意：本模块从 "./constraint.ts" 直接路径 import（桶导出消歧为
 * term.ts 的 lit / pred.ts 的 and，见 constraint.ts 头注释）。
 */

import type { Abs, Confidence } from "./abs.ts";
import type { NudoConstraint, NudoField } from "./constraint.ts";
import { number, string, boolean, lit, union, array, SELF } from "./constraint.ts";
import { joinAbs } from "./objects.ts";
import type { Pred, PrimName } from "./pred.ts";
import { termEquals, v as termVar, type Term, type LiteralValue } from "./term.ts";
import { app as termApp } from "./term.ts";

/** 投影置信门槛：widened/partial/opaque/mock 不投影 */
const PROJECTABLE_CONF: ReadonlySet<Confidence> = new Set(["exact", "path"]);

/** array 元素退化路径接受的置信（join 后 term/pred 丢失的 widened 形态，
 *  shape 仍可靠；partial/opaque 是分析失败信号，不采信） */
const ARR_FALLBACK_CONF: ReadonlySet<Confidence> = new Set([
  "exact",
  "path",
  "widened",
]);

type CmpOp = "gt" | "ge" | "lt" | "le";
type LitVal = number | string | boolean;

/** Abs → 契约；不可表达 → undefined */
export function absToConstraint(a: Abs): NudoConstraint | undefined {
  if (!PROJECTABLE_CONF.has(a.conf)) return undefined;
  const s = a.shape;
  switch (s.k) {
    case "prim":
      // or-pred 字面量集（x === "a" || x === "b" 收窄形态）优先于叶子链
      if (a.pred?.op === "or") return projectOrLiterals(a);
      switch (s.type) {
        case "number":
          return projectNumber(a);
        case "string":
          return projectString(a);
        case "boolean":
          return projectBoolean(a);
        default:
          return undefined; // bigint / symbol：字面量/构建器域外
      }
    case "any":
      // any 只有 or-pred 字面量集携带可表达信息
      return a.pred?.op === "or" ? projectOrLiterals(a) : undefined;
    case "obj":
      return projectObj(s.slots, s.index, s.open);
    case "arr":
      return projectArr(s.element);
    case "sum":
      return projectSum(s.members);
    default:
      return undefined;
  }
}

/**
 * 工件聚合投影（设计 §4.2：先 Abs join 折叠再投影）。
 * 空列表 → undefined（无证据不产约束）。
 */
export function joinThenProject(absList: Abs[]): NudoConstraint | undefined {
  if (absList.length === 0) return undefined;
  return absToConstraint(absList.reduce((a, b) => joinAbs(a, b)));
}

// --- 标量投影 ---

function projectNumber(a: Abs): NudoConstraint | undefined {
  if (a.term?.op === "lit") {
    return typeof a.term.value === "number" ? lit(a.term.value) : undefined;
  }
  const leaves = predLeaves(a.pred);
  if (!leaves) return undefined;
  const self = a.term;
  let eqVal: number | undefined;
  let isInt = false;
  const bounds: Array<{ op: CmpOp; n: number }> = [];
  for (const p of leaves) {
    if (p.op === "typeof") {
      // 与 shape 冗余的 typeof self = "number"；其它 typeof 不可表达
      if (p.type !== "number" || !self || !termEquals(p.t, self)) return undefined;
      continue;
    }
    if (p.op === "eq") {
      if (isIntZeroModOne(p, self)) {
        isInt = true; // x % 1 === 0 的整性编码
        continue;
      }
      const v = anchoredEqLit(p, self);
      if (v === undefined || typeof v !== "number") return undefined;
      if (eqVal !== undefined && eqVal !== v) return undefined; // 多个不同 eq：不可满足，不产垃圾
      eqVal = v;
      continue;
    }
    if (p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le") {
      const b = numericBound(p, self);
      if (!b) return undefined;
      bounds.push(b);
      continue;
    }
    return undefined; // ne / not / false / length 于 number 等
  }
  if (eqVal !== undefined) return lit(eqVal); // eq 主导，常数界冗余
  let c = number();
  if (isInt) c = c.int();
  for (const b of bounds) c = c[b.op](b.n);
  return c;
}

function projectString(a: Abs): NudoConstraint | undefined {
  if (a.term?.op === "lit") {
    return typeof a.term.value === "string" ? lit(a.term.value) : undefined;
  }
  const leaves = predLeaves(a.pred);
  if (!leaves) return undefined;
  const self = a.term;
  let eqVal: string | undefined;
  const mins: number[] = [];
  const maxs: number[] = [];
  for (const p of leaves) {
    if (p.op === "typeof") {
      if (p.type !== "string" || !self || !termEquals(p.t, self)) return undefined;
      continue;
    }
    if (p.op === "eq") {
      const v = anchoredEqLit(p, self);
      if (v === undefined || typeof v !== "string") return undefined;
      if (eqVal !== undefined && eqVal !== v) return undefined;
      eqVal = v;
      continue;
    }
    if (p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le") {
      const lb = lengthBound(p, self);
      if (!lb) return undefined; // 数值界于 self（非 length）等形态不可表达
      (lb.dir === "min" ? mins : maxs).push(lb.n);
      continue;
    }
    return undefined;
  }
  if (eqVal !== undefined) return lit(eqVal);
  let c = string();
  for (const n of mins) c = c.min(n);
  for (const n of maxs) c = c.max(n);
  return c;
}

function projectBoolean(a: Abs): NudoConstraint | undefined {
  if (a.term?.op === "lit") {
    return typeof a.term.value === "boolean" ? lit(a.term.value) : undefined;
  }
  const leaves = predLeaves(a.pred);
  if (!leaves) return undefined;
  const self = a.term;
  let eqVal: boolean | undefined;
  for (const p of leaves) {
    if (p.op === "typeof") {
      if (p.type !== "boolean" || !self || !termEquals(p.t, self)) return undefined;
      continue;
    }
    if (p.op === "eq") {
      const v = anchoredEqLit(p, self);
      if (v === undefined || typeof v !== "boolean") return undefined;
      if (eqVal !== undefined && eqVal !== v) return undefined;
      eqVal = v;
      continue;
    }
    return undefined;
  }
  return eqVal !== undefined ? lit(eqVal) : boolean();
}

/** or-pred 字面量集：or(eq(self, lit)…) 全员锚定 → union(lit…) */
function projectOrLiterals(a: Abs): NudoConstraint | undefined {
  const p = a.pred;
  if (!p || p.op !== "or" || !a.term) return undefined;
  const expectedPrim = a.shape.k === "prim" ? a.shape.type : undefined;
  const lits: NudoConstraint[] = [];
  for (const q of p.args) {
    if (q.op !== "eq") return undefined;
    const v = anchoredEqLit(q, a.term);
    if (v === undefined) return undefined;
    if (expectedPrim !== undefined && primOfLit(v) !== expectedPrim) return undefined;
    lits.push(lit(v));
  }
  return lits.length > 0 ? union(...lits) : undefined;
}

// --- 复合形态投影 ---

function projectObj(
  slots: Record<string, { value: Abs; optional?: boolean }>,
  index: { key: Abs; value: Abs } | undefined,
  open: boolean | undefined,
): NudoConstraint | undefined {
  // 动态键 / open 对象不是定长形状
  if (index || open) return undefined;
  const fields: Record<string, NudoField> = {};
  for (const [k, slot] of Object.entries(slots)) {
    const fc = absToConstraint(slot.value);
    if (!fc) return undefined; // Phase 1 保守：任一字段不可投影 → 整体放弃
    fields[k] = { constraint: fc, ...(slot.optional ? { optional: true } : {}) };
  }
  return { __nudoConstraint: true, preds: [], fields };
}

function projectArr(element: Abs): NudoConstraint | undefined {
  const ec = absToConstraint(element);
  if (ec) return array(ec);
  // 退化：元素 prim 均匀且无 preds → array(number()) 之类
  if (
    element.shape.k === "prim" &&
    isBuilderPrim(element.shape.type) &&
    (!element.pred || element.pred.op === "true") &&
    ARR_FALLBACK_CONF.has(element.conf)
  ) {
    return array(primConstraint(element.shape.type));
  }
  return undefined;
}

/** sum：全员可投影为字面量 → union(lit…)；never 成员是空域不贡献 */
function projectSum(members: Abs[]): NudoConstraint | undefined {
  const lits: NudoConstraint[] = [];
  for (const m of members) {
    if (m.shape.k === "never") continue;
    const lc = absLitConstraint(m);
    if (!lc) return undefined;
    lits.push(lc);
  }
  return lits.length > 0 ? union(...lits) : undefined;
}

/** 字面量 Abs → lit 契约：term lit 形态或 eq(self, lit) 单叶形态 */
function absLitConstraint(a: Abs): NudoConstraint | undefined {
  if (!PROJECTABLE_CONF.has(a.conf)) return undefined;
  const s = a.shape;
  if (s.k !== "prim") return undefined;
  if (a.term?.op === "lit" && primOfLit(a.term.value) === s.type) {
    return lit(a.term.value as LitVal);
  }
  if (a.pred?.op === "eq") {
    const v = anchoredEqLit(a.pred, a.term);
    if (v !== undefined && primOfLit(v) === s.type) return lit(v);
  }
  return undefined;
}

// --- pred 叶子解析 ---

/** 展平 and 链为叶子；嵌套 or/not（标量位）→ undefined（不可表达） */
function predLeaves(p: Pred | undefined): Pred[] | undefined {
  if (!p || p.op === "true") return [];
  if (p.op === "and") {
    const out: Pred[] = [];
    for (const x of p.args) {
      const sub = predLeaves(x);
      if (!sub) return undefined;
      out.push(...sub);
    }
    return out;
  }
  if (p.op === "or" || p.op === "not" || p.op === "false") return undefined;
  return [p];
}

/** 数值常数界：self op n（右端数字 lit；左端锚定 self 项） */
function numericBound(
  p: Pred,
  self: Term | undefined,
): { op: CmpOp; n: number } | undefined {
  if (p.op !== "gt" && p.op !== "ge" && p.op !== "lt" && p.op !== "le") return undefined;
  if (!self) return undefined;
  if (termEquals(p.a, self) && p.b.op === "lit" && typeof p.b.value === "number") {
    return { op: p.op, n: p.b.value };
  }
  return undefined;
}

/**
 * 长度界：length(self) op n → min/max（长度整数域：> n ⟺ ≥ n+1、< n ⟺ ≤ n−1）。
 * 锚定项接受 length(self) 或 length(SELF)——constraintToEntryAbs 的 subst
 * 不递归 app 参数，length 模板项以 __nudo_self__ 原样留在 Abs pred 里。
 */
function lengthBound(
  p: Pred,
  self: Term | undefined,
): { dir: "min" | "max"; n: number } | undefined {
  if (!self) return undefined;
  const anchors = [termApp("length", [self]), termApp("length", [termVar(SELF)])];
  for (const anchor of anchors) {
    const b = numericBound(p, anchor);
    if (b) {
      switch (b.op) {
        case "ge":
          return { dir: "min", n: b.n };
        case "gt":
          return { dir: "min", n: b.n + 1 };
        case "le":
          return { dir: "max", n: b.n };
        case "lt":
          return { dir: "max", n: b.n - 1 };
      }
    }
  }
  return undefined;
}

/** eq(self, lit v) / eq(lit v, self) 取字面量端；未锚定或非标量 lit → undefined */
function anchoredEqLit(p: Pred, self: Term | undefined): LitVal | undefined {
  if (p.op !== "eq" || !self) return undefined;
  const v =
    termEquals(p.a, self) && p.b.op === "lit"
      ? p.b.value
      : termEquals(p.b, self) && p.a.op === "lit"
        ? p.a.value
        : undefined;
  return isLitVal(v) ? v : undefined;
}

/** x % 1 === 0 的整性编码：eq((self % 1), 0) —— Phase 1 认得的唯一整性形式 */
function isIntZeroModOne(p: Pred, self: Term | undefined): boolean {
  if (p.op !== "eq" || !self) return false;
  const zero = (t: Term): boolean => t.op === "lit" && t.value === 0;
  return (
    (isModOne(p.a, self) && zero(p.b)) || (isModOne(p.b, self) && zero(p.a))
  );
}

function isModOne(t: Term, self: Term): boolean {
  return (
    t.op === "app" &&
    t.fn === "%" &&
    t.args.length === 2 &&
    termEquals(t.args[0]!, self) &&
    t.args[1]!.op === "lit" &&
    t.args[1]!.value === 1
  );
}

// --- 杂项 ---

function isLitVal(v: LiteralValue | undefined): v is LitVal {
  return (
    typeof v === "number" || typeof v === "string" || typeof v === "boolean"
  );
}

function primOfLit(v: LiteralValue): PrimName | undefined {
  if (typeof v === "number") return "number";
  if (typeof v === "string") return "string";
  if (typeof v === "boolean") return "boolean";
  return undefined;
}

/** 有构建器的 prim（bigint/symbol 无构建器） */
type BuilderPrim = "number" | "string" | "boolean";

function isBuilderPrim(p: PrimName): p is BuilderPrim {
  return p === "number" || p === "string" || p === "boolean";
}

function primConstraint(p: BuilderPrim): NudoConstraint {
  switch (p) {
    case "number":
      return number();
    case "string":
      return string();
    case "boolean":
      return boolean();
  }
}
