/**
 * B 路径运行时：transpile 后的程序在 Node 上执行时，值就是 Abs。
 * 与 AST 解释器语义同构；TypeValue 不再是求值载体。
 */

import type { Abs } from "../abs.ts";
import { abs, bool, boolLit, confJoin, litValue, unknown } from "../abs.ts";
import { add, sub, mul, div, mod, cmp } from "../arithmetic.ts";
import { typeofAbs, negAbs, notAbs, strictEqAbs } from "../surface.ts";
import { joinAbs, objOf, isObj, spread as spreadObj, type ObjShape } from "../objects.ts";
import { leqAbs } from "../leq.ts";
import type { Phi } from "../pred.ts";
import { pTrue } from "../pred.ts";

/** 当前路径前提 Φ（transpile 后的 fork 会压栈） */
let phi: Phi = pTrue;

export function currentExecPhi(): Phi {
  return phi;
}

export function withExecPhi<T>(p: Phi, body: () => T): T {
  const prev = phi;
  phi = p;
  try {
    return body();
  } finally {
    phi = prev;
  }
}

// --- 运算符重载面（transpile 目标）---

export function $add(a: Abs, b: Abs): Abs {
  return add(a, b, phi);
}
export function $sub(a: Abs, b: Abs): Abs {
  return sub(a, b, phi);
}
export function $mul(a: Abs, b: Abs): Abs {
  return mul(a, b, phi);
}
export function $div(a: Abs, b: Abs): Abs {
  return div(a, b, phi);
}
export function $mod(a: Abs, b: Abs): Abs {
  return mod(a, b, phi);
}
export function $neg(a: Abs): Abs {
  return negAbs(a);
}
export function $typeof(a: Abs): Abs {
  return typeofAbs(a);
}
export function $not(a: Abs): Abs {
  return notAbs(a);
}
export function $eq(a: Abs, b: Abs): Abs {
  const r = strictEqAbs(a, b);
  return r === undefined ? bool() : boolLit(r);
}
export function $ne(a: Abs, b: Abs): Abs {
  const r = strictEqAbs(a, b);
  return r === undefined ? bool() : boolLit(!r);
}
export function $lt(a: Abs, b: Abs): Abs {
  return cmp("lt", a, b, phi);
}
export function $le(a: Abs, b: Abs): Abs {
  return cmp("le", a, b, phi);
}
export function $gt(a: Abs, b: Abs): Abs {
  return cmp("gt", a, b, phi);
}
export function $ge(a: Abs, b: Abs): Abs {
  return cmp("ge", a, b, phi);
}
export function $join(a: Abs, b: Abs): Abs {
  return joinAbs(a, b);
}

/** 字面量 → Abs（transpile 侧数字/字符串/布尔/null/undefined） */
export function $lit(v: unknown): Abs {
  if (v && typeof v === "object" && "shape" in (v as object) && "conf" in (v as object)) {
    return v as Abs;
  }
  return litAbsFromJs(v);
}

function litAbsFromJs(v: unknown): Abs {
  if (v === null || v === undefined) {
    return abs({ k: "unknown" }, { op: "lit", value: v as never }, pTrue, "exact");
  }
  const t = typeof v;
  if (t === "number" || t === "string" || t === "boolean" || t === "bigint") {
    return abs(
      { k: "prim", type: t as "number" | "string" | "boolean" | "bigint" },
      { op: "lit", value: v as never },
      pTrue,
      "exact",
    );
  }
  return unknown;
}

export function isDefinitelyTrue(a: Abs): boolean {
  return litValue(a) === true;
}

export function isDefinitelyFalse(a: Abs): boolean {
  const lv = litValue(a);
  if (lv === false) return true;
  if (a.shape.k === "never") return true;
  return false;
}

function undef(): Abs {
  return abs({ k: "unknown" }, { op: "lit", value: undefined as never }, pTrue, "exact");
}

/**
 * if：两侧都探索（抽象条件），具体条件短路。
 */
export function $fork(test: Abs, consequent: () => Abs, alternate?: () => Abs): Abs {
  if (isDefinitelyTrue(test)) return consequent();
  if (isDefinitelyFalse(test)) return alternate ? alternate() : undef();

  const a = consequent();
  const b = alternate ? alternate() : undef();
  return joinAbs(a, b);
}

