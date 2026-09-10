/**
 * 高阶函数：map / filter / reduce 的内涵求值 + generalize 骨架。
 */

import type { Abs } from "./abs.ts";
import { abs, unknown, confJoin } from "./abs.ts";
import type { Phi } from "./pred.ts";
import { pTrue } from "./pred.ts";
import { joinAbs as joinStruct } from "./objects.ts";

export type HofFn = {
  kind: "hof";
  name: "map" | "filter" | "reduce";
  /** 回调：参数名 + 已求值过的 body 结果函数（由 ast-eval 注入） */
  apply: (args: Abs[], self: Abs, phi: Phi) => Abs;
};

/**
 * map(arr, fn)：
 *   对每个元素符号 e，eval fn(e) → β；结果 Arr(β)
 *   小数组字面量：若 element 是 prim，保留 arr(element)
 *   若 fn 无法调用（非函数 Abs），返回 unknown
 */
export function mapAbs(
  self: Abs,
  fn: Abs | ((arg: Abs) => Abs),
  phi: Phi = pTrue,
): Abs {
  const call =
    typeof fn === "function" ? fn : makeCaller(fn);
  if (self.shape.k === "arr") {
    const elem = (self.shape as { element: Abs }).element;
    const out = call(elem);
    return abs({ k: "arr", element: out }, undefined, undefined, confJoin(self.conf, out.conf));
  }
  if (self.shape.k === "tuple") {
    const els = (self.shape as { elements: Abs[] }).elements;
    const outs = els.map((e) => call(e));
    const joined = outs.reduce((a, b) => joinStruct(a, b));
    return abs({ k: "arr", element: joined }, undefined, undefined, "path");
  }
  return unknown;
}

/**
 * reduce(arr, init, fn(acc, item))：
 *   累加器不动点：acc' = fn(acc, item)，直到 join 不再变化
 */
export function reduceAbs(
  self: Abs,
  init: Abs,
  fn: Abs | ((acc: Abs, item: Abs) => Abs),
  phi: Phi = pTrue,
  maxIter = 8,
): Abs {
  const call = typeof fn === "function" ? fn : makeCaller2(fn);
  if (self.shape.k !== "arr" && self.shape.k !== "tuple") return unknown;

  const item: Abs =
    self.shape.k === "arr"
      ? (self.shape as { element: Abs }).element
      : (self.shape as { elements: Abs[] }).elements.reduce((a, b) => joinStruct(a, b), unknown);

  let acc = init;
  for (let i = 0; i < maxIter; i++) {
    const next = call(acc, item);
    if (sameAbs(acc, next)) return next;
    // join 以保 soundness
    acc = joinStruct(acc, next);
  }
  return acc;
}

function makeCaller(fn: Abs): (arg: Abs) => Abs {
  // Phase A：若 fn 是 shape.fn 且无 body，返回 unknown
  return () => unknown;
}

function makeCaller2(fn: Abs): (a: Abs, b: Abs) => Abs {
  return () => unknown;
}

function sameAbs(a: Abs, b: Abs): boolean {
  return a.shape.k === b.shape.k && a.term === b.term && a.pred === b.pred;
}

/**
 * generalize 骨架：对「未知回调」给出外延多态签名的占位。
 * 真正的 generalize 需要在符号 α 上执行 body —— 由 ast-eval 的
 * higher-order 调用点完成。这里提供展示用签名。
 */
export type PolySig = {
  typeParams: string[];
  params: Abs[];
  returns: Abs;
  display: string;
};

export function mapPolySig(): PolySig {
  // ∀A B. (Arr A, A→B) → Arr B
  return {
    typeParams: ["A", "B"],
    params: [
      abs({ k: "arr", element: abs({ k: "unknown" }, undefined, undefined, "path") }, undefined, undefined, "path"),
      unknown,
    ],
    returns: abs({ k: "arr", element: abs({ k: "unknown" }, undefined, undefined, "path") }, undefined, undefined, "path"),
    display: "<A, B>(items: A[], fn: (item: A) => B) => B[]",
  };
}

export function reducePolySig(): PolySig {
  return {
    typeParams: ["A", "B"],
    params: [
      abs({ k: "arr", element: abs({ k: "unknown" }, undefined, undefined, "path") }, undefined, undefined, "path"),
      unknown,
      unknown,
    ],
    returns: abs({ k: "unknown" }, undefined, undefined, "path"),
    display: "<A, B>(items: A[], init: B, fn: (acc: B, item: A) => B) => B",
  };
}
