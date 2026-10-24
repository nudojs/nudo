/**
 * evaluator 运行时绑定表（惰性单例）：
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
// Bug 201：async 体的真挂起驱动（生成器路径）——**内部**运行时符号：
// 不进 runtime.ts facade（facade 只再导出公开符号面），只进绑定表。
import { $asyncGen } from "./runtime/async.ts";
import { $call } from "./call.ts";
// Bug 325：函数**声明**形态的种类戳（宿主普通函数无法回推 async/generator）
import { $fnKindStamp } from "./runtime/state.ts";

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
    // Bug 325：种类戳符号（产物代码按名 import 的同一符号，见 exec/index.ts）
    cached.$fnKindStamp = $fnKindStamp;
    // Bug 201：async 体（含 await）编译成宿主生成器，由本符号驱动挂起/恢复
    cached.$asyncGen = $asyncGen;
  }
  return cached;
}
