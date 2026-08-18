import { type TypeValue, type SigImpl, T } from "@nudojs/core";

export type EnvDefinition = {
  globals: Record<string, TypeValue>;
  modules?: Record<string, Record<string, TypeValue>>;
};

function litNum(tv: TypeValue): number | undefined {
  return tv.kind === "literal" && typeof tv.value === "number" ? tv.value : undefined;
}

function litStr(tv: TypeValue): string | undefined {
  return tv.kind === "literal" && typeof tv.value === "string" ? tv.value : undefined;
}

function numImpl1(fn: (a: number) => number): SigImpl {
  return (args) => {
    const a = litNum(args[0]);
    return a !== undefined ? T.literal(fn(a)) : undefined;
  };
}

function numImpl2(fn: (a: number, b: number) => number): SigImpl {
  return (args) => {
    const a = litNum(args[0]);
    const b = litNum(args[1]);
    return a !== undefined && b !== undefined ? T.literal(fn(a, b)) : undefined;
  };
}

function strToStrImpl(fn: (s: string) => string): SigImpl {
  return (args) => {
    const s = litStr(args[0]);
    return s !== undefined ? T.literal(fn(s)) : undefined;
  };
}

export function defineEnv(): EnvDefinition {
  const voidFn = T.fnSig([T.unknown], T.undefined);

  const consoleMethods: Record<string, TypeValue> = {};
  for (const name of ["log", "error", "warn", "info", "debug", "trace", "dir", "table", "time", "timeEnd", "timeLog", "clear", "count", "countReset", "group", "groupCollapsed", "groupEnd", "assert"]) {
    consoleMethods[name] = voidFn;
  }

  const jsonStringifyImpl: SigImpl = (args) => {
    const v = args[0];
    if (v.kind === "literal") {
      try {
        const result = JSON.stringify(v.value);
        return result === undefined ? T.undefined : T.literal(result);
      } catch { /* fallback */ }
    }
    return undefined;
  };

  const parseIntImpl: SigImpl = (args) => {
    const s = litStr(args[0]);
    const radix = args[1] !== undefined ? litNum(args[1]) : 10;
    if (s !== undefined && radix !== undefined) {
      const result = parseInt(s, radix);
      return Number.isNaN(result) ? T.literal(NaN) : T.literal(result);
    }
    return undefined;
  };

  const parseFloatImpl: SigImpl = (args) => {
    const s = litStr(args[0]);
    if (s !== undefined) {
      const result = parseFloat(s);
      return T.literal(result);
    }
    return undefined;
  };

  const isNaNImpl: SigImpl = (args) => {
    const v = args[0];
    if (v.kind === "literal" && typeof v.value === "number") return T.literal(Number.isNaN(v.value));
    return undefined;
  };

  const isFiniteImpl: SigImpl = (args) => {
    const v = args[0];
    if (v.kind === "literal" && typeof v.value === "number") return T.literal(Number.isFinite(v.value));
    return undefined;
  };

  return {
    globals: {
      // --- JSON ---
      JSON: T.object({
        parse: T.fnSig([T.string], T.unknown, T.instanceOf("SyntaxError")),
        stringify: T.fnSig([T.unknown], T.union(T.string, T.undefined), T.never, jsonStringifyImpl),
      }),

      // --- Math ---
      Math: T.object({
        abs: T.fnSig([T.number], T.number, T.never, numImpl1(Math.abs)),
        ceil: T.fnSig([T.number], T.number, T.never, numImpl1(Math.ceil)),
        floor: T.fnSig([T.number], T.number, T.never, numImpl1(Math.floor)),
        round: T.fnSig([T.number], T.number, T.never, numImpl1(Math.round)),
        trunc: T.fnSig([T.number], T.number, T.never, numImpl1(Math.trunc)),
        sign: T.fnSig([T.number], T.number, T.never, numImpl1(Math.sign)),
        max: T.fnSig([T.number, T.number], T.number, T.never, numImpl2(Math.max)),
        min: T.fnSig([T.number, T.number], T.number, T.never, numImpl2(Math.min)),
        pow: T.fnSig([T.number, T.number], T.number, T.never, numImpl2(Math.pow)),
        sqrt: T.fnSig([T.number], T.number, T.never, numImpl1(Math.sqrt)),
        cbrt: T.fnSig([T.number], T.number, T.never, numImpl1(Math.cbrt)),
        log: T.fnSig([T.number], T.number, T.never, numImpl1(Math.log)),
        log2: T.fnSig([T.number], T.number, T.never, numImpl1(Math.log2)),
        log10: T.fnSig([T.number], T.number, T.never, numImpl1(Math.log10)),
        exp: T.fnSig([T.number], T.number, T.never, numImpl1(Math.exp)),
        random: T.fnSig([], T.number),
        sin: T.fnSig([T.number], T.number, T.never, numImpl1(Math.sin)),
        cos: T.fnSig([T.number], T.number, T.never, numImpl1(Math.cos)),
        tan: T.fnSig([T.number], T.number, T.never, numImpl1(Math.tan)),
        asin: T.fnSig([T.number], T.number, T.never, numImpl1(Math.asin)),
        acos: T.fnSig([T.number], T.number, T.never, numImpl1(Math.acos)),
        atan: T.fnSig([T.number], T.number, T.never, numImpl1(Math.atan)),
        atan2: T.fnSig([T.number, T.number], T.number, T.never, numImpl2(Math.atan2)),
        hypot: T.fnSig([T.number, T.number], T.number, T.never, numImpl2(Math.hypot)),
        clz32: T.fnSig([T.number], T.number, T.never, numImpl1(Math.clz32)),
        imul: T.fnSig([T.number, T.number], T.number, T.never, numImpl2(Math.imul)),
        fround: T.fnSig([T.number], T.number, T.never, numImpl1(Math.fround)),
        PI: T.number,
        E: T.number,
        LN2: T.number,
        LN10: T.number,
        LOG2E: T.number,
        LOG10E: T.number,
        SQRT2: T.number,
        SQRT1_2: T.number,
      }),

      // --- Number ---
      Number: T.object({
        isFinite: T.fnSig([T.unknown], T.boolean, T.never, isFiniteImpl),
        isInteger: T.fnSig([T.unknown], T.boolean, T.never, (args) => {
          const v = args[0];
          if (v.kind === "literal" && typeof v.value === "number") return T.literal(Number.isInteger(v.value));
          return undefined;
        }),
        isNaN: T.fnSig([T.unknown], T.boolean, T.never, isNaNImpl),
        isSafeInteger: T.fnSig([T.unknown], T.boolean, T.never, (args) => {
          const v = args[0];
          if (v.kind === "literal" && typeof v.value === "number") return T.literal(Number.isSafeInteger(v.value));
          return undefined;
        }),
        parseFloat: T.fnSig([T.string], T.number, T.never, parseFloatImpl),
        parseInt: T.fnSig([T.string], T.number, T.never, parseIntImpl),
        MAX_SAFE_INTEGER: T.number,
        MIN_SAFE_INTEGER: T.number,
        MAX_VALUE: T.number,
        MIN_VALUE: T.number,
        POSITIVE_INFINITY: T.number,
        NEGATIVE_INFINITY: T.number,
        NaN: T.number,
        EPSILON: T.number,
      }),

      // --- Boolean ---
      Boolean: T.fnSig([T.unknown], T.boolean, T.never, (args) => {
        const v = args[0];
        if (v.kind === "literal") return T.literal(Boolean(v.value));
        return undefined;
      }),

      // --- String ---
      String: T.fnSig([T.unknown], T.string, T.never, (args) => {
        const v = args[0];
        if (v.kind === "literal" && v.value !== null && v.value !== undefined) return T.literal(String(v.value));
        return undefined;
      }),

      // --- Array ---
      Array: T.object({
        isArray: T.fnSig([T.unknown], T.boolean, T.never, (args) => {
          const v = args[0];
          if (v.kind === "array" || v.kind === "tuple") return T.literal(true);
          if (v.kind === "literal" || v.kind === "primitive" || v.kind === "object") return T.literal(false);
          return undefined;
        }),
        from: T.fnSig([T.unknown], T.array(T.unknown)),
        of: T.fnSig([T.unknown], T.array(T.unknown)),
      }),

      // --- console ---
      console: T.object(consoleMethods),

      // --- Global functions ---
      parseInt: T.fnSig([T.string, T.number], T.number, T.never, parseIntImpl),
      parseFloat: T.fnSig([T.string], T.number, T.never, parseFloatImpl),
      isNaN: T.fnSig([T.unknown], T.boolean, T.never, isNaNImpl),
      isFinite: T.fnSig([T.unknown], T.boolean, T.never, isFiniteImpl),
      encodeURI: T.fnSig([T.string], T.string, T.never, strToStrImpl(encodeURI)),
      decodeURI: T.fnSig([T.string], T.string, T.instanceOf("URIError"), strToStrImpl(decodeURI)),
      encodeURIComponent: T.fnSig([T.string], T.string, T.never, strToStrImpl(encodeURIComponent)),
      decodeURIComponent: T.fnSig([T.string], T.string, T.instanceOf("URIError"), strToStrImpl(decodeURIComponent)),

      // --- Error constructors ---
      Error: T.fnSig([T.string], T.instanceOf("Error")),
      TypeError: T.fnSig([T.string], T.instanceOf("TypeError")),
      RangeError: T.fnSig([T.string], T.instanceOf("RangeError")),
      SyntaxError: T.fnSig([T.string], T.instanceOf("SyntaxError")),
      ReferenceError: T.fnSig([T.string], T.instanceOf("ReferenceError")),
      URIError: T.fnSig([T.string], T.instanceOf("URIError")),

      // --- Promise ---
      Promise: T.object({
        resolve: T.fnSig([T.unknown], T.promise(T.unknown), T.never, (args) => T.promise(args[0])),
        reject: T.fnSig([T.unknown], T.promise(T.never)),
        all: T.fnSig([T.array(T.promise(T.unknown))], T.promise(T.array(T.unknown))),
        allSettled: T.fnSig([T.array(T.promise(T.unknown))], T.promise(T.array(T.unknown))),
        race: T.fnSig([T.array(T.promise(T.unknown))], T.promise(T.unknown)),
        any: T.fnSig([T.array(T.promise(T.unknown))], T.promise(T.unknown)),
      }),

      // --- Date ---
      Date: T.object({
        now: T.fnSig([], T.number),
        parse: T.fnSig([T.string], T.number),
        UTC: T.fnSig([T.number, T.number], T.number),
      }),

      // --- Symbol ---
      Symbol: T.fnSig([T.string], T.symbol),

      // --- Reflect ---
      Reflect: T.object({
        apply: T.fnSig([T.unknown, T.unknown, T.array(T.unknown)], T.unknown),
        construct: T.fnSig([T.unknown, T.array(T.unknown)], T.unknown),
        defineProperty: T.fnSig([T.unknown, T.string, T.unknown], T.boolean),
        deleteProperty: T.fnSig([T.unknown, T.string], T.boolean),
        get: T.fnSig([T.unknown, T.string], T.unknown),
        getOwnPropertyDescriptor: T.fnSig([T.unknown, T.string], T.union(T.unknown, T.undefined)),
        getPrototypeOf: T.fnSig([T.unknown], T.union(T.unknown, T.null)),
        has: T.fnSig([T.unknown, T.string], T.boolean),
        isExtensible: T.fnSig([T.unknown], T.boolean),
        ownKeys: T.fnSig([T.unknown], T.array(T.string)),
        preventExtensions: T.fnSig([T.unknown], T.boolean),
        set: T.fnSig([T.unknown, T.string, T.unknown], T.boolean),
        setPrototypeOf: T.fnSig([T.unknown, T.unknown], T.boolean),
      }),

      // --- globalThis ---
      globalThis: T.unknown,
      undefined: T.undefined,
      NaN: T.number,
      Infinity: T.number,
    },
  };
}
