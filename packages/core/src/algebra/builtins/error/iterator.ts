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
 * - BUG-114（ES2025 助手惰性面）：map / filter / take / drop / flatMap 返回
 *   **惰性 wrapper**——创建期只做原生同步校验（回调可调用 / limit ToNumber），
 *   **不触碰源**；next() / 迭代消费才逐条拉源（原生 %IteratorHelperPrototype%
 *   语义）。此前创建期 drainRemaining() 排空源 ⇒ `const m = it.map(f);
 *   it.next().done` 折 true（原生 false）、`[...it].length` 折 0（原生 2）。
 *   长度为**数据依赖**（filter / flatMap / 抽象 limit / 抽象源）时**不挂消费
 *   视图**：spread / for-of 退保守面，元素个数只由终端助手方法按实际消费报告
 *   （不得折确定的错误长度）。
 */

import type { Abs } from "../../abs.ts";
import { abs, boolLit, bool, numLit, unknown, litValue } from "../../abs.ts";
import { joinAbs, setSlot, getSlot } from "../../objects.ts";
import { undefAbs, applyCallbackValue, validateCallableArg } from "../../hof.ts";
import { pTrue } from "../../pred.ts";
import { emptyEnv } from "../../ast-env.ts";
import { defaultLeakBudget } from "../../diagnostics/leak.ts";
import { NudoThrow } from "../../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../../exec/may-throw.ts";
import { litTruth } from "../../exec/runtime/state.ts";
import { TUPLE_MATERIALIZE_CAP } from "../../containers.ts";
import { registerGenElements, registerGenDrain, matchIterElements, genDrainViewOf } from "../../exec/match-iter.ts";
import { absFunction } from "../../abs-fn.ts";
import { markFreshInstance } from "../../key/instance-id.ts";
import { setPropFlags } from "../invariants.ts";
import { noBody } from "../shared.ts";
import { isMapAbs, isSetAbs, mapEntriesAbs, setElementsAbs, collectionExactLen } from "../../collections.ts";
// BUG-114：flatMap 的 GetIteratorFlattenable 展开复用 $elems 的迭代序口径
// （用户 iterable / 内建可迭代面单一实现）。iterate.ts 已反向 import 本模块
// 的 collectionLiveEntries——函数级环（两侧都只在运行期调用，无模块期求值）。
import { $elems, builtinExactIterableElems } from "../../exec/runtime/containers/iterate.ts";

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

// ---------------------------------------------------------------------------
// BUG-114：ES2025 %IteratorPrototype% 助手方法的**惰性**实现
// ---------------------------------------------------------------------------

/** 惰性助手的一次拉取结果（原生 {value, done} 的抽象面）：
 *  - value：done 确定 false
 *  - done： done 确定 true
 *  - maybe：done 不可判（抽象长度的源 / 抽象谓词）——value 是若未耗尽的元素域 */
type IterStep =
  | { k: "value"; value: Abs }
  | { k: "done" }
  | { k: "maybe"; value: Abs };

/** 迭代消费面（终端助手方法共用）：els = 已枚举剩余元素（迭代序）；
 *  known = 元素个数**确切**；tail = 长度不可判时的尾部元素域。 */
interface IterRest {
  els: Abs[];
  known: boolean;
  tail?: Abs;
}

/** 本模块自建迭代器的剩余长度是否**确切**（惰性助手判断结果长度的静态
 *  事实；只说明「会不会确定耗尽」，元素数由消费面实时给出）。 */
const exactLenTables = new WeakMap<object, boolean>();

function exactRemaining(a: Abs | undefined): boolean {
  return a !== undefined && exactLenTables.get(a as object) === true;
}

/** 自建迭代器的剩余元素消费面（终端助手方法 / 助手消费视图共用）。 */
const restTables = new WeakMap<object, () => IterRest>();

function restOf(a: Abs): IterRest {
  const f = restTables.get(a as object);
  if (f) return f();
  // $copy 派生副本只迁移 match-iter 侧表（消费视图随身份迁移、本表不迁）——
  // 终端助手从消费视图取剩余（长度确切：本表只在该视图存在时登记）
  const gv = genDrainViewOf(a);
  if (gv) return { els: gv.drain(), known: true };
  return { els: [], known: false, tail: unknown };
}

