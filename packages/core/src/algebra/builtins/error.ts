/**
 * Error 家族 + evalBuiltinNew / evalBuiltinInstanceMethod + namespace 分派
 */
import type { Abs } from "../abs.ts";
import { abs, strLit, numLit, litValue, bigintLit, unknown } from "../abs.ts";
import { objOf } from "../objects.ts";
import {
  makeMapAbs,
  makeSetAbs,
  mapGetEntry,
  mapHasEntry,
  mapSetEntry,
  mapDeleteEntry,
  mapClearEntries,
  mapSizeAbs,
  setAddEntry,
  setHasEntry,
  setDeleteEntry,
  setClearEntries,
  setSizeAbs,
  ctorArgDefinitelyInvalid,
  makeWeakCollectionAbs,
} from "../collections.ts";
import { undefAbs } from "../hof.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../exec/may-throw.ts";
import { isSymbolAbs, evalSymbolStatic } from "./symbol.ts";
import { str, mayCoerceThrowOperand, isBigintPrimAbs } from "./shared.ts";
import { evalMathMethod } from "./math.ts";
import { evalObjectMethod } from "./object.ts";
import { evalJsonMethod } from "./json.ts";
import { evalNumberStatic } from "./number.ts";
import { evalStringStatic } from "./string.ts";
import { evalArrayStatic, makeArrayCtorAbs } from "./array.ts";
import { evalDateCtor, evalDateStatic, evalDateMethod } from "./date.ts";
import { evalRegExpCtor, evalRegExpMethod } from "./regexp.ts";
import { evalPromiseCtor, evalPromiseStatic, enforceIterableStaticArg } from "./promise.ts";
import { evalReflectMethod } from "./reflect.ts";

export function evalNamespaceCall(
  ns: string,
  method: string,
  args: Abs[],
): Abs | undefined {
  switch (ns) {
    case "Math":
      return evalMathMethod(method, args);
    case "Object":
      return evalObjectMethod(method, args);
    case "JSON":
      return evalJsonMethod(method, args);
    case "Number":
      return evalNumberStatic(method, args);
    case "String":
      return evalStringStatic(method, args);
    case "Array":
      return evalArrayStatic(method, args);
    case "Date":
      return evalDateStatic(method, args);
    case "Promise":
      return evalPromiseStatic(method, args);
    case "BigInt":
      return evalBigIntStatic(method, args);
    case "Reflect":
      // Bug 19：Reflect.* 静态（严格 IsObject / apply·construct 校验）
      return evalReflectMethod(method, args);
    case "Symbol":
      // Bug 43：Symbol.for / Symbol.keyFor（全局注册表）
      return evalSymbolStatic(method, args);
    default:
      return undefined;
  }
}

/** BigInt.asIntN / asUintN（wrap 到指定位宽） */
function evalBigIntStatic(method: string, args: Abs[]): Abs | undefined {
  if (method !== "asIntN" && method !== "asUintN") return undefined;
  const bitsA = args[0];
  const valA = args[1];
  // Bug 83：bits 过 ToIndex（ToNumber → ToIntegerOrInfinity 截断 → 范围检查）。
  // 字面量面先折 ToIndex（node 实测："8"→8、null→0、true→1、1.5 截断→1、
  // undefined/NaN→0——此前 typeof/isInteger 过严产生 RangeError 假阳）；
  // 负数 → 硬抛 RangeError；bigint 字面量（ToNumber 恒抛）→ 硬抛 TypeError；
  // >2^53-1 / ±∞ 由下方宿主真调用兜底（原生 RangeError）。
  let bits: number | undefined;
  if (bitsA && bitsA.term?.op === "lit") {
    const v = (bitsA.term as { value: unknown }).value;
    if (typeof v === "bigint" || typeof v === "symbol") {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    if (
      typeof v === "number" ||
      typeof v === "string" ||
      typeof v === "boolean" ||
      v === null ||
      v === undefined
    ) {
      const n = Math.trunc(Number(v));
      if (n < 0) throw new NudoThrow(errorTypeAbs("RangeError"));
      bits = n;
    }
  } else if (bitsA) {
    // Bug 83：非 lit 位宽——prim symbol/bigint（无 lit 项）确定 TypeError；
    // any/obj/… may TypeError（Symbol/BigInt 载体）+ may RangeError（负数）；
    // 抽象 prim number 只 may RangeError（不可能是 symbol/bigint 值）
    if (isSymbolAbs(bitsA) || isBigintPrimAbs(bitsA)) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    if (mayCoerceThrowOperand(bitsA)) {
      recordMayThrow({ kind: "TypeError", cause: "BigInt.asIntN/asUintN bits ToNumber may throw (Symbol/BigInt)" });
      recordMayThrow({ kind: "RangeError", cause: "BigInt.asIntN/asUintN bits may be negative" });
    } else if (bitsA.shape.k === "prim" && (bitsA.shape as { type?: string }).type === "number") {
      recordMayThrow({ kind: "RangeError", cause: "BigInt.asIntN/asUintN bits may be negative" });
    }
  }
  const val = valA?.term?.op === "lit" ? (valA.term as { value: unknown }).value : undefined;
  if (typeof bits === "number" && typeof val === "bigint") {
    try {
      return bigintLit(method === "asIntN" ? BigInt.asIntN(bits, val) : BigInt.asUintN(bits, val));
    } catch {
      throw new NudoThrow(errorTypeAbs("RangeError"));
    }
  }
  // 抽象实参：保守 bigint 非具体
  return abs(
    { k: "prim", type: "bigint" },
    undefined,
    undefined,
    "path",
  );
}

/** JS Error 家族构造器名（求值引擎 evalBuiltinNew / $new 共用） */
const ERROR_CTOR_NAMES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "URIError",
  "EvalError",
  "AggregateError",
]);

