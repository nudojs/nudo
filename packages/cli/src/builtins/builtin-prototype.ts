/**
 * 内置类原型机制：错误类集合、可构造内置类、Object/Array/Map/Set/…/Buffer
 * 的原型成员近似表，以及 `X.prototype` 单例与类命名空间记忆化。
 * 求值器成员分派与补全侧成员派生共用本表的唯一真值。
 */

import { T, simplifyUnion, type TypeValue } from "@nudojs/core";
import { MAP_INSTANCE_METHODS, mapEntriesIterable } from "./builtin-map.ts";
import { SET_INSTANCE_METHODS } from "./builtin-set.ts";

// hasOwnProp 守卫：普通 Record 表查找会从原型链泄漏原生函数（如 "constructor"）。
// 与 evaluator 内同名 helper 同语义；独立副本避免 evaluator → 本模块循环依赖。
function hasOwnProp(props: Record<string, unknown>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(props, name);
}

const BUILTIN_ERROR_CLASSES = new Set([
  "Error", "TypeError", "SyntaxError", "RangeError", "ReferenceError", "URIError", "EvalError",
]);
// Constructible built-in classes. A bare reference to one of these names
// resolves to a namespace object (like the BUILTIN_STATIC_METHODS entries),
// and `X.prototype` evaluates to an instance of X instead of degrading to
// undefined/unknown.
const BUILTIN_PROTOTYPE_CLASSES = new Set([
  ...BUILTIN_ERROR_CLASSES,
  "Date", "Object", "Map", "Set", "Promise", "RegExp", "Array", "Function",
  "String", "Number", "Boolean", "Symbol", "WeakMap", "WeakSet", "Buffer",
]);
// Object.prototype members. Real property access reads through the
// prototype chain, so every object-typed receiver materializes these —
// destructuring `const { hasOwnProperty } = obj` yields a function (not
// undefined) and `Object.prototype.hasOwnProperty` types as boolean.
// Lookup must be own-property guarded: a plain `{}` record would otherwise
// leak native JS functions (e.g. for "constructor") into the type system.
//
// toString/valueOf carry impls so the receiver (thisVal) shapes the result:
// `Object.prototype.toString.call(x)` yields the brand literal
// ('[object Map]', '[object Null]', ...) that Map-based type dispatch
// (hoek internals.typeMap) keys on; valueOf returns its receiver.
const OBJECT_PROTOTYPE_METHODS: Record<string, TypeValue> = {
  hasOwnProperty: T.fnSig([T.unknown], T.boolean),
  isPrototypeOf: T.fnSig([T.unknown], T.boolean),
  propertyIsEnumerable: T.fnSig([T.unknown], T.boolean),
  toString: T.fnSig([], T.string, T.never, (_args, thisVal) => objectToStringBrand(thisVal)),
  toLocaleString: T.fnSig([], T.string),
  valueOf: T.fnSig([], T.unknown, T.never, (_args, thisVal) => thisVal),
};
// Common prototype members approximated as unknown-result signatures
// (mirrors the knownInstanceMethods fallback pattern). `X.prototype.m`
// stays a callable function value instead of degrading to undefined.
const BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS: Record<string, Record<string, TypeValue>> = {
  Object: { ...OBJECT_PROTOTYPE_METHODS },
  Array: {
    push: T.fnSig([T.unknown], T.number),
    pop: T.fnSig([], T.unknown),
    shift: T.fnSig([], T.unknown),
    unshift: T.fnSig([T.unknown], T.number),
    slice: T.fnSig([T.number, T.number], T.array(T.unknown)),
    splice: T.fnSig([T.number, T.number], T.array(T.unknown)),
    concat: T.fnSig([T.unknown], T.array(T.unknown)),
    join: T.fnSig([T.string], T.string),
    indexOf: T.fnSig([T.unknown], T.number),
    lastIndexOf: T.fnSig([T.unknown], T.number),
    includes: T.fnSig([T.unknown], T.boolean),
    map: T.fnSig([T.unknown], T.array(T.unknown)),
    flatMap: T.fnSig([T.unknown], T.array(T.unknown)),
    filter: T.fnSig([T.unknown], T.array(T.unknown)),
    forEach: T.fnSig([T.unknown], T.undefined),
    find: T.fnSig([T.unknown], T.unknown),
    findIndex: T.fnSig([T.unknown], T.number),
    some: T.fnSig([T.unknown], T.boolean),
    every: T.fnSig([T.unknown], T.boolean),
    reduce: T.fnSig([T.unknown, T.unknown], T.unknown),
    sort: T.fnSig([T.unknown], T.array(T.unknown)),
    reverse: T.fnSig([], T.array(T.unknown)),
    toString: T.fnSig([], T.string),
  },
  Function: {
    call: T.fnSig([T.unknown], T.unknown),
    apply: T.fnSig([T.unknown, T.unknown], T.unknown),
    bind: T.fnSig([T.unknown], T.unknown),
    toString: T.fnSig([], T.string),
  },
  Map: {
    // Impl-routed: `Map.prototype.m.call(instance)` (and direct prototype
    // calls) consult the receiver's exact entry side table, making the
    // hoek deepEqual reflection idioms decide literally.
    get: T.fnSig([T.unknown], T.unknown, T.never, (args, thisVal) => MAP_INSTANCE_METHODS.get(args[0] ?? T.unknown, thisVal ?? T.unknown)),
    set: T.fnSig([T.unknown, T.unknown], T.unknown, T.never, (args, thisVal) => MAP_INSTANCE_METHODS.set(args[0] ?? T.unknown, args[1] ?? T.unknown, thisVal ?? T.unknown)),
    has: T.fnSig([T.unknown], T.boolean, T.never, (args, thisVal) => MAP_INSTANCE_METHODS.has(args[0] ?? T.unknown, thisVal ?? T.unknown)),
    delete: T.fnSig([T.unknown], T.boolean, T.never, (args, thisVal) => MAP_INSTANCE_METHODS.delete(args[0] ?? T.unknown, thisVal ?? T.unknown)),
    clear: T.fnSig([], T.undefined, T.never, (args, thisVal) => MAP_INSTANCE_METHODS.clear(args[0] ?? T.unknown, thisVal ?? T.unknown)),
    forEach: T.fnSig([T.unknown], T.undefined),
    keys: T.fnSig([], T.array(T.unknown), T.never, (_args, thisVal) => MAP_INSTANCE_METHODS.keys(thisVal ?? T.unknown)),
    values: T.fnSig([], T.array(T.unknown), T.never, (_args, thisVal) => MAP_INSTANCE_METHODS.values(thisVal ?? T.unknown)),
    entries: T.fnSig([], T.array(T.tuple([T.unknown, T.unknown])), T.never, (_args, thisVal) => mapEntriesIterable(thisVal ?? T.unknown)),
    toString: T.fnSig([], T.string),
  },
  Set: {
    // Impl-routed like Map above (Set.prototype.values.call(s) ≡ s.values()).
    add: T.fnSig([T.unknown], T.unknown, T.never, (args, thisVal) => SET_INSTANCE_METHODS.add(args[0] ?? T.unknown, thisVal ?? T.unknown)),
    has: T.fnSig([T.unknown], T.boolean, T.never, (args, thisVal) => SET_INSTANCE_METHODS.has(args[0] ?? T.unknown, thisVal ?? T.unknown)),
    delete: T.fnSig([T.unknown], T.boolean, T.never, (args, thisVal) => SET_INSTANCE_METHODS.delete(args[0] ?? T.unknown, thisVal ?? T.unknown)),
    clear: T.fnSig([], T.undefined, T.never, (args, thisVal) => SET_INSTANCE_METHODS.clear(args[0] ?? T.unknown, thisVal ?? T.unknown)),
    forEach: T.fnSig([T.unknown], T.undefined),
    keys: T.fnSig([], T.array(T.unknown), T.never, (_args, thisVal) => SET_INSTANCE_METHODS.keys(thisVal ?? T.unknown)),
    values: T.fnSig([], T.array(T.unknown), T.never, (_args, thisVal) => SET_INSTANCE_METHODS.values(thisVal ?? T.unknown)),
    entries: T.fnSig([], T.array(T.tuple([T.unknown, T.unknown])), T.never, (_args, thisVal) => SET_INSTANCE_METHODS.entries(thisVal ?? T.unknown)),
    toString: T.fnSig([], T.string),
  },
  WeakMap: {
    get: T.fnSig([T.unknown], T.unknown),
    set: T.fnSig([T.unknown, T.unknown], T.unknown),
    has: T.fnSig([T.unknown], T.boolean),
    delete: T.fnSig([T.unknown], T.boolean),
    toString: T.fnSig([], T.string),
  },
  WeakSet: {
    add: T.fnSig([T.unknown], T.unknown),
    has: T.fnSig([T.unknown], T.boolean),
    delete: T.fnSig([T.unknown], T.boolean),
    toString: T.fnSig([], T.string),
  },
  Promise: {
    then: T.fnSig([T.unknown], T.promise(T.unknown)),
    catch: T.fnSig([T.unknown], T.promise(T.unknown)),
    finally: T.fnSig([T.unknown], T.promise(T.unknown)),
    toString: T.fnSig([], T.string),
  },
  Date: {
    getTime: T.fnSig([], T.number),
    valueOf: T.fnSig([], T.number),
    toISOString: T.fnSig([], T.string),
    toJSON: T.fnSig([], T.string),
    toLocaleString: T.fnSig([], T.string),
    toString: T.fnSig([], T.string),
  },
  RegExp: {
    test: T.fnSig([T.string], T.boolean),
    exec: T.fnSig([T.string], T.union(T.object({}), T.null)),
    toString: T.fnSig([], T.string),
  },
  String: {
    charAt: T.fnSig([T.number], T.string),
    charCodeAt: T.fnSig([T.number], T.number),
    indexOf: T.fnSig([T.string], T.number),
    lastIndexOf: T.fnSig([T.string], T.number),
    includes: T.fnSig([T.string], T.boolean),
    startsWith: T.fnSig([T.string], T.boolean),
    endsWith: T.fnSig([T.string], T.boolean),
    slice: T.fnSig([T.number, T.number], T.string),
    substring: T.fnSig([T.number, T.number], T.string),
    toUpperCase: T.fnSig([], T.string),
    toLowerCase: T.fnSig([], T.string),
    trim: T.fnSig([], T.string),
    replace: T.fnSig([T.unknown, T.string], T.string),
    split: T.fnSig([T.string], T.array(T.string)),
    toString: T.fnSig([], T.string),
    valueOf: T.fnSig([], T.string),
  },
  Number: {
    toFixed: T.fnSig([T.number], T.string),
    toPrecision: T.fnSig([T.number], T.string),
    valueOf: T.fnSig([], T.number),
    toString: T.fnSig([T.number], T.string),
  },
  Boolean: {
    valueOf: T.fnSig([], T.boolean),
    toString: T.fnSig([], T.string),
  },
  Symbol: {
    toString: T.fnSig([], T.string),
    valueOf: T.fnSig([], T.symbol),
  },
  Buffer: {
    equals: T.fnSig([T.unknown], T.boolean),
    compare: T.fnSig([T.unknown], T.number),
    toString: T.fnSig([T.unknown], T.string),
    toJSON: T.fnSig([], T.unknown),
  },
  Error: {
    toString: T.fnSig([], T.string),
  },
};
// Memoized namespace values for built-in classes. Reference-stable so
// `'x'.constructor === String` compares identical objects (typeValueEquals
// falls back to reference equality for object kinds).
const _builtinClassValues = new Map<string, TypeValue>();
function builtinClassValue(name: string): TypeValue {
  let v = _builtinClassValues.get(name);
  if (v === undefined) {
    v = T.object({});
    (v as any)._builtinName = name;
    _builtinClassValues.set(name, v);
  }
  return v;
}
// Cached `X.prototype` singletons. hoek-style modules assign
// `exports.array = Array.prototype` and later compare
// `baseProto === Types.buffer`: strict-equality on instances only stays
// precise when every evaluation of `X.prototype` yields the same TypeValue.
const BUILTIN_PROTOTYPE_SINGLETONS = new Map<string, TypeValue>();

