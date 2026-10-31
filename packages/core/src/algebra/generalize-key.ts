/**
 * Abs 键 / α-rename（从 generalize.ts 拆出的纯结构变换）。
 *
 * 结构键的唯一实现在 abs-key.ts（shape × term × pred）；本模块只保留
 * generalize 侧需要的能力：α-rename、自由变元收集、instantiate 记忆键。
 */
import type { Abs, Shape } from "./abs.ts";
import type { Term } from "./term.ts";
import { v as termVar } from "./term.ts";
import type { Pred, Phi } from "./pred.ts";
import { absKey, predKey, termKey, type VarRename } from "./abs-key.ts";

export { termKey, predKey, type VarRename };

/**
 * 结构键：shape + term + pred；不含 conf（置信度不参与语义输入）。
 * `seen` 由调用方持有（实例化键按实参逐个新建）；实现见 abs-key.ts。
 */
export function absKeyInner(a: Abs, seen: Set<object>, rename?: VarRename): string {
  return absKey(a, seen, rename);
}


// --- free vars + α-rename (L2) ---

export function collectTermVars(t: Term, acc: Set<string>): void {
  if (t.op === "var") acc.add(t.id);
  else if (t.op === "app") for (const a of t.args) collectTermVars(a, acc);
}

export function collectPredVars(p: Pred, acc: Set<string>): void {
  switch (p.op) {
    case "true":
    case "false":
      return;
    case "eq":
    case "ne":
    case "lt":
    case "le":
    case "gt":
    case "ge":
      collectTermVars(p.a, acc);
      collectTermVars(p.b, acc);
      return;
    case "and":
    case "or":
      for (const a of p.args) collectPredVars(a, acc);
      return;
    case "not":
      collectPredVars(p.arg, acc);
      return;
    case "typeof":
      collectTermVars(p.t, acc);
      return;
    case "assumeFinite":
      collectTermVars(p.t, acc);
      return;
  }
}

export function collectAbsVars(a: Abs, acc: Set<string>, seen: Set<Abs>): void {
  if (seen.has(a)) return;
  seen.add(a);
  if (a.term) collectTermVars(a.term, acc);
  if (a.pred) collectPredVars(a.pred, acc);
  const s = a.shape;
  switch (s.k) {
    case "brand":
      collectAbsVars(s.shape, acc, seen);
      return;
    case "eff":
      collectAbsVars(s.inner, acc, seen);
      return;
    case "arr":
      collectAbsVars(s.element, acc, seen);
      return;
    case "tuple":
      for (const e of s.elements) collectAbsVars(e, acc, seen);
      if (s.rest) collectAbsVars(s.rest, acc, seen);
      return;
    case "fn":
      for (const t of s.paramTypes ?? []) collectAbsVars(t, acc, seen);
      if (s.returnType) collectAbsVars(s.returnType, acc, seen);
      return;
    case "sum":
      for (const m of s.members) collectAbsVars(m, acc, seen);
      return;
    case "obj":
      for (const slot of Object.values(s.slots)) collectAbsVars(slot.value, acc, seen);
      if (s.index) {
        collectAbsVars(s.index.key, acc, seen);
        collectAbsVars(s.index.value, acc, seen);
      }
      return;
    default:
      return;
  }
}

/** 公开：收集 Abs 自由 term 变元（dts 泛型投影 / α 作用域判定复用 L2 基建）。 */
export function collectAbsFreeVars(a: Abs): Set<string> {
  const acc = new Set<string>();
  collectAbsVars(a, acc, new Set());
  return acc;
}

export function renameTerm(t: Term, map: VarRename): Term {
  if (t.op === "var") {
    const to = map.get(t.id);
    return to === undefined ? t : termVar(to);
  }
  if (t.op === "app") {
    return { op: "app", fn: t.fn, args: t.args.map((a) => renameTerm(a, map)) };
  }
  return t;
}

export function renamePred(p: Pred, map: VarRename): Pred {
  switch (p.op) {
    case "true":
    case "false":
      return p;
    case "eq":
    case "ne":
    case "lt":
    case "le":
    case "gt":
    case "ge":
      return { op: p.op, a: renameTerm(p.a, map), b: renameTerm(p.b, map) };
    case "and":
    case "or":
      return { op: p.op, args: p.args.map((a) => renamePred(a, map)) };
    case "not":
      return { op: "not", arg: renamePred(p.arg, map) };
    case "typeof":
      return { op: "typeof", t: renameTerm(p.t, map), type: p.type };
    case "assumeFinite":
      return { op: "assumeFinite", t: renameTerm(p.t, map) };
  }
}

