/**
 * Abs 上的一等函数：shape 是 fn，实现在旁路（不污染 Shape）。
 * 与 term-registry 同一纪律：不给共享单例挂 impl。
 */

import type { Node } from "@babel/types";
import type { Abs } from "./abs.ts";
import type { AstEnv } from "./ast-eval.ts";

export type AbsFnImpl = {
  params: string[];
  body: Node;
  async?: boolean;
  /** 声明时捕获的环境（闭包） */
  env?: AstEnv;
  kind?: string;
  /** 调用时直接派发（mock withArgs 等），优先于 body */
  apply?: (args: Abs[]) => Abs;
};

const implByAbs = new WeakMap<object, AbsFnImpl>();

export function attachFnImpl(a: Abs, impl: AbsFnImpl): void {
  if (a && typeof a === "object") implByAbs.set(a as object, impl);
}

export function getFnImpl(a: Abs): AbsFnImpl | undefined {
  if (!a || typeof a !== "object") return undefined;
  return implByAbs.get(a as object);
}

/** 造一个带实现的 Abs 函数值 */
export function absFunction(
  params: string[],
  impl: Omit<AbsFnImpl, "params">,
): Abs {
  const a: Abs = {
    shape: { k: "fn", params },
    conf: "exact",
  };
  attachFnImpl(a, { params, ...impl });
  return a;
}
