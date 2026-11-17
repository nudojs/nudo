/**
 * 集合迭代器协议对象：collectionIteratorAbs（Map/Set/Array 的
 * keys/values/entries——条目表精确展开）+ abstractSeqIteratorAbs（长度
 * 未知 arr 接收者）+ Map/Set 条目投影（mapEntryKey/setEntryTuple）。
 *
 * Invariants:
 * - 协议面 = obj + next 方法槽（按调用序折 {value, done}，耗尽 →
 *   {value: undefined, done: true}）+ @@iterator 槽；next/@@iterator 打
 *   enumerable:false（原生在 %ArrayIteratorPrototype% 等原型上，
 *   Object.keys(iter)/for-in/assign 折空，Bug 66 同口径）。
 * - 精确迭代器挂元素侧表（registerGenElements/registerGenDrain）——
 *   spread/for-of/Array.from/.next() 链路全求值；消费位 live 视图
 *  （next() 推进收缩、drain 从当前位取剩余并排空，Bug 54）。
 * - abstractSeqIteratorAbs 长度不可知**不挂元素侧表**：next() 折
 *   {value: el ∪ undefined, done: boolean 域}（可能已耗尽），spread/
 *   for-of 走 unbounded join 保守面（不折精确长度）。
 * - 每次调用产出新迭代器对象（markFreshInstance，R2b）；条目投影供
 *   dispatch.ts 的 Map/Set 迭代 case 复用。
 * - Bug 198：collectionIteratorFor 产出**接收者 live 视图**的迭代器（条目
 *   表按访问序取，条目身份去重 ⇒ 回调/循环体里的增删删改对迭代可见）——
 *   collectionIteratorAbs 的**快照**语义保留给静态视图（Array.from 等）。
 *   live 视图与快照路径**同口径投影**（Map 的 keys/values 给键/值、Set 的
 *   entries 给 [el,el] 元组）——投影逻辑只有一份（project 闭包）。
 * - Bug 198 根治点（S17）：**live 迭代器不登记静态元素侧表**——静态表一旦
 *   登记，matchIterElements 会命中创建期快照（长度探针 sideIterLen 读到
 *   冻结长度 ⇒ for-of 多跑/少跑一轮，迭代器不再随接收者变化）。live 的
 *   元素面由 registerGenDrain 的**消费视图**（live.take/takeAll/rest）承担。
 */

import type { Abs } from "../../abs.ts";
import { abs, boolLit, bool, numLit, unknown, litValue } from "../../abs.ts";
import { joinAbs, setSlot } from "../../objects.ts";
import { undefAbs, applyCallbackValue, validateCallableArg } from "../../hof.ts";
import { pTrue } from "../../pred.ts";
import { emptyEnv } from "../../ast-env.ts";
import { defaultLeakBudget } from "../../diagnostics/leak.ts";
import { NudoThrow } from "../../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../../exec/may-throw.ts";
import { litTruth } from "../../exec/runtime/state.ts";
import { TUPLE_MATERIALIZE_CAP } from "../../containers.ts";
import { registerGenElements, registerGenDrain } from "../../exec/match-iter.ts";
import { absFunction } from "../../abs-fn.ts";
import { markFreshInstance } from "../../key/instance-id.ts";
import { setPropFlags } from "../invariants.ts";
import { noBody } from "../shared.ts";
import { isMapAbs, isSetAbs, mapEntriesAbs, setElementsAbs, collectionExactLen } from "../../collections.ts";

