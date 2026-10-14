/**
 * async / await / generator / ??（$nullishTest / $removeNullish）。
 */
import type { Abs } from "../../abs.ts";
import { abs, bool, boolLit, confJoin, isNumPrim, litValue, numLit, strLit, unknown, never, type Confidence } from "../../abs.ts";
import { lit, termEquals } from "../../term.ts";
import type { Phi, Pred } from "../../pred.ts";
import { pTrue, and, implies, predEquals, type PrimName } from "../../pred.ts";
import { joinAbs, objOf, migrateNullProto, type ObjShape } from "../../objects.ts";
import { refineAbsForRelTrue } from "../../arithmetic.ts";
import { OBJECT_PROTO_METHOD_NAMES, migrateInvariants } from "../../builtins.ts";
import { accessorTable, migrateAccessors } from "../../accessors.ts";
import { leqAbs } from "../../leq.ts";
import { markFreshInstance } from "../../instance-id.ts";
import { absFunction, getFnImpl } from "../../abs-fn.ts";
import { isNullishLitAbs, definitelyNotNullishShape, typeofName } from "../../surface.ts";
import {
  NudoThrow, isNudoThrow, undef, litTruth, isDefinitelyTrue, isDefinitelyFalse,
  currentExecPhi, $lit, asAbsVal, $fnVal, noBody, writeInPlace, clearStaleTermPred,
  isNudoReturn, isNudoBreak, isNudoContinue,
} from "./state.ts";
import { pushMayThrowFrame, popMayThrowFrame, recordMayThrow, throwPayloadOf, type MayThrowEffect } from "../may-throw.ts";
import { registerGenElements, registerGenDeferred, registerGenDrain, genDrainViewOf, type GenDeferred } from "../match-iter.ts";
import { $unknown, $eq, $ne, $add, $typeof, $not, $lt, $le, $gt, $ge, $join } from "./ops.ts";
import {
  yieldStack, genPathSensitive, genJoinOverride, mergeArmYields,
  withIsolatedYields, runForkArm, type ForkArm, type GenYieldCollector,
  setGenJoinOverride, bumpGenPathSensitive,
  YIELD_TRY_FINALLY, YIELD_TRY_CATCH, YIELD_FINALLY_YIELDS, YIELD_FINALLY_RETURNS,
  YIELD_CATCH_YIELDS, YIELD_CATCH_RETHROWS, YIELD_DELEGATED_GEN,
} from "./control.ts";
import { beginCollectionFork, endCollectionFork, popCollectionArm, pushCollectionArm } from "../../collections.ts";
import { $arr, $yieldStarElems } from "./containers.ts";
import { loopExitsAls } from "./state.ts";

export function wrapPromiseAbs(inner: Abs): Abs {
  inner = asAbsVal(inner);
  // R2b：async 调用每次产出新 promise 对象——打新鲜实例标（=== 按
  // 创建事件折 false；别名传播复用同一 Abs 引用不受影响）
  return markFreshInstance(
    abs(
      { k: "eff", eff: "promise", inner },
      undefined,
      undefined,
      confJoin(inner.conf, "path"),
    ),
  );
}

/**
 * async 函数体包进 thunk，返回值经 wrapPromise。
 * 原生语义：async 函数体 throw 不同步抛出调用点——调用恒返回 promise，
 * 体抛错 ⇒ 确定拒绝（inner=never：fulfilled 臂不可能；rejected 通道携带
 * reason，Bug 36 口径——.catch/两参 then 的 onRejected 实参来源，handled
 * rejection 就地吸收；F2：此前 NudoThrow 直接穿透调用点，被 .catch 处理
 * 的拒绝也变成 caller throw）。宿主异常（引擎自身 bug）照抛。
 *
 * N5：体内任一 await 的 promise 带 unsettled 面（可能永不 settle）→ 函数
 * 结果 promise 同带 unsettled（原生：悬挂的 await 使整函数悬挂——下游
 * 不得折确定 settle / exact 值域声明）。
 */
let awaitUnsettledHit = false;

export function $async(thunk: () => Abs): Abs {
  const saved = awaitUnsettledHit;
  awaitUnsettledHit = false;
  try {
    const r = thunk();
    // async 体 return <promise>：原生递归采纳 thenable——体已折
    // eff("promise")（如 `return h()`）直接采纳（inner/拒绝通道随体），
    // 不得再包一层（假嵌套 promise<promise<…>>）
    if (r.shape.k === "eff" && r.shape.eff === "promise") {
      if (!awaitUnsettledHit) return r;
      const sh = r.shape as {
        k: "eff";
        eff: "promise";
        inner: Abs;
        rejected?: Abs;
        unsettled?: boolean;
      };
      if (sh.unsettled === true) return r;
      return markFreshInstance(
        abs(
          {
            k: "eff",
            eff: "promise",
            inner: sh.inner,
            ...(sh.rejected !== undefined ? { rejected: sh.rejected } : {}),
            unsettled: true,
          },
          undefined,
          undefined,
          r.conf,
        ),
      );
    }
    if (awaitUnsettledHit) {
      return markFreshInstance(
        abs({ k: "eff", eff: "promise", inner: r, unsettled: true }, undefined, undefined, confJoin(r.conf, "path")),
      );
    }
    return wrapPromiseAbs(r);
  } catch (e) {
    if (isNudoThrow(e)) {
      // R2b：确定拒绝的 promise 同为新鲜实例（每次调用新对象）；体内还有
      // 未 settle 的 await 路径 → 拒绝也不确定（悬挂面并存）
      return markFreshInstance(
        abs(
          {
            k: "eff",
            eff: "promise",
            inner: never,
            rejected: e.absValue,
            ...(awaitUnsettledHit ? { unsettled: true } : {}),
          },
          undefined,
          undefined,
          "path",
        ),
      );
    }
    throw e;
  } finally {
    awaitUnsettledHit = saved;
  }
}

