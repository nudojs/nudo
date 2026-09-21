/**
 * B 路径 class：brand 实例 + ctor/method 闭包 + 继承链。
 * 方法内 this 由 transpile 改写为 thisVal 参数。
 */

import type { Abs } from "../abs.ts";
import { abs, unknown, confJoin, litValue, bool, boolLit, strLit, numLit } from "../abs.ts";
import { objOf, joinAbs, isObj, canonicalArrayIndex } from "../objects.ts";
import { $get, $set, $lit, asAbsVal, namespaceNameOf, $regex, $arrMutContainer, callAtFunctionBoundary, lookupObjAccessor, fillTuple } from "./runtime.ts";
import { $call } from "./call.ts";
import { getFnImpl, absFunction } from "../abs-fn.ts";
import { evalNamespaceCall, errorBrandAbs, isErrorCtorName, evalBuiltinInstanceMethod, extStateOf, getPropFlags, tryMakeRegexAbs } from "../builtins.ts";
import { isMapAbs, isSetAbs, makeMapAbs, makeSetAbs, collectionElementJoin, ctorArgDefinitelyInvalid } from "../collections.ts";
import { registerMatchIter } from "./match-iter.ts";
import { TUPLE_MATERIALIZE_CAP } from "../containers.ts";
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
import {
  notePrimMemberMissing,
  noteUnknownMemberMissing,
  noteAnyMemberMayThrow,
  noteNullishMemberThrows,
  anyMemberResult,
  definitelyUncallableMember,
} from "./calls.ts";
import { errorTypeAbs } from "./may-throw.ts";
import { NudoThrow, $collectionForEach } from "./runtime.ts";
import { callAbsMethod } from "../methods.ts";
import {
  registerBClass,
  markClassValue,
  getBClass,
  type BClassSpec,
} from "./class-registry.ts";

export type { BClassSpec } from "./class-registry.ts";
export { registerBClass, getBClass, clearBClasses } from "./class-registry.ts";

const classImpl = new WeakMap<object, BClassSpec>();

/** 定义类 → 可 new 的 Abs（brand 标记；静态字段挂在 slots） */
export function $class(
  name: string,
  spec: Omit<BClassSpec, "name"> & { extends?: string | Abs | unknown },
): Abs {
  // extends 是活引用：类值取 brand 名、宿主 ctor 取 .name、字符串向后兼容
  const ext = spec.extends;
  let superName: string | undefined;
  if (typeof ext === "string") superName = ext;
  else if (ext && typeof ext === "object" && "shape" in (ext as object)) {
    const s = (ext as Abs).shape;
    superName = s.k === "brand" ? s.name : undefined;
  } else if (typeof ext === "function") {
    superName = (ext as { name?: string }).name;
  }
  const full: BClassSpec = {
    name,
    superName,
    ctor: spec.ctor,
    methods: spec.methods,
    staticMethods: spec.staticMethods,
    statics: spec.statics,
    accessors: spec.accessors,
    staticAccessors: spec.staticAccessors,
  };
  registerBClass(full);
  const slots: Record<string, { value: Abs }> = {};
  if (spec.statics) {
    for (const [k, v] of Object.entries(spec.statics)) slots[k] = { value: asAbsVal(v) };
  }
  // 类值自有 name 属性（原生 Function.name；类表达式/声明均可读）
  slots["name"] = { value: strLit(name) };
  const val = abs(
    { k: "brand", name, shape: objOf(slots) },
    undefined,
    undefined,
    "exact",
  );
  classImpl.set(val as object, full);
  markClassValue(val as object, name);
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
        if (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= TUPLE_MATERIALIZE_CAP) {
          // new Array(n)：全空洞（无自有槽；读值 undefined、in 判定 false）
          const els = Array.from({ length: n }, () => undefAbs());
          const holes = Array.from({ length: n }, (_, i) => i);
          return abs(
            { k: "tuple", elements: els, holes: n > 0 ? holes : undefined },
            undefined,
            undefined,
            "exact",
          );
        }
        return abs({ k: "arr", element: unknown }, undefined, undefined, "partial");
      }
      return abs({ k: "tuple", elements: args.map((a) => asAbs(a) ?? unknown) }, undefined, undefined, "exact");
    }
    // new RegExp(pattern, flags)：字面量真构造验证——非法 pattern/flags 硬抛
    // SyntaxError/TypeError；合法折叠精确 brand；抽象/RegExp 实例保守（下方 path brand）
    if (cls === RegExp) {
      const m = tryMakeRegexAbs(args);
      if (m) return m;
    }
    const clsName = cls.name || "Object";
    // C2.2：Error 家族携带 name/message 槽（catch 形参可读）
    if (isErrorCtorName(clsName)) {
      return errorBrandAbs(clsName, args);
    }
    // C1.1 / C1.2：Map / Set 条目表（按 ctor 名比对，避开 TS 全局接口无交集）
    // 确定非法实参（非可迭代字面量 / Map prim 条目）→ 原生 TypeError hard throw
    if (clsName === "Map") {
      if (ctorArgDefinitelyInvalid("Map", args[0])) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      return makeMapAbs(args[0]);
    }
    if (clsName === "Set") {
      if (ctorArgDefinitelyInvalid("Set", args[0])) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      return makeSetAbs(args[0]);
    }
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

