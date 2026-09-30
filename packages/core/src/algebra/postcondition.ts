/**
 * 返回后置统一证明通道（DEC-001 方案 A）。
 *
 * `assertImplies(ret, constraint)` 与前置共用 Pred 蕴含（`implies` /
 * `numericBoundsImply`）与字面量域隶属（`literalMeetsConstraint`），
 * 禁止字面量特判堆叠。三态结果：
 *
 *   proved     — 返回值域 ⊆ 契约域（放行）
 *   disproved  — 值域已知且 ⊄ 契约域（error：字面量违约 / nullish 未声明 / prim 不匹配 / 界证不出）
 *   unprovable — 值域未知（any / unknown=推断失败 / opaque 截断）——
 *                不得伪装成功，调用侧以 warning 呈现，不得计 error（gold FP 门禁）
 *
 * nullish 显式化：`return null`/`undefined` 只对 `constraintAdmitsNullish`
 * 的契约合法；`nullable(c)` / `union(c, lit(null), lit(undefined))` 显式声明。
 */

import type { Abs } from "./abs.ts";
import { litValue } from "./abs.ts";
import type { Term } from "./term.ts";
import { v as termVar, lit as termLit, app as termApp } from "./term.ts";
import type { Pred, Phi } from "./pred.ts";
import { implies, pTrue, and as pAnd } from "./pred.ts";
import type { NudoConstraint, NudoField } from "./constraint.ts";
import {
  SELF,
  constraintAdmitsNullish,
  isIntFlag,
  instantiateOnTerm,
} from "./constraint.ts";
import { isNullishLitAbs } from "./surface.ts";
import { literalMeetsConstraint } from "./domain-membership.ts";
import { getSlot } from "./objects.ts";
import { termEquals } from "./term.ts";
import { formatAbs } from "./format.ts";
import { formatConstraint } from "./interface.ts";

export type PostProof =
  | { status: "proved" }
  | { status: "disproved"; reason: string }
  | { status: "unprovable"; reason: string };

function proved(): PostProof {
  return { status: "proved" };
}
function disproved(reason: string): PostProof {
  return { status: "disproved", reason };
}
function unprovable(reason: string): PostProof {
  return { status: "unprovable", reason };
}

/** 合成返回项（无 term 时锚定约束 pred 用；不与真实变量冲突） */
const RET_ANCHOR = "__nudo_return__";

function retAnchorTerm(ret: Abs): Term {
  return ret.term ?? termVar(RET_ANCHOR);
}

/**
 * 值域未知 / 不可判定：不得伪装成功，也不得计 error。
 * - conf widened / mock / opaque：分析显式丢失精度
 * - any：开发者未约束；unknown 无 term：推断失败
 * - 拓宽 sum 成员的 bare prim（无 term/pred）：any+any 派生产物
 */
function isValueSetUnknown(ret: Abs): boolean {
  if (
    ret.conf === "opaque" ||
    ret.conf === "widened" ||
    ret.conf === "mock"
  ) {
    return true;
  }
  if (ret.shape.k === "unknown" && !ret.term) return true;
  if (ret.shape.k === "any") return true;
  return false;
}

/**
 * 值域已知但无 pred 证据（bare prim / 无界表达式）：
 * 后置界义务证不出也反证不了 → unprovable，不得当 disproved。
 * 只有 ret.pred 存在却不蕴含时才有「确定不满足」的证据（F3 点 1）。
 */
function isBoundedEvidenceMissing(ret: Abs, constraint: NudoConstraint): boolean {
  // 契约无 pred 义务：裸 prim 合格即可
  if (constraint.preds.length === 0 && !constraint.members) return false;
  // 字面量有确定值，可走域隶属 → 不算证据缺失
  if (ret.term?.op === "lit") return false;
  // ret.pred 存在：可走蕴含判定 → 不算证据缺失
  if (ret.pred && ret.pred.op !== "true") return false;
  // 有约束义务但无 pred 证据（bare number vs gt(0)）→ 不可判定
  return true;
}

/**
 * 统一后置证明：返回 Abs 的值域是否蕴含契约。
 * phi：路径前提（可选，与前置同一 Phi 通道）。
 */
