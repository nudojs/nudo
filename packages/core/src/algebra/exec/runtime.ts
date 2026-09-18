/**
 * B 路径运行时：transpile 后的程序在 Node 上执行时，值就是 Abs。
 * 与 AST 解释器语义同构；TypeValue 不再是求值载体。
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Abs } from "../abs.ts";
import { abs, bool, boolLit, confJoin, litValue, unknown, type Confidence } from "../abs.ts";
import { absFunction } from "../abs-fn.ts";
import {
  beginCollectionFork,
  endCollectionFork,
  popCollectionArm,
  pushCollectionArm,
} from "../collections.ts";
import { add, sub, mul, div, mod, cmp } from "../arithmetic.ts";
import { typeofAbs, negAbs, notAbs, strictEqAbs, looseEqAbs } from "../surface.ts";
import { joinAbs, objOf, isObj, spread as spreadObj, type ObjShape } from "../objects.ts";
import { isMapAbs, isSetAbs, setElementsAbs, mapValuesAbs } from "../collections.ts";
import { shouldWidenArrayLiteral, widenedArrayConf } from "../containers.ts";
import { leqAbs } from "../leq.ts";
import { evalNamespaceCall } from "../builtins.ts";
import type { Phi } from "../pred.ts";
import { pTrue } from "../pred.ts";
import { noteUnknownMemberMissing, noteObjSlotMissing } from "./calls.ts";

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
/** `==` / `!=`（C2.3）：双字面量 Abstract Equality，否则回落严格判定 */
export function $eqLoose(a: Abs, b: Abs): Abs {
  const r = looseEqAbs(a, b);
  return r === undefined ? bool() : boolLit(r);
}
export function $neLoose(a: Abs, b: Abs): Abs {
  const r = looseEqAbs(a, b);
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
  return joinAbs(asAbsVal(a), asAbsVal(b));
}

/** apply 型 impl 的占位 body（AbsFnImpl.body 必需；$call 走 apply 不经 body） */
const noBody = { type: "BlockStatement", body: [], directives: [] } as never;

/**
 * transpile 泄漏的 JS 函数值 → 一等 fn Abs。
 * B 路径把函数声明/表达式编译成真实 JS 函数；它们流进对象槽、
 * 元组、join 等 Abs 结构时不能裸存——下游（bridge/leq/join）读 `.shape`。
 * 参数名无法从运行时函数恢复（用 fn.length → argN，与 analyzer 的
 * extractParamNames 回退口径一致）；带真实参数名走 $fnVal（transpile 侧）。
 */
export function asAbsVal(v: unknown): Abs {
  if (v && typeof v === "object" && "shape" in (v as object)) return v as Abs;
  if (typeof v === "function") {
    const n = Math.max(0, v.length);
    const params = Array.from({ length: n }, (_, i) => `arg${i}`);
    return absFunction(params, {
      body: noBody,
      // 与 $fnVal / $callNamed 同边界：callee 的 NudoReturn 不得冒泡成 caller
      apply: (args) => callAtFunctionBoundary(() => (v as (...a: Abs[]) => Abs)(...args)),
    });
  }
  return $lit(v as never);
}

/**
 * 函数调用边界：callee 的 loop/early-return 不得冒泡成 caller 结果。
 * 每个 B 路径调用帧独立 ALS；NudoReturn 收成该调用的返回值。
 */
export function callAtFunctionBoundary<T>(body: () => T): T {
  return runWithLoopExits(() => {
    try {
      return body();
    } catch (e) {
      if (isNudoReturn(e)) return e.absValue as unknown as T;
      throw e;
    }
  });
}

