/**
 * B 路径运行时：transpile 后的程序在 Node 上执行时，值就是 Abs。
 * 与 AST 解释器语义同构；TypeValue 不再是求值载体。
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Abs } from "../abs.ts";
import { abs, bool, boolLit, confJoin, litValue, unknown, type Confidence } from "../abs.ts";
import { lit } from "../term.ts";
import { absFunction } from "../abs-fn.ts";
import {
  beginCollectionFork,
  endCollectionFork,
  popCollectionArm,
  pushCollectionArm,
} from "../collections.ts";
import { add, sub, mul, div, mod, cmp } from "../arithmetic.ts";
import { typeofAbs, negAbs, notAbs, strictEqAbs, looseEqAbs, isNullishLitAbs, definitelyNotNullishShape, bitandAbs, bitorAbs, bitxorAbs, bitnotAbs, shlAbs, shrAbs, ushrAbs, powAbs, toNumberAbs } from "../surface.ts";
import { joinAbs, objOf, isObj, spread as spreadObj, type ObjShape, type Slot } from "../objects.ts";
import {
  isMapAbs,
  isSetAbs,
  setElementsAbs,
  collectionExactLen,
  mapEntriesAbs,
  mapSizeAbs,
  setSizeAbs,
} from "../collections.ts";
import { shouldWidenArrayLiteral, widenedArrayConf } from "../containers.ts";
import { leqAbs } from "../leq.ts";
import { evalNamespaceCall } from "../builtins.ts";
import type { Phi } from "../pred.ts";
import { pTrue } from "../pred.ts";
import {
  noteUnknownMemberMissing,
  noteObjSlotMissing,
  noteAnyMemberMayThrow,
  noteNullishMemberThrows,
  anyMemberResult,
} from "./calls.ts";
import { errorTypeAbs, $tryMarkSoft, $tryDigestSoft, $tryReleaseSoft, popMayThrowFrame, orphanMayThrowEffects, type MayThrowEffect } from "./may-throw.ts";
import { getBClass } from "./class-registry.ts";

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
export function $bitand(a: Abs, b: Abs): Abs {
  return bitandAbs(a, b);
}
export function $bitor(a: Abs, b: Abs): Abs {
  return bitorAbs(a, b);
}
export function $bitxor(a: Abs, b: Abs): Abs {
  return bitxorAbs(a, b);
}
export function $bitnot(a: Abs): Abs {
  return bitnotAbs(a);
}
export function $shl(a: Abs, b: Abs): Abs {
  return shlAbs(a, b);
}
export function $shr(a: Abs, b: Abs): Abs {
  return shrAbs(a, b);
}
export function $ushr(a: Abs, b: Abs): Abs {
  return ushrAbs(a, b);
}
export function $pow(a: Abs, b: Abs): Abs {
  return powAbs(a, b);
}
// --- 访问器（get/set）运行时 ---

/** 对象字面量访问器侧表（Abs 不可存裸 JS 闭包；键为对象 Abs 身份） */
const accessorTable = new WeakMap<
  object,
  Map<string, { get?: (t: Abs) => Abs; set?: (t: Abs, v: Abs) => Abs }>
>();

/** 注册对象字面量访问器（transpile 调用；返回原 obj 以便链式包裹） */
export function $objAccessor(
  o: Abs,
  key: string,
  get: ((t: Abs) => Abs) | null,
  set: ((t: Abs, v: Abs) => Abs) | null,
): Abs {
  if (!get && !set) return o;
  let m = accessorTable.get(o);
  if (!m) {
    m = new Map();
    accessorTable.set(o, m);
  }
  const def = m.get(key) ?? {};
  if (get) def.get = get;
  if (set) def.set = set;
  m.set(key, def);
  return o;
}

/** 对象字面量访问器查询（供 $get/$set/$spread/Object.assign 共用） */
export function lookupObjAccessor(
  o: Abs,
  key: string,
): { get?: (t: Abs) => Abs; set?: (t: Abs, v: Abs) => Abs } | undefined {
  return accessorTable.get(o)?.get(key);
}

/** 不可变更新产生新 Abs 时迁移侧表（同源副本共享同一访问器集） */
function migrateAccessors(from: Abs, to: Abs): void {
  const m = accessorTable.get(from);
  if (m && to !== from) accessorTable.set(to, m);
}

/** 沿继承链找 class get/set 访问器 */
function findClassAccessor(
  startName: string,
  key: string,
): { get?: (t: Abs) => Abs; set?: (t: Abs, v: Abs) => Abs } | undefined {
  let cur: string | undefined = startName;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const spec = getBClass(cur);
    const acc = spec?.accessors?.[key];
    if (acc) return acc;
    cur = spec?.superName;
  }
  return undefined;
}

/** JS 访问器派发（$get/$set 共用）：obj 走侧表，brand 走 class 注册表 */
function findAccessor(
  o: Abs,
  key: string,
): { get?: (t: Abs) => Abs; set?: (t: Abs, v: Abs) => Abs } | undefined {
  if (o.shape.k === "brand") return findClassAccessor(o.shape.name, key);
  return lookupObjAccessor(o, key);
}

