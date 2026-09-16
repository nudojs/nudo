/**
 * ES env：Abs 原生 globals。
 * EnvDefinition.globals / modules 均为 Abs；TypeValue 投影走 absToTypeValue。
 */

import {
  type Abs,
  type AbsSigImpl,
  litValue,
  numLit,
  strLit,
  boolLit,
} from "@nudojs/core";
import {
  arrOf,
  brandOf,
  envFn,
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

function absNumLit(a: Abs | undefined): number | undefined {
  if (!a) return undefined;
  const v = litValue(a);
  return typeof v === "number" ? v : undefined;
}

function absStrLit(a: Abs | undefined): string | undefined {
  if (!a) return undefined;
  const v = litValue(a);
  return typeof v === "string" ? v : undefined;
}

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
    const v = litValue(a);
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
    const radix = args[1] !== undefined ? absNumLit(args[1]) : 10;
    if (s !== undefined && radix !== undefined) {
      const result = parseInt(s, radix);
      return Number.isNaN(result) ? numLit(NaN) : numLit(result);
    }
    return undefined;
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
    const v = litValue(a);
    if (v === undefined && a.term?.op !== "lit") return undefined;
    return boolLit(Boolean(v));
  };

  const stringImplAbs: AbsSigImpl = (args) => {
    const a = args[0];
    if (!a) return undefined;
    const v = litValue(a);
    if (v === null || v === undefined) return undefined;
    return strLit(String(v));
  };

  const isArrayImplAbs: AbsSigImpl = (args) => {
    const a = args[0];
    if (!a) return undefined;
    if (a.shape.k === "arr" || a.shape.k === "tuple") return boolLit(true);
    if (a.shape.k === "prim" || a.shape.k === "obj") return boolLit(false);
    if (a.term?.op === "lit") return boolLit(false);
    return undefined;
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
        max: envFn([prim.num(), prim.num()], prim.num(), numImpl2Abs(Math.max)),
        min: envFn([prim.num(), prim.num()], prim.num(), numImpl2Abs(Math.min)),
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
        hypot: envFn([prim.num(), prim.num()], prim.num(), numImpl2Abs(Math.hypot)),
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

      Number: objAbs({
        isFinite: envFn([prim.unknown], prim.bool(), isFiniteImplAbs),
        isInteger: envFn([prim.unknown], prim.bool(), isIntegerImplAbs),
        isNaN: envFn([prim.unknown], prim.bool(), isNaNImplAbs),
        isSafeInteger: envFn([prim.unknown], prim.bool(), isSafeIntegerImplAbs),
        parseFloat: envFn([prim.str()], prim.num(), parseFloatImplAbs),
        parseInt: envFn([prim.str()], prim.num(), parseIntImplAbs),
        MAX_SAFE_INTEGER: prim.num(),
        MIN_SAFE_INTEGER: prim.num(),
        MAX_VALUE: prim.num(),
        MIN_VALUE: prim.num(),
        POSITIVE_INFINITY: prim.num(),
        NEGATIVE_INFINITY: prim.num(),
        NaN: prim.num(),
        EPSILON: prim.num(),
      }),

      Boolean: envFn([prim.unknown], prim.bool(), booleanImplAbs),
      String: envFn([prim.unknown], prim.str(), stringImplAbs),

      Array: objAbs({
        isArray: envFn([prim.unknown], prim.bool(), isArrayImplAbs),
        from: envFn([prim.unknown], arrOf(prim.unknown)),
        of: envFn([prim.unknown], arrOf(prim.unknown)),
      }),

      console: objAbs(consoleSlots),

      parseInt: envFn([prim.str(), prim.num()], prim.num(), parseIntImplAbs),
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

      Error: envFn([prim.str()], brandOf("Error")),
      TypeError: envFn([prim.str()], brandOf("TypeError")),
      RangeError: envFn([prim.str()], brandOf("RangeError")),
      SyntaxError: envFn([prim.str()], brandOf("SyntaxError")),
      ReferenceError: envFn([prim.str()], brandOf("ReferenceError")),
      URIError: envFn([prim.str()], brandOf("URIError")),

      Promise: objAbs({
        resolve: envFn([prim.unknown], promiseOf(prim.unknown), promiseResolveImplAbs),
        reject: envFn([prim.unknown], promiseOf(prim.never)),
        all: envFn([arrOf(promiseOf(prim.unknown))], promiseOf(arrOf(prim.unknown))),
        allSettled: envFn(
          [arrOf(promiseOf(prim.unknown))],
          promiseOf(arrOf(prim.unknown)),
        ),
        race: envFn([arrOf(promiseOf(prim.unknown))], promiseOf(prim.unknown)),
        any: envFn([arrOf(promiseOf(prim.unknown))], promiseOf(prim.unknown)),
      }),

      Date: objAbs({
        now: envFn([], prim.num()),
        parse: envFn([prim.str()], prim.num()),
        UTC: envFn([prim.num(), prim.num()], prim.num()),
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