export function isErrorCtorName(name: string | undefined): boolean {
  return !!name && ERROR_CTOR_NAMES.has(name);
}

/** Error 构造器 message 槽：原生恒为字符串（缺省/undefined → ""；非字符串
 *  字面量 → ToString）。非字面量保守（字符串保持、其余 strPrim）。
 *  Bug 54：message 过 ToString——symbol prim（Symbol()/Symbol.for 产物，
 *  无 lit 项——JS 无 symbol 字面量，旧 lit 分支是死代码）定抛 TypeError
 *  （node 实测 new Error(Symbol()) 全家族抛）；any/unknown/含 symbol 臂
 *  union → may；bigint/number/bool/对象 ToString 全定（良性惯例）。 */
function errorMessageSlot(messageArg: Abs | undefined): Abs {
  if (!messageArg) return strLit(""); // new Error() → ""
  // shape-first：先于 lit 分支判 symbol 形态
  if (isSymbolAbs(messageArg)) throw new NudoThrow(errorTypeAbs("TypeError"));
  {
    const k = messageArg.shape.k;
    // nullish 字面量（shape k:"unknown" + lit term）ToString 全定（"null"/""）
    const nullishLit =
      messageArg.term?.op === "lit" &&
      (messageArg.term.value === null || messageArg.term.value === undefined);
    if (
      k === "any" ||
      (k === "unknown" && !nullishLit) ||
      (k === "sum" && messageArg.shape.members.some((m) => isSymbolAbs(m)))
    ) {
      recordMayThrow({ kind: "TypeError", cause: "Error constructor message ToString may throw (Symbol)" });
    }
  }
  if (messageArg.term?.op === "lit") {
    const v = messageArg.term.value;
    if (typeof v === "string") return messageArg;
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
      return strLit(String(v));
    }
    if (v === null) return strLit("null");
    if (v === undefined) return strLit(""); // new Error(undefined) → ""
    // symbol 等：原生 ToString 抛 TypeError——保守 unknown，不折精确值
    return str();
  }
  if (messageArg.shape.k === "prim" && messageArg.shape.type === "string") {
    return messageArg;
  }
  return str();
}

/**
 * Error brand：shape 带 name/message（字面量 message 保精确）。
 * AggregateError(errors, message[, options])：message 在第二实参，errors
 * 挂 .errors（原生是实参数组副本）；options.cause 挂 .cause（闭槽 miss
 * 会折 undefined 假精确——原生 .cause 可能有值）。
 * $new 的 new Error 路径共用——catch 形参成员访问可解。
 */
