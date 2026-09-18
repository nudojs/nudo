/**
 * B 路径 class：brand 实例 + ctor/method 闭包 + 继承链。
 * 方法内 this 由 transpile 改写为 thisVal 参数。
 */

import type { Abs } from "../abs.ts";
import { abs, unknown, confJoin, litValue, bool, boolLit, strLit } from "../abs.ts";
import { objOf, joinAbs } from "../objects.ts";
import { $get, $set, asAbsVal, namespaceNameOf, $regex, $arrMutContainer, callAtFunctionBoundary } from "./runtime.ts";
import { $call } from "./call.ts";
import { getFnImpl } from "../abs-fn.ts";
import { evalNamespaceCall, errorBrandAbs, isErrorCtorName, evalBuiltinInstanceMethod } from "../builtins.ts";
import { isMapAbs, isSetAbs, makeMapAbs, makeSetAbs, collectionElementJoin } from "../collections.ts";
import {
  applyCallbackAbs,
  asAbs,
  instantiateReturn,
  isRelFn,
  mapElementFallback,
  projectFlatMapResult,
  undefAbs,
} from "../hof.ts";
import { emptyEnv } from "../ast-eval.ts";
import { defaultLeakBudget } from "../leak.ts";
import { pTrue } from "../pred.ts";
import { notePrimMemberMissing, noteUnknownMemberMissing } from "./calls.ts";
import { callAbsMethod } from "../methods.ts";
import {
  registerBClass,
  getBClass,
  type BClassSpec,
} from "./class-registry.ts";

export type { BClassSpec } from "./class-registry.ts";
export { registerBClass, getBClass, clearBClasses } from "./class-registry.ts";

const classImpl = new WeakMap<object, BClassSpec>();

/** 定义类 → 可 new 的 Abs（brand 标记；静态字段挂在 slots） */
export function $class(
  name: string,
  spec: Omit<BClassSpec, "name"> & { extends?: string },
): Abs {
  const full: BClassSpec = {
    name,
    superName: spec.extends,
    ctor: spec.ctor,
    methods: spec.methods,
    staticMethods: spec.staticMethods,
    statics: spec.statics,
  };
  registerBClass(full);
  const slots: Record<string, { value: Abs }> = {};
  if (spec.statics) {
    for (const [k, v] of Object.entries(spec.statics)) slots[k] = { value: asAbsVal(v) };
  }
  const val = abs(
    { k: "brand", name, shape: objOf(slots) },
    undefined,
    undefined,
    "exact",
  );
  classImpl.set(val as object, full);
  return val;
}

function specOf(cls: Abs): BClassSpec | undefined {
  if (classImpl.has(cls as object)) return classImpl.get(cls as object);
  if (cls.shape.k === "brand") return getBClass(cls.shape.name);
  return undefined;
}

/** 沿继承链找方法 */
function findMethod(
  startName: string,
  method: string,
): ((thisVal: Abs, ...args: Abs[]) => Abs) | undefined {
  let cur: string | undefined = startName;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const spec = getBClass(cur);
    if (spec?.methods?.[method]) return spec.methods[method];
    cur = spec?.superName;
  }
  return undefined;
}

function findCtor(
  startName: string,
): { ctor: (thisVal: Abs, ...args: Abs[]) => Abs; className: string } | undefined {
  let cur: string | undefined = startName;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const spec = getBClass(cur);
    if (spec?.ctor) return { ctor: spec.ctor, className: cur };
    cur = spec?.superName;
  }
  return undefined;
}

