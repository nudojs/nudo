/**
 * 宿主桥（#9 state.ts 拆分）：宿主函数值 ↔ 一等 fn Abs 的互转面——
 * 稳定门面缓存（Bug 291）、函数种类戳（Bug 325）、apply 桥（Bug 26）、
 * transpile 侧 $fnVal / $absVal 收形入口、函数调用边界
 * （callAtFunctionBoundary）。
 *
 * 依赖方向（无运行时环）：本文件 → phi.ts / exit-stacks.ts / hooks.ts /
 * state.ts（$lit/undef）单向；state.ts 对本文件只有 re-export（无运行时
 * import）。宿主全局函数桥的注入 cell 住 exec/hooks.ts（加载期 setter
 * 断环收容所），本文件读 getter。
 */
import type { Abs } from "../../abs.ts";
import { isAbsLike } from "../../abs.ts";
import { absFunction, getFnImpl, hostFnCtorFacet } from "../../abs-fn.ts";
import { noBody as sharedNoBody } from "../../builtins/shared.ts";
import { pTrue } from "../../pred.ts";
import { joinAbs } from "../../objects.ts";
import { getHostGlobalFnCall } from "../hooks.ts";
import { currentAssumePremises, currentInvariantSpecs, withAssumePremises, withInvariantSpecs } from "./phi.ts";
import {
  isNudoReturn,
  pushThrowExit,
  runWithLoopExits,
  takeLoopExits,
  takeThrowExits,
} from "./exit-stacks.ts";
import { $lit, undef } from "./state.ts";

/**
 * apply 型 impl 的占位 body（AbsFnImpl.body 必需；$call 走 apply 不经 body）。
 *
 * **唯一单例**（Bug 140 收尾）：此前 state.ts 与 `builtins/shared.ts` 各有一份
 * 同形但**不同对象**的占位 body——按对象身份判「是否占位 body」的检查跨模块
 * 必然失配（`impl.body !== noBody` 对 builtins 侧建的占位恒真）⇒ 引擎原生
 * 迭代器的 `@@iterator` 占位 fn 被误判为「真实现」⇒ 对它跑用户迭代器协议
 * ⇒ 调占位 fn ⇒ 确定 TypeError（`[...Array.from('ab').keys()]` 假抛）。
 * 现在两侧共用同一对象，占位判据按身份比较恒成立。
 */
type EmptyBlock = { type: "BlockStatement"; body: never[]; directives: never[] };
export const noBody: EmptyBlock = sharedNoBody as unknown as EmptyBlock;

/**
 * transpile 泄漏的 JS 函数值 → 一等 fn Abs。
 * 求值引擎把函数声明/表达式编译成真实 JS 函数；它们流进对象槽、
 * 元组、join 等 Abs 结构时不能裸存——下游（bridge/leq/join）读 `.shape`。
 * 参数名无法从运行时函数恢复（用 fn.length → argN，与 analyzer 的
 * extractParamNames 回退口径一致）；带真实参数名走 $fnVal（transpile 侧）。
 */