/** RegExp brand 内部 source/flags/lastIndex 提取（exec/test 共用） */
function regexParts(re: Abs): { pat: string; flags: string; lastIndex: number } | undefined {
  if (re.shape.k !== "brand" || re.shape.name !== "RegExp") return undefined;
  const inner = re.shape.shape;
  if (!isObj(inner)) return undefined;
  const slots = inner.shape.slots;
  const patAbs = slots["source"]?.value;
  const flagsAbs = slots["flags"]?.value;
  const lastAbs = slots["lastIndex"]?.value;
  const pat = patAbs ? litValue(patAbs) : undefined;
  if (typeof pat !== "string") return undefined;
  const flagsV = flagsAbs ? litValue(flagsAbs) : undefined;
  const flags = typeof flagsV === "string" ? flagsV : "";
  const lv = lastAbs ? litValue(lastAbs) : undefined;
  const lastIndex = typeof lv === "number" ? lv : 0;
  return { pat, flags, lastIndex };
}

/** 带 receiver lastIndex 的真实执行：返回结果 Abs 与执行后的 lastIndex */
function regexExecWithState(
  re: Abs,
  method: "test" | "exec",
  subject: string,
): { result: Abs; lastIndex: number } {
  const parts = regexParts(re)!;
  const reReal = new RegExp(parts.pat, parts.flags);
  reReal.lastIndex = parts.lastIndex;
  if (method === "test") {
    const ok = reReal.test(subject);
    return { result: boolLit(ok), lastIndex: reReal.lastIndex };
  }
  const m = reReal.exec(subject);
  if (!m) {
    return {
      result: abs({ k: "unknown" }, { op: "lit", value: null as never }, undefined, "exact"),
      lastIndex: reReal.lastIndex,
    };
  }
  // m[i] 按下标可读：tuple；未参与捕获的组是 undefined 字面量（?? 默认值可用）
  const els: Abs[] = m.map((g) => (g === undefined ? undefAbs() : strLit(g)));
  return {
    result: abs({ k: "tuple", elements: els }, undefined, undefined, "exact"),
    lastIndex: reReal.lastIndex,
  };
}

/** RegExp brand 上的 exec/test：pattern 与 subject 都是字面量 → 真执行 */
function execRegexBrand(re: Abs, method: string, args: Abs[]): Abs | undefined {
  if (method !== "exec" && method !== "test" && method !== "toString") return undefined;
  const parts = regexParts(re);
  if (!parts) return undefined;
  if (method === "toString") return strLit(`/${parts.pat}/${parts.flags}`);
  const subject = args[0] ? litValue(args[0]) : undefined;
  if (typeof subject !== "string") {
    // subject 非字面量：保持抽象（test → boolean，exec → null|tuple 的保守并）
    return method === "test"
      ? abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial")
      : undefined;
  }
  try {
    return regexExecWithState(re, method, subject).result;
  } catch {
    return undefined;
  }
}

/**
 * 语句级 RegExp 状态写回（test/exec）：执行并把 lastIndex 更新后的 brand
 * 返回给 transpile 重绑（$reStateCall 与 $arrMutContainer 同模式）。
 * 表达式位置不写回（$invoke 只读执行，调用方按 JS 语义先取值）。
 */
export function $reStateCall(re: Abs, method: string, args: Abs[]): Abs {
  const parts = regexParts(re);
  if (!parts || (method !== "test" && method !== "exec")) return re;
  const subject = args[0] ? litValue(args[0]) : undefined;
  if (typeof subject !== "string") return re; // 抽象 subject：状态不可判定，保守不动
  try {
    const { lastIndex } = regexExecWithState(re, method, subject);
    const inner = (re.shape as { k: "brand"; name: string; shape: Abs }).shape;
    if (!isObj(inner)) return re;
    const slots = { ...inner.shape.slots, lastIndex: { value: numLit(lastIndex) } };
    return abs(
      { k: "brand", name: "RegExp", shape: objOf(slots, { open: inner.shape.open }) },
      re.term,
      re.pred,
      re.conf,
    );
  } catch {
    return re;
  }
}