export function $toNumber(a: Abs): Abs {
  return toNumberAbs(a);
}

// --- in / instanceof / delete（transpile 运算符路由；与 ast-eval 同口径） ---

/** Object.prototype 上的恒有成员（`in` 判定：闭对象缺自有槽仍可能经原型命中） */
const OBJECT_PROTO_NAMES = new Set([
  "constructor",
  "toString",
  "valueOf",
  "toLocaleString",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "__proto__",
]);

/** ES 规范数组下标（无前导零、< 2^32-1）；非规范键返回 undefined */
function canonicalArrayIndex(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 4294967295) {
    return v;
  }
  if (typeof v === "string" && /^(0|[1-9]\d*)$/.test(v)) {
    const n = Number(v);
    if (n < 4294967295) return n;
  }
  return undefined;
}

/**
 * `key in obj`：闭形状精确判定（含 Object.prototype 名与数组下标/length）；
 * prim/nullish 接收者原生抛 TypeError → unknown；抽象键/开形状 → boolean。
 */
export function $in(key: Abs, o: Abs): Abs {
  if (o.shape.k === "sum") {
    return o.shape.members.map((m) => $in(key, m)).reduce((a, b) => joinAbs(a, b));
  }
  // 原生：prim/nullish 接收者抛 TypeError（'a' in 5 → TypeError）
  if (o.shape.k === "prim" || o.shape.k === "never" || isNullishLitAbs(o)) {
    return unknown;
  }
  // null/undefined 键原生抛 TypeError；非字面量键 → boolean 近似
  const kv = key.term?.op === "lit" ? key.term.value : undefined;
  if (kv === null || kv === undefined) {
    return isNullishLitAbs(key) ? unknown : bool();
  }
  if (o.shape.k === "tuple") {
    if (kv === "length") return boolLit(true);
    const idx = canonicalArrayIndex(kv);
    if (idx !== undefined) return boolLit(idx < o.shape.elements.length);
    return boolLit(false);
  }
  if (o.shape.k === "arr") return bool(); // 抽象数组：索引域未知
  const keyStr =
    typeof kv === "number" ? String(kv) : typeof kv === "string" ? kv : undefined;
  if (keyStr === undefined) return bool(); // symbol 键：抽象
  if (o.shape.k === "obj" || o.shape.k === "brand") {
    const objShape: ObjShape | undefined =
      o.shape.k === "brand"
        ? o.shape.shape.shape.k === "obj"
          ? o.shape.shape.shape
          : undefined
        : o.shape;
    if (!objShape) return bool();
    if (keyStr in objShape.slots) {
      const slot = objShape.slots[keyStr];
      if (!slot || slot.optional) return bool(); // optional 槽可能缺席
      return boolLit(true);
    }
    if (objShape.open) return bool();
    return boolLit(OBJECT_PROTO_NAMES.has(keyStr));
  }
  // fn/eff：无自有数据槽
  return boolLit(OBJECT_PROTO_NAMES.has(keyStr));
}

/** 内建错误层级（Error 为根，registry 无 superName 时回退） */
const BUILTIN_ERROR_SUPER: Record<string, string> = {
  Error: "",
  RangeError: "Error",
  TypeError: "Error",
  ReferenceError: "Error",
  SyntaxError: "Error",
  URIError: "Error",
  EvalError: "Error",
  AggregateError: "Error",
};

/** B-path 品牌链：registry extends 优先，内建错误层级回退（限深防环） */
function bClassChain(name: string): string[] {
  const out = [name];
  let cur: string | undefined = name;
  let depth = 0;
  while (cur && depth++ < 32) {
    const spec = getBClass(cur);
    const parent: string | undefined = spec?.superName ?? BUILTIN_ERROR_SUPER[cur];
    if (!parent || out.includes(parent)) break;
    out.push(parent);
    cur = parent;
  }
  return out;
}

/**
 * `x instanceof Right`（Right 为标识符名）：按左值形状精确判定。
 * nullish 左侧原生抛 TypeError → unknown；抽象形状 → boolean。
 */
export function $instanceof(left: Abs, rightName: string): Abs {
  // null/undefined instanceof X：原生抛 TypeError
  if (isNullishLitAbs(left)) return unknown;
  switch (left.shape.k) {
    case "brand":
      return boolLit(
        rightName === "Object" || bClassChain(left.shape.name).includes(rightName),
      );
    case "arr":
    case "tuple":
      return boolLit(rightName === "Array" || rightName === "Object");
    case "obj":
      return boolLit(rightName === "Object");
    case "fn":
      return boolLit(rightName === "Function" || rightName === "Object");
    case "eff":
      return boolLit(
        (left.shape.eff === "promise" &&
          (rightName === "Promise" || rightName === "Object")) ||
          (left.shape.eff === "generator" && rightName === "Object"),
      );
    case "prim":
      return boolLit(false); // 原始值无装箱
    case "sum": {
      const parts = left.shape.members.map((m) => $instanceof(m, rightName));
      let decided: boolean | undefined;
      let undecided = false;
      for (const p of parts) {
        const pv = litValue(p);
        if (typeof pv !== "boolean") {
          undecided = true;
          continue;
        }
        if (decided === undefined) decided = pv;
        else if (decided !== pv) return bool();
      }
      if (decided === undefined) return bool();
      return undecided
        ? abs(bool().shape, lit(decided), pTrue, "path")
        : boolLit(decided);
    }
    default:
      return bool();
  }
}

