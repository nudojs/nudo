/**
 * 当前路径前提 Φ 与用户公理槽（#9 state.ts 拆分）：phi（fork 压栈的
 * 路径前提）、assumePremises（#152 `@nudo:assume` 引理前提）、
 * invariantSpecs（#176 `@nudo:invariant` 循环携带界规格）。
 *
 * 三槽共同契约：同步 save/restore（with* 包裹），随调用栈不随 await
 * 传播——求值是同步的（new Function），无跨 await 窗口，故不必走
 * collector-scope 的 ALS 槽（#8 统一时的裁决记录：ALS 只为 await 窗口
 * 交错隔离而设，同步 with 已足）。叶子模块：仅依赖 pred.ts（运行时）
 * 与 invariant-apply.ts（type-only，无运行时环）。
 */
import type { Phi } from "../../pred.ts";
import { pTrue } from "../../pred.ts";
import type { InvariantSpec } from "./invariant-apply.ts";

/** 当前路径前提 Φ（transpile 后的 fork 会压栈） */
export let phi: Phi = pTrue;

export function currentExecPhi(): Phi {
  return phi;
}

export function withExecPhi<T>(p: Phi, body: () => T): T {
  const prev = phi;
  phi = p;
  try {
    return body();
  } finally {
    phi = prev;
  }
}

/**
 * 用户引理前提（issue #152 `@nudo:assume d <= max`）：checkSource 在目标
 * 函数入口求值时种子，**不随调用链继承**——callee 帧一律见空（callee 同名
 * 参数误匹配外层引理 = unsound 假精度；phi 是全局单槽且调用边界不重置，
 * 故独立成槽）。清空机制：callAtFunctionBoundary 在前提非平凡时以
 * withAssumePremises(pTrue, …) 包裹 callee 体（边界退出还原 caller 值）。
 * 消费方：arithmetic.ts 的 div 关系折叠（同名相关性
 * le(a,b) ∧ b>0 ⇒ a/b ≤ 1，独立区间传播证不出）。
 */
let assumePremises: Phi = pTrue;

export function currentAssumePremises(): Phi {
  return assumePremises;
}

export function withAssumePremises<T>(p: Phi, body: () => T): T {
  const prev = assumePremises;
  assumePremises = p;
  try {
    return body();
  } finally {
    assumePremises = prev;
  }
}

/**
 * #176 `@nudo:invariant dp[*][*] >= 0` 循环携带界规格（assume 的循环类比物，
 * 同为用户公理——引擎不验证其真实性）：name = 循环携带绑定名（pack 槽键 /
 * 形参 ∪ 函数体顶层局部），path = 下钻路径（`[*]` = 元素域逐层 / `.ident` =
 * obj 槽），rel/value = 数值叶子界。消费方：exec/runtime/invariant-apply.ts
 * 在循环 join/宽化位（widenLoopJoin / widenFinal）按绑定名实施强化——
 * 循环携带界的自动推断是 research-grade（循环变量区间宽化丢失，issue #176
 * 实测连 `last = j` 都证不出 ge(0)），用户声明是唯一通道。
 * 与 assumePremises 同款动态域契约：**不随调用链继承**——callee 帧一律见
 * 空（callee 同名局部误染外层不变式 = unsound 假精度），callAtFunctionBoundary
 * 清空 + 边界退出还原。类型住 invariant-apply.ts（type-only import 无运行
 * 时环——本文件是叶子模块）。
 */
let invariantSpecs: readonly InvariantSpec[] = [];

export function currentInvariantSpecs(): readonly InvariantSpec[] {
  return invariantSpecs;
}

export function withInvariantSpecs<T>(
  specs: readonly InvariantSpec[],
  body: () => T,
): T {
  const prev = invariantSpecs;
  invariantSpecs = specs;
  try {
    return body();
  } finally {
    invariantSpecs = prev;
  }
}
