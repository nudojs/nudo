/**
 * B 路径 class：brand 实例 + ctor/method 闭包。
 * 方法内 this 由 transpile 改写为 thisVal 参数。
 */

import type { Abs } from "../abs.ts";
import { abs, unknown, confJoin } from "../abs.ts";
import { objOf } from "../objects.ts";

export type BClassSpec = {
  name: string;
  ctor?: (thisVal: Abs, ...args: Abs[]) => Abs;
  methods?: Record<string, (thisVal: Abs, ...args: Abs[]) => Abs>;
};

const classRegistry = new Map<string, BClassSpec>();
const classImpl = new WeakMap<object, BClassSpec>();

/** 定义类 → 可 new 的 Abs（brand 标记） */
export function $class(name: string, spec: Omit<BClassSpec, "name">): Abs {
  const full: BClassSpec = { name, ...spec };
  classRegistry.set(name, full);
  const val = abs(
    { k: "brand", name, shape: objOf({}) },
    undefined,
    undefined,
    "exact",
  );
  classImpl.set(val as object, full);
  return val;
}

function specOf(cls: Abs): BClassSpec | undefined {
  if (classImpl.has(cls as object)) return classImpl.get(cls as object);
  if (cls.shape.k === "brand") return classRegistry.get(cls.shape.name);
  return undefined;
}

/** new C(...) → 空 brand 实例 + ctor 写字段 */
export function $new(cls: Abs, args: Abs[]): Abs {
  const spec = specOf(cls);
  const className = spec?.name ?? (cls.shape.k === "brand" ? cls.shape.name : "Anonymous");
  let thisVal = abs(
    { k: "brand", name: className, shape: objOf({}) },
    undefined,
    undefined,
    "path",
  );
  if (spec?.ctor) {
    const after = spec.ctor(thisVal, ...args);
    // ctor 可能返回更新后的 brand
    if (after && after.shape.k === "brand") thisVal = after;
    else thisVal = after ?? thisVal;
  }
  return thisVal;
}

/** 实例方法调用 */
export function $invoke(thisVal: Abs, method: string, args: Abs[]): Abs {
  const spec =
    classImpl.get(thisVal as object) ??
    (thisVal.shape.k === "brand" ? classRegistry.get(thisVal.shape.name) : undefined);
  const m = spec?.methods?.[method];
  if (!m) return unknown;
  return m(thisVal, ...args);
}

/** super 方法：沿 superClass 注册表（MVP：同名注册表） */
export function $invokeSuper(
  thisVal: Abs,
  superName: string,
  method: string,
  args: Abs[],
): Abs {
  const spec = classRegistry.get(superName);
  const m = spec?.methods?.[method];
  if (!m) return unknown;
  return m(thisVal, ...args);
}

export function $thisGet(thisVal: Abs, key: string): Abs {
  if (thisVal.shape.k === "brand") {
    const inner = thisVal.shape.shape;
    if (inner.shape.k === "obj") {
      const slot = inner.shape.slots[key];
      if (slot) return slot.value;
    }
  }
  return unknown;
}

export function $thisSet(thisVal: Abs, key: string, value: Abs): Abs {
  if (thisVal.shape.k === "brand") {
    const inner = thisVal.shape.shape;
    const slots = inner.shape.k === "obj" ? { ...inner.shape.slots } : {};
    slots[key] = { value };
    return abs(
      {
        k: "brand",
        name: thisVal.shape.name,
        shape: objOf(slots),
      },
      thisVal.term,
      thisVal.pred,
      confJoin(thisVal.conf, value.conf),
    );
  }
  return $class("Anonymous", { ctor: (t) => t }).shape.k === "brand"
    ? abs({ k: "brand", name: "Anonymous", shape: objOf({ [key]: { value } }) }, undefined, undefined, "exact")
    : unknown;
}