export function errorBrandAbs(name: string, args: Abs[]): Abs {
  const messageArg = name === "AggregateError" ? args[1] : args[0];
  const slots: Record<string, { value: Abs }> = {
    name: { value: strLit(name) },
    message: { value: errorMessageSlot(messageArg) },
  };
  if (name === "AggregateError") {
    // Bug 54：errors（args[0]）过 IterableToList——非可迭代定抛（node 实测
    // AggregateError(Symbol())/1/()/null 全抛 "… is not iterable"；字符串
    // 可迭代合法："ab" → errors ['a','b']）。与 Promise.all（Bug 47）共用
    // 三档口径：prim 非 string/nullish/缺省 → NudoThrow；any/obj/… → may
    enforceIterableStaticArg(args[0], "AggregateError errors");
    // errors：字面量 tuple 保留精确；抽象/缺省（原生 []）保守 unknown
    slots["errors"] = { value: args[0] ?? unknown };
  }
  const optionsArg = name === "AggregateError" ? args[2] : args[1];
  if (optionsArg && optionsArg.shape.k === "obj") {
    const cause = Object.prototype.hasOwnProperty.call(optionsArg.shape.slots, "cause")
      ? optionsArg.shape.slots["cause"]!.value
      : undefAbs();
    slots["cause"] = { value: cause };
  }
  return abs(
    {
      k: "brand",
      name,
      shape: objOf(slots),
    },
    undefined,
    undefined,
    "path",
  );
}

// --- 宿主构造器实参校验（Bug 37/41/53/63/85）---------------------------
// 两个派发点共用：exec/class.ts $new 宿主函数分支（自由标识符漏入的宿主全局）
// 与本文件 evalBuiltinNew（Abs 面）。三档口径与全仓约定一致：
// - definite 原生 throw（prim 字面量/缺省等静态确定非法）→ NudoThrow
// - any/unknown/含坏成员的 union → recordMayThrow（值域不变）
// - obj/fn/brand/tuple/arr 等对象形态 → 原生全定（total）

/** union 含 prim 成员（非 nullish）→ 该值可能是原始值（原生 may TypeError） */
export function sumHasPrimMember(a: Abs): boolean {
  if (a.shape.k !== "sum") return false;
  return a.shape.members.some(
    (m) =>
      m.shape.k === "prim" &&
      !(m.term?.op === "lit" && (m.term.value === null || m.term.value === undefined)),
  );
}

/**
 * nullish 字面量实参（shape k:"unknown" + lit term——引擎的 null/undefined
 * 字面量表示，见 litAbsFromJs）。与 surface.isNullishLitAbs 同判定，本文件
 * 不引 surface（避免 builtins↔surface 新环）。
 */
function isNullishLit(a: Abs | undefined): boolean {
  return (
    !!a &&
    a.term?.op === "lit" &&
    (a.term.value === null || a.term.value === undefined)
  );
}

/**
 * Bug 37：new Proxy(target, handler) —— 原生 ProxyCreate 对 target 与
 * handler 各做 IsObject。prim（含 nullish/缺省 ≡ undefined）→ 确定
 * TypeError；any/unknown/含 prim 成员 union → may；obj/fn/brand/tuple/arr
 * 是对象 → 全定，构造 Proxy brand。
 */
export function makeProxyAbs(target: Abs | undefined, handler: Abs | undefined): Abs {
  for (const a of [target, handler]) {
    if (!a || isNullishLit(a) || a.shape.k === "prim") {
      throw new NudoThrow(errorTypeAbs("TypeError")); // 缺省/nullish/prim：非对象
    }
    if (a.shape.k === "any" || a.shape.k === "unknown" || sumHasPrimMember(a)) {
      recordMayThrow({ kind: "TypeError", cause: "new Proxy on non-object target or handler" });
    }
  }
  return abs({ k: "brand", name: "Proxy", shape: objOf({}) }, undefined, undefined, "path");
}

/** ES ToIndex 校验分类（ArrayBuffer length / DataView byteOffset·byteLength） */
type ToIndexClass = { k: "ok" } | { k: "range" } | { k: "type" } | { k: "may" };

const MAX_TO_INDEX = 2 ** 53 - 1;

/**
 * Bug 41/63：ES ToIndex —— ToNumber 后整数值 < 0 或 > 2^53-1 → RangeError；
 * symbol/bigint 的 ToNumber → TypeError；NaN/nullish → 0 合法；对象经
 * valueOf（良性惯例）→ NaN → 0 合法；any/unknown/抽象 prim → may。
 */
