/**
 * ES env：Abs 原生 globals。
 * EnvDefinition.globals / modules 均为 Abs。
 */

import {
  type Abs,
  type AbsSigImpl,
  abs,
  isNudoThrow,
  litValue,
  numLit,
  strLit,
  boolLit,
  evalGlobalFn,
  makeAbsApplyResult,
  makeArrayCtorAbs,
  evalPromiseCtor,
  evalDateCtor,
} from "@nudojs/core";
import { absNumLit, absStrLit } from "@nudojs/core/internal";
import {
  arrOf,
  brandOf,
  dateAbs,
  errBrand,
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

/**
 * URI 族全局（族 29 Bug 864）。
 *
 * 此前四个声明走 `strToStrImplAbs(encodeURI)`：宿主 `URIError` 被 envFn 的
 * apply 包装**吞掉**（旧实现 `catch { return returnType }`）⇒ 引擎判「不抛」
 * ⇒ L2 门禁失效（**假绿**）；且实参非字面量时**没有** throws 面。
 *
 * 本实现**直接委托 core 的 `evalGlobalFn`**（= 宿主回落路径的同一建模，
 * `packages/core/src/algebra/builtins/global.ts` 的 URI/escape 族分支），
 * 再把宿主异常折成 **always-throw**（原生对畸形入参**恒抛**）：
 * - 字面量实参 → 宿主真折叠（精确值）；畸形 % 序列 / 孤立代理项 ⇒
 *   always-throw `URIError`（abs 面 = never）；
 * - 抽象实参 → 回落**声明域** `prim.str()`（**不**折原生产不出的自信精确
 *   字面量），decode* 记 may-throw `URIError`（与 core 宿主路径同口径）。
 */
function uriEnvFn(
  name: "encodeURI" | "decodeURI" | "encodeURIComponent" | "decodeURIComponent",
): Abs {
  return envFn(
    [prim.str()],
    prim.str(),
    (args) => {
      try {
        const r = evalGlobalFn(name, args);
        return r ?? prim.str();
      } catch (e) {
        // 原生恒抛 ⇒ always-throw（abs 面 = never ⇒ core 抛 NudoThrow）
        const payload = isNudoThrow(e) ? e.absValue : errBrand("URIError");
        return makeAbsApplyResult(prim.never, payload);
      }
    },
    { params: ["uri"], throws: errBrand("URIError") },
  );
}

export function defineEnv(): EnvDefinition {
  /**
   * console 成员表（族 29 Bug 861）。
   *
   * 此前是 18 个名字的**手写白名单**（log/error/…/assert），缺
   * `timeStamp` / `dirxml` / `profile` / `profileEnd`（node v26 实测存在）⇒
   * 闭对象**缺槽**读出 **exact undefined**（不是 unknown）⇒
   * `console.timeStamp()` 折「调用 undefined」= **定抛 TypeError**，
   * 而原生**不抛** ⇒ L2 门禁**假红**。
   *
   * 成员集 = node v26 `Object.getOwnPropertyNames(console)` 的**公有**方法
   * （`_stdout` / `_times` / `_ignoreErrors` 等下划线内部件不属 console API
   * 面，不入表）+ 浏览器 console 共有面。签名按原生拆（此前全部复用同一个
   * `voidFn` ⇒ 形参面失真：`log` 是变参、`time` 收 `label?`、
   * `assert` 收 `(condition, ...args)`）。
   */
  const consoleMemberSlots: Record<string, Abs> = {
    // 输出族：变参 (...args) => undefined
    log: envFnVariadic(prim.unknown, undef(), { restName: "...args" }),
    info: envFnVariadic(prim.unknown, undef(), { restName: "...args" }),
    debug: envFnVariadic(prim.unknown, undef(), { restName: "...args" }),
    warn: envFnVariadic(prim.unknown, undef(), { restName: "...args" }),
    error: envFnVariadic(prim.unknown, undef(), { restName: "...args" }),
    trace: envFnVariadic(prim.unknown, undef(), { restName: "...args" }),
    // 对象输出
    dir: envFn([prim.unknown, prim.unknown], undef(), undefined, {
      params: ["item", "options?"],
    }),
    dirxml: envFn([prim.unknown], undef(), undefined, { params: ["item"] }),
    table: envFn([prim.unknown, prim.unknown], undef(), undefined, {
      params: ["tabularData?", "properties?"],
    }),
    // 分组
    group: envFnVariadic(prim.unknown, undef(), { restName: "...args" }),
    groupCollapsed: envFnVariadic(prim.unknown, undef(), { restName: "...args" }),
    groupEnd: envFn([], undef()),
    // 计数
    count: envFn([prim.str()], undef(), undefined, { params: ["label?"] }),
    countReset: envFn([prim.str()], undef(), undefined, { params: ["label?"] }),
    // 断言：condition + 变参
    assert: envFn([prim.unknown, prim.unknown], undef(), undefined, {
      params: ["condition", "...args"],
    }),
    // 清屏
    clear: envFn([], undef()),
    // 计时
    time: envFn([prim.str()], undef(), undefined, { params: ["label?"] }),
    timeLog: envFn([prim.str(), prim.unknown], undef(), undefined, {
      params: ["label?", "...args"],
    }),
    timeEnd: envFn([prim.str()], undef(), undefined, { params: ["label?"] }),
    timeStamp: envFn([prim.str()], undef(), undefined, { params: ["label?"] }),
    // 性能剖析（node ≥ 20.5）
    profile: envFn([prim.str()], undef(), undefined, { params: ["label?"] }),
    profileEnd: envFn([prim.str()], undef(), undefined, { params: ["label?"] }),
    // 异步上下文（node ≥ 24）→ ConsoleContext 对象；Nudo 未建模其成员 ⇒ unknown
    context: envFn([prim.unknown, prim.unknown], prim.unknown, undefined, {
      params: ["init", "options?"],
    }),
    // 任务跟踪（node ≥ 22）→ task 对象
    createTask: envFn([prim.str(), prim.unknown], prim.unknown, undefined, {
      params: ["name", "fn"],
    }),
  };

  const consoleSlots: Record<string, Abs> = {
    ...consoleMemberSlots,
    // Console 构造器（node ≥ 10；`Object.getOwnPropertyNames(console)` 里的
    // `Console`）——实例面复用 console 成员表（`c.log(...)` 可解）。
    // ⚠️ 原生 `new console.Console()` **不带** stdout 流会抛 TypeError；env
    // 声明无法判「options 里的流是不是可写流」⇒ 这里**不**记 throws 面
    // （宁少报也不误报：常见用法 `new console.Console({stdout})` 本身不抛）。
    Console: envFn(
      [prim.unknown],
      brandOf("Console", objAbs(consoleMemberSlots)),
      undefined,
      { name: "Console", ctor: true, params: ["options?"] },
    ),
  };

  /**
   * bigint 原语面（`BigInt(x)` 的值域）——core 的 bigint prim（PrimName
   * 含 "bigint"）。abs-helpers 的 `prim` 表未含 bigint（那是 S0 的文件），
   * 故此处就地建。
   */
  const bigintPrim = (): Abs =>
    abs({ k: "prim", type: "bigint" }, undefined, undefined, "exact");

  /** Intl 命名空间成员（构造器；Nudo 只建模构造器值，成员面不建模） */
  const intlCtor = (name: string): Abs =>
    envFn([prim.unknown, prim.unknown], brandOf(name), undefined, {
      name, ctor: true, params: ["locales?", "options?"],
    });

  /** TypedArray 全家（12 族）——见 globals 段的 Bug 865 注释 */
  const typedArrayGlobals = (): Record<string, Abs> => {
    const out: Record<string, Abs> = {};
    for (const name of [
      "Int8Array",
      "Uint8Array",
      "Uint8ClampedArray",
      "Int16Array",
      "Uint16Array",
      "Int32Array",
      "Uint32Array",
      "Float16Array",
      "Float32Array",
      "Float64Array",
      "BigInt64Array",
      "BigUint64Array",
    ]) {
      out[name] = envFn([prim.unknown], brandOf(name), undefined, {
        name, ctor: true, params: ["length"],
      });
    }
    return out;
  };

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
      // URI 族（Bug 864）：委托 core 的 evalGlobalFn（宿主回落路径同建模）
      // ⇒ URIError 不再被吞；抽象实参回落声明域 + may-throw URIError。
      encodeURI: uriEnvFn("encodeURI"),
      decodeURI: uriEnvFn("decodeURI"),
      encodeURIComponent: uriEnvFn("encodeURIComponent"),
      decodeURIComponent: uriEnvFn("decodeURIComponent"),

      // issue #106：Error 族带 name（$new 按名派发 evalBuiltinNew →
      // errorBrandAbs，message 槽 tiering 与无 env 宿主路径同口径）+
      // ctor:true（class extends Error 定义期合法，不再记 constructibility 假抛）。
      Error: envFn([prim.str()], errorBrandOf("Error"), undefined, {
        name: "Error", ctor: true, params: ["message?"],
      }),
      TypeError: envFn([prim.str()], errorBrandOf("TypeError"), undefined, {
        name: "TypeError", ctor: true, params: ["message?"],
      }),
      RangeError: envFn([prim.str()], errorBrandOf("RangeError"), undefined, {
        name: "RangeError", ctor: true, params: ["message?"],
      }),
      SyntaxError: envFn([prim.str()], errorBrandOf("SyntaxError"), undefined, {
        name: "SyntaxError", ctor: true, params: ["message?"],
      }),
      ReferenceError: envFn([prim.str()], errorBrandOf("ReferenceError"), undefined, {
        name: "ReferenceError", ctor: true, params: ["message?"],
      }),
      URIError: envFn([prim.str()], errorBrandOf("URIError"), undefined, {
        name: "URIError", ctor: true, params: ["message?"],
      }),

      Promise: envFn([prim.unknown], promiseOf(prim.unknown), promiseCtorImplAbs, {
        name: "Promise",
        ctor: true,
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
        ctor: true,
        params: ["value"],
        slots: {
          now: envFn([], prim.num()),
          parse: envFn([prim.str()], prim.num()),
          UTC: envFn([prim.num(), prim.num()], prim.num()),
        },
      }),

      // Symbol 不是构造器（new Symbol() / class X extends Symbol 原生 TypeError）
      Symbol: envFn([prim.str()], brandOf("Symbol"), undefined, {
        name: "Symbol", ctor: false,
      }),

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

      // ---- ES 规范全局补齐（族 29 Bug 865）--------------------------------
      //
      // es env 此前只声明 30 个全局；core **已精确建模**的一批 ES 规范全局
      // （BigInt / RegExp / Error 家族补全 / Intl / ArrayBuffer /
      // SharedArrayBuffer / DataView / TypedArray 全家 / Map / Set / 弱引用族）
      // **未声明** ⇒ 同一份报告里既给出精确签名（`() => 1n`）又报
      // 「Built-in API "BigInt" is not covered」——**自相矛盾**。
      //
      // 这些名字都在 core 的 ENV_SHADOW_SKIP_GLOBALS（= NAMESPACE_GLOBALS
      // 身份路由表）里 ⇒ **env 注入对它们无效**（注入会遮蔽宿主身份路由 →
      // issue #87）⇒ 在此声明**不会**遮蔽宿主语义；声明只补齐
      // 「es env = ES 标准库」的全局面。构造面按 **name facet** 走 core 的
      // `evalBuiltinNew` **按名派发**（精确 builder），不与宿主争。
      //
      // ⚠️ 刻意**不**声明的（声明会遮蔽宿主且 env 侧更差，或 core 根本没建模）：
      // `Function` / `Proxy`（core 有 makeDynamicFunctionAbs / makeProxyAbs
      // 精确建模，env 无法复刻）、`eval`（动态代码求值不可静态建模，遮蔽会
      // 真的不执行）、`escape` / `unescape`（core 的 evalGlobalFn 已精确建模，
      // 遮蔽无收益）、`Atomics` / `Iterator`（core **未**建模 ⇒ 「未被覆盖」
      // 警告是**正确**的，见交付报告勘误段）。
      BigInt: envFn([prim.unknown], bigintPrim(), undefined, {
        name: "BigInt", ctor: false, params: ["value"],
      }),
      RegExp: envFn([prim.str(), prim.str()], brandOf("RegExp"), undefined, {
        name: "RegExp", ctor: true, params: ["pattern", "flags?"],
      }),
      AggregateError: envFn(
        [arrOf(prim.unknown), prim.str(), prim.unknown],
        errorBrandOf("AggregateError"),
        undefined,
        { name: "AggregateError", ctor: true, params: ["errors", "message?", "options?"] },
      ),
      EvalError: envFn([prim.str()], errorBrandOf("EvalError"), undefined, {
        name: "EvalError", ctor: true, params: ["message?"],
      }),
      Intl: objAbs({
        Collator: intlCtor("Intl.Collator"),
        DateTimeFormat: intlCtor("Intl.DateTimeFormat"),
        DisplayNames: intlCtor("Intl.DisplayNames"),
        ListFormat: intlCtor("Intl.ListFormat"),
        Locale: intlCtor("Intl.Locale"),
        NumberFormat: intlCtor("Intl.NumberFormat"),
        PluralRules: intlCtor("Intl.PluralRules"),
        RelativeTimeFormat: intlCtor("Intl.RelativeTimeFormat"),
        Segmenter: intlCtor("Intl.Segmenter"),
        getCanonicalLocales: envFn([prim.unknown], arrOf(prim.str())),
        supportedValuesOf: envFn([prim.str()], arrOf(prim.str())),
      }),
      ArrayBuffer: envFn([prim.unknown], brandOf("ArrayBuffer"), undefined, {
        name: "ArrayBuffer", ctor: true, params: ["length"],
      }),
      SharedArrayBuffer: envFn(
        [prim.unknown],
        brandOf("SharedArrayBuffer"),
        undefined,
        { name: "SharedArrayBuffer", ctor: true, params: ["length"] },
      ),
      DataView: envFn(
        [prim.unknown, prim.unknown, prim.unknown],
        brandOf("DataView"),
        undefined,
        { name: "DataView", ctor: true, params: ["buffer", "byteOffset?", "byteLength?"] },
      ),
      Map: envFn([prim.unknown], brandOf("Map"), undefined, {
        name: "Map", ctor: true, params: ["iterable?"],
      }),
      Set: envFn([prim.unknown], brandOf("Set"), undefined, {
        name: "Set", ctor: true, params: ["iterable?"],
      }),
      WeakMap: envFn([prim.unknown], brandOf("WeakMap"), undefined, {
        name: "WeakMap", ctor: true, params: ["iterable?"],
      }),
      WeakSet: envFn([prim.unknown], brandOf("WeakSet"), undefined, {
        name: "WeakSet", ctor: true, params: ["iterable?"],
      }),
      WeakRef: envFn([prim.unknown], brandOf("WeakRef"), undefined, {
        name: "WeakRef", ctor: true, params: ["target"],
      }),
      FinalizationRegistry: envFn(
        [prim.unknown],
        brandOf("FinalizationRegistry"),
        undefined,
        { name: "FinalizationRegistry", ctor: true, params: ["cleanupCallback"] },
      ),
      // TypedArray 全家（12 族）——元素域建模在 core（builtins/shared.ts 的
      // TYPED_ARRAY_ELEMENT 单一事实源），此处只补全局面。
      ...typedArrayGlobals(),
    },
  };
}
