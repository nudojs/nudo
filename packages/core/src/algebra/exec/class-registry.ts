/**
 * B class 规格表（无 call/ast-eval 依赖，避免循环）。
 * Abs-eval registerClassDecl 与 transpile $class 共用。
 */

import type { Abs } from "../abs.ts";

export type BClassAccessor = {
  get?: (thisVal: Abs) => Abs;
  set?: (thisVal: Abs, v: Abs) => Abs;
};

export type BClassSpec = {
  name: string;
  superName?: string;
  ctor?: (thisVal: Abs, ...args: Abs[]) => Abs;
  methods?: Record<string, (thisVal: Abs, ...args: Abs[]) => Abs>;
  staticMethods?: Record<string, (...args: Abs[]) => Abs>;
  statics?: Record<string, Abs>;
  /** 实例 get/set：get 无参返回 Abs；set 收到 (thisVal, v) 返回更新后的 thisVal */
  accessors?: Record<string, BClassAccessor>;
  /** 静态 get/set：挂在类构造器上，不在实例原型链 */
  staticAccessors?: Record<string, BClassAccessor>;
};

const classRegistry = new Map<string, BClassSpec>();
/** $class 产出的类 Abs 身份 → 类名（区分类值读写与实例读写） */
const classValues = new WeakMap<object, string>();

export function registerBClass(spec: BClassSpec): void {
  classRegistry.set(spec.name, spec);
}

export function getBClass(name: string): BClassSpec | undefined {
  return classRegistry.get(name);
}

export function markClassValue(v: object, name: string): void {
  classValues.set(v, name);
}

export function classNameOfValue(v: object): string | undefined {
  return classValues.get(v);
}

export function clearBClasses(): void {
  classRegistry.clear();
}
