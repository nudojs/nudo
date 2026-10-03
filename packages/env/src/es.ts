/**
 * ES env：Abs 原生 globals。
 * EnvDefinition.globals / modules 均为 Abs。
 */

import {
  type Abs,
  type AbsSigImpl,
  litValue,
  numLit,
  strLit,
  boolLit,
  evalGlobalFn,
  makeArrayCtorAbs,
  evalPromiseCtor,
  evalDateCtor,
} from "@nudojs/core";
import { absNumLit, absStrLit } from "@nudojs/core/internal";
import {
  arrOf,
  brandOf,
  dateAbs,
  errorBrandOf,
  envFn,
  envFnVariadic,
  nullLit,
  objAbs,
  promiseOf,
  undef,
  unionOf,
  prim,
} from "./abs-helpers.ts";

export type EnvDefinition = {
  globals: Record<string, Abs>;
  modules?: Record<string, Record<string, Abs>>;
};

function numImpl1Abs(fn: (a: number) => number): AbsSigImpl {
  return (args) => {
    const a = absNumLit(args[0]);
    return a !== undefined ? numLit(fn(a)) : undefined;
  };
}

function numImpl2Abs(fn: (a: number, b: number) => number): AbsSigImpl {
  return (args) => {
    const a = absNumLit(args[0]);
    const b = absNumLit(args[1]);
    return a !== undefined && b !== undefined ? numLit(fn(a, b)) : undefined;
  };
}

/** 变参数值内建（Math.min / Math.max / Math.hypot）：全字面量才折 */
function numImplVAbs(fn: (...xs: number[]) => number): AbsSigImpl {
  return (args) => {
    const nums: number[] = [];
    for (const a of args) {
      const n = absNumLit(a);
      if (n === undefined) return undefined;
      nums.push(n);
    }
    return numLit(fn(...nums));
  };
}

function strToStrImplAbs(fn: (s: string) => string): AbsSigImpl {
  return (args) => {
    const s = absStrLit(args[0]);
    return s !== undefined ? strLit(fn(s)) : undefined;
  };
}

