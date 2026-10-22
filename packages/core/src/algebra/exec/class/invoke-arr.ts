/**
 * 数组方法族模拟（invokeArrMethod）：map/filter/reduce/slice/join/at/…
 *
 * Invariants:
 * - 回调真执行仅限 effectFree facet；副作用回调多执行不可回滚 → 降级。
 * - 返回容器元素域 = 全部观测回调结果 join（不并入 OOB undefined，
 *   issue #156 元素域约定）；空数组 reduce 无初值 → 原生 TypeError。
 * - Bug 198：keys / values / entries（及 @@iterator 面）的迭代器是**接收者的
 *   live 视图**（原生 nextIndex 指针——每步按当前长度判结束、按当前内容
 *   取值）；接收者被 mutator 就地改写后，迭代可见（arrayLiveEntries）。
 * - Bug 198（S20）：live 迭代器**不登记静态元素侧表**——静态表是创建期拷贝
 *   （长度探针 sideIterLen 读它 ⇒ for-of 的轮数停在创建时刻）；元素面与长度
 *   由 live 消费视图（registerGenDrain）承担。
 */
import type { Abs } from "../../abs.ts";
import { abs, unknown, confJoin, litValue, bool, boolLit, numLit } from "../../abs.ts";
import { joinAbs, canonicalArrayIndex, getSlot } from "../../objects.ts";
import { fromIdxAbs } from "../../builtins.ts";
import { markDomainShared } from "../../len-sharing.ts";
import { $set, $lit, $arrMutContainer, callAtFunctionBoundary } from "../runtime.ts";
import { callHostGlobalFn } from "../calls.ts";
import { getFnImpl } from "../../abs-fn.ts";
import { collectionIteratorAbs, abstractSeqIteratorAbs } from "../../builtins.ts";
import { arrayJoinToString, arrayJoinWithSep, validateJoinElements } from "../../builtins/array.ts";
import { TUPLE_MATERIALIZE_CAP } from "../../containers.ts";
import {
  applyCallbackAbs,
  asAbs,
  instantiateReturn,
  isRelFn,
  mapElementFallback,
  projectFlatMapResult,
  undefAbs,
  validateCallableArg,
  validateIndexArg,
} from "../../hof.ts";
import { toIOI, sortTupleAbs } from "../runtime/containers.ts";
// Bug 270/1051：ToIntegerOrInfinity 实参的「缺省 / 显式 undefined」第三态
// （toIOI 把两者都折成 undefined）与 splice/toSpliced 的删除窗口单一实现。
// 类型与函数直连 arr-methods.ts（不经 containers barrel）——避免扩大 core
// 公共导出面（barrel 不在本分片范围）。
import { spliceWindow, toIOIArg } from "../runtime/containers/arr-methods.ts";
// 直连 member.ts（不经 containers barrel）：本模块体加载期即回调本 setter，
// vite SSR 下 barrel 的 re-export 不是实例化期可用绑定（原单文件拓扑中
// setter 是本模块提升函数声明）。barrel 间接层会在此处拿到 undefined。
import { emptyEnv } from "../../ast-env.ts";
import { defaultLeakBudget } from "../../leak.ts";
import { pTrue } from "../../pred.ts";
import { errorTypeAbs, recordMayThrow } from "../may-throw.ts";
import { isNullishLitAbs } from "../../surface.ts";
import { NudoThrow } from "../runtime.ts";
import { toIntegerOrInfinityLit } from "../../methods.ts";
// Bug 198：数组迭代器的 live 视图类型（CollectionLiveEntries——与 Map/Set 的
// 集合 live 视图同款协议：take / takeAll / rest）。类型直连（不经 barrel），
// 避免扩大 core 公共导出面。
import type { CollectionLiveEntries } from "../../builtins/error/iterator.ts";

/** tuple 的**取值序列**（hole 位按 Get 语义取 undefined——原生迭代器不跳 hole） */
function tupleValues(shape: {
  k: string;
  elements?: Abs[];
  holes?: number[];
}): Abs[] {
  const els = shape.elements ?? [];
  const holes = shape.holes ?? [];
  return els.map((el, i) => (holes.includes(i) ? undefAbs() : el));
}

/** entries 迭代器的条目元组 [下标, 取值]（原生 Array Iterator 的条目形状） */
function entryTupleOf(i: number, v: Abs): Abs {
  return abs({ k: "tuple", elements: [numLit(i), v] }, undefined, undefined, "exact");
}

/**
 * Bug 198：数组迭代器的 **live 视图**——原生 %ArrayIteratorPrototype% 的
 * next() 持 nextIndex 指针：每步按**当前** LengthOfArrayLike(O) 判结束、
 * 按 Get(O, nextIndex) 取值 ⇒ 迭代期间的 push / unshift / shift 对迭代可见
 * （`const a=[1,2,3]; const it=a.entries(); it.next(); a.shift();
 * it.next().value` 原生 [1,3]，引擎快照口径 [1,2]）。
 *
 * 引擎的数组 mutator 是**就地改写**（writeInPlace——Abs 身份不变、shape 换新），
 * 故每次读 arr.shape 即是接收者**当前**内容。
 *
 * 形状被降级为抽象 arr（splice 的元素域约定，issue #156）时长度不可知 ⇒
 * 回落创建期快照（保持既有口径，不引入新的断言）。
 *
 * Bug 198（S20）：**不登记静态元素侧表**——静态表是创建期拷贝，长度探针
 * （sideIterLen）读它 ⇒「剩余长度」停在创建时刻（for-of 少跑一轮：
 * `a.values(); a.push(3)` 后原生再跑 2 轮，引擎只跑 1 轮）。元素面与长度
 * 都由**消费视图**（registerGenDrain 的 live 视图）承担——它每次重读接收者
 * 当前内容（与 Map/Set 集合迭代器同口径）。
 */
function arrayLiveEntries(
  arr: Abs,
  values: Abs[],
  project: (el: Abs, i: number) => Abs,
): { live: CollectionLiveEntries } {
  const state = { i: 0 };
  /** 接收者当前取值序列（非 tuple ⇒ 创建期快照——长度不可知） */
  const list = (): Abs[] => {
    const s = arr.shape as { k: string; elements?: Abs[]; holes?: number[] };
    if (s.k !== "tuple") return values;
    return tupleValues(s);
  };
  const projectedFrom = (l: Abs[], from: number): Abs[] =>
    l.slice(from).map((v, k) => project(v, from + k));
  const live: CollectionLiveEntries = {
    take: (): Abs | undefined => {
      const l = list();
      if (state.i >= l.length) return undefined;
      const v = l[state.i]!;
      const i = state.i;
      state.i++;
      return project(v, i);
    },
    takeAll: (): Abs[] => {
      const l = list();
      const out = projectedFrom(l, state.i);
      state.i = l.length;
      return out;
    },
    rest: (): Abs[] => projectedFrom(list(), state.i),
  };
  return { live };
}

/**
 * Bug 270：ES2023 `splice` / `toSpliced` 的**删除窗口**由 `spliceWindow`
 * （arr-methods.ts）承担——两臂共用同一实现，杜绝分叉。
 */