/** string.match(/re/) / string.search(/re/) / string.matchAll(/re/g)：双字面量 → 真执行 */
function stringRegexMethod(recv: Abs, method: string, args: Abs[]): Abs | undefined {
  if (method !== "match" && method !== "search" && method !== "matchAll") return undefined;
  const re = args[0];
  const reBrand =
    !!re && re.shape.k === "brand" && re.shape.name === "RegExp"
      ? (re as Abs & { shape: Extract<Abs["shape"], { k: "brand" }> })
      : undefined;
  const inner = reBrand?.shape.shape;
  const patAbs = inner && inner.shape.k === "obj" ? inner.shape.slots["source"]?.value : undefined;
  const flagsAbs = inner && inner.shape.k === "obj" ? inner.shape.slots["flags"]?.value : undefined;
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
  if (method === "match") {
    // 非 global match ≡ exec；global → 全部命中串；无命中 → null（不是 []）
    if (flags.includes("g")) {
      const all = sv.match(reReal);
      if (all === null) {
        return abs({ k: "unknown" }, { op: "lit", value: null as never }, undefined, "exact");
      }
      return abs({ k: "tuple", elements: all.map((s) => strLit(s)) }, undefined, undefined, "exact");
    }
    const m = reReal.exec(sv);
    if (!m) {
      return abs({ k: "unknown" }, { op: "lit", value: null as never }, undefined, "exact");
    }
    const els: Abs[] = m.map((g) => (g === undefined ? undefAbs() : strLit(g)));
    return abs({ k: "tuple", elements: els }, undefined, undefined, "exact");
  }
  // matchAll：非全局正则原生 TypeError（hard throw，catch 可吸收）；
  // 全局（brand /g）→ 真执行迭代，每项 [full, ...groups] 元组
  if (!reBrand) return undefined; // 非 brand 参数（如字符串模式）：保守回落
  if (!flags.includes("g")) {
    throw new NudoThrow(
      errorTypeAbs("TypeError"),
    );
  }
  const ms = sv.matchAll(reReal);
  const matchEls: Abs[] = [];
  for (const m of ms) {
    const els: Abs[] = m.map((g) => (g === undefined ? undefAbs() : strLit(g)));
    matchEls.push(abs({ k: "tuple", elements: els }, undefined, undefined, "exact"));
  }
  // RegExpStringIterator 是对象：无 .length/下标；展开经侧表按匹配项精确迭代
  const iter = abs(
    { k: "brand", name: "RegExpMatchIterator", shape: objOf({}) },
    undefined,
    undefined,
    "path",
  );
  registerMatchIter(iter, matchEls);
  return iter;
}

/**
 * Object.assign（B-path 专用，accessor 感知）：与 builtins 的槽位合并对齐，
 * 但拷贝源访问器时**调用 getter**（原生语义），结果槽存 getter 返回值。
 */
/** strict：Object.assign 到不可变/不可扩展/不可写目标 → TypeError（同 $set 口径） */
function throwStrictAssign(): never {
  throw new NudoThrow(errorTypeAbs("TypeError"));
}

function runtimeAssignObject(args: Abs[]): Abs {
  if (!args.length) return unknown;
  // target 字面量：null/undefined → TypeError；prim → 装箱语义未建模。
  // 两者都不该折出精确值（假精确 null 的根因）
  const t0 = asAbsVal(args[0]!);
  if (t0.term?.op === "lit") return unknown;
  let acc = args[0]!;
  for (let i = 1; i < args.length; i++) {
    acc = asAbsVal(acc);
    const st = extStateOf(acc);
    if (st === "frozen") throwStrictAssign(); // strict：assign 到 frozen 目标 TypeError
    const src = asAbsVal(args[i]!);
    if (acc.shape.k === "obj" && src.shape.k === "obj") {
      const base = { ...acc.shape.slots };
      const flags = getPropFlags(acc);
      for (const [k, s] of Object.entries(src.shape.slots)) {
        // sealed/nonext 目标新键 / writable:false 键覆写：strict TypeError
        if (
          (st === "sealed" || st === "nonext") &&
          !Object.prototype.hasOwnProperty.call(base, k)
        ) {
          throwStrictAssign();
        }
        if (flags?.get(k)?.writable === false) throwStrictAssign();
        const a = lookupObjAccessor(src, k);
        base[k] = a?.get ? { value: a.get(src) } : s;
      }
      acc = objOf(base, {
        index: acc.shape.index,
        open: acc.shape.open || src.shape.open,
      });
      acc.conf = confJoin(acc.conf, src.conf);
    } else if (acc.shape.k === "tuple" && src.shape.k === "obj") {
      // 数组 target：数字键按下标写（扩展 length）、"length" 键截断/延长
      // （延长段 hole；非法 length 原生 RangeError）、非规范键 expando 忽略。
      // 源键序 = 原生 [[OwnPropertyKeys]] 序（整数键升序 → 字符串插入序）。
      acc = assignArrayTarget(acc, src, st);
    }
  }
  return acc;
}

