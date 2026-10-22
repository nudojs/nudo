/**
 * 求值引擎运行时共享状态：phi、就地写、字面量 Abs、真值、循环信号。
 * 叶子模块——不依赖 runtime 其它文件（tuple/obj 字面量就地构造，避免 state↔containers 环）。
 *
 * Invariants:
 * - Bug 213：宿主 / 命名空间对象（Math / JSON / Reflect）的自有属性投影按
 *   **getOwnPropertyNames**（全部自有字符串键）而非 Object.entries（只取可
 *   枚举键）——原生这些对象的自有属性几乎全不可枚举，按可枚举投影会把整个
 *   自有面丢掉（gOPN / ownKeys / hasOwn / gOPD 全折 0）；逐键记 enumerable /
 *   writable / configurable 标志，不可枚举键仍不进枚举面。
 * - Bug 210：enforceProxyGetInvariant 是 Proxy [[Get]] 规范不变量的单一实现
 *   （靶上自有属性不可配置且不可写时，get 陷阱须返回其实际值）；
 *   proxyTargetInnerObj 归一化「靶 → 内层 obj Abs」（不变性侧表与槽表都挂
 *   在内层 obj 上——brand 包装的靶走内层）。
 *   [[OwnPropertyKeys]] 不变量（重复名 / 漏键 / 多余键）在
 *   builtins/object/descriptor.ts（enforceProxyOwnKeysInvariant）。
 */
import type { Abs } from "../../abs.ts";
import { abs, bool, boolLit, confJoin, litValue, numLit, strLit, unknown, type Confidence } from "../../abs.ts";
import { lit } from "../../term.ts";
import type { Phi } from "../../pred.ts";
import { pTrue, and, predEquals } from "../../pred.ts";
import { absFunction, getFnImpl, hostFnCtorFacet } from "../../abs-fn.ts";
import { noBody as sharedNoBody } from "../../builtins/shared.ts";
import { registerSymbolMeta } from "../../symbol-id.ts";
import { NudoThrow, isNudoThrow } from "../nudo-throw.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { errorTypeAbs, $tryMarkSoft, $tryDigestSoft, $tryReleaseSoft, popMayThrowFrame, orphanMayThrowEffects, type MayThrowEffect } from "../may-throw.ts";
import { shouldWidenArrayLiteral, widenedArrayConf } from "../../containers.ts";
import { joinAbs, objOf } from "../../objects.ts";
import { extStateOf, getPropFlags, setPropFlags } from "../../builtins/invariants.ts";
import type { InvariantSpec } from "./invariant-apply.ts";

export { NudoThrow, isNudoThrow };

export function writeInPlace(target: Abs, next: Abs): Abs {
  target.shape = next.shape;
  target.conf = next.conf;
  target.term = undefined;
  target.pred = undefined;
  return target;
}

/** 调用方已直接改 shape 时的 term/pred 清理 */
export function clearStaleTermPred(v: Abs): void {
  v.term = undefined;
  v.pred = undefined;
}

/** 当前路径前提 Φ（transpile 后的 fork 会压栈） */
export let phi: Phi = pTrue;

/**
 * 具体循环硬上限截断时的 conf 降级：exact/path → partial。
 * 截断后的中间态不得继续声明精确（有界分析的诚实标记）；
 * widened/partial/opaque 本就不声明精确，原样保留。
 */
export function confPartial(a: Abs): Abs {
  return a.conf === "exact" || a.conf === "path" ? { ...a, conf: "partial" } : a;
}

/**
 * 循环 pack 状态（$obj({ name: binding })）的截断降级：降**槽位值**的 conf
 * ——unpack 取的是槽位值（$get(o, name)），只降外层包装对绑定不可见。
 * pack 由 transpile 发射（$obj + $copy(binding)），形态恒为扁平一层 obj。
 */
export function confPartialPacked(a: Abs): Abs {
  if (a.shape.k !== "obj") return confPartial(a);
  const slots: Record<string, { value: Abs }> = {};
  for (const [k, slot] of Object.entries(a.shape.slots)) {
    slots[k] = { value: confPartial(slot.value) };
  }
  return objOf(slots);
}

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

