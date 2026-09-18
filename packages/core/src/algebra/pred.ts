/** 约束（Pred）：附着在项上的事实，可传播。 */

import type { Term } from "./term.ts";
import { termEquals, termToString, lit } from "./term.ts";

export type PrimName = "number" | "string" | "boolean" | "bigint" | "symbol";

export type Pred =
  | { op: "true" }
  | { op: "false" }
  | { op: "eq"; a: Term; b: Term }
  | { op: "ne"; a: Term; b: Term }
  | { op: "lt"; a: Term; b: Term }
  | { op: "le"; a: Term; b: Term }
  | { op: "gt"; a: Term; b: Term }
  | { op: "ge"; a: Term; b: Term }
  | { op: "and"; args: Pred[] }
  | { op: "or"; args: Pred[] }
  | { op: "not"; arg: Pred }
  | { op: "typeof"; t: Term; type: PrimName };

export const pTrue: Pred = { op: "true" };
export const pFalse: Pred = { op: "false" };

export const eq = (a: Term, b: Term): Pred => ({ op: "eq", a, b });
export const ne = (a: Term, b: Term): Pred => ({ op: "ne", a, b });
export const lt = (a: Term, b: Term): Pred => ({ op: "lt", a, b });
export const le = (a: Term, b: Term): Pred => ({ op: "le", a, b });
export const gt = (a: Term, b: Term): Pred => ({ op: "gt", a, b });
export const ge = (a: Term, b: Term): Pred => ({ op: "ge", a, b });
export const ptypeof = (t: Term, type: PrimName): Pred => ({
  op: "typeof",
  t,
  type,
});

export function and(...preds: Pred[]): Pred {
  const flat: Pred[] = [];
  const pushUnique = (p: Pred): void => {
    if (flat.some((q) => predEquals(q, p))) return;
    flat.push(p);
  };
  for (const p of preds) {
    if (p.op === "true") continue;
    if (p.op === "false") return pFalse;
    if (p.op === "and") {
      for (const q of p.args) pushUnique(q);
    } else pushUnique(p);
  }
  if (flat.length === 0) return pTrue;
  if (flat.length === 1) return flat[0]!;
  return { op: "and", args: flat };
}

export function or(...preds: Pred[]): Pred {
  const flat: Pred[] = [];
  const pushUnique = (p: Pred): void => {
    if (flat.some((q) => predEquals(q, p))) return;
    flat.push(p);
  };
  for (const p of preds) {
    if (p.op === "false") continue;
    if (p.op === "true") return pTrue;
    if (p.op === "or") {
      for (const q of p.args) pushUnique(q);
    } else pushUnique(p);
  }
  if (flat.length === 0) return pFalse;
  if (flat.length === 1) return flat[0]!;
  return { op: "or", args: flat };
}

export function not(p: Pred): Pred {
  if (p.op === "true") return pFalse;
  if (p.op === "false") return pTrue;
  if (p.op === "not") return p.arg;
  return { op: "not", arg: p };
}

export function predEquals(a: Pred, b: Pred): boolean {
  if (a.op !== b.op) return false;
  switch (a.op) {
    case "true":
    case "false":
      return true;
    case "eq":
    case "ne":
    case "lt":
    case "le":
    case "gt":
    case "ge":
      return (
        b.op === a.op &&
        termEquals(a.a, (b as typeof a).a) &&
        termEquals(a.b, (b as typeof a).b)
      );
    case "and":
    case "or":
      return (
        (b.op === "and" || b.op === "or") &&
        a.args.length === (b as typeof a).args.length &&
        a.args.every((x, i) => predEquals(x, (b as typeof a).args[i]!))
      );
    case "not":
      return b.op === "not" && predEquals(a.arg, b.arg);
    case "typeof":
      return (
        b.op === "typeof" &&
        a.type === b.type &&
        termEquals(a.t, b.t)
      );
  }
}