export function renameAbs(a: Abs, map: VarRename): Abs {
  const out: Abs = {
    shape: renameShape(a.shape, map),
    conf: a.conf,
  };
  if (a.term) out.term = renameTerm(a.term, map);
  if (a.pred) out.pred = renamePred(a.pred, map);
  // pathNote（分支 join 可解释标注）：Abs 级 facet。α-重命名是**语义等价
  // 变换**——重建只搬 shape/term/pred/conf 会把标注静默丢掉（formatAbs
  // 从此少一行解释），与 shape facet 同一条纪律：全字段保留。
  if (a.pathNote !== undefined) out.pathNote = a.pathNote;
  return out;
}

export function renameShape(s: Shape, map: VarRename): Shape {
  switch (s.k) {
    case "never":
    case "any":
    case "unknown":
    case "prim":
      return s;
    case "brand":
      // 全字段 spread（ctor / tv 等 facet 不因 α 改名丢失）
      return { ...s, shape: renameAbs(s.shape, map) };
    case "eff": {
      const out: Shape = { ...s, inner: renameAbs(s.inner, map) };
      // rejected 通道（Bug 36）同样承载 Abs——必须递归改名
      if (s.rejected) out.rejected = renameAbs(s.rejected, map);
      return out;
    }
    case "arr":
      return { ...s, element: renameAbs(s.element, map) };
    case "tuple": {
      const out: Shape = {
        ...s,
        elements: s.elements.map((e) => renameAbs(e, map)),
      };
      if (s.rest) out.rest = renameAbs(s.rest, map);
      if (s.holes) out.holes = [...s.holes]; // 空洞下标（读 undefined / in false）
      return out;
    }
    case "fn": {
      const out: Shape = { ...s, params: [...s.params] };
      if (s.paramTypes) out.paramTypes = s.paramTypes.map((t) => renameAbs(t, map));
      if (s.returnType) out.returnType = renameAbs(s.returnType, map);
      if (s.optionalParams) out.optionalParams = [...s.optionalParams];
      if (s.slots) {
        const slots: NonNullable<Extract<Shape, { k: "fn" }>["slots"]> = {};
        for (const [k, slot] of Object.entries(s.slots)) {
          // defineProperty：键名 "__proto__" 的直接赋值会踩宿主原型 setter
          Object.defineProperty(slots, k, {
            value: { ...slot, value: renameAbs(slot.value, map) },
            enumerable: true, writable: true, configurable: true,
          });
        }
        out.slots = slots;
      }
      return out;
    }
    case "sum":
      return { ...s, members: s.members.map((m) => renameAbs(m, map)) };
    case "obj": {
      const slots: Extract<Shape, { k: "obj" }>["slots"] = {};
      for (const [k, slot] of Object.entries(s.slots)) {
        // slot 标志（optional/readonly/internal/inherited/symbolKey）全保留
        Object.defineProperty(slots, k, {
          value: { ...slot, value: renameAbs(slot.value, map) },
          enumerable: true, writable: true, configurable: true,
        });
      }
      const out: Shape = { ...s, slots };
      if (s.index) {
        out.index = { key: renameAbs(s.index.key, map), value: renameAbs(s.index.value, map) };
      }
      return out;
    }
  }
}

export type InstHit = { result: Abs; varOrder: string[] };

/**
 * L2 键：args+Φ 中自由变元按 id 排序后 α-规范化（→ α0,α1,…）。
 * 同构不同名（x+1 vs y+1）共享条目；命中时把结果变元改回当前名。
 */
export function instantiateMemoKey(
  args: Abs[],
  phi: Phi,
): { key: string; varOrder: string[] } {
  const acc = new Set<string>();
  for (const a of args) collectAbsVars(a, acc, new Set());
  collectPredVars(phi, acc);
  const varOrder = [...acc].sort();
  const rename = new Map(varOrder.map((id, i) => [id, `α${i}`]));
  const key = `${args.map((a) => absKeyInner(a, new Set(), rename)).join(";")}#${predKey(phi, rename)}`;
  return { key, varOrder };
}

export function alphaRenameResult(
  result: Abs,
  fromOrder: string[],
  toOrder: string[],
): Abs {
  if (fromOrder.length !== toOrder.length) return result;
  let same = true;
  for (let i = 0; i < fromOrder.length; i++) {
    if (fromOrder[i] !== toOrder[i]) {
      same = false;
      break;
    }
  }
  if (same) return result;
  const map = new Map<string, string>();
  for (let i = 0; i < fromOrder.length; i++) {
    map.set(fromOrder[i]!, toOrder[i]!);
  }
  return renameAbs(result, map);
}
