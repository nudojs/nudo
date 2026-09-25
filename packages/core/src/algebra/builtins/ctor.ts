/**
 * 内建构造器注册表 + prototype brand / constructor 解析 + Object.prototype 单例 brand
 */
import type { Abs } from "../abs.ts";
import { abs, strLit, unknown } from "../abs.ts";
import { objOf, isNullProtoObj } from "../objects.ts";
import { markClassValue } from "../class-mark.ts";
import { pTrue } from "../pred.ts";
import { str } from "./shared.ts";
import { setPropFlags } from "./invariants.ts";

const builtinCtorByName = new Map<string, Abs>();
const builtinCtorByAbs = new WeakMap<object, string>();

export function builtinCtorAbs(name: string): Abs {
  let a = builtinCtorByName.get(name);
  if (!a) {
    a = abs(
      { k: "brand", name, shape: objOf({ name: { value: strLit(name) } }) },
      undefined,
      undefined,
      "exact",
    );
    markClassValue(a as object, name);
    builtinCtorByName.set(name, a);
    builtinCtorByAbs.set(a as object, name);
  }
  return a;
}

/** Abs 侧内建构造器身份（与宿主构造器名对齐） */
export function builtinCtorNameOf(v: unknown): string | undefined {
  if (!v || typeof v !== "object") return undefined;
  return builtinCtorByAbs.get(v as object);
}

/** 宿主全局构造器身份（Number === (42).constructor 折叠用） */
export function hostBuiltinCtorName(v: unknown): string | undefined {
  if (typeof v !== "function") return undefined;
  if (v === Number) return "Number";
  if (v === String) return "String";
  if (v === Boolean) return "Boolean";
  if (v === BigInt) return "BigInt";
  if (v === Symbol) return "Symbol";
  if (v === Array) return "Array";
  if (v === Object) return "Object";
  if (v === Function) return "Function";
  if (v === Promise) return "Promise";
  if (v === Date) return "Date";
  if (v === RegExp) return "RegExp";
  if (v === Map) return "Map";
  if (v === Set) return "Set";
  if (v === WeakMap) return "WeakMap";
  if (v === WeakSet) return "WeakSet";
  if (v === Error) return "Error";
  if (v === TypeError) return "TypeError";
  if (v === RangeError) return "RangeError";
  if (v === ReferenceError) return "ReferenceError";
  if (v === SyntaxError) return "SyntaxError";
  if (v === URIError) return "URIError";
  if (v === EvalError) return "EvalError";
  if (v === AggregateError) return "AggregateError";
  return undefined;
}

/**
 * 接收者 → 原型链 constructor 名（`.constructor` 折叠）。
 * null-proto 无 Object.prototype.constructor → undefined（读侧走 undef）。
 */
export function ctorNameOfRecv(recv: Abs): string | undefined {
  const s = recv.shape;
  switch (s.k) {
    case "prim":
      return s.type === "number"
        ? "Number"
        : s.type === "string"
          ? "String"
          : s.type === "boolean"
            ? "Boolean"
            : s.type === "bigint"
              ? "BigInt"
              : s.type === "symbol"
                ? "Symbol"
                : undefined;
    case "tuple":
    case "arr":
      return "Array";
    case "obj":
      return isNullProtoObj(recv) ? undefined : "Object";
    case "fn":
      return "Function";
    case "eff":
      return s.eff === "promise" ? "Promise" : "Generator";
    case "brand": {
      if (s.name === "Object.prototype") return "Object";
      if (s.name.endsWith(".prototype")) return s.name.slice(0, -".prototype".length);
      return s.name;
    }
    case "sum": {
      let first: string | undefined;
      for (const m of s.members) {
        const n = ctorNameOfRecv(m);
        if (n === undefined) return undefined;
        if (first === undefined) first = n;
        else if (first !== n) return undefined;
      }
      return first;
    }
    default:
      return undefined;
  }
}

/** `X.prototype` 形态（getPrototypeOf 结果；带 constructor 槽） */
export function protoBrandAbs(ctorName: string): Abs {
  return abs(
    {
      k: "brand",
      name: `${ctorName}.prototype`,
      shape: objOf({ constructor: { value: builtinCtorAbs(ctorName) } }),
    },
    undefined,
    undefined,
    "exact",
  );
}

/**
 * Object.getPrototypeOf 的具体原型投影（constructor 链可解）。
 * null-proto → null 字面量；不可判形态 → unknown（不假装精确原型）。
 */
export function protoOfRecv(a: Abs): Abs {
  const s = a.shape;
  const nullProtoLit = abs(
    { k: "unknown" },
    { op: "lit", value: null as never },
    pTrue,
    "exact",
  );
  if (s.k === "tuple" || s.k === "arr") return protoBrandAbs("Array");
  if (s.k === "prim") {
    const ctor =
      s.type === "number"
        ? "Number"
        : s.type === "string"
          ? "String"
          : s.type === "boolean"
            ? "Boolean"
            : s.type === "bigint"
              ? "BigInt"
              : s.type === "symbol"
                ? "Symbol"
                : undefined;
    return ctor ? protoBrandAbs(ctor) : unknown;
  }
  if (s.k === "fn") return protoBrandAbs("Function");
  if (s.k === "eff" && s.eff === "promise") return protoBrandAbs("Promise");
  if (s.k === "brand") {
    if (s.name === "Object.prototype") return nullProtoLit;
    if (s.name.endsWith(".prototype")) return objectProtoBrand();
    return protoBrandAbs(s.name);
  }
  if (s.k === "obj") {
    if (isNullProtoObj(a)) return nullProtoLit;
    return objectProtoBrand();
  }
  return unknown;
}

export const OBJECT_PROTO_METHOD_NAMES = new Set([
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "valueOf",
  "toString",
  "toLocaleString",
]);

let objectProtoSingleton: Abs | undefined;

/** Object.prototype 单例（$get(Object, "prototype") 与 host Object.prototype 共用）。
 *  带 constructor 槽（不可枚举）供 `.constructor` / `.constructor.name` 链折叠。 */
export function objectProtoBrand(): Abs {
  if (!objectProtoSingleton) {
    const a = abs(
      {
        k: "brand",
        name: "Object.prototype",
        shape: objOf({ constructor: { value: builtinCtorAbs("Object") } }),
      },
      undefined,
      undefined,
      "exact",
    );
    setPropFlags(a, "constructor", { enumerable: false, writable: true, configurable: true });
    objectProtoSingleton = a;
  }
  return objectProtoSingleton;
}

export function isObjectProtoBrand(a: Abs | undefined): boolean {
  return !!a && a.shape.k === "brand" && a.shape.name === "Object.prototype";
}

