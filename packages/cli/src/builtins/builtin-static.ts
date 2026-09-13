/**
 * 内置静态命名空间与直接全局值（process/Math/JSON/Object statics/Number
 * 常量…）及其实现辅助（JSON 字面量解码、属性描述符、结构 instanceof 判定、
 * fromCharCode 实参收割）。
 */

import { T, simplifyUnion, type TypeValue } from "@nudojs/core";
import { protoOfValue } from "./builtin-prototype.ts";
import { PROMISE_STATIC_METHODS } from "./builtin-promise.ts";
import { SYMBOL_STATIC_METHODS, SYMBOL_STATIC_PROPS } from "./builtin-symbol.ts";
import { REFLECT_METHODS } from "./builtin-reflect.ts";
import { INTL_DATETIMEFORMAT_METHODS, INTL_NUMBERFORMAT_METHODS } from "./builtin-intl.ts";

// hasOwnProp 守卫：普通 Record 表查找会从原型链泄漏原生函数（与
// builtin-prototype.ts / evaluator 内同名 helper 同语义）。
function hasOwnProp(props: Record<string, unknown>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(props, name);
}

// Built-in JavaScript API type mappings
// Namespace objects (e.g. Math.floor) and direct global values (e.g. parseInt)
const BUILTIN_STATIC_METHODS: Record<string, Record<string, TypeValue> | TypeValue> = {
  // Node CJS 库普遍依赖的 process 全局——缺它时 process.nextTick(cb) 走
  // 未知全局 → undefined → no-method 假错（hoek wait 的 usage-site 执行）
  process: {
    nextTick: T.fn(["callback", "...args"], { type: "BlockStatement", body: [], directives: [] } as any, undefined as any),
    env: T.object({}),
    platform: T.string,
    versions: T.object({}),
    argv: T.array(T.string),
    cwd: T.fn([], { type: "BlockStatement", body: [], directives: [] } as any, undefined as any),
    exit: T.fn(["code"], { type: "BlockStatement", body: [], directives: [] } as any, undefined as any),
    hrtime: T.fn(["time"], { type: "BlockStatement", body: [], directives: [] } as any, undefined as any),
    stdout: T.instanceOf("Socket"),
    stderr: T.instanceOf("Socket"),
  },
  Date: {
    now: T.number,
    parse: T.number,
    UTC: T.number,
  },
  Math: {
    random: T.number,
    floor: T.fn(["x"], { type: "BlockStatement", body: [] } as any, undefined as any),
    ceil: T.fn(["x"], { type: "BlockStatement", body: [] } as any, undefined as any),
    round: T.fn(["x"], { type: "BlockStatement", body: [] } as any, undefined as any),
    abs: T.fn(["x"], { type: "BlockStatement", body: [] } as any, undefined as any),
    max: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    min: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    sqrt: T.fn(["x"], { type: "BlockStatement", body: [] } as any, undefined as any),
    pow: T.fn(["base", "exp"], { type: "BlockStatement", body: [] } as any, undefined as any),
    // Math 常量与 @nudo:env es 的 Math 定义对齐（env 绑定优先）；无 env
    // 指令时也在此解析，避免 Math.PI 走 unknown-property。
    PI: T.number,
    E: T.number,
    LN2: T.number,
    LN10: T.number,
    LOG2E: T.number,
    LOG10E: T.number,
    SQRT2: T.number,
    SQRT1_2: T.number,
  },
  JSON: {
    // JSON.parse(literal-string): evaluate with the real JSON.parse and
    // re-encode through jsonToTypeValue, so fixture-style calls
    // (`JSON.parse('{"a":1}')`) keep literal-level precision instead of
    // poisoning downstream clone/deepEqual args with unknown. Degrades to
    // the unknown fallback when the argument is not a literal string or
    // the text is not valid JSON. A reviver argument also degrades: it can
    // replace every value (and the root) with an arbitrary one, so the
    // parse structure is not a sound answer (hoek/json-ext never pass one).
    parse: T.fnSig([T.string], T.unknown, T.never, (args) => {
      const text = args[0];
      if (text?.kind !== "literal" || typeof text.value !== "string") return undefined;
      const reviver = args[1];
      if (reviver && !(reviver.kind === "literal" && reviver.value === undefined)) return undefined;
      try {
        return jsonToTypeValue(JSON.parse(text.value));
      } catch {
        return undefined;
      }
    }),
    stringify: T.string,
  },
  Object: {
    keys: T.array(T.string),
    values: T.array(T.unknown),
    entries: T.array(T.tuple([T.string, T.unknown])),
    assign: T.fnSig([T.unknown], T.unknown, T.never, (args) => {
      // Object.assign(target, ...sources): later sources overwrite; a
      // symbolic source keeps the symbolic unknown fallback.
      const target = args[0];
      if (target?.kind !== "object") return undefined;
      const props: Record<string, TypeValue> = { ...target.properties };
      for (const src of args.slice(1)) {
        if (src?.kind !== "object") return undefined;
        Object.assign(props, src.properties);
      }
      return T.object(props);
    }),
    // Prototype-reflection statics. getPrototypeOf maps receivers onto the
    // cached prototype singletons so `getPrototypeOf(x) !== getPrototypeOf(y)`
    // resolves literally; create/setPrototypeOf cover the clone-style
    // prototype dance; getOwnPropertyDescriptor feeds descriptor.get/set
    // branches with the property's value type.
    getPrototypeOf: T.fnSig([T.unknown], T.unknown, T.never, (args) => protoOfValue(args[0])),
    create: T.fnSig([T.unknown], T.object({}), T.never, () => T.object({})),
    setPrototypeOf: T.fnSig([T.unknown, T.unknown], T.unknown, T.never, (args) => args[0]),
    defineProperty: T.fnSig([T.unknown, T.unknown, T.unknown], T.unknown, T.never, (args) => args[0]),
    getOwnPropertyDescriptor: T.fnSig([T.unknown, T.unknown], T.union(T.object({}), T.undefined), T.never, (args) => {
      const obj = args[0];
      const key = args[1];
      if (obj?.kind !== "object" && obj?.kind !== "instance") return T.undefined;
      if (!key) return T.undefined;
      if (key.kind === "literal" && typeof key.value === "string") {
        const prop = hasOwnProp(obj.properties, key.value) ? obj.properties[key.value] : undefined;
        if (!prop) return T.undefined;
        return descriptorOf(prop);
      }
      if (key.kind === "primitive" && key.type === "string") {
        const props = Object.keys(obj.properties);
        if (props.length === 0) return T.undefined;
        return descriptorOf(simplifyUnion(props.map((k) => obj.properties[k])));
      }
      return T.undefined;
    }),
  },
  Buffer: {
    from: T.fnSig([T.unknown], T.instanceOf("Buffer")),
    alloc: T.fnSig([T.number], T.instanceOf("Buffer")),
    concat: T.fnSig([T.unknown], T.instanceOf("Buffer")),
    byteLength: T.fnSig([T.unknown], T.number),
    isEncoding: T.fnSig([T.unknown], T.boolean),
    isBuffer: T.fnSig([T.unknown], T.boolean, T.never, (args) => {
      const lit = builtinInstanceTest(args[0], "Buffer");
      return lit === undefined ? undefined : T.literal(lit);
    }),
  },
  Array: {
    isArray: T.boolean,
    from: T.array(T.unknown),
  },
  Number: {
    isNaN: T.boolean,
    isFinite: T.boolean,
    parseInt: T.number,
    parseFloat: T.number,
    // Number 常量与 @nudo:env es 的 Number 定义对齐（env 绑定优先）；
    // 均为 number（case 序列化器对非有限数返回 null，不产出字面量值）。
    MAX_SAFE_INTEGER: T.number,
    MIN_SAFE_INTEGER: T.number,
    MAX_VALUE: T.number,
    MIN_VALUE: T.number,
    POSITIVE_INFINITY: T.number,
    NEGATIVE_INFINITY: T.number,
    NaN: T.number,
    EPSILON: T.number,
  },
  String: {
    // fromCharCode/fromCodePoint over all-number-literal args evaluate
    // with the real String static (hoek's escaper builds its 0x2028
    // separator literal this way before handing it to escapeJson); any
    // non-literal arg keeps only the string return type (the result is
    // always a string, just not a knowable one). fromCodePoint also
    // falls back on out-of-range literals (real RangeError → string).
    fromCharCode: T.fnSig([T.number], T.string, T.never, (args) => {
      const codes = literalCodeUnits(args);
      return codes === null ? T.string : T.literal(String.fromCharCode(...codes));
    }),
    fromCodePoint: T.fnSig([T.number], T.string, T.never, (args) => {
      const codes = literalCodeUnits(args);
      if (codes === null) return T.string;
      try {
        return T.literal(String.fromCodePoint(...codes));
      } catch {
        return undefined;
      }
    }),
  },
  Promise: PROMISE_STATIC_METHODS,
  Symbol: { ...SYMBOL_STATIC_METHODS, ...SYMBOL_STATIC_PROPS },
  Reflect: REFLECT_METHODS as unknown as Record<string, TypeValue>,
  Intl: {
    DateTimeFormat: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
    NumberFormat: T.fn(["...args"], { type: "BlockStatement", body: [] } as any, undefined as any),
  },
  parseInt: T.number,
  parseFloat: T.number,
  isNaN: T.boolean,
  isFinite: T.boolean,
  // 全局数值常量：与 @nudo:env es 的 globals 对齐（env 绑定优先）。无 env
  // 指令时在此解析为 number——否则 Infinity/NaN 命中大写开头的未知全局
  // 检测，触发 nudo:unknown-global 与 nudo:builtin-unknown 诊断。
  Infinity: T.number,
  NaN: T.number,
};
/** Harvest String.fromCharCode/fromCodePoint arguments: a list of number
 * literals ready for real evaluation, or null when any argument is
 * non-literal (symbolic → the caller keeps its plain string fallback).
 * An empty argument list yields [] (both statics return ""). */