/** 函数表达式 → 一等 fn Abs（transpile 侧带真实参数名；异步 body 包 $async） */
export function $fnVal(params: string[], impl: (...args: Abs[]) => Abs): Abs {
  return absFunction(params, {
    body: noBody,
    apply: (args) => callAtFunctionBoundary(() => impl(...args)),
  });
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

/** JS 真值：字面量按 Boolean(v)；对象形恒真；不可判 → undefined */
export function litTruth(a: Abs): boolean | undefined {
  if (a.term?.op === "lit") {
    // lit(undefined) 与「无 lit」都经 litValue 折叠成 undefined，须先看 term
    return Boolean(a.term.value);
  }
  switch (a.shape.k) {
    case "obj":
    case "arr":
    case "tuple":
    case "fn":
    case "brand":
    case "eff":
      return true;
    case "prim":
      return a.shape.type === "symbol" || a.shape.type === "bigint" ? true : undefined;
    case "never":
      return false;
    default:
      return undefined;
  }
}

export function isDefinitelyTrue(a: Abs): boolean {
  return litTruth(a) === true;
}

export function isDefinitelyFalse(a: Abs): boolean {
  const t = litTruth(a);
  if (t === false) return true;
  if (a.shape.k === "never") return true;
  return false;
}

function undef(): Abs {
  return abs({ k: "unknown" }, { op: "lit", value: undefined as never }, pTrue, "exact");
}

/**
 * if：两侧都探索（抽象条件），具体条件短路。
 * 循环/函数体内 early-return：抽象分支把 NudoReturn 记入 loop-exit
 * 侧信道并让另一侧继续，避免只保留「先跑完的那一侧」而低估结果域。
 */
const loopExitsAls = new AsyncLocalStorage<Abs[]>();

/** 函数求值作用域：收集抽象分支上的 early-return 值，结束时 join */
export function runWithLoopExits<T>(body: () => T): T {
  return loopExitsAls.run([], body);
}

export function takeLoopExits(): Abs[] {
  return loopExitsAls.getStore() ?? [];
}

type ForkArm =
  | { kind: "val"; v: Abs }
  | { kind: "ret"; v: Abs };

function runForkArm(arm: () => Abs, exits: Abs[] | undefined): ForkArm {
  try {
    return { kind: "val", v: asAbsVal(arm()) };
  } catch (e) {
    if (isNudoReturn(e)) {
      exits?.push(e.absValue);
      return { kind: "ret", v: e.absValue };
    }
    throw e;
  }
}

export function $fork(test: Abs, consequent: () => Abs, alternate?: () => Abs): Abs {
  if (isDefinitelyTrue(test)) return asAbsVal(consequent());
  if (isDefinitelyFalse(test)) return alternate ? asAbsVal(alternate()) : undef();

  const exits = loopExitsAls.getStore();
  // 集合 side-table：抽象分支各自 overlay，结束后 join（防身份污染）
  beginCollectionFork();
  const arms: Array<ReturnType<typeof popCollectionArm>> = [];
  let a: ForkArm;
  let b: ForkArm;
  try {
    pushCollectionArm();
    try {
      a = runForkArm(consequent, exits);
    } finally {
      arms.push(popCollectionArm());
    }
    if (alternate) {
      pushCollectionArm();
      try {
        b = runForkArm(alternate, exits);
      } finally {
        arms.push(popCollectionArm());
      }
    } else {
      b = { kind: "val", v: undef() };
    }
  } finally {
    endCollectionFork(arms);
  }

  if (a.kind === "ret" && b.kind === "ret") {
    throw new NudoReturn(joinAbs(a.v, b.v));
  }
  if (a.kind === "ret") {
    if (!exits) throw new NudoReturn(a.v);
    return b.kind === "val" ? b.v : undef();
  }
  if (b.kind === "ret") {
    if (!exits) throw new NudoReturn(b.v);
    return a.v;
  }
  return joinAbs(a.v, b.v);
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

    let afterBody: Abs;
    try {
      afterBody = body(state);
    } catch (e) {
      if (isNudoReturn(e)) throw e;
      throw e;
    }
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

/** 容器策略单点（containers.ts）：≤cap → tuple；>cap → arr（元素 join，path） */
function tupleOrWiden(els: Abs[], conf: Confidence): Abs {
  if (shouldWidenArrayLiteral(els.length)) {
    return abs(
      { k: "arr", element: els.reduce((x, y) => joinAbs(x, y)) },
      undefined,
      undefined,
      widenedArrayConf(),
    );
  }
  return abs({ k: "tuple", elements: els }, undefined, undefined, conf);
}

/** 数组字面量 → ≤cap tuple（逐元素精确）/ >cap arr；策略与 ast-eval 同源（containers.ts） */
export function $arr(items: Abs[]): Abs {
  return tupleOrWiden(items.map(asAbsVal), "exact");
}

const ARR_MUTATORS = new Set([
  "push",
  "unshift",
  "pop",
  "shift",
  "splice",
  "reverse",
  "sort",
]);

export function isArrMutator(name: string): boolean {
  return ARR_MUTATORS.has(name);
}

/**
 * C1.4 语句重绑：返回**变更后容器** Abs（不是 JS 返回值）。
 * `a.pop()` 语句应把 `a` 绑成去掉末元的 tuple，而不是被移除的元素。
 */
export function $arrMutContainer(arr: Abs, method: string, args: Abs[]): Abs {
  const shape = arr.shape;
  if (shape.k !== "tuple" && shape.k !== "arr") return arr;
  const vals = args.map((a) => asAbsVal(a));
  const asArrEl = (els: Abs[]): Abs =>
    els.length > 0 ? els.reduce((x, y) => joinAbs(x, y)) : unknown;

  if (method === "push" || method === "unshift") {
    if (shape.k === "tuple") {
      const els =
        method === "push"
          ? [...shape.elements, ...vals]
          : [...vals, ...shape.elements];
      const conf = vals.reduce(
        (acc, v) => confJoin(acc, v.conf),
        arr.conf as Confidence,
      );
      return abs(
        { k: "tuple", elements: els },
        undefined,
        undefined,
        conf,
      );
    }
    const el = vals.reduce((acc, v) => joinAbs(acc, v), shape.element);
    return abs({ k: "arr", element: el }, undefined, undefined, confJoin(arr.conf, "path"));
  }
  if (method === "pop") {
    if (shape.k === "tuple") {
      if (shape.elements.length === 0) return arr;
      return abs(
        { k: "tuple", elements: shape.elements.slice(0, -1) },
        undefined,
        undefined,
        arr.conf,
      );
    }
    return arr;
  }
  if (method === "shift") {
    if (shape.k === "tuple") {
      if (shape.elements.length === 0) return arr;
      return abs(
        { k: "tuple", elements: shape.elements.slice(1) },
        undefined,
        undefined,
        arr.conf,
      );
    }
    return arr;
  }
  if (method === "splice") {
    if (shape.k === "tuple") {
      return abs(
        { k: "arr", element: asArrEl(shape.elements) },
        undefined,
        undefined,
        confJoin(arr.conf, "path"),
      );
    }
    return arr;
  }
  if (method === "reverse") {
    if (shape.k === "tuple") {
      return abs(
        { k: "tuple", elements: [...shape.elements].reverse() },
        undefined,
        undefined,
        arr.conf,
      );
    }
    return arr;
  }
  if (method === "sort") {
    // 顺序未建模：位次不可信，tuple 降为 arr（元素 join），避免 a[0] 假精确
    if (shape.k === "tuple") {
      return abs(
        { k: "arr", element: asArrEl(shape.elements) },
        undefined,
        undefined,
        confJoin(arr.conf, "path"),
      );
    }
    return arr;
  }
  return arr;
}

/** 下标读 a[i]；字面量 i 走 tuple 精确投影，否则并所有元素；string[i] → 单字符 */
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
  // C1.3：对象 + key 投影；闭 shape miss / 未知 key 必须并入 undefined
  if (a.shape.k === "obj" || (a.shape.k === "brand" && a.shape.shape.shape.k === "obj")) {
    const objShape = (a.shape.k === "obj" ? a.shape : a.shape.shape.shape) as ObjShape;
    const slots = Object.values(objShape.slots).map((s) => s.value);
    if (slots.length === 0) return objShape.open ? unknown : undef();
    const joinSlotsWithUndef = (): Abs =>
      joinAbs(slots.reduce((x, y) => joinAbs(x, y)), undef());
    if (typeof iv === "string" || typeof iv === "number" || typeof iv === "boolean") {
      const slot = objShape.slots[String(iv)];
      if (slot) return slot.value;
      if (objShape.open) return unknown;
      // 闭 shape 字面量 key miss：键确定不存在 → 仅 undefined（与 $get / Map miss 一致）
      return undef();
    }
    if (objShape.open && slots.length > 0) {
      // open shape：已知槽 ∪ unknown
      return joinAbs(slots.reduce((x, y) => joinAbs(x, y)), unknown);
    }
    // 闭 shape 未知 key：已知槽 ∪ undefined（键可能不存在）
    return joinSlotsWithUndef();
  }
  // 字符串下标：s[i] → 第 i 个字符（字面量精确）
  const sv = litValue(a);
  if (typeof sv === "string") {
    if (typeof iv === "number" && Number.isInteger(iv)) {
      if (iv >= 0 && iv < sv.length) {
        return abs(
          { k: "prim", type: "string" },
          { op: "lit", value: sv[iv] as never },
          pTrue,
          "exact",
        );
      }
      return undef();
    }
    return unknown;
  }
  return unknown;
}

/** 下标写 a[i]=v → 新 tuple（越界写按 JS 语义增长，空洞为 undefined） */
export function $idxSet(a: Abs, i: Abs, value: Abs): Abs {
  const iv = litValue(i);
  if (a.shape.k === "tuple" && typeof iv === "number" && Number.isInteger(iv) && iv >= 0) {
    const els = [...a.shape.elements];
    while (els.length < iv) els.push(undef());
    els[iv] = asAbsVal(value);
    const next = abs({ k: "tuple", elements: els }, undefined, undefined, a.conf);
    return next;
  }
  return a;
}

/** 数组/字符串长度 */
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
  const sv = litValue(a);
  if (typeof sv === "string") {
    return abs(
      { k: "prim", type: "number" },
      { op: "lit", value: sv.length },
      pTrue,
      "exact",
    );
  }
  return unknown;
}