/** new C(...) → 空 brand 实例 + ctor 写字段；非类构造走 impl/$call */
export function $new(cls: Abs | ((...a: unknown[]) => unknown), args: Abs[]): Abs {
  // JS 内建构造器（Error/Date/URL…）：直接 brand，避免 $call 对非 Abs 炸掉
  if (typeof cls === "function") {
    // new Array(n) → n 元 tuple；new Array(a,b,c) → 字面量 tuple
    if (cls === Array) {
      if (args.length === 1) {
        const n = litValue(args[0]!);
        if (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 4096) {
          const els = Array.from({ length: n }, () => undefAbs());
          return abs({ k: "tuple", elements: els }, undefined, undefined, "exact");
        }
        return abs({ k: "arr", element: unknown }, undefined, undefined, "partial");
      }
      return abs({ k: "tuple", elements: args.map((a) => asAbs(a) ?? unknown) }, undefined, undefined, "exact");
    }
    // new RegExp(pattern) → 可精确 exec/test 的 RegExp brand
    if (cls === RegExp) {
      const p = args[0] ? litValue(args[0]) : undefined;
      if (typeof p === "string") return $regex(p, args[1] ? String(litValue(args[1]) ?? "") : "");
    }
    const clsName = cls.name || "Object";
    // C2.2：Error 家族携带 name/message 槽（catch 形参可读）
    if (isErrorCtorName(clsName)) {
      return errorBrandAbs(clsName, args[0]);
    }
    // C1.1 / C1.2：Map / Set 条目表（按 ctor 名比对，避开 TS 全局接口无交集）
    if (clsName === "Map") return makeMapAbs(args[0]);
    if (clsName === "Set") return makeSetAbs(args[0]);
    const shape = objOf({});
    return abs({ k: "brand", name: clsName, shape }, undefined, undefined, "path");
  }
  const spec = specOf(cls);
  if (!spec) {
    // env 构造器（URL 等）：fn impl / absFunction
    return $call(cls, args);
  }
  const className = spec?.name ?? (cls.shape.k === "brand" ? cls.shape.name : "Anonymous");
  let thisVal = abs(
    { k: "brand", name: className, shape: objOf({}) },
    undefined,
    undefined,
    "path",
  );
  const found = findCtor(className);
  if (found) {
    const after = found.ctor(thisVal, ...args);
    if (after && after.shape.k === "brand") thisVal = after;
    else thisVal = after ?? thisVal;
  }
  return thisVal;
}

/**
 * super(...)：父类构造写入字段（this 保持子类 brand）。
 * transpile: super(a,b) → __this = $super(__this, "Child", [a,b])
 */
export function $super(thisVal: Abs, childName: string, args: Abs[]): Abs {
  const child = getBClass(childName);
  const parentName = child?.superName;
  if (!parentName) return thisVal;
  const found = findCtor(parentName);
  if (!found) return thisVal;
  const after = found.ctor(thisVal, ...args);
  if (after && after.shape.k === "brand") {
    // 保持子类 brand 名
    return abs(
      { k: "brand", name: childName, shape: after.shape.shape },
      after.term,
      after.pred,
      after.conf,
    );
  }
  return after ?? thisVal;
}

/** RegExp brand 上的 exec/test：pattern 与 subject 都是字面量 → 真执行 */
function execRegexBrand(re: Abs, method: string, args: Abs[]): Abs | undefined {
  if (re.shape.k !== "brand" || re.shape.name !== "RegExp") return undefined;
  if (method !== "exec" && method !== "test" && method !== "toString") return undefined;
  const inner = re.shape.shape;
  const patAbs = inner.shape.k === "obj" ? inner.shape.slots["source"]?.value : undefined;
  const flagsAbs = inner.shape.k === "obj" ? inner.shape.slots["flags"]?.value : undefined;
  const pat = patAbs ? litValue(patAbs) : undefined;
  if (typeof pat !== "string") return undefined;
  const flagsV = flagsAbs ? litValue(flagsAbs) : undefined;
  const flags = typeof flagsV === "string" ? flagsV : "";
  if (method === "toString") return strLit(`/${pat}/${flags}`);
  const subject = args[0] ? litValue(args[0]) : undefined;
  if (typeof subject !== "string") {
    // subject 非字面量：保持抽象（test → boolean，exec → null|tuple 的保守并）
    return method === "test"
      ? abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial")
      : undefined;
  }
  let reReal: RegExp;
  try {
    reReal = new RegExp(pat, flags);
  } catch {
    return undefined;
  }
  const m = reReal.exec(subject);
  if (method === "test") return boolLit(reReal.test(subject));
  if (!m) {
    return abs({ k: "unknown" }, { op: "lit", value: null as never }, undefined, "exact");
  }
  // m[i] 按下标可读：tuple；未参与捕获的组是 undefined 字面量（?? 默认值可用）
  const els: Abs[] = m.map((g) => (g === undefined ? undefAbs() : strLit(g)));
  return abs({ k: "tuple", elements: els }, undefined, undefined, "exact");
}

