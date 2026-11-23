/** 集合 forEach：Map / Set / 数组 live 视图与回调效果。 */
import type { Abs } from "../../../abs.ts";
import { abs, isAbsLike, unknown } from "../../../abs.ts";
import { $call } from "../../call.ts";
import { $get } from "./member.ts";
import { enterPromiseForkArm, leavePromiseForkArm } from "../../../builtins.ts";
import { collectionLiveEntries } from "../../../builtins/error/iterator.ts";
import {
  isMapAbs,
  isSetAbs,
  mapEntriesAbs,
  setElementsAbs,
} from "../../../collections.ts";
import { matchIterElements } from "../../match-iter.ts";
import { errorTypeAbs } from "../../may-throw.ts";
import {
  NudoThrow,
  asAbsVal,
  callAtFunctionBoundary,
  undef,
} from "../state.ts";
import { MAX_CONCRETE_LOOP_ITERS } from "../loop-budget.ts";


export function $collectionForEach(recv: Abs, cb: unknown, thisArg?: Abs): Abs | undefined {
  // Bug 202：原生 %Map/Set.prototype.forEach% 以 `Call(callbackfn, thisArg, …)`
  // 调用回调（与 Array.prototype.forEach 的第二实参同一语义）——thisArg 必须
  // 透传到回调调用位：宿主包装函数走 Reflect.apply、Abs fn 走 $call 第三参。
  const invokeCb = (args: Abs[]): void => {
    if (typeof cb === "function") {
      callAtFunctionBoundary(() => {
        Reflect.apply(cb as (...a: Abs[]) => unknown, thisArg as never, args);
      });
      return;
    }
    if (isAbsLike(cb)) {
      $call(cb as Abs, args, thisArg);
    }
  };
  const live = collectionLiveEntries(recv);
  if (isMapAbs(recv)) {
    const visit = (entry: Abs): void => {
      if (entry.shape.k === "tuple" && entry.shape.elements.length >= 2) {
        const key = entry.shape.elements[0]!;
        const value = entry.shape.elements[1]!;
        invokeCb([value, key, recv]);
      }
    };
    if (live) {
      // live 视图有界：回调若不断新增条目，原生会**无限循环**——引擎必须
      // 终止（硬上限同具体循环上限；到达即停，不产出悬挂迭代）。
      for (let i = 0; i < MAX_CONCRETE_LOOP_ITERS; i++) {
        const e = live.take();
        if (e === undefined) break;
        visit(e);
      }
      return undef();
    }
    for (const entry of mapEntriesAbs(recv)) visit(entry);
    return undef();
  }
  if (isSetAbs(recv)) {
    if (live) {
      for (let i = 0; i < MAX_CONCRETE_LOOP_ITERS; i++) {
        const e = live.take();
        if (e === undefined) break;
        invokeCb([e, e, recv]);
      }
      return undef();
    }
    for (const el of setElementsAbs(recv)) {
      invokeCb([el, el, recv]);
    }
    return undef();
  }
  return undefined;
}