/** await → 解包 eff("promise") */
export function $await(v: Abs): Abs {
  // 确定拒绝的 promise：await 在等待体内抛 reason（原生 reject → await
  // throw）。不解包 never（否则 `await h(); return x` 折假精确 resolved 值
  // ——原生整链拒绝）；try/catch 内由既有 catch 机制吸收。
  if (v.shape.k === "eff" && v.shape.eff === "promise") {
    const sh = v.shape as { inner: Abs; rejected?: Abs; unsettled?: boolean };
    if (sh.inner.shape.k === "never" && sh.rejected !== undefined) {
      // N5：拒绝路径 await throw，但悬挂路径原生不抛——面并入外层 async
      if (sh.unsettled === true) awaitUnsettledHit = true;
      throw new NudoThrow(sh.rejected);
    }
    // N5：值域保持 inner（产出时即该值），悬挂面记入外层 async 结果
    if (sh.unsettled === true) awaitUnsettledHit = true;
    return sh.inner;
  }
  return v;
}

/** async 直接 return 的 coerce */
export function $asyncReturn(v: Abs): Abs {
  if (v.shape.k === "eff") return v;
  return wrapPromiseAbs(v);
}

// --- 生成器 ---
// yieldStack / genPathSensitive / genJoinOverride 在文件前部（fork 隔离用）

/** GeneratorFunction 构造器 brand（g().constructor）——原生 name 是 "" */
let generatorCtorCache: Abs | undefined;
function generatorFunctionCtor(): Abs {
  if (!generatorCtorCache) {
    generatorCtorCache = abs(
      {
        k: "brand",
        name: "GeneratorFunction",
        shape: objOf({ name: { value: strLit("") } }),
        ctor: true,
      },
      undefined,
      undefined,
      "exact",
    );
  }
  return generatorCtorCache;
}

/** 生成器 next()/return() 结果：{value, done} 对象（Bug 22） */
function genIterResult(value: Abs, done: boolean): Abs {
  return abs(
    {
      k: "obj",
      slots: {
        value: { value },
        done: { value: boolLit(done) },
      },
    },
    undefined,
    undefined,
    "exact",
  );
}

/**
 * 生成器对象（Bug 22）：带迭代器协议面的对象 Abs——
 * - `next`/`return`/`throw` 方法槽（typeof → "function"），next 按调用序
 *   折 {value, done}（字面量 yield 序列首调用 → {value: y0, done: false}、
 *   耗尽 → {value: undefined, done: true}）；return(x) → {value: x, done:
 *   true}；throw(e) → 抛 e。
 * - `constructor` → GeneratorFunction brand（g().constructor.name → ""）。
 * - 数字下标槽（"0"…"n-1" = yield 值）+ @@iterator 槽 + 元素侧表——
 *   for-of / [...g()] / Array.from / yield* / 数组解构经既有迭代路径
 *   按序精确展开（迭代路径从侧表取出元素域，不回归）。
 *
 * Bug 53：`els` 是**类型面**元素列表（$arr >cap widen 后的单代表元素，
 * 形状槽/签名展示用）；`full` 是收集到的完整 yield 序列——next()/done
 * 与元素侧表按 full 推进，>8 yield 不再截断成单元素流。
 * Bug 54：`live` 是侧表消费视图（registerGenElements 注册），next() 推进
 * 时同步收缩；迭代消费（spread/for-of/…）经 registerGenDrain 排空——
 * 消费后生成器 done（native 迭代协议耗尽语义）。
 * Bug 52：`ctxs[i]` = 第 i 个 yield 点的 try 上下文位（YIELD_TRY_FINALLY /
 * YIELD_TRY_CATCH + finalizer 静态事实 YIELD_FINALLY_YIELDS/RETURNS + R1a
 * catch 静态事实 YIELD_CATCH_RETURNS/YIELDS/RETHROWS）。
 * eager 快照模型下无挂起帧可恢复：.return(v) 挂在 try/finally 内的 yield
 * 上时按 finalizer 事实分级——仅副作用 → v 精确透传；含 return → 值并
 * unknown（done 恒 true）；含 yield → 值并 unknown 且 done 并 boolean、
 * 续体不可判（poisoned）。.throw(e) 挂在 try/catch 内的 yield 上时被吸收
 * （catch 体收集期未执行、续体不可判）→ {value: unknown, done: boolean}
 * + may-throw（catch 可重抛），不再定值抛出；R1a：catch 事实 + 收集序列
 * 可判「吸收必完成」（catch 无 yield、重抛不被外层 catch 二次吸收、挂起点
 * 后无剩余 yield）时 done 折 true（值域保持 unknown）；无 finally/catch 的
 * 挂起点保持原生精确（.return(v) → v，.throw(e) → 抛 e）。poisoned 后 next()
 * 给 {value: unknown, done: boolean}。
 * R1b：exact = 收集序列是线性（非路径敏感）——drain 视图带 exact 位，
 * 消费端（spread/Array.from/解构 rest）重组数组时越 TUPLE_LITERAL_CAP
 * 出 exact 元组（形状面 widened 的 els 槽不受影响）。
 */