/** string.match(/re/) / string.search(/re/)：双字面量 → 真执行 */
function stringRegexMethod(recv: Abs, method: string, args: Abs[]): Abs | undefined {
  if (method !== "match" && method !== "search") return undefined;
  const re = args[0];
  if (!re || re.shape.k !== "brand" || re.shape.name !== "RegExp") return undefined;
  const inner = re.shape.shape;
  const patAbs = inner.shape.k === "obj" ? inner.shape.slots["source"]?.value : undefined;
  const flagsAbs = inner.shape.k === "obj" ? inner.shape.slots["flags"]?.value : undefined;
  const pat = patAbs ? litValue(patAbs) : undefined;
  const sv = litValue(recv);
  if (typeof pat !== "string" || typeof sv !== "string") return undefined;
  const flagsV = flagsAbs ? litValue(flagsAbs) : undefined;
  const flags = typeof flagsV === "string" ? flagsV : "";
  let reReal: RegExp;
  try {
    reReal = new RegExp(pat, flags);
  } catch {
    return undefined;
  }
  if (method === "search") {
    const idx = sv.search(reReal);
    return abs({ k: "prim", type: "number" }, { op: "lit", value: idx as never }, undefined, "exact");
  }
  // 非 global match ≡ exec；global → 全部命中串
  if (flags.includes("g")) {
    const all = sv.match(reReal) ?? [];
    return abs({ k: "tuple", elements: all.map((s) => strLit(s)) }, undefined, undefined, "exact");
  }
  const m = reReal.exec(sv);
  if (!m) {
    return abs({ k: "unknown" }, { op: "lit", value: null as never }, undefined, "exact");
  }
  const els: Abs[] = m.map((g) => (g === undefined ? undefAbs() : strLit(g)));
  return abs({ k: "tuple", elements: els }, undefined, undefined, "exact");
}

/** 实例方法调用：沿继承链；类 Abs 上回落 staticMethods；obj 上回落属性函数 */
export function $invoke(
  thisVal: Abs,
  method: string,
  args: Abs[],
  loc?: [number, number],
): Abs {
  // 宿主 JS 命名空间对象（Math/Number/JSON…）→ Abs builtin 表
  if (!thisVal || typeof thisVal !== "object" || !("shape" in thisVal)) {
    const ns = namespaceNameOf(thisVal);
    return (ns ? evalNamespaceCall(ns, method, args) : undefined) ?? unknown;
  }
  // union：只在「声称支持」该方法的成员上派发，再 join（string|Buffer.split
  // 不应因 Buffer 分支无 split 而整体 unknown）
  if (thisVal.shape.k === "sum") {
    const results = thisVal.shape.members
      .filter((m) => memberLikelyHasMethod(m, method))
      .map((m) => $invoke(m, method, args, loc));
    if (results.length === 0) return unknown;
    return results.reduce((a, b) => joinAbs(a, b));
  }
  // RegExp brand exec/test（字面量 pattern 精确执行）
  {
    const reR = execRegexBrand(thisVal, method, args);
    if (reR !== undefined) return reR;
  }
  const brandName = thisVal.shape.k === "brand" ? thisVal.shape.name : undefined;
  if (brandName) {
    // C1：Map/Set 方法（条目表）
    if (brandName === "Map" || brandName === "Set") {
      const viaCol = evalBuiltinInstanceMethod(brandName, method, thisVal, args);
      if (viaCol !== undefined) return viaCol;
    }
    const m = findMethod(brandName, method);
    if (m) return m(thisVal, ...args);
    const spec = getBClass(brandName);
    const sm = spec?.staticMethods?.[method];
    if (sm) return sm(...args);
  }
  // 数组/元组方法（与 ast-eval 口径对齐）
  if (thisVal.shape.k === "arr" || thisVal.shape.k === "tuple") {
    const arrR = invokeArrMethod(thisVal, method, args);
    if (arrR !== undefined) return arrR;
  }
  // string.match(/re/) / string.search(/re/)（字面量 pattern 精确执行）
  {
    const sm = stringRegexMethod(thisVal, method, args);
    if (sm !== undefined) return sm;
  }
  // 字符串/模板方法表（B 路径此前缺失，与 ast-eval 对齐）
  {
    const viaTable = callAbsMethod(thisVal, method, args);
    if (viaTable) return viaTable;
  }
  // 属性上的可调用值（require namespace / 对象方法）；method 诊断由下方统一报
  const prop = $get(thisVal, method, { silent: true });
  const impl = prop && typeof prop === "object" && "shape" in (prop as object)
    ? getFnImpl(prop as Abs)
    : undefined;
  if (impl) {
    return $call(prop as Abs, args);
  }
  // prim 接收者上的未知方法 → no-method；unknown → unknown-recv
  if (notePrimMemberMissing(thisVal, method, "method", loc)) return unknown;
  noteUnknownMemberMissing(thisVal, method, "method", loc);
  return unknown;
}