/**
 * Object.assign 数组 target 的逐键写（B-path）：
 * 与原生同序处理 length 键与下标键（先写后截断可抹掉写入）。
 * getter 源键调用 getter；frozen/sealed 新下标 strict TypeError。
 */
function assignArrayTarget(target: Abs, src: Abs, st: "nonext" | "sealed" | "frozen" | undefined): Abs {
  const ts = target.shape as Extract<Abs["shape"], { k: "tuple" }>;
  const ss = src.shape as Extract<Abs["shape"], { k: "obj" }>;
  let elements = [...ts.elements];
  let holes = [...(ts.holes ?? [])];
  let len = elements.length;
  const origLen = len;
  for (const [k, s] of Object.entries(ss.slots)) {
    if (k === "length") {
      const a = lookupObjAccessor(src, k);
      const vAbs = a?.get ? a.get(src) : s.value;
      const lv = vAbs.term?.op === "lit" ? vAbs.term.value : undefined;
      if (typeof lv !== "number" || !Number.isInteger(lv) || lv < 0) {
        // 非法/非字面量 length 写：原生 RangeError（"Invalid array length"）
        throw new NudoThrow(errorTypeAbs("RangeError"));
      }
      if (lv > TUPLE_MATERIALIZE_CAP) {
        // 合法但巨大：不物化巨 tuple，保守降 arr
        const el = elements.length ? elements.reduce((x, y) => joinAbs(x, y)) : unknown;
        return abs({ k: "arr", element: el }, undefined, undefined, "partial");
      }
      if (lv < len) {
        elements.length = lv;
        holes = holes.filter((h) => h < lv);
      } else {
        for (let j = len; j < lv; j++) holes.push(j);
      }
      len = lv;
      continue;
    }
    const idx = canonicalArrayIndex(k);
    if (idx === undefined) continue; // expando：Abs 数组不存（length 不受影响）
    if (idx >= origLen && (st === "sealed" || st === "nonext")) {
      throwStrictAssign();
    }
    const a = lookupObjAccessor(src, k);
    const vAbs = a?.get ? a.get(src) : s.value;
    if (idx >= len) len = idx + 1;
    if (idx >= elements.length) elements.length = idx + 1;
    elements[idx] = vAbs;
    holes = holes.filter((h) => h !== idx);
  }
  elements.length = len;
  return abs(
    { k: "tuple", elements, holes: holes.length > 0 ? holes : undefined },
    undefined,
    undefined,
    confJoin(target.conf, src.conf),
  );
}