/**
 * `delete obj[key]` 的结果判定（只读，不写回）。
 * closed 目标恒 true（不建模 non-configurable/freeze）；
 * prim/nullish 接收者原生抛 TypeError → unknown。
 */
export function $delRes(o: Abs, _key: Abs): Abs {
  if (o.shape.k === "prim" || o.shape.k === "never" || isNullishLitAbs(o)) {
    return unknown;
  }
  if (o.shape.k === "sum") {
    return o.shape.members.map((m) => $delRes(m, _key)).reduce((a, b) => joinAbs(a, b));
  }
  if (o.shape.k === "obj" || o.shape.k === "brand") {
    const objShape: ObjShape | undefined =
      o.shape.k === "brand"
        ? o.shape.shape.shape.k === "obj"
          ? o.shape.shape.shape
          : undefined
        : o.shape;
    if (objShape?.open) return bool();
    return boolLit(true);
  }
  // tuple/arr/fn/eff：delete 任意键恒 true（数组洞为 undefined 槽，不影响结果）
  if (
    o.shape.k === "tuple" ||
    o.shape.k === "arr" ||
    o.shape.k === "fn" ||
    o.shape.k === "eff"
  ) {
    return boolLit(true);
  }
  return bool();
}

/**
 * `delete obj[key]` 的写入（不可变更新）：返回删键后的新容器。
 * 闭对象删自有槽；tuple 规范下标置 undefined（对齐原生空洞读值）；
 * 抽象 arr 元素并入 undefined；无法表达的形态原样返回。
 */