export function asAbsVal(v: unknown): Abs {
  if (isAbsLike(v)) return v as Abs;
  if (typeof v === "function") {
    // Bug 291：宿主函数 → Abs 的**稳定门面**——同一宿主函数恒同一 Abs。
    //
    // 此前每次 asAbsVal(hostFn) 都新建 Abs ⇒ 以 Abs 为键的旁表
    // （propFlags / extState / userFnSlots）**跨调用丢失**：
    // `function g(){} Object.freeze(g); Object.isFrozen(g)` 原生 true，
    // 引擎 false（freeze 的标志落在第一次新建的 Abs 上；再读 g 是全新
    // Abs ⇒ 标志查不到）。原生语义：同一函数**恒同一身份**（`g === g`
    // 真、`Object.isFrozen(g)` 恒定）⇒ 门面必须稳定。
    const cached = hostFnAbsCache.get(v as object);
    if (cached) return cached;
    const n = Math.max(0, v.length);
    const params = Array.from({ length: n }, (_, i) => `arg${i}`);
    // Bug 9：宿主 generator/async 函数/箭头不可 new——可构造性 facet 进 shape
    const ctor = hostFnCtorFacet(v);
    // Bug 325：宿主函数的**种类**戳（async / generator / async-generator）——
    // 函数**声明**转译后是宿主普通函数（async 体包 $async、generator 体包
    // $gen）⇒ 种类无法从宿主侧反推 ⇒ 转译侧在声明处显式戳一次（$fnKindStamp）
    // ⇒ 标签面（Object.prototype.toString）读得到 ⇒ "[object AsyncFunction]" 等
    const hostKind = hostFnKindOf(v);
    // Bug 9：声明名 / 原生 fn.length 透传（v.name / v.length 是宿主真值）——
    // f.name / f.length 折 exact；匿名（name ""）不记 name
    const fnName = typeof v.name === "string" && v.name ? v.name : undefined;
    const a = absFunction(
      params,
      {
        body: noBody,
        // Bug 325：种类戳进 impl（标签面读 impl.fnKind）
        ...(hostKind !== undefined ? { fnKind: hostKind } : {}),
        // 与 $fnVal / $callNamed 同边界：callee 的 NudoReturn 不得冒泡成 caller。
        // Bug 26：宿主全局函数值经桥分派（evalGlobalFn / 字面量守卫执行），
        // 非宿主全局（转译泄漏的普通函数）保持 Abs 实参直调。
        apply: (args, thisVal) => {
          const bridged = getHostGlobalFnCall()?.(v, args);
          if (bridged !== undefined) return bridged;
          // Bug 46：receiver 经 thisVal 转发宿主 this（成员调用 o.m = 函数声明
          // 后 o.m() 的接收者；$invoke/$call 第三参通道）——此前丢弃致
          // $rawThis(this) 恒 undefined
          return callAtFunctionBoundary(() =>
            (v as (...a: Abs[]) => Abs).apply(thisVal as never, args),
          );
        },
      },
      {
        ...(ctor !== undefined ? { ctor } : {}),
        ...(fnName !== undefined ? { name: fnName } : {}),
        length: v.length,
      },
    );
    hostFnAbsCache.set(v as object, a);
    return a;
  }
  return $lit(v);
}

/** 宿主函数 → 稳定 Abs 门面的旁表（Bug 291；WeakMap ⇒ 不泄漏宿主引用） */
const hostFnAbsCache = new WeakMap<object, Abs>();

/** 函数种类戳（Bug 325） */
export type FnKind = "async" | "generator" | "async-generator";

/**
 * Bug 325：宿主函数 → **函数种类**戳（"async" | "generator" |
 * "async-generator"）的旁表。
 *
 * 函数**声明**形态转译后是宿主**普通函数**（async 体包 `$async`、generator
 * 体包 `$gen`）⇒ async/generator 种类**无法从宿主侧反推** ⇒ 由转译侧在
 * 声明处显式戳一次（`$fnKindStamp`），`asAbsVal` 建 fn Abs 时读旁表 ⇒
 * `Object.prototype.toString.call(f)` 给出原生标签（"[object
 * AsyncFunction]" / "[object GeneratorFunction]" /
 * "[object AsyncGeneratorFunction]"，与函数表达式 / 箭头 / 方法四条既有
 * 产生路径同口径）。
 *
 * 旁表按**宿主函数对象**键控（WeakMap ⇒ 不泄漏宿主引用）；读侧在
 * `asAbsVal` 建 Abs 时取 ⇒ 该 Abs 按宿主函数缓存（Bug 291 的稳定门面）
 * ⇒ 戳只需落一次。
 */
const hostFnKindRegistry = new WeakMap<object, FnKind>();