function makeGenObject(
  els: Abs[],
  conf: Confidence,
  retVal: Abs,
  deferred: GenDeferred | undefined,
  full: Abs[],
  ctxs: number[],
  exact = false,
): Abs {
  const state = { i: 0, done: false, poisoned: false };
  const live: Abs[] = [...full];
  const iterResultUnknown = (): Abs =>
    joinAbs(genIterResult(unknown, true), genIterResult(unknown, false));
  const next = $fnVal([], (): Abs => {
    // Bug 34：消费点重放——体内 soft may-throw 重记进当前帧（gate 面），
    // definite 载荷在 yield 前缀耗尽后抛（首个触达抛点的 next()）
    if (deferred && !state.done) {
      for (const e of deferred.soft) recordMayThrow(e);
    }
    // Bug 52：.return/.throw 后续体不可判——不再给出定值
    if (state.poisoned) return iterResultUnknown();
    if (state.done || state.i >= full.length) {
      if (!state.done) {
        state.done = true;
        if (deferred?.throw !== undefined) throw new NudoThrow(deferred.throw);
        // Bug 2：终末 return 值在首个 done:true 交付（此后 native 回 undefined）
        return genIterResult(retVal, true);
      }
      return genIterResult(undef(), true);
    }
    const v = full[state.i]!;
    state.i++;
    if (live.length > 0) live.shift();
    return genIterResult(v, false);
  });
  // Bug 52：挂起点 = 最近一次 next() 交付的 yield（未启动/已耗尽 → 无挂起）
  const suspendedCtx = (): number =>
    state.i > 0 && !state.done && !state.poisoned ? (ctxs[state.i - 1] ?? 0) : 0;
  const ret = $fnVal([], (...args: Abs[]): Abs => {
    const v = args.length > 0 ? args[0]! : undef();
    const ctx = suspendedCtx();
    state.done = true;
    if (ctx & YIELD_TRY_FINALLY) {
      if (ctx & YIELD_FINALLY_YIELDS) {
        // finally 可再交付（yield）或覆盖（return）→ 值并 unknown、
        // done 并 boolean；续体不可判（poisoned）
        state.poisoned = true;
        return joinAbs(genIterResult(v, true), genIterResult(unknown, false));
      }
      if (ctx & YIELD_FINALLY_RETURNS) {
        // finally 无 yield：完成路径必 done:true；return 可覆盖注入值 →
        // 值并 unknown。后续 next() → {undefined, true}（native 完成语义）
        return joinAbs(genIterResult(v, true), genIterResult(unknown, true));
      }
      // finally 仅副作用（eager 收集期已执行）→ 注入值精确透传（native）
    }
    return genIterResult(v, true);
  });
  const thr = $fnVal([], (...args: Abs[]): Abs => {
    const e = args.length > 0 ? args[0]! : undef();
    const ctx = suspendedCtx();
    state.done = true;
    if (ctx & YIELD_TRY_CATCH) {
      // 注入异常被 catch 吸收——catch 体在 eager 收集期未执行（无注入源）。
      // catch 重抛面恒记 may-throw（不给出定值抛出）。
      recordMayThrow({
        kind: "Error",
        cause: "generator .throw() into try/catch — unexecuted catch body may rethrow",
      });
      // R1a：catch 静态事实（transpile 标注位）+ 收集序列分类吸收结局——
      // catch 体不含 yield 且可能重抛只进无 catch 外层（64 未置）、挂起点
      // 后无剩余已收集 yield（线性序列尾）、非 yield* 委托进生成器对象
      //（128：.throw 转发进内层，内层 catch 吸收后续体不可分类）⇒ 吸收必
      // 完成生成器（catch return / fallthrough 跑到体末 / 重抛→may-throw
      // 已记）：done 折 true；值域保持 unknown（catch 体未执行，return
      // 表达式不可判）。其余（catch 含 yield 可再交付 / 重抛可被外层 catch
      // 二次吸收 / 挂起点后还有 yield 会续体 / 生成器委托）→ 布尔域 + poisoned。
      const catchYields = (ctx & YIELD_CATCH_YIELDS) !== 0;
      const rethrowsIntoCatch = (ctx & YIELD_CATCH_RETHROWS) !== 0;
      const delegatedGen = (ctx & YIELD_DELEGATED_GEN) !== 0;
      const remaining = full.length - state.i;
      if (!catchYields && !rethrowsIntoCatch && !delegatedGen && remaining <= 0) {
        return genIterResult(unknown, true);
      }
      state.poisoned = true;
      return iterResultUnknown();
    }
    throw new NudoThrow(e);
  });
  const slots: Record<string, { value: Abs }> = {
    next: { value: next },
    return: { value: ret },
    throw: { value: thr },
    constructor: { value: generatorFunctionCtor() },
    "@@iterator": { value: absFunction([], { body: noBody }, { ctor: false }) },
  };
  for (let i = 0; i < els.length; i++) {
    slots[String(i)] = { value: els[i]! };
  }
  const g = abs({ k: "obj", slots }, undefined, undefined, conf);
  registerGenElements(g, live);
  registerGenDrain(g, {
    drain: (): Abs[] => {
      const remaining = [...live];
      live.length = 0;
      state.i = full.length;
      state.done = true;
      return remaining;
    },
    peek: (i: number): Abs | undefined => (i < live.length ? live[i] : undef()),
    peekAll: (): Abs[] => [...live],
    exact,
  });
  if (deferred) registerGenDeferred(g, deferred);
  // R2b：每次 gen() 调用产出新生成器对象——打新鲜实例标
  return markFreshInstance(g);
}