/** 迭代器对象的 next 方法槽（obj / brand 内层 obj）。 */
function nextMethodOf(src: Abs): Abs | undefined {
  const inner = src.shape.k === "brand" ? src.shape.shape : src;
  const is = inner.shape;
  return is.k === "obj" ? getSlot(is.slots, "next")?.value : undefined;
}

/** next() 结果对象的 value / done 槽（obj / brand 内层 obj）。 */
function resultSlotOf(res: Abs, key: string): Abs | undefined {
  const inner = res.shape.k === "brand" ? res.shape.shape : res;
  const is = inner.shape;
  return is.k === "obj" ? getSlot(is.slots, key)?.value : undefined;
}

/** 源拉取器：调源的 next()（this = 源）；done 抽象 → maybe。
 *  next 缺失（建模缺口）⇒ maybe(unknown)——保守，不凭空定抛。 */
function makeSourcePull(src: Abs): () => IterStep {
  return (): IterStep => {
    const fn = nextMethodOf(src);
    if (!fn) return { k: "maybe", value: unknown };
    const res = applyCallbackValue(fn, [], emptyEnv(), pTrue, defaultLeakBudget, src);
    const done = litTruth(resultSlotOf(res, "done") ?? unknown);
    if (done === true) return { k: "done" };
    const value = resultSlotOf(res, "value") ?? unknown;
    return done === false ? { k: "value", value } : { k: "maybe", value };
  };
}

/** 拉尽源（抽象 limit 的 take/drop 结果域）：元素列表 + 尾部域。 */
function drainPulls(pull: () => IterStep): IterRest {
  const els: Abs[] = [];
  let tail: Abs | undefined;
  for (;;) {
    const s = pull();
    if (s.k === "done") break;
    if (s.k === "maybe") {
      tail = tail === undefined ? s.value : joinAbs(tail, s.value);
      break;
    }
    els.push(s.value);
  }
  return { els, known: false, tail };
}

/** 元素列表/尾部域 → join（空 ⇒ unknown，不折 bottom）。 */
function joinDomain(items: Abs[], tail?: Abs): Abs {
  const all = tail !== undefined ? [...items, tail] : items;
  return all.length ? all.reduce((x, y) => joinAbs(x, y)) : unknown;
}

/** 助手 toArray 的数组面：cap 内逐元素 tuple / 超 cap 退 arr 元素域。 */
function helperArray(items: Abs[]): Abs {
  return items.length > TUPLE_MATERIALIZE_CAP
    ? abs(
        { k: "arr", element: items.length ? items.reduce((x, y) => joinAbs(x, y)) : unknown },
        undefined,
        undefined,
        "path",
      )
    : abs({ k: "tuple", elements: items }, undefined, undefined, "exact");
}

/** 终端助手 toArray 结果：长度确切 ⇒ 元素表；否则 arr 元素域（长度不可知，
 *  不得折确定元数）。 */
function helperArrayOf(r: IterRest): Abs {
  if (r.known) return helperArray(r.els);
  return abs({ k: "arr", element: joinDomain(r.els, r.tail) }, undefined, undefined, "path");
}

/** take/drop 的 limit 参数（原生 ToNumber → NaN/负值 ⇒ 定抛 RangeError →
 *  ToIntegerOrInfinity）。字面量面精确判定；抽象面返回 undefined 并记
 *  may-throw（NaN/负值 RangeError；ToNumber 触达 valueOf 时可能 TypeError）。 */