/** transpile 生成代码用：给宿主函数打种类戳（Bug 325） */
export function $fnKindStamp(fn: unknown, kind: string): void {
  if (typeof fn !== "function") return;
  if (kind !== "async" && kind !== "generator" && kind !== "async-generator") return;
  hostFnKindRegistry.set(fn as object, kind);
  // 戳**晚于**首次建 Abs（宿主函数声明提升 ⇒ 声明前就可能被调用）⇒
  // 已缓存的 Abs 就地补戳（impl 可变 ⇒ 标签面立即生效）
  const existing = hostFnAbsCache.get(fn as object);
  if (existing) {
    const impl = getFnImpl(existing);
    if (impl) impl.fnKind = kind;
  }
}

/** 宿主函数的种类戳（无戳 ⇒ undefined ⇒ 标签保守折 "[object Function]"） */
export function hostFnKindOf(fn: unknown): FnKind | undefined {
  if (typeof fn !== "function") return undefined;
  return hostFnKindRegistry.get(fn as object);
}

/** transpile 侧收形入口（instanceof RHS 值等）：host 裸值 / Abs → Abs。
 *  `$` 前缀是运行时绑定表（runtimeArgNames）的注入约定。 */
export function $absVal(v: unknown): Abs {
  return asAbsVal(v);
}

/**
 * 函数调用边界：callee 的 loop/early-return 不得冒泡成 caller 结果。
 * 每个 求值引擎调用帧独立 ALS；NudoReturn 收成该调用的返回值。
 *
 * throws 面（H1）：嵌套帧的 may-throw（pushThrowExit）必须上浮到调用方帧，
 * 不得在边界丢弃——否则跨 callAtFunctionBoundary 的 apply 桥 may-throw
 * 静默消失（与 BUG-006 同类丢失，但发生在帧边界而非桥内）。
 * always-throw 走 NudoThrow 异常原样 rethrow（不经此转发）。
 */
export function callAtFunctionBoundary<T>(body: () => T): T {
  // #152/#176：callee 帧不继承 caller 的用户公理（assume 引理 + invariant
  // 循环不变式，槽清空+边界退出还原）。termVar 同名误匹配（#123
  // contract-face 重锚实参名）/ 绑定名同名误染在嵌套帧是 unsound 假精度；
  // 未种子（pTrue / 空 specs）时零开销直通。闭包回调（数组方法内联回调经
  // 此边界）同按嵌套帧清空——保守诚实。
  if (currentAssumePremises() !== pTrue || currentInvariantSpecs().length > 0) {
    return withAssumePremises(
      pTrue,
      () => withInvariantSpecs([], () => boundaryBody(body)),
    );
  }
  return boundaryBody(body);
}

function boundaryBody<T>(body: () => T): T {
  let forwarded: Abs[] = [];
  try {
    return runWithLoopExits(() => {
      // callee 帧内 fork/loop 早退 ret 值（settleForkArms 入 exits 通道）在
      // 本边界与正常返回值 join —— 此前直接丢弃会错定（fall-through 值独占）。
      const joinFrameExits = (normal: Abs): Abs => {
        const frameExits = takeLoopExits();
        return frameExits.length ? frameExits.reduce((acc, x) => joinAbs(acc, x), normal) : normal;
      };
      try {
        const r = body();
        forwarded = takeThrowExits();
        return joinFrameExits(r as unknown as Abs) as unknown as T;
      } catch (e) {
        forwarded = takeThrowExits();
        if (isNudoReturn(e)) return joinFrameExits(e.absValue) as unknown as T;
        throw e;
      }
    });
  } finally {
    // finally：NudoThrow 冒泡时也先转发兄弟 may-throw（全臂 throw 时
    // 兄弟 throws 与硬抛载荷一并由外层 joinThrowExits 考虑）。
    for (const x of forwarded) pushThrowExit(x);
  }
}

