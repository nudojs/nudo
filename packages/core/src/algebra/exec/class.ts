/**
 * B 路径 class：brand 实例 + ctor/method 闭包 + 继承链。
 * 方法内 this 由 transpile 改写为 thisVal 参数。
 */

import type { Abs } from "../abs.ts";
import { abs, unknown, confJoin, litValue } from "../abs.ts";
import { objOf } from "../objects.ts";
import { $get, $set } from "./runtime.ts";

export type BClassSpec = {
  name: string;
  /** 父类名（继承链查找） */
  superName?: string;
  ctor?: (thisVal: Abs, ...args: Abs[]) => Abs;
  methods?: Record<string, (thisVal: Abs, ...args: Abs[]) => Abs>;
  /** 静态方法（不绑 this） */
  staticMethods?: Record<string, (...args: Abs[]) => Abs>;
  /** 静态字段初值（也写在 class Abs slots 上） */
  statics?: Record<string, Abs>;
};

const classRegistry = new Map<string, BClassSpec>();
const classImpl = new WeakMap<object, BClassSpec>();

/** 定义类 → 可 new 的 Abs（brand 标记；静态字段挂在 slots） */
export function $class(
  name: string,
  spec: Omit<BClassSpec, "name"> & { extends?: string },
): Abs {
  const full: BClassSpec = {
    name,
    superName: spec.extends,
    ctor: spec.ctor,
    methods: spec.methods,
    staticMethods: spec.staticMethods,
    statics: spec.statics,
  };
  classRegistry.set(name, full);
  const slots: Record<string, { value: Abs }> = {};
  if (spec.statics) {
    for (const [k, v] of Object.entries(spec.statics)) slots[k] = { value: v };
  }
  const val = abs(
    { k: "brand", name, shape: objOf(slots) },
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

/** 沿继承链找方法 */
function findMethod(
  startName: string,
  method: string,
): ((thisVal: Abs, ...args: Abs[]) => Abs) | undefined {
  let cur: string | undefined = startName;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const spec = classRegistry.get(cur);
    if (spec?.methods?.[method]) return spec.methods[method];
    cur = spec?.superName;
  }
  return undefined;
}

function findCtor(
  startName: string,
): { ctor: (thisVal: Abs, ...args: Abs[]) => Abs; className: string } | undefined {
  let cur: string | undefined = startName;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const spec = classRegistry.get(cur);
    if (spec?.ctor) return { ctor: spec.ctor, className: cur };
    cur = spec?.superName;
  }
  return undefined;
}

/** new C(...) → 空 brand 实例 + ctor 写字段（自身 ctor 优先） */
export function $new(cls: Abs, args: Abs[]): Abs {
  const spec = specOf(cls);
  const className = spec?.name ?? (cls.shape.k === "brand" ? cls.shape.name : "Anonymous");
  let thisVal = abs(
    { k: "brand", name: className, shape: objOf({}) },
    undefined,
    undefined,
    "path",
  );
  const found = findCtor(className);
  if (found) {
    const after = found.ctor(thisVal, ...args);
    if (after && after.shape.k === "brand") thisVal = after;
    else thisVal = after ?? thisVal;
  }
  return thisVal;
}

/**
 * super(...)：父类构造写入字段（this 保持子类 brand）。
 * transpile: super(a,b) → __this = $super(__this, "Child", [a,b])
 */
export function $super(thisVal: Abs, childName: string, args: Abs[]): Abs {
  const child = classRegistry.get(childName);
  const parentName = child?.superName;
  if (!parentName) return thisVal;
  const found = findCtor(parentName);
  if (!found) return thisVal;
  const after = found.ctor(thisVal, ...args);
  if (after && after.shape.k === "brand") {
    // 保持子类 brand 名
    return abs(
      { k: "brand", name: childName, shape: after.shape.shape },
      after.term,
      after.pred,
      after.conf,
    );
  }
  return after ?? thisVal;
}

/** 实例方法调用：沿继承链；类 Abs 上回落 staticMethods */
export function $invoke(thisVal: Abs, method: string, args: Abs[]): Abs {
  const brandName = thisVal.shape.k === "brand" ? thisVal.shape.name : undefined;
  if (!brandName) return unknown;
  const m = findMethod(brandName, method);
  if (m) return m(thisVal, ...args);
  // 类构造值上的静态方法
  const spec = classRegistry.get(brandName);
  const sm = spec?.staticMethods?.[method];
  if (sm) return sm(...args);
  return unknown;
}

/** super.method()：从父类起找（跳过自身覆盖） */
export function $invokeSuper(
  thisVal: Abs,
  childName: string,
  method: string,
  args: Abs[],
): Abs {
  const child = classRegistry.get(childName);
  const parentName = child?.superName;
  if (!parentName) return unknown;
  const m = findMethod(parentName, method);
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
  return unknown;
}

/** 解构默认值：undefined 时用 default */
export function $orDefault(v: Abs, dflt: () => Abs): Abs {
  if (litValue(v) === undefined && v.shape.k !== "never") {
    // 明确 undefined 字面量 → 默认值；unknown 保守保留
    if (v.term?.op === "lit" && v.term.value === undefined) return dflt();
    if (v.shape.k === "unknown" && v.term?.op === "lit") return dflt();
  }
  if (v.term?.op === "lit" && v.term.value === undefined) return dflt();
  return v;
}

function isNullishAbs(v: Abs): boolean {
  // 仅明确 null/undefined 字面量；对象等无 term 不算 nullish
  if (!v || v.term?.op !== "lit") return false;
  const lv = v.term.value;
  return lv === null || lv === undefined;
}

/** 可选链 a?.b：nullish 短路为 undefined 字面量 */
export function $optionalGet(o: Abs, key: string): Abs {
  if (isNullishAbs(o)) {
    return abs(
      { k: "unknown" },
      { op: "lit", value: undefined as never },
      undefined,
      "exact",
    );
  }
  return $get(o, key);
}

/** 可选链 a?.m()：nullish 短路为 undefined */
export function $optionalInvoke(thisVal: Abs, method: string, args: Abs[]): Abs {
  if (isNullishAbs(thisVal)) {
    return abs(
      { k: "unknown" },
      { op: "lit", value: undefined as never },
      undefined,
      "exact",
    );
  }
  return $invoke(thisVal, method, args);
}

/** 静态方法：cls.staticMethod(args) */
export function $staticInvoke(cls: Abs, method: string, args: Abs[]): Abs {
  const spec = specOf(cls);
  const m = spec?.staticMethods?.[method];
  if (!m) return unknown;
  return m(...args);
}

/** 计算属性写：o[kAbs] = v */
export function $setKey(o: Abs, key: Abs, value: Abs): Abs {
  const k = litValue(key);
  if (typeof k === "string" || typeof k === "number") {
    return $set(o, String(k), value);
  }
  return $set(o, "?", value);
}