export function assertImplies(
  ret: Abs,
  constraint: NudoConstraint,
  opts?: { phi?: Phi },
): PostProof {
  const phi = opts?.phi ?? pTrue;

  // never（不可达）：后置空洞成立
  if (ret.shape.k === "never") return proved();

  // any() 契约：无义务
  if (isAnyConstraint(constraint)) return proved();

  // --- nullish 显式化 ---
  const nullishOk = constraintAdmitsNullish(constraint);
  if (isNullishLitAbs(ret)) {
    return nullishOk
      ? proved()
      : disproved(`nullish return ⊭ ${formatConstraint(constraint)}`);
  }

  // sum 含 nullish 成员：未声明 nullish 则违约（每个 nullish 臂都是逃逸）
  let sumMembers: Abs[] | undefined;
  if (ret.shape.k === "sum") {
    const members = (ret.shape as { members: Abs[] }).members;
    const nullishMembers = members.filter((m) => isNullishLitAbs(m));
    if (nullishMembers.length > 0 && !nullishOk) {
      return disproved(
        `nullish return arm ⊭ ${formatConstraint(constraint)} (contract does not admit nullish)`,
      );
    }
    sumMembers = members.filter((m) => !isNullishLitAbs(m));
  }

  // --- 值域未知：any / true unknown / opaque ---
  if (isValueSetUnknown(ret)) {
    return unprovable(
      ret.shape.k === "any"
        ? "any does not establish the return contract"
        : "inference failure (unknown/opaque) — cannot prove the return contract",
    );
  }

  // --- union 契约：任一成员蕴含即 proved ---
  if (constraint.members && constraint.members.length > 0) {
    let sawUnprovable = false;
    for (const m of constraint.members) {
      const r = assertImplies(ret, m, opts);
      if (r.status === "proved") return proved();
      if (r.status === "unprovable") sawUnprovable = true;
    }
    return sawUnprovable
      ? unprovable("union: no member proved the return contract")
      : disproved(`return ⊭ union(${constraint.members.map((m) => formatConstraint(m)).join(", ")})`);
  }

  // --- sum 分发：形状/数组契约逐成员对账（条件赋值 / 多 return 路径）。
  // scalar 契约不向 sum 成员分发——成员可能是 any 参与运算符派生的
  // 并集（any+any → number|string），报则假阳性（gold 门禁口径）。
  // array 契约同为结构契约：`[] | [x]` 的每个成员单独都是数组，不得因
  // 「sum 既不是 arr 也不是 tuple」判违规（此前落下方 element 分支 →
  // 消费方 `const out = []; if (…) out.push(x); return out;` 全数假阳性）。
  if (sumMembers && (constraint.fields || constraint.element)) {
    let sawUnprovable = false;
    for (const m of sumMembers) {
      if (isValueSetUnknown(m)) continue; // gold FP 保护：any 派生成员
      const r = assertImplies(m, constraint, opts);
      if (r.status === "disproved") return r;
      if (r.status === "unprovable") sawUnprovable = true;
    }
    return sawUnprovable
      ? unprovable("sum: some arms unprovable")
      : proved();
  }

  // --- shape 契约：结构字段对账 ---
  if (constraint.fields) {
    return assertShapeFields(ret, constraint, opts);
  }

  // --- array 契约 ---
  if (constraint.element) {
    if (ret.shape.k !== "arr" && ret.shape.k !== "tuple") {
      return disproved(`return shape ${ret.shape.k} ⊭ array(...)`);
    }
    // 元素级：整体 arr 存在即 shape 合格（元素级后置是嵌套缺口，不在此扩面）
    return proved();
  }

  // --- fn 契约：Phase 1 只展示不执法 ---
  if (constraint.fn) return proved();

  // --- 标量：prim + Pred 蕴含（统一证明通道）---
  return assertScalar(ret, constraint, phi);
}

/** any()：无 prim / preds / shape / members / fn */
function isAnyConstraint(c: NudoConstraint): boolean {
  return (
    !c.prim &&
    c.preds.length === 0 &&
    !c.fields &&
    !c.element &&
    !c.members &&
    !c.fn &&
    !isIntFlag(c)
  );
}

function assertShapeFields(
  ret: Abs,
  constraint: NudoConstraint,
  opts?: { phi?: Phi },
): PostProof {
  type ObjSlots = Record<string, { value: Abs; optional?: boolean }>;
  let slots: ObjSlots | undefined;
  if (ret.shape.k === "obj") {
    slots = (ret.shape as { slots: ObjSlots }).slots;
  } else if (ret.shape.k === "brand") {
    const inner = ret.shape.shape;
    if (inner.shape.k === "obj") slots = (inner.shape as { slots: ObjSlots }).slots;
  }
  if (!slots) {
    return disproved(`return shape ${ret.shape.k} ⊭ object shape`);
  }
  for (const [key, field] of Object.entries(constraint.fields!) as Array<
    [string, NudoField]
  >) {
    const slot = getSlot(slots, key);
    if (!slot) {
      if (!field.optional && !field.constraint.isOptional) {
        return disproved(`missing field ${key}`);
      }
      continue;
    }
    const r = assertImplies(slot.value, field.constraint, opts);
    if (r.status === "disproved") {
      return disproved(`field ${key}: ${r.reason}`);
    }
    // unprovable 字段：整体降级为 unprovable（不伪装成功）
    if (r.status === "unprovable") {
      return unprovable(`field ${key}: ${r.reason}`);
    }
  }
  return proved();
}