export const DEFAULT_MAX_LOOP_ITERS = 8;

/**
 * for 的惰性展开：生成器只负责「按上限吐状态」。
 * 抽象条件无法诚实终止——消费者必须自带 maxIters。
 */
export function* $forIter(
  init: Abs,
  test: (s: Abs) => Abs,
  step: (s: Abs) => Abs,
  body: (s: Abs) => Abs,
  maxIters: number = DEFAULT_MAX_LOOP_ITERS,
): Generator<{ state: Abs; test: Abs; afterBody: Abs }, void, void> {
  let s = init;
  for (let i = 0; i < maxIters; i++) {
    const t = test(s);
    if (isDefinitelyFalse(t)) {
      yield { state: s, test: t, afterBody: s };
      return;
    }
    const afterBody = body(s);
    yield { state: s, test: t, afterBody };
    s = step(afterBody);
  }
}

/**
 * 有界 for：unroll ≤ maxIters，每步「可能退出」的态 join；
 * 相邻态 leq 视为不动点提前停。
 */
export function $for(
  init: Abs,
  test: (s: Abs) => Abs,
  step: (s: Abs) => Abs,
  body: (s: Abs) => Abs,
  maxIters: number = DEFAULT_MAX_LOOP_ITERS,
): Abs {
  let state = init;
  let exitJoin: Abs | undefined;

  for (let i = 0; i < maxIters; i++) {
    const t = test(state);
    if (isDefinitelyFalse(t)) {
      return exitJoin ? joinAbs(exitJoin, state) : state;
    }

    if (!isDefinitelyTrue(t)) {
      exitJoin = exitJoin ? joinAbs(exitJoin, state) : state;
    }

    const afterBody = body(state);
    const next = step(afterBody);

    // 不动点：字面量不变，或两侧皆非字面量且 next ≤ state
    if (i > 0) {
      const nv = litValue(next);
      const sv = litValue(state);
      const stuck =
        (nv !== undefined && sv !== undefined && nv === sv) ||
        (nv === undefined && sv === undefined && leqAbs(next, state).ok);
      if (stuck) {
        return exitJoin ? joinAbs(exitJoin, next) : next;
      }
    }
    state = next;
  }

  return exitJoin ? joinAbs(exitJoin, state) : state;
}

// --- 数组 ---

/** 数组字面量 → Abs tuple（长度已知） */
export function $arr(items: Abs[]): Abs {
  return abs({ k: "tuple", elements: items }, undefined, undefined, "exact");
}

/** 下标读 a[i]；字面量 i 走 tuple 精确投影，否则并所有元素 */
export function $idx(a: Abs, i: Abs): Abs {
  const iv = litValue(i);
  if (a.shape.k === "tuple") {
    const els = a.shape.elements;
    if (typeof iv === "number" && Number.isInteger(iv)) {
      if (iv >= 0 && iv < els.length) return els[iv]!;
      return undef();
    }
    if (els.length === 0) return undef();
    return els.reduce((x, y) => joinAbs(x, y));
  }
  if (a.shape.k === "arr") return a.shape.element;
  if (a.shape.k === "sum") {
    return a.shape.members.map((m) => $idx(m, i)).reduce((x, y) => joinAbs(x, y));
  }
  return unknown;
}

/** 下标写 a[i]=v → 新 tuple */
export function $idxSet(a: Abs, i: Abs, value: Abs): Abs {
  const iv = litValue(i);
  if (a.shape.k === "tuple" && typeof iv === "number" && Number.isInteger(iv)) {
    const els = [...a.shape.elements];
    if (iv >= 0 && iv < els.length) {
      els[iv] = value;
      const next = abs({ k: "tuple", elements: els }, undefined, undefined, a.conf);
      return next;
    }
  }
  return a;
}

/** 数组长度 */
export function $len(a: Abs): Abs {
  if (a.shape.k === "tuple") {
    return abs(
      { k: "prim", type: "number" },
      { op: "lit", value: a.shape.elements.length },
      pTrue,
      "exact",
    );
  }
  if (a.shape.k === "arr") {
    return abs({ k: "prim", type: "number" }, undefined, undefined, "path");
  }
  return unknown;
}

