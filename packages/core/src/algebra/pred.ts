/** 约束（Pred）：附着在项上的事实，可传播。 */

import type { Term } from "./term.ts";
import { termEquals, termToString, lit } from "./term.ts";
import {
  createScopedSlot,
  registerCollectorScopeParticipant,
} from "./collector-scope.ts";

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
  | { op: "typeof"; t: Term; type: TypeofName }
  /**
   * 显式有限证据：t 是有限数（非 NaN/±Inf）。
   * 在场时允许线性环化简（x-x=0、k*(x+y) 分配等）；
   * 默认关闭——无此谓词（或由 typeof=number + 双侧有限界自动导出）时
   * 仍 fail-closed，与 BUG-001 / DEC-007A 口径一致。
   */
  | { op: "assumeFinite"; t: Term };

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
/** 显式有限证据：t 为有限数（非 NaN/±Inf），开启线性环化简 */
export const assumeFinite = (t: Term): Pred => ({ op: "assumeFinite", t });

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
 *
 * 关系比较（lt/le/gt/ge）的否定 **不是** 全序对偶：JS 里 NaN 参与时
 * 全部关系为 false，故 ¬(x<5) 真而 x≥5 假。精确否定是 not(lt)；
 * 正向全序事实（Φ ⊢ x≥5 ⇒ x<5 为假）仍由 totalOrderDual 处理。
 * eq↔ne 是精确否定，不受 NaN 影响。
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
    case "le":
    case "gt":
    case "ge":
      return { op: "not", arg: p };
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
    case "assumeFinite":
      return { op: "not", arg: p };
  }
}

/**
 * 全序对偶（仅作「正向事实 ⇒ 比较为假」用）：x≥5 在 Φ 中 ⇒ x<5 为假。
 * 不得当 ¬(x<5) 用——反向在 NaN 上不成立。
 */
export function totalOrderDual(p: Pred): Pred | undefined {
  if (p.op === "lt") return ge(p.a, p.b);
  if (p.op === "le") return gt(p.a, p.b);
  if (p.op === "gt") return le(p.a, p.b);
  if (p.op === "ge") return lt(p.a, p.b);
  return undefined;
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
        termEquals(a.t, (b as typeof a).t)
      );
    case "assumeFinite":
      return b.op === "assumeFinite" && termEquals(a.t, (b as typeof a).t);
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
    case "assumeFinite":
      return `assumeFinite(${termToString(p.t)})`;
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
    case "assumeFinite":
      return { op: "assumeFinite", t: subst(p.t) };
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
      case "assumeFinite":
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

const implicationOracleSlot = createScopedSlot<ImplicationOracle | undefined>(
  () => undefined,
);
registerCollectorScopeParticipant((body) => implicationOracleSlot.runScoped(body));

export function setImplicationOracle(fn: ImplicationOracle | undefined): void {
  implicationOracleSlot.set(fn);
}

export function getImplicationOracle(): ImplicationOracle | undefined {
  return implicationOracleSlot.get();
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
    // 全序对偶正向：Φ ⊢ x≥y ⇒ ¬(x<y)（反向不成立——NaN）
    const dual = totalOrderDual(pred.arg);
    if (dual && implies(phi, dual)) return true;
    // 逆否：¬P ⊢ ¬Q  iff  Q ⊢ P
    if (phi.op === "not") {
      return implies(pred.arg, phi.arg);
    }
    if (phi.op === "and") {
      for (const c of phi.args) {
        if (c.op === "not" && implies(pred.arg, c.arg)) return true;
        if (dual && predEquals(c, dual)) return true;
      }
    }
    if (dual && predEquals(phi, dual)) return true;
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
  const implicationOracle = implicationOracleSlot.get();
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
  /**
   * 线性形是否可按实数环语义使用。IEEE 下 x-x / 0*x / 异号合并对
   * ±Infinity/NaN 不成立（对齐 arithmetic.ts/term.ts 禁止 x*0=0），
   * 构造中一旦出现此类化简即置 false，证明侧 fail-closed。
   */
  ieeeOk: boolean;
};