/** Bug 23：迭代器结果对象 {value, done}（生成器对象 genIterResult 同款） */
function iterResultAbs(value: Abs, done: boolean): Abs {
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
 * Bug 198：集合条目的 **live 视图**（Map/Set 接收者）——原生迭代器持有条目
 * 指针：迭代期间**新增**的条目会被访问、**删除**的条目被跳过
 * （`m.forEach` / `for (const [k] of m)` / `m.keys()` 皆如此）。引擎此前
 * 一次性快照条目表 ⇒ 新增条目看不到、已删条目仍被访问（陈旧值）。
 *
 * 模型：每轮**重读**接收者当前条目表，按「已访问条目身份」挑出下一个未访问
 * 条目。条目身份 = Map 的**键**（原生键唯一 ⇒ 身份即键）/ Set 的元素——
 * 字面量取值标记，引用取 Abs 身份。
 */
export interface CollectionLiveEntries {
  /** 下一个未访问条目（重读接收者当前表）；无则 undefined（迭代耗尽） */
  take(): Abs | undefined;
  /** 全部剩余未访问条目（重读当前表；**标记**已访问） */
  takeAll(): Abs[];
  /** 剩余未访问条目（重读当前表；**不**标记） */
  rest(): Abs[];
}

/** 条目身份：字面量 → 值标记（Map 键 / Set 元素值唯一）；引用 → Abs 身份 */
function collectionEntryId(el: Abs): unknown {
  const lv = litValue(el);
  if (lv.ok) {
    const v = lv.value;
    return `lit:${typeof v}:${String(v)}`;
  }
  return el;
}

/**
 * Bug 198：集合（Map/Set）条目的 live 视图构造器。
 *
 * 表**不干净**（Map 有 shadow 值 / maybeAbsent，Set 有 maybeAbsent）⇒
 * 条目身份不可稳定判定 ⇒ 返回 undefined（调用方回落快照口径）。
 */
export function collectionLiveEntries(recv: Abs): CollectionLiveEntries | undefined {
  if (collectionExactLen(recv) === undefined) return undefined;
  const isMap = isMapAbs(recv);
  if (!isMap && !isSetAbs(recv)) return undefined;
  const visited = new Set<unknown>();
  const idOf = (e: Abs): unknown => {
    if (!isMap) return collectionEntryId(e);
    const key =
      e.shape.k === "tuple" && e.shape.elements.length >= 2 ? e.shape.elements[0]! : undefined;
    return key === undefined ? e : collectionEntryId(key);
  };
  const entries = (): Abs[] => (isMap ? mapEntriesAbs(recv) : setElementsAbs(recv));
  return {
    take: (): Abs | undefined => {
      for (const e of entries()) {
        const id = idOf(e);
        if (visited.has(id)) continue;
        visited.add(id);
        return e;
      }
      return undefined;
    },
    takeAll: (): Abs[] => {
      const out: Abs[] = [];
      for (const e of entries()) {
        const id = idOf(e);
        if (visited.has(id)) continue;
        visited.add(id);
        out.push(e);
      }
      return out;
    },
    rest: (): Abs[] => {
      const out: Abs[] = [];
      for (const e of entries()) {
        if (visited.has(idOf(e))) continue;
        out.push(e);
      }
      return out;
    },
  };
}

/**
 * Bug 314：迭代器的 `@@iterator` **自反性**——原生 `it[Symbol.iterator]()`
 * 返回**自身**（`it[Symbol.iterator]() === it` 为 true；Set/Map/Array/字符串
 * 迭代器皆然）。此前 @@iterator 槽是 noBody 占位（调出来 undefined）⇒ 自反
 * 判定折 false（`it[Symbol.iterator]() === it` → false）。
 *
 * 建模口径：**relation fn**（returnType = 迭代器自身）——$call 的 relation 面
 * 直接返 returnType（同引用 ⇒ === 折 true）。
 *
 * 为什么不用 apply（apply 也能拿 thisVal 返接收者）：iterate.ts 的
 * `hasRealImpl` 以「有 apply / 有真 body」判「用户实现的 fn」——引擎原生
 * 迭代器的 @@iterator 一旦带 apply，就会被误判为**用户 iterable**（走
 * collectUserIterElems 用户协议路径），改写迭代消费面（live 迭代器的
 * 元素面 / 步数上界 / IteratorClose 登记口径全变）。relation fn 不带
 * apply / 不带真 body ⇒ hasRealImpl 仍为 false ⇒ 迭代消费面**原样不动**。
 */
function selfIteratorFn(iter: Abs): Abs {
  return absFunction(
    [],
    { relation: { paramTypes: [], returnType: iter } },
    { ctor: false, returnType: iter },
  );
}

/**
 * Bug 23：Map/Set keys/values/entries 迭代器对象——生成器对象（Bug 22）
 * 同款协议面：obj + next 方法槽（按调用序折 {value, done}，耗尽 →
 * {value: undefined, done: true}）+ @@iterator 槽 + 元素侧表
 * （registerGenElements）——spread/for-of/Array.from/.next() 链路全求值。
 * Bug 63：Array.prototype.entries/keys/values（tuple 接收者）同款复用。
 * Bug 66 同口径：next/@@iterator 槽打 enumerable:false——原生迭代器 next
 * 在 %ArrayIteratorPrototype% 等原型上（非自有可枚举），Object.keys(iter)
 * / for-in / assign 折空。
 *
 * Bug 198：`live` 非空时迭代器是**接收者的 live 视图**——每次 next() 重读
 * 接收者当前条目表（删除的条目跳过、新增的条目被访问）；缺省（快照）时是
 * 创建时拷出的元素表。
 *
 * Bug 198 根治点（S17）：`live` 非空时**不登记静态元素侧表**
 * （registerGenElements）——静态表是创建期的元素拷贝，一旦登记，
 * matchIterElements 就会命中它（长度探针 sideIterLen 读它 ⇒ for-of 的
 * 迭代轮数停在创建时刻；元素面也退成快照）⇒ 迭代器不再随接收者变化。
 * live 的元素面由 registerGenDrain 的**消费视图**承担（live.take /
 * takeAll / rest 每次重读接收者当前表）；快照模式（live 缺省）仍登记
 * 静态侧表（静态视图：Array.from / 展开 / for-of 的精确长度）。
 */
export function collectionIteratorAbs(els: Abs[], live?: CollectionLiveEntries): Abs {
  const state = { i: 0 };
  // Bug 54：消费位 live 视图——next() 推进时收缩；迭代消费（spread /
  // for-of / Array.from / 解构）经 drain 从当前位取剩余并排空
  const liveEls: Abs[] = [...els];
  const next = absFunction(
    [],
    {
      body: noBody,
      apply: (): Abs => {
        if (live) {
          const v = live.take();
          if (v === undefined) return iterResultAbs(undefAbs(), true);
          return iterResultAbs(v, false);
        }
        if (state.i >= els.length) return iterResultAbs(undefAbs(), true);
        const v = els[state.i]!;
        state.i++;
        if (liveEls.length > 0) liveEls.shift();
        return iterResultAbs(v, false);
      },
    },
    { ctor: false },
  );
  const slots: Record<string, { value: Abs }> = {
    next: { value: next },
    "@@iterator": { value: absFunction([], { body: noBody }, { ctor: false }) },
  };
  /**
   * BUG-114：ES2025 `%IteratorPrototype%` 助手方法（`toArray` / `map` /
   * `filter` / `take` / `drop` / `flatMap` / `reduce` / `forEach` / `some` /
   * `every` / `find`）。原生这些方法挂在 `%IteratorPrototype%` 上，Array /
   * Map / Set 迭代器都继承 ⇒ `.values().toArray()` 恒可调用。此前协议对象
   * 只有 `next` / `@@iterator` 两个槽 ⇒ 第一次属性读落 miss ⇒ 调用未知
   * 记 TypeError（L2 假红，与 env 的 Iterator brand 声明自相矛盾）。
   *
   * 语义：助手消费迭代器**剩余元素**（与 next 共享游标 / live 视图）；
   * map / filter / take / drop / flatMap 产出新的集合迭代器（元素表为
   * 求值结果，惰性时机差异记为精度边，不伪造副作用）；reduce / forEach /
   * some / every / find 当场驱动回调。所有槽 `enumerable:false`（原生在
   * 原型上，Object.keys(iter) 仍为 []）。
   */
  const drainRemaining = (): Abs[] => {
    if (live) return live.takeAll();
    const remaining = [...liveEls];
    liveEls.length = 0;
    state.i = els.length;
    return remaining;
  };
  const helperArray = (items: Abs[]): Abs =>
    items.length > TUPLE_MATERIALIZE_CAP
      ? abs(
          { k: "arr", element: items.length ? items.reduce((x, y) => joinAbs(x, y)) : unknown },
          undefined,
          undefined,
          "path",
        )
      : abs({ k: "tuple", elements: items }, undefined, undefined, "exact");
  const helperFn = (apply: (args: Abs[]) => Abs): Abs =>
    absFunction([], { body: noBody, apply }, { ctor: false });
  const callCb = (fn: Abs | undefined, cbArgs: Abs[], cause: string): Abs => {
    validateCallableArg(fn, cause);
    if (!fn) return unknown;
    return applyCallbackValue(fn, cbArgs, emptyEnv(), pTrue, defaultLeakBudget);
  };
  const countOf = (arg: Abs | undefined): number | undefined => {
    const v = litValue(arg ?? unknown);
    if (!v.ok) return undefined;
    const raw = v.value;
    // ToIntegerOrInfinity 字面量面：undefined/null → 0；boolean → 0/1；
    // string → ToNumber（NaN → 0）；number NaN → 0；负值 → RangeError；
    // symbol / bigint → TypeError（原生 ToNumber 定抛）。
    if (raw === undefined || raw === null) return 0;
    if (typeof raw === "boolean") return raw ? 1 : 0;
    if (typeof raw === "symbol" || typeof raw === "bigint") {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    let n: number;
    if (typeof raw === "number") n = raw;
    else if (typeof raw === "string") n = Number(raw);
    else return undefined;
    if (Number.isNaN(n)) return 0;
    if (n < 0) throw new NudoThrow(errorTypeAbs("RangeError"));
    return Math.trunc(n);
  };
  const flattenOne = (v: Abs): Abs[] => {
    if (v.shape.k === "tuple") return [...v.shape.elements];
    if (v.shape.k === "arr") return [v.shape.element];
    if (isSetAbs(v)) return setElementsAbs(v);
    if (isMapAbs(v)) return mapEntriesAbs(v);
    const lv = litValue(v);
    if (lv.ok && typeof lv.value === "string") {
      return [...lv.value].map((c) => abs({ k: "prim", type: "string" }, { op: "lit", value: c }, pTrue, "exact"));
    }
    return [v];
  };
  const helperSlots: Record<string, { value: Abs }> = {
    toArray: {
      value: helperFn((): Abs => helperArray(drainRemaining())),
    },
    map: {
      value: helperFn((args: Abs[]): Abs => {
        const src = drainRemaining();
        return collectionIteratorAbs(
          src.map((el, i) => callCb(args[0], [el, numLit(i)], "Iterator.prototype.map callback may not be callable")),
        );
      }),
    },
    filter: {
      value: helperFn((args: Abs[]): Abs => {
        const src = drainRemaining();
        const out: Abs[] = [];
        for (let i = 0; i < src.length; i++) {
          const keep = litTruth(
            callCb(args[0], [src[i]!, numLit(i)], "Iterator.prototype.filter callback may not be callable"),
          );
          // 抽象谓词：保留元素（过度近似；native 可能过滤掉它）
          if (keep !== false) out.push(src[i]!);
        }
        return collectionIteratorAbs(out);
      }),
    },
    take: {
      value: helperFn((args: Abs[]): Abs => {
        const n = countOf(args[0]);
        if (n === undefined) {
          recordMayThrow({ kind: "RangeError", cause: "Iterator.prototype.take count may be negative or invalid" });
          return abstractSeqIteratorAbs(unknown);
        }
        return collectionIteratorAbs(drainRemaining().slice(0, n));
      }),
    },
    drop: {
      value: helperFn((args: Abs[]): Abs => {
        const n = countOf(args[0]);
        if (n === undefined) {
          recordMayThrow({ kind: "RangeError", cause: "Iterator.prototype.drop count may be negative or invalid" });
          return abstractSeqIteratorAbs(unknown);
        }
        return collectionIteratorAbs(drainRemaining().slice(n));
      }),
    },
    flatMap: {
      value: helperFn((args: Abs[]): Abs => {
        const src = drainRemaining();
        const out: Abs[] = [];
        for (let i = 0; i < src.length; i++) {
          out.push(
            ...flattenOne(
              callCb(args[0], [src[i]!, numLit(i)], "Iterator.prototype.flatMap callback may not be callable"),
            ),
          );
        }
        return collectionIteratorAbs(out);
      }),
    },
    reduce: {
      value: helperFn((args: Abs[]): Abs => {
        const src = drainRemaining();
        validateCallableArg(args[0], "Iterator.prototype.reduce callback may not be callable");
        const hasInit = args.length >= 2;
        if (src.length === 0) {
          if (!hasInit) throw new NudoThrow(errorTypeAbs("TypeError"));
          return args[1]!;
        }
        let acc = hasInit ? args[1]! : src[0]!;
        const start = hasInit ? 0 : 1;
        for (let i = start; i < src.length; i++) {
          acc = callCb(
            args[0],
            [acc, src[i]!, numLit(i)],
            "Iterator.prototype.reduce callback may not be callable",
          );
        }
        return acc;
      }),
    },
    forEach: {
      value: helperFn((args: Abs[]): Abs => {
        const src = drainRemaining();
        for (let i = 0; i < src.length; i++) {
          callCb(args[0], [src[i]!, numLit(i)], "Iterator.prototype.forEach callback may not be callable");
        }
        return undefAbs();
      }),
    },
    some: {
      value: helperFn((args: Abs[]): Abs => {
        const src = drainRemaining();
        let sawUnknown = false;
        for (let i = 0; i < src.length; i++) {
          const t = litTruth(callCb(args[0], [src[i]!, numLit(i)], "Iterator.prototype.some callback may not be callable"));
          if (t === true) return boolLit(true);
          if (t === undefined) sawUnknown = true;
        }
        return sawUnknown ? bool() : boolLit(false);
      }),
    },
    every: {
      value: helperFn((args: Abs[]): Abs => {
        const src = drainRemaining();
        let sawUnknown = false;
        for (let i = 0; i < src.length; i++) {
          const t = litTruth(callCb(args[0], [src[i]!, numLit(i)], "Iterator.prototype.every callback may not be callable"));
          if (t === false) return boolLit(false);
          if (t === undefined) sawUnknown = true;
        }
        return sawUnknown ? bool() : boolLit(true);
      }),
    },
    find: {
      value: helperFn((args: Abs[]): Abs => {
        const src = drainRemaining();
        let sawUnknown = false;
        for (let i = 0; i < src.length; i++) {
          const el = src[i]!;
          const t = litTruth(callCb(args[0], [el, numLit(i)], "Iterator.prototype.find callback may not be callable"));
          if (t === true) return el;
          if (t === undefined) sawUnknown = true;
        }
        return sawUnknown ? joinAbs(src.length ? src.reduce((x, y) => joinAbs(x, y)) : unknown, undefAbs()) : undefAbs();
      }),
    },
  };
  for (const [k, v] of Object.entries(helperSlots)) setSlot(slots, k, v);
  const iter = abs(
    { k: "obj", slots },
    undefined,
    undefined,
    els.every((e) => e.conf === "exact") ? "exact" : "path",
  );
  // Bug 314：@@iterator 返自身（原生 it[Symbol.iterator]() === it）——槽值
  // 换成 relation fn（returnType = 本迭代器）。占位（noBody）先建再换：
  // relation fn 的 returnType 需引用迭代器自身（先有迭代器后有 fn）。
  setSlot(slots, "@@iterator", { value: selfIteratorFn(iter) });
  setPropFlags(iter, "next", { enumerable: false });
  setPropFlags(iter, "@@iterator", { enumerable: false });
  // Bug 198 根治点：live 迭代器**不登记静态侧表**（见上注释）——元素面
  // 由下面的消费视图（live 视图）承担；快照模式才登记静态元素表。
  // BUG-114：助手方法原生在 %IteratorPrototype%（非自有可枚举）——
  // Object.keys(iter) / for-in 的键视图仍为空。
  for (const k of Object.keys(helperSlots)) setPropFlags(iter, k, { enumerable: false });
  if (!live) registerGenElements(iter, liveEls);
  registerGenDrain(iter, {
    drain: (): Abs[] => {
      if (live) return live.takeAll();
      const remaining = [...liveEls];
      liveEls.length = 0;
      state.i = els.length;
      return remaining;
    },
    peek: (i: number): Abs | undefined =>
      live ? live.rest()[i] : i < liveEls.length ? liveEls[i] : undefAbs(),
    peekAll: (): Abs[] => (live ? live.rest() : [...liveEls]),
  });
  // R2b：每次 entries/keys/values 调用产出新迭代器对象——打新鲜实例标
  return markFreshInstance(iter);
}

/**
 * Bug 198：Map/Set 的 keys/values/entries 迭代器（**live 视图**版）——
 * 原生迭代器持有条目指针：迭代期间删除的条目被跳过、新增的条目被访问
 * （`const it = m.keys(); it.next(); m.delete("b"); it.next().done` 原生
 * true，引擎快照口径折 false）。
 *
 * **投影同口径**（S17 根治点）：live 视图与快照路径走**同一份** project
 * 闭包——Map 的 keys/values 给键/值（不是 [k,v] 条目元组），Set 的 entries
 * 给 [el,el] 元组（不是元素本身）。此前 live 视图吐的是**未投影**的原始
 * 条目（collectionLiveEntries 直接返回条目表）⇒ next().value 给原始条目
 * （wrong-exact）。
 *
 * 表不干净（shadow / maybeAbsent）⇒ 无 live 视图 ⇒ 回落快照口径（同样
 * 走 project 投影）。
 */
export function collectionIteratorFor(
  recv: Abs,
  mode: "keys" | "values" | "entries",
): Abs {
  const isMap = isMapAbs(recv);
  const entries = isMap ? mapEntriesAbs(recv) : setElementsAbs(recv);
  const project = (e: Abs): Abs => {
    if (isMap) {
      if (mode === "keys") return mapEntryKey(e);
      if (mode === "values") {
        return e.shape.k === "tuple" && e.shape.elements.length >= 2
          ? e.shape.elements[1]!
          : unknown;
      }
      return e;
    }
    return mode === "entries" ? setEntryTuple(e) : e;
  };
  // live 视图与快照**同口径投影**：live 视图的 take/takeAll/rest 都先过
  // project（否则 live 分支给的是原始条目 ⇒ next().value 投影错配）。
  const raw = collectionLiveEntries(recv);
  const live: CollectionLiveEntries | undefined = raw
    ? {
        take: (): Abs | undefined => {
          const e = raw.take();
          return e === undefined ? undefined : project(e);
        },
        takeAll: (): Abs[] => raw.takeAll().map(project),
        rest: (): Abs[] => raw.rest().map(project),
      }
    : undefined;
  return collectionIteratorAbs(entries.map(project), live);
}

/**
 * Bug 63：抽象序列（长度未知 arr 接收者）的 keys/values/entries 迭代器
 * 对象。协议面与 collectionIteratorAbs 一致（next 槽 + @@iterator + 均
 * 不可枚举 → Array.isArray 折 false、Object.keys 折 []、typeof .next 折
 * "function"）；长度不可知**不挂元素侧表**——next() 折
 * {value: el ∪ undefined, done: boolean 域}（可能已耗尽），spread/for-of
 * 走 unbounded join 保守面（不折精确长度）。
 */
export function abstractSeqIteratorAbs(el: Abs): Abs {
  const next = absFunction(
    [],
    {
      body: noBody,
      apply: (): Abs =>
        abs(
          {
            k: "obj",
            slots: {
              value: { value: joinAbs(el, undefAbs()) },
              done: { value: bool() },
            },
          },
          undefined,
          undefined,
          "partial",
        ),
    },
    { ctor: false },
  );
  const slots: Record<string, { value: Abs }> = {
    next: { value: next },
    "@@iterator": { value: absFunction([], { body: noBody }, { ctor: false }) },
  };
  const iter = abs(
    {
      k: "obj",
      slots,
    },
    undefined,
    undefined,
    "partial",
  );
  // Bug 314：同 collectionIteratorAbs——@@iterator 返自身
  setSlot(slots, "@@iterator", { value: selfIteratorFn(iter) });
  setPropFlags(iter, "next", { enumerable: false });
  setPropFlags(iter, "@@iterator", { enumerable: false });
  // R2b：同 collectionIteratorAbs——每次调用新迭代器对象
  return markFreshInstance(iter);
}

/** Bug 23：Map 迭代条目的 key 投影（条目是 [k, v] 元组；非元组臂 → unknown） */
export function mapEntryKey(e: Abs): Abs {
  if (e.shape.k === "tuple" && e.shape.elements.length >= 1) return e.shape.elements[0]!;
  return unknown;
}

/** Bug 23：Set 元素 → [el, el] 条目元组（Set#entries 原生语义） */
export function setEntryTuple(el: Abs): Abs {
  return abs(
    { k: "tuple", elements: [el, el] },
    undefined,
    undefined,
    el.conf,
  );
}