// --- 对象 / 成员 ---

/** 对象字面量 → Abs obj */
export function $obj(slots: Record<string, Abs>): Abs {
  const s: Record<string, { value: Abs }> = {};
  for (const [k, v] of Object.entries(slots)) s[k] = { value: v };
  return objOf(s);
}

/** 对象展开 { ...a, b } */
export function $spread(a: Abs, b: Abs): Abs {
  return spreadObj(a, b);
}

/** 数组连接 [...a, ...b] / [...a, x] */
export function $concat(a: Abs, b: Abs): Abs {
  if (a.shape.k === "tuple" && b.shape.k === "tuple") {
    return abs(
      { k: "tuple", elements: [...a.shape.elements, ...b.shape.elements] },
      undefined,
      undefined,
      confJoin(a.conf, b.conf),
    );
  }
  if (a.shape.k === "tuple" && b.shape.k !== "tuple") {
    // [...a, x]：x 作单元素
    return abs(
      { k: "tuple", elements: [...a.shape.elements, b] },
      undefined,
      undefined,
      confJoin(a.conf, b.conf),
    );
  }
  if (a.shape.k !== "tuple" && b.shape.k === "tuple") {
    return abs(
      { k: "tuple", elements: [a, ...b.shape.elements] },
      undefined,
      undefined,
      confJoin(a.conf, b.conf),
    );
  }
  // 抽象数组：元素类型 join
  const ea = a.shape.k === "arr" ? a.shape.element : a;
  const eb = b.shape.k === "arr" ? b.shape.element : b;
  return abs({ k: "arr", element: joinAbs(ea, eb) }, undefined, undefined, "path");
}

/** 元素列表（tuple 展开；arr 抽象） */
export function $elems(a: Abs): Abs[] {
  if (a.shape.k === "tuple") return [...a.shape.elements];
  if (a.shape.k === "arr") return [a.shape.element];
  return [unknown];
}

/**
 * for-of：对 iterable 每个元素跑 body；有界展开。
 * body(item, i) 可返回 void；状态由外部 JS 变量承接。
 */
export function $forOf(
  iterable: Abs,
  body: (item: Abs, index: Abs) => void,
  maxIters: number = DEFAULT_MAX_LOOP_ITERS,
): void {
  const items = $elems(iterable);
  const n = Math.min(items.length || maxIters, maxIters);
  for (let i = 0; i < n; i++) {
    const item =
      items.length > 0
        ? items[Math.min(i, items.length - 1)]!
        : unknown;
    body(item, abs(
      { k: "prim", type: "number" },
      { op: "lit", value: i },
      pTrue,
      "exact",
    ));
  }
}

/** 成员读：obj.slots[key]；缺失 → undefined 字面量；brand 解包内层 */
export function $get(o: Abs, key: string): Abs {
  if (o.shape.k === "brand") return $get(o.shape.shape, key);
  if (isObj(o)) {
    const slot = (o.shape as ObjShape).slots[key];
    if (slot) return slot.value;
    if ((o.shape as ObjShape).open) return unknown;
    return undef();
  }
  if (o.shape.k === "sum") {
    const parts = o.shape.members.map((m) => $get(m, key));
    return parts.reduce((a, b) => joinAbs(a, b));
  }
  return unknown;
}

/** 成员写：返回新 obj/brand（不可变更新） */
export function $set(o: Abs, key: string, value: Abs): Abs {
  if (o.shape.k === "brand") {
    const inner = $set(o.shape.shape, key, value);
    return abs(
      { k: "brand", name: o.shape.name, shape: inner },
      o.term,
      o.pred,
      confJoin(o.conf, value.conf),
    );
  }
  if (!isObj(o)) return $obj({ [key]: value });
  const shape = o.shape as ObjShape;
  const slots = { ...shape.slots, [key]: { value } };
  const next = objOf(slots, {
    index: shape.index,
    open: shape.open,
  });
  next.conf = confJoin(o.conf, value.conf);
  return next;
}

/**
 * 有界 while：state 线程穿 test/step（与 $for 同折叠语义）。
 * 抽象条件无法诚实终止——必须 maxIters。
 */