/** arr/tuple 上的 map/reduce/filter/join/includes/flatMap */
export function invokeArrMethod(arr: Abs, method: string, args: Abs[]): Abs | undefined {
  const shape = arr.shape as
    | { k: "arr"; element: Abs }
    | { k: "tuple"; elements: Abs[]; holes?: number[] };
  const holes = shape.k === "tuple" ? ((arr.shape as { holes?: number[] }).holes ?? []) : [];
  const isHole = (i: number): boolean => holes.includes(i);
  /**
   * Bug 248：HOF 逐位读**当前容器**（原生 `Get(O, k)` / `HasProperty(O, k)`
   * **逐步现读**）。
   *
   * 引擎的数组 mutator（`$arrMutContainer` → `writeInPlace`）与下标写
   * （`$idxSet`）都是**就地改写**——Abs 身份不变、shape 换新 ⇒ 每步重读
   * `arr.shape` 即接收者当前内容；此前读的是**进体前捕获**的 `shape` ⇒ 体内
   * 变异（`a[1]=9` / `a.length=1` / `a.pop()`）对后续迭代不可见（陈旧值）。
   *
   * 长度口径（原生事实）：`forEach`/`map`/`filter`/`reduce`/`reduceRight`/
   * `some`/`every`/`find`/`findIndex`/`findLast`/`findLastIndex`/`flatMap` 的
   * `len` 在**进体前取一次**（`ToLength(O.length)` 只读一次）⇒ 体内 push 不会
   * 多跑、length 缩短也不会少跑（少跑靠 `HasProperty` 缺席达成）。本实现按此
   * 口径固定迭代上界，逐位只把**在场判定与元素值**换成现读。
   */
  type ArrShape =
    | { k: "arr"; element: Abs }
    | { k: "tuple"; elements: Abs[]; holes?: number[] };
  /** 当前容器形态（就地改写后 shape 换新 ⇒ 必须每步重读） */
  const liveShape = (): ArrShape => arr.shape as ArrShape;
  /**
   * 逐位取值：`present` = 原生 `HasProperty(O, k)`（越界 / 空洞 ⇒ 缺席），
   * `el` = 原生 `Get(O, k)`（现读）。容器被降级为抽象 arr（splice 的元素域
   * 约定，issue #156）⇒ 长度不可知 ⇒ 回落进体前快照（保持既有口径）。
   */
  const liveAt = (i: number): { present: boolean; el: Abs } => {
    const s = liveShape();
    if (s.k !== "tuple") {
      const fb = shape.k === "tuple" ? shape.elements[i] : undefined;
      return { present: true, el: fb ?? unknown };
    }
    const holesNow = s.holes ?? [];
    if (i >= s.elements.length) return { present: false, el: unknown };
    if (holesNow.includes(i)) return { present: false, el: unknown };
    return { present: true, el: s.elements[i]! };
  };
  /**
   * `find` / `findIndex` / `findLast` / `findLastIndex` 的取值口径：原生这四族
   * **不查 HasProperty**——hole 位照样回调（值取 Get ⇒ undefined），只有越界
   * 位（i ≥ 当前长度）也是 undefined。故与 liveAt 的「缺席即跳过」不同。
   */
  const liveGet = (i: number): Abs => {
    const s = liveShape();
    if (s.k !== "tuple") {
      const fb = shape.k === "tuple" ? shape.elements[i] : undefined;
      return fb ?? unknown;
    }
    const holesNow = s.holes ?? [];
    if (i >= s.elements.length) return undefAbs();
    if (holesNow.includes(i)) return undefAbs();
    return s.elements[i]!;
  };
  /** 抽象数组（长度未知）回调收到的索引是未知 number，不得折字面量 0 */
  const unknownIdx = (): Abs =>
    abs({ k: "prim", type: "number" }, undefined, undefined, "path");
  /** 回调结果具体 truthy：true / falsy / undefined=非具体（按 JS ToBoolean） */
  const callbackTruth = (r: Abs): boolean | undefined => {
    if (r.term?.op !== "lit") return undefined;
    const vR = litValue(r);
    const v = vR.ok ? vR.value : undefined;
    if (v === undefined || v === null || v === false || v === "" || (v as unknown) === 0n) return false;
    if (typeof v === "number" && (v === 0 || Number.isNaN(v))) return false;
    return true;
  };
  // 统一委托 applyCallbackAbs（不新增 env.fns）
  // Bug 21：可选 thisVal = HOF 第二实参 thisArg——原生 GetThisBinding 把
  // 它作为回调调用的宿主 this（字面量对象透传，回调体 $rawThis 原样接到）；
  // 缺省 undefined ≡ 现状（strict 普通调用的 this）
  const callFn = (fn: unknown, thisVal: Abs | undefined, ...fnArgs: Abs[]): Abs => {
    const sumIdx = fnArgs.findIndex(
      (a) => a && typeof a === "object" && "shape" in (a as object) && (a as Abs).shape.k === "sum",
    );
    if (sumIdx >= 0) {
      const members = (fnArgs[sumIdx] as Abs & { shape: { k: "sum"; members: Abs[] } }).shape
        .members;
      let acc: Abs | undefined;
      for (const m of members) {
        const next = fnArgs.map((a, i) => (i === sumIdx ? m : a));
        const r = callFn(fn, thisVal, ...next);
        acc = acc === undefined ? r : joinAbs(acc, r);
      }
      return acc ?? unknown;
    }
    if (typeof fn === "function") {
      // Bug 26：宿主全局函数值回调（[1,2].map(Number) 等）——Abs 实参直喂
      // 宿主函数会 ToPrimitive 假值再被弃成 unknown；经桥按被调用位语义
      // 分派（evalGlobalFn 精确折 parseInt(1,0)/Number(2)…）
      const bridged = callHostGlobalFn(fn, fnArgs);
      if (bridged !== undefined) return bridged;
      // thisVal 经宿主调用位注入（transpile 的 function 包装体由
      // $rawThis(this) 承接；thisVal undefined 时 sloppy this = globalThis
      // → $rawThis 归一 lit(undefined)，与旧 plain-call 行为一致）
      const r = callAtFunctionBoundary(() =>
        Reflect.apply(fn as (...a: Abs[]) => unknown, thisVal as never, fnArgs),
      );
      if (r && typeof r === "object" && "shape" in (r as object)) return r as Abs;
      return unknown;
    }
    const absFn = asAbs(fn);
    if (absFn) {
      return applyCallbackAbs(absFn, fnArgs, emptyEnv(), pTrue, defaultLeakBudget, thisVal);
    }
    return unknown;
  };
  const isRelationOnly = (fn: unknown): fn is Abs => {
    const a = asAbs(fn);
    if (!a) return false;
    const impl = getFnImpl(a);
    if (impl?.body || impl?.apply) return false;
    return !!(impl?.relation || isRelFn(a));
  };
  if (method === "map") {
    // Bug 55：GetCallback 前置校验——空接收者零迭代也要抛（undefined 同抛）
    validateCallableArg(args[0], "map callback may not be callable");
    if (shape.k === "tuple") {
      // Bug 248：len 进体前取一次（原生 ToLength(O.length) 只读一次）；逐位
      // 现读当前容器（Get/HasProperty）——缺席位在结果里留**空洞**（原生
      // map 的 `k in O` 判定：不在场 ⇒ 结果同位是 hole，不回调）。
      const len = shape.elements.length;
      const mapped: Abs[] = [];
      const mappedHoles: number[] = [];
      for (let i = 0; i < len; i++) {
        const live = liveAt(i);
        if (!live.present) {
          mapped.push(undefAbs());
          mappedHoles.push(i);
          continue;
        }
        mapped.push(callFn(args[0], args[1], live.el, $lit(i), arr));
      }
      return abs(
        { k: "tuple", elements: mapped, holes: mappedHoles.length > 0 ? mappedHoles : undefined },
        undefined,
        undefined,
        "path",
      );
    }
    const out = callFn(args[0], args[1], markDomainShared(shape.element), fromIdxAbs(), arr);
    const el = mapElementFallback(asAbs(args[0]), shape.element, out);
    // fallback 强制 partial，否则 confJoin(arr, out)
    const conf =
      el === out ? confJoin(arr.conf, out.conf) : "partial";
    return abs({ k: "arr", element: el }, undefined, undefined, conf);
  }
  if (method === "reduce") {
    // Bug 55：GetCallback 前置校验（[1].reduce(Symbol()) 单元素无初值路径
    // 不调回调也原生抛——校验必须在取首元素之前）
    validateCallableArg(args[0], "reduce callback may not be callable");
    const fn = args[0]!;
    const noInitial = args.length < 2;
    // Bug 6：无初值累加器 = 首元素（原生语义）——抽象数组首元素域 =
    // 元素域（shape.element），不得钉 unknown（回调内 unknown + number →
    // number | string 凭空多出 `+` 的字符串拼接臂）；tuple 路径的 acc 随
    // 后按原生语义取首个在场元素覆盖
    let acc = args[1] ?? (shape.k === "arr" ? shape.element : unknown);
    // Bug 18：抽象数组（长度未知可能为空）无初值 → 原生 may TypeError
    // （Reduce of empty array with no initial value）
    if (noInitial && shape.k === "arr") {
      recordMayThrow({
        kind: "TypeError",
        cause: "reduce of possibly-empty array with no initial value",
      });
    }
    // 仅 relation → 一次 join，不动点只在有 body 时跑
    if (isRelationOnly(fn) && shape.k === "arr") {
      const d = instantiateReturn(fn, [acc, shape.element]);
      return joinAbs(acc, d);
    }
    if (shape.k === "tuple") {
      // Bug 248：原生 reduce 的 len 进体前取一次；**首元素**取「首个在场
      // 元素」（HasProperty 现查），其后逐位现读当前容器（Get 现读）。
      const len = shape.elements.length;
      if (noInitial) {
        // Bug 18：原生无初值语义——acc 取首个在场元素（hole 跳过），回调自
        // 次元素起；空/仅 hole → 确定 TypeError；单元素 → 不调回调直接返回
        let firstIdx = -1;
        let firstEl: Abs | undefined;
        for (let i = 0; i < len; i++) {
          const live = liveAt(i);
          if (!live.present) continue;
          firstIdx = i;
          firstEl = live.el;
          break;
        }
        if (firstIdx === -1 || firstEl === undefined) {
          throw new NudoThrow(errorTypeAbs("TypeError"));
        }
        let acc2 = firstEl;
        for (let i = firstIdx + 1; i < len; i++) {
          const live = liveAt(i);
          if (!live.present) continue;
          acc2 = callFn(fn, undefined, acc2, live.el, $lit(i), arr);
        }
        return acc2;
      }
      for (let i = 0; i < len; i++) {
        const live = liveAt(i);
        if (!live.present) continue;
        acc = callFn(fn, undefined, acc, live.el, $lit(i), arr);
      }
      return acc;
    }
    return callFn(fn, undefined, acc, markDomainShared(shape.element), fromIdxAbs(), arr);
  }
  if (method === "reduceRight") {
    // Bug 55：GetCallback 前置校验（同 reduce——单元素无初值不调回调也抛）
    validateCallableArg(args[0], "reduceRight callback may not be callable");
    const fn = args[0]!;
    const noInitial = args.length < 2;
    // Bug 6：同 reduce——无初值累加器 = 尾元素，域 = 元素域（tuple 路径
    // 随后按原生语义取末个在场元素覆盖）
    let acc = args[1] ?? (shape.k === "arr" ? shape.element : unknown);
    if (shape.k === "tuple") {
      // Bug 248：同 reduce——len 进体前取一次，逐位现读当前容器（自尾向前）。
      const len = shape.elements.length;
      if (noInitial) {
        // Bug 18：同 reduce（自尾向前）
        let lastIdx = -1;
        let lastEl: Abs | undefined;
        for (let i = len - 1; i >= 0; i--) {
          const live = liveAt(i);
          if (!live.present) continue;
          lastIdx = i;
          lastEl = live.el;
          break;
        }
        if (lastIdx === -1 || lastEl === undefined) {
          throw new NudoThrow(errorTypeAbs("TypeError"));
        }
        let acc2 = lastEl;
        for (let i = lastIdx - 1; i >= 0; i--) {
          const live = liveAt(i);
          if (!live.present) continue;
          acc2 = callFn(fn, undefined, acc2, live.el, $lit(i), arr);
        }
        return acc2;
      }
      for (let i = len - 1; i >= 0; i--) {
        const live = liveAt(i);
        if (!live.present) continue;
        acc = callFn(fn, undefined, acc, live.el, $lit(i), arr);
      }
      return acc;
    }
    // Bug 18：抽象数组无初值 → may TypeError
    if (noInitial) {
      recordMayThrow({
        kind: "TypeError",
        cause: "reduceRight of possibly-empty array with no initial value",
      });
    }
    return callFn(fn, undefined, acc, markDomainShared(shape.element), fromIdxAbs(), arr);
  }
  if (method === "filter") {
    // Bug 55：GetCallback 前置校验（空元组零谓词也要抛）
    validateCallableArg(args[0], "filter callback may not be callable");
    // 逐位谓词：具体 true 保留、具体 false 丢弃、不确定并入（side effect 计数精确）。
    // hole 跳过谓词且不出现在结果里（原生 filter 收紧数组）。
    if (shape.k === "tuple") {
      const kept: Abs[] = [];
      let anyUncertain = false;
      // Bug 248：逐位现读当前容器（Get/HasProperty）——体内变异对后续位可见。
      const len = shape.elements.length;
      for (let i = 0; i < len; i++) {
        const live = liveAt(i);
        if (!live.present) continue;
        const p = callFn(args[0], args[1], live.el, $lit(i), arr);
        const t = callbackTruth(p);
        if (t === false) continue;
        if (t === undefined) anyUncertain = true;
        kept.push(live.el);
      }
      if (kept.length === 0) {
        // 每个现存元素的谓词都 definitely-false（空元组平凡成立）→ 结果恒为 []。
        // 旧口径折 unknown[]（无界长度）既失真又在 assign 对账面制造假
        // mismatch（OSS 语料 semver/bin/semver.js L109 的 L1 FP）。
        return abs({ k: "tuple", elements: [] }, undefined, undefined, confJoin(arr.conf, "path"));
      }
      // 谓词全具体 → 精确子序列保留 tuple 字面量精度
      if (!anyUncertain) {
        return abs({ k: "tuple", elements: kept }, undefined, undefined, confJoin(arr.conf, "path"));
      }
      // 不确定谓词：结果是 kept 的**子序列**（长度 ≤ kept.length，filter 不增元素）。
      // 小元组枚举子集和（精确且有界）；更大的枚举指数膨胀 → 退回无界 arr
      // （sound，旧口径，仅长度上界失真）。
      const conf = confJoin(arr.conf, "path");
      if (kept.length <= 3) {
        let acc: Abs | undefined;
        const total = 1 << kept.length;
        for (let mask = 0; mask < total; mask++) {
          const els = kept.filter((_, bit) => (mask & (1 << bit)) !== 0);
          const sub = abs({ k: "tuple", elements: els }, undefined, undefined, conf);
          acc = acc === undefined ? sub : joinAbs(acc, sub);
        }
        return acc!;
      }
      const el = kept.reduce((a, b) => joinAbs(a, b));
      return abs({ k: "arr", element: el }, undefined, undefined, conf);
    }
    // arr：filter 保持元素类型（不传播回调 pred）
    return arr;
  }
  if (method === "flatMap") {
    // Bug 55：GetCallback 前置校验（空接收者零迭代也要抛）
    validateCallableArg(args[0], "flatMap callback may not be callable");
    if (shape.k === "tuple") {
      // Bug 248：逐位现读当前容器（Get/HasProperty）——hole 位不回调（原生
      // flatMap 的 `k in O` 判定），缺席位在结果里是空元组（摊平后不留）。
      const len = shape.elements.length;
      const mapped = shape.elements.map((_el, i) => {
        const live = liveAt(i);
        if (!live.present) return abs({ k: "tuple", elements: [] }, undefined, undefined, "exact");
        return callFn(args[0], args[1], live.el, $lit(i), arr);
      });
      return projectFlatMapResult(arr.conf, mapped);
    }
    const out = callFn(args[0], args[1], markDomainShared(shape.element), fromIdxAbs(), arr);
    return projectFlatMapResult(arr.conf, [out]);
  }
  if (method === "forEach") {
    // Bug 55：GetCallback 前置校验（空接收者零迭代也要抛）
    validateCallableArg(args[0], "forEach callback may not be callable");
    if (shape.k === "tuple") {
      // Bug 248：逐位现读当前容器（Get/HasProperty）——len 进体前取一次。
      const len = shape.elements.length;
      for (let i = 0; i < len; i++) {
        const live = liveAt(i);
        if (!live.present) continue;
        callFn(args[0], args[1], live.el, $lit(i), arr);
      }
    } else {
      callFn(args[0], args[1], markDomainShared(shape.element), fromIdxAbs(), arr);
    }
    return undefAbs();
  }
  if (method === "some" || method === "every") {
    // Bug 55：GetCallback 前置校验（[].some(Symbol()) 零迭代不再折假 false/true）
    validateCallableArg(args[0], `${method} callback may not be callable`);
    // 逐位短路：具体命中即停（some: truthy / every: falsy），副作用计数与原生一致。
    // 规范 some/every 检查 HasProperty：hole 位置跳过回调（与 find/findIndex 相反）。
    let undecided = false;
    if (shape.k === "tuple") {
      // Bug 248：逐位现读当前容器（Get/HasProperty）。
      const len = shape.elements.length;
      for (let i = 0; i < len; i++) {
        const live = liveAt(i);
        if (!live.present) continue;
        const t = callbackTruth(callFn(args[0], args[1], live.el, $lit(i), arr));
        if (t === undefined) {
          undecided = true;
          continue;
        }
        if (method === "some" && t) return boolLit(true);
        if (method === "every" && !t) return boolLit(false);
      }
    } else {
      const t = callbackTruth(callFn(args[0], args[1], markDomainShared(shape.element), fromIdxAbs(), arr));
      // 抽象 arr 长度未知（可能空）：单代表元素无法下结论
      if (t === undefined) return bool();
      if (method === "some" && t) return boolLit(true);
      if (method === "every" && !t) return boolLit(false);
      return bool();
    }
    if (undecided) return bool();
    return boolLit(method === "some" ? false : true);
  }
  if (method === "find") {
    // Bug 55：GetCallback 前置校验
    validateCallableArg(args[0], "find callback may not be callable");
    if (shape.k === "tuple") {
      let undecided = false;
      // Bug 248：逐位现读当前容器（Get 语义——hole 位照样回调，值 undefined）。
      const len = shape.elements.length;
      for (let i = 0; i < len; i++) {
        const el = liveGet(i);
        const t = callbackTruth(callFn(args[0], args[1], el, $lit(i), arr));
        if (t === true) return el;
        if (t === undefined) undecided = true;
      }
      if (undecided) {
        const joined = shape.elements.reduce((a, b) => joinAbs(a, b));
        return joinAbs(joined, undefAbs());
      }
      return undefAbs();
    }
    const el = markDomainShared(shape.element);
    const t = callbackTruth(callFn(args[0], args[1], el, fromIdxAbs(), arr));
    if (t === true) return el;
    if (t === false) return undefAbs();
    return joinAbs(el, undefAbs());
  }
  if (method === "findIndex") {
    // Bug 73：GetCallback 前置校验——[].findIndex(Symbol()) 零迭代不得折 -1 #exact
    validateCallableArg(args[0], "findIndex callback may not be callable");
    if (shape.k === "tuple") {
      let undecided = false;
      // Bug 248：逐位现读当前容器（Get 语义——hole 位照样回调，值 undefined）。
      const len = shape.elements.length;
      for (let i = 0; i < len; i++) {
        const t = callbackTruth(callFn(args[0], args[1], liveGet(i), $lit(i), arr));
        if (t === true) return $lit(i);
        if (t === undefined) undecided = true;
      }
      if (undecided) return joinAbs(unknownIdx(), $lit(-1));
      return $lit(-1);
    }
    const t = callbackTruth(callFn(args[0], args[1], markDomainShared(shape.element), fromIdxAbs(), arr));
    if (t === true) return unknownIdx();
    if (t === false) return $lit(-1);
    return joinAbs(unknownIdx(), $lit(-1));
  }
  if (method === "findLast" || method === "findLastIndex") {
    // Bug 74：find/findIndex 的逆序孪生——自尾向前首个命中
    validateCallableArg(args[0], `${method} callback may not be callable`);
    const wantIndex = method === "findLastIndex";
    if (shape.k === "tuple") {
      let undecided = false;
      for (let i = shape.elements.length - 1; i >= 0; i--) {
        // Bug 248：逐位现读当前容器（Get 语义——hole 位照样回调，值 undefined）。
        const el = liveGet(i);
        const t = callbackTruth(callFn(args[0], args[1], el, $lit(i), arr));
        if (t === true) return wantIndex ? $lit(i) : el;
        if (t === undefined) undecided = true;
      }
      if (undecided) {
        const joined = shape.elements.length
          ? shape.elements.reduce((a, b) => joinAbs(a, b))
          : unknown;
        return wantIndex ? joinAbs(unknownIdx(), $lit(-1)) : joinAbs(joined, undefAbs());
      }
      return wantIndex ? $lit(-1) : undefAbs();
    }
    const t = callbackTruth(callFn(args[0], args[1], markDomainShared(shape.element), fromIdxAbs(), arr));
    if (wantIndex) {
      if (t === true) return unknownIdx();
      if (t === false) return $lit(-1);
      return joinAbs(unknownIdx(), $lit(-1));
    }
    if (t === true) return shape.element;
    if (t === false) return undefAbs();
    return joinAbs(shape.element, undefAbs());
  }
  if (method === "join") {
    // Bug 36：join 逐元素 ToString——symbol 元素确定 TypeError（[Symbol()].join()
    // 原生抛）；any/真 unknown 元素 may（validateJoinElements 与一等 join 路径
    // 共用）。字面量分隔符 + 全字面量元组 → 精确折叠（原生 ToString 语义，
    // 含 hole→""、nullish 元素→""）；其余合法路径保持 path-string（不假精确）。
    const folded = arrayJoinWithSep(arr, args[0]);
    if (folded !== undefined) return folded;
    validateJoinElements(arr);
    return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
  }
  if (method === "toString" || method === "toLocaleString") {
    // Array.prototype.toString = join(",")：全字面量元素折叠；含 symbol 元素 TypeError
    return arrayJoinToString(arr);
  }
  if (method === "keys") {
    if (shape.k === "tuple") {
      // Bug 63：原生返回 Array Iterator 对象（非数组）——Map/Set 的
      // collectionIteratorAbs 同款协议面（next/@@iterator + 元素侧表），
      // Array.isArray 折 false、Object.keys 折 []、typeof .next 折
      // "function"；spread/for-of/Array.from/.next() 链路经侧表全求值。
      // 原生数组迭代器：0..length-1 全下标（不跳过 hole），键是 number
      // （自有属性键才是字符串——Object.keys / for-in 不受此影响）
      // Bug 198：live 视图（原生 nextIndex 指针——迭代期间的 push/unshift/
      // shift 对迭代可见；见 arrayLiveEntries）。
      // Bug 198（S20）：**不登记静态元素侧表**——长度探针（sideIterLen）读
      // 静态表会把「剩余长度」冻结在创建时刻（for-of 少跑一轮）；元素面与
      // 长度都由 live 消费视图承担（与 Map/Set 集合迭代器同口径）。
      const values = tupleValues(shape);
      const { live } = arrayLiveEntries(arr, values, (_v, i) => numLit(i));
      const it = collectionIteratorAbs(shape.elements.map((_, i) => numLit(i)), live);
      return it;
    }
    // 长度未知：迭代器对象保守面（next 值域 el∪undefined、done 布尔域；
    // 不挂侧表——spread/for-of 走 unbounded join，不折精确长度）
    return abstractSeqIteratorAbs(unknownIdx());
  }
  if (method === "values") {
    if (shape.k === "tuple") {
      const values = tupleValues(shape);
      // 原生迭代器不跳过 hole：hole 位按 Get 语义产出 undefined
      // Bug 198：live 视图（同 keys 臂）——不登记静态元素侧表（S20）
      const { live } = arrayLiveEntries(arr, values, (v) => v);
      const it = collectionIteratorAbs(values, live);
      return it;
    }
    return abstractSeqIteratorAbs(shape.element);
  }
  if (method === "entries") {
    if (shape.k === "tuple") {
      const values = tupleValues(shape);
      // Bug 198：live 视图（同 keys 臂）——条目元组的下标随当前长度走；
      // 不登记静态元素侧表（S20）
      const { live } = arrayLiveEntries(arr, values, (v, i) => entryTupleOf(i, v));
      const it = collectionIteratorAbs(values.map((v, i) => entryTupleOf(i, v)), live);
      return it;
    }
    return abstractSeqIteratorAbs(
      abs(
        { k: "tuple", elements: [fromIdxAbs(), markDomainShared(shape.element)] },
        undefined,
        undefined,
        "partial",
      ),
    );
  }
  if (method === "fill") {
    // Bug 255：原生 `fill()` **零实参**合法——value 缺省 ⇒ 整条被填成
    // undefined（[0,1,2,3].fill() → [undefined×4]，length 不变）。此前
    // `args.length >= 1` 守卫把整条 fill 分支跳过 ⇒ 数组原样保留（假绿）。
    // Bug 49：$invoke 调用点就地变更（fillTuple 精确窗口），返回接收者容器
    return $arrMutContainer(arr, method, args);
  }
  if (method === "sort" || method === "toSorted") {
    // Bug 51/74：GetSortComparator——缺省/严格 undefined → 默认比较器；
    // null/prim/非可调用（含 symbol）→ 确定 TypeError；any/抽象 → may。
    // 默认比较器（ToString 序）下全字面量元组精确排序（undefined 恒排尾
    // 不参与比较；≥2 个可比较元素含 symbol → 比较 ToString 确定 TypeError）；
    // 比较器在场 / 抽象元素 → 位次不可信，tuple 降 arr（元素 join）。
    // Bug 49：sort 经 $arrMutContainer 在调用点就地变更（含 frozen/sealed
    // 校验）并返回接收者；toSorted 是非变更拷贝。
    if (method === "sort") {
      return $arrMutContainer(arr, method, args);
    }
    validateCallableArg(args[0], "toSorted comparator may not be callable", {
      undefinedOk: true,
    });
    if (shape.k === "arr") {
      return abs({ k: "arr", element: shape.element }, undefined, undefined, "partial");
    }
    return sortTupleAbs(arr, args[0]);
  }
  if (method === "reverse") {
    // Bug 49/71：$invoke 调用点就地变更（holes 随元素镜像翻转），返回
    // 接收者容器；抽象 arr 顺序未建模、元素不变
    return $arrMutContainer(arr, method, args);
  }
  if (method === "toReversed") {
    // Bug 66：非变更拷贝——hole 位按 Get 语义写实 undefined（与 reverse 不同）
    if (shape.k === "tuple") {
      return abs(
        {
          k: "tuple",
          elements: [...shape.elements]
            .reverse()
            .map((el, i) => (((shape.holes ?? []).includes(shape.elements.length - 1 - i)) ? undefAbs() : el)),
        },
        undefined,
        undefined,
        confJoin(arr.conf, "path"),
      );
    }
    return abs({ k: "arr", element: shape.element }, undefined, undefined, "partial");
  }
  if (method === "flat") {
    // Bug 66：depth 经 ToIntegerOrInfinity（symbol/bigint → 确定 TypeError；
    // 抽象 → may）。字面量 depth 递归展开（缺省/undefined → 1；负数/NaN → 0
    // 即浅拷贝不展开）；抽象 depth 保守并「不展开」与「全展开」两域。
    validateIndexArg(args[0], "flat depth may not be convertible to a number");
    const depthRaw = toIOI(args[0]);
    const holeSet = new Set(holes);
    /** 递归展开：返回 null = 途中遇到抽象 arr（长度未知）→ 整体降 arr */
    const rec = (
      els: Abs[],
      hs: Set<number>,
      d: number,
    ): { els: Abs[]; degraded: boolean } | null => {
      const out: Abs[] = [];
      let degraded = false;
      for (let i = 0; i < els.length; i++) {
        if (hs.has(i)) continue; // 原生 flat 跳过 hole（不产 undefined）
        const el = els[i]!;
        if (d > 0 && el.shape.k === "tuple") {
          const sub = rec(
            el.shape.elements,
            new Set(el.shape.holes ?? []),
            d - 1,
          );
          if (sub === null) return null;
          out.push(...sub.els);
          degraded = degraded || sub.degraded;
          continue;
        }
        if (d > 0 && el.shape.k === "arr") return null;
        out.push(el);
      }
      return { els: out, degraded };
    };
    if (shape.k === "arr") {
      // 抽象数组：元素可能本身是数组（展开并入其元素域）也可能原样保留
      const es = shape.element.shape;
      const innerEls =
        es.k === "tuple"
          ? es.elements.length
            ? es.elements.reduce((x, y) => joinAbs(x, y))
            : unknown
          : es.k === "arr"
            ? es.element
            : undefined;
      const el = innerEls !== undefined ? joinAbs(shape.element, innerEls) : shape.element;
      return abs({ k: "arr", element: el }, undefined, undefined, "partial");
    }
    if (depthRaw === null) {
      // 抽象 depth：0..∞ 皆可能 → 元素域 = 浅层元素 ∪ 全展开元素
      recordMayThrow({
        kind: "TypeError",
        cause: "flat depth may not be convertible to a number",
      });
      const shallow = rec(shape.elements, holeSet, 0);
      const deep = rec(shape.elements, holeSet, Number.MAX_SAFE_INTEGER);
      if (shallow !== null && deep !== null) {
        const el = [...shallow.els, ...deep.els].reduce((x, y) => joinAbs(x, y));
        return abs({ k: "arr", element: el }, undefined, undefined, "partial");
      }
      return unknown;
    }
    const depth = depthRaw === undefined ? 1 : Math.max(depthRaw, 0);
    const r = rec(shape.elements, holeSet, depth);
    if (r === null) {
      // 含抽象 arr 展开：长度未知 → arr（元素 join）
      const shallow = rec(shape.elements, holeSet, 0);
      const el = shallow && shallow.els.length
        ? shallow.els.reduce((x, y) => joinAbs(x, y))
        : unknown;
      return abs({ k: "arr", element: el }, undefined, undefined, "partial");
    }
    if (r.degraded) {
      const el = r.els.length ? r.els.reduce((x, y) => joinAbs(x, y)) : unknown;
      return abs({ k: "arr", element: el }, undefined, undefined, "partial");
    }
    return abs(
      { k: "tuple", elements: r.els },
      undefined,
      undefined,
      confJoin(arr.conf, "path"),
    );
  }
  if (method === "toSpliced") {
    // Bug 66：start/skipCount 经 ToIntegerOrInfinity（symbol/bigint → 确定
    // TypeError；抽象 → may）；items 原样插入（值实参不转换）；窗口 clamp
    // （OOB 不抛——与 with 不同）
    // Bug 270：删除窗口走 spliceWindow（单一事实源）——`toSpliced()` 零实参
    // ⇒ start 缺省 ⇒ **不删**（原生原样保留）；`toSpliced(0, undefined)` ⇒
    // skipCount 在场（undefined ⇒ 0）⇒ **不删**。
    validateIndexArg(args[0], "toSpliced start may not be convertible to a number");
    validateIndexArg(args[1], "toSpliced skipCount may not be convertible to a number");
    const items = args.slice(2);
    if (shape.k === "tuple") {
      const len = shape.elements.length;
      const win = spliceWindow(len, toIOIArg(args[0]), toIOIArg(args[1]), args.length === 0);
      if (win === "unknown") {
        // 抽象窗口：任意删除都可能 → 元素 ∪ items join 降 arr
        const parts = [...shape.elements.filter((_, i) => !isHole(i)), ...items];
        const el = parts.length ? parts.reduce((x, y) => joinAbs(x, y)) : unknown;
        return abs({ k: "arr", element: el }, undefined, undefined, "partial");
      }
      const { a, skip } = win;
      const solid = (el: Abs, i: number): Abs => (isHole(i) ? undefAbs() : el);
      const els = [
        ...shape.elements.slice(0, a).map(solid),
        ...items,
        ...shape.elements.slice(a + skip).map((el, i) => solid(el, a + skip + i)),
      ];
      return abs(
        { k: "tuple", elements: els },
        undefined,
        undefined,
        confJoin(arr.conf, "path"),
      );
    }
    const parts = [shape.element, ...items];
    return abs(
      { k: "arr", element: parts.reduce((x, y) => joinAbs(x, y)) },
      undefined,
      undefined,
      "partial",
    );
  }
  if (method === "with") {
    // Bug 66：index 经 ToIntegerOrInfinity（symbol/bigint → 确定 TypeError）；
    // OOB 字面量（idx ∉ [0, len)，负数自尾相对）→ 确定 RangeError；抽象下标
    // → may RangeError + 每位 join(value)；with 写实 → 该位不再是 hole
    validateIndexArg(args[0], "with index may not be convertible to a number");
    const v = args[1] ?? undefAbs();
    if (shape.k === "tuple") {
      const iv = toIOI(args[0]) ?? 0;
      if (iv === null) {
        recordMayThrow({ kind: "RangeError", cause: "with index may be out of range" });
        return abs(
          { k: "tuple", elements: shape.elements.map((el) => joinAbs(el, v)) },
          undefined,
          undefined,
          "partial",
        );
      }
      const len = shape.elements.length;
      const idx = iv < 0 ? len + iv : iv;
      if (idx < 0 || idx >= len) throw new NudoThrow(errorTypeAbs("RangeError"));
      // 原生 with 逐位 CreateDataProperty——非目标 hole 也写实 undefined
      const els = shape.elements.map((el, i) =>
        i === idx ? v : isHole(i) ? undefAbs() : el,
      );
      return abs(
        { k: "tuple", elements: els },
        undefined,
        undefined,
        confJoin(arr.conf, "path"),
      );
    }
    return abs(
      { k: "arr", element: joinAbs(shape.element, v) },
      undefined,
      undefined,
      "partial",
    );
  }
  if (method === "concat") {
    // Bug 66：数组实参展开、其余原样追加；任一实参为抽象 arr → 结果长度未知
    // 降 arr。hole 保留（原生 concat 走 HasProperty/CreateDataProperty——
    // 接收者与 tuple 实参的 hole 平移存活）
    // Bug 83：native 对每个实参先查 o[Symbol.isConcatSpreadable]（计算符号键
    // 投影槽 "@@isConcatSpreadable"，只有 obj / brand inner 槽面可携带——
    // tuple shape 无 slots 字段，且 $set 对 tuple 的非索引键写直接降级 arr
    // （widenTupleToArr），「native 数组被抑制展开」子面在本引擎不可表达，
    // lit-false 抑制只对 obj 实参生效，属接受近似）：
    // - lit true（ToBoolean）→ 按 array-like 展开：length 槽 lit number →
    //   ToLength（截断/负数夹 0/NaN→0；无槽/undefined → 0），逐位读
    //   String(i) 槽——缺席位 native Get 得 undefined（fail-closed 同口径）；
    //   length 非字面量/Infinity/超物化上限 → 整体降 arr
    // - lit false → 单元素追加（不展开）
    // - 槽缺席 → 默认行为：tuple/arr 展开、其余单元素（Bug 66 口径不变）
    // - 槽存在但抽象 → 展开性未知 → 整体降 arr（sound）
    /** 实参槽面：obj 直读 / brand inner obj；tuple/arr 等无 slots 的 shape → undefined */
    const argObjShapeOf = (
      v: Abs,
    ): { slots: Record<string, { value: Abs }>; index?: { key: Abs; value: Abs } } | undefined => {
      const s = v.shape;
      if (s.k === "obj") return s;
      if (s.k === "brand" && s.shape.shape.k === "obj") return s.shape.shape;
      return undefined;
    };
    /** @@isConcatSpreadable 投影槽判定（lit → ToBoolean；抽象 → "abstract"） */
    const spreadableOf = (v: Abs): "absent" | "true" | "false" | "abstract" => {
      const o = argObjShapeOf(v);
      const slot = o ? getSlot(o.slots, "@@isConcatSpreadable") : undefined;
      if (!slot) return "absent";
      const lv = litValue(slot.value);
      if (!lv.ok) return "abstract";
      const w = lv.value;
      // ToBoolean（与 callbackTruth 同口径；lit undefined 哨兵归 false）
      if (
        w === undefined || w === null || w === false || w === "" ||
        (w as unknown) === 0n ||
        (typeof w === "number" && (w === 0 || Number.isNaN(w)))
      ) {
        return "false";
      }
      return "true";
    };
    /** lit-true 展开的 array-like 元素：length 非字面量/巨长稀疏 → null（整体降 arr） */
    const spreadElsOf = (v: Abs): Abs[] | null => {
      const o = argObjShapeOf(v);
      if (!o) return null;
      const lenAbs = getSlot(o.slots, "length")?.value;
      if (!lenAbs || isNullishLitAbs(lenAbs)) return []; // Get length undefined → ToLength 0
      const lv = litValue(lenAbs);
      if (!lv.ok || typeof lv.value !== "number") return null;
      const t = Math.trunc(lv.value);
      if (t > TUPLE_MATERIALIZE_CAP) return null;
      const n = t < 0 ? 0 : t; // NaN → 循环不执行（ToLength(NaN)=0）
      const els: Abs[] = [];
      for (let i = 0; i < n; i++) els.push(getSlot(o.slots, String(i))?.value ?? undefAbs());
      return els;
    };
    /** 降级并集（展开性/长度未知）：索引槽值 ∪ 计算索引值 ∪ 自身（不展开臂）∪ undefined */
    const spreadPossiblesOf = (v: Abs): Abs => {
      const o = argObjShapeOf(v);
      const parts: Abs[] = [v, undefAbs()];
      if (o) {
        for (const [k, s] of Object.entries(o.slots)) {
          if (canonicalArrayIndex(k) !== undefined) parts.push(s.value);
        }
        if (o.index) parts.push(o.index.value);
      }
      return parts.reduce((x, y) => joinAbs(x, y));
    };
    if (shape.k === "tuple") {
      const out: Abs[] = [...shape.elements];
      const holesC = new Set(holes);
      let degraded = false;
      for (const a of args) {
        const aa = asAbs(a) ?? unknown;
        const spread = spreadableOf(aa);
        if (spread === "true") {
          const els = spreadElsOf(aa);
          if (els === null) {
            out.push(spreadPossiblesOf(aa));
            degraded = true;
          } else out.push(...els);
        } else if (spread === "false") {
          // native 抑制展开：单元素追加
          out.push(aa);
        } else if (spread === "abstract") {
          // 展开性未知 → 降 arr（sound）
          out.push(spreadPossiblesOf(aa));
          degraded = true;
        } else if (aa.shape.k === "tuple") {
          const argHoles = aa.shape.holes ?? [];
          const base = out.length;
          for (let i = 0; i < aa.shape.elements.length; i++) {
            if (argHoles.includes(i)) holesC.add(base + i);
          }
          out.push(...aa.shape.elements);
        } else if (aa.shape.k === "arr") {
          out.push(aa.shape.element);
          degraded = true;
        } else out.push(aa);
      }
      if (degraded) {
        const el = out.length ? out.reduce((x, y) => joinAbs(x, y)) : unknown;
        return abs({ k: "arr", element: el }, undefined, undefined, "partial");
      }
      const holesOut = [...holesC];
      return abs(
        {
          k: "tuple",
          elements: out,
          holes: holesOut.length > 0 ? holesOut : undefined,
        },
        undefined,
        undefined,
        confJoin(arr.conf, "path"),
      );
    }
    // arr 接收者：结果本就降 arr（element join）；Bug 83 同一槽判定并入
    // join——lit true 展开 array-like 元素、lit false 自身、抽象 → 展开并集
    const parts: Abs[] = [shape.element];
    for (const a of args) {
      const aa = asAbs(a) ?? unknown;
      const spread = spreadableOf(aa);
      if (spread === "true") {
        const els = spreadElsOf(aa);
        if (els === null) parts.push(spreadPossiblesOf(aa));
        else parts.push(...els);
      } else if (spread === "false") {
        parts.push(aa);
      } else if (spread === "abstract") {
        parts.push(spreadPossiblesOf(aa));
      } else if (aa.shape.k === "arr") {
        parts.push(aa.shape.element);
      } else if (aa.shape.k === "tuple") {
        parts.push(
          aa.shape.elements.length
            ? aa.shape.elements.reduce((x, y) => joinAbs(x, y))
            : unknown,
        );
      } else parts.push(aa);
    }
    return abs(
      { k: "arr", element: parts.reduce((x, y) => joinAbs(x, y)) },
      undefined,
      undefined,
      "partial",
    );
  }
  if (method === "slice") {
    // Bug 66：start/end 经 ToIntegerOrInfinity（symbol/bigint → 确定 TypeError；
    // 抽象 → may）；字面量窗口精确子元组（holes 随窗口平移保留）
    validateIndexArg(args[0], "slice start may not be convertible to a number");
    validateIndexArg(args[1], "slice end may not be convertible to a number");
    if (shape.k === "tuple") {
      const st = toIOI(args[0]);
      const en = toIOI(args[1]);
      if (st === null || en === null) {
        const el = shape.elements.length
          ? shape.elements.reduce((x, y) => joinAbs(x, y))
          : unknown;
        return abs({ k: "arr", element: el }, undefined, undefined, "partial");
      }
      const len = shape.elements.length;
      const s = st === undefined ? 0 : st < 0 ? Math.max(len + st, 0) : Math.min(st, len);
      const e = en === undefined ? len : en < 0 ? Math.max(len + en, 0) : Math.min(en, len);
      if (e <= s) {
        return abs({ k: "tuple", elements: [] }, undefined, undefined, confJoin(arr.conf, "exact"));
      }
      const holesS = (shape.holes ?? [])
        .filter((h) => h >= s && h < e)
        .map((h) => h - s);
      return abs(
        {
          k: "tuple",
          elements: shape.elements.slice(s, e),
          holes: holesS.length > 0 ? holesS : undefined,
        },
        undefined,
        undefined,
        confJoin(arr.conf, "path"),
      );
    }
    return abs({ k: "arr", element: shape.element }, undefined, undefined, "partial");
  }
  if (method === "indexOf" || method === "lastIndexOf") {
    // Bug 66：严格等号扫描（hole 跳过——原生 HasProperty 语义；NaN !== NaN）；
    // fromIndex 经 ToIntegerOrInfinity（symbol/bigint → 确定 TypeError；
    // 抽象 → may）；全字面量可判 → 精确下标或 -1，否则 number path
    // Bug 1051：fromIndex 的**第三态**（缺省 / 显式 undefined / 数值）——
    // 原生 lastIndexOf(x) 起始下标 = len-1；lastIndexOf(x, undefined) 起始
    // 下标 = 0（ToIntegerOrInfinity(undefined) = 0）⇒ 两者语义不同；此前
    // toIOI 把两者都折成 undefined ⇒ lastIndexOf(2, undefined) 扫全表（1）
    // 而非只扫第 0 位（原生 -1）。
    validateIndexArg(args[1], `${method} fromIndex may not be convertible to a number`);
    if (shape.k === "tuple") {
      const els = shape.elements;
      const search = args[0];
      const searchLit =
        search !== undefined && search.term?.op === "lit" ? litValue(search) : undefined;
      const hasLitSearch = search !== undefined && search.term?.op === "lit";
      // Bug 1051：fromIndex 第三态——缺省（undefined）与显式 undefined（= 0）
      // 语义不同：lastIndexOf 缺省 ⇒ 起始 len-1；显式 undefined ⇒ 起始 0。
      const fromArg = toIOIArg(args[1]);
      if (fromArg.kind === "unknown") return unknownIdx();
      const from = fromArg.kind === "absent" ? undefined : fromArg.n;
      const len = els.length;
      if (!hasLitSearch || !els.every((el, i) => isHole(i) || el.term?.op === "lit")) {
        // 抽象 search 或抽象元素：可能命中任意位（空元组除外）
        if (len === 0 || els.every((_, i) => isHole(i))) return $lit(-1);
        return unknownIdx();
      }
      const sv = searchLit!.ok ? searchLit!.value : undefined;
      const eq = (el: Abs): boolean | undefined => {
        const r = litValue(el);
        if (!r.ok) return undefined;
        return r.value === sv; // 严格等号（NaN !== NaN 由 === 自然成立）
      };
      if (method === "indexOf") {
        let start = from === undefined ? 0 : from < 0 ? Math.max(len + from, 0) : Math.min(from, len - 1);
        for (let i = start; i < len; i++) {
          if (isHole(i)) continue;
          const t = eq(els[i]!);
          if (t === undefined) return unknownIdx();
          if (t) return $lit(i);
        }
        return $lit(-1);
      }
      let start = from === undefined ? len - 1 : from < 0 ? len + from : Math.min(from, len - 1);
      for (let i = start; i >= 0; i--) {
        if (isHole(i)) continue;
        const t = eq(els[i]!);
        if (t === undefined) return unknownIdx();
        if (t) return $lit(i);
      }
      return $lit(-1);
    }
    return unknownIdx();
  }
  if (method === "includes") {
    // Bug 1040：原生 `includes(searchElement, fromIndex)` 的 fromIndex 经
    // ToIntegerOrInfinity——bigint/symbol **确定 TypeError**
    // （node: [1,2,3].includes(0, 1n) → TypeError: Cannot convert a BigInt
    // value to a number）。此前本臂**完全不校验** fromIndex ⇒ 引擎判「不抛」
    // ⇒ L2 entry-may-throw 门禁假绿。校验口径与 indexOf 同款。
    validateIndexArg(args[1], "includes fromIndex may not be convertible to a number");
    return abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial");
  }
  // C1.4 / Bug 49/51：mutator 在 $invoke 调用点就地变更（writeInPlace 保持
  // Abs 身份 → 变量别名 / 成员槽 / Map 条目同步可见），表达式内连续
  // mutator 按求值顺序生效；返回值按 JS 语义（push/unshift → 新长度）
  //
  // Bug 254：泛型接收者（数组样对象 `{length, 0: …}`）——原生 mutator 家族
  // 只要求接收者有可写的 length 与索引属性 ⇒ 返回值同样按数组语义算
  // （push/unshift → 新长度、pop/shift → 被移除的元素）。
  /** 数组样接收者（obj）的 length 槽 → 具体长度（不可判定 → undefined） */
  const arrayLikeLen = (): number | undefined => {
    const s = arr.shape as { k: string; slots?: Record<string, { value: Abs }> };
    if (s.k !== "obj" || !s.slots) return undefined;
    const lenAbs = getSlot(s.slots, "length")?.value;
    if (lenAbs === undefined) return 0;
    const lvR = litValue(lenAbs);
    const lv = lvR.ok ? lvR.value : undefined;
    if (lv === undefined) return lenAbs.term?.op === "lit" ? 0 : undefined;
    if (typeof lv === "bigint" || typeof lv === "symbol") return undefined;
    const n = typeof lv === "number" ? lv : Number(lv); // string / boolean / null
    if (Number.isNaN(n)) return 0;
    return Math.min(Math.max(Math.trunc(n), 0), Number.MAX_SAFE_INTEGER);
  };
  /** 数组样接收者的第 i 位槽值（缺席 → undefined） */
  const arrayLikeAt = (i: number): Abs | undefined => {
    const s = arr.shape as { k: string; slots?: Record<string, { value: Abs }> };
    if (s.k !== "obj" || !s.slots) return undefined;
    return getSlot(s.slots, String(i))?.value;
  };
  if (method === "push" || method === "unshift") {
    const preLen =
      shape.k === "tuple"
        ? shape.elements.length
        : (arr.shape as { k: string }).k === "arr"
          ? undefined
          : arrayLikeLen();
    $arrMutContainer(arr, method, args);
    // tuple 长度精确（原长 + 实参个数）；抽象 arr 长度未知
    return preLen === undefined
      ? abs({ k: "prim", type: "number" }, undefined, undefined, "path")
      : numLit(preLen + args.length);
  }
  if (method === "pop") {
    // 返回值取自变更前快照（旧 shape 对象不受 writeBack 影响）
    let ret: Abs;
    if (shape.k === "tuple") {
      ret =
        shape.elements.length > 0
          ? (shape.elements[shape.elements.length - 1] ?? unknown)
          : undefAbs();
    } else if ((arr.shape as { k: string }).k === "arr") {
      ret = joinAbs((arr.shape as { k: "arr"; element: Abs }).element, undefAbs());
    } else {
      // Bug 254：泛型接收者——pop 返回变更前的末位（缺席 ⇒ undefined）
      const len = arrayLikeLen();
      ret =
        len === undefined
          ? unknown
          : len === 0
            ? undefAbs()
            : (arrayLikeAt(len - 1) ?? undefAbs());
    }
    $arrMutContainer(arr, method, args);
    return ret;
  }
  if (method === "shift") {
    let ret: Abs;
    if (shape.k === "tuple") {
      // 空元组 ⇒ 移出 undefined（原生 `Array.prototype.shift.call([])` → undefined）。
      // 此前「tuple 且非空」才进本臂 ⇒ 空元组落到下面的**泛型接收者**臂，
      // 而 arrayLikeLen() 对 tuple 返回 undefined ⇒ 折 unknown。
      // （注：数组**字面量** `[]` 在引擎里是抽象 `arr` 而非 0-tuple ⇒ 它的
      //  OOB 读仍折 unknown —— 那是**建模限制**（空数组应折 undefined），
      //  与本臂无关，改前改后一致。）
      ret = shape.elements.length > 0 ? (shape.elements[0] ?? unknown) : undefAbs();
    } else if ((arr.shape as { k: string }).k === "arr") {
      ret = joinAbs((arr.shape as { k: "arr"; element: Abs }).element, undefAbs());
    } else {
      // Bug 254：泛型接收者——shift 返回变更前的首位（缺席 ⇒ undefined）
      const len = arrayLikeLen();
      ret =
        len === undefined
          ? unknown
          : len === 0
            ? undefAbs()
            : (arrayLikeAt(0) ?? undefAbs());
    }
    $arrMutContainer(arr, method, args);
    return ret;
  }
  if (method === "at") {
    // ToIntegerOrInfinity：缺省/undefined/null/NaN → 0；true → 1；'1' → 1；
    // 1.9 → 1；±∞ → OOB undefined。抽象下标 join 全部元素 ∪ undefined。
    // Bug 67：symbol/bigint 下标确定 TypeError（shape 判定——无 lit 项）；
    // 抽象下标 → may TypeError 后走保守 join
    validateIndexArg(args[0], "at index may not be convertible to a number");
    const iv = toIntegerOrInfinityLit(args[0]);
    if (shape.k === "tuple") {
      const els = shape.elements;
      if (iv === undefined) {
        if (els.length === 0) return undefAbs();
        return joinAbs(els.reduce((a, b) => joinAbs(a, b)), undefAbs());
      }
      const idx = iv < 0 ? els.length + iv : iv;
      if (idx >= 0 && idx < els.length) return els[idx] ?? unknown;
      return undefAbs();
    }
    if (shape.k === "arr") return joinAbs(shape.element, undefAbs());
  }
  if (method === "splice") {
    // Bug 33/49：返回被删元素 tuple（取自变更前快照），调用点经
    // $arrMutContainer 就地变更。start/deleteCount 经 ToIntegerOrInfinity
    //（symbol/bigint 确定 TypeError；抽象 → may——与 $arrMutContainer
    // 同款校验）；items 实参不校验（原生存储不转换）。native：缺省
    // deleteCount（仅 start）→ 删到尾；显式 undefined → 0；start ≥ len →
    // 空删。抽象 arr 接收者 / 不可判定下标 → 保守 arr（元素域）。
    validateIndexArg(args[0], "splice start may not be convertible to a number");
    validateIndexArg(args[1], "splice deleteCount may not be convertible to a number");
    if (shape.k === "arr") {
      $arrMutContainer(arr, method, args);
      return abs({ k: "arr", element: shape.element }, undefined, undefined, "partial");
    }
    if ((arr.shape as { k: string }).k === "obj") {
      // Bug 254：泛型接收者（数组样对象）——被删元素按**变更前**的索引槽读
      // （缺席 ⇒ undefined）；写面由 $arrMutContainer 的数组样分支承担。
      const len = arrayLikeLen();
      if (len === undefined) {
        $arrMutContainer(arr, method, args);
        return unknown;
      }
      const win = spliceWindow(len, toIOIArg(args[0]), toIOIArg(args[1]), args.length === 0);
      if (win === "unknown") {
        $arrMutContainer(arr, method, args);
        return unknown;
      }
      const removedEls: Abs[] = [];
      for (let k = win.a; k < win.a + win.skip; k++) {
        removedEls.push(arrayLikeAt(k) ?? undefAbs());
      }
      $arrMutContainer(arr, method, args);
      return abs(
        { k: "tuple", elements: removedEls },
        undefined,
        undefined,
        confJoin(arr.conf, "path"),
      );
    }
    const len = shape.elements.length;
    // Bug 270：删除窗口走 spliceWindow（与 toSpliced 臂共用的单一事实源）——
    // `splice()` 零实参 ⇒ 不删；`splice(0)` ⇒ deleteCount 缺省 ⇒ 删到尾；
    // `splice(0, undefined)` ⇒ deleteCount 在场（undefined ⇒ 0）⇒ 不删。
    const win = spliceWindow(len, toIOIArg(args[0]), toIOIArg(args[1]), args.length === 0);
    if (win === "unknown") {
      const el = len ? shape.elements.reduce((x, y) => joinAbs(x, y)) : unknown;
      const removed = abs({ k: "arr", element: el }, undefined, undefined, "partial");
      $arrMutContainer(arr, method, args);
      return removed;
    }
    const { a: start, skip: del } = win;
    const removed = abs(
      { k: "tuple", elements: shape.elements
        .slice(start, start + del)
        .map((el, i) => (isHole(start + i) ? undefAbs() : el)) },
      undefined,
      undefined,
      confJoin(arr.conf, "path"),
    );
    $arrMutContainer(arr, method, args);
    return removed;
  }
  if (method === "copyWithin") {
    // Bug 33/49：调用点经 $arrMutContainer 就地变更（copyWithinTuple——
    // 窗口 clamp/holes/倒序重叠全一致），返回接收者容器；抽象 arr → 元素域保持
    validateIndexArg(args[0], "copyWithin target may not be convertible to a number");
    return $arrMutContainer(arr, method, args);
  }
  return undefined;
}
