/**
 * 调用 Abs 一等函数（absFunction impl）或 mock apply。
 * 供 求值引擎 import 绑定包装：`(...args) => $call(absFn, args)`。
 *
 * 统一顺序：apply → body → relation → isRelFn（委托 applyAbsFn）。
 * 行为对齐说明（与旧 $call 的差异，均属刻意）：
 * 1. 带 body 的函数也进 call-budget（递归会 truncated 而非爆栈）
 * 2. body 抛错与 apply 同径 rethrow（不吞成 never 返回，调用边界决定吸收）
 * 3. 无 impl 时 isRelFn 可走 E 路径（旧版恒 unknown）
 */

import type { Abs } from "../abs.ts";
import { abs, never as neverAbs, unknown } from "../abs.ts";
import {
  getFnImpl,
  absFunction,
  pureFnNameOf,
  isAbsApplyResult,
  makeAbsApplyResult,
  type AbsApplyResult,
} from "../abs-fn.ts";
import { compiledBodyOf } from "./body-fn.ts";
import { joinAbs } from "../objects.ts";
import { instantiateReturn, isRelFn, setApplyCallbackHost } from "../hof.ts";
import type { AstEnv } from "../ast-env.ts";
import { NudoThrow } from "./nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "./may-throw.ts";
import { isNullishLitAbs } from "../surface.ts";
import {
  adoptCallArgsToFaces,
  contractFacesOf,
  presentCallResultFace,
} from "../contract-face.ts";
import { pushThrowExit, peekThrowExitsSince, throwExitsMark, withNewTargetReset, undef, callAtFunctionBoundary } from "./runtime/state.ts";
import {
  callBudgetKey,
  enterCall,
  exitCall,
  truncatedAbs,
  stableCallId,
} from "../call-budget.ts";
import { refreshLiveImports } from "./live-imports.ts";
import { proxyPartsOf, proxyTrapOf } from "./match-iter.ts";
import { classNameOfValue } from "../class-mark.ts";
import { clearAllPureMemos, createPureMemo } from "./pure-memo.ts";

/** @nudo:pure 调用结果缓存（$call 路径实例；值基键见 pure-memo.ts） */
const pureMemo = createPureMemo();

/** 清空 pure memo（宿主入口 / 会话缓存失效；清**全部**实例——两条调用路径） */
export function clearPureMemo(): void {
  clearAllPureMemos();
}

/**
 * apply 返回的 throws 面 → 调用方控制流通道（H1 单点路由）。
 * always-throw（abs=never）→ NudoThrow，由调用边界收成 throws；
 * may-throw → pushThrowExit 记入调用方 throwExits（try/catch 可吸收）。
 */
export function routeApplyThrows(r: Abs, throws: Abs | undefined): Abs {
  if (throws && throws.shape.k !== "never") {
    if (r.shape.k === "never") throw new NudoThrow(throws);
    pushThrowExit(throws);
  }
  return r;
}

function normalizeApplyReturn(raw: Abs | AbsApplyResult): AbsApplyResult {
  return isAbsApplyResult(raw) ? raw : makeAbsApplyResult(raw, neverAbs);
}

/** 把 mark 之后的 throwExits 合成 throws 面（pure memo 捕获；$call / $callNamed 共用） */
export function joinThrowsSince(mark: number): Abs {
  const items = peekThrowExitsSince(mark);
  if (items.length === 0) return neverAbs;
  if (items.length === 1) return items[0]!;
  return items.reduce((a, b) => joinAbs(a, b));
}

export function $call(fn: Abs, args: Abs[], thisVal?: Abs): Abs {
  // Bug 79：普通函数调用面——调用期间 new.target 读 undefined（构造帧清空）
  // Bug ②：调用出口刷新 ESM live import 绑定——依赖模块状态的变异只能经
  // 函数调用发生（顶层求值先于 import 绑定），返回即重读依赖当前导出值。
  // refresh 闭包纯读不发起新调用（无重入）；注册表空时零开销。
  return withNewTargetReset(() => {
    try {
      return $callInner(fn, args, thisVal);
    } finally {
      refreshLiveImports();
    }
  });
}