export function $while(
  init: Abs,
  test: (s: Abs) => Abs,
  step: (s: Abs) => Abs,
  maxIters: number = DEFAULT_MAX_LOOP_ITERS,
): Abs {
  let state = init;
  let exitJoin: Abs | undefined;

  for (let i = 0; i < maxIters; i++) {
    const t = test(state);
    if (isDefinitelyFalse(t)) {
      return exitJoin ? joinAbs(exitJoin, state) : state;
    }
    if (!isDefinitelyTrue(t)) {
      exitJoin = exitJoin ? joinAbs(exitJoin, state) : state;
    }
    const next = step(state);
    if (i > 0) {
      const nv = litValue(next);
      const sv = litValue(state);
      const stuck =
        (nv !== undefined && sv !== undefined && nv === sv) ||
        (nv === undefined && sv === undefined && leqAbs(next, state).ok);
      if (stuck) {
        return exitJoin ? joinAbs(exitJoin, next) : next;
      }
    }
    state = next;
  }
  return exitJoin ? joinAbs(exitJoin, state) : state;
}

/**
 * 顺序 while（具体/可变闭包）：body 内对 JS 变量赋值。
 * 适合 transpile `let i; while (…) { i = … }`；抽象条件仍靠预算截断，
 * 不保证 exit-join 健全——健全路径用 $while/$for + 状态对象。
 */
export function $whileSeq(
  test: () => Abs,
  body: () => void,
  maxIters: number = DEFAULT_MAX_LOOP_ITERS,
): void {
  for (let i = 0; i < maxIters; i++) {
    const t = test();
    if (isDefinitelyFalse(t)) return;
    body();
  }
}

// --- throws ---

/** B 路径 throw 载荷：携带 Abs 抛出值 */
export class NudoThrow extends Error {
  readonly absValue: Abs;
  constructor(absValue: Abs) {
    super("nudo:throw");
    this.name = "NudoThrow";
    this.absValue = absValue;
  }
}

/** transpile `throw x` → `$throw(x)` */
export function $throw(v: Abs): never {
  throw new NudoThrow(v);
}

export function isNudoThrow(e: unknown): e is NudoThrow {
  return e instanceof NudoThrow;
}

/** catch 参数：从 NudoThrow 取出 Abs，否则 unknown */
export function $catchVal(e: unknown): Abs {
  if (isNudoThrow(e)) return e.absValue;
  if (e instanceof Error) {
    return abs(
      { k: "brand", name: e.name || "Error", shape: objOf({}) },
      undefined,
      undefined,
      "path",
    );
  }
  return unknown;
}

// --- async / await ---

function wrapPromiseAbs(inner: Abs): Abs {
  return abs(
    { k: "eff", eff: "promise", inner },
    undefined,
    undefined,
    confJoin(inner.conf, "path"),
  );
}

function awaitAbsVal(v: Abs): Abs {
  if (v.shape.k === "eff" && v.shape.eff === "promise") return v.shape.inner;
  return v;
}

/**
 * async 函数体包进 thunk，返回值经 wrapPromise。
 */
export function $async(thunk: () => Abs): Abs {
  return wrapPromiseAbs(thunk());
}

/** await → 解包 eff("promise") */
export function $await(v: Abs): Abs {
  return awaitAbsVal(v);
}

/** async 直接 return 的 coerce */
export function $asyncReturn(v: Abs): Abs {
  if (v.shape.k === "eff") return v;
  return wrapPromiseAbs(v);
}

/**
 * switch：具体 disc 选中匹配 case；抽象 disc 并所有分支。
 */
export function $switch(
  disc: Abs,
  cases: Array<{ test: Abs; run: () => Abs }>,
  dflt?: () => Abs,
): Abs {
  const dv = litValue(disc);
  if (dv !== undefined) {
    for (const c of cases) {
      const tv = litValue(c.test);
      if (tv !== undefined && Object.is(tv, dv)) return c.run();
    }
    return dflt ? dflt() : undef();
  }
  const parts = cases.map((c) => c.run());
  if (dflt) parts.push(dflt());
  if (parts.length === 0) return undef();
  return parts.reduce((a, b) => joinAbs(a, b));
}
