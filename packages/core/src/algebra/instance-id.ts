/**
 * 新鲜实例身份侧表（R2b）：对象值创建事件（async 调用 / Promise.resolve /
 * Promise 构造的 promise、生成器对象、迭代器对象、new 实例、对象/数组
 * 字面量）按 WeakMap 侧表打递增 id。strictEqAbs 对「双方已打 id 且 id
 * 不同」折 false——不同创建事件原生必不同引用（`o.m() === o.m()` 折
 * false，与两个 function 表达式不同引用同理）。
 *
 * 健全性依据：
 * - 同一创建事件的别名传播（变量赋值/槽位存取/函数传参）复用同一 Abs
 *   引用，strictEqAbs 的同 ref / 同 var 臂先折 true，不落入 false 臂；
 * - 采纳路径（Promise.resolve(p) 透传既有 promise）返回原 Abs 引用，
 *   不重新打标；
 * - 重新打标（如构造器体 return 既有对象）只改该 Abs 引用的 id——恒等
 *   判定以 Abs 引用为单位，别名同步看到新 id，不产生假 false。
 *
 * 独立小模块：surface(strictEqAbs) 与各创建点共用，避免环
 * （与 symbol-id.ts 同构）。
 */

import type { Abs } from "./abs.ts";

const instanceIds = new WeakMap<object, number>();
let instanceIdSeq = 0;

/** 创建事件打标：调用点须确保该 Abs 是本事件新产出的对象值 */
export function markFreshInstance(a: Abs): Abs {
  instanceIds.set(a as object, ++instanceIdSeq);
  return a;
}

export function freshInstanceIdOf(a: Abs): number | undefined {
  return instanceIds.get(a as object);
}