export function predToString(p: Pred): string {
  switch (p.op) {
    case "true":
      return "true";
    case "false":
      return "false";
    case "eq":
      return `${termToString(p.a)} = ${termToString(p.b)}`;
    case "ne":
      return `${termToString(p.a)} ≠ ${termToString(p.b)}`;
    case "lt":
      return `${termToString(p.a)} < ${termToString(p.b)}`;
    case "le":
      return `${termToString(p.a)} ≤ ${termToString(p.b)}`;
    case "gt":
      return `${termToString(p.a)} > ${termToString(p.b)}`;
    case "ge":
      return `${termToString(p.a)} ≥ ${termToString(p.b)}`;
    case "and":
      return p.args.map(predToString).join(" ∧ ");
    case "or":
      return `(${p.args.map(predToString).join(" ∨ ")})`;
    case "not":
      return `¬(${predToString(p.arg)})`;
    case "typeof":
      return `typeof ${termToString(p.t)} = "${p.type}"`;
  }
}

/** 把 pred 里的 Term 用 subst 替换（用于 bound 变量重命名等） */
export function substPred(p: Pred, subst: (t: Term) => Term): Pred {
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
      return { ...p, a: subst(p.a), b: subst(p.b) } as Pred;
    case "and":
    case "or":
      return { ...p, args: p.args.map((x) => substPred(x, subst)) };
    case "not":
      return { op: "not", arg: substPred(p.arg, subst) };
    case "typeof":
      return { op: "typeof", t: subst(p.t), type: p.type };
  }
}

/** 收集 pred 中出现的自由变量 */
export function predVars(p: Pred): Set<string> {
  const acc = new Set<string>();
  const walkTerm = (t: Term): void => {
    if (t.op === "var") acc.add(t.id);
    if (t.op === "app") t.args.forEach(walkTerm);
  };
  const walk = (p: Pred): void => {
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
        walkTerm(p.a);
        walkTerm(p.b);
        return;
      case "and":
      case "or":
        p.args.forEach(walk);
        return;
      case "not":
        walk(p.arg);
        return;
      case "typeof":
        walkTerm(p.t);
        return;
    }
  };
  walk(p);
  return acc;
}

/** 约束环境 Φ：Pred 的合取 */
export type Phi = Pred;

export const emptyPhi: Phi = pTrue;
export const phiAnd = and;

/** 简单蕴含：在区间/字面量可判定范围内判断 Φ ⊢ pred */
export function implies(phi: Phi, pred: Pred): boolean {
  if (pred.op === "true") return true;
  if (pred.op === "false") return false;
  if (phi.op === "false") return true;
  if (predEquals(phi, pred)) return true;
  if (phi.op === "and" && phi.args.some((c) => predEquals(c, pred))) return true;

  // or 蕴含（字面量集 / 析取收窄）：
  //   or(A…) ⇒ P     iff 每个 A ⇒ P
  //   Φ ⇒ or(B…)     iff 存在 B 使 Φ ⇒ B
  // 先于 extractBounds：or 不是区间事实，不能当 bound 提取
  if (phi.op === "or") {
    return phi.args.every((a) => implies(a, pred));
  }
  if (pred.op === "or") {
    return pred.args.some((b) => implies(phi, b));
  }

  if (phi.op === "true") {
    // 无约束时，纯字面量比较可判定
    return decideLiteralPred(pred) === true;
  }

  // 尝试从 Φ 提取同一 term 的界，做区间蕴含
  const bounds = extractBounds(phi);
  const implied = impliesViaBounds(pred, bounds);
  if (implied !== undefined) return implied;

  // 字面量可判定
  const litAns = decideLiteralPred(pred);
  if (litAns !== undefined) return litAns;
  return false;
}

type Bounds = {
  /** term key → { lo 独占? hi 独占? } */
  lo: Map<string, { bound: number; strict: boolean }>;
  hi: Map<string, { bound: number; strict: boolean }>;
};