/**
 * apply 型 impl 的占位 body（AbsFnImpl.body 必需；$call 走 apply 不经 body）。
 *
 * **唯一单例**（Bug 140 收尾）：此前本文件与 `builtins/shared.ts` 各有一份
 * 同形但**不同对象**的占位 body——按对象身份判「是否占位 body」的检查跨模块
 * 必然失配（`impl.body !== noBody` 对 builtins 侧建的占位恒真）⇒ 引擎原生
 * 迭代器的 `@@iterator` 占位 fn 被误判为「真实现」⇒ 对它跑用户迭代器协议
 * ⇒ 调占位 fn ⇒ 确定 TypeError（`[...Array.from('ab').keys()]` 假抛）。
 * 现在两侧共用同一对象，占位判据按身份比较恒成立。
 */
type EmptyBlock = { type: "BlockStatement"; body: never[]; directives: never[] };
export const noBody: EmptyBlock = sharedNoBody as unknown as EmptyBlock;

/**
 * Bug 26：宿主全局函数 apply 桥（exec/calls.ts 的 callHostGlobalFn——模块
 * 加载时注册）。asAbsVal 给宿主函数建的 fn Abs 的 apply 钩子此前直接把
 * Abs 实参喂宿主函数（容器槽持有的 parseInt 被调用 → ToPrimitive 假值被
 * 弃成 unknown）；命中宿主全局身份时改走被调用位桥。state.ts 是叶子
 * 模块（calls.ts 单向依赖本文件），注册式注入避免反向 import 环。
 */
let hostGlobalFnCall: ((fn: unknown, args: Abs[]) => Abs | undefined) | undefined;

export function setHostGlobalFnCall(bridge: (fn: unknown, args: Abs[]) => Abs | undefined): void {
  hostGlobalFnCall = bridge;
}

/**
 * transpile 泄漏的 JS 函数值 → 一等 fn Abs。
 * 求值引擎把函数声明/表达式编译成真实 JS 函数；它们流进对象槽、
 * 元组、join 等 Abs 结构时不能裸存——下游（bridge/leq/join）读 `.shape`。
 * 参数名无法从运行时函数恢复（用 fn.length → argN，与 analyzer 的
 * extractParamNames 回退口径一致）；带真实参数名走 $fnVal（transpile 侧）。
 */