export function $del(o: Abs, key: Abs): Abs {
  const kv = litValue(key);
  if (o.shape.k === "sum") {
    return abs(
      { k: "sum", members: o.shape.members.map((m) => $del(m, key)) },
      undefined,
      undefined,
      "partial",
    );
  }
  if (o.shape.k === "brand") {
    const inner = $del(o.shape.shape, key);
    if (inner === o.shape.shape) return o;
    return abs({ k: "brand", name: o.shape.name, shape: inner }, undefined, undefined, o.conf);
  }
  const keyStr =
    typeof kv === "number" ? String(kv) : typeof kv === "string" ? kv : undefined;
  if (o.shape.k === "obj" && keyStr !== undefined) {
    if (o.shape.open) return o;
    if (!(keyStr in o.shape.slots)) return o; // 无此槽：no-op
    const slots: Record<string, Slot> = {};
    for (const [k, slot] of Object.entries(o.shape.slots)) {
      if (k !== keyStr) slots[k] = slot;
    }
    const next = abs({ k: "obj", slots }, undefined, undefined, o.conf);
    migrateAccessors(o, next);
    return next;
  }
  if (o.shape.k === "tuple") {
    const idx = canonicalArrayIndex(kv);
    if (idx === undefined) return o;
    const els = o.shape.elements.map((e, i) => (i === idx ? $lit(undefined) : e));
    return abs({ k: "tuple", elements: els }, undefined, undefined, o.conf);
  }
  if (o.shape.k === "arr") {
    return abs(
      { k: "arr", element: joinAbs(o.shape.element, $lit(undefined)) },
      undefined,
      undefined,
      "partial",
    );
  }
  return o;
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

/** 函数表达式 → 一等 fn Abs（transpile 侧带真实参数名；异步 body 包 $async）
 *  opts.bindThis：对象方法——$invoke 会把 receiver 作为 impl 首参注入。 */
export function $fnVal(
  params: string[],
  impl: (...args: Abs[]) => Abs,
  opts?: { bindThis?: boolean },
): Abs {
  return absFunction(params, {
    body: noBody,
    apply: (args) => callAtFunctionBoundary(() => impl(...args)),
    ...(opts?.bindThis ? { bindThis: true } : {}),
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
 * throw 同理：记录 throw-exit，兄弟臂继续探索（P0-4）。
 */
const loopExitsAls = new AsyncLocalStorage<Abs[]>();
const throwExitsAls = new AsyncLocalStorage<Abs[]>();
const tryMarksAls = new AsyncLocalStorage<number[]>();
/** 每个 try 是否仍有未消化的 soft may-throw 帧（digest/release 幂等） */
const softFrameActiveAls = new AsyncLocalStorage<boolean[]>();

/** 函数求值作用域：收集抽象分支上的 early-return / throw 值；try 标记栈同边界 */
export function runWithLoopExits<T>(body: () => T): T {
  return loopExitsAls.run([], () =>
    throwExitsAls.run([], () =>
      tryMarksAls.run([], () => softFrameActiveAls.run([], body)),
    ),
  );
}

export function takeLoopExits(): Abs[] {
  return loopExitsAls.getStore() ?? [];
}

export function takeThrowExits(): Abs[] {
  return throwExitsAls.getStore() ?? [];
}

export function pushLoopExit(v: Abs): void {
  loopExitsAls.getStore()?.push(v);
}

export function pushThrowExit(v: Abs): void {
  throwExitsAls.getStore()?.push(v);
}

/** transpile 生成代码用：`$pushLoopExit` */
export function $pushLoopExit(v: Abs): void {
  pushLoopExit(v);
}

/** try 块开始：压栈 hard/soft 标记 */
export function $tryMark(): number {
  $tryMarkSoft();
  softFrameActiveAls.getStore()?.push(true);
  const store = throwExitsAls.getStore();
  const m = store?.length ?? 0;
  tryMarksAls.getStore()?.push(m);
  return m;
}

/** 当前最内层 try 的 mark（return 时 drain 用；嵌套调用不串栈） */
export function $tryCurrentMark(): number {
  const stack = tryMarksAls.getStore();
  return stack && stack.length > 0 ? stack[stack.length - 1]! : 0;
}

export function $tryPopMark(): void {
  tryMarksAls.getStore()?.pop();
  const soft = softFrameActiveAls.getStore();
  if (soft && soft.length > 0) {
    if (soft[soft.length - 1]) $tryReleaseSoftOut();
    soft.pop();
  }
}

/** 取出 mark 之后新记录的 throw（try 吸收 / catch 合并） */
export function $tryTakeSince(mark: number): Abs[] {
  const store = throwExitsAls.getStore();
  if (!store) return [];
  return store.splice(Math.min(mark, store.length));
}

/** catch 入口：消化 try 内 soft may-throw（幂等；design §3.3） */
export function $tryDigestSoftCatch(): void {
  const soft = softFrameActiveAls.getStore();
  if (!soft || soft.length === 0 || !soft[soft.length - 1]) return;
  $tryDigestSoft();
  soft[soft.length - 1] = false;
}

/**
 * catch 入口摘下 soft 效果（不消化）。catch 正常落出口再 discard；
 * catch rethrow 时 orphan 上浮（外层 try 可再消化）。
 */
export function $tryDetachSoftCatch(): MayThrowEffect[] {
  const soft = softFrameActiveAls.getStore();
  if (!soft || soft.length === 0 || !soft[soft.length - 1]) return [];
  const effects = popMayThrowFrame(false);
  soft[soft.length - 1] = false;
  return effects;
}

/** catch 无 rethrow 落出口：丢弃已摘下的 soft（design：catch 消化） */
export function $tryDiscardSoft(_effects: MayThrowEffect[]): void {
  /* digest */
}

/** catch rethrow：摘下的 soft 上浮（嵌套 try 归外层帧） */
export function $tryOrphanSoft(effects: MayThrowEffect[]): void {
  orphanMayThrowEffects(effects);
}

/** 无 handler / 出口：上浮未消化 soft may-throw（幂等） */
export function $tryReleaseSoftOut(): void {
  const soft = softFrameActiveAls.getStore();
  if (!soft || soft.length === 0 || !soft[soft.length - 1]) return;
  $tryReleaseSoft();
  soft[soft.length - 1] = false;
}

type ForkArm =
  | { kind: "val"; v: Abs }
  | { kind: "ret"; v: Abs }
  | { kind: "throw"; v: Abs };

/** 生成器 yield 收集：抽象分支时标记路径敏感，禁止 exact 元组出货 */
let yieldStack: Abs[][] = [];
let genPathSensitive = 0;
let genJoinOverride: Abs | null = null;

function withIsolatedYields<T>(fn: () => T): { v: T; ys: Abs[] | null } {
  const top = yieldStack[yieldStack.length - 1];
  if (!top) return { v: fn(), ys: null };
  const armYs: Abs[] = [];
  yieldStack[yieldStack.length - 1] = armYs;
  try {
    return { v: fn(), ys: armYs };
  } finally {
    yieldStack[yieldStack.length - 1] = top;
  }
}

function mergeArmYields(armYsList: Array<Abs[] | null>): void {
  const top = yieldStack[yieldStack.length - 1];
  if (!top || armYsList.length === 0) return;
  const concrete = armYsList.filter((x): x is Abs[] => x !== null);
  if (concrete.length === 0) return;
  if (concrete.length === 1) {
    top.push(...concrete[0]!);
    return;
  }
  // 多臂：join 各臂 yield 序列，并标记路径敏感
  let joined: Abs | null = null;
  for (const ys of concrete) {
    joined = joined ? joinAbs(joined, $arr(ys)) : $arr(ys);
  }
  genPathSensitive++;
  if (joined) genJoinOverride = joined;
  // 父收集器仍并入全部臂元素（过近似），conf 由 genJoinOverride/path 敏感性压低
  for (const ys of concrete) top.push(...ys);
}

function runForkArm(arm: () => Abs, exits: Abs[] | undefined): ForkArm {
  try {
    return { kind: "val", v: asAbsVal(arm()) };
  } catch (e) {
    if (isNudoReturn(e)) {
      exits?.push(e.absValue);
      return { kind: "ret", v: e.absValue };
    }
    if (isNudoThrow(e)) {
      pushThrowExit(e.absValue);
      return { kind: "throw", v: e.absValue };
    }
    throw e;
  }
}

function settleForkArms(a: ForkArm, b: ForkArm, exits: Abs[] | undefined): Abs {
  const throws = [a, b].filter((r): r is { kind: "throw"; v: Abs } => r.kind === "throw");
  const nonThrow = [a, b].filter((r) => r.kind !== "throw");
  if (nonThrow.length === 0) {
    // 全 throw：兄弟臂已探索完，再抛 join（调用边界收成 throws）
    throw new NudoThrow(throws.map((t) => t.v).reduce((x, y) => joinAbs(x, y)));
  }
  // 混合 throw + val/ret：throws 已在 throwExits；继续处理非 throw 臂
  const first = nonThrow[0]!;
  const second = nonThrow[1] ?? first;
  if (first.kind === "ret" && second.kind === "ret") {
    throw new NudoReturn(joinAbs(first.v, second.v));
  }
  if (nonThrow.length === 1) {
    if (first.kind === "ret") {
      if (!exits) throw new NudoReturn(first.v);
      return undef();
    }
    return first.v;
  }
  if (first.kind === "ret") {
    if (!exits) throw new NudoReturn(first.v);
    return second.kind === "val" ? second.v : undef();
  }
  if (second.kind === "ret") {
    if (!exits) throw new NudoReturn(second.v);
    return first.v;
  }
  return joinAbs(first.v, second.v);
}

export function $fork(test: Abs, consequent: () => Abs, alternate?: () => Abs): Abs {
  if (isDefinitelyTrue(test)) return asAbsVal(consequent());
  if (isDefinitelyFalse(test)) return alternate ? asAbsVal(alternate()) : undef();

  const exits = loopExitsAls.getStore();
  // 集合 side-table：抽象分支各自 overlay，结束后 join（防身份污染）
  beginCollectionFork();
  const arms: Array<ReturnType<typeof popCollectionArm>> = [];
  const armYsList: Array<Abs[] | null> = [];
  let a: ForkArm;
  let b: ForkArm;
  try {
    pushCollectionArm();
    try {
      const r = withIsolatedYields(() => runForkArm(consequent, exits));
      a = r.v;
      armYsList.push(r.ys);
    } finally {
      arms.push(popCollectionArm());
    }
    if (alternate) {
      pushCollectionArm();
      try {
        const r = withIsolatedYields(() => runForkArm(alternate, exits));
        b = r.v;
        armYsList.push(r.ys);
      } finally {
        arms.push(popCollectionArm());
      }
    } else {
      // 隐式 else：无写也必须占一臂，否则条件写入会被 merge 成必然（P0）
      pushCollectionArm();
      try {
        b = { kind: "val", v: undef() };
        armYsList.push(null);
      } finally {
        arms.push(popCollectionArm());
      }
    }
  } finally {
    endCollectionFork(arms);
    if (yieldStack.length > 0) mergeArmYields(armYsList);
  }

  return settleForkArms(a, b, exits);
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
  opts?: {
    pack?: () => Abs;
    unpack?: (s: Abs) => void;
  },
): Abs {
  let state = init;
  let exitJoin: Abs | undefined;
  let extJoin: Abs | undefined;
  const pack = opts?.pack;
  const unpack = opts?.unpack;
  const snapCounter = (): void => {
    exitJoin = exitJoin ? joinAbs(exitJoin, state) : state;
  };
  const snapExt = (): void => {
    if (!pack) return;
    const p = pack();
    extJoin = extJoin ? joinAbs(extJoin, p) : p;
  };
  const applyExtJoin = (): void => {
    if (!extJoin || !pack || !unpack) return;
    unpack(joinAbs(extJoin, pack()));
  };

  for (let i = 0; i < maxIters; i++) {
    const t = test(state);
    if (isDefinitelyFalse(t)) {
      snapCounter();
      snapExt();
      applyExtJoin();
      return exitJoin ?? state;
    }

    const abstractTest = !isDefinitelyTrue(t);
    if (abstractTest) {
      snapCounter();
      snapExt();
    }

    let afterBody: Abs;
    try {
      afterBody = body(state);
    } catch (e) {
      if (isNudoReturn(e) || isNudoThrow(e)) throw e;
      throw e;
    }
    const next = step(afterBody);
    // 抽象条件：本轮 body 完成后的绑定也是合法出口（下一轮 test 可能为假）
    if (abstractTest) {
      state = afterBody;
      snapExt();
    }

    if (i > 0) {
      const nv = litValue(next);
      const sv = litValue(state);
      const stuck =
        (nv !== undefined && sv !== undefined && nv === sv) ||
        (nv === undefined && sv === undefined && leqAbs(next, state).ok);
      if (stuck) {
        state = next;
        snapCounter();
        snapExt();
        applyExtJoin();
        return exitJoin ?? next;
      }
    }
    state = next;
  }

  snapCounter();
  snapExt();
  applyExtJoin();
  return exitJoin ?? state;
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
  let bb = asAbsVal(b);
  // 原生展开会**调用**源对象 getter 并把结果作为数据槽拷入
  const acc = bb && typeof bb === "object" ? accessorTable.get(bb as object) : undefined;
  if (acc && bb.shape.k === "obj") {
    let changed = false;
    const slots = { ...(bb.shape as ObjShape).slots };
    for (const [k, fn] of acc) {
      if (fn.get && slots[k]) {
        slots[k] = { value: fn.get(bb) };
        changed = true;
      }
    }
    if (changed) {
      bb = abs({ k: "obj", slots }, undefined, undefined, bb.conf);
    }
  }
  return spreadObj(asAbsVal(a), bb);
}

/**
 * 解构 rest：`const { a, ...rest } = o` → rest = o 去掉 named keys。
 * closed obj：剩余槽 closed；open / optional 键：rest 仍 open（可能有未知键）。
 */
export function $objRest(o: Abs, keys: string[]): Abs {
  o = asAbsVal(o);
  if (o.shape.k === "sum") {
    return o.shape.members
      .map((m) => $objRest(m, keys))
      .reduce((a, b) => joinAbs(a, b));
  }
  if (!isObj(o)) return unknown;
  const drop = new Set(keys);
  const slots: Record<string, { value: Abs; optional?: boolean; readonly?: boolean }> = {};
  let openRest = o.shape.open === true;
  for (const [k, s] of Object.entries(o.shape.slots)) {
    if (drop.has(k)) continue;
    slots[k] = s;
    // optional 源键可能仍以 undefined 出现在 rest 的动态面；闭槽无需 open
  }
  // 提取的 optional 键：JS rest 会排除该键，但 open 对象上未知键仍可能进 rest
  if (o.shape.open) openRest = true;
  const shape: Abs["shape"] = { k: "obj", slots };
  if (openRest) (shape as { open?: boolean }).open = true;
  return { shape, conf: o.conf === "exact" ? "exact" : confJoin(o.conf, "partial") };
}

/** 数组 rest：`const [a, ...rest] = arr` → rest = 从 start 起的尾段 */
export function $arrRest(a: Abs, start: number): Abs {
  a = asAbsVal(a);
  if (a.shape.k === "sum") {
    return a.shape.members.map((m) => $arrRest(m, start)).reduce((x, y) => joinAbs(x, y));
  }
  if (a.shape.k === "tuple") {
    return tupleOrWiden(a.shape.elements.slice(start), a.conf);
  }
  if (a.shape.k === "arr") return a;
  return unknown;
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

/** 元素列表（tuple 展开；arr 抽象；C1 Set/Map 逐条目）。
 *  Map 迭代语义是 entry `[key, value]` 元组，不是裸 value。 */
export function $elems(a: Abs): Abs[] {
  if (a.shape.k === "tuple") return [...a.shape.elements];
  if (a.shape.k === "arr") return [a.shape.element];
  if (isSetAbs(a)) return setElementsAbs(a);
  if (isMapAbs(a)) return mapEntriesAbs(a);
  return [unknown];
}

/**
 * for-of：对 iterable 每个元素跑 body；有界展开。
 * body(item, i) 可返回 void；状态由外部 JS 变量承接。
 * - 具体空 tuple：体 0 次（不得用 `length || maxIters` 展开成 maxIters）
 * - 抽象 arr / 未知长度：0..maxIters 出口与 pack 状态 join
 */
export function $forOf(
  iterable: Abs,
  body: (item: Abs, index: Abs) => void,
  maxIters: number = DEFAULT_MAX_LOOP_ITERS,
  opts?: {
    pack?: () => Abs;
    unpack?: (s: Abs) => void;
  },
): void {
  const pack = opts?.pack;
  const unpack = opts?.unpack;
  let exitJoin: Abs | undefined;
  const snapExit = (): void => {
    if (!pack) return;
    const s = pack();
    exitJoin = exitJoin ? joinAbs(exitJoin, s) : s;
  };
  const applyExitJoin = (): void => {
    if (!exitJoin || !pack || !unpack) return;
    unpack(joinAbs(exitJoin, pack()));
  };

  const shape = iterable.shape;
  const items = $elems(iterable);
  // tuple / 确切 Set·Map 条目数 → 有界展开；抽象 arr 与 maybeAbsent 仍 0..max join
  const knownLen =
    shape.k === "tuple" ? shape.elements.length : collectionExactLen(iterable);
  // 非具体容器：长度未知（可能空、可能更长）→ 0..max 出口都 join
  const unbounded = knownLen === undefined;

  if (unbounded) snapExit();

  const n =
    knownLen !== undefined
      ? Math.min(knownLen, maxIters)
      : items.length > 0
        ? maxIters
        : 0;

  for (let i = 0; i < n; i++) {
    const item =
      items.length > 0 ? items[Math.min(i, items.length - 1)]! : unknown;
    try {
      body(
        item,
        abs(
          { k: "prim", type: "number" },
          { op: "lit", value: i },
          pTrue,
          "exact",
        ),
      );
    } catch (e) {
      if (isNudoReturn(e) || isNudoThrow(e)) throw e;
      throw e;
    }
    if (unbounded) snapExit();
  }
  if (unbounded && n === 0) snapExit();
  applyExitJoin();
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
  if (o.shape.k === "brand") {
    // JS Map/Set 的 size 是属性不是方法；brand 内层为空 obj，须在 $get 委托
    if (key === "size" && o.shape.name === "Map") return mapSizeAbs(o);
    if (key === "size" && o.shape.name === "Set") return setSizeAbs(o);
    // get/set 访问器：读时调用 getter；仅 setter 的键读取恒 undefined
    const acc = findClassAccessor(o.shape.name, key);
    if (acc) return acc.get ? acc.get(o) : undef();
    return $get(o.shape.shape, key, opts);
  }
  // 数组 length：成员路径（a.length += 1 等复合写）与 a.length 读同源
  if ((o.shape.k === "tuple" || o.shape.k === "arr") && key === "length") {
    return $len(o);
  }
  // any / nullish：throws 域（design-cli-semantics §3.3）
  if (noteNullishMemberThrows(o, key, "property")) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (o.shape.k === "any") {
    if (!opts?.silent) noteAnyMemberMayThrow(o, key, "property");
    return anyMemberResult();
  }
  if (isObj(o)) {
    const acc = lookupObjAccessor(o, key);
    if (acc) return acc.get ? acc.get(o) : undef();
    const slot = (o.shape as ObjShape).slots[key];
    if (slot) {
      // optional 槽在 JS 中可能缺席 → 读到 undefined，不能报 definite presence
      if (slot.optional) return joinAbs(slot.value, undef());
      return slot.value;
    }
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
    // nullish → may-throw TypeError（soft，不中断求值）
    if (noteNullishMemberThrows(o, key, "property")) {
      return unknown;
    }
    // any（无约束）→ may-throw TypeError；结果保持 any
    if (noteAnyMemberMayThrow(o, key, "property")) {
      return anyMemberResult();
    }
    // unknown（推导失败）→ unknown-recv 引擎债（$invoke 自己报 method）
    noteUnknownMemberMissing(o, key, "property");
    noteObjSlotMissing(o, key);
  }
  return unknown;
}

/** 成员写：返回新 obj/brand（不可变更新） */
export function $set(o: Abs, key: string, value: Abs): Abs {
  if (o.shape.k === "brand") {
    const acc = findClassAccessor(o.shape.name, key);
    if (acc) {
      // setter 收到 (thisVal, v) 返回更新后的 thisVal；仅 getter 的槽按 sloppy 静默 no-op
      return acc.set ? acc.set(o, value) : o;
    }
    const inner = $set(o.shape.shape, key, value);
    return abs(
      { k: "brand", name: o.shape.name, shape: inner },
      o.term,
      o.pred,
      confJoin(o.conf, value.conf),
    );
  }
  // a.length = n：非负整数 < 2^32-1 就地截断/延长（延长槽读 undefined 对齐空洞）；
  // 其余值按 sound 回退：元素与 undefined 取并、长度未知
  if (o.shape.k === "tuple" && key === "length") {
    const v = litValue(value);
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 4294967295) {
      const els = o.shape.elements.slice(0, v);
      while (els.length < v) els.push($lit(undefined));
      return abs({ k: "tuple", elements: els }, undefined, undefined, o.conf);
    }
    const joined =
      o.shape.elements.length > 0
        ? o.shape.elements.reduce((a, b) => joinAbs(a, b))
        : unknown;
    return abs(
      { k: "arr", element: joinAbs(joined, $lit(undefined)) },
      undefined,
      undefined,
      "partial",
    );
  }
  if (o.shape.k === "arr" && key === "length") {
    return abs({ k: "arr", element: o.shape.element }, undefined, undefined, "partial");
  }
  if (!isObj(o)) return $obj({ [key]: value });
  const acc = lookupObjAccessor(o, key);
  if (acc) {
    return acc.set ? acc.set(o, value) : o;
  }
  const shape = o.shape as ObjShape;
  const slots = { ...shape.slots, [key]: { value: asAbsVal(value) } };
  const next = objOf(slots, {
    index: shape.index,
    open: shape.open,
  });
  next.conf = confJoin(o.conf, value.conf);
  migrateAccessors(o, next);
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
 * 提供 pack/unpack 时，抽象条件的可能出口会 join 回绑定（P0 健全）；
 * 未 instrument 的调用保持旧语义（预算截断，文档已声明）。
 */
export function $whileSeq(
  test: () => Abs,
  body: () => void,
  maxIters: number = DEFAULT_MAX_LOOP_ITERS,
  opts?: {
    /** 把当前绑定收成 Abs 状态（transpile 注入） */
    pack?: () => Abs;
    /** 把 join 后的状态写回绑定 */
    unpack?: (s: Abs) => void;
  },
): void {
  const pack = opts?.pack;
  const unpack = opts?.unpack;
  let exitJoin: Abs | undefined;
  const snapExit = (): void => {
    if (!pack) return;
    const s = pack();
    exitJoin = exitJoin ? joinAbs(exitJoin, s) : s;
  };
  const applyExitJoin = (): void => {
    if (!exitJoin || !pack || !unpack) return;
    unpack(joinAbs(exitJoin, pack()));
  };
  for (let i = 0; i < maxIters; i++) {
    const t = test();
    if (isDefinitelyFalse(t)) {
      applyExitJoin();
      return;
    }
    // 抽象条件：当前绑定是合法出口之一，先 snapshot 再进 body
    if (!isDefinitelyTrue(t)) snapExit();
    try {
      body();
    } catch (e) {
      if (isNudoReturn(e) || isNudoThrow(e)) throw e;
      throw e;
    }
  }
  // 预算耗尽：最后一轮条件仍可能为真 → 当前态也是出口
  snapExit();
  applyExitJoin();
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

/**
 * fork 臂是否以控制流退出（return / throw）。
 * 生成代码用此决定 continue-path free-write 标志：退出臂的写
 * 不得污染 join 后的 continue 绑定。
 */
export function $isForkExit(e: unknown): boolean {
  return isNudoReturn(e) || isNudoThrow(e);
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
// yieldStack / genPathSensitive / genJoinOverride 在文件前部（fork 隔离用）

/** function* 体：收集所有 yield 值为 tuple Abs；抽象分支时降 conf（P0-6） */
export function $gen(body: () => void): Abs {
  const ys: Abs[] = [];
  const marker = genPathSensitive;
  const prevOverride = genJoinOverride;
  genJoinOverride = null;
  yieldStack.push(ys);
  try {
    body();
  } finally {
    yieldStack.pop();
  }
  if (genJoinOverride) {
    const joined: Abs = genJoinOverride;
    genJoinOverride = prevOverride;
    return { ...joined, conf: joined.conf === "exact" ? ("path" as Confidence) : joined.conf };
  }
  genJoinOverride = prevOverride;
  const arr = $arr(ys);
  if (genPathSensitive > marker) {
    return { ...arr, conf: arr.conf === "exact" ? ("path" as Confidence) : arr.conf };
  }
  return arr;
}

/** yield v：压入当前生成器收集器；表达式值用 unknown */
export function $yield(v: Abs): Abs {
  const top = yieldStack[yieldStack.length - 1];
  if (top) top.push(v);
  return unknown;
}

/**
 * switch：具体 disc 选中匹配 case；抽象 disc 并所有分支。
 * 抽象路径与 $fork 同构：集合 side-table 按臂 overlay，共享 body 只跑一次；
 * 臂内 NudoReturn/NudoThrow 不冒泡污染兄弟臂。
 * **无 default 时必须隐式 fall-through 臂（undef）**，否则无匹配路径被丢掉（P0-2）。
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

  const exits = loopExitsAls.getStore();
  beginCollectionFork();
  const armOverlays: Array<ReturnType<typeof popCollectionArm>> = [];
  const armYsList: Array<Abs[] | null> = [];
  const runArm = (fn: () => Abs): ForkArm => {
    pushCollectionArm();
    try {
      const r = withIsolatedYields(() => runForkArm(fn, exits));
      armYsList.push(r.ys);
      return r.v;
    } finally {
      armOverlays.push(popCollectionArm());
    }
  };
  const results: ForkArm[] = [];
  try {
    // 共享 body（case 1: case 2: …）只执行一次，避免非幂等副作用被放大
    const seenRuns = new Set<() => Abs>();
    for (const c of cases) {
      if (seenRuns.has(c.run)) continue;
      seenRuns.add(c.run);
      results.push(runArm(c.run));
    }
    if (dflt) {
      if (!seenRuns.has(dflt)) results.push(runArm(dflt));
    } else {
      // 隐式 no-match 臂：全 case 不命中时 fall-through（P0-2）
      pushCollectionArm();
      try {
        results.push({ kind: "val", v: undef() });
        armYsList.push(null);
      } finally {
        armOverlays.push(popCollectionArm());
      }
    }
  } finally {
    endCollectionFork(armOverlays);
    if (yieldStack.length > 0) mergeArmYields(armYsList);
  }
  if (results.length === 0) return undef();

  const throws = results.filter((r): r is { kind: "throw"; v: Abs } => r.kind === "throw");
  const nonThrow = results.filter((r) => r.kind !== "throw");
  if (nonThrow.length === 0) {
    throw new NudoThrow(throws.map((t) => t.v).reduce((x, y) => joinAbs(x, y)));
  }
  const allRet = nonThrow.every((r) => r.kind === "ret");
  if (allRet) {
    throw new NudoReturn(nonThrow.map((r) => r.v).reduce((a, b) => joinAbs(a, b)));
  }
  // 混合：ret/throw 臂已进 exits；语句位只携带 val 臂值继续
  const valParts = nonThrow.filter((r) => r.kind === "val").map((r) => r.v);
  if (valParts.length === 0) return undef();
  return valParts.reduce((a, b) => joinAbs(a, b));
}

/** `??` / `??=` 测试：确定非 nullish → false；lit nullish → true；否则抽象 boolean */
export function $nullishTest(v: Abs): Abs {
  if (definitelyNotNullishShape(v.shape)) return boolLit(false);
  if (isNullishLitAbs(v)) return boolLit(true);
  const t = v.term;
  if (t?.op === "lit" && t.value !== null && t.value !== undefined) return boolLit(false);
  return bool();
}
