/**
 * B class 规格表（无 call/ast-eval 依赖，避免循环）。
 * Abs-eval registerClassDecl 与 transpile $class 共用。
 */

import type { Abs } from "../abs.ts";

export type BClassSpec = {
  name: string;
  superName?: string;
  ctor?: (thisVal: Abs, ...args: Abs[]) => Abs;
  methods?: Record<string, (thisVal: Abs, ...args: Abs[]) => Abs>;
  staticMethods?: Record<string, (...args: Abs[]) => Abs>;
  statics?: Record<string, Abs>;
  /** get/set 访问器：get 无参返回 Abs；set 收到 (thisVal, v) 返回更新后的 thisVal */
  accessors?: Record<string, { get?: (thisVal: Abs) => Abs; set?: (thisVal: Abs, v: Abs) => Abs }>;
};

const classRegistry = new Map<string, BClassSpec>();

export function registerBClass(spec: BClassSpec): void {
  classRegistry.set(spec.name, spec);
}

export function getBClass(name: string): BClassSpec | undefined {
  return classRegistry.get(name);
}

export function clearBClasses(): void {
  classRegistry.clear();
}