/** 实例方法调用：沿继承链；类 Abs 上回落 staticMethods；obj 上回落属性函数 */
export function $invoke(
  thisVal: Abs,
  method: string,
  args: Abs[],
  loc?: [number, number],
): Abs {
  // Function.prototype.call/apply/bind：fn Abs **或** B 路径 JS 函数（P1）
  if (method === "call" || method === "apply" || method === "bind") {
    // apply 第二参：tuple 精确展开；JS 数组逐项；Abs arr 长度未知 → 单 element
    // （类型层欠近似）；null/undefined → 无参（JS 语义）；其它 → unknown 槽位
    const expandApplyArgs = (list: unknown): Abs[] => {
      if (list === null || list === undefined) return [];
      if (Array.isArray(list)) {
        return list.map((x) =>
          x && typeof x === "object" && "shape" in (x as object)
            ? (x as Abs)
            : unknown,
        );
      }
      if (typeof list === "object" && "shape" in (list as object)) {
        const s = (list as Abs).shape;
        if (s.k === "tuple") return [...s.elements];
        if (s.k === "arr") return [s.element];
      }
      return [unknown];
    };
    /** bind 后剩余形参：尽量保留原 params 面（dts/inlay） */
    const boundFnParams = (fnVal: unknown, boundCount: number): string[] => {
      if (fnVal && typeof fnVal === "object" && "shape" in (fnVal as object)) {
        const s = (fnVal as Abs).shape;
        if (s.k === "fn" && Array.isArray(s.params)) {
          return s.params.slice(boundCount);
        }
      }
      if (typeof fnVal === "function") {
        const arity = (fnVal as { length?: number }).length ?? 0;
        const rem = Math.max(0, arity - boundCount);
        return Array.from({ length: rem }, (_, i) => `_a${boundCount + i}`);
      }
      return ["_rest"];
    };
    if (typeof thisVal === "function") {
      const fn = thisVal as (...a: Abs[]) => Abs;
      // thisArg（Abs）作为宿主 this 传入；函数体 prologue $rawThis(this) 承接。
      // 缺 thisArg（call() 无实参）→ 宿主 undefined ≡ strict this undefined。
      if (method === "call") {
        return callAtFunctionBoundary(() => fn.apply(args[0] as never, args.slice(1)));
      }
      if (method === "apply") {
        return callAtFunctionBoundary(() => fn.apply(args[0] as never, expandApplyArgs(args[1])));
      }
      const boundThis = args[0];
      const bound = args.slice(1);
      return absFunction(boundFnParams(thisVal, bound.length), {
        apply: (callArgs) =>
          callAtFunctionBoundary(() => fn.apply(boundThis as never, [...bound, ...callArgs])),
      });
    }
    if (thisVal && typeof thisVal === "object" && "shape" in thisVal) {
      const fnImpl = getFnImpl(thisVal);
      const isCallable = thisVal.shape.k === "fn" || fnImpl !== undefined;
      if (isCallable) {
        // bindThis（对象方法）：thisArg 注入首参；普通 fn：thisVal 经 apply 钩子传入
        const bindThis = !!fnImpl?.bindThis;
        if (method === "call") {
          return bindThis
            ? $call(thisVal, [args[0] ?? $lit(undefined), ...args.slice(1)])
            : $call(thisVal, args.slice(1), args[0]);
        }
        if (method === "apply") {
          return bindThis
            ? $call(thisVal, [args[0] ?? $lit(undefined), ...expandApplyArgs(args[1])])
            : $call(thisVal, expandApplyArgs(args[1]), args[0]);
        }
        const boundThis = args[0];
        const bound = args.slice(1);
        return absFunction(boundFnParams(thisVal, bound.length), {
          apply: (callArgs) =>
            callAtFunctionBoundary(() =>
              bindThis
                ? $call(thisVal, [boundThis ?? $lit(undefined), ...bound, ...callArgs])
                : $call(thisVal, [...bound, ...callArgs], boundThis),
            ),
        });
      }
    }
  }
  // 宿主 JS 命名空间对象（Math/Number/JSON…）→ Abs builtin 表
  if (!thisVal || typeof thisVal !== "object" || !("shape" in thisVal)) {
    const ns = namespaceNameOf(thisVal);
    if (ns === "Object" && method === "assign") {
      return runtimeAssignObject(args);
    }
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
      if (method === "forEach") {
        const r = $collectionForEach(thisVal, args[0]);
        if (r !== undefined) return r;
      }
    }
    const m = findMethod(brandName, method);
    if (m) return m(thisVal, ...args);
    const spec = getBClass(brandName);
    const sm = spec?.staticMethods?.[method];
    if (sm) return sm(...args);
  }
  // bigint 字面量：toString(radix)/valueOf 精确折叠（非法 radix 原生 RangeError → unknown）
  if (thisVal.shape.k === "prim" && thisVal.shape.type === "bigint") {
    const bv = litValue(thisVal) as bigint | undefined;
    if (typeof bv === "bigint") {
      if (method === "valueOf") return thisVal;
      if (method === "toString") {
        const rad = args[0] ? litValue(args[0]) : undefined;
        const r =
          rad === undefined
            ? 10
            : typeof rad === "number" && Number.isInteger(rad) && rad >= 2 && rad <= 36
              ? rad
              : undefined;
        if (r !== undefined) {
          try {
            return strLit(bv.toString(r));
          } catch {
            return unknown;
          }
        }
        return unknown; // 非法/符号 radix：原生 RangeError
      }
    }
    return unknown;
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
    // 对象方法（ObjectMethod / 方法型 FunctionExpression）：注入 receiver
    if (impl.bindThis) return $call(prop as Abs, [thisVal, ...args]);
    return $call(prop as Abs, args);
  }
  // 结构上确定不可调用（null-proto 缺失名 / 闭 exact 对象非 OP 名缺失 /
  // 字面量非函数槽）→ 原生 TypeError hard throw（catch 可吸收）
  if (definitelyUncallableMember(thisVal, method)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // prim 接收者上的未知方法 → no-method
  if (notePrimMemberMissing(thisVal, method, "method", loc)) return unknown;
  // nullish → may-throw TypeError（soft）；any → may-throw + 结果 any
  if (noteNullishMemberThrows(thisVal, method, "method", loc)) {
    return unknown;
  }
  if (noteAnyMemberMayThrow(thisVal, method, "method", loc)) {
    return anyMemberResult();
  }
  // unknown（推导失败）→ unknown-recv 引擎债
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
    | { k: "tuple"; elements: Abs[]; holes?: number[] };
  const holes = shape.k === "tuple" ? ((arr.shape as { holes?: number[] }).holes ?? []) : [];
  const isHole = (i: number): boolean => holes.includes(i);
  /** 抽象数组（长度未知）回调收到的索引是未知 number，不得折字面量 0 */
  const unknownIdx = (): Abs =>
    abs({ k: "prim", type: "number" }, undefined, undefined, "path");
  /** 回调结果具体 truthy：true / falsy / undefined=非具体（按 JS ToBoolean） */
  const callbackTruth = (r: Abs): boolean | undefined => {
    if (r.term?.op !== "lit") return undefined;
    const v = litValue(r);
    if (v === undefined || v === null || v === false || v === "" || (v as unknown) === 0n) return false;
    if (typeof v === "number" && (v === 0 || Number.isNaN(v))) return false;
    return true;
  };
  // 统一委托 applyCallbackAbs（不新增 env.fns；Abs 侧 D/E 与 ast-eval 同轨）
  const callFn = (fn: unknown, ...fnArgs: Abs[]): Abs => {
    const sumIdx = fnArgs.findIndex(
      (a) => a && typeof a === "object" && "shape" in (a as object) && (a as Abs).shape.k === "sum",
    );
    if (sumIdx >= 0) {
      const members = (fnArgs[sumIdx] as Abs & { shape: { k: "sum"; members: Abs[] } }).shape
        .members;
      let acc: Abs | undefined;
      for (const m of members) {
        const next = fnArgs.map((a, i) => (i === sumIdx ? m : a));
        const r = callFn(fn, ...next);
        acc = acc === undefined ? r : joinAbs(acc, r);
      }
      return acc ?? unknown;
    }
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
      const mapped = shape.elements.map((el, i) =>
        isHole(i) ? el : callFn(args[0], el, $lit(i)),
      );
      return abs(
        { k: "tuple", elements: mapped, holes: holes.length > 0 ? [...holes] : undefined },
        undefined,
        undefined,
        "path",
      );
    }
    const out = callFn(args[0], shape.element, unknownIdx());
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
    if (shape.k === "tuple") {
      for (let i = 0; i < shape.elements.length; i++) {
        if (isHole(i)) continue;
        acc = callFn(fn, acc, shape.elements[i]!, $lit(i));
      }
      return acc;
    }
    return callFn(fn, acc, shape.element, unknownIdx());
  }
  if (method === "reduceRight" && args.length >= 1) {
    const fn = args[0]!;
    let acc = args[1] ?? unknown;
    if (shape.k === "tuple") {
      for (let i = shape.elements.length - 1; i >= 0; i--) {
        if (isHole(i)) continue;
        acc = callFn(fn, acc, shape.elements[i]!, $lit(i));
      }
      return acc;
    }
    return callFn(fn, acc, shape.element, unknownIdx());
  }
  if (method === "filter" && args[0]) {
    // 逐位谓词：具体 true 保留、具体 false 丢弃、不确定并入（side effect 计数精确）。
    // hole 跳过谓词且不出现在结果里（原生 filter 收紧数组）。
    if (shape.k === "tuple") {
      const kept: Abs[] = [];
      let anyUncertain = false;
      shape.elements.forEach((el, i) => {
        if (isHole(i)) return;
        const p = callFn(args[0], el, $lit(i));
        const t = callbackTruth(p);
        if (t === false) return;
        if (t === undefined) anyUncertain = true;
        kept.push(el);
      });
      if (kept.length === 0) {
        return abs({ k: "arr", element: unknown }, undefined, undefined, "path");
      }
      // 谓词全具体 → 精确子序列保留 tuple 字面量精度
      if (!anyUncertain) {
        return abs({ k: "tuple", elements: kept }, undefined, undefined, confJoin(arr.conf, "path"));
      }
      const el = kept.reduce((a, b) => joinAbs(a, b));
      return abs({ k: "arr", element: el }, undefined, undefined, confJoin(arr.conf, "path"));
    }
    // arr：filter 保持元素类型（不传播回调 pred）
    return arr;
  }
  if (method === "flatMap" && args[0]) {
    if (shape.k === "tuple") {
      const mapped = shape.elements.map((el, i) =>
        isHole(i) ? abs({ k: "tuple", elements: [] }, undefined, undefined, "exact") : callFn(args[0], el, $lit(i)),
      );
      return projectFlatMapResult(arr.conf, mapped);
    }
    const out = callFn(args[0], shape.element, unknownIdx());
    return projectFlatMapResult(arr.conf, [out]);
  }
  if (method === "forEach" && args[0]) {
    if (shape.k === "tuple") {
      shape.elements.forEach((el, i) => {
        if (!isHole(i)) callFn(args[0], el, $lit(i));
      });
    } else {
      callFn(args[0], shape.element, unknownIdx());
    }
    return undefAbs();
  }
  if ((method === "some" || method === "every") && args[0]) {
    // 逐位短路：具体命中即停（some: truthy / every: falsy），副作用计数与原生一致。
    // 规范 some/every 检查 HasProperty：hole 位置跳过回调（与 find/findIndex 相反）。
    let undecided = false;
    if (shape.k === "tuple") {
      for (let i = 0; i < shape.elements.length; i++) {
        if (isHole(i)) continue;
        const t = callbackTruth(callFn(args[0], shape.elements[i]!, $lit(i)));
        if (t === undefined) {
          undecided = true;
          continue;
        }
        if (method === "some" && t) return boolLit(true);
        if (method === "every" && !t) return boolLit(false);
      }
    } else {
      const t = callbackTruth(callFn(args[0], shape.element, unknownIdx()));
      // 抽象 arr 长度未知（可能空）：单代表元素无法下结论
      if (t === undefined) return bool();
      if (method === "some" && t) return boolLit(true);
      if (method === "every" && !t) return boolLit(false);
      return bool();
    }
    if (undecided) return bool();
    return boolLit(method === "some" ? false : true);
  }
  if (method === "find" && args[0]) {
    if (shape.k === "tuple") {
      let undecided = false;
      for (let i = 0; i < shape.elements.length; i++) {
        const el = shape.elements[i]!;
        const t = callbackTruth(callFn(args[0], el, $lit(i)));
        if (t === true) return el;
        if (t === undefined) undecided = true;
      }
      if (undecided) {
        const joined = shape.elements.reduce((a, b) => joinAbs(a, b));
        return joinAbs(joined, undefAbs());
      }
      return undefAbs();
    }
    const el = shape.element;
    const t = callbackTruth(callFn(args[0], el, unknownIdx()));
    if (t === true) return el;
    if (t === false) return undefAbs();
    return joinAbs(el, undefAbs());
  }
  if (method === "findIndex" && args[0]) {
    if (shape.k === "tuple") {
      let undecided = false;
      for (let i = 0; i < shape.elements.length; i++) {
        const t = callbackTruth(callFn(args[0], shape.elements[i]!, $lit(i)));
        if (t === true) return $lit(i);
        if (t === undefined) undecided = true;
      }
      if (undecided) return joinAbs(unknownIdx(), $lit(-1));
      return $lit(-1);
    }
    const t = callbackTruth(callFn(args[0], shape.element, unknownIdx()));
    if (t === true) return unknownIdx();
    if (t === false) return $lit(-1);
    return joinAbs(unknownIdx(), $lit(-1));
  }
  if (method === "join") {
    return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
  }
  if (method === "keys") {
    if (shape.k === "tuple") {
      const holes = shape.holes ?? [];
      return abs(
        {
          k: "tuple",
          elements: shape.elements
            .map((el, i) => ({ el, i }))
            .filter(({ i }) => !holes.includes(i))
            .map(({ i }) => strLit(String(i))),
        },
        undefined,
        undefined,
        "exact",
      );
    }
    return abs({ k: "arr", element: strLit("0") }, undefined, undefined, "partial");
  }
  if (method === "values") {
    if (shape.k === "tuple") {
      const holes = shape.holes ?? [];
      return abs(
        {
          k: "tuple",
          elements: shape.elements
            .map((el, i) => ({ el, i }))
            .filter(({ i }) => !holes.includes(i))
            .map(({ el }) => el),
        },
        undefined,
        undefined,
        arr.conf,
      );
    }
    return arr;
  }
  if (method === "entries") {
    if (shape.k === "tuple") {
      const holes = shape.holes ?? [];
      return abs(
        {
          k: "tuple",
          elements: shape.elements
            .map((el, i) => ({ el, i }))
            .filter(({ i }) => !holes.includes(i))
            .map(({ el, i }) =>
              abs({ k: "tuple", elements: [strLit(String(i)), el] }, undefined, undefined, "exact"),
            ),
        },
        undefined,
        undefined,
        "exact",
      );
    }
    return abs(
      {
        k: "arr",
        element: abs(
          { k: "tuple", elements: [strLit("0"), shape.element] },
          undefined,
          undefined,
          "partial",
        ),
      },
      undefined,
      undefined,
      "partial",
    );
  }
  if (method === "fill" && args.length >= 1) {
    // 表达式值 = 变更后数组本身；start/end 折叠复用语句级 fillTuple
    // （字面量精确窗口；抽象边界 join 回退；Symbol 等非法参数保守）
    return fillTuple(shape, args, arr);
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
  if (method === "shift") {
    if (shape.k === "tuple" && shape.elements.length > 0) {
      return shape.elements[0] ?? unknown;
    }
    if (shape.k === "arr") return joinAbs(shape.element, undefAbs());
  }
  if (method === "at") {
    const raw = args[0] !== undefined ? litValue(args[0]) : undefined;
    const iv = typeof raw === "number" && Number.isInteger(raw) ? raw : undefined;
    if (shape.k === "tuple") {
      const els = shape.elements;
      if (iv === undefined) {
        if (els.length === 0) return undefAbs();
        return joinAbs(els.reduce((a, b) => joinAbs(a, b)), undefAbs());
      }
      const idx = iv < 0 ? els.length + iv : iv;
      if (idx >= 0 && idx < els.length) return els[idx] ?? unknown;
      return undefAbs();
    }
    if (shape.k === "arr") return joinAbs(shape.element, undefAbs());
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

/** 解构默认值：undefined（含 sum 成员 / 可能缺失）时用 default 并入非 undefined 部分 */
export function $orDefault(v: Abs, dflt: () => Abs): Abs {
  // 实参缺失：transpile 占位参数收到 JS undefined（非 Abs）
  if (v === undefined) return asAbsVal(dflt());
  if (isDefinitelyUndefinedAbs(v)) return asAbsVal(dflt());
  // sum / optional 可能含 undefined → JS 用 default 替换该成员，域是 dflt ∪ non-undefined
  if (v.shape.k === "sum") {
    const d = asAbsVal(dflt());
    const parts: Abs[] = [];
    let sawUndef = false;
    for (const m of v.shape.members) {
      if (isDefinitelyUndefinedAbs(m)) {
        sawUndef = true;
        continue;
      }
      parts.push(m);
    }
    if (!sawUndef) return v;
    if (parts.length === 0) return d;
    let joined = parts[0]!;
    for (let i = 1; i < parts.length; i++) joined = joinAbs(joined, parts[i]!);
    return joinAbs(joined, d);
  }
  return v;
}

function isDefinitelyUndefinedAbs(v: Abs | undefined): boolean {
  if (!v) return false;
  if (v.term?.op === "lit" && v.term.value === undefined) return true;
  // unknown + lit(undefined) 的历史折叠形
  if (v.shape.k === "unknown" && v.term?.op === "lit" && litValue(v) === undefined) return true;
  return false;
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

/** 计算属性写：o[kAbs] = v。非字面量 key → open + index join（不得写成字面槽 "?"） */
export function $setKey(o: Abs, key: Abs, value: Abs): Abs {
  const k = litValue(key);
  if (typeof k === "string" || typeof k === "number") {
    return $set(o, String(k), value);
  }
  const val = asAbsVal(value);
  if (o.shape.k === "brand") {
    const inner = $setKey(o.shape.shape, key, value);
    return abs(
      { k: "brand", name: o.shape.name, shape: inner },
      o.term,
      o.pred,
      confJoin(o.conf, value.conf),
    );
  }
  if (o.shape.k !== "obj") {
    return abs(
      {
        k: "obj",
        slots: {},
        index: { key: unknown, value: val },
        open: true,
      },
      undefined,
      undefined,
      confJoin("path", value.conf),
    );
  }
  const shape = o.shape as { slots: Record<string, { value: Abs; optional?: boolean }>; index?: { key: Abs; value: Abs }; open?: boolean };
  const prevIndex = shape.index?.value;
  const indexVal = prevIndex ? joinAbs(prevIndex, val) : val;
  const next = objOf({ ...shape.slots }, {
    index: { key: shape.index?.key ?? unknown, value: indexVal },
    open: true,
  });
  next.conf = confJoin(o.conf, value.conf);
  return next;
}
