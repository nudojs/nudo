/**
 * Date 构造 / Date.* / Date 实例方法。
 * Bug 24：构造器实参强转校验——单参形式 ToPrimitive(number)→ToNumber：
 * symbol/bigint 值（prim 或字面量）确定 TypeError（node 实测 new Date(1n) 抛，
 * 与 bug 文本一致）；Date brand 豁免（读 [[TimeValue]]）；闭 obj 字面量无自有
 * coercer 槽 total（ToPrimitive 恒得 "[object Object]" → Invalid Date）；其余
 * 抽象 may（coercer 可能产 Symbol/BigInt）。多参形式每个实参直接 ToNumber。
 * Bug 62：setter 实参逐个 ToNumber 校验；getter/toString 族值域建模。
 */
import type { Abs } from "../abs.ts";
import { abs } from "../abs.ts";
import { numPrim, str, mayCoerceThrowOperand } from "./shared.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../exec/may-throw.ts";
import { isSymbolAbs } from "../symbol-id.ts";
import { isBigintPrimAbs } from "./shared.ts";

/** symbol/bigint 值（prim 无 lit 项，或 bigint 字面量）→ ToNumber 确定 TypeError */
function isToNumberThrowAbs(a: Abs | undefined): boolean {
  if (!a) return false;
  return (
    isSymbolAbs(a) ||
    isBigintPrimAbs(a) ||
    (a.term?.op === "lit" && typeof a.term.value === "bigint")
  );
}

/** 抽象实参 may 档：闭 obj 字面量无自有 coercer 槽 → total；其余 may */
function noteToPrimitiveMayThrow(a: Abs, cause: string): void {
  if (a.shape.k === "obj") {
    const so = a.shape as { slots: Record<string, unknown>; open?: boolean };
    const hasCoercer = "toString" in so.slots || "valueOf" in so.slots;
    if (!so.open && !hasCoercer) return;
  }
  // tuple/arr：join 元素可能为 symbol（node 实测 new Date([Symbol()]) 抛）
  if (mayCoerceThrowOperand(a) || a.shape.k === "tuple" || a.shape.k === "arr") {
    recordMayThrow({ kind: "TypeError", cause });
  }
}

export function evalDateCtor(args: Abs[]): Abs {
  if (args.length <= 1) {
    const a0 = args[0];
    if (a0) {
      if (isToNumberThrowAbs(a0)) throw new NudoThrow(errorTypeAbs("TypeError"));
      // Date brand 豁免：原生读 [[TimeValue]]（node 实测 new Date(new Date(5)) total）
      const isDateBrand = a0.shape.k === "brand" && (a0.shape as { name?: string }).name === "Date";
      if (!isDateBrand) {
        noteToPrimitiveMayThrow(a0, "Date constructor argument ToPrimitive may produce Symbol/BigInt");
      }
    }
  } else {
    // 多参形式：y/m/d/h/ms 每个实参直接 ToNumber（无 string 解析特判）
    for (const a of args) {
      if (isToNumberThrowAbs(a)) throw new NudoThrow(errorTypeAbs("TypeError"));
      noteToPrimitiveMayThrow(a, "Date constructor argument ToNumber may throw (Symbol/BigInt)");
    }
  }
  return abs(
    { k: "brand", name: "Date", shape: abs({ k: "obj", slots: {} }, undefined, undefined, "exact") },
    undefined,
    undefined,
    "path",
  );
}

export function evalDateStatic(name: string, _args: Abs[]): Abs | undefined {
  // Date.now() 非编译期常量：每次运行值都变，折叠成具体时间戳既不 sound 又
  // 让分析结果不确定（golden/memo 抖动）。返回 number（未知）。
  if (name === "now") return numPrim("path");
  return undefined;
}

/** getter（无实参强转——原生忽略实参，node 实测 getTime(Symbol()) OK）→ number */
const DATE_NUMBER_GETTERS = new Set([
  "getTime", "valueOf",
  "getFullYear", "getUTCFullYear", "getMonth", "getUTCMonth",
  "getDate", "getUTCDate", "getDay", "getUTCDay",
  "getHours", "getUTCHours", "getMinutes", "getUTCMinutes",
  "getSeconds", "getUTCSeconds", "getMilliseconds", "getUTCMilliseconds",
  "getTimezoneOffset",
]);

/** toString 族 → string（toISOString 原生对 Invalid Date 抛 RangeError——
 *  Date brand 的 time value 不可知，保守 total 不打点） */
const DATE_STRING_METHODS = new Set([
  "toString", "toDateString", "toTimeString", "toUTCString", "toGMTString",
  "toLocaleString", "toLocaleDateString", "toLocaleTimeString",
  "toISOString", "toJSON",
]);

/** setter：实参逐个 ToNumber（缺省合法——node 实测 setFullYear() → NaN） */
const DATE_SETTERS = new Set([
  "setTime", "setMilliseconds", "setUTCMilliseconds",
  "setSeconds", "setUTCSeconds", "setMinutes", "setUTCMinutes",
  "setHours", "setUTCHours", "setDate", "setUTCDate",
  "setMonth", "setUTCMonth", "setFullYear", "setUTCFullYear",
]);

export function evalDateMethod(name: string, _recv: Abs, args: Abs[]): Abs | undefined {
  if (DATE_NUMBER_GETTERS.has(name)) return numPrim("path");
  if (DATE_STRING_METHODS.has(name)) return str("path");
  if (DATE_SETTERS.has(name)) {
    // Bug 62：symbol/bigint 实参确定 TypeError（node 实测 setTime(Symbol())/
    // setTime(1n) 抛）；抽象 obj/fn/brand/sum/any → may；返回新 time value
    for (const a of args) {
      if (isToNumberThrowAbs(a)) throw new NudoThrow(errorTypeAbs("TypeError"));
      noteToPrimitiveMayThrow(a, `Date.prototype.${name} ToNumber argument may throw (Symbol/BigInt)`);
    }
    return numPrim("path");
  }
  return undefined;
}