/** union 成员是否可能持有该方法（避免 Buffer 无 split 拖垮 string 分支） */
function memberLikelyHasMethod(m: Abs, method: string): boolean {
  const k = m.shape.k;
  if (k === "prim" && m.shape.type === "string") return true;
  if (k === "brand" || k === "obj") return true;
  if (k === "arr" || k === "tuple") return true;
  if (k === "eff") return true;
  return false;
}

/** arr/tuple 上的 map/reduce/filter/join/includes/flatMap */
function invokeArrMethod(arr: Abs, method: string, args: Abs[]): Abs | undefined {
  const shape = arr.shape as
    | { k: "arr"; element: Abs }
    | { k: "tuple"; elements: Abs[] };
  // 统一委托 applyCallbackAbs（不新增 env.fns；Abs 侧 D/E 与 ast-eval 同轨）
  const callFn = (fn: unknown, ...fnArgs: Abs[]): Abs => {
    if (typeof fn === "function") {
      const r = callAtFunctionBoundary(() => (fn as (...a: Abs[]) => unknown)(...fnArgs));
      if (r && typeof r === "object" && "shape" in (r as object)) return r as Abs;
      return unknown;
    }
    const absFn = asAbs(fn);
    if (absFn) {
      return applyCallbackAbs(absFn, fnArgs, emptyEnv(), pTrue, defaultLeakBudget);
    }
    return unknown;
  };
  const isRelationOnly = (fn: unknown): fn is Abs => {
    const a = asAbs(fn);
    if (!a) return false;
    const impl = getFnImpl(a);
    if (impl?.body || impl?.apply) return false;
    return !!(impl?.relation || isRelFn(a));
  };
  if (method === "map" && args[0]) {
    if (shape.k === "tuple") {
      const mapped = shape.elements.map((el) => callFn(args[0], el));
      return abs({ k: "tuple", elements: mapped }, undefined, undefined, "path");
    }
    const out = callFn(args[0], shape.element);
    const el = mapElementFallback(asAbs(args[0]), shape.element, out);
    // 与 ast-eval map 同轨：fallback 强制 partial，否则 confJoin(arr, out)
    const conf =
      el === out ? confJoin(arr.conf, out.conf) : "partial";
    return abs({ k: "arr", element: el }, undefined, undefined, conf);
  }
  if (method === "reduce" && args.length >= 1) {
    const fn = args[0]!;
    let acc = args[1] ?? unknown;
    // 仅 relation → 一次 join，不动点只在有 body 时跑
    if (isRelationOnly(fn) && shape.k === "arr") {
      const d = instantiateReturn(fn, [acc, shape.element]);
      return joinAbs(acc, d);
    }
    const list = shape.k === "tuple" ? shape.elements : [shape.element];
    for (const el of list) {
      acc = callFn(fn, acc, el);
    }
    return acc;
  }
  if (method === "filter" && args[0]) {
    // 长度不保留：定长 tuple 经 filter 后最多是子序列，谓词不逐位证明时
    // 必须降为 arr（元素 join），否则 length/索引会假精确。
    if (shape.k === "tuple") {
      const el =
        shape.elements.length > 0
          ? shape.elements.reduce((a, b) => joinAbs(a, b))
          : unknown;
      return abs({ k: "arr", element: el }, undefined, undefined, confJoin(arr.conf, "path"));
    }
    return arr;
  }
  if (method === "flatMap" && args[0]) {
    if (shape.k === "tuple") {
      const mapped = shape.elements.map((el) => callFn(args[0], el));
      return projectFlatMapResult(arr.conf, mapped);
    }
    const out = callFn(args[0], shape.element);
    return projectFlatMapResult(arr.conf, [out]);
  }
  if (method === "forEach" && args[0]) {
    const list = shape.k === "tuple" ? shape.elements : [shape.element];
    for (const el of list) callFn(args[0], el);
    return undefAbs();
  }
  if ((method === "some" || method === "every") && args[0]) {
    const list = shape.k === "tuple" ? shape.elements : [shape.element];
    for (const el of list) callFn(args[0], el);
    return bool();
  }
  if (method === "find" && args[0]) {
    // 不证明命中元素：tuple 只对首元素应用回调；结果 element ∪ undefined
    const el = shape.k === "tuple" ? (shape.elements[0] ?? unknown) : shape.element;
    callFn(args[0], el);
    return joinAbs(el, undefAbs());
  }
  if (method === "join") {
    return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
  }
  if (method === "fill" && args.length >= 1) {
    const v = asAbs(args[0]!) ?? unknown;
    if (shape.k === "tuple") {
      return abs(
        { k: "tuple", elements: shape.elements.map(() => v) },
        undefined,
        undefined,
        confJoin(arr.conf, v.conf),
      );
    }
    return abs({ k: "arr", element: v }, undefined, undefined, confJoin(arr.conf, v.conf));
  }
  if (method === "includes") {
    return abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial");
  }
  // C1.4：语句重绑走 $arrMutContainer（容器）；表达式位置按 JS 语义返回 length
  if (method === "push" || method === "unshift") {
    return abs({ k: "prim", type: "number" }, undefined, undefined, "path");
  }
  if (method === "pop") {
    if (shape.k === "tuple") {
      return shape.elements.length > 0
        ? (shape.elements[shape.elements.length - 1] ?? unknown)
        : undefAbs();
    }
    if (shape.k === "arr") return joinAbs(shape.element, undefAbs());
  }
  if (method === "shift" || method === "at") {
    if (shape.k === "tuple" && shape.elements.length > 0) {
      return shape.elements[0] ?? unknown;
    }
    if (shape.k === "arr") {
      return method === "at" ? shape.element : joinAbs(shape.element, undefAbs());
    }
  }
  return undefined;
}

