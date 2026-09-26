/** 约束（Pred）：附着在项上的事实，可传播。 */

import type { Term } from "./term.ts";
import { termEquals, termToString, lit } from "./term.ts";

export type PrimName = "number" | "string" | "boolean" | "bigint" | "symbol";

/** JS `typeof` 完整结果域（8 标签）。Pred 的 typeof 节点用此域。 */
export type TypeofName =
  | "undefined"
  | "object"
  | "boolean"
  | "number"
  | "bigint"
  | "string"
  | "symbol"
  | "function";

/** typeof 标签全集（否定展开用；顺序稳定） */
export const TYPEOF_NAMES: readonly TypeofName[] = [
  "undefined",
  "object",
  "boolean",
  "number",
  "bigint",
  "string",
  "symbol",
  "function",
];

/** abs prim 标签 → typeof 标签（恒等嵌入）。abs prim 仍是 PrimName 子集。 */
export function primToTypeof(p: PrimName): TypeofName {
  return p;
}

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
  | { op: "typeof"; t: Term; type: TypeofName };

export const pTrue: Pred = { op: "true" };
export const pFalse: Pred = { op: "false" };

export const eq = (a: Term, b: Term): Pred => ({ op: "eq", a, b });
export const ne = (a: Term, b: Term): Pred => ({ op: "ne", a, b });
export const lt = (a: Term, b: Term): Pred => ({ op: "lt", a, b });
export const le = (a: Term, b: Term): Pred => ({ op: "le", a, b });
export const gt = (a: Term, b: Term): Pred => ({ op: "gt", a, b });
export const ge = (a: Term, b: Term): Pred => ({ op: "ge", a, b });
export const ptypeof = (t: Term, type: TypeofName): Pred => ({
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

/**
 * 逻辑否定（De Morgan）：¬(A∧B)=¬A∨¬B；¬(A∨B)=¬A∧¬B；双重否定消去。
 * typeof 否定展开为其余 TypeofName 标签的析取——8 标签域是 JS typeof 的
 * 完整结果域，展开健全且相对完备。
 */
export function negatePred(p: Pred): Pred {
  switch (p.op) {
    case "true":
      return pFalse;
    case "false":
      return pTrue;
    case "eq":
      return ne(p.a, p.b);
    case "ne":
      return eq(p.a, p.b);
    case "lt":
      return ge(p.a, p.b);
    case "le":
      return gt(p.a, p.b);
    case "gt":
      return le(p.a, p.b);
    case "ge":
      return lt(p.a, p.b);
    case "and":
      return or(...p.args.map(negatePred));
    case "or":
      return and(...p.args.map(negatePred));
    case "not":
      return p.arg;
    case "typeof":
      return or(
        ...TYPEOF_NAMES.filter((u) => u !== p.type).map((u) => ptypeof(p.t, u)),
      );
  }
}

export function predEquals(a: Pred, b: Pred): boolean {
  if (a === b) return true;
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
    case "or": {
      // 多重集相等：合取/析取交换律（顺序无关）
      if (b.op !== "and" && b.op !== "or") return false;
      const bag = [...(b as typeof a).args];
      if (bag.length !== a.args.length) return false;
      return a.args.every((x) => {
        const i = bag.findIndex((y) => predEquals(x, y));
        if (i < 0) return false;
        bag.splice(i, 1);
        return true;
      });
    }
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

/**
 * 外部蕴含 oracle（可选 SMT 等）。内建判定证不出时调用。
 * 返回 true=可证；false/undefined=仍不可证（保持 fail-closed）。
 * 默认无 oracle——纯内建区间/线性判定，不引入 solver 依赖。
 */
export type ImplicationOracle = (phi: Phi, pred: Pred) => boolean | undefined;

let implicationOracle: ImplicationOracle | undefined;

export function setImplicationOracle(fn: ImplicationOracle | undefined): void {
  implicationOracle = fn;
}

export function getImplicationOracle(): ImplicationOracle | undefined {
  return implicationOracle;
}

/** 简单蕴含：在区间/线性/字面量/typeof 可判定范围内判断 Φ ⊢ pred */
export function implies(phi: Phi, pred: Pred): boolean {
  if (pred.op === "true") return true;
  if (pred.op === "false") return false;
  if (phi.op === "false") return true;
  if (predEquals(phi, pred)) return true;
  if (phi.op === "and" && phi.args.some((c) => predEquals(c, pred))) return true;

  // 合取目标：Φ ⊢ A∧B  iff 逐支
  if (pred.op === "and") {
    return pred.args.every((a) => implies(phi, a));
  }

  // ¬P 目标：De Morgan / 双重否定展开为正向形式后再判
  if (pred.op === "not") {
    const expanded = negatePred(pred.arg);
    // 展开结果若仍是 not（非 typeof 的残余形态）——不得递归回自己
    if (expanded.op !== "not") {
      return implies(phi, expanded);
    }
    // 逆否：¬P ⊢ ¬Q  iff  Q ⊢ P
    if (phi.op === "not") {
      return implies(pred.arg, phi.arg);
    }
    if (phi.op === "and") {
      for (const c of phi.args) {
        if (c.op === "not" && implies(pred.arg, c.arg)) return true;
      }
    }
    // Φ 已知 typeof t=U (U≠T) ⇒ ¬(typeof t=T)（展开为 or 后的兜底）
    if (pred.arg.op === "typeof" && impliesNotTypeof(phi, pred.arg)) return true;
    return false;
  }

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

  // 上下文：等式类 + ne 收紧后的区间 + 线性原子
  const ctx = buildCtx(phi);
  if (proveInCtx(ctx, pred)) return true;

  // 字面量可判定
  if (decideLiteralPred(pred) === true) return true;

  // 可选外部 oracle（SMT 等）：内建证不出时最后一问
  if (implicationOracle && implicationOracle(phi, pred) === true) return true;
  return false;
}

/** Φ 含与 want 同项、不同 typeof 标签 → 蕴含 ¬want */
function impliesNotTypeof(
  phi: Phi,
  want: { t: Term; type: TypeofName },
): boolean {
  const conjs = phi.op === "and" ? phi.args : [phi];
  for (const c of conjs) {
    if (c.op === "typeof" && termEquals(c.t, want.t) && c.type !== want.type) {
      return true;
    }
  }
  return false;
}

type Interval = {
  lo?: { bound: number; strict: boolean };
  hi?: { bound: number; strict: boolean };
};

type Lin = {
  /** atom key → 系数；原子 = var id 或 length(t) / get(t,k) 等 app 项 */
  c: Map<string, number>;
  /** 常数 */
  k: number;
  /** 原子 key → Term（证明与展示用） */
  atoms: Map<string, Term>;
};

type Ctx = {
  /** 等式类代表（var id → rep） */
  parent: Map<string, string>;
  /** rep / atom key → 区间 */
  iv: Map<string, Interval>;
  /** 原子 key → Term */
  atoms: Map<string, Term>;
};

function termKey(t: Term): string {
  return termToString(t);
}

function findRep(ctx: Ctx, id: string): string {
  let r = ctx.parent.get(id) ?? id;
  while (r !== (ctx.parent.get(r) ?? r)) r = ctx.parent.get(r) ?? r;
  // 路径压缩
  let cur = id;
  while (cur !== r) {
    const next = ctx.parent.get(cur) ?? cur;
    ctx.parent.set(cur, r);
    cur = next;
  }
  return r;
}

function unionRep(ctx: Ctx, a: string, b: string): void {
  const ra = findRep(ctx, a);
  const rb = findRep(ctx, b);
  if (ra === rb) return;
  // 并区间
  const ia = ctx.iv.get(ra);
  const ib = ctx.iv.get(rb);
  const merged = mergeInterval(ia, ib);
  ctx.parent.set(ra, rb);
  if (merged) ctx.iv.set(rb, merged);
  else ctx.iv.delete(rb);
  if (ia) ctx.iv.delete(ra);
}

function mergeInterval(a?: Interval, b?: Interval): Interval | undefined {
  if (!a) return b ? { ...b } : undefined;
  if (!b) return { ...a };
  const out: Interval = {};
  // 取更紧的下界
  if (a.lo && b.lo) {
    out.lo =
      a.lo.bound > b.lo.bound ||
      (a.lo.bound === b.lo.bound && a.lo.strict && !b.lo.strict)
        ? a.lo
        : b.lo;
  } else out.lo = a.lo ?? b.lo;
  if (a.hi && b.hi) {
    out.hi =
      a.hi.bound < b.hi.bound ||
      (a.hi.bound === b.hi.bound && a.hi.strict && !b.hi.strict)
        ? a.hi
        : b.hi;
  } else out.hi = a.hi ?? b.hi;
  return out;
}

function tightenLo(iv: Interval, bound: number, strict: boolean): void {
  const cur = iv.lo;
  if (
    !cur ||
    bound > cur.bound ||
    (bound === cur.bound && strict && !cur.strict)
  ) {
    iv.lo = { bound, strict };
  }
}

function tightenHi(iv: Interval, bound: number, strict: boolean): void {
  const cur = iv.hi;
  if (
    !cur ||
    bound < cur.bound ||
    (bound === cur.bound && strict && !cur.strict)
  ) {
    iv.hi = { bound, strict };
  }
}

/** 项 → 线性形（var / lit / + / - / *const / length 等原子）；非线性返回 undefined */
function linOf(t: Term): Lin | undefined {
  const empty = (): Lin => ({ c: new Map(), k: 0, atoms: new Map() });
  const fromAtom = (key: string, term: Term): Lin => {
    const l = empty();
    l.c.set(key, 1);
    l.atoms.set(key, term);
    return l;
  };
  const add = (a: Lin, b: Lin): Lin => {
    const out = empty();
    for (const [k, v] of a.c) out.c.set(k, (out.c.get(k) ?? 0) + v);
    for (const [k, v] of b.c) out.c.set(k, (out.c.get(k) ?? 0) + v);
    out.k = a.k + b.k;
    for (const [k, v] of a.atoms) out.atoms.set(k, v);
    for (const [k, v] of b.atoms) out.atoms.set(k, v);
    return out;
  };
  const scale = (a: Lin, n: number): Lin => {
    const out = empty();
    for (const [k, v] of a.c) out.c.set(k, v * n);
    out.k = a.k * n;
    for (const [k, v] of a.atoms) out.atoms.set(k, v);
    return out;
  };
  const walk = (x: Term): Lin | undefined => {
    if (x.op === "lit") {
      if (typeof x.value !== "number") return undefined;
      const l = empty();
      l.k = x.value;
      return l;
    }
    if (x.op === "var") return fromAtom(x.id, x);
    // 原子 app：length(t) / get(t,k) / 其它不可分解应用
    if (x.op === "app") {
      if (x.fn === "+" && x.args.length === 2) {
        const a = walk(x.args[0]!);
        const b = walk(x.args[1]!);
        if (!a || !b) return undefined;
        return add(a, b);
      }
      if (x.fn === "-" && x.args.length === 1) {
        const a = walk(x.args[0]!);
        return a ? scale(a, -1) : undefined;
      }
      if (x.fn === "-" && x.args.length === 2) {
        const a = walk(x.args[0]!);
        const b = walk(x.args[1]!);
        if (!a || !b) return undefined;
        return add(a, scale(b, -1));
      }
      if (x.fn === "*" && x.args.length === 2) {
        const [a, b] = x.args as [Term, Term];
        const la = walk(a);
        const lb = walk(b);
        if (la && lb) {
          // 常数 × 线性
          if (la.c.size === 0) return scale(lb, la.k);
          if (lb.c.size === 0) return scale(la, lb.k);
          return undefined; // 非线性
        }
        return undefined;
      }
      // length / get / 其它 → 不可分解原子
      return fromAtom(termKey(x), x);
    }
    return undefined;
  };
  const out = walk(t);
  if (!out) return undefined;
  // 去掉零系数
  for (const [k, v] of [...out.c]) {
    if (v === 0) out.c.delete(k);
  }
  return out;
}

function linSub(a: Lin, b: Lin): Lin {
  const out: Lin = { c: new Map(), k: a.k - b.k, atoms: new Map() };
  for (const [k, v] of a.c) out.c.set(k, (out.c.get(k) ?? 0) + v);
  for (const [k, v] of b.c) out.c.set(k, (out.c.get(k) ?? 0) - v);
  for (const [k, v] of a.atoms) out.atoms.set(k, v);
  for (const [k, v] of b.atoms) out.atoms.set(k, v);
  for (const [k, v] of [...out.c]) {
    if (v === 0) out.c.delete(k);
  }
  return out;
}

/** 归一：比较 a op b → (a-b) op 0 */
function normCmp(
  op: "gt" | "ge" | "lt" | "le" | "eq" | "ne",
  a: Term,
  b: Term,
): { lin: Lin; op: "gt" | "ge" | "lt" | "le" | "eq" | "ne" } | undefined {
  const la = linOf(a);
  const lb = linOf(b);
  if (!la || !lb) return undefined;
  return { lin: linSub(la, lb), op };
}

function buildCtx(phi: Phi): Ctx {
  const ctx: Ctx = {
    parent: new Map(),
    iv: new Map(),
    atoms: new Map(),
  };
  const conjs: Pred[] = phi.op === "and" ? phi.args : [phi];
  const eqAtoms: Array<[string, string]> = [];
  const neFacts: Array<{ key: string; n: number }> = [];

  const ivFor = (key: string, term: Term): Interval => {
    ctx.atoms.set(key, term);
    let iv = ctx.iv.get(key);
    if (!iv) {
      iv = {};
      ctx.iv.set(key, iv);
    }
    return iv;
  };

  // var id 与 lin 归一到 atom key：单原子 + 常数平移统一进该原子区间
  const applyCmp = (
    op: "gt" | "ge" | "lt" | "le" | "eq",
    left: Term,
    right: Term,
  ): void => {
    const n = normCmp(op === "eq" ? "eq" : op, left, right);
    if (!n) return;
    const { lin, op: o } = n;
    // 纯常数：无可提取区间事实
    if (lin.c.size === 0) return;
    // 单原子：k 常数并入界
    if (lin.c.size === 1) {
      const [key, coeff] = [...lin.c.entries()][0]!;
      const term = lin.atoms.get(key)!;
      // coeff * atom + k  op  0  ⟺  atom  op  -k/coeff（注意 coeff 符号）
      if (coeff === 0) return;
      const bound = -lin.k / coeff;
      // 翻转：coeff < 0 时比较方向反转
      let realOp = o;
      if (coeff < 0) {
        realOp =
          o === "gt" ? "lt" : o === "lt" ? "gt" : o === "ge" ? "le" : o === "le" ? "ge" : o;
      }
      // 等式类代表（仅 var 进 union-find；length/get 等原子用自身 key）
      const isVar = term.op === "var";
      const storeKey = isVar ? findRep(ctx, term.id) : key;
      const iv = ivFor(storeKey, term);
      if (realOp === "gt") tightenLo(iv, bound, true);
      else if (realOp === "ge") tightenLo(iv, bound, false);
      else if (realOp === "lt") tightenHi(iv, bound, true);
      else if (realOp === "le") tightenHi(iv, bound, false);
      else if (realOp === "eq") {
        tightenLo(iv, bound, false);
        tightenHi(iv, bound, false);
      }
      return;
    }
    // 两原子差/和：x - y 形式记入特殊表——由 prove 时用原子区间合成
    // 这里只把「差 = 常数」收成等式类
    if (lin.c.size === 2 && o === "eq") {
      const entries = [...lin.c.entries()];
      const [k1, c1] = entries[0]!;
      const [k2, c2] = entries[1]!;
      if (c1 + c2 === 0 && Math.abs(c1) === 1) {
        // x - y + k = 0 ⇒ x = y - k（仅 var-var 且 |c|=1）
        const t1 = lin.atoms.get(k1)!;
        const t2 = lin.atoms.get(k2)!;
        if (t1.op === "var" && t2.op === "var" && lin.k === 0) {
          eqAtoms.push([t1.id, t2.id]);
        }
      }
    }
  };

  for (const c of conjs) {
    switch (c.op) {
      case "gt":
      case "ge":
      case "lt":
      case "le":
        applyCmp(c.op, c.a, c.b);
        break;
      case "eq": {
        applyCmp("eq", c.a, c.b);
        if (c.a.op === "var" && c.b.op === "var") {
          eqAtoms.push([c.a.id, c.b.id]);
        }
        break;
      }
      case "ne": {
        if (c.a.op === "var" && c.b.op === "lit" && typeof c.b.value === "number") {
          neFacts.push({ key: findRep(ctx, c.a.id), n: c.b.value });
        }
        if (c.b.op === "var" && c.a.op === "lit" && typeof c.a.value === "number") {
          neFacts.push({ key: findRep(ctx, c.b.id), n: c.a.value });
        }
        break;
      }
      default:
        break;
    }
  }

  for (const [a, b] of eqAtoms) unionRep(ctx, a, b);

  // ne 收紧：x ≠ n ∧ x ≥ n ⇒ x > n；x ≠ n ∧ x ≤ n ⇒ x < n
  for (const { key, n } of neFacts) {
    const rep = findRep(ctx, key);
    const iv = ctx.iv.get(rep);
    if (!iv) continue;
    if (iv.lo && !iv.lo.strict && iv.lo.bound === n) {
      iv.lo = { bound: n, strict: true };
    }
    if (iv.hi && !iv.hi.strict && iv.hi.bound === n) {
      iv.hi = { bound: n, strict: true };
    }
  }

  return ctx;
}

/**
 * 线性式的区间下/上界（独立合成：缺哪侧就缺哪侧）。
 * 系数符号决定用原子 lo 还是 hi；任一原子缺所需侧则该侧无界。
 */
function linInterval(
  ctx: Ctx,
  lin: Lin,
): { lo?: { bound: number; strict: boolean }; hi?: { bound: number; strict: boolean } } {
  let lo = lin.k;
  let hi = lin.k;
  let loStrict = false;
  let hiStrict = false;
  let hasLo = true;
  let hasHi = true;
  for (const [key, coeff] of lin.c) {
    const rep = findRep(ctx, key);
    const iv = ctx.iv.get(rep) ?? ctx.iv.get(key);
    if (!iv) return {};
    if (coeff > 0) {
      if (iv.lo) {
        lo += coeff * iv.lo.bound;
        if (iv.lo.strict) loStrict = true;
      } else hasLo = false;
      if (iv.hi) {
        hi += coeff * iv.hi.bound;
        if (iv.hi.strict) hiStrict = true;
      } else hasHi = false;
    } else {
      // 负系数：lo 用原子 hi，hi 用原子 lo
      if (iv.hi) {
        lo += coeff * iv.hi.bound;
        if (iv.hi.strict) loStrict = true;
      } else hasLo = false;
      if (iv.lo) {
        hi += coeff * iv.lo.bound;
        if (iv.lo.strict) hiStrict = true;
      } else hasHi = false;
    }
  }
  const out: { lo?: { bound: number; strict: boolean }; hi?: { bound: number; strict: boolean } } = {};
  if (hasLo) out.lo = { bound: lo, strict: loStrict };
  if (hasHi) out.hi = { bound: hi, strict: hiStrict };
  return out;
}

function proveInCtx(ctx: Ctx, pred: Pred): boolean {
  // typeof：同项不同标签否定已在上层；正标签需 Φ 显式给出
  if (pred.op === "typeof") {
    return false;
  }
  if (
    pred.op !== "eq" &&
    pred.op !== "ne" &&
    pred.op !== "gt" &&
    pred.op !== "ge" &&
    pred.op !== "lt" &&
    pred.op !== "le"
  ) {
    return false;
  }

  // 纯字面量
  const litAns = decideLiteralPred(pred);
  if (litAns !== undefined) return litAns;

  const norm = normCmp(pred.op, pred.a, pred.b);
  if (!norm) return false;
  const { lin, op } = norm;

  // 目标本身在 Φ 中（线性形相同）
  // 常数目标
  if (lin.c.size === 0) {
    if (op === "eq") return lin.k === 0;
    if (op === "ne") return lin.k !== 0;
    if (op === "gt") return lin.k > 0;
    if (op === "ge") return lin.k >= 0;
    if (op === "lt") return lin.k < 0;
    if (op === "le") return lin.k <= 0;
  }

  const iv = linInterval(ctx, lin);
  if (!iv.lo && !iv.hi) return false;

  // 用目标线性式的区间证 lin op 0
  const proveLinOp0 = (): boolean | undefined => {
    if (op === "gt") {
      if (!iv.lo) return undefined;
      if (iv.lo.strict) return iv.lo.bound >= 0;
      return iv.lo.bound > 0;
    }
    if (op === "ge") {
      if (!iv.lo) return undefined;
      return iv.lo.bound >= 0;
    }
    if (op === "lt") {
      if (!iv.hi) return undefined;
      if (iv.hi.strict) return iv.hi.bound <= 0;
      return iv.hi.bound < 0;
    }
    if (op === "le") {
      if (!iv.hi) return undefined;
      return iv.hi.bound <= 0;
    }
    if (op === "eq") {
      // 夹逼
      if (!iv.lo || !iv.hi) return undefined;
      if (iv.lo.strict && iv.lo.bound >= 0) return false;
      if (iv.hi.strict && iv.hi.bound <= 0) return false;
      if (!iv.lo.strict && iv.lo.bound > 0) return false;
      if (!iv.hi.strict && iv.hi.bound < 0) return false;
      if (!iv.lo.strict && !iv.hi.strict && iv.lo.bound === 0 && iv.hi.bound === 0) {
        return true;
      }
      return undefined;
    }
    // ne：区间夹成单点且恰为 0 → 证伪；否则不可证
    if (op === "ne") {
      if (
        iv.lo &&
        iv.hi &&
        !iv.lo.strict &&
        !iv.hi.strict &&
        iv.lo.bound === 0 &&
        iv.hi.bound === 0
      ) {
        return false;
      }
      return undefined;
    }
    return undefined;
  };

  const r = proveLinOp0();
  return r === true;
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