export function defineEnv(): EnvDefinition {
  const voidFn = envFn([prim.unknown], undef());

  const consoleSlots: Record<string, Abs> = {};
  for (const name of [
    "log",
    "error",
    "warn",
    "info",
    "debug",
    "trace",
    "dir",
    "table",
    "time",
    "timeEnd",
    "timeLog",
    "clear",
    "count",
    "countReset",
    "group",
    "groupCollapsed",
    "groupEnd",
    "assert",
  ]) {
    consoleSlots[name] = voidFn;
  }

  const jsonStringifyImplAbs: AbsSigImpl = (args) => {
    const a = args[0];
    if (!a) return undefined;
    const vR = litValue(a);
    const v = vR.ok ? vR.value : undefined;
    if (v === undefined && a.term?.op !== "lit") return undefined;
    try {
      const result = JSON.stringify(v);
      return result === undefined ? undef() : strLit(result);
    } catch {
      return undefined;
    }
  };

  const parseIntImplAbs: AbsSigImpl = (args) => {
    const s = absStrLit(args[0]);
    if (s === undefined) return undefined;
    // 无 radix：遵循 0x/0o/0b 前缀（与 core foldParseInt / 真 JS 对齐，不可默认 10）
    if (args[1] === undefined) return numLit(parseInt(s));
    // radix 为 lit undefined ≡ 未提供（ES ToInt32(undefined)===0 → 自动进制）
    const radixRaw = litValue(args[1]);
    if (radixRaw.ok && radixRaw.value === undefined) return numLit(parseInt(s));
    const radix = absNumLit(args[1]);
    if (radix === undefined) return undefined;
    // ES 对 radix 做 ToInt32：截断小数、NaN/0 → 自动进制、大整数环绕
    const r32 = radix | 0;
    if (r32 === 0) return numLit(parseInt(s));
    if (r32 < 2 || r32 > 36) return numLit(NaN);
    return numLit(parseInt(s, r32));
  };

  const parseFloatImplAbs: AbsSigImpl = (args) => {
    const s = absStrLit(args[0]);
    if (s !== undefined) return numLit(parseFloat(s));
    return undefined;
  };

  const isNaNImplAbs: AbsSigImpl = (args) => {
    const n = absNumLit(args[0]);
    return n !== undefined ? boolLit(Number.isNaN(n)) : undefined;
  };

  const isFiniteImplAbs: AbsSigImpl = (args) => {
    const n = absNumLit(args[0]);
    return n !== undefined ? boolLit(Number.isFinite(n)) : undefined;
  };

  const isIntegerImplAbs: AbsSigImpl = (args) => {
    const n = absNumLit(args[0]);
    return n !== undefined ? boolLit(Number.isInteger(n)) : undefined;
  };

  const isSafeIntegerImplAbs: AbsSigImpl = (args) => {
    const n = absNumLit(args[0]);
    return n !== undefined ? boolLit(Number.isSafeInteger(n)) : undefined;
  };

  const booleanImplAbs: AbsSigImpl = (args) => {
    const a = args[0];
    if (!a) return undefined;
    const vR = litValue(a);
    const v = vR.ok ? vR.value : undefined;
    if (v === undefined && a.term?.op !== "lit") return undefined;
    return boolLit(Boolean(v));
  };

  const stringImplAbs: AbsSigImpl = (args) => {
    const a = args[0];
    if (!a) return undefined;
    const vR = litValue(a);
    const v = vR.ok ? vR.value : undefined;
    if (v === null || v === undefined) return undefined;
    return strLit(String(v));
  };

  const isArrayImplAbs: AbsSigImpl = (args) => {
    const a = args[0];
    if (!a) return undefined;
    let s = a.shape;
    while (s.k === "brand") s = s.shape.shape;
    if (s.k === "arr" || s.k === "tuple") return boolLit(true);
    if (s.k === "prim" || s.k === "obj" || s.k === "eff") return boolLit(false);
    if (a.term?.op === "lit") return boolLit(false);
    return undefined;
  };

  /** Number(x)：ToNumber（与宿主 evalGlobalFn Number 同口径） */
  const numberImplAbs: AbsSigImpl = (args) => {
    return evalGlobalFn("Number", args);
  };

  /** Array(...)/new Array(...)：makeArrayCtorAbs（call 与 construct 同语义） */
  const arrayImplAbs: AbsSigImpl = (args) => {
    return makeArrayCtorAbs(args);
  };

  /** new Promise(executor)（$new 按名派发 evalPromiseCtor；call 面同口径） */
  const promiseCtorImplAbs: AbsSigImpl = (args) => {
    return evalPromiseCtor(args);
  };

  /** new Date(...)（$new 按名派发 evalDateCtor；call 面同口径） */
  const dateCtorImplAbs: AbsSigImpl = (args) => {
    return evalDateCtor(args);
  };

  const promiseResolveImplAbs: AbsSigImpl = (args) => {
    if (!args[0]) return undefined;
    return promiseOf(args[0]);
  };

  return {
    globals: {
      JSON: objAbs({
        parse: envFn([prim.str()], prim.unknown),
        stringify: envFn(
          [prim.unknown],
          unionOf(prim.str(), undef()),
          jsonStringifyImplAbs,
        ),
      }),

      Math: objAbs({
        abs: envFn([prim.num()], prim.num(), numImpl1Abs(Math.abs)),
        ceil: envFn([prim.num()], prim.num(), numImpl1Abs(Math.ceil)),
        floor: envFn([prim.num()], prim.num(), numImpl1Abs(Math.floor)),
        round: envFn([prim.num()], prim.num(), numImpl1Abs(Math.round)),
        trunc: envFn([prim.num()], prim.num(), numImpl1Abs(Math.trunc)),
        sign: envFn([prim.num()], prim.num(), numImpl1Abs(Math.sign)),
        // min/max/hypot 在 JS 里是变参（`Math.min(a, b, c)`）——二元声明会让
        // 多实参调用落进 arity 不匹配 → unknown
        max: envFnVariadic(prim.num(), prim.num(), {
          apply: numImplVAbs(Math.max),
          restName: "...values",
          name: "Math.max",
        }),
        min: envFnVariadic(prim.num(), prim.num(), {
          apply: numImplVAbs(Math.min),
          restName: "...values",
          name: "Math.min",
        }),
        pow: envFn([prim.num(), prim.num()], prim.num(), numImpl2Abs(Math.pow)),
        sqrt: envFn([prim.num()], prim.num(), numImpl1Abs(Math.sqrt)),
        cbrt: envFn([prim.num()], prim.num(), numImpl1Abs(Math.cbrt)),
        log: envFn([prim.num()], prim.num(), numImpl1Abs(Math.log)),
        log2: envFn([prim.num()], prim.num(), numImpl1Abs(Math.log2)),
        log10: envFn([prim.num()], prim.num(), numImpl1Abs(Math.log10)),
        exp: envFn([prim.num()], prim.num(), numImpl1Abs(Math.exp)),
        random: envFn([], prim.num()),
        sin: envFn([prim.num()], prim.num(), numImpl1Abs(Math.sin)),
        cos: envFn([prim.num()], prim.num(), numImpl1Abs(Math.cos)),
        tan: envFn([prim.num()], prim.num(), numImpl1Abs(Math.tan)),
        asin: envFn([prim.num()], prim.num(), numImpl1Abs(Math.asin)),
        acos: envFn([prim.num()], prim.num(), numImpl1Abs(Math.acos)),
        atan: envFn([prim.num()], prim.num(), numImpl1Abs(Math.atan)),
        atan2: envFn([prim.num(), prim.num()], prim.num(), numImpl2Abs(Math.atan2)),
        hypot: envFnVariadic(prim.num(), prim.num(), {
          apply: numImplVAbs(Math.hypot),
          restName: "...values",
          name: "Math.hypot",
        }),
        clz32: envFn([prim.num()], prim.num(), numImpl1Abs(Math.clz32)),
        imul: envFn([prim.num(), prim.num()], prim.num(), numImpl2Abs(Math.imul)),
        fround: envFn([prim.num()], prim.num(), numImpl1Abs(Math.fround)),
        PI: prim.num(),
        E: prim.num(),
        LN2: prim.num(),
        LN10: prim.num(),
        LOG2E: prim.num(),
        LOG10E: prim.num(),
        SQRT2: prim.num(),
        SQRT1_2: prim.num(),
      }),

      // dual-facet：Number/Array 既可调用/构造，又带静态槽。
      // 此前 objAbs 遮蔽宿主全局后 $call/$new 折 unknown（issue #58）。
      Number: envFn([prim.unknown], prim.num(), numberImplAbs, {
        name: "Number",
        params: ["value"],
        slots: {
          isFinite: envFn([prim.unknown], prim.bool(), isFiniteImplAbs),
          isInteger: envFn([prim.unknown], prim.bool(), isIntegerImplAbs),
          isNaN: envFn([prim.unknown], prim.bool(), isNaNImplAbs),
          isSafeInteger: envFn([prim.unknown], prim.bool(), isSafeIntegerImplAbs),
          parseFloat: envFn([prim.str()], prim.num(), parseFloatImplAbs),
          parseInt: envFn([prim.str(), prim.num()], prim.num(), parseIntImplAbs, {
            params: ["string", "radix?"],
          }),
          MAX_SAFE_INTEGER: prim.num(),
          MIN_SAFE_INTEGER: prim.num(),
          MAX_VALUE: prim.num(),
          MIN_VALUE: prim.num(),
          POSITIVE_INFINITY: prim.num(),
          NEGATIVE_INFINITY: prim.num(),
          NaN: prim.num(),
          EPSILON: prim.num(),
        },
      }),

      Boolean: envFn([prim.unknown], prim.bool(), booleanImplAbs, {
        name: "Boolean",
        params: ["value"],
      }),
      String: envFn([prim.unknown], prim.str(), stringImplAbs, {
        name: "String",
        params: ["value"],
      }),

      Array: envFn([prim.unknown], arrOf(prim.unknown), arrayImplAbs, {
        name: "Array",
        params: ["items"],
        slots: {
          isArray: envFn([prim.unknown], prim.bool(), isArrayImplAbs),
          from: envFn([prim.unknown], arrOf(prim.unknown)),
          of: envFn([prim.unknown], arrOf(prim.unknown)),
        },
      }),

      console: objAbs(consoleSlots),

      parseInt: envFn([prim.str(), prim.num()], prim.num(), parseIntImplAbs, {
        params: ["string", "radix?"],
      }),
      parseFloat: envFn([prim.str()], prim.num(), parseFloatImplAbs),
      isNaN: envFn([prim.unknown], prim.bool(), isNaNImplAbs),
      isFinite: envFn([prim.unknown], prim.bool(), isFiniteImplAbs),
      encodeURI: envFn([prim.str()], prim.str(), strToStrImplAbs(encodeURI)),
      decodeURI: envFn([prim.str()], prim.str(), strToStrImplAbs(decodeURI)),
      encodeURIComponent: envFn(
        [prim.str()],
        prim.str(),
        strToStrImplAbs(encodeURIComponent),
      ),
      decodeURIComponent: envFn(
        [prim.str()],
        prim.str(),
        strToStrImplAbs(decodeURIComponent),
      ),

      Error: envFn([prim.str()], errorBrandOf("Error")),
      TypeError: envFn([prim.str()], errorBrandOf("TypeError")),
      RangeError: envFn([prim.str()], errorBrandOf("RangeError")),
      SyntaxError: envFn([prim.str()], errorBrandOf("SyntaxError")),
      ReferenceError: envFn([prim.str()], errorBrandOf("ReferenceError")),
      URIError: envFn([prim.str()], errorBrandOf("URIError")),

      Promise: envFn([prim.unknown], promiseOf(prim.unknown), promiseCtorImplAbs, {
        name: "Promise",
        params: ["executor"],
        slots: {
          resolve: envFn([prim.unknown], promiseOf(prim.unknown), promiseResolveImplAbs),
          reject: envFn([prim.unknown], promiseOf(prim.never)),
          all: envFn([arrOf(promiseOf(prim.unknown))], promiseOf(arrOf(prim.unknown))),
          allSettled: envFn(
            [arrOf(promiseOf(prim.unknown))],
            promiseOf(arrOf(prim.unknown)),
          ),
          race: envFn([arrOf(promiseOf(prim.unknown))], promiseOf(prim.unknown)),
          any: envFn([arrOf(promiseOf(prim.unknown))], promiseOf(prim.unknown)),
        },
      }),

      Date: envFn([], dateAbs(), dateCtorImplAbs, {
        name: "Date",
        params: ["value"],
        slots: {
          now: envFn([], prim.num()),
          parse: envFn([prim.str()], prim.num()),
          UTC: envFn([prim.num(), prim.num()], prim.num()),
        },
      }),

      Symbol: envFn([prim.str()], brandOf("Symbol")),

      Reflect: objAbs({
        apply: envFn(
          [prim.unknown, prim.unknown, arrOf(prim.unknown)],
          prim.unknown,
        ),
        construct: envFn([prim.unknown, arrOf(prim.unknown)], prim.unknown),
        defineProperty: envFn(
          [prim.unknown, prim.str(), prim.unknown],
          prim.bool(),
        ),
        deleteProperty: envFn([prim.unknown, prim.str()], prim.bool()),
        get: envFn([prim.unknown, prim.str()], prim.unknown),
        getOwnPropertyDescriptor: envFn(
          [prim.unknown, prim.str()],
          unionOf(prim.unknown, undef()),
        ),
        getPrototypeOf: envFn([prim.unknown], unionOf(prim.unknown, nullLit())),
        has: envFn([prim.unknown, prim.str()], prim.bool()),
        isExtensible: envFn([prim.unknown], prim.bool()),
        ownKeys: envFn([prim.unknown], arrOf(prim.str())),
        preventExtensions: envFn([prim.unknown], prim.bool()),
        set: envFn([prim.unknown, prim.str(), prim.unknown], prim.bool()),
        setPrototypeOf: envFn([prim.unknown, prim.unknown], prim.bool()),
      }),

      globalThis: prim.unknown,
      undefined: undef(),
      NaN: prim.num(),
      Infinity: prim.num(),
    },
  };
}
