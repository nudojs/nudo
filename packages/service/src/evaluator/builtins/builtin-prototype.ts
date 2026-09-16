/**
 * 内置类原型成员近似表（Abs 声明）。
 * LSP 补全唯一真值；TypeValue 求值器已删，不再承载 impl 微求值。
 */

import {
  type Abs,
  abs,
  objOf,
  formatAbs,
  relationFn,
} from "@nudojs/core";

function hasOwnProp(props: Record<string, unknown>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(props, name);
}

const BUILTIN_ERROR_CLASSES = new Set([
  "Error", "TypeError", "SyntaxError", "RangeError", "ReferenceError", "URIError", "EvalError",
]);

const BUILTIN_PROTOTYPE_CLASSES = new Set([
  ...BUILTIN_ERROR_CLASSES,
  "Date", "Object", "Map", "Set", "Promise", "RegExp", "Array", "Function",
  "String", "Number", "Boolean", "Symbol", "WeakMap", "WeakSet", "Buffer",
]);

const numA: Abs = { shape: { k: "prim", type: "number" }, conf: "exact" };
const strA: Abs = { shape: { k: "prim", type: "string" }, conf: "exact" };
const boolA: Abs = { shape: { k: "prim", type: "boolean" }, conf: "exact" };
const unkA: Abs = { shape: { k: "unknown" }, conf: "partial" };
const undefA: Abs = abs({ k: "unknown" }, { op: "lit", value: undefined }, undefined, "exact");
const nullA: Abs = abs({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact");
const neverA: Abs = { shape: { k: "never" }, conf: "exact" };

function arrOf(el: Abs): Abs {
  return { shape: { k: "arr", element: el }, conf: "exact" };
}
function tupleOf(els: Abs[]): Abs {
  return { shape: { k: "tuple", elements: els }, conf: "exact" };
}
function promiseOf(inner: Abs): Abs {
  return { shape: { k: "eff", eff: "promise", inner }, conf: "exact" };
}
function sumOf(...members: Abs[]): Abs {
  if (members.length === 1) return members[0]!;
  return { shape: { k: "sum", members }, conf: "exact" };
}
function brand(name: string): Abs {
  return { shape: { k: "brand", name, shape: unkA }, conf: "path" };
}
function emptyObj(): Abs {
  return objOf({});
}

/** 声明型签名（无 apply）；参数名对齐历史 T.fnSig 的 _argN */
function sig(params: Abs[], ret: Abs): Abs {
  return relationFn(params, ret, {
    conf: "exact",
    params: params.map((_, i) => `_arg${i}`),
  });
}

const OBJECT_PROTOTYPE_METHODS: Record<string, Abs> = {
  hasOwnProperty: sig([unkA], boolA),
  isPrototypeOf: sig([unkA], boolA),
  propertyIsEnumerable: sig([unkA], boolA),
  toString: sig([], strA),
  toLocaleString: sig([], strA),
  valueOf: sig([], unkA),
};

const BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS: Record<string, Record<string, Abs>> = {
  Object: { ...OBJECT_PROTOTYPE_METHODS },
  Array: {
    push: sig([unkA], numA),
    pop: sig([], unkA),
    shift: sig([], unkA),
    unshift: sig([unkA], numA),
    slice: sig([numA, numA], arrOf(unkA)),
    splice: sig([numA, numA], arrOf(unkA)),
    concat: sig([unkA], arrOf(unkA)),
    join: sig([strA], strA),
    indexOf: sig([unkA], numA),
    lastIndexOf: sig([unkA], numA),
    includes: sig([unkA], boolA),
    map: sig([unkA], arrOf(unkA)),
    flatMap: sig([unkA], arrOf(unkA)),
    filter: sig([unkA], arrOf(unkA)),
    forEach: sig([unkA], undefA),
    find: sig([unkA], unkA),
    findIndex: sig([unkA], numA),
    some: sig([unkA], boolA),
    every: sig([unkA], boolA),
    reduce: sig([unkA, unkA], unkA),
    sort: sig([unkA], arrOf(unkA)),
    reverse: sig([], arrOf(unkA)),
    toString: sig([], strA),
  },
  Function: {
    call: sig([unkA], unkA),
    apply: sig([unkA, unkA], unkA),
    bind: sig([unkA], unkA),
    toString: sig([], strA),
  },
  Map: {
    get: sig([unkA], unkA),
    set: sig([unkA, unkA], unkA),
    has: sig([unkA], boolA),
    delete: sig([unkA], boolA),
    clear: sig([], undefA),
    forEach: sig([unkA], undefA),
    keys: sig([], arrOf(unkA)),
    values: sig([], arrOf(unkA)),
    entries: sig([], arrOf(tupleOf([unkA, unkA]))),
    toString: sig([], strA),
  },
  Set: {
    add: sig([unkA], unkA),
    has: sig([unkA], boolA),
    delete: sig([unkA], boolA),
    clear: sig([], undefA),
    forEach: sig([unkA], undefA),
    keys: sig([], arrOf(unkA)),
    values: sig([], arrOf(unkA)),
    entries: sig([], arrOf(tupleOf([unkA, unkA]))),
    toString: sig([], strA),
  },
  WeakMap: {
    get: sig([unkA], unkA),
    set: sig([unkA, unkA], unkA),
    has: sig([unkA], boolA),
    delete: sig([unkA], boolA),
    toString: sig([], strA),
  },
  WeakSet: {
    add: sig([unkA], unkA),
    has: sig([unkA], boolA),
    delete: sig([unkA], boolA),
    toString: sig([], strA),
  },
  Promise: {
    then: sig([unkA], promiseOf(unkA)),
    catch: sig([unkA], promiseOf(unkA)),
    finally: sig([unkA], promiseOf(unkA)),
    toString: sig([], strA),
  },
  Date: {
    getTime: sig([], numA),
    valueOf: sig([], numA),
    toISOString: sig([], strA),
    toJSON: sig([], strA),
    toLocaleString: sig([], strA),
    toString: sig([], strA),
  },
  RegExp: {
    test: sig([strA], boolA),
    exec: sig([strA], sumOf(emptyObj(), nullA)),
    toString: sig([], strA),
  },
  String: {
    charAt: sig([numA], strA),
    charCodeAt: sig([numA], numA),
    indexOf: sig([strA], numA),
    lastIndexOf: sig([strA], numA),
    includes: sig([strA], boolA),
    startsWith: sig([strA], boolA),
    endsWith: sig([strA], boolA),
    slice: sig([numA, numA], strA),
    substring: sig([numA, numA], strA),
    toUpperCase: sig([], strA),
    toLowerCase: sig([], strA),
    trim: sig([], strA),
    replace: sig([unkA, strA], strA),
    split: sig([strA], arrOf(strA)),
    toString: sig([], strA),
    valueOf: sig([], strA),
  },
  Number: {
    toFixed: sig([numA], strA),
    toPrecision: sig([numA], strA),
    valueOf: sig([], numA),
    toString: sig([numA], strA),
  },
  Boolean: {
    valueOf: sig([], boolA),
    toString: sig([], strA),
  },
  Symbol: {
    toString: sig([], strA),
    valueOf: sig([], brand("Symbol")),
  },
  Buffer: {
    equals: sig([unkA], boolA),
    compare: sig([unkA], numA),
    toString: sig([unkA], strA),
    toJSON: sig([], unkA),
  },
  Error: {
    toString: sig([], strA),
  },
};

/** formatAbs 去 conf 后缀（补全 detail 不展示 #exact） */
function fmtNoConf(a: Abs): string {
  return formatAbs(a).replace(/\s+#(exact|path|widened|mock|partial|opaque)$/, "");
}

/** LSP detail：Abs fn → `(a: number) => string` 形态 */
export function describeAbsMember(a: Abs): string | null {
  if (a.shape.k !== "fn") return fmtNoConf(a);
  const s = a.shape;
  const pts = s.paramTypes ?? [];
  const params = pts
    .map((p, i) => `${s.params[i] ?? `arg${i}`}: ${fmtNoConf(p)}`)
    .join(", ");
  const ret = s.returnType ? fmtNoConf(s.returnType) : "unknown";
  return `(${params}) => ${ret}`;
}

export function builtinProtoMemberNames(className: string): string[] {
  const table = hasOwnProp(BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS, className)
    ? BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS[className]
    : undefined;
  return table ? Object.keys(table) : [];
}

export function builtinProtoMember(className: string, member: string): Abs | null {
  const table = hasOwnProp(BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS, className)
    ? BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS[className]
    : BUILTIN_ERROR_CLASSES.has(className)
      ? BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS.Error
      : undefined;
  if (!table) return null;
  return table[member] ?? null;
}

export {
  BUILTIN_ERROR_CLASSES,
  BUILTIN_PROTOTYPE_CLASSES,
  OBJECT_PROTOTYPE_METHODS,
  BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS,
};