/** function* 体：收集所有 yield 值；返回带迭代器协议面的生成器对象 Abs；
 *  抽象分支时降 conf（P0-6）
 *
 * Bug 58：调用生成器是原生全操作——体只在首个 next() 执行。body() eager
 * 执行的体内效果（成员读 may-throw / 显式 throw）不折进**调用方** throws
 * 域——以捕获式 may-throw 帧包裹：soft 效果与 NudoThrow 挂生成器对象
 * （Bug 34 延迟重放：首个触达抛点的 next()/迭代消费，仅构造不消费不
 * 表面）。yield 收集保持 eager（既有值域建模，注释口径不变）。
 * Bug 2：thunk 返回值 = 终末 return 值——不再丢弃，经 makeGenObject 在
 * 首个 done:true 作为 value 交付（node 实测：此后 next 回 undefined）。
 * Bug 22：结果从 yield 元组数组改为生成器对象（next/return/throw 方法面 +
 * constructor 身份）；元素域经侧表保留（$arr 的 ≤cap tuple / >cap arr
 * widen 策略不变），迭代路径（for-of/spread/Array.from）继续工作。
 * Bug 53：侧表/next() 消费完整收集序列（ys.els）——$arr >cap widen 只影响
 * 形状槽（类型面），不再把 >8 yield 截断成单元素流。
 * Bug 52：yield 点 try 上下文（ys.ctxs，$yield 第二实参）随序列传递——
 * .return()/.throw() 挂起点语义见 makeGenObject。 */
export function $gen(body: () => Abs): Abs {
  const ys: GenYieldCollector = { els: [], ctxs: [] };
  const marker = genPathSensitive;
  const prevOverride = genJoinOverride;
  setGenJoinOverride(null);
  yieldStack.push(ys);
  pushMayThrowFrame();
  let retVal: Abs | undefined;
  let thrown: Abs | undefined;
  let soft: MayThrowEffect[] = [];
  let controlToken: unknown;
  try {
    // Bug 2：终末 return 值（transpile 侧 withImplicitReturn 保证有返回）
    retVal = asAbsVal(body());
  } catch (e) {
    // 控制流 token（fork/循环返回）不是迭代期异常——不得吞
    if (isNudoReturn(e) || isNudoBreak(e) || isNudoContinue(e)) controlToken = e;
    // Bug 34：体内异常不再静默吞掉——延迟到消费点重放（见 makeGenObject）
    else thrown = throwPayloadOf(e);
  } finally {
    // token 再抛路径保持丢弃式（旧行为）；正常/延迟异常路径保留帧内
    // soft 效果挂生成器对象（gate 面：消费点重记，见 registerGenDeferred）
    soft = popMayThrowFrame(controlToken !== undefined);
    yieldStack.pop();
    if (controlToken !== undefined) throw controlToken;
  }
  const ret: Abs = retVal ?? undef();
  const deferred: GenDeferred | undefined =
    thrown === undefined && soft.length === 0 ? undefined : { throw: thrown, soft };
  // Bug 53：完整收集序列是 next()/侧表的权威数据；$arr(ys.els) 只产形状/conf
  // （>cap widen 成 arr 是类型面合法过近似，不再吞掉元素序列）。
  // Bug 52：fork join / 路径敏感后索引与臂对位不可信——全序列过近似：
  // 任一臂出现过的 try 位并入每个 yield 点（保守，不做定值）。
  const joined = genJoinOverride;
  const pathSensitive = joined !== null || genPathSensitive > marker;
  let ctxs = ys.ctxs;
  if (pathSensitive && ys.ctxs.length > 0) {
    const mask = ys.ctxs.reduce((a, b) => a | b, 0);
    if (mask !== 0) ctxs = ys.els.map(() => mask);
  }
  if (joined) {
    setGenJoinOverride(prevOverride);
    const js = joined.shape;
    const els =
      js.k === "tuple" ? [...js.elements] : js.k === "arr" ? [js.element] : [unknown];
    return makeGenObject(
      els,
      joined.conf === "exact" ? ("path" as Confidence) : joined.conf,
      ret,
      deferred,
      ys.els,
      ctxs,
      false,
    );
  }
  setGenJoinOverride(prevOverride);
  const arr = $arr(ys.els);
  const as = arr.shape;
  const els = as.k === "tuple" ? [...as.elements] : as.k === "arr" ? [as.element] : [unknown];
  if (genPathSensitive > marker) {
    return makeGenObject(
      els,
      arr.conf === "exact" ? ("path" as Confidence) : arr.conf,
      ret,
      deferred,
      ys.els,
      ctxs,
      false,
    );
  }
  // R1b：线性收集（非路径敏感）→ drain 视图 exact：消费端重组数组可越过
  // TUPLE_LITERAL_CAP 出 exact 元组（路径敏感拼接序列不可，退 widened arr）
  return makeGenObject(els, arr.conf, ret, deferred, ys.els, ctxs, true);
}

/** yield v：压入当前生成器收集器；表达式值用 unknown。
 *  tryCtx（Bug 52）= transpile 静态标注的 yield 点 try 上下文位
 *  （YIELD_TRY_FINALLY / YIELD_TRY_CATCH），.return()/.throw() 挂起点
 *  语义用（见 makeGenObject）。 */
export function $yield(v: Abs, tryCtx = 0): Abs {
  const top = yieldStack[yieldStack.length - 1];
  if (top) {
    top.els.push(v);
    top.ctxs.push(tryCtx);
  }
  return unknown;
}

