/**
 * 加载期 setter 注入断环的统一收容所（零运行时依赖叶子）。
 *
 * 背景：低层模块需要高层行为（如 member.ts 的原型方法派发需要 class 树、
 * state.ts 的宿主全局函数 apply 需要 calls.ts）而高层模块已依赖低层——
 * 反向 import 会成环。历史解法：低层放一个可变 cell + setter，高层模块
 * 体**加载期**回调注册。cell 若用 `let` 声明在低层，循环加载序下高层
 * 注册可能先于低层模块体执行（TDZ 崩加载序，eval-empty-sum-reduce /
 * env-shadow-parity 实证）；member.ts 被迫用 `var` 提升当防线。
 * 收敛：cell 挪进本叶子（只 import type，模块体恒先于任何消费方执行），
 * 两侧改 import 本文件——`var` TDZ 防线消灭。
 *
 * 现收容两处（cell + setter + getter）：
 * - `protoMethodDispatch`（Bug 89/1041）：containers/member.ts 的原型方法
 *   调用派发，exec/class/invoke.ts 加载期注册；member.ts re-export
 *   `setProtoMethodDispatch` / `ClassMethodOrigin` 维持既有 import 面
 *   （class 树零改动）。
 * - `hostGlobalFnCall`（Bug 26）：宿主全局函数 apply 桥，exec/calls.ts
 *   加载期注册；state.ts（→host-bridge.ts）消费，state.ts re-export
 *   setter 维持既有 import 面。
 *
 * **未收容**（分层限制，勿顺手搬进来）：
 * - builtins/object-proto.ts 的 `receiverToStringResolver`（Bug 315，
 *   containers/member.ts 加载期注册）；
 * - algebra/hof.ts 的 `hostGlobalCallBridge` / `applyCallbackHost` /
 *   `rawArgNormalizer`（exec/call(s).ts、class/invoke.ts 加载期注册）。
 * cell 必须住内核层（builtins/algebra 不得 import exec），exec/hooks.ts
 * 服务不到；下沉需 algebra 层 hooks + builtins/algebra 扩权，本批不做。
 */
import type { Abs } from "../abs.ts";

/**
 * Bug 1041：用户类方法值的**来源侧**（"static" = 构造器上的静态方法 /
 * "inst" = 原型上的实例方法）——同名 static + 实例方法并存时，摘下调用
 * （接收者恒 undefined）靠它定夺跑哪个方法体（原生：`A.m` 与 `a.m` 是
 * 两个不同函数对象）。未标（内建原型方法值）⇒ undefined（不可判）。
 */
export type ClassMethodOrigin = "static" | "inst";

/** 原型方法调用派发签名（home = 类名，name = 方法键，thisVal = 接收者） */
export type ProtoMethodDispatch = (
  home: string,
  name: string,
  thisVal: Abs | undefined,
  args: Abs[],
  origin?: ClassMethodOrigin,
) => Abs;

let protoMethodDispatch: ProtoMethodDispatch | undefined;

/** exec/class/invoke.ts 模块加载时注册（调用派发实现；注册式注入断 containers↔class 环） */
export function setProtoMethodDispatch(d: ProtoMethodDispatch): void {
  protoMethodDispatch = d;
}

/** 当前派发实现（未注册 ⇒ undefined ⇒ 调用方保守折 unknown） */
export function getProtoMethodDispatch(): ProtoMethodDispatch | undefined {
  return protoMethodDispatch;
}

/** 宿主全局函数 apply 桥签名（exec/calls.ts 的 callHostGlobalFn） */
export type HostGlobalFnCall = (fn: unknown, args: Abs[]) => Abs | undefined;

let hostGlobalFnCall: HostGlobalFnCall | undefined;

/** exec/calls.ts 模块加载时注册（Bug 26 宿主全局函数值经桥分派） */
export function setHostGlobalFnCall(bridge: HostGlobalFnCall): void {
  hostGlobalFnCall = bridge;
}

/** 当前宿主全局函数桥（未注册 ⇒ undefined ⇒ Abs 实参直调） */
export function getHostGlobalFnCall(): HostGlobalFnCall | undefined {
  return hostGlobalFnCall;
}