function literalCodeUnits(args: TypeValue[]): number[] | null {
  const codes: number[] = [];
  for (const a of args) {
    if (a?.kind !== "literal" || typeof a.value !== "number") return null;
    codes.push(a.value);
  }
  return codes;
}
function descriptorOf(prop: TypeValue): TypeValue {
  return T.object({
    value: prop,
    writable: T.boolean,
    enumerable: T.boolean,
    configurable: T.boolean,
  });
}
// `x instanceof C` / `Buffer.isBuffer(x)` / `Array.isArray(x)` literal
// answer for structurally-known receivers; undefined keeps the symbolic
// fallback (boolean).
function builtinInstanceTest(v: TypeValue | undefined, className: string): boolean | undefined {
  if (!v) return undefined;
  let base: TypeValue = v;
  while (base.kind === "refined") base = base.base;
  switch (base.kind) {
    case "array":
    case "tuple": return className === "Array" || className === "Object";
    case "object": return className === "Object";
    case "function": return className === "Function" || className === "Object";
    case "promise": return className === "Promise" || className === "Object";
    case "literal":
    case "primitive": return false;
    default: return undefined;
  }
}
/** JSON 值 → TypeValue（字面量级精确：package.json 版本号等成为 string 字面量） */
function jsonToTypeValue(v: unknown): TypeValue {
  if (v === null) return T.literal(null);
  if (typeof v === "string") return T.literal(v);
  if (typeof v === "number") return T.literal(v);
  if (typeof v === "boolean") return T.literal(v);
  if (Array.isArray(v)) return T.tuple(v.map(jsonToTypeValue));
  if (typeof v === "object") {
    const props: Record<string, TypeValue> = {};
    for (const [k, val] of Object.entries(v)) {
      // Define-as-own: plain assignment would let a "__proto__" key trip
      // the setter on the props record (dropping it and corrupting the
      // record's prototype) — JSON.parse creates an own property, and
      // hoek's prototype-poisoning fixtures exercise exactly that key.
      Object.defineProperty(props, k, {
        value: jsonToTypeValue(val),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return T.object(props);
  }
  return T.unknown;
}
export { BUILTIN_STATIC_METHODS, builtinInstanceTest, jsonToTypeValue };
