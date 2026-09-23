/**
 * B-path 运行时绑定表（惰性单例）：
 * 从 run.ts 拆出——body-fn（$call 编译执行）与 run.ts 共用，避免
 * run → calls → call → body-fn → run 的模块初始化环（rtAll 顶层
 * spread 会在环内触发 ReferenceError）。
 */
import * as runtime from "./runtime.ts";
import * as classRt from "./class.ts";
import * as callsRt from "./calls.ts";
import {
  isNudoThrow,
  isNudoReturn,
  $isForkExit,
  runWithLoopExits,
  takeLoopExits,
  takeThrowExits,
} from "./runtime.ts";
import { $call } from "./call.ts";

let cached: Record<string, unknown> | undefined;

export function rtAllBindings(): Record<string, unknown> {
  if (!cached) {
    cached = { ...runtime, ...classRt, ...callsRt };
    // ensure control-flow helpers are present even if a re-export layer omits them
    cached.isNudoReturn = isNudoReturn;
    cached.isNudoThrow = isNudoThrow;
    cached.$isForkExit = $isForkExit;
    cached.runWithLoopExits = runWithLoopExits;
    cached.takeLoopExits = takeLoopExits;
    cached.takeThrowExits = takeThrowExits;
    cached.$call = $call;
  }
  return cached;
}