function builtinPrototype(className: string): TypeValue {
  let proto = BUILTIN_PROTOTYPE_SINGLETONS.get(className);
  if (!proto) {
    const methods = hasOwnProp(BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS, className)
      ? BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS[className]
      : BUILTIN_ERROR_CLASSES.has(className)
        ? BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS.Error
        : {};
    proto = T.instanceOf(className, { ...methods });
    (proto as any)._builtinProto = className;
    BUILTIN_PROTOTYPE_SINGLETONS.set(className, proto);
  }
  return proto;
}
// `Object.prototype.toString` brand string ('[object Map]', '[object Null]',
// ...). Returns undefined when the receiver has no representable brand, so
// the fnSig falls back to its plain `string` return type.
function objectToStringBrand(v: TypeValue | undefined): TypeValue | undefined {
  if (!v) return undefined;
  if (v.kind === "union") {
    const parts = v.members.map((m) => objectToStringBrand(m));
    if (parts.some((p) => p === undefined)) return undefined;
    return simplifyUnion(parts as TypeValue[]);
  }
  let base: TypeValue = v;
  while (base.kind === "refined") base = base.base;
  switch (base.kind) {
    case "object": return T.literal("[object Object]");
    case "array":
    case "tuple": return T.literal("[object Array]");
    case "function": return T.literal("[object Function]");
    case "promise": return T.literal("[object Promise]");
    case "instance": return T.literal(`[object ${base.className}]`);
    case "literal": {
      if (base.value === null) return T.literal("[object Null]");
      if (base.value === undefined) return T.literal("[object Undefined]");
      const t = typeof base.value;
      return T.literal(`[object ${t === "number" ? "Number" : t === "string" ? "String" : "Boolean"}]`);
    }
    case "primitive": {
      const brands: Record<string, string> = {
        number: "Number", string: "String", boolean: "Boolean", bigint: "BigInt", symbol: "Symbol",
      };
      return T.literal(`[object ${brands[base.type] ?? "Object"}]`);
    }
    default: return undefined;
  }
}
// Object.getPrototypeOf: map a receiver onto its class's cached prototype
// singleton (plain objects → Object.prototype, arrays → Array.prototype,
// instances → their class's prototype). Unrepresentable receivers degrade
// to unknown.
function protoOfValue(v: TypeValue | undefined): TypeValue {
  if (!v) return T.unknown;
  if (v.kind === "union") return simplifyUnion(v.members.map((m) => protoOfValue(m)));
  let base: TypeValue = v;
  while (base.kind === "refined") base = base.base;
  switch (base.kind) {
    case "object": return builtinPrototype("Object");
    case "array":
    case "tuple": return builtinPrototype("Array");
    case "function": return builtinPrototype("Function");
    case "promise": return builtinPrototype("Promise");
    case "instance": return builtinPrototype(base.className);
    default: return T.unknown;
  }
}
export {
  BUILTIN_ERROR_CLASSES,
  BUILTIN_PROTOTYPE_CLASSES,
  OBJECT_PROTOTYPE_METHODS,
  BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS,
  builtinClassValue,
  builtinPrototype,
  protoOfValue,
};
