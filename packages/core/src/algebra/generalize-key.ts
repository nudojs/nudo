/**
 * Abs 键 / α-rename（从 generalize.ts 拆出的纯结构变换）。
 */
import type { Abs, Shape } from "./abs.ts";
import type { Term } from "./term.ts";
import { v as termVar } from "./term.ts";
import type { Pred, Phi } from "./pred.ts";

export type VarRename = ReadonlyMap<string, string>;

export function termKey(t: Term, rename?: VarRename): string {
  switch (t.op) {
    case "lit":
      return `L:${typeof t.value}:${String(t.value)}`;
    case "var":
      return `V:${rename?.get(t.id) ?? t.id}`;
    case "app":
      return `A:${t.fn}(${t.args.map((a) => termKey(a, rename)).join(",")})`;
  }
}

/** L2：and/or 子约束按键排序，交换律不造成 miss */
export function predKey(p: Pred, rename?: VarRename): string {
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
      return `${p.op}(${termKey(p.a, rename)},${termKey(p.b, rename)})`;
    case "and":
    case "or": {
      const keys = p.args.map((a) => predKey(a, rename)).sort();
      return `${p.op}(${keys.join(",")})`;
    }
    case "not":
      return `not(${predKey(p.arg, rename)})`;
    case "typeof":
      return `typeof(${termKey(p.t, rename)},${p.type})`;
  }
}

/** 结构键：shape + term + pred；不含 conf（置信度不参与语义输入） */
function shapeKey(s: Shape, seen: Set<object>, rename?: VarRename): string {
  switch (s.k) {
    case "never":
    case "any":
    case "unknown":
      return s.k;
    case "prim":
      return `p:${s.type}`;
    case "brand":
      return `b:${s.name}(${absKeyInner(s.shape, seen, rename)})`;
    case "eff":
      return `e:${s.eff}<${absKeyInner(s.inner, seen, rename)}>`;
    case "arr":
      return `arr(${absKeyInner(s.element, seen, rename)})`;
    case "tuple": {
      const els = s.elements.map((e) => absKeyInner(e, seen, rename)).join(",");
      const rest = s.rest ? `...${absKeyInner(s.rest, seen, rename)}` : "";
      return `tup[${els}${rest}]`;
    }
    case "fn": {
      const pts = (s.paramTypes ?? [])
        .map((t) => absKeyInner(t, seen, rename))
        .join(",");
      const ret = s.returnType ? absKeyInner(s.returnType, seen, rename) : "?";
      const name = s.name ? `#${s.name}` : "";
      return `fn${name}(${s.params.join(",")}|${pts})=>${ret}`;
    }
    case "sum":
      return `sum(${s.members.map((m) => absKeyInner(m, seen, rename)).join("|")})`;
    case "obj": {
      const slots = Object.keys(s.slots)
        .sort()
        .map((k) => {
          const slot = s.slots[k]!;
          const flags = (slot.optional ? "?" : "") + (slot.readonly ? "r" : "");
          return `${k}${flags}:${absKeyInner(slot.value, seen, rename)}`;
        })
        .join(",");
      const idx = s.index
        ? `idx(${absKeyInner(s.index.key, seen, rename)}→${absKeyInner(s.index.value, seen, rename)})`
        : "";
      const open = s.open ? "open" : "";
      return `obj{${slots}}${idx}${open}`;
    }
  }
}

export function absKeyInner(a: Abs, seen: Set<object>, rename?: VarRename): string {
  if (seen.has(a)) return "cycle";
  seen.add(a);
  const t = a.term ? `=${termKey(a.term, rename)}` : "";
  const p = a.pred ? `@${predKey(a.pred, rename)}` : "";
  return `${shapeKey(a.shape, seen, rename)}${t}${p}`;
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
  }
}

export function renameAbs(a: Abs, map: VarRename): Abs {
  const out: Abs = {
    shape: renameShape(a.shape, map),
    conf: a.conf,
  };
  if (a.term) out.term = renameTerm(a.term, map);
  if (a.pred) out.pred = renamePred(a.pred, map);
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
      return { k: "brand", name: s.name, shape: renameAbs(s.shape, map) };
    case "eff":
      return { k: "eff", eff: s.eff, inner: renameAbs(s.inner, map) };
    case "arr":
      return { k: "arr", element: renameAbs(s.element, map) };
    case "tuple": {
      const out: Shape = {
        k: "tuple",
        elements: s.elements.map((e) => renameAbs(e, map)),
      };
      if (s.rest) out.rest = renameAbs(s.rest, map);
      return out;
    }
    case "fn": {
      const out: Shape = { k: "fn", params: s.params };
      if (s.name !== undefined) out.name = s.name;
      if (s.paramTypes) out.paramTypes = s.paramTypes.map((t) => renameAbs(t, map));
      if (s.returnType) out.returnType = renameAbs(s.returnType, map);
      return out;
    }
    case "sum":
      return { k: "sum", members: s.members.map((m) => renameAbs(m, map)) };
    case "obj": {
      const slots: Record<string, { value: Abs; optional?: boolean; readonly?: boolean }> = {};
      for (const [k, slot] of Object.entries(s.slots)) {
        slots[k] = {
          value: renameAbs(slot.value, map),
          ...(slot.optional ? { optional: true } : {}),
          ...(slot.readonly ? { readonly: true } : {}),
        };
      }
      const out: Shape = { k: "obj", slots };
      if (s.index) {
        out.index = { key: renameAbs(s.index.key, map), value: renameAbs(s.index.value, map) };
      }
      if (s.open) out.open = true;
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