function classifyToIndex(a: Abs | undefined): ToIndexClass {
  if (!a || isNullishLit(a)) return { k: "ok" }; // 缺省/nullish：ToNumber → NaN → 0
  const s = a.shape;
  if (s.k === "prim") {
    // shape-first：symbol 恒无 lit term（JS 无 symbol 字面量），先查形态
    if (s.type === "symbol") return { k: "type" };
    const vR = litValue(a);
    if (!vR.ok) return { k: "may" }; // 抽象 prim（约束参数）：值未知
    const v = vR.value;
    if (v === undefined || v === null) return { k: "ok" }; // ToNumber → NaN → 0
    if (typeof v === "bigint") return { k: "type" }; // ToNumber(bigint) 原生 TypeError
    const n = Number(v); // number/string/boolean 的 ToNumber（含 "8"/"-1" 字符串折算）
    if (Number.isNaN(n)) return { k: "ok" }; // "abc"/undefined 字符串 → NaN → 0
    if (n === Infinity || n === -Infinity) return { k: "range" };
    const t = Math.trunc(n);
    return t < 0 || t > MAX_TO_INDEX ? { k: "range" } : { k: "ok" };
  }
  if (s.k === "any" || s.k === "unknown") return { k: "may" };
  if (s.k === "sum") {
    for (const m of s.members) {
      const c = classifyToIndex(m);
      // 有坏成员但可能取好成员 → 整体 may（不 definite）
      if (c.k !== "ok") return { k: "may" };
    }
    return { k: "ok" };
  }
  return { k: "ok" }; // obj/fn/brand/tuple/arr/eff：valueOf 良性 → 0
}

/** ToIndex 校验落地：range/type → NudoThrow；may → recordMayThrow(RangeError) */
function enforceToIndex(a: Abs | undefined, what: string): void {
  const c = classifyToIndex(a);
  if (c.k === "range") throw new NudoThrow(errorTypeAbs("RangeError"));
  if (c.k === "type") throw new NudoThrow(errorTypeAbs("TypeError"));
  if (c.k === "may") {
    recordMayThrow({ kind: "RangeError", cause: `${what} may be negative or invalid (ToIndex)` });
  }
}

/**
 * Bug 41：new ArrayBuffer(length) —— length 过 ToIndex：负数/±∞/超 2^53-1 →
 * RangeError；symbol/bigint → TypeError（ToNumber）；缺省/NaN → 0 合法。
 */
export function makeArrayBufferAbs(len: Abs | undefined): Abs {
  enforceToIndex(len, "ArrayBuffer length");
  return abs({ k: "brand", name: "ArrayBuffer", shape: objOf({}) }, undefined, undefined, "path");
}

/**
 * Bug 63：new DataView(buffer, byteOffset?, byteLength?) —— buffer 必须
 * ArrayBuffer/SharedArrayBuffer（其余闭形态确定 TypeError，any/unknown/
 * open obj/union → may）；byteOffset/byteLength 过 ToIndex（负 → RangeError）。
 */