// --- 对象 / 成员 ---

/** 对象字面量 → Abs obj */
export function $obj(slots: Record<string, Abs>): Abs {
  const s: Record<string, { value: Abs }> = {};
  for (const [k, v] of Object.entries(slots)) s[k] = { value: asAbsVal(v) };
  return objOf(s);
}

/** 对象展开 { ...a, b } */
export function $spread(a: Abs, b: Abs): Abs {
  return spreadObj(asAbsVal(a), asAbsVal(b));
}

/** 数组连接 [...a, ...b] / [...a, x]；结果超 cap 时与字面量同策略降 arr */
export function $concat(a: Abs, b: Abs): Abs {
  a = asAbsVal(a);
  b = asAbsVal(b);
  const as = a.shape;
  const bs = b.shape;
  if (as.k === "tuple" && bs.k === "tuple") {
    return tupleOrWiden([...as.elements, ...bs.elements], confJoin(a.conf, b.conf));
  }
  // 一侧是抽象数组（arr）：spread 语义按元素并入（元素 join），
  // 不得整体嵌为单元素——字面量链超 cap 降级为 arr 后继续吸收后续元素也走此分支
  if (as.k === "arr" || bs.k === "arr") {
    const ea: Abs = as.k === "tuple"
      ? as.elements.reduce((x, y) => joinAbs(x, y))
      : as.k === "arr"
        ? as.element
        : a;
    const eb: Abs = bs.k === "tuple"
      ? bs.elements.reduce((x, y) => joinAbs(x, y))
      : bs.k === "arr"
        ? bs.element
        : b;
    return abs({ k: "arr", element: joinAbs(ea, eb) }, undefined, undefined, "path");
  }
  if (as.k === "tuple") {
    // [...a, x]：非数组 x 作单元素
    return abs(
      { k: "tuple", elements: [...as.elements, b] },
      undefined,
      undefined,
      confJoin(a.conf, b.conf),
    );
  }
  if (bs.k === "tuple") {
    return abs(
      { k: "tuple", elements: [a, ...bs.elements] },
      undefined,
      undefined,
      confJoin(a.conf, b.conf),
    );
  }
  // 双侧皆非容器：元素 join
  return abs({ k: "arr", element: joinAbs(a, b) }, undefined, undefined, "path");
}