export function asAbsVal(v: unknown): Abs {
  if (v && typeof v === "object" && "shape" in (v as object)) return v as Abs;
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
    // Bug 9：声明名 / 原生 fn.length 透传（v.name / v.length 是宿主真值）——
    // f.name / f.length 折 exact；匿名（name ""）不记 name
    const fnName = typeof v.name === "string" && v.name ? v.name : undefined;
    const a = absFunction(
      params,
      {
        body: noBody,
        // 与 $fnVal / $callNamed 同边界：callee 的 NudoReturn 不得冒泡成 caller。
        // Bug 26：宿主全局函数值经桥分派（evalGlobalFn / 字面量守卫执行），
        // 非宿主全局（转译泄漏的普通函数）保持 Abs 实参直调。
        apply: (args, thisVal) => {
          const bridged = hostGlobalFnCall?.(v, args);
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
  if (assumePremises !== pTrue || invariantSpecs.length > 0) {
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

/**
 * 宿主 this → Abs：函数体 prologue 用它承接 call/apply/bind 传入的 thisArg。
 * Abs 原样返回；宿主 undefined（普通调用/call 缺 thisArg）→ $lit(undefined)。
 * 求值引擎产物是 new Function 拼接（sloppy），裸调用的宿主 this 泄漏为
 * globalThis——归一到 $lit(undefined)（strict 模块语义下的 this）。
 */
export function $rawThis(v: unknown): Abs {
  if (v === undefined || v === globalThis) return $lit(undefined);
  if (v && typeof v === "object" && "shape" in (v as object)) return v as Abs;
  return $lit(v);
}

/**
 * strict 模块语义下写不可变目标（frozen/sealed 新键/nonext 新键/
 * writable:false/getter-only/non-configurable 删）→ hard TypeError。
 * 抛 NudoThrow 由 catch 转译吸收为 TypeError 绑定；无 catch 时函数中断
 * （never + throws），callTranspiledExportFull 上报 L2 entry-may-throw。
 */
export function throwStrictWrite(): never {
  throw new NudoThrow(errorTypeAbs("TypeError"));
}

/** const 绑定再赋值（Assignment to constant variable）→ hard TypeError */
export function $throwConstAssign(): never {
  throw new NudoThrow(errorTypeAbs("TypeError"));
}

/**
 * 自由 `arguments` 读（模块顶层 / 无任何外层函数绑定）：非宿主全局，
 * 原生 unresolvable reference → hard ReferenceError（ESM 无 arguments
 * 全局；`typeof arguments` 豁免由 transpile 折 "undefined" 不走此处）。
 */
export function $throwFreeArguments(): never {
  throw new NudoThrow(errorTypeAbs("ReferenceError"));
}

// --- new.target（Bug 79）---
// 原生语义：new.target 由「调用方式」决定——普通调用恒 undefined；
// [[Construct]] 调用（$new）体内为被 new 的构造器自身。用求值侧栈近似：
// $new 压入被构造的类值，$call/$invoke（普通调用面）在调用期间清空并
// 恢复——构造器体/实例字段初始化器直接读栈（不经调用面）得类值，
// 嵌套普通函数读得 undefined，与原生一致。
const newTargetStack: Abs[] = [];

/** $new 专用：进入构造（构造器体 + 实例字段初始化器期间 new.target = 类值） */
export function pushCtorFrame(cls: Abs): void {
  newTargetStack.push(cls);
}

export function popCtorFrame(): void {
  newTargetStack.pop();
}

/** `new.target` 读：栈顶类值；普通调用面已清空 → undefined 字面量 */
export function $newTarget(): Abs {
  return newTargetStack[newTargetStack.length - 1] ?? $lit(undefined);
}

/**
 * 普通调用面（$call / $invoke / 宿主函数 invoke）包裹：调用期间清空
 * new.target 栈（嵌套函数原生读 undefined），返回后恢复外层构造帧。
 */
export function withNewTargetReset<T>(body: () => T): T {
  if (newTargetStack.length === 0) return body();
  const saved = newTargetStack.splice(0, newTargetStack.length);
  try {
    return body();
  } finally {
    newTargetStack.push(...saved);
  }
}

/** 生成代码可用的真值判定（undefined = 无法判定）；与 litTruth 同口径 */
export function $litTruth(a: Abs): boolean | undefined {
  return litTruth(a);
}

/** 字面量 → Abs（transpile 侧数字/字符串/布尔/null/undefined） */
export function $lit(v: unknown): Abs {
  if (v && typeof v === "object" && "shape" in (v as object) && "conf" in (v as object)) {
    return v as Abs;
  }
  return litAbsFromJs(v);
}

export function litAbsFromJs(v: unknown, depth = 0): Abs {
  if (v === null || v === undefined) {
    return abs({ k: "unknown" }, { op: "lit", value: v as unknown as import("../../term.ts").LiteralValue }, pTrue, "exact");
  }
  const t = typeof v;
  if (t === "number" || t === "string" || t === "boolean" || t === "bigint") {
    return abs(
      { k: "prim", type: t as "number" | "string" | "boolean" | "bigint" },
      { op: "lit", value: v as unknown as import("../../term.ts").LiteralValue },
      pTrue,
      "exact",
    );
  }
  if (t === "symbol") {
    // Bug 54：宿主 symbol lit（Symbol.iterator 等 well-known 常量读）——
    // 同一宿主值跨读稳定，exact lit 健全（=== / typeof / String(sym) /
    // .description 均可折）；meta 侧表注册 description。
    const sym = abs(
      { k: "prim", type: "symbol" },
      { op: "lit", value: v as unknown as import("../../term.ts").LiteralValue },
      pTrue,
      "exact",
    );
    return registerSymbolMeta(sym, (v as symbol).description === undefined
      ? abs({ k: "unknown" }, { op: "lit", value: undefined }, pTrue, "exact")
      : strLit((v as symbol).description!));
  }
  // JS 数组/纯对象字面量 → tuple/obj（与 runtime $arr/$obj 同构，就地构造以保 state 为叶子）；
  // 循环引用/过深/非 plain 对象（Date/Map/Set/RegExp…）诚实 unknown。
  if (depth < 8) {
    if (Array.isArray(v)) {
      // 稀疏数组（case 实参 [1,,3]）：`i in v` 探洞，洞下标记入 tuple.holes
      //（与字面量路径 $arrWithHoles 同口径——读值 undefined、`in`/自有属性
      // 判定 false）；超 cap widen 成 arr 时丢洞精度（arr 形状无 holes 槽，
      // 同 $arrWithHoles 退化）
      const holes: number[] = [];
      const els: Abs[] = [];
      for (let i = 0; i < v.length; i++) {
        if (i in v) els.push(litAbsFromJs(v[i], depth + 1));
        else {
          holes.push(i);
          els.push(litAbsFromJs(undefined));
        }
      }
      if (shouldWidenArrayLiteral(els.length)) {
        return abs(
          { k: "arr", element: els.reduce((x, y) => joinAbs(x, y)) },
          undefined,
          undefined,
          widenedArrayConf(),
        );
      }
      return abs(
        { k: "tuple", elements: els, ...(holes.length ? { holes } : {}) },
        undefined,
        undefined,
        "exact",
      );
    }
    if (t === "object") {
      const proto = Object.getPrototypeOf(v);
      if (proto === Object.prototype || proto === null) {
        const slots: Record<string, { value: Abs }> = {};
        /**
         * Bug 213：宿主 / 命名空间对象（Math / JSON / Reflect）的自有属性几乎
         * 全部**不可枚举**（原生 Object.keys(Math) 为空串数组，但
         * Object.getOwnPropertyNames(Math) 非空）——此前按 Object.entries
         * （只取**可枚举**自有键）投影 ⇒ 整个自有面被丢弃 ⇒ 引擎侧
         * gOPN / ownKeys / hasOwn / gOPD 对这些对象全折 0（原生折非 0）。
         *
         * 改为按 Object.getOwnPropertyNames 投影**全部自有字符串键**，并逐键
         * 记下原生描述符标志（enumerable / writable / configurable）——
         * 不可枚举键不进枚举面（Object.keys 仍为空，与原生一致），
         * 描述符面（gOPD）与原生逐字段一致。
         */
        const names = Object.getOwnPropertyNames(v);
        for (const k of names) {
          const d = Object.getOwnPropertyDescriptor(v, k);
          // 数据属性取 d.value；访问器属性取读值（getter 求值——与旧
          // Object.entries 路径同口径：宿主 getter 在成员读时本就会求值）。
          const raw = d && "value" in d ? d.value : (v as Record<string, unknown>)[k];
          Object.defineProperty(slots, k, {
            value: { value: litAbsFromJs(raw, depth + 1) },
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
        const obj = objOf(slots);
        for (const k of names) {
          const d = Object.getOwnPropertyDescriptor(v, k);
          if (!d) continue;
          setPropFlags(obj, k, {
            writable: d.writable !== false,
            enumerable: d.enumerable !== false,
            configurable: d.configurable !== false,
          });
        }
        /**
         * Bug 213（续）：宿主对象自有 **symbol** 键（如 Math 的
         * Symbol.toStringTag）也进 [[OwnPropertyKeys]] 面——原生
         * Reflect.ownKeys(Math) 比 getOwnPropertyNames 多一个 symbol 键。
         * 引擎槽域是字符串键面，按既有约定投影为 "@@X" 槽（symbolKey 标记，
         * 与 transpile 期 [Symbol.X] 投影同口径）；无名用户符号无投影
         * （不凭空捏槽）。
         */
        for (const sym of Object.getOwnPropertySymbols(v)) {
          const slotKey = hostSymbolSlotKeyOf(sym);
          if (slotKey === undefined) continue;
          const d = Object.getOwnPropertyDescriptor(v, sym);
          Object.defineProperty(slots, slotKey, {
            value: {
              value: litAbsFromJs((v as unknown as Record<symbol, unknown>)[sym], depth + 1),
              symbolKey: true,
            },
            enumerable: true,
            writable: true,
            configurable: true,
          });
          setPropFlags(obj, slotKey, {
            writable: d?.writable !== false,
            enumerable: d?.enumerable !== false,
            configurable: d?.configurable !== false,
          });
        }
        return obj;
      }
    }
  }
  return unknown;
}

/**
 * Bug 213：宿主 Symbol 命名空间的 well-known 名 → "@@X" 槽键（**宿主身份**
 * 反查——不用 description：用户符号 Symbol("Symbol.iterator") 的
 * description 恰是 "Symbol.iterator"，按 description 会误投影到 well-known 槽）。
 *
 * 本模块是叶子（不能 import exec/runtime/symbol-key.ts——它依赖本文件的
 * litAbsFromJs，会成 state↔symbol-key 环），故此处按宿主身份现查
 * （宿主 well-known 符号集极小，仅在宿主对象带自有 symbol 键时触发）。
 */
function hostSymbolSlotKeyOf(sym: symbol): string | undefined {
  const ns = Symbol as unknown as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(Symbol)) {
    if (ns[name] === sym) return `@@${name}`;
  }
  return undefined;
}

/**
 * Bug 210：Proxy 靶的**内层 obj Abs**（obj 靶 → 自身；brand 包装的靶 → 内层
 * obj；其余形态 → undefined）——不变性侧表（extState / propFlags）与槽表都挂
 * 在内层 obj 上（外层 brand Abs 只是包装）。
 */
export function proxyTargetInnerObj(target: Abs): Abs | undefined {
  return target.shape.k === "obj"
    ? target
    : target.shape.k === "brand" && target.shape.shape.shape.k === "obj"
      ? target.shape.shape
      : undefined;
}

/**
 * Bug 210：Proxy 靶上自有数据属性值（obj 槽 / brand 内层 obj 槽）。
 * 非自有属性 → undefined（不变量不适用）。
 */
function proxyTargetOwnValue(target: Abs, key: string): Abs | undefined {
  const inner = proxyTargetInnerObj(target);
  if (!inner) return undefined;
  const slots = (inner.shape as { slots: Record<string, { value: Abs }> }).slots;
  if (!Object.prototype.hasOwnProperty.call(slots, key)) return undefined;
  return slots[key]!.value;
}

/**
 * Bug 210：Proxy [[Get]] 规范不变量（ES2024 10.5.4 step 6）——靶上该自有
 * 属性**不可配置且不可写**（数据属性）时，get 陷阱必须返回该属性的实际值
 * （SameValue），否则抛 TypeError（原生 "'get' on proxy: property 'a' is a
 * read-only and non-configurable data property on the proxy target but the
 * proxy did not return its actual value"）。
 *
 * 判定口径：
 * - 冻结靶（extState "frozen"）：全部自有数据属性不可写 + 不可配置；
 * - 密封靶（"sealed"）：不可配置但**仍可写** → 不触发不变量；
 * - defineProperty 收紧的 flags：writable:false + configurable:false。
 *
 * 值不可判（抽象值 / 非字面量）→ 不抛（sound 保守——原生只在确定不一致
 * 时抛；引擎不得凭空造不一致）。
 *
 * 符号投影键（"[Symbol.X]" → "@@X"）：靶的**自有 symbol 属性**面在引擎里
 * 不可判（槽键 "@@X" 与原生 symbol 键不同域）→ 跳过（调用方以
 * opts.symbolKey 标记）。
 *
 * 消费方：exec/runtime/containers/member.ts 的 Proxy get 陷阱分支
 * （该文件归 S2a/S2b 分片——越界诉求：陷阱结果算出后调本函数一行）。
 */
export function enforceProxyGetInvariant(
  target: Abs,
  key: string,
  trapResult: Abs,
  opts?: { symbolKey?: boolean },
): void {
  if (opts?.symbolKey === true) return; // symbol 投影键 → 靶自有 symbol 面不可判
  const inner = proxyTargetInnerObj(target);
  if (!inner) return;
  const st = extStateOf(inner);
  const flags = getPropFlags(inner)?.get(key);
  const nonWritable = flags?.writable === false || st === "frozen";
  const nonConfigurable =
    flags?.configurable === false || st === "frozen" || st === "sealed";
  if (!nonWritable || !nonConfigurable) return;
  const own = proxyTargetOwnValue(inner, key);
  if (own === undefined) return; // 靶上非自有属性 → 不变量不适用
  const a = litValue(own);
  const b = litValue(trapResult);
  if (!a.ok || !b.ok) return; // 值不可判 → 不抛
  if (!Object.is(a.value, b.value)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
}

/** JS 真值：字面量按 Boolean(v)；对象形恒真；不可判 → undefined */
export function litTruth(a: Abs): boolean | undefined {
  if (a.term?.op === "lit") {
    // lit(undefined) 与「无 lit」都经 litValue 折叠成 undefined，须先看 term
    return Boolean(a.term.value);
  }
  switch (a.shape.k) {
    case "obj":
    case "arr":
    case "tuple":
    case "fn":
    case "brand":
    case "eff":
      return true;
    case "prim":
      // 0n 为 falsy（Boolean(0n)===false）；symbol 恒真
      return a.shape.type === "symbol" ? true : undefined;
    case "never":
      return false;
    default:
      return undefined;
  }
}

export function isDefinitelyTrue(a: Abs): boolean {
  return litTruth(a) === true;
}

export function isDefinitelyFalse(a: Abs): boolean {
  const t = litTruth(a);
  if (t === false) return true;
  if (a.shape.k === "never") return true;
  return false;
}

export function undef(): Abs {
  return abs({ k: "unknown" }, { op: "lit", value: undefined }, pTrue, "exact");
}

/**
 * 越界/未写槽读的合成 undefined（OOB marker）：
 * 抽象下标可能 miss（`d[i]` 的 i 超出已知元素）时并入的臂。
 * 值与 undef() 同（读越界原生得 undefined），但 conf=partial 标记
 * 「这是引擎精度产物，不是用户可观测的确定 undefined」——下游
 * 成员读写不得据此记 may-throw（DP 表 `d[i-1][j]` 类嵌套读取的
 * L2 误报来源，issue #98）。用户字面 undefined（契约/可选槽）是
 * exact conf，仍走 may-throw 口径。
 */
export function oobUndef(): Abs {
  return abs({ k: "unknown" }, { op: "lit", value: undefined }, pTrue, "partial");
}

/** OOB 合成 undefined 判定（conf=partial 的 lit undefined） */
export function isOobUndef(a: Abs | undefined): boolean {
  return (
    !!a &&
    a.conf === "partial" &&
    a.term?.op === "lit" &&
    a.term.value === undefined &&
    a.shape.k === "unknown"
  );
}

// 退出栈（ALS）+ $try*
export const loopExitsAls = new AsyncLocalStorage<Abs[]>();
export const throwExitsAls = new AsyncLocalStorage<Abs[]>();
export const tryMarksAls = new AsyncLocalStorage<number[]>();
/** 每个 try 是否仍有未消化的 soft may-throw 帧（digest/release 幂等） */
export const softFrameActiveAls = new AsyncLocalStorage<boolean[]>();

/** 函数求值作用域：收集抽象分支上的 early-return / throw 值；try 标记栈同边界 */
export function runWithLoopExits<T>(body: () => T): T {
  return loopExitsAls.run([], () =>
    throwExitsAls.run([], () =>
      tryMarksAls.run([], () => softFrameActiveAls.run([], body)),
    ),
  );
}

export function takeLoopExits(): Abs[] {
  return loopExitsAls.getStore() ?? [];
}

export function takeThrowExits(): Abs[] {
  return throwExitsAls.getStore() ?? [];
}

export function pushLoopExit(v: Abs): void {
  loopExitsAls.getStore()?.push(v);
}

export function pushThrowExit(v: Abs): void {
  throwExitsAls.getStore()?.push(v);
}

/** transpile 生成代码用：`$pushLoopExit` */
export function $pushLoopExit(v: Abs): void {
  pushLoopExit(v);
}

/** try 块开始：压栈 hard/soft 标记 */
export function $tryMark(): number {
  $tryMarkSoft();
  softFrameActiveAls.getStore()?.push(true);
  const store = throwExitsAls.getStore();
  const m = store?.length ?? 0;
  tryMarksAls.getStore()?.push(m);
  return m;
}

/** 当前最内层 try 的 mark（return 时 drain 用；嵌套调用不串栈） */
export function $tryCurrentMark(): number {
  const stack = tryMarksAls.getStore();
  return stack && stack.length > 0 ? stack[stack.length - 1]! : 0;
}

export function $tryPopMark(): void {
  tryMarksAls.getStore()?.pop();
  const soft = softFrameActiveAls.getStore();
  if (soft && soft.length > 0) {
    if (soft[soft.length - 1]) $tryReleaseSoftOut();
    soft.pop();
  }
}

/** 取出 mark 之后新记录的 throw（try 吸收 / catch 合并） */
export function $tryTakeSince(mark: number): Abs[] {
  const store = throwExitsAls.getStore();
  if (!store) return [];
  return store.splice(Math.min(mark, store.length));
}

/** 窥视 mark 之后新记录的 throw（不摘除——pure memo 捕获用） */
export function peekThrowExitsSince(mark: number): Abs[] {
  const store = throwExitsAls.getStore();
  if (!store) return [];
  return store.slice(Math.min(mark, store.length));
}

/** 当前 throwExits 帧长度（pure memo 捕获的 mark 基线） */
export function throwExitsMark(): number {
  return throwExitsAls.getStore()?.length ?? 0;
}

/** catch 入口消化 try 内 soft may-throw（幂等；design §3.3） */
export function $tryDigestSoftCatch(): void {
  const soft = softFrameActiveAls.getStore();
  if (!soft || soft.length === 0 || !soft[soft.length - 1]) return;
  $tryDigestSoft();
  soft[soft.length - 1] = false;
}

/**
 * 正常完成路径 + catch 可能 rethrow：soft 效果不得消化——假想 soft throw
 * 经 catch rethrow 逃逸（try { u.name } catch (e) { throw e; } 的 L2）。
 * 摘帧上浮（collector / 外层 try 帧可再消化），并清 soft 标记防二次释放。
 */
export function $tryReleaseSoftCatch(): void {
  const soft = softFrameActiveAls.getStore();
  if (!soft || soft.length === 0 || !soft[soft.length - 1]) return;
  $tryReleaseSoft();
  soft[soft.length - 1] = false;
}

/**
 * catch 入口摘下 soft 效果（不消化）。catch 正常落出口再 discard；
 * catch rethrow 时 orphan 上浮（外层 try 可再消化）。
 */
export function $tryDetachSoftCatch(): MayThrowEffect[] {
  const soft = softFrameActiveAls.getStore();
  if (!soft || soft.length === 0 || !soft[soft.length - 1]) return [];
  const effects = popMayThrowFrame(false);
  soft[soft.length - 1] = false;
  return effects;
}

/** catch 无 rethrow 落出口：丢弃已摘下的 soft（design：catch 消化） */
export function $tryDiscardSoft(_effects: MayThrowEffect[]): void {
  /* digest */
}

/** catch rethrow：摘下的 soft 上浮（嵌套 try 归外层帧） */
export function $tryOrphanSoft(effects: MayThrowEffect[]): void {
  orphanMayThrowEffects(effects);
}

/** 无 handler / 出口：上浮未消化 soft may-throw（幂等） */
export function $tryReleaseSoftOut(): void {
  const soft = softFrameActiveAls.getStore();
  if (!soft || soft.length === 0 || !soft[soft.length - 1]) return;
  $tryReleaseSoft();
  soft[soft.length - 1] = false;
}

// 循环信号（NudoReturn / NudoLoopSignal）
// --- early return from loop bodies (C2.1) ---

/** 求值引擎「函数提前 return」信号（区别于 throw） */
export class NudoReturn extends Error {
  readonly absValue: Abs;
  constructor(absValue: Abs) {
    super("nudo:return");
    this.name = "NudoReturn";
    this.absValue = absValue;
  }
}

export function isNudoReturn(e: unknown): e is NudoReturn {
  return e instanceof NudoReturn;
}

/** transpile `return x` inside for/while → `$loopReturn(x)` */
export function $loopReturn(v: Abs): never {
  throw new NudoReturn(v);
}

/**
 * transpile 函数体边界吸收器：`try { body } catch (e) { return $catchReturn(e); }`
 * —— 函数体内 $loopReturn 早退（循环 / if 臂）在函数自身边界收成返回值，
 * 转译模块对裸宿主调用（e2e 真实 .mjs 导入 / 模块顶层互调）自包含；
 * 其余异常（NudoThrow / 原生错误）原样 rethrow。仅在发射体含 $loopReturn
 * 时由 transpile 侧包裹。
 */
export function $catchReturn(e: unknown): Abs {
  if (isNudoReturn(e)) return e.absValue;
  throw e;
}

/**
 * break/continue 信号：transpile 在循环体内生成 $loopBreak/$loopContinue，
 * $for/$whileSeq/$forOf 在 body 调用点捕获。带标签信号只被同标签循环吸收，
 * 不匹配继续冒泡到外层循环（`break outer` / `continue outer` 语义）。
 *
 * abstract 溯源（Bug 47/48）：信号从**抽象条件 fork 臂**内抛出时，兄弟臂
 * 未执行、break/continue 之后的语句丢失——循环携带绑定的「完整迭代效应」
 * 不可观测（捕获点据此宽化）。definite 分支的信号是忠实原生语义
 * （`if (i === 2) break` 全具体循环不得宽化），abstract = false。
 */
let loopSignalFromAbstractArm = false;

/** 抽象 fork 臂执行期间置位（$fork 双臂路径 / $switch 抽象 disc 臂） */
export function withAbstractForkArm<T>(fn: () => T): T {
  const prev = loopSignalFromAbstractArm;
  loopSignalFromAbstractArm = true;
  try {
    return fn();
  } finally {
    loopSignalFromAbstractArm = prev;
  }
}

export class NudoLoopSignal extends Error {
  readonly kind: "break" | "continue";
  readonly label: string | undefined;
  readonly abstract: boolean;
  constructor(kind: "break" | "continue", label?: string) {
    super("nudo:loop");
    this.name = "NudoLoopSignal";
    this.kind = kind;
    this.label = label;
    this.abstract = loopSignalFromAbstractArm;
  }
}

export function $loopBreak(label?: string): never {
  throw new NudoLoopSignal("break", label || undefined);
}

export function $loopContinue(label?: string): never {
  throw new NudoLoopSignal("continue", label || undefined);
}

/** 无标签信号匹配任何循环；带标签信号仅匹配同名循环 */
export function loopSignalMatches(e: NudoLoopSignal, label: string | undefined): boolean {
  return e.label === undefined || e.label === label;
}

export function isNudoBreak(e: unknown, label?: string): e is NudoLoopSignal {
  return e instanceof NudoLoopSignal && e.kind === "break" && loopSignalMatches(e, label);
}

export function isNudoContinue(e: unknown, label?: string): e is NudoLoopSignal {
  return e instanceof NudoLoopSignal && e.kind === "continue" && loopSignalMatches(e, label);
}

/** 非循环 labeled block：判断 break 信号是否指向本标签（transpile 生成代码用） */
export function $isBreakTo(e: unknown, label: string): boolean {
  return e instanceof NudoLoopSignal && e.kind === "break" && e.label === label;
}

/** catch 转译辅助：控制流信号透传（生成代码只注入 `$` 前缀符号） */
export function $rethrowIfNudoReturn(e: unknown): void {
  if (isNudoReturn(e)) throw e;
}