function assertScalar(
  ret: Abs,
  constraint: NudoConstraint,
  phi: Phi,
): PostProof {
  // prim 门
  if (constraint.prim) {
    const retPrim = primOfAbs(ret);
    if (retPrim && retPrim !== constraint.prim) {
      return disproved(`typeof return = "${retPrim}" ⊭ "${constraint.prim}"`);
    }
    // ret 无 prim 但契约要求 prim：结构性形状（obj/arr/tuple/fn/brand/eff）
    // 与 prim 域不相交 → 直接 disproved（勿落到 empty-preds proved）。
    // sum / unknown+term 保持现行为（sum 是 gold FP 保护；unknown+term 走 pred 通道）。
    if (!retPrim) {
      const k = ret.shape.k;
      if (k === "obj" || k === "arr" || k === "tuple" || k === "fn" || k === "brand" || k === "eff") {
        return disproved(`return shape ${k} ⊭ prim "${constraint.prim}"`);
      }
    }
  }

  // int 位
  if (isIntFlag(constraint) && constraint.prim === "number") {
    const lvR = litValue(ret);
    const lv = lvR.ok ? lvR.value : undefined;
    if (typeof lv === "number" && !Number.isInteger(lv)) {
      return disproved(`return ${lv} ⊭ int`);
    }
  }

  // Pred 蕴含（统一证明通道）：constraint preds 锚定到 ret.term
  const t = retAnchorTerm(ret);
  const constraintPred = instantiateOnTerm(constraint, t);
  const retPred: Phi =
    ret.pred && ret.pred.op !== "true"
      ? phi.op === "true"
        ? ret.pred
        : pAnd(phi, ret.pred)
      : phi;

  // 契约无 pred 义务（裸 prim / any()）：prim 门已过即 proved
  if (constraint.preds.length === 0 && constraintPred.op === "true") {
    return proved();
  }
  // 仅有 auto-typeof（prim + 无显式 pred）：prim 门已核对 → proved
  if (constraint.preds.length === 0 && constraintPred.op === "typeof" && constraint.prim) {
    return proved();
  }

  if (constraintPred.op !== "true") {
    if (implies(retPred, constraintPred)) return proved();
    // numericBoundsImply：src 界更紧可蕴含更宽目标（x>5 ⇒ x>0）
    if (ret.pred && ret.pred.op !== "true" && numericBoundsImplyLocal(ret.pred, constraintPred)) {
      return proved();
    }
    // 有界义务但无 pred 证据（bare prim / 无界表达式 vs gt(0)）→ 不可判定
    // 只有 ret.pred 存在却不蕴含时才是「确定不满足」（F3 点 1）
    if (isBoundedEvidenceMissing(ret, constraint)) {
      return unprovable(
        `cannot prove return satisfies ${formatConstraint(constraint)} (no bound evidence on the return value)`,
      );
    }
  }

  // 字面量域隶属（与前置 scan.ts 同口径）：eq / length / int / union 字面量集。
  // litValue 哨兵对 lit(undefined) 折成 undefined，须直接看 term。
  if (ret.term?.op === "lit") {
    const lv = ret.term.value;
    if (typeof lv === "number" || typeof lv === "string" || typeof lv === "boolean" || lv === null || lv === undefined) {
      if (literalMeetsConstraint(lv, constraint)) {
        return proved();
      }
      // lit(undefined)：契约含 undefined 成员（union 分发后）已在上方 proved；
      // 走到这里说明域隶属判 false → 按字面量违约收口（与其它字面量同口径）
      // 字面量确定不满足 → disproved（界类显示运算符，与旧口径对齐）
      const boundDesc = describeBoundViolation(lv, constraint);
      return disproved(
        boundDesc ?? `return ${JSON.stringify(lv)} ⊭ ${formatConstraint(constraint)}`,
      );
    }
  }

  // 非字面量：pred 蕴含失败但值域已知且有 pred 证据 → 后置证不出 = 违约（fail-closed）
  if (constraintPred.op !== "true" || constraint.preds.length > 0) {
    if (isBoundedEvidenceMissing(ret, constraint)) {
      return unprovable(
        `cannot prove return satisfies ${formatConstraint(constraint)} (no bound evidence on the return value)`,
      );
    }
    return disproved(
      `return (${formatAbs(ret)}) ⊭ ${formatConstraint(constraint)} (postcondition not implied)`,
    );
  }

  // 契约无 pred（裸 prim）：shape 合格即 proved
  return proved();
}