/** 元素列表（tuple 展开；arr 抽象；C1 Set/Map 逐条目） */
export function $elems(a: Abs): Abs[] {
  if (a.shape.k === "tuple") return [...a.shape.elements];
  if (a.shape.k === "arr") return [a.shape.element];
  if (isSetAbs(a)) return setElementsAbs(a);
  if (isMapAbs(a)) return mapValuesAbs(a);
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
    try {
      body(item, abs(
        { k: "prim", type: "number" },
        { op: "lit", value: i },
        pTrue,
        "exact",
      ));
    } catch (e) {
      // C2.1：循环体内 return → 冒泡到函数调用方
      if (isNudoReturn(e)) throw e;
      throw e;
    }
  }
}

/**
 * 命名空间身份表：transpile 后 `Math.max(0, x)` 的接收者是宿主 JS 全局对象
 * （非 Abs）。按对象身份识别命名空间，路由到 Abs builtin 表。
 */
export function namespaceNameOf(v: unknown): string | undefined {
  if (typeof v !== "object" && typeof v !== "function") return undefined;
  if (v === Math) return "Math";
  if (v === Number) return "Number";
  if (v === JSON) return "JSON";
  if (v === Object) return "Object";
  if (v === Array) return "Array";
  if (v === Date) return "Date";
  if (v === Promise) return "Promise";
  return undefined;
}

/** 正则字面量 → RegExp brand（source/flags 进 slots，供 exec/test 精确执行） */
export function $regex(pattern: string, flags = ""): Abs {
  const litStr = (v: string): Abs =>
    abs({ k: "prim", type: "string" }, { op: "lit", value: v as never }, pTrue, "exact");
  return abs(
    {
      k: "brand",
      name: "RegExp",
      shape: objOf({
        source: { value: litStr(pattern) },
        flags: { value: litStr(flags) },
      }),
    },
    undefined,
    undefined,
    "exact",
  );
}