function countLimitOf(arg: Abs | undefined, what: string): number | undefined {
  // 缺省实参 ≡ undefined → ToNumber(undefined) = NaN → 原生定抛 RangeError
  if (arg === undefined) throw new NudoThrow(errorTypeAbs("RangeError"));
  const v = litValue(arg);
  if (v.ok) {
    const raw = v.value;
    if (typeof raw === "symbol" || typeof raw === "bigint") {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    let n: number;
    if (raw === null) n = 0;
    else if (typeof raw === "boolean") n = raw ? 1 : 0;
    else if (typeof raw === "number") n = raw;
    else if (typeof raw === "string") n = Number(raw);
    else if (raw === undefined) n = NaN;
    else return undefined; // 对象字面量：ToNumber 走 valueOf（不可静态判）
    if (Number.isNaN(n)) throw new NudoThrow(errorTypeAbs("RangeError"));
    if (n < 0) throw new NudoThrow(errorTypeAbs("RangeError"));
    return Math.trunc(n);
  }
  const k = arg.shape.k;
  if (k === "prim") {
    const t = (arg.shape as { type?: string }).type;
    if (t === "bigint" || t === "symbol") throw new NudoThrow(errorTypeAbs("TypeError"));
    recordMayThrow({ kind: "RangeError", cause: `${what} may be NaN or negative` });
    return undefined;
  }
  recordMayThrow({ kind: "RangeError", cause: `${what} may be NaN or negative` });
  recordMayThrow({ kind: "TypeError", cause: `${what} ToNumber may throw` });
  return undefined;
}

/** flatMap 的映射值是否原生 prim（GetIteratorFlattenable 的
 *  reject-primitives ⇒ 定抛 TypeError；字符串**不**按字符展开）。 */
function isPrimLike(v: Abs): boolean {
  if (v.shape.k === "prim") return true;
  if (v.term?.op === "lit") {
    const x = v.term.value;
    return x === null || x === undefined || (typeof x !== "object" && typeof x !== "function");
  }
  return false;
}

/** flatMap 展开值的元素个数是否确切（抽象数组 / 截断的用户迭代器 ⇒ false）。 */
function flattenLenExact(v: Abs): boolean {
  if (v.shape.k === "tuple" || v.shape.k === "never") return true;
  if (isSetAbs(v) || isMapAbs(v)) return collectionExactLen(v) !== undefined;
  if (builtinExactIterableElems(v) !== undefined) return true;
  if (matchIterElements(v) !== undefined) return true;
  if (genDrainViewOf(v) !== undefined) return true;
  if (v.shape.k === "brand") return flattenLenExact(v.shape.shape);
  return false;
}

/** flatMap 的 GetIteratorFlattenable(mapped, reject-primitives) 投影。 */
function flattenMapped(v: Abs): { els: Abs[]; known: boolean } {
  if (isPrimLike(v)) throw new NudoThrow(errorTypeAbs("TypeError"));
  const known = flattenLenExact(v);
  // $elems 与 spread / for-of 同口径：内建可迭代面精确展开、用户 iterable
  // 按迭代序取、不可迭代对象按 guardIterable 记定抛/可能抛。
  return { els: $elems(v), known };
}

/** 惰性迭代器的剩余长度判断面（终端助手 consumeRest 时已是最终状态）：
 *  tail 已出现 ⇒ 源耗尽不可判；否则整条剩余序列已被确定枚举。 */
interface IterLenState {
  tail?: Abs;
  drained: boolean;
}

/**
 * 惰性助手迭代器（ES2025 `%IteratorHelperPrototype%` 的建模）：
 * 创建期**不触碰源**；`pull` 每次给出一个产出步骤。`lenKnown` 是创建期的
 * 静态事实（确切时挂消费视图 ⇒ spread / for-of / Array.from 可精确展开）；
 * `lenKnownNow` 在消费后按实际拉取状态判定（take 取满 limit、filter/flatMap
 * 的数据依赖以 tail / dataDependent 表达）——数据依赖长度**不挂视图**，
 * 长度只由终端助手方法按实际消费报告。
 */
function makeLazyIterator(
  pull: () => IterStep,
  opts: { lenKnown: boolean; lenKnownNow?: (st: IterLenState) => boolean },
): Abs {
  const pending: Abs[] = [];
  let drained = false;
  let tail: Abs | undefined;

  /** 当前剩余长度是否确切：创建期静态事实 ∪ 消费后的动态判定。 */
  const lenKnownOf = (): boolean =>
    opts.lenKnown || (opts.lenKnownNow?.({ tail, drained }) ?? false);

  /** 拉下一个产出（销毁性：结果直接交给 next()）。 */
  const step = (): IterStep => {
    const queued = pending.shift();
    if (queued !== undefined) return { k: "value", value: queued };
    if (drained) return { k: "done" };
    if (tail !== undefined) return { k: "maybe", value: tail };
    const s = pull();
    if (s.k === "value") return s;
    if (s.k === "done") drained = true;
    else tail = s.value;
    return s;
  };

  /** 把可枚举的剩余元素拉到 pending 至少 n 个（peek 的非推进面用；遇到
   *  maybe 停——剩余面由 tail 域承担）。 */
  const ensure = (n: number): void => {
    while (!drained && tail === undefined && pending.length < n) {
      const s = pull();
      if (s.k === "value") {
        pending.push(s.value);
        continue;
      }
      if (s.k === "done") drained = true;
      else tail = s.value;
    }
  };

  const materialize = (): void => ensure(Number.POSITIVE_INFINITY);

  const drainRest = (): Abs[] => {
    materialize();
    const out = pending.splice(0, pending.length);
    return tail === undefined ? out : [...out, tail];
  };

  const consumeRest = (): IterRest => {
    materialize();
    const els = pending.splice(0, pending.length);
    return { els, known: lenKnownOf(), tail };
  };

  const peekAll = (): Abs[] => {
    materialize();
    return [...pending];
  };

  const next = absFunction(
    [],
    {
      body: noBody,
      apply: (): Abs => {
        const s = step();
        if (s.k === "done") return iterResultAbs(undefAbs(), true);
        if (s.k === "value") return iterResultAbs(s.value, false);
        // done 不可判：value 域 = 元素域 ∪ undefined（原生 done 时 value 为 undefined）
        return abs(
          {
            k: "obj",
            slots: {
              value: { value: joinAbs(s.value, undefAbs()) },
              done: { value: bool() },
            },
          },
          undefined,
          undefined,
          "partial",
        );
      },
    },
    { ctor: false },
  );
  const slots: Record<string, { value: Abs }> = {
    next: { value: next },
    "@@iterator": { value: absFunction([], { body: noBody }, { ctor: false }) },
  };
  const iter = abs({ k: "obj", slots }, undefined, undefined, "partial");
  // Bug 314：@@iterator 返自身
  setSlot(slots, "@@iterator", { value: selfIteratorFn(iter) });
  const helpers = iteratorHelperSlots(iter);
  for (const [k, v] of Object.entries(helpers)) setSlot(slots, k, v);
  setPropFlags(iter, "next", { enumerable: false });
  setPropFlags(iter, "@@iterator", { enumerable: false });
  for (const k of Object.keys(helpers)) setPropFlags(iter, k, { enumerable: false });
  exactLenTables.set(iter as object, opts.lenKnown);
  restTables.set(iter as object, consumeRest);
  if (opts.lenKnown) {
    registerGenDrain(iter, {
      drain: drainRest,
      peek: (i: number): Abs | undefined => {
        ensure(i + 1);
        return i < pending.length ? pending[i]! : undefAbs();
      },
      peekAll,
    });
  }
  return markFreshInstance(iter);
}

/**
 * ES2025 `%IteratorPrototype%` 助手方法槽（原生在原型上、非自有可枚举）：
 * map / filter / take / drop / flatMap 返回**惰性** wrapper（创建期不触碰源，
 * 只做原生同步校验）；toArray / reduce / forEach / some / every / find 是终端
 * 面——当场消费剩余元素（消费面取 restTables，长度确切与否由实现报告）。
 */
function iteratorHelperSlots(src: Abs): Record<string, { value: Abs }> {
  const pullSrc = makeSourcePull(src);
  const helperFn = (apply: (args: Abs[]) => Abs): Abs =>
    absFunction([], { body: noBody, apply }, { ctor: false });
  /** 已校验回调的调用（创建期校验对齐原生「先校验后迭代」）。 */
  const runCb = (fn: Abs | undefined, cbArgs: Abs[]): Abs =>
    fn === undefined ? unknown : applyCallbackValue(fn, cbArgs, emptyEnv(), pTrue, defaultLeakBudget);
  /** 终端面元素序列：长度不可判时尾部域作为代表元素并入（sound 单代表）。 */
  const terminalItems = (r: IterRest): Abs[] =>
    r.tail === undefined ? r.els : [...r.els, r.tail];

  return {
    toArray: { value: helperFn((): Abs => helperArrayOf(restOf(src))) },
    map: {
      value: helperFn((args: Abs[]): Abs => {
        const fn = args[0];
        const cause = "Iterator.prototype.map callback may not be callable";
        validateCallableArg(fn, cause);
        let i = 0;
        return makeLazyIterator(
          (): IterStep => {
            const s = pullSrc();
            if (s.k === "done") return s;
            // 源耗尽不可判 ⇒ 不调回调（避免虚假定抛）；元素域折 unknown
            if (s.k === "maybe") return { k: "maybe", value: unknown };
            return { k: "value", value: runCb(fn, [s.value, numLit(i++)]) };
          },
          // 消费后：map 不改变元素数——整条剩余序列确定枚举 ⇒ 长度确切
          { lenKnown: exactRemaining(src), lenKnownNow: (st) => st.tail === undefined },
        );
      }),
    },
    filter: {
      value: helperFn((args: Abs[]): Abs => {
        const fn = args[0];
        const cause = "Iterator.prototype.filter callback may not be callable";
        validateCallableArg(fn, cause);
        let i = 0;
        // 谓词真值抽象 ⇒ 保留元素与结果长度都是数据依赖（不得折精确长度）
        let dataDependent = false;
        return makeLazyIterator(
          (): IterStep => {
            let maybe: Abs | undefined;
            for (;;) {
              const s = pullSrc();
              if (s.k === "done") {
                return maybe === undefined ? s : { k: "maybe", value: maybe };
              }
              if (s.k === "maybe") {
                // 源耗尽不可判：本步保留域 = 已见可能保留元素 ∪ 源元素域
                dataDependent = true;
                return {
                  k: "maybe",
                  value: maybe === undefined ? s.value : joinAbs(maybe, s.value),
                };
              }
              const t = litTruth(runCb(fn, [s.value, numLit(i++)]));
              if (t === false) continue;
              if (t === true) {
                // 之前的真值不可判元素也可能才是原生首个匹配 ⇒ 并入保留域
                return {
                  k: "value",
                  value: maybe === undefined ? s.value : joinAbs(maybe, s.value),
                };
              }
              dataDependent = true;
              maybe = maybe === undefined ? s.value : joinAbs(maybe, s.value);
            }
          },
          // 消费后：确定枚举到 done 且谓词真值全确定 ⇒ 长度确切
          { lenKnown: false, lenKnownNow: (st) => st.tail === undefined && !dataDependent },
        );
      }),
    },
    take: {
      value: helperFn((args: Abs[]): Abs => {
        const limit = countLimitOf(args[0], "Iterator.prototype.take count");
        if (limit === undefined) {
          // 抽象 limit：可能抛（已记 may）；未抛时取 0..N 个 ⇒ 长度不可知。
          // 首次消费拉出源剩余元素域，之后恒 maybe（不重复拉源）。
          let pulled = false;
          return makeLazyIterator(
            (): IterStep => {
              if (pulled) return { k: "done" };
              pulled = true;
              const r = drainPulls(pullSrc);
              if (r.els.length === 0 && r.tail === undefined) return { k: "done" };
              return { k: "maybe", value: joinDomain(r.els, r.tail) };
            },
            { lenKnown: false },
          );
        }
        let left = limit;
        return makeLazyIterator(
          (): IterStep => {
            if (left <= 0) return { k: "done" };
            const s = pullSrc();
            if (s.k === "value") left--;
            return s;
          },
          // 消费后：取满 limit / 源确定耗尽 ⇒ 长度确切（与源的剩余可知性无关）
          { lenKnown: exactRemaining(src), lenKnownNow: (st) => st.tail === undefined },
        );
      }),
    },
    drop: {
      value: helperFn((args: Abs[]): Abs => {
        const limit = countLimitOf(args[0], "Iterator.prototype.drop count");
        if (limit === undefined) {
          let pulled = false;
          return makeLazyIterator(
            (): IterStep => {
              if (pulled) return { k: "done" };
              pulled = true;
              const r = drainPulls(pullSrc);
              if (r.els.length === 0 && r.tail === undefined) return { k: "done" };
              return { k: "maybe", value: joinDomain(r.els, r.tail) };
            },
            { lenKnown: false },
          );
        }
        let skipped = false;
        return makeLazyIterator(
          (): IterStep => {
            if (!skipped) {
              skipped = true;
              // 跳过 limit 个元素（原生惰性跳过；源先耗尽 ⇒ done）
              for (let k = 0; k < limit; k++) {
                const s = pullSrc();
                if (s.k === "done") return s;
                if (s.k === "maybe") return { k: "maybe", value: unknown };
              }
            }
            return pullSrc();
          },
          // 消费后：确定枚举到 done ⇒ 长度确切（跳过数与源一致）
          { lenKnown: exactRemaining(src), lenKnownNow: (st) => st.tail === undefined },
        );
      }),
    },
    flatMap: {
      value: helperFn((args: Abs[]): Abs => {
        const fn = args[0];
        const cause = "Iterator.prototype.flatMap callback may not be callable";
        validateCallableArg(fn, cause);
        let i = 0;
        const queue: Abs[] = [];
        let dataDependent = false;
        return makeLazyIterator(
          (): IterStep => {
            for (;;) {
              const queued = queue.shift();
              if (queued !== undefined) return { k: "value", value: queued };
              const s = pullSrc();
              if (s.k === "done") return s;
              // 源耗尽不可判 ⇒ 不调回调（避免虚假定抛）
              if (s.k === "maybe") {
                dataDependent = true;
                return { k: "maybe", value: unknown };
              }
              const flat = flattenMapped(runCb(fn, [s.value, numLit(i++)]));
              if (!flat.known) dataDependent = true;
              if (flat.els.length === 0) continue;
              queue.push(...flat.els);
            }
          },
          // 消费后：确定枚举到 done 且每次展开长度确切 ⇒ 总长度确切
          { lenKnown: false, lenKnownNow: (st) => st.tail === undefined && !dataDependent },
        );
      }),
    },
    reduce: {
      value: helperFn((args: Abs[]): Abs => {
        const cause = "Iterator.prototype.reduce callback may not be callable";
        validateCallableArg(args[0], cause);
        const r = restOf(src);
        const items = terminalItems(r);
        const hasInit = args.length >= 2;
        if (items.length === 0) {
          if (!hasInit) {
            // 长度不可判：原生可能空（TypeError）也可能不空（不抛）
            if (!r.known) {
              recordMayThrow({ kind: "TypeError", cause });
              return unknown;
            }
            throw new NudoThrow(errorTypeAbs("TypeError"));
          }
          return args[1]!;
        }
        let acc = hasInit ? args[1]! : items[0]!;
        const start = hasInit ? 0 : 1;
        for (let i = start; i < items.length; i++) acc = runCb(args[0], [acc, items[i]!, numLit(i)]);
        return acc;
      }),
    },
    forEach: {
      value: helperFn((args: Abs[]): Abs => {
        const cause = "Iterator.prototype.forEach callback may not be callable";
        validateCallableArg(args[0], cause);
        const items = terminalItems(restOf(src));
        for (let i = 0; i < items.length; i++) runCb(args[0], [items[i]!, numLit(i)]);
        return undefAbs();
      }),
    },
    some: {
      value: helperFn((args: Abs[]): Abs => {
        const cause = "Iterator.prototype.some callback may not be callable";
        validateCallableArg(args[0], cause);
        const r = restOf(src);
        // 长度不可判 ⇒ 即使当前没有真值，也可能存在未枚举的匹配元素
        let sawUnknown = !r.known;
        const items = terminalItems(r);
        for (let i = 0; i < items.length; i++) {
          const t = litTruth(runCb(args[0], [items[i]!, numLit(i)]));
          if (t === true) return boolLit(true);
          if (t === undefined) sawUnknown = true;
        }
        return sawUnknown ? bool() : boolLit(false);
      }),
    },
    every: {
      value: helperFn((args: Abs[]): Abs => {
        const cause = "Iterator.prototype.every callback may not be callable";
        validateCallableArg(args[0], cause);
        const r = restOf(src);
        let sawUnknown = !r.known;
        const items = terminalItems(r);
        for (let i = 0; i < items.length; i++) {
          const t = litTruth(runCb(args[0], [items[i]!, numLit(i)]));
          if (t === false) return boolLit(false);
          if (t === undefined) sawUnknown = true;
        }
        return sawUnknown ? bool() : boolLit(true);
      }),
    },
    find: {
      value: helperFn((args: Abs[]): Abs => {
        const cause = "Iterator.prototype.find callback may not be callable";
        validateCallableArg(args[0], cause);
        const r = restOf(src);
        let maybe: Abs | undefined; // 真值不可判的「可能首个匹配」
        let result: Abs | undefined; // 确定匹配（含之前所有可能匹配的 join）
        const items = terminalItems(r);
        for (let i = 0; i < items.length; i++) {
          const el = items[i]!;
          const t = litTruth(runCb(args[0], [el, numLit(i)]));
          if (t === false) continue;
          if (t === undefined) {
            maybe = maybe === undefined ? el : joinAbs(maybe, el);
            continue;
          }
          // 后到的确定匹配**不得独占**：首个匹配可能是之前任一 unknown 元素
          result = maybe === undefined ? el : joinAbs(maybe, el);
          break;
        }
        if (result !== undefined) return result;
        // 无确定匹配：可能匹配域 ∪ 未枚举尾部域；都可能落空 ⇒ 并入 undefined
        const possible =
          maybe === undefined ? r.tail : r.tail === undefined ? maybe : joinAbs(maybe, r.tail);
        return possible === undefined ? undefAbs() : joinAbs(possible, undefAbs());
      }),
    },
  };
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
   * Map / Set 迭代器都继承 ⇒ `.values().toArray()` 恒可调用。
   *
   * 语义：助手消费迭代器**剩余元素**（与 next 共享游标 / live 视图）；
   * map / filter / take / drop / flatMap 返回**惰性** wrapper（创建期不触碰
   * 源，见 iteratorHelperSlots）；终端面当场驱动回调。所有槽
   * `enumerable:false`（原生在原型上，Object.keys(iter) 仍为 []）。
   */
  const drainRemaining = (): Abs[] => {
    if (live) return live.takeAll();
    const remaining = [...liveEls];
    liveEls.length = 0;
    state.i = els.length;
    return remaining;
  };
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
  const helperSlots = iteratorHelperSlots(iter);
  for (const [k, v] of Object.entries(helperSlots)) setSlot(slots, k, v);
  setPropFlags(iter, "next", { enumerable: false });
  setPropFlags(iter, "@@iterator", { enumerable: false });
  // Bug 198 根治点：live 迭代器**不登记静态侧表**（见上注释）——元素面
  // 由下面的消费视图（live 视图）承担；快照模式才登记静态元素表。
  // BUG-114：助手方法原生在 %IteratorPrototype%（非自有可枚举）——
  // Object.keys(iter) / for-in 的键视图仍为空。
  for (const k of Object.keys(helperSlots)) setPropFlags(iter, k, { enumerable: false });
  // BUG-114：快照 / live 集合迭代器的剩余长度都**确切**（元素数由消费面
  // 实时给出）——惰性助手的 lenKnown / 终端助手据此判定结果长度。
  exactLenTables.set(iter as object, true);
  restTables.set(iter as object, () => ({ els: drainRemaining(), known: true }));
  if (!live) registerGenElements(iter, liveEls);
  registerGenDrain(iter, {
    drain: drainRemaining,
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