/**
 * 函数边界缺参归一（Bug 7）：宿主绑定元数内省略的尾实参按「显式传
 * undefined」语义补 undefAbs——原样透传的宿主 undefined 流进 $add 等
 * 算子读 .shape 崩溃（被调用边界收成假 may-throw），或经 return 通道
 * 泄漏裸值（违反 result: Abs 不变量）。impl.length = 宿主绑定元数
 * （默认参占位 `_p{i}` 计入——$orDefault 对 lit(undefined) 正常取默认；
 * rest/…收集形参不计——原生省略时收 []）。bindThis 的 receiver 占
 * impl 首参位，随 args 一并计数。读宿主 arguments 的真实 function 包装
 * 不得补齐（arguments.length 会膨胀），走 padArgs:false + 体内归一。
 */
function padOmittedArgs(
  impl: (...args: Abs[]) => unknown,
  args: Abs[],
): Abs[] {
  const arity = impl.length;
  if (args.length >= arity) return args;
  const padded = args.slice();
  for (let i = args.length; i < arity; i++) padded.push(undef());
  return padded;
}

/**
 * 函数表达式 → 一等 fn Abs（transpile 侧带真实参数名；异步 body 包 $async）
 *  opts.bindThis：对象方法——$invoke 会把 receiver 作为 impl 的首参注入。
 *  opts.ctor：Bug 9 可构造性 facet（箭头/方法/async/generator → false；
 *  函数表达式/类表达式值 → true）。
 *  opts.padArgs：默认 true（Bug 7 缺参归一）；读宿主 arguments 的
 *  function 包装传 false（arguments.length 不得被补齐膨胀）。
 *  opts.length：Bug 69 原生 fn.length（首个默认值/rest 形参前的形参数）——
 *  宿主 impl 是解糖产物（默认参占位 `_p{i}` 全成真参），长度不可信；
 *  transpile 侧记录真值，$len 的 fn 分支折 exact。 */
export function $fnVal(
  params: string[],
  impl: (...args: Abs[]) => Abs,
  opts?: { bindThis?: boolean; ctor?: boolean; padArgs?: boolean; length?: number; effectFree?: boolean; closed?: boolean; kind?: string; fnKind?: "function" | "async" | "generator" | "async-generator"; optionalParams?: boolean[] },
): Abs {
  const argsOf =
    opts?.padArgs === false
      ? (a: Abs[]) => a
      : (a: Abs[]) => padOmittedArgs(impl, a);
  return absFunction(
    params,
    {
      body: noBody,
      // bindThis（对象方法）：receiver 走首参注入，无宿主 this；
      // 非方法 fn：宿主 this 传递（call/apply/bind 的 thisArg 经 $rawThis 进入函数体）
      apply: opts?.bindThis
        ? (args) => callAtFunctionBoundary(() => impl(...argsOf(args)))
        : (args, thisVal) =>
            callAtFunctionBoundary(() =>
              impl.apply(
                thisVal as unknown as Parameters<typeof impl>[0],
                argsOf(args),
              ),
            ),
      ...(opts?.bindThis ? { bindThis: true } : {}),
      ...(opts?.effectFree ? { effectFree: true } : {}),
      ...(opts?.closed ? { closed: true } : {}),
      // Bug 93：generator 表达式标记（transpile 透传）——member.ts fn 分支
      // 区分「不可构造但有 prototype」；宿主声明路径走 isHostGeneratorFn
      ...(opts?.kind !== undefined ? { kind: opts.kind } : {}),
      // Bug 325：函数**种类**戳（async × generator 四象限）——与 kind 分开
      // （kind 是派发角色维度）
      ...(opts?.fnKind !== undefined ? { fnKind: opts.fnKind } : {}),
      // Bug 399：逐位「可省略」标记（默认形参 / `?` / rest）⇒ 必选元数
      // 不再靠名字后缀猜（默认形参渲染成光秃秃的名字 ⇒ 被计成必选 ⇒ 假红）
      ...(opts?.optionalParams ? { optionalParams: opts.optionalParams } : {}),
    },
    {
      ...(opts?.ctor !== undefined ? { ctor: opts.ctor } : {}),
      ...(opts?.length !== undefined ? { length: opts.length } : {}),
    },
  );
}