export function makeDataViewAbs(
  buf: Abs | undefined,
  off: Abs | undefined,
  len: Abs | undefined,
): Abs {
  if (!buf || isNullishLit(buf)) {
    throw new NudoThrow(errorTypeAbs("TypeError")); // 缺省/nullish ≡ 非 buffer
  }
  const k = buf.shape.k;
  const isBufferBrand =
    k === "brand" && (buf.shape.name === "ArrayBuffer" || buf.shape.name === "SharedArrayBuffer");
  if (isBufferBrand) {
    // 合法 buffer：仅做 ToIndex 校验
  } else if (k === "any" || k === "unknown" || k === "sum" || (k === "obj" && buf.shape.open === true)) {
    recordMayThrow({ kind: "TypeError", cause: "DataView buffer may not be an ArrayBuffer" });
  } else {
    // prim/tuple/arr/fn/eff/闭对象/其余 brand：确定非 ArrayBuffer
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  enforceToIndex(off, "DataView byteOffset");
  enforceToIndex(len, "DataView byteLength");
  return abs({ k: "brand", name: "DataView", shape: objOf({}) }, undefined, undefined, "path");
}

/** URL brand：解析成功携带宿主精确 href/origin/protocol 槽 */
function urlBrandAbs(u?: URL): Abs {
  const slots: Record<string, { value: Abs }> = u
    ? {
        href: { value: strLit(u.href) },
        origin: { value: strLit(u.origin) },
        protocol: { value: strLit(u.protocol) },
      }
    : {};
  return abs(
    { k: "brand", name: "URL", shape: objOf(slots) },
    undefined,
    undefined,
    u ? "exact" : "path",
  );
}

/**
 * Bug 85：new URL(input, base?) —— input 过 ToString（symbol → TypeError）
 * 再 URL 解析：字符串字面量真解析（宿主 try/catch，Invalid URL → TypeError；
 * base 字面量同传——原生先解析 base，绝对 input 配非法 base 仍抛）；
 * number/bool/bigint/null/缺省的 ToString 恒不可解析 → 确定 TypeError；
 * any/unknown/对象（自定义 toString 可能合法）→ may。
 */
export function makeUrlAbs(input: Abs | undefined, base: Abs | undefined): Abs {
  if (!input) throw new NudoThrow(errorTypeAbs("TypeError")); // 缺省：原生 "url" 参数必填
  if (isSymbolAbs(input)) throw new NudoThrow(errorTypeAbs("TypeError"));
  const vR = litValue(input);
  if (vR.ok && typeof vR.value === "string") {
    // base：字符串字面量同传（原生先解析 base——绝对 input 配非法 base 仍抛）；
    // undefined 字面量/缺省 ≡ 无 base；其余字面量（null/number/…）的 ToString
    // 恒不可作 base → 确定 TypeError；抽象/对象 base 无法判定 → 只记 may
    // （相对 input 配合法 base 原生可解析，不得误 definite）
    const bR = base ? litValue(base) : undefined;
    const baseStr = bR?.ok && typeof bR.value === "string" ? bR.value : undefined;
    const baseAbsent =
      !base || (base.term?.op === "lit" && base.term.value === undefined);
    if (!baseAbsent && baseStr === undefined) {
      if (base && (isSymbolAbs(base) || litValue(base).ok)) {
        throw new NudoThrow(errorTypeAbs("TypeError")); // 非法 base 字面量
      }
      recordMayThrow({ kind: "TypeError", cause: "URL base may be invalid" });
      return urlBrandAbs();
    }
    try {
      const u = baseStr !== undefined ? new URL(vR.value, baseStr) : new URL(vR.value);
      return urlBrandAbs(u);
    } catch {
      throw new NudoThrow(errorTypeAbs("TypeError")); // Invalid URL
    }
  }
  if (vR.ok) {
    // number/boolean/bigint/null/undefined 字面量：ToString 无 scheme 恒不可解析
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  recordMayThrow({ kind: "TypeError", cause: "URL input may be invalid" });
  return urlBrandAbs();
}

/**
 * Bug 53：new Number(v)/new String(v) —— ToNumber/ToString(symbol) 确定
 * TypeError（Boolean 的 ToBoolean 全定，不校验）；any/unknown/含 symbol
 * 成员 union → may；非 symbol 字面量/对象原生合法（ToNumber(1n)=1 等）。
 */
export function noteBoxedCtorArg(name: "Number" | "String", arg: Abs | undefined): void {
  if (!arg || isNullishLit(arg)) return; // ToNumber/ToString(nullish) 合法（NaN/"undefined"）
  if (isSymbolAbs(arg)) throw new NudoThrow(errorTypeAbs("TypeError"));
  const k = arg.shape.k;
  const maySymbol =
    k === "any" ||
    k === "unknown" ||
    (k === "sum" && arg.shape.members.some((m) => isSymbolAbs(m)));
  if (maySymbol) {
    recordMayThrow({ kind: "TypeError", cause: `${name} constructor argument may be a symbol` });
  }
}

/** new X(...) */
export function evalBuiltinNew(className: string, args: Abs[]): Abs | undefined {
  switch (className) {
    case "Date":
      return evalDateCtor(args);
    case "RegExp":
      return evalRegExpCtor(args);
    case "Symbol":
      // new Symbol() 原生 TypeError
      throw new NudoThrow(errorTypeAbs("TypeError"));
    case "Promise":
      return evalPromiseCtor(args);
    case "Array":
      return makeArrayCtorAbs(args);
    case "Number":
    case "Boolean":
      // 装箱：与宿主 $new 同口径（空箱 brand；valueOf 可读）
      // Bug 53：Number 装箱对 symbol 实参 ToNumber → 确定 TypeError；any → may
      if (className === "Number") noteBoxedCtorArg("Number", args[0]);
      return abs(
        { k: "brand", name: className, shape: objOf({}) },
        undefined,
        undefined,
        "path",
      );
    case "String": {
      // Bug 53：String 装箱对 symbol 实参 ToString → 确定 TypeError；any → may
      noteBoxedCtorArg("String", args[0]);
      // new String(prim)：包装箱带 length/下标槽（与 evalGlobalFn Object 装箱同口径）
      const a0R = args[0] ? litValue(args[0]) : undefined;
      const a0 = a0R?.ok && typeof a0R.value === "string" ? a0R.value : undefined;
      if (typeof a0 === "string") {
        const slots: Record<string, { value: Abs }> = {
          length: { value: numLit(a0.length) },
        };
        for (let i = 0; i < a0.length; i++) {
          slots[String(i)] = { value: strLit(a0[i]!) };
        }
        return abs(
          { k: "brand", name: "String", shape: objOf(slots) },
          undefined,
          undefined,
          "exact",
        );
      }
      return abs(
        { k: "brand", name: "String", shape: objOf({}, { open: true }) },
        undefined,
        undefined,
        "path",
      );
    }
    case "Map":
      // C1.1：可选 entry 元组列表填充字面量映射；
      // 确定非法实参（prim 条目/非可迭代）→ NudoThrow(TypeError)
      // （evaluator $new 同口径；$catchVal 吸收 NudoThrow）
      if (ctorArgDefinitelyInvalid("Map", args[0])) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      return makeMapAbs(args[0]);
    case "Set":
      // C1.2：从 iterable 填充元素联合
      if (ctorArgDefinitelyInvalid("Set", args[0])) {
        throw new NudoThrow(errorTypeAbs("TypeError"));
      }
      return makeSetAbs(args[0]);
    case "WeakMap":
    case "WeakSet":
      // Bug 15：Map/Set 同口径 iterable 校验；合法 → 空 brand（条目表不建模）
      return makeWeakCollectionAbs(className as "WeakMap" | "WeakSet", args[0]);
    case "Proxy":
      // Bug 37：target/handler IsObject 校验
      return makeProxyAbs(args[0], args[1]);
    case "ArrayBuffer":
      // Bug 41：length 过 ToIndex（负/超界 → RangeError；symbol/bigint → TypeError）
      return makeArrayBufferAbs(args[0]);
    case "DataView":
      // Bug 63：buffer IsArrayBuffer + byteOffset/byteLength ToIndex
      return makeDataViewAbs(args[0], args[1], args[2]);
    case "URL":
      // Bug 85：input ToString + URL 解析校验（字面量真解析带 href 槽）
      return makeUrlAbs(args[0], args[1]);
    default:
      // C2.2：Error 家族 → name/message 槽
      if (isErrorCtorName(className)) {
        return errorBrandAbs(className, args);
      }
      return undefined;
  }
}

/** brand 实例方法（Date/RegExp/Map/Set） */
export function evalBuiltinInstanceMethod(
  brandName: string,
  method: string,
  recv: Abs,
  args: Abs[],
): Abs | undefined {
  if (brandName === "Date") return evalDateMethod(method, recv, args);
  if (brandName === "RegExp") return evalRegExpMethod(method, recv, args);
  if (brandName === "Map") {
    switch (method) {
      case "get":
        return mapGetEntry(recv, args[0]);
      case "has":
        return mapHasEntry(recv, args[0]);
      case "set":
        return mapSetEntry(recv, args[0], args[1] ?? unknown);
      case "delete":
        return mapDeleteEntry(recv, args[0]);
      case "clear":
        return mapClearEntries(recv);
      case "size":
        return mapSizeAbs(recv);
      default:
        return undefined;
    }
  }
  if (brandName === "Set") {
    switch (method) {
      case "has":
        return setHasEntry(recv, args[0]);
      case "add":
        return setAddEntry(recv, args[0] ?? unknown);
      case "delete":
        return setDeleteEntry(recv, args[0]);
      case "clear":
        return setClearEntries(recv);
      case "size":
        return setSizeAbs(recv);
      default:
        return undefined;
    }
  }
  return undefined;
}