/** yield* v（Bug 82）：委托迭代 ≠ yield v——GetIterator 校验先行（$elems
 *  同分类器：非可迭代接收者 definite/may TypeError，生成器体内按 $gen
 *  迭代期语义由外层帧吸收），**元素**逐个压入收集器（此前把整个可迭代值
 *  压一次）；表达式值 = 内层迭代器的 return 值（生成器 return / 自定义
 *  iterator 的 done 值，不可判）→ 保守 unknown。长度不可判的接收者
 *  （arr/any/…）单代表元素过近似并入 + bumpGenPathSensitive 压 conf
 *  （mergeArmYields 同口径，禁 exact 元组出货）。 */
export function $yieldStar(v: unknown, tryCtx = 0): Abs {
  const a = asAbsVal(v);
  const { els, lengthKnown } = $yieldStarElems(a);
  const top = yieldStack[yieldStack.length - 1];
  if (top) {
    top.els.push(...els);
    // R1a：委托进生成器对象的 yield 点标 YIELD_DELEGATED_GEN——.throw()
    // 原生转发进内层迭代器，内层 catch 吸收后续体（可再交付）外层不可
    // 分类 → makeGenObject 吸收结局不折 done（数组等无 throw() 内层回注
    // 外层帧，可折，不标）
    const ctx = tryCtx | (genDrainViewOf(a) !== undefined ? YIELD_DELEGATED_GEN : 0);
    for (let i = 0; i < els.length; i++) top.ctxs.push(ctx);
    if (!lengthKnown) bumpGenPathSensitive();
  }
  return unknown;
}

/**
 * `??` 非 nullish 臂：从左值 Abs 剥离 nullish 部分（$nullishTest 判 true
 * 的成员）。索引访问 `M[k]` 对抽象键产出 joinAbs(element, undef())，
 * 左值 sum 保留 undefined 臂；`l ?? fallback` 的 alt（非 nullish 路径）
 * 必须只取左值的非 nullish 部分——否则 false-positive `nullish return arm`
 * （issue #90）、`for (const x of o.items ?? [])` 假 may-throw。
 */
export function $removeNullish(a: Abs): Abs {
  // 裸宿主值（非 Abs）：原样透传——调用边界（$fork 臂）经 asAbsVal 收拢，
  // 提前折 unknown 是无谓退化（与 $fork 对缺参/宿主裸值的口径一致）
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return a;
  if (definitelyNotNullishShape(a.shape)) return a;
  if (isNullishLitAbs(a)) return a;
  if (a.shape.k === "sum") {
    const members = (a.shape as { members: Abs[] }).members;
    const kept = members.filter((m) => !isNullishLitAbs(m));
    if (kept.length === members.length) return a;
    if (kept.length === 0) return a;
    return kept.length === 1 ? kept[0]! : { ...a, shape: { k: "sum" as const, members: kept } };
  }
  return a;
}

/** 守卫剪除粒度（Bug 3）：null/undefined 成员各自的字面量判定 */
function isNullLitAbs(a: Abs): boolean {
  return a.term?.op === "lit" && a.term.value === null;
}
function isUndefLitAbs(a: Abs): boolean {
  return a.term?.op === "lit" && a.term.value === undefined;
}

/**
 * 严格 `p === null` 守卫的假值臂剪影：只剥 null 成员（Bug 3 粒度——
 * `null === undefined` 为 false，假值臂的 p **仍可能是 undefined**，
 * 不得连 undefined 一起剪，否则 `p.major` 漏报真实 TypeError）。
 */
export function $removeNull(a: Abs): Abs {
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return a;
  if (isNullLitAbs(a)) return a;
  if (a.shape.k === "sum") {
    const members = (a.shape as { members: Abs[] }).members;
    const kept = members.filter((m) => !isNullLitAbs(m));
    if (kept.length === members.length) return a;
    if (kept.length === 0) return a;
    return kept.length === 1 ? kept[0]! : { ...a, shape: { k: "sum" as const, members: kept } };
  }
  return a;
}

/**
 * `typeof u === "undefined"` / 严格 `u === undefined` 守卫的假值臂剪影：
 * 只剥 undefined 成员（`typeof null === "object"`——假值臂的 u 仍可能是
 * null，`u.v` 对 null 仍原生抛 TypeError，不得剪）。
 */
export function $removeUndefined(a: Abs): Abs {
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return a;
  if (isUndefLitAbs(a)) return a;
  if (a.shape.k === "sum") {
    const members = (a.shape as { members: Abs[] }).members;
    const kept = members.filter((m) => !isUndefLitAbs(m));
    if (kept.length === members.length) return a;
    if (kept.length === 0) return a;
    return kept.length === 1 ? kept[0]! : { ...a, shape: { k: "sum" as const, members: kept } };
  }
  return a;
}

/**
 * 成员真值守卫臂剪影（issue #118 / #129）：`if (o.p)` 真值臂 / `if (!o.p)`
 * 假值臂 / `o?.p` 真值守卫里，槽 p 的值必为真值 ⇒ 非 nullish 且槽必在场——
 * 重建 obj slots：槽值过与 $removeNullish 同款成员剥离，并摘除 optional
 * 标记（真值 ⇒ 在场；$get 的 join(value, undef) 随之消失）。槽值剥空（纯
 * nullish）→ 保守原样（臂不可达近似，与 $removeNullish 空集口径一致）；
 * 键缺席 / 非 obj / 裸宿主值 → 透传（同 $removeNullish 契约）。真值 ⇒ 非
 * nullish 是 sound 下界：0/''/false 等 falsy-but-not-nullish 成员保留。
 *
 * sum 容器（issue #129）：判别窄化后参数常为多臂 union——守卫事实按成员
 * 分发：key 槽确定 nullish 的成员（闭 shape 槽缺席且缺席读确定 undefined
 * ——open/index/proto 方法名/getter 均不在场；或槽值整体 nullish）在真值
 * 守卫下必走早退 → 剪除；其余成员按 obj 分支同款重建（重建迁移
 * accessor/propFlags/nullProto 侧表）。open/index 缺席（读 unknown 不可
 * 判）/ proto 方法名与 constructor 缺席（原型链读出函数）/ getter-only
 * 缺席（读 getter 结果）/ any / unknown 槽值 / 非对象成员不可判保留（宁
 * 缺毋假，与 $get 缺席读同口径）。全剪空 → 原样；单成员剪余塌缩（与
 * $narrowMemberEq 同口径）。
 */