function $callInner(fn: Abs, args: Abs[], thisVal?: Abs): Abs {
  // 函数 union：对每个 member 同序求值后 join（member 各自走面采用）
  if (fn?.shape?.k === "sum") {
    const results = fn.shape.members.map((m) => $call(m, args, thisVal));
    if (results.every((r) => r.shape.k === "unknown")) return unknown;
    return results.reduce((a, b) => joinAbs(a, b));
  }
  // #123 fix B：callee 声明契约 → 调用边界采用契约面。参数位仅替换无信息
  // 实参（any / 非 lit unknown），返回位按 presentCallResultFace 呈现。
  // 跨模块桥接 Abs fn（模块图注入）在此消费 checkSource 预挂的面。
  const faces = contractFacesOf(fn);
  const r = $callDispatch(fn, faces ? adoptCallArgsToFaces(args, faces) : args, thisVal);
  return faces ? presentCallResultFace(r, faces) : r;
}

/**
 * Bug 272：类值判定（被调者是「类」⇒ 不带 new 被调即抛 TypeError）。
 *
 * 判据（复用既有 facet，不新造机制）：
 * - brand 形：类值 brand 带 `ctor: true` facet（$class 声明 / 非空类表达式），
 *   且带 class-mark 类值身份标记（class-mark 是叶子模块，零依赖面）。
 *   排除「构造器 brand 但非类值」的情形（如 GeneratorFunction 构造器 brand
 *   ——原生可调、不抛）。
 * - fn 形：空类体类表达式走 $classExpr 快路径（fn 形状 + ctor facet +
 *   单一 rest 形参 "_rest"）。用户函数的形参面被转译成 argN / "...x"
 *   （rest 形参不进 params 或带 "..." 前缀）⇒ 不与该签名相撞。
 */
function isClassValueCallee(v: Abs): boolean {
  // 防御：被调者可能是非 Abs 值（宿主函数 / undefined 槽读出的值）。旧实现
  // 直接读 `v.shape.k` ⇒ 自身抛原生 TypeError（"Cannot read properties of
  // undefined (reading 'k')"），被求值回落层误记成用户代码的 `module-throw`
  // （引擎缺陷伪装成用户缺陷，差分语料的零回落闸门因此变红）。
  if (!v || typeof v !== "object" || !("shape" in (v as object))) return false;
  const s = (v as Abs).shape;
  if (!s || typeof s !== "object") return false;
  if (s.k === "brand") {
    return s.ctor === true && classNameOfValue(v as object) !== undefined;
  }
  if (s.k === "fn") {
    return (
      s.ctor === true &&
      Array.isArray(s.params) &&
      s.params.length === 1 &&
      s.params[0] === "_rest"
    );
  }
  return false;
}

/**
 * Bug 278：IsCallable 三档判定（true 可调用 / false 确定不可调用 /
 * undefined 不可判）——Proxy 的 [[Call]] 按**靶**的可调用性分流。
 *
 * - fn 形：函数值恒可调用（箭头 / 方法 / 构造器都有 [[Call]] 面）。
 * - brand 形：Proxy → 递归看靶（代理的可调用性随靶）；类值 brand（ctor
 *   facet）与内建构造器 brand（Object/Array/…，class-mark 标记）可调用；
 *   其余 brand（实例 / 原型对象）不可调用。
 * - prim / obj / arr / tuple / eff：确定不可调用。
 * - any / unknown / sum / never：不可判。
 */
function callableFacetOf(v: Abs | undefined): boolean | undefined {
  if (!v || typeof v !== "object" || !("shape" in v)) return false;
  const s = (v as Abs).shape;
  if (s.k === "fn") return true;
  if (s.k === "brand") {
    if (s.name === "Proxy") {
      const parts = proxyPartsOf(v as Abs);
      if (!parts) return undefined;
      return callableFacetOf(parts.target);
    }
    return s.ctor === true || classNameOfValue(v as object) !== undefined;
  }
  if (
    s.k === "prim" ||
    s.k === "obj" ||
    s.k === "arr" ||
    s.k === "tuple" ||
    s.k === "eff"
  ) {
    return false;
  }
  return undefined;
}