/** super.method()：从父类起找（跳过自身覆盖） */
export function $invokeSuper(
  thisVal: Abs,
  childName: string,
  method: string,
  args: Abs[],
): Abs {
  const child = getBClass(childName);
  const parentName = child?.superName;
  if (!parentName) return unknown;
  const m = findMethod(parentName, method);
  if (!m) return unknown;
  return m(thisVal, ...args);
}

export function $thisGet(thisVal: Abs, key: string): Abs {
  if (thisVal.shape.k === "brand") {
    const inner = thisVal.shape.shape;
    if (inner.shape.k === "obj") {
      const slot = inner.shape.slots[key];
      if (slot) return slot.value;
    }
  }
  return unknown;
}

export function $thisSet(thisVal: Abs, key: string, value: Abs): Abs {
  if (thisVal.shape.k === "brand") {
    const inner = thisVal.shape.shape;
    const slots = inner.shape.k === "obj" ? { ...inner.shape.slots } : {};
    slots[key] = { value: asAbsVal(value) };
    return abs(
      {
        k: "brand",
        name: thisVal.shape.name,
        shape: objOf(slots),
      },
      thisVal.term,
      thisVal.pred,
      confJoin(thisVal.conf, value.conf),
    );
  }
  return unknown;
}

/** 解构默认值：undefined 时用 default */
export function $orDefault(v: Abs, dflt: () => Abs): Abs {
  // 实参缺失：transpile 占位参数收到 JS undefined（非 Abs）
  if (v === undefined) return asAbsVal(dflt());
  if (litValue(v) === undefined && v.shape.k !== "never") {
    // 明确 undefined 字面量 → 默认值；unknown 保守保留
    if (v.term?.op === "lit" && v.term.value === undefined) return asAbsVal(dflt());
    if (v.shape.k === "unknown" && v.term?.op === "lit") return asAbsVal(dflt());
  }
  if (v.term?.op === "lit" && v.term.value === undefined) return asAbsVal(dflt());
  return v;
}

function isNullishAbs(v: Abs): boolean {
  // 仅明确 null/undefined 字面量；对象等无 term 不算 nullish
  if (!v || v.term?.op !== "lit") return false;
  const lv = v.term.value;
  return lv === null || lv === undefined;
}

/** 可选链 a?.b：nullish 短路为 undefined 字面量 */
export function $optionalGet(o: Abs, key: string): Abs {
  if (isNullishAbs(o)) {
    return abs(
      { k: "unknown" },
      { op: "lit", value: undefined as never },
      undefined,
      "exact",
    );
  }
  return $get(o, key);
}

/** 可选链 a?.m()：nullish 短路为 undefined */
export function $optionalInvoke(thisVal: Abs, method: string, args: Abs[]): Abs {
  if (isNullishAbs(thisVal)) {
    return abs(
      { k: "unknown" },
      { op: "lit", value: undefined as never },
      undefined,
      "exact",
    );
  }
  return $invoke(thisVal, method, args);
}

/** 静态方法：cls.staticMethod(args) */
export function $staticInvoke(cls: Abs, method: string, args: Abs[]): Abs {
  const spec = specOf(cls);
  const m = spec?.staticMethods?.[method];
  if (!m) return unknown;
  return m(...args);
}

/** 计算属性写：o[kAbs] = v */
export function $setKey(o: Abs, key: Abs, value: Abs): Abs {
  const k = litValue(key);
  if (typeof k === "string" || typeof k === "number") {
    return $set(o, String(k), value);
  }
  return $set(o, "?", value);
}