/** 本地 numericBoundsImply（与 leq.ts 同语义；不改 leq 可见性） */
function numericBoundsImplyLocal(src: Pred, tgt: Pred): boolean {
  const one = (p: Pred): p is Extract<Pred, { op: "gt" | "ge" | "lt" | "le" }> =>
    p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le";
  if (!one(src) || !one(tgt)) return false;
  if (src.op !== tgt.op) {
    if (src.op === "gt" && tgt.op === "ge") {
      return sameTermSide(src, tgt) && litGE(src.b, tgt.b);
    }
    if (src.op === "lt" && tgt.op === "le") {
      return sameTermSide(src, tgt) && litLE(src.b, tgt.b);
    }
    return false;
  }
  if (!sameTermSide(src, tgt)) return false;
  const sb = src.b.op === "lit" ? src.b.value : undefined;
  const tb = tgt.b.op === "lit" ? tgt.b.value : undefined;
  if (typeof sb !== "number" || typeof tb !== "number") return false;
  if (src.op === "gt" || src.op === "ge") return sb >= tb;
  return sb <= tb;
}

function sameTermSide(
  a: { a: Term; b: Term },
  b: { a: Term; b: Term },
): boolean {
  // 只比左侧（被约束项）；右端是不同的字面量界
  return a.a.op === b.a.op && termEquals(a.a, b.a);
}

function litGE(
  a: { op: string; value?: unknown },
  b: { op: string; value?: unknown },
): boolean {
  if (a.op !== "lit" || b.op !== "lit") return false;
  return typeof a.value === "number" && typeof b.value === "number" && a.value >= b.value;
}

function litLE(
  a: { op: string; value?: unknown },
  b: { op: string; value?: unknown },
): boolean {
  if (a.op !== "lit" || b.op !== "lit") return false;
  return typeof a.value === "number" && typeof b.value === "number" && a.value <= b.value;
}

function primOfAbs(
  a: Abs,
): "number" | "string" | "boolean" | "bigint" | "symbol" | undefined {
  if (a.shape.k === "prim") return a.shape.type;
  const lvR = litValue(a);
  const lv = lvR.ok ? lvR.value : undefined;
  if (typeof lv === "number") return "number";
  if (typeof lv === "string") return "string";
  if (typeof lv === "boolean") return "boolean";
  if (typeof lv === "bigint") return "bigint";
  return undefined;
}

/** 字面量界违约的人类可读描述（`return > 0` / `return 0 ⊭ ≥ 1` 等） */
function describeBoundViolation(
  lv: number | string | boolean | null | undefined,
  constraint: NudoConstraint,
): string | undefined {
  const opSym: Record<string, string> = { gt: ">", ge: "≥", lt: "<", le: "≤" };
  for (const p of constraint.preds) {
    for (const atom of p.op === "and" ? p.args : [p]) {
      if (atom.op !== "gt" && atom.op !== "ge" && atom.op !== "lt" && atom.op !== "le") continue;
      if (atom.b.op !== "lit" || typeof atom.b.value !== "number") continue;
      const n = atom.b.value;
      const sym = opSym[atom.op]!;
      // 数值界
      if (typeof lv === "number") {
        let ok = true;
        if (atom.op === "gt") ok = lv > n;
        if (atom.op === "ge") ok = lv >= n;
        if (atom.op === "lt") ok = lv < n;
        if (atom.op === "le") ok = lv <= n;
        if (!ok) return `return ${sym} ${n}`;
      }
      // 长度界
      if (typeof lv === "string" && isLengthSelfTerm(atom.a)) {
        let ok = true;
        if (atom.op === "gt") ok = lv.length > n;
        if (atom.op === "ge") ok = lv.length >= n;
        if (atom.op === "lt") ok = lv.length < n;
        if (atom.op === "le") ok = lv.length <= n;
        if (!ok) return `length(self) ${sym} ${n}`;
      }
    }
  }
  return undefined;
}

function isLengthSelfTerm(t: Term): boolean {
  return (
    t.op === "app" &&
    t.fn === "length" &&
    t.args.length === 1 &&
    t.args[0]!.op === "var" &&
    (t.args[0] as { id: string }).id === SELF
  );
}