export function $removeMemberNullish(a: Abs, key: string): Abs {
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return a;
  if (a.shape.k === "sum") {
    const members = (a.shape as { members: Abs[] }).members;
    const kept: Abs[] = [];
    let changed = false;
    for (const m of members) {
      const r = memberSlotTruthyRefine(m, key);
      if (r.kind === "prune") {
        changed = true;
        continue;
      }
      if (r.kind === "keep") {
        kept.push(m);
        continue;
      }
      changed = true;
      const sh = m.shape as ObjShape;
      const next: Abs = { ...m, shape: { ...sh, slots: { ...sh.slots, [key]: r.slot } } };
      // 重建产生新 Abs 身份 → 迁移侧表（getter / propFlags / nullProto），
      // 否则守卫后对同对象其它键的 getter 读退化为缺席槽 undefined（$set 同口径）
      migrateAccessors(m, next);
      migrateInvariants(m, next);
      migrateNullProto(m, next);
      kept.push(next);
    }
    if (!changed || kept.length === 0) return a;
    return kept.length === 1 ? kept[0]! : { ...a, shape: { k: "sum" as const, members: kept } };
  }
  if (a.shape.k !== "obj") return a;
  const slots = (a.shape as ObjShape).slots;
  if (!Object.prototype.hasOwnProperty.call(slots, key)) return a;
  const r = memberSlotTruthyRefine(a, key);
  // 纯 nullish 槽在单 obj 上无「臂不可达」可表 → 保守原样（与 #118 口径一致）
  if (r.kind !== "refine") return a;
  const next: Abs = { ...a, shape: { ...a.shape, slots: { ...slots, [key]: r.slot } } };
  migrateAccessors(a, next);
  migrateInvariants(a, next);
  migrateNullProto(a, next);
  return next;
}

/** 槽值整体确定 nullish（nullish lit / 全 nullish-lit 成员的 sum） */
function definitelyNullishAbs(a: Abs): boolean {
  if (isNullishLitAbs(a)) return true;
  if (a.shape.k === "sum") {
    const members = (a.shape as { members: Abs[] }).members;
    return members.length > 0 && members.every((m) => isNullishLitAbs(m));
  }
  return false;
}

/** 单成员 key 槽真值守卫分类（issue #129）：
 * - prune：剪除该成员——闭 shape 槽缺席且缺席读确定 undefined（无
 *   open/index/proto 方法名/getter——与 $get 容器读同口径）或槽值整体
 *   确定 nullish 且该键无 getter（占位槽 undefined-lit 不可信，读走
 *   getter）；真值守卫下必 falsy，成员在守卫臂内不可达；
 * - refine：重建该成员的槽——槽值剥 nullish 成员 + 摘 optional 标记
 *   （$get 的 join(value, undef) 消失）；
 * - keep：原样——缺席但缺席读不可判（open/index 读 unknown、proto 方法
 *   名/constructor 原型链读出函数）、键上有 getter（读 getter 结果，真值
 *   性不可判；setter-only 原生读 undefined 除外）/ 槽值非 nullish 且无
 *   optional / 非 obj 成员（保守，与 memberEqClass 的 may 同口径）。
 */
type MemberSlotRefine =
  | { kind: "prune" }
  | { kind: "keep" }
  | { kind: "refine"; slot: { value: Abs; readonly?: boolean } };

function memberSlotTruthyRefine(m: Abs, key: string): MemberSlotRefine {
  if (m.shape.k !== "obj") return { kind: "keep" };
  const slots = (m.shape as ObjShape).slots;
  if (!Object.prototype.hasOwnProperty.call(slots, key)) {
    // 缺席槽 ≠ 读 undefined（与 $get 的 obj 缺席分支同口径，containers.ts）：
    // open/index 签名（读 unknown 不可判）、Object.prototype 方法名与
    // constructor（原型链读出函数，真值守卫必过）、accessorTable getter
    //（读 getter 结果，真值性不可判）→ 保守保留；其余闭缺席 → undefined
    const sh = m.shape as ObjShape;
    if (sh.open || sh.index) return { kind: "keep" };
    if (OBJECT_PROTO_METHOD_NAMES.has(key) || key === "constructor") return { kind: "keep" };
    if (accessorTable.get(m)?.has(key)) return { kind: "keep" };
    return { kind: "prune" };
  }
  // getter 在场：读走 getter 而非数据槽（字面量/defineProperty 的占位槽值
  // 是 undefined-lit，不可信）——真值性不可判 → 保留；setter-only 原生读
  // undefined（与占位口径一致）→ 照常按槽值分类
  if (accessorTable.get(m)?.get(key)?.get) return { kind: "keep" };
  const slot = slots[key]!;
  if (definitelyNullishAbs(slot.value)) return { kind: "prune" };
  let value = slot.value;
  if (!definitelyNotNullishShape(value.shape) && value.shape.k === "sum") {
    const members = (value.shape as { members: Abs[] }).members;
    const kept = members.filter((x) => !isNullishLitAbs(x));
    if (kept.length > 0 && kept.length < members.length) {
      value = kept.length === 1 ? kept[0]! : { ...value, shape: { k: "sum" as const, members: kept } };
    }
  }
  if (value === slot.value && !slot.optional) return { kind: "keep" };
  const next: { value: Abs; optional?: boolean; readonly?: boolean } = { ...slot, value };
  delete next.optional;
  return { kind: "refine", slot: next };
}