function termKey(t: Term): string {
  return termToString(t);
}

function extractBounds(phi: Phi): Bounds {
  const lo = new Map<string, { bound: number; strict: boolean }>();
  const hi = new Map<string, { bound: number; strict: boolean }>();
  const conjs: Pred[] = phi.op === "and" ? phi.args : [phi];
  for (const c of conjs) {
    if (c.op === "gt" || c.op === "ge") {
      // a > b  or a ≥ b，且 b 是字面量
      if (c.b.op === "lit" && typeof c.b.value === "number") {
        const k = termKey(c.a);
        const cur = lo.get(k);
        const next = { bound: c.b.value, strict: c.op === "gt" };
        if (!cur || next.bound > cur.bound || (next.bound === cur.bound && next.strict)) {
          lo.set(k, next);
        }
      }
      // 反向：字面量 > term  ⇒ term < 字面量
      if (c.a.op === "lit" && typeof c.a.value === "number") {
        const k = termKey(c.b);
        const cur = hi.get(k);
        const next = { bound: c.a.value, strict: c.op === "gt" };
        if (!cur || next.bound < cur.bound || (next.bound === cur.bound && next.strict)) {
          hi.set(k, next);
        }
      }
    }
    if (c.op === "lt" || c.op === "le") {
      if (c.b.op === "lit" && typeof c.b.value === "number") {
        const k = termKey(c.a);
        const cur = hi.get(k);
        const next = { bound: c.b.value, strict: c.op === "lt" };
        if (!cur || next.bound < cur.bound || (next.bound === cur.bound && next.strict)) {
          hi.set(k, next);
        }
      }
      if (c.a.op === "lit" && typeof c.a.value === "number") {
        const k = termKey(c.b);
        const cur = lo.get(k);
        const next = { bound: c.a.value, strict: c.op === "lt" };
        if (!cur || next.bound > cur.bound || (next.bound === cur.bound && next.strict)) {
          lo.set(k, next);
        }
      }
    }
    if (c.op === "eq" && c.a.op === "var" && c.b.op === "lit" && typeof c.b.value === "number") {
      lo.set(c.a.id, { bound: c.b.value, strict: false });
      hi.set(c.a.id, { bound: c.b.value, strict: false });
    }
  }
  return { lo, hi };
}

/**
 * 用区间界蕴含原子比较。
 * 支持：term > n / ≥ n / < n / ≤ n，以及 term+lit 形式的简单平移。
 * 返回 undefined 表示无法判定。
 */
function impliesViaBounds(pred: Pred, bounds: Bounds): boolean | undefined {
  // eq：lo 与 hi 夹逼同一数值（非严格）→ x = n 可 discharge
  if (pred.op === "eq") {
    const left = pred.a;
    const right = pred.b;
    if (right.op !== "lit" || typeof right.value !== "number") return undefined;
    const n = right.value;
    if (left.op === "var") {
      return eqFromBounds(left.id, n, bounds);
    }
    if (left.op === "app" && left.fn === "+" && left.args.length === 2) {
      const [a, b] = left.args as [Term, Term];
      if (a.op === "var" && b.op === "lit" && typeof b.value === "number") {
        return eqFromBounds(a.id, n - b.value, bounds);
      }
      if (b.op === "var" && a.op === "lit" && typeof a.value === "number") {
        return eqFromBounds(b.id, n - a.value, bounds);
      }
    }
    return undefined;
  }
  if (
    pred.op !== "gt" &&
    pred.op !== "ge" &&
    pred.op !== "lt" &&
    pred.op !== "le"
  ) {
    return undefined;
  }
  // 归一：只处理 term ⊕ lit 比较 lit 的情况
  const left = pred.a;
  const right = pred.b;
  if (right.op !== "lit" || typeof right.value !== "number") return undefined;
  const n = right.value;

  // 直接 term
  if (left.op === "var") {
    return cmpVar(left.id, pred.op, n, bounds);
  }
  // term = x + k
  if (left.op === "app" && left.fn === "+" && left.args.length === 2) {
    const [a, b] = left.args as [Term, Term];
    if (a.op === "var" && b.op === "lit" && typeof b.value === "number") {
      // x + k  op  n  ⟺  x  op  (n - k)
      return cmpVar(a.id, pred.op, n - b.value, bounds);
    }
    if (b.op === "var" && a.op === "lit" && typeof a.value === "number") {
      return cmpVar(b.id, pred.op, n - a.value, bounds);
    }
  }
  // 纯字面量已在外层处理
  return undefined;
}