/**
 * Bug 278/279：Proxy 的 [[Call]]。
 *
 * 规范（ProxyCreate / Proxy [[Call]]）：代理**只在靶可调用时**才装 [[Call]]
 * 内部槽——靶不可调用时代理没有 [[Call]]，调用它定抛 TypeError（且**不派发**
 * apply 陷阱）；靶可调用时 [[Call]] 先取 handler 的 apply 陷阱（实参
 * (target, thisArg, args)），无陷阱才回退靶的 [[Call]]。
 *
 * 引擎此前两条路都没有：陷阱名并集里没有 apply（陷阱**从不派发**），
 * [[Call]] 也不回退靶 ⇒ 代理调用恒 unknown 且**声称永不抛**（L2 假绿）。
 */
function callProxyAbs(proxy: Abs, args: Abs[], thisVal: Abs | undefined): Abs {
  const parts = proxyPartsOf(proxy);
  if (!parts) {
    // 退化副本（侧表未随快照迁移）：靶不可知 ⇒ 不凭空造调用面（与 construct
    // 路径同口径：退化副本 → unknown）。
    return unknown;
  }
  const callable = callableFacetOf(parts.target);
  if (callable === false) {
    // 确定不可调用 ⇒ 原生 TypeError（代理没有 [[Call]] 面 ⇒ 陷阱也不派发）
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  if (callable === undefined) {
    // 不可判 ⇒ fail-closed：may-throw + 值域 unknown
    recordMayThrow({
      kind: "TypeError",
      cause: "Proxy call target may not be callable",
    });
    return unknown;
  }
  const trap = proxyTrapOf(parts.handler, "apply");
  if (trap.k === "fn") {
    // apply 陷阱实参：(target, thisArg, args)——thisArg 缺省 undefined
    // （strict this 语义）；args 是实参列表（tuple 面，与 construct 陷阱同口径）。
    const argsList = abs({ k: "tuple", elements: args }, undefined, undefined, "path");
    return $call(trap.fn, [parts.target, thisVal ?? undef(), argsList], parts.handler);
  }
  // dead：有槽不可调用 —— 原生 GetMethod 定抛 TypeError
  if (trap.k === "dead") throw new NudoThrow(errorTypeAbs("TypeError"));
  // opaque：handler 形态不可判（陷阱可能在）——诚实 unknown + may-throw
  if (trap.k === "opaque") {
    recordMayThrow({
      kind: "TypeError",
      cause: "Proxy apply trap may not be callable",
    });
    return unknown;
  }
  // absent：无 apply 陷阱 ⇒ 回退靶的 [[Call]]（thisArg 透传）
  return $call(parts.target, args, thisVal);
}

function $callDispatch(fn: Abs, args: Abs[], thisVal?: Abs): Abs {
  // Bug 46：bindThis impl 的 receiver 统一经 thisVal 通道注入（调用点
  // 正确，不再由调用方手工前插）：成员调用 $invoke 传接收者；直接调用 /
  // call/apply/bind 缺省 undefined（strict this 语义）。非 bindThis impl
  // 不改形——thisVal 经 apply 钩子进宿主 this（$rawThis 承接）。
  if (getFnImpl(fn)?.bindThis) {
    args = [thisVal ?? undef(), ...args];
    thisVal = undefined;
  }
  // @nudo:pure：同实参直接命中缓存（无副作用契约）。缓存 {abs, throws} 双面——
  // 只缓存 abs 会在命中时丢掉 throws 通道（may-throw 假「不抛」）。
  const pureName = pureFnNameOf(fn);
  const memoEntry = pureName ? pureMemo.keyOf(fn, args) : undefined;
  if (memoEntry) {
    const hit = pureMemo.get(memoEntry);
    if (hit !== undefined) return routeApplyThrows(hit.abs, hit.throws);
  }
  const impl = getFnImpl(fn);
  // Bug 272：类值（class 声明 / 类表达式）**不带 new** 被调 —— 原生定抛
  // TypeError（"Class constructor A cannot be invoked without 'new'"）。
  // 类值只有 [[Construct]] 面：被当普通函数调即抛。判据见 isClassValueCallee。
  if (isClassValueCallee(fn)) {
    throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // 关系面（relation/isRelFn）：无 body 无 apply → 实例化返回位
  if (!impl?.body && !impl?.apply) {
    if (impl?.relation || isRelFn(fn)) return instantiateReturn(fn, args);
    // 非函数 callee 的原生 TypeError 不得折成 unknown, throws=never（假「保证不抛」）。
    // prim（含 nullish 字面量）确定不可调用 → hard NudoThrow（tier 1，
    // 调用边界收成 throws）；any（无约束值）→ may-throw（tier 2）。
    // Bug 10：obj/arr/tuple 同入 tier 1 定抛——原生 IsCallable 对非函数
    // 恒 false（`({})()` / `[]()` 定抛 TypeError）；引擎内该三形 Abs 从不
    // 携带调用面（attachFnImpl 只产 fn 形状），「可能经桥接可调」论据空置。
    // Bug 278/279：Proxy brand 按**靶**的可调用性分流（[[Call]] 面）——
    // 靶不可调用 → 原生定抛；靶可调用 → apply 陷阱优先、无陷阱回退靶。
    const calleeAbs = fn && typeof fn === "object" ? (fn as Abs) : undefined;
    const calleeK = calleeAbs?.shape?.k;
    if (
      calleeAbs !== undefined &&
      calleeAbs.shape.k === "brand" &&
      calleeAbs.shape.name === "Proxy"
    ) {
      return callProxyAbs(calleeAbs, args, thisVal);
    }
    if (
      calleeK === "prim" ||
      calleeK === "obj" ||
      calleeK === "arr" ||
      calleeK === "tuple" ||
      (calleeAbs !== undefined && isNullishLitAbs(calleeAbs))
    ) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    if (calleeK === "any") {
      recordMayThrow({
        kind: "TypeError",
        cause: `call on ${calleeK} callee (not a function)`,
      });
    }
    // Bug 283：**`unknown` 档不记 may-throw**（原裁决已按 oracle 改判）。
    //
    // `unknown` 是引擎的 **fail-closed 令牌**，只说明「引擎不知道被调者」，
    // **不说明「它不是函数」** ⇒ 在这一档记 `TypeError` 是**对普通代码的假阳性**：
    // - 未解析的导入绑定（host 发射折成 unknown Abs）⇒ 原生是
    //   **模块装载错误**（不是调用点 TypeError）；
    // - 已解析但形状未知的导入绑定 ⇒ 是**精度债**（`nudo:opaque-result` 已诚实报出）。
    // 两条实测都会让 `nudo check` 对**合法代码**报 `nudo:entry-may-throw`（error 级）。
    //
    // 283 报告的症状（成员调用 `o.a.b()` 原生定抛却不被记）**已由成员读侧覆盖**：
    // 成员缺失 ⇒ 读侧产出 `nudo:entry-may-throw`（实测：`o.a.b()` 在 number 接收者上
    // ⇒ error 级 `may throw TypeError`）⇒ 不需要在本档额外记账。
    // ⇒ 「成员存在但接收者形态不对」（如 `o.toFixed()` 在 number 上）仍不报 ⇒ **独立遗留**
    // （成员调用面的记账缺口，落点在 `exec/class/invoke.ts`，不在本族）。
    if (calleeK === "unknown") {
      // 保持与 `any` 档不同：any 是「无约束值」（可能是非函数）⇒ 记 may；
      // unknown 是「引擎不知道」⇒ 不记（否则假阳性）。
    }
    return unknown;
  }
  // apply 钩子（mock withArgs / $fnVal / 桥接导出）：按实参派发。
  // 预算键用 fn 对象身份（anon#N 会把不同同元函数误判 cycle）。
  if (impl?.apply) {
    const key = callBudgetKey("absfn", impl.fingerprint ?? stableCallId(fn as object), args);
    const label = (fn.shape as { name?: string }).name ?? "anonymous";
    if (!enterCall(key, label)) return truncatedAbs();
    try {
      try {
        const full = normalizeApplyReturn(impl.apply(args, thisVal));
        if (memoEntry) pureMemo.set(memoEntry, full);
        // H1：throws 面经返回值通道统一路由（不再由各桥自行 re-throw / pushThrowExit）
        return routeApplyThrows(full.abs, full.throws);
      } catch (e) {
        if (e && typeof e === "object" && (e as { name?: string }).name === "NudoReturn") {
          return (e as { absValue: Abs }).absValue;
        }
        throw e;
      }
    } finally {
      exitCall();
    }
  }
  // body（无 apply）：编译执行；失败回落非 body 面。编译路径与 apply 同口径
  // 进预算（$invoke→$call 递归、回调 $call 递归不得裸奔栈溢出）。
  const compiled = compiledBodyOf(impl);
  if (compiled) {
    const key = callBudgetKey("absbody", impl.fingerprint ?? stableCallId(fn as object), args);
    const label = (fn.shape as { name?: string }).name ?? "anonymous";
    if (!enterCall(key, label)) return truncatedAbs();
    // body 抛错与 apply 路径对齐：NudoThrow 原样 rethrow，由调用边界
    // （callAtFunctionBoundary / callTranspiledExportFull / 用户 try/catch）
    // 决定吸收。此前吞成 pushThrowExit+return never，调用点 record 落成
    // never+never 被 isLeakedCallRecord 判「泄漏」丢弃，抛出 case 从 call@ 消失。
    try {
      // body may-throw 走 pushThrowExit 侧信道（runForkArm catch NudoThrow →
      // pushThrowExit）。缓存前捕获本帧新增 throws 面——命中时 routeApplyThrows
      // 重放（只缓存 abs 会在命中时假「不抛」）。
      const throwMark = throwExitsMark();
      // 编译体在函数边界执行：体内 $loopReturn 早退（if 臂/循环）经
      // NudoReturn 收成返回值、帧内 exits join、throwExits 转发——
      // 与 apply 路径（callAtFunctionBoundary 包裹）同口径。
      const r = callAtFunctionBoundary(() => compiled(args));
      // always-throw 在异常前不缓存；may-throw 捕获 throws 面入缓存。
      if (memoEntry) pureMemo.set(memoEntry, makeAbsApplyResult(r, joinThrowsSince(throwMark)));
      return r;
    } finally {
      exitCall();
    }
  }
  return unknown;
}

// 注册到 hof.applyCallbackAbs（数组回调解释宿主）：
// Abs 回调 → $call（编译/apply/关系面）；Identifier 节点（解释面残留）→
// env.vars/env.fns 解析后 $call；inline Node 解释面已删 → unknown（fail-closed）。
// thisVal（HOF thisArg，Bug 21）透传 $call 第三参——$fnVal 的 apply 钩子
// 把它注入宿主 this，回调体 $rawThis(this) 原样接到（与 call/apply/bind 同通道）。
setApplyCallbackHost((cb, args, env, _phi, _budget, thisVal) => {
  if (cb && typeof cb === "object" && "shape" in (cb as object)) {
    return $call(cb as Abs, args, thisVal);
  }
  const node = cb as { type?: string; name?: string } | null | undefined;
  if (node && node.type === "Identifier" && node.name) {
    const e = env as AstEnv | undefined;
    const bound = e?.vars?.get(node.name);
    if (bound) return $call(bound, args, thisVal);
    const f = e?.fns?.get(node.name);
    if (f) {
      return $call(
        absFunction(f.params, {
          body: f.body,
          async: f.async,
          env: e,
          // Bug 399：逐位「可省略」标记 ⇒ 必选元数不再靠名字后缀猜
          ...(f.optionalParams ? { optionalParams: f.optionalParams } : {}),
          // 源种类严格性（env 条目写入）⇒ body 编译单元与模块运行同口径
          ...(f.strict !== undefined ? { strict: f.strict } : {}),
        }),
        args,
        thisVal,
      );
    }
    return unknown;
  }
  return unknown;
});