/** 成员 → JS typeof 名；any/unknown（无 nullish lit term）不可判 → undefined */
function typeofOfMember(m: Abs): string | undefined {
  const t = m.term;
  if (t?.op === "lit") {
    if (t.value === null) return "object";
    if (t.value === undefined) return "undefined";
  }
  const n = typeofName(m.shape);
  return n === "unknown" ? undefined : n;
}

/**
 * typeof 类型守卫臂剪影（Bug 23）：`typeof v === "string"` 真臂把 v 重绑为
 * union 中 typeof 匹配的成员（keep=true）/ 假臂绑补集（keep=false）——臂内
 * `+`/关系/迭代/模板串拿到成员类型而非 union，不再记假 may-throw。
 * 裸 any 在事实臂窄化为对应 prim（issue #105）；sum 内不可判成员
 * （any/unknown）两侧都保留（保守，不引假阴性）；全剪空 →
 * 原样返回（臂不可达的保守近似，与 $removeNullish 空集口径一致）。
 */
export function $narrowTypeOf(a: Abs, typeOf: string, keep: boolean): Abs {
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return a;
  if (a.shape.k !== "sum") {
    // 单形态：判定的 typeof 与守卫一致（或补集臂判不一致但值本就单一）
    // 无可剪；不一致属臂不可达，原样返回（保守）。
    // issue #105：裸 any（无约束入口参数）在事实臂（keep=true）可健全窄化为
    // 对应 prim——typeof v === "string" 的真臂里 v 必是 string，exec/test
    // 等 ToString 强转面不再记假 may-throw。补集臂（keep=false）不可表示
    // （"非 string" 覆盖其余全域），保留 any；object/function/undefined 无
    // 单一 Abs 可表（null/数组/函数各有形态），同样保留；unknown 是引擎
    // fail-closed 令牌，窄化会凭空捏造信息，原样返回。
    if (keep && a.shape.k === "any") {
      const p = primShapeOfTypeOf(typeOf);
      if (p) return abs(p, a.term, a.pred, a.conf);
    }
    return a;
  }
  const members = (a.shape as { members: Abs[] }).members;
  const kept = members.filter((m) => {
    const t = typeofOfMember(m);
    if (t === undefined) return true;
    return keep ? t === typeOf : t !== typeOf;
  });
  if (kept.length === members.length) return a;
  if (kept.length === 0) return a;
  return kept.length === 1 ? kept[0]! : { ...a, shape: { k: "sum" as const, members: kept } };
}

/**
 * 关系守卫臂剪影（Bug 1）：`x >= 0` 真臂把 x 重绑为带 ge(x,0) 界的 Abs
 * ——守卫建立的隐含约束随**普通变量读取**进入返回值 / 签名面。此前只有
 * 算术折叠消费 exec Φ（`x + 0` 携带界），裸 `return x` 丢守卫事实 →
 * return-constraint gate 假阳（可证合规的函数过不了 CI）。只做事实臂：
 * ¬(x≥0) 含 NaN 可能（NaN 与任何比较皆假），补集界不可健全表示。精确
 * 字面量（lit term）的界由域隶属折叠，不加 pred 保持精确面干净。
 * 只精化 number prim：any 的真臂还含 bigint（`10n >= 0` 为真）与
 * ToPrimitive 对象面，refineAbsForRelTrue 的 number|string 并集会
 * 凭空排除 bigint → 假证明；any/unknown 保持原样（宁缺毋假）。
 */
export function $refineRel(a: Abs, op: "gt" | "ge" | "lt" | "le", k: number): Abs {
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return a;
  if (a.term?.op === "lit" || !isNumPrim(a) || !a.term) return a;
  return refineAbsForRelTrue(a, op, k);
}

/**
 * 判别联合成员分类（issue #126）：成员 m 在「m.key === lit」事实下可判定的
 * 匹配性。三态：
 * - "only"：槽值域恰为该字面量（pred ⊢ eq(t, lit)）——事实假臂可剪；
 * - "never"：槽值域排除该字面量（pred ⊢ ne(t, lit) / eq(t, litV≠lit) /
 *   形态不容 / 槽缺席（宽容读 undefined ≠ lit））——事实臂可剪；
 * - "may"：不可判（any/unknown 令牌、typeof-only 域、or 域…）——双侧保守保留。
 * 非对象成员：lit term（含 nullish 字面量）上自定义键读出 undefined（nullish
 * 读抛——测试自身记账）→ "never"；其余（prim/tuple/arr/fn/brand/eff 与无
 * lit term 的 unknown）保守 "may"。
 */
type MemberEqClass = "only" | "may" | "never";

/** 同 prim 字面量互斥判定：eq(t, V) 事实下 t === L 为假 ⟺ V ≢ L（NaN ≠ NaN 恒假，同为 never） */
function litRefutesEq(other: unknown, v: string | number | boolean): boolean {
  return other !== v;
}

/** 剥 term/pred 的纯 shape Abs（形态赋值检查口径） */
const shapeOnly = (s: Abs["shape"]): Abs => abs(s, undefined, undefined, "exact");