/** 成员读：obj.slots[key]；缺失 → undefined 字面量；brand 解包内层 */
export function $get(
  o: Abs,
  key: string,
  opts?: { /** 调用方已负责诊断（如 $invoke） */ silent?: boolean },
): Abs {
  // 宿主 JS 对象（Math/JSON…）：属性按命名空间/真值投影
  if (!o || typeof o !== "object" || !("shape" in (o as object))) {
    const ns = namespaceNameOf(o);
    if (ns) {
      try {
        const raw = (o as Record<string, unknown>)[key];
        if (typeof raw === "function") {
          return absFunction([`${ns}.${key}`], {
            body: noBody,
            apply: (args) => evalNamespaceCall(ns, key, args) ?? unknown,
          });
        }
        return $lit(raw);
      } catch {
        return unknown;
      }
    }
    return unknown;
  }
  if (o.shape.k === "brand") return $get(o.shape.shape, key, opts);
  if (isObj(o)) {
    const slot = (o.shape as ObjShape).slots[key];
    if (slot) return slot.value;
    if ((o.shape as ObjShape).open) return unknown;
    // C0.5：闭 shape 缺槽且求值命中 → 可选 nudo:missing-slot（默认 off）
    noteObjSlotMissing(o, key);
    return undef();
  }
  if (o.shape.k === "sum") {
    const parts = o.shape.members.map((m) => $get(m, key, opts));
    return parts.reduce((a, b) => joinAbs(a, b));
  }
  if (!opts?.silent) {
    // 裸属性访问落在 unknown 上 → unknown-recv（$invoke 自己报 method）
    noteUnknownMemberMissing(o, key, "property");
    noteObjSlotMissing(o, key);
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
  const slots = { ...shape.slots, [key]: { value: asAbsVal(value) } };
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
    try {
      body();
    } catch (e) {
      if (isNudoReturn(e)) throw e;
      throw e;
    }
  }
}

// --- early return from loop bodies (C2.1) ---

/** B 路径「函数提前 return」信号（区别于 throw） */
export class NudoReturn extends Error {
  readonly absValue: Abs;
  constructor(absValue: Abs) {
    super("nudo:return");
    this.name = "NudoReturn";
    this.absValue = absValue;
  }
}

/** transpile `return x` inside for/while → `$loopReturn(x)` */
export function $loopReturn(v: Abs): never {
  throw new NudoReturn(v);
}

export function isNudoReturn(e: unknown): e is NudoReturn {
  return e instanceof NudoReturn;
}

/** catch 转译辅助：控制流信号透传（生成代码只注入 `$` 前缀符号） */
export function $rethrowIfNudoReturn(e: unknown): void {
  if (isNudoReturn(e)) throw e;
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

/** catch 参数：从 NudoThrow 取出 Abs；宿主 Error 补 name/message；否则 unknown */
export function $catchVal(e: unknown): Abs {
  if (isNudoThrow(e)) return e.absValue;
  if (e instanceof Error) {
    const name = e.name || "Error";
    const msgAbs: Abs =
      typeof e.message === "string"
        ? abs(
            { k: "prim", type: "string" },
            { op: "lit", value: e.message as never },
            pTrue,
            "exact",
          )
        : abs({ k: "prim", type: "string" }, undefined, undefined, "path");
    return abs(
      {
        k: "brand",
        name,
        shape: objOf({
          name: {
            value: abs(
              { k: "prim", type: "string" },
              { op: "lit", value: name as never },
              pTrue,
              "exact",
            ),
          },
          message: { value: msgAbs },
        }),
      },
      undefined,
      undefined,
      "path",
    );
  }
  return unknown;
}

// --- async / await ---

function wrapPromiseAbs(inner: Abs): Abs {
  inner = asAbsVal(inner);
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

// --- 生成器 ---

let yieldStack: Abs[][] = [];

/** function* 体：收集所有 yield 值为 tuple Abs */
export function $gen(body: () => void): Abs {
  const ys: Abs[] = [];
  yieldStack.push(ys);
  try {
    body();
  } finally {
    yieldStack.pop();
  }
  return $arr(ys);
}

/** yield v：压入当前生成器收集器；表达式值用 unknown */
export function $yield(v: Abs): Abs {
  const top = yieldStack[yieldStack.length - 1];
  if (top) top.push(v);
  return unknown;
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
      if (tv !== undefined && Object.is(tv, dv)) return asAbsVal(c.run());
    }
    return dflt ? asAbsVal(dflt()) : undef();
  }
  const parts = cases.map((c) => asAbsVal(c.run()));
  if (dflt) parts.push(asAbsVal(dflt()));
  if (parts.length === 0) return undef();
  return parts.reduce((a, b) => joinAbs(a, b));
}