function eqFromBounds(id: string, n: number, bounds: Bounds): boolean | undefined {
  const lo = bounds.lo.get(id);
  const hi = bounds.hi.get(id);
  if (!lo || !hi) return undefined;
  // x ≥ n ∧ x ≤ n（非严格）→ x = n
  const loCovers = lo.strict ? lo.bound <= n : lo.bound <= n;
  const hiCovers = hi.strict ? hi.bound >= n : hi.bound >= n;
  // 严格界：x > n 不能蕴含 x = n；x < n 也不能
  if (lo.strict && lo.bound >= n) return false; // x > lo≥n ⇒ x≠n
  if (hi.strict && hi.bound <= n) return false;
  if (!lo.strict && lo.bound > n) return false; // x ≥ lo>n ⇒ x≠n
  if (!hi.strict && hi.bound < n) return false;
  // 夹逼成立当 lo 允许 n 且 hi 允许 n，且界卡死在 n
  if (!loCovers || !hiCovers) return undefined;
  if (!lo.strict && !hi.strict && lo.bound === n && hi.bound === n) return true;
  return undefined;
}

function cmpVar(
  id: string,
  op: "gt" | "ge" | "lt" | "le",
  n: number,
  bounds: Bounds,
): boolean | undefined {
  const lo = bounds.lo.get(id);
  const hi = bounds.hi.get(id);
  // x > n：需要 lo ≥ n（若 strict lo 则 lo ≥ n；若 lo = n 且 non-strict 则 x≥n 不能推出 x>n）
  if (op === "gt") {
    if (!lo) return undefined;
    if (lo.strict) return lo.bound >= n;
    return lo.bound > n;
  }
  if (op === "ge") {
    if (!lo) return undefined;
    return lo.bound >= n;
  }
  if (op === "lt") {
    if (!hi) return undefined;
    if (hi.strict) return hi.bound <= n;
    return hi.bound < n;
  }
  if (op === "le") {
    if (!hi) return undefined;
    return hi.bound <= n;
  }
  return undefined;
}

function decideLiteralPred(pred: Pred): boolean | undefined {
  if (
    pred.op === "eq" ||
    pred.op === "ne" ||
    pred.op === "lt" ||
    pred.op === "le" ||
    pred.op === "gt" ||
    pred.op === "ge"
  ) {
    if (pred.a.op === "lit" && pred.b.op === "lit") {
      const a = pred.a.value;
      const b = pred.b.value;
      switch (pred.op) {
        case "eq":
          return a === b;
        case "ne":
          return a !== b;
        case "lt":
          return typeof a === "number" && typeof b === "number" && a < b;
        case "le":
          return typeof a === "number" && typeof b === "number" && a <= b;
        case "gt":
          return typeof a === "number" && typeof b === "number" && a > b;
        case "ge":
          return typeof a === "number" && typeof b === "number" && a >= b;
      }
    }
  }
  return undefined;
}

/** 便捷：数字下界 */
export function gtNum(term: Term, n: number): Pred {
  return gt(term, lit(n));
}
export function geNum(term: Term, n: number): Pred {
  return ge(term, lit(n));
}
export function ltNum(term: Term, n: number): Pred {
  return lt(term, lit(n));
}
export function leNum(term: Term, n: number): Pred {
  return le(term, lit(n));
}