function memberEqClass(m: Abs, key: string, litAbs: Abs, value: string | number | boolean): MemberEqClass {
  const sh = m.shape;
  if (sh.k === "obj") {
    const slots = (sh as ObjShape).slots;
    if (!Object.prototype.hasOwnProperty.call(slots, key)) {
      // 缺席槽宽容读出 undefined ≠ lit；open 形态缺席键读 unknown → 不可判
      return (sh as ObjShape).open ? "may" : "never";
    }
    const slotValue = slots[key]!.value;
    if (slotValue.shape.k === "any" || slotValue.shape.k === "unknown") return "may";
    if (!leqAbs(shapeOnly(litAbs.shape), shapeOnly(slotValue.shape)).ok) return "never";
    const t = slotValue.term;
    const p = slotValue.pred;
    if (!t || !p || p.op === "true") return "may";
    const litTerm = lit(value);
    if (implies(p, { op: "eq", a: t, b: litTerm })) return "only";
    if (implies(p, { op: "ne", a: t, b: litTerm })) return "never";
    // implies 的字符串/布尔 diseq 盲区：eq(t, litV) 合取事实逐字面量排除
    //（eq(t,'Identifier') ⊢ ne(t,'TemplateLiteral')——跨 prim 亦排除）
    const conjuncts: Pred[] = [];
    const visit = (c: Pred): void => {
      if (c.op === "and") {
        c.args.forEach(visit);
        return;
      }
      conjuncts.push(c);
    };
    visit(p);
    for (const c of conjuncts) {
      if (c.op !== "eq") continue;
      const other =
        termEquals(c.a, t) && c.b.op === "lit" ? c.b.value :
        termEquals(c.b, t) && c.a.op === "lit" ? c.a.value :
        undefined;
      if (other !== undefined && litRefutesEq(other, value)) return "never";
    }
    return "may";
  }
  if (m.term?.op === "lit") return "never";
  return "may";
}

/**
 * 判别等值守卫臂剪影（issue #126）：`x.key === lit` 事实臂（keep=true）内把
 * x 重绑为「key 值域可能等于 lit」的成员子集（剪 "never" 成员）；对偶补集臂
 * （keep=false）剪 "only" 成员。单形态无可剪原样返回；全剪空 → 原样返回
 * （臂不可达的保守近似，与 $removeNullish / $narrowTypeOf 同口径）；
 * 单成员剪余直接返回该成员。
 */
export function $narrowMemberEq(
  a: Abs,
  key: string,
  value: string | number | boolean,
  keep: boolean,
): Abs {
  if (!a || typeof a !== "object" || !("shape" in (a as object))) return a;
  if (a.shape.k !== "sum") return a;
  const litAbs =
    typeof value === "string" ? strLit(value) :
    typeof value === "number" ? numLit(value) :
    boolLit(value);
  const members = (a.shape as { members: Abs[] }).members;
  const kept = members.filter((m) => {
    const c = memberEqClass(m, key, litAbs, value);
    return keep ? c !== "never" : c !== "only";
  });
  if (kept.length === members.length) return a;
  if (kept.length === 0) return a;
  if (keep) {
    // keep 臂内 `x.key === lit` 事实成立 → 存活成员的兼容槽值挂
    // eq(term, lit) 谓词（lit 在 term/pred 层，shape 保持同型）：
    // formatShape(showLits) 经 litPredValue 渲染 lit(...)（尾臂判别窄化
    // 可见于展示），memberEqClass 升级 only（链式窄化 / 补集臂剪除
    // 受益）。既有谓词合取保留；无 term 的纯声明槽直接落 lit term。
    // any/unknown 槽不收窄（unknown 是推断失败标记 / any 即「无信息」）；
    // keep=false 补集臂无字面量可落（string \ lit 不可表示）。
    const refined = kept.map((m) => {
      const sh = m.shape;
      if (sh.k !== "obj") return m;
      const slots = (sh as ObjShape).slots;
      const slot = slots[key];
      if (!slot) return m;
      const v = slot.value;
      if (v.shape.k === "any" || v.shape.k === "unknown") return m;
      if (!leqAbs(shapeOnly(litAbs.shape), shapeOnly(v.shape)).ok) return m;
      const litTerm = lit(value);
      const value2: Abs =
        v.term !== undefined
          ? { ...v, pred: and(v.pred ?? pTrue, { op: "eq", a: v.term, b: litTerm }) }
          : { ...v, term: litTerm, pred: pTrue };
      return {
        ...m,
        shape: { ...sh, slots: { ...slots, [key]: { ...slot, value: value2 } } },
      } as Abs;
    });
    return refined.length === 1 ? refined[0]! : { ...a, shape: { k: "sum" as const, members: refined } };
  }
  return kept.length === 1 ? kept[0]! : { ...a, shape: { k: "sum" as const, members: kept } };
}

/** typeof 结果 → 可健全表示的 prim shape（string/number/boolean/bigint/symbol） */
function primShapeOfTypeOf(typeOf: string): { k: "prim"; type: PrimName } | undefined {
  switch (typeOf) {
    case "string":
    case "number":
    case "boolean":
    case "bigint":
    case "symbol":
      return { k: "prim", type: typeOf };
    default:
      return undefined;
  }
}

/** `??` / `??=` 测试：确定非 nullish → false；lit nullish → true；否则抽象 boolean */
export function $nullishTest(v: Abs): Abs {
  if (definitelyNotNullishShape(v.shape)) return boolLit(false);
  if (isNullishLitAbs(v)) return boolLit(true);
  const t = v.term;
  if (t?.op === "lit" && t.value !== null && t.value !== undefined) return boolLit(false);
  return bool();
}