type Ctx = {
  /** 等式类代表（var id → rep） */
  parent: Map<string, string>;
  /** rep / atom key → 区间 */
  iv: Map<string, Interval>;
  /** 原子 key → Term */
  atoms: Map<string, Term>;
  /**
   * 已知有限（非 NaN/±Inf）的原子 key 集合。
   * 来源：显式 assumeFinite(t) 谓词，或 typeof t=number ∧ 双侧有限界自动导出。
   * 在场原子允许线性环化简（消去/分配）；缺省 fail-closed。
   */
  finite: Set<string>;
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
function linOf(t: Term, finite?: ReadonlySet<string>): Lin | undefined {
  const empty = (): Lin => ({ c: new Map(), k: 0, atoms: new Map(), ieeeOk: true });
  const fromAtom = (key: string, term: Term): Lin => {
    const l = empty();
    l.c.set(key, 1);
    l.atoms.set(key, term);
    return l;
  };
  /** 线性形中所有原子 key 是否都在 finite 集合内 */
  const allFinite = (lin: Lin): boolean =>
    finite !== undefined && [...lin.c.keys()].every((k) => finite.has(k));
  const add = (a: Lin, b: Lin): Lin => {
    const out = empty();
    out.ieeeOk = a.ieeeOk && b.ieeeOk;
    for (const [k, v] of a.c) out.c.set(k, (out.c.get(k) ?? 0) + v);
    for (const [k, v] of b.c) {
      const prev = out.c.get(k) ?? 0;
      // 同原子异号合并（含 x-x）：IEEE 下 Inf-Inf/NaN 按环消去不成立
      // 有 finite 证据时该原子非 NaN/±Inf，消去安全
      if (prev !== 0 && v !== 0 && prev > 0 !== v > 0) {
        if (!finite?.has(k)) out.ieeeOk = false;
      }
      out.c.set(k, prev + v);
    }
    out.k = a.k + b.k;
    for (const [k, v] of a.atoms) out.atoms.set(k, v);
    for (const [k, v] of b.atoms) out.atoms.set(k, v);
    return out;
  };
  const scale = (a: Lin, n: number): Lin => {
    const out = empty();
    out.ieeeOk = a.ieeeOk;
    for (const [k, v] of a.c) out.c.set(k, v * n);
    out.k = a.k * n;
    for (const [k, v] of a.atoms) out.atoms.set(k, v);
    // 0*x 折 0 不可用：NaN*0 / Inf*0 为 NaN；有 finite 证据时可折
    if (n === 0 && a.atoms.size > 0 && !allFinite(a)) out.ieeeOk = false;
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
          // 双常量：IEEE 字面量乘积（0*Inf=NaN 等按 JS 折）
          if (la.c.size === 0 && lb.c.size === 0) {
            const out = empty();
            out.k = la.k * lb.k;
            return out;
          }
          // 常数 × 线性式：单原子纯乘积始终可缩放；
          // 分配律 k*(c1*x1+…+k0) 仅在所有原子有 finite 证据时启用
          const scaleAtom = (lin: Lin, k: number, whole: Term): Lin | undefined => {
            // 0*x=0 仅在 x 有 finite 证据时成立（Inf*0=NaN）
            if (k === 0) {
              if (allFinite(lin)) return scale(lin, 0);
              return fromAtom(termKey(whole), whole);
            }
            if (!Number.isFinite(k)) return fromAtom(termKey(whole), whole);
            // 单原子纯乘积（无常数项）：表示该乘积本身，非分配律
            if (lin.c.size === 1 && lin.k === 0) return scale(lin, k);
            // 多原子/带常数项：分配律在 IEEE 溢出时可不等，
            // 仅当所有原子已证有限时才按环展开
            if (allFinite(lin)) return scale(lin, k);
            return fromAtom(termKey(whole), whole);
          };
          if (la.c.size === 0) return scaleAtom(lb, la.k, x);
          if (lb.c.size === 0) return scaleAtom(la, lb.k, x);
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

function linSub(a: Lin, b: Lin, finite?: ReadonlySet<string>): Lin {
  // 比较归一 a op b → (a-b) op 0 的差式：
  // 同原子两侧同时出现时（含 x-x、2x-x、x+y-y），±Inf 上实际是 Inf-Inf=NaN，
  // 系数合并不再对应真实差值——与 linOf add 异号合并同口径置 ieeeOk=false。
  // 有 finite 证据的原子消去安全，不置 false。
  // 反身比较（eq(x,x)/ge(x,x)）不走减法，见 proveCmpDirect。
  let cancel = false;
  for (const k of a.c.keys()) {
    const av = a.c.get(k) ?? 0;
    const bv = b.c.get(k) ?? 0;
    if (av !== 0 && bv !== 0) {
      if (!finite?.has(k)) {
        cancel = true;
        break;
      }
    }
  }
  const kDiff = a.k - b.k;
  const out: Lin = {
    c: new Map(),
    k: kDiff,
    atoms: new Map(),
    ieeeOk: a.ieeeOk && b.ieeeOk && !cancel && !Number.isNaN(kDiff),
  };
  for (const [k, v] of a.c) out.c.set(k, (out.c.get(k) ?? 0) + v);
  for (const [k, v] of b.c) out.c.set(k, (out.c.get(k) ?? 0) - v);
  for (const [k, v] of a.atoms) out.atoms.set(k, v);
  for (const [k, v] of b.atoms) out.atoms.set(k, v);
  for (const [k, v] of [...out.c]) {
    if (v === 0) out.c.delete(k);
  }
  return out;
}

/** 两线性形系数与常数全同（环语义下值相同） */
function linFormsEqual(a: Lin, b: Lin): boolean {
  if (!Object.is(a.k, b.k)) return false;
  if (a.c.size !== b.c.size) return false;
  for (const [k, v] of a.c) {
    if ((b.c.get(k) ?? 0) !== v) return false;
  }
  return true;
}

/** 归一：比较 a op b → (a-b) op 0 */
function normCmp(
  op: "gt" | "ge" | "lt" | "le" | "eq" | "ne",
  a: Term,
  b: Term,
  finite?: ReadonlySet<string>,
): { lin: Lin; op: "gt" | "ge" | "lt" | "le" | "eq" | "ne" } | undefined {
  const la = linOf(a, finite);
  const lb = linOf(b, finite);
  if (!la || !lb) return undefined;
  return { lin: linSub(la, lb, finite), op };
}

/**
 * 线性形是否可能取 NaN：
 * - 任一原子缺少区间事实（值未知，可能是 NaN）；
 * - 常数或区间端点已是 NaN；
 * - ieeeOk=false（环消去形已不代表真实值）；
 * - 不同加项可分别取 +Inf 与 -Inf（Inf+(-Inf)=NaN）。
 * 关系比较（eq/ge/le/gt/lt）在 NaN 上一律为 false，故必须先排除 NaN。
 */
function linMayBeNaN(ctx: Ctx, lin: Lin): boolean {
  if (!lin.ieeeOk) return true;
  if (Number.isNaN(lin.k)) return true;
  // 所有原子有 finite 证据：环语义下加法不产生 NaN
  //（溢出至 ±Inf 仍非 NaN；NaN 常数已在上一行拦截）
  if (lin.c.size > 0 && [...lin.c.keys()].every((k) => ctx.finite.has(k))) {
    return false;
  }
  type Dir = { pos: boolean; neg: boolean };
  const parts: Dir[] = [];
  if (lin.k === Infinity || lin.k === -Infinity) {
    parts.push({ pos: lin.k === Infinity, neg: lin.k === -Infinity });
  }
  for (const [key, coeff] of lin.c) {
    if (coeff === 0) continue;
    const rep = findRep(ctx, key);
    const iv = ctx.iv.get(rep) ?? ctx.iv.get(key);
    if (!iv) return true;
    if (iv.lo && Number.isNaN(iv.lo.bound)) return true;
    if (iv.hi && Number.isNaN(iv.hi.bound)) return true;
    const atomPos = iv.hi === undefined || iv.hi.bound === Infinity;
    const atomNeg = iv.lo === undefined || iv.lo.bound === -Infinity;
    if (coeff > 0) parts.push({ pos: atomPos, neg: atomNeg });
    else parts.push({ pos: atomNeg, neg: atomPos });
  }
  // 不同加项分别可为 +Inf 与 -Inf ⇒ Inf+(-Inf)=NaN
  for (let i = 0; i < parts.length; i++) {
    for (let j = 0; j < parts.length; j++) {
      if (i !== j && parts[i]!.pos && parts[j]!.neg) return true;
    }
  }
  return false;
}

/**
 * 两侧直接比较（不经 a-b 归一）。±Inf 上 a-b op 0 与 a op b 不等价
 * （eq(Inf,Inf) 真而 Inf-Inf=NaN 假；ne(Inf,Inf) 假而 NaN!==0 真），
 * 故 eq/ge/le/ne 直接比较两侧区间（proveInCtx 对 gt/lt 仍可用减法归一：
 * `a>b` 与 `a-b>0` 在 IEEE 上等价）。
 * 反身 a op a：eq/ge/le 在非 NaN 时为真；ne 在恒 NaN 时为真。
 */
function proveCmpDirect(
  ctx: Ctx,
  op: "gt" | "ge" | "lt" | "le" | "eq" | "ne",
  a: Term,
  b: Term,
): boolean {
  // 反身比较：比较语义（a===a / a≥a），非项内减法（x-x 在 ±Inf 上为 NaN）
  if (termEquals(a, b)) {
    const la = linOf(a, ctx.finite);
    if (op === "eq" || op === "ge" || op === "le") {
      return la !== undefined && !linMayBeNaN(ctx, la);
    }
    if (op === "ne") {
      // a!==a 仅当 a 恒为 NaN
      if (!la || !la.ieeeOk) return false;
      return la.c.size === 0 && Number.isNaN(la.k);
    }
    return false; // gt/lt(a,a) 恒 false
  }

  const la = linOf(a, ctx.finite);
  const lb = linOf(b, ctx.finite);
  if (!la || !lb) return false;
  if (!la.ieeeOk || !lb.ieeeOk) return false;

  if (op === "ne") {
    // 任一侧恒 NaN ⇒ a!==b 恒真
    if (la.c.size === 0 && Number.isNaN(la.k)) return true;
    if (lb.c.size === 0 && Number.isNaN(lb.k)) return true;
    const ivA = linInterval(ctx, la);
    const ivB = linInterval(ctx, lb);
    if (!ivA.lo && !ivA.hi) return false;
    if (!ivB.lo && !ivB.hi) return false;
    // 任一侧可能 NaN ⇒ a!==b 可真可假，不可一概而论
    if (linMayBeNaN(ctx, la) || linMayBeNaN(ctx, lb)) return false;
    // 区间可分（含端点严格性）⇒ a≠b
    if (ivA.hi && ivB.lo) {
      if (ivA.hi.bound < ivB.lo.bound) return true;
      if (ivA.hi.bound === ivB.lo.bound && (ivA.hi.strict || ivB.lo.strict)) {
        return true;
      }
    }
    if (ivA.lo && ivB.hi) {
      if (ivA.lo.bound > ivB.hi.bound) return true;
      if (ivA.lo.bound === ivB.hi.bound && (ivA.lo.strict || ivB.hi.strict)) {
        return true;
      }
    }
    return false;
  }

  // eq/ge/le/gt/lt：任一侧可能 NaN ⇒ 比较为 false，不可证
  if (linMayBeNaN(ctx, la) || linMayBeNaN(ctx, lb)) return false;

  // 同线性形（系数与常数全同）：环语义下两侧值相同
  // （x+y-y 与 x 消去后同形；2*x 与 x+x 同形）
  if (linFormsEqual(la, lb)) {
    return op === "eq" || op === "ge" || op === "le";
  }

  const ivA = linInterval(ctx, la);
  const ivB = linInterval(ctx, lb);

  if (op === "eq") {
    // 两侧夹逼到同一非严格点
    if (!ivA.lo || !ivA.hi || !ivB.lo || !ivB.hi) return false;
    if (ivA.lo.strict || ivA.hi.strict || ivB.lo.strict || ivB.hi.strict) {
      return false;
    }
    return (
      ivA.lo.bound === ivA.hi.bound &&
      ivA.lo.bound === ivB.lo.bound &&
      ivA.lo.bound === ivB.hi.bound
    );
  }

  // 端点比较：a op b 对所有取值成立
  if (op === "ge") {
    if (!ivA.lo || !ivB.hi) return false;
    return ivA.lo.bound >= ivB.hi.bound;
  }
  if (op === "gt") {
    if (!ivA.lo || !ivB.hi) return false;
    if (ivA.lo.bound > ivB.hi.bound) return true;
    return (
      ivA.lo.bound === ivB.hi.bound && (ivA.lo.strict || ivB.hi.strict)
    );
  }
  if (op === "le") {
    if (!ivA.hi || !ivB.lo) return false;
    return ivA.hi.bound <= ivB.lo.bound;
  }
  // lt
  if (!ivA.hi || !ivB.lo) return false;
  if (ivA.hi.bound < ivB.lo.bound) return true;
  return ivA.hi.bound === ivB.lo.bound && (ivA.hi.strict || ivB.lo.strict);
}

function buildCtx(phi: Phi): Ctx {
  const ctx: Ctx = {
    parent: new Map(),
    iv: new Map(),
    atoms: new Map(),
    finite: new Set(),
  };
  const conjs: Pred[] = phi.op === "and" ? phi.args : [phi];
  const eqAtoms: Array<[string, string]> = [];
  const neFacts: Array<{ key: string; n: number }> = [];
  /** typeof t=number 的项 key（自动导出有限时用） */
  const typeofNumberKeys = new Set<string>();

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
    // IEEE 不健全线性形（x-x / 0*x 等环消去）不提取事实
    if (!lin.ieeeOk) return;
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
      case "typeof": {
        if (c.type === "number") {
          typeofNumberKeys.add(termKey(c.t));
          if (c.t.op === "var") typeofNumberKeys.add(c.t.id);
        }
        break;
      }
      case "assumeFinite": {
        // 显式有限证据：t 为有限数，直接入 finite 集
        const key = termKey(c.t);
        ctx.finite.add(key);
        if (c.t.op === "var") ctx.finite.add(c.t.id);
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

  // 自动导出有限：typeof t=number ∧ 区间排除 NaN/±Inf
  // （双侧有界且界为有限数，或 strict ±Inf 端点排除该极值）
  for (const key of typeofNumberKeys) {
    if (ctx.finite.has(key)) continue;
    const rep = findRep(ctx, key);
    const iv = ctx.iv.get(rep) ?? ctx.iv.get(key);
    if (!iv) continue;
    if (!iv.lo || !iv.hi) continue;
    if (Number.isNaN(iv.lo.bound) || Number.isNaN(iv.hi.bound)) continue;
    const loOk = Number.isFinite(iv.lo.bound) || (iv.lo.bound === -Infinity && iv.lo.strict);
    const hiOk = Number.isFinite(iv.hi.bound) || (iv.hi.bound === Infinity && iv.hi.strict);
    if (loOk && hiOk) {
      ctx.finite.add(key);
      // 等式类代表也标记
      if (rep !== key) ctx.finite.add(rep);
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
  // assumeFinite 目标：需 Φ 显式给出或由区间自动导出
  if (pred.op === "assumeFinite") {
    const key = termKey(pred.t);
    return ctx.finite.has(key) || (pred.t.op === "var" && ctx.finite.has(pred.t.id));
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

  // eq/ge/le/ne：不经 a-b op 0 归一（±Inf 上不等价），两侧直接比较
  if (
    pred.op === "eq" ||
    pred.op === "ge" ||
    pred.op === "le" ||
    pred.op === "ne"
  ) {
    return proveCmpDirect(ctx, pred.op, pred.a, pred.b);
  }

  const norm = normCmp(pred.op, pred.a, pred.b, ctx.finite);
  if (!norm) return false;
  const { lin, op } = norm;

  // IEEE：项内环消去（x-x / 0*x / 异号合并）不按实数环证
  // 有 finite 证据时 ieeeOk 保持 true，环消去已生效
  if (!lin.ieeeOk) return false;

  // 目标本身在 Φ 中（线性形相同）
  // 常数目标：仍有原子参与（消去后）时，仅当所有原子有 finite 证据才能按常数裁定
  if (lin.c.size === 0) {
    if (lin.atoms.size > 0) {
      const allFin = [...lin.atoms.keys()].every((k) => ctx.finite.has(k));
      if (!allFin) return false;
    }
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
