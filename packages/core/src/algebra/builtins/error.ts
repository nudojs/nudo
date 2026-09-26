/**
 * Error 家族 + evalBuiltinNew / evalBuiltinInstanceMethod + namespace 分派
 */
import type { Abs } from "../abs.ts";
import { abs, strLit, unknown } from "../abs.ts";
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
} from "../collections.ts";
import { undefAbs } from "../hof.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs } from "../exec/may-throw.ts";
import { str } from "./shared.ts";
import { evalMathMethod } from "./math.ts";
import { evalObjectMethod } from "./object.ts";
import { evalJsonMethod } from "./json.ts";
import { evalNumberStatic } from "./number.ts";
import { evalStringStatic } from "./string.ts";
import { evalArrayStatic, makeArrayCtorAbs } from "./array.ts";
import { evalDateCtor, evalDateStatic, evalDateMethod } from "./date.ts";
import { evalRegExpCtor, evalRegExpMethod } from "./regexp.ts";
import { evalPromiseCtor, evalPromiseStatic } from "./promise.ts";

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
    default:
      return undefined;
  }
}

/** JS Error 家族构造器名（B 路径 evalBuiltinNew / $new 共用） */
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
 *  字面量 → ToString）。非字面量保守（字符串保持、其余 strPrim）。 */
function errorMessageSlot(messageArg: Abs | undefined): Abs {
  if (!messageArg) return strLit(""); // new Error() → ""
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
    case "Map":
      // C1.1：可选 entry 元组列表填充字面量映射；
      // 确定非法实参（prim 条目/非可迭代）→ NudoThrow(TypeError)
      // （B-path $new 同口径；$catchVal 吸收 NudoThrow）
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
