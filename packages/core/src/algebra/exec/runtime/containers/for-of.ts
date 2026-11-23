/**
 * for..of 迭代消费：有界 / 无界展开、live 集合视图、出口 join。
 *
 * 从 iterate.ts 抽出；能力函数与可迭代性守卫仍由 iterate 提供。
 */
import type { Abs } from "../../../abs.ts";
import { abs, litValue, unknown } from "../../../abs.ts";
import { pTrue } from "../../../pred.ts";
import {
  canonicalArrayIndex,
  joinAbs,
} from "../../../objects.ts";
import {
  enterPromiseForkArm,
  leavePromiseForkArm,
} from "../../../builtins.ts";
import {
  abstractSeqElementOf,
  collectionLiveEntries,
} from "../../../builtins/error/iterator.ts";
import { collectionExactLen, isMapAbs, isSetAbs } from "../../../collections.ts";
import {
  genDrainViewOf,
  matchIterElements,
  replayGenDeferred,
  userIterLenOf,
  userIterOf,
} from "../../match-iter.ts";
import { errorTypeAbs, recordMayThrow } from "../../may-throw.ts";
import {
  NudoThrow,
  confPartialPacked,
  isNudoBreak,
  isNudoContinue,
  undef,
} from "../state.ts";
import { anyMemberResult } from "../../member-diag.ts";
import { makeLoopWidener } from "../loop-widen.ts";
import { genReturnAtOf } from "../gen-return-at.ts";
import { applyLoopExitJoin } from "../loop-exit-join.ts";
import { noteLoopTruncation } from "../../../call-budget.ts";
import { markLiveContainer } from "./obj.ts";
import {
  DEFAULT_MAX_LOOP_ITERS,
  LOOP_TRUNCATION_LABEL,
  MAX_CONCRETE_LOOP_ITERS,
} from "../loop-budget.ts";
import {
  boxedStringLength,
  typedArrayIterElems,
} from "./iterate-brand-elements.ts";
import { iteratorClose } from "./user-iterator.ts";
import {
  $elems,
  asyncIterabilityKind,
  builtinExactIterableElems,
  elemsOf,
  guardIterable,
  iterabilityKind,
  iterableElementDomain,
  iterableExpandElements,
  iterableExactElements,
} from "./iterate.ts";

function sideIterLen(a: Abs): number | undefined {
  const mi = matchIterElements(a);
  if (mi) return mi.length;
  const gv = genDrainViewOf(a);
  if (gv) return gv.peekAll().length;
  // Bug 199：用户 iterable（迭代器已报告 done）⇒ 元素数确切
  const ul = userIterLenOf(a);
  if (ul !== undefined) return ul;
  return undefined;
}

/** Bug 98：for-in 快照键的在场重查——原生 EnumerateObjectProperties 到键
 *  时回查 [[GetOwnProperty]]，进体前被 delete 的键跳过该迭代。仅闭 obj
 *  （自有槽 hasOwnProperty 判定）与 tuple（hole 判定）可精确重查；其余面
 *  （any/unknown/prim/开 obj/抽象 arr/brand/fn/eff）键序列本身已是抽象
 *  近似 → 恒在场（保持体执行，0..N 出口 join 承接）。不走 $in：prim 接收
 *  者（字符串键来自字面量面，不可 delete）会被 $in 记 definite TypeError，
 *  而原生 for-in 对 prim 接收者零迭代不抛；$in 的原型链命中口径也与
 *  for-in 的「自有可枚举」判据不符。跳过 = 过近似的安全侧（漏跳只失精度）。 */
function forInKeyLive(key: Abs, recv: Abs): boolean {
  const s = recv?.shape;
  if (!s) return true;
  if (s.k === "sum") {
    // 任一臂在场即执行（union 接收者的键域是臂并的近似）
    for (const m of s.members) {
      if (forInKeyLive(key, m)) return true;
    }
    return false;
  }
  const kvR = litValue(key);
  const kv = kvR.ok && typeof kvR.value === "string" ? kvR.value : undefined;
  if (kv === undefined) return true; // 抽象键：不可判 → 保持执行
  if (s.k === "obj") {
    if (s.open) return true;
    return Object.prototype.hasOwnProperty.call(s.slots, kv);
  }
  if (s.k === "tuple") {
    const idx = canonicalArrayIndex(kv);
    if (idx === undefined) return false; // 非下标键不在数组键序列里
    return idx < s.elements.length && !(s.holes?.includes(idx) ?? false);
  }
  return true;
}

/**
 * Bug 248：数组（tuple）接收者的 **live 迭代视图**——原生 Array Iterator 语义：
 * `next()` 每步**重读** `LengthOfArrayLike(O)` 并现读 `Get(O, index)` ⇒
 * - 迭代期间的 `push` / `unshift`（长度增长）**可见**；
 * - `shift` / `pop`（长度收缩）**可见**（收缩后越过新末尾即结束）；
 * - 体内改写元素值**可见**（`for (const v of a) { a[1] = 9 }` 原生第二次迭代取 9）；
 * - hole 位按 Get 语义产出 `undefined`（**不跳过**——与 forEach 家族的
 *   HasProperty 口径相反）。
 *
 * 引擎的数组 mutator（`$arrMutContainer` → `writeInPlace`）与下标写
 * （`$idxSet`）都是**就地改写**（Abs 身份不变、shape 换新）⇒ 每步重读
 * `arr.shape` 即接收者当前内容。
 */
function arrayLiveForOf(
  arr: Abs,
  initial: Abs[],
): { take: () => Abs | undefined; rest: () => number } {
  const state = { i: 0 };
  const cur = (): { elements?: Abs[]; holes?: number[] } | undefined => {
    const s = arr.shape as { k: string; elements?: Abs[]; holes?: number[] };
    if (s.k !== "tuple") return undefined;
    return s;
  };
  return {
    take: (): Abs | undefined => {
      const s = cur();
      if (!s) {
        // 容器被降级为抽象 arr（长度不可知——原生仍是数组、长度未变）⇒ 回落
        // 进体前快照的剩余位（保守：不再因降级而提前结束迭代）。
        const v = initial[state.i];
        if (v === undefined) return undefined;
        state.i++;
        return v;
      }
      const els = s.elements ?? [];
      if (state.i >= els.length) return undefined; // 长度重读 ⇒ 收缩可见
      const i = state.i;
      state.i++;
      const holes = s.holes ?? [];
      return holes.includes(i) ? undef() : els[i]!;
    },
    rest: (): number => {
      const s = cur();
      if (!s) return Math.max(0, initial.length - state.i);
      return Math.max(0, (s.elements ?? []).length - state.i);
    },
  };
}

/** 无界迭代代表元的 join 上限（Bug 220）：用户迭代器采集可达
 *  USER_ITER_MAX_STEPS（1024）条，1024 路字面量并集会把下游算术/成员读
 *  拖死；超过即折 unknown（等价抽象、廉价）。 */
const UNBOUNDED_ITEM_JOIN_CAP = 8;

/**
 * Bug 220：无界（长度未知）迭代的**代表元素** = 已采集元素的元素域 join。
 *
 * 不得取 `items[0]` 这种具体值：`for (const x of o) { if (x > 0) break }`
 * 会被首元素 `0` **决定性**判假 ⇒ then 臂根本没被求值 ⇒ break 的
 * IteratorClose（`return()`）静默消失，引擎出口值与宿主相反。具体元素
 * 只能贡献「该值必然成立」的正向事实；代表元必须对整个未知元素域成立
 * （join 后条件两侧都会被探索）。
 *
 * 成本：采集触顶（尾域已折 unknown，见 elemsOf）或条目过多 ⇒ 元素域不可
 * 静态刻画 ⇒ 直接折 unknown（不得造 1024 路并集）。
 */
function abstractIterItem(items: Abs[]): Abs {
  if (items.length === 0) return unknown;
  // 尾域 unknown = 元素列表被截断（步数上界触顶 / done 抽象不可判）
  if (items.length > UNBOUNDED_ITEM_JOIN_CAP || items[items.length - 1] === unknown) {
    return unknown;
  }
  let acc = items[0]!;
  for (let i = 1; i < items.length; i++) acc = joinAbs(acc, items[i]!);
  return acc;
}

export function $forOf(
  iterable: Abs,
  body: (item: Abs, index: Abs) => void,
  maxIters: number = DEFAULT_MAX_LOOP_ITERS,
  opts?: {
    pack?: () => Abs;
    unpack?: (s: Abs) => void;
    /** 标签循环：仅吸收同标签 break/continue 信号 */
    label?: string;
    /** for await：接收者按 GetIterator(hint=async) 校验（@@asyncIterator 槽
     *  即全量）；仅异步可迭代（无 @@iterator 槽）的接收者不折同步槽位投影，
     *  元素取抽象 unknown（原生由 next() 链驱动）——**async generator 例外**
     *  （Bug 141）：它是生成器对象，元素域走元素侧表（与同步 generator
     *  同口径）。 */
    forAwait?: boolean;
    /** for-in（Bug 98）：接收者重查 thunk——快照键进体前重查在场，体内
     *  delete 的未访问键跳过该迭代（与原生 EnumerateObjectProperties 的
     *  逐键 [[GetOwnProperty]] 回查一致）。thunk 每迭代重读当前绑定，
     *  `delete o.k` 的写回（o = $del(o, k)）经闭包变量可见。 */
    forInRecv?: () => Abs;
  },
): void {
  const pack = opts?.pack;
  const unpack = opts?.unpack;
  // Bug 98：for-in 在场重查 thunk（见 opts.forInRecv 注释）
  const forInRecv = opts?.forInRecv;
  // 循环携带绑定宽化器（Bug 47）：unbounded 单代表迭代的出口 join 是
  // {0 次, 1 次} 两个打包态——常步长累加器（n++ / n += 2）跨迭代增长，
  // 1 次代表不能覆盖任意迭代次数（原生 xs.length 任意）；增长槽位宽化
  // 到无上界域（sound），join-幂等绑定不动（行为不变）
  const widen = pack ? makeLoopWidener() : undefined;
  let exitJoin: Abs | undefined;
  const snapExit = (): void => {
    if (!pack) return;
    const s = pack();
    widen?.observe(s);
    exitJoin = exitJoin ? joinAbs(exitJoin, s) : s;
  };
  const applyExitJoin = (): void => {
    // Bug 215 + 出口宽化统一收口（loop-exit-join.ts）；$forOf 出口恒宽化
    // （exhausted 固定 true，与旧 `widen ? widenFinal(joined) : joined` 等价）。
    applyLoopExitJoin({ pack, unpack, exitJoin, widen, exhausted: true });
  };

  const shape = iterable.shape;
  // for await：异步可迭代性校验 + 元素域。仅异步可迭代接收者（只有
  // @@asyncIterator 槽）元素取抽象 unknown——不得折同步 $elems 投影
  //（对象槽位不是迭代产出，Bug 13 值域）；同步可迭代接收者走同步元素
  //（规范回退：同步迭代器逐项 await，promise 元素解包内层）。
  // Bug 141：async generator 是「仅异步可迭代的**生成器对象**」——元素
  // 域与长度都取自元素侧表（不得落 unknown 快路径）。
  const forAwait = opts?.forAwait === true;
  const asyncOnly =
    forAwait &&
    shape.k === "obj" &&
    !shape.slots["@@iterator"] &&
    !!shape.slots["@@asyncIterator"];
  if (forAwait) {
    const kind = asyncIterabilityKind(iterable);
    if (kind === "definite") throw new NudoThrow(errorTypeAbs("TypeError"));
    if (kind === "may") {
      recordMayThrow({
        kind: "TypeError",
        cause: "for-await iteration over possibly non-iterable value",
      });
    }
  }
  const awaitElem = (x: Abs): Abs =>
    x.shape.k === "eff" && x.shape.eff === "promise" ? x.shape.inner : x;
  const svR = litValue(iterable);
  const sv = svR.ok ? svR.value : undefined;
  // tuple / 确切 Set·Map 条目数 / 字符串字面量 code points → 有界展开；
  // 抽象 arr 与 maybeAbsent 仍 0..max join
  // Bug 22：生成器对象（obj + 元素侧表）按侧表长度精确展开（原 tuple
  // 直接读 elements；表示改 obj 后经 matchIterElements 取数）
  // Bug 54：长度探测先于 $elems（消费排空）——生成器按**消费前**剩余
  // 长度展开，与 items 快照一致
  // Bug 56/57：Arguments / Proxy brand——迭代长度按内层靶投影（元素侧
  // elemsOf 已剥层；无此长度归一 for-of 退单代表 + 出口宽化）
  const lenShape =
    shape.k === "brand" && (shape.name === "Arguments" || shape.name === "Proxy")
      ? (shape.shape as Abs).shape
      : shape;
  const knownLenPre =
    lenShape.k === "tuple"
      ? lenShape.elements.length
      : typeof sv === "string"
        ? [...sv].length
        : // Bug 236：boxed String 品牌——length 自有槽（原生可迭代，长度可知）
          boxedStringLength(iterable) ??
          // BUG-125：URLSearchParams 条目数可判（@@iterator === entries）
          builtinExactIterableElems(iterable)?.length ??
          // TypedArray brand：内层索引槽齐备时长度精确（与 spread/rest 同
          // 能力源；此前 for-of 退 unbounded ⇒ 计数折抽象）。
          (shape.k === "brand" ? typedArrayIterElems(iterable)?.length : undefined) ??
          (collectionExactLen(iterable) ?? sideIterLen(iterable));
  const items = asyncOnly
    ? // Bug 141：async generator（**生成器对象**，只有 @@asyncIterator 槽）——
      // 元素域走**元素侧表**，与同步 generator 同口径（此前落 asyncOnly 的
      // unknown 快路径 ⇒ for-await 元素域退 unknown，累加值精度回退）。
      // 非生成器的仅异步可迭代对象元素域不可静态刻画 → 仍折 unknown。
      (genDrainViewOf(iterable) ? elemsOf(iterable).map(awaitElem) : [unknown])
    : forAwait
      ? // Bug 34：for-await 消费生成器同样重放体内延迟异常（规范同步迭代器
        // 回退路径，元素逐项 await）
        (replayGenDeferred(iterable), elemsOf(iterable).map(awaitElem))
      : $elems(iterable);
  // Bug 199：用户 iterable 的元素数在**采集之后**才确切（迭代器报告 done
  // 才有确切长度）——长度探测须在 $elems 之后补一次（生成器路径相反：长度
  // 探测必须先于 $elems，见上方 knownLenPre 注释）。
  const knownLen = knownLenPre ?? userIterLenOf(iterable);
  // Bug 199：本次迭代的**用户迭代器**（元素采集时登记）——非正常出口的
  // IteratorClose（调 return()）取用。采集后立即捕获：嵌套迭代同一接收者
  // 时内层会覆盖侧表，外层必须握住自己那一个。
  const userIter = userIterOf(iterable);
  // ABS-13：引擎生成器对象自身就是迭代器（`g[Symbol.iterator]()` 返回 g）——
  // 非正常出口的 IteratorClose 必须调到它的 `return()`（native 语义），
  // 否则 `.return()` 的 finalizer 重放与 yield* 转发都不会发生。
  const closeTarget =
    userIter ?? (genDrainViewOf(iterable) !== undefined ? iterable : undefined);
  // 非具体容器：长度未知（可能空、可能更长）→ 单代表元素只跑一次
  // （同一元素重复 join 幂等，maxIters 次展开只会让索引假精确 + 大数组
  // 反复深拷贝把分析拖死）；0 次出口由下方 snapExit join，保持 sound。
  const unbounded = knownLen === undefined;
  /**
   * ABS-13：生成器被 `$elems` 提前排空 ⇒ 非正常出口不能只调 `.return()`
   * （已 done）。按「已消费 consumed 个 yield」回到挂起点重放 finalizer；
   * 帧不可用 / 代表迭代（位置不可知）⇒ false，调用方回退既有 sound 面。
   */
  const closeGeneratorAt = (consumed: number): boolean => {
    if (unbounded || closeTarget === undefined) return false;
    const fn = genReturnAtOf(closeTarget);
    if (fn === undefined) return false;
    return fn(consumed, undef()) !== undefined;
  };
  // Bug 198：Map/Set 的 for-of 必须是接收者的 **live 视图**——原生迭代器
  // 持有条目指针：迭代期间新增的条目被访问、删除的条目被跳过
  // （`for (const [k] of m) { out.push(k); m.set("b",2) }` 原生 "a,b"，
  // 引擎快照口径只有 "a"）。表不干净 ⇒ 无 live 视图 ⇒ 沿用快照口径。
  const liveColl =
    isMapAbs(iterable) || isSetAbs(iterable) ? collectionLiveEntries(iterable) : undefined;
  // Bug 248：数组接收者的 live 视图（原生 Array Iterator 每步重读长度）——
  // 迭代期间的 push/shift 与元素改写可见；快照口径只看得到进体前的内容。
  const liveArr =
    shape.k === "tuple"
      ? // BUG-161：登记 live 接收者——条件分支臂的 `$copy` 副本在 fork join
        // 后经 `$syncLive` 写回这个身份，下一轮 take() 才读得到新长度/元素。
        (markLiveContainer(iterable),
        arrayLiveForOf(iterable, (shape as { elements: Abs[] }).elements))
      : undefined;

  // N5：0 次出口臂（空容器/首元素前退出——同迭代后出口路径）
  if (unbounded) {
    enterPromiseForkArm();
    leavePromiseForkArm();
    snapExit();
  }

  // 具体迭代空间（tuple / 字符串 code points / Set·Map 精确条目数）：展开到
  // 具体硬上限——maxIters 截断具体迭代会产出错误 #exact（countChars 对
  // 12 字符串只跑 8 轮得 8 #exact，原生是 12）。超硬上限 → 截断观测 +
  // 绑定 conf 降级（有界、可观测）。调用方显式给更大预算时以其为准
  // （maxLoopIters 是对外契约）。抽象 arr（maybeAbsent / 长度未知）仍走
  // maxIters 单代表元素 + 出口 join（抽象预算语义不变）。
  const concreteCap = Math.max(maxIters, MAX_CONCRETE_LOOP_ITERS);
  // live 集合（Bug 198）：条目数可随迭代增长（新增条目被访问）⇒ 迭代上界
  // 用硬上限（concreteCap），耗尽由 live 驱动的 take() 返回 undefined 判定。
  // Bug 248：live 数组同理——长度可随迭代增长（push 可见）。
  const n = liveColl || liveArr
    ? concreteCap
    : knownLen !== undefined
      ? Math.min(knownLen, concreteCap)
      : items.length > 0
        ? 1
        : 0;
  const concreteOverrun = knownLen !== undefined && knownLen > concreteCap;

  // Bug 220：无界（长度未知）代表元 = 元素域 join（见 abstractIterItem）——
  // 单代表迭代只跑一次，但这一次必须代表**整个未知元素域**，不得用首个
  // 具体元素去决定分支（否则 break 的 then 臂 + IteratorClose 被静默丢弃）。
  const unboundedItem = unbounded ? abstractIterItem(items) : undefined;

  for (let i = 0; i < n; i++) {
    let item: Abs;
    if (liveColl) {
      // live 视图：每轮重读接收者当前条目表（删除的跳过、新增的进入）
      const e = liveColl.take();
      if (e === undefined) break; // 迭代耗尽（原生 done）
      item = e;
    } else if (liveArr) {
      // Bug 248：live 数组——每轮重读当前长度与当前元素（原生 Array Iterator）
      const e = liveArr.take();
      if (e === undefined) break; // 迭代耗尽（原生 done）
      item = e;
    } else {
      // Bug 220：无界代表元（元素域 join）；有界具体迭代仍逐元素取（精确）
      item = unbounded ? unboundedItem! : items.length > 0 ? items[Math.min(i, items.length - 1)]! : unknown;
    }
    // Bug 98：for-in 快照键进体前重查在场——被 delete 的键跳过本迭代
    //（体副作用不发生；skip 在 fork 臂外，不产悬挂 arm）
    if (forInRecv && !forInKeyLive(item, forInRecv())) continue;
    // N5：unbounded（长度未知，可能空）迭代 = 条件路径：体臂 + 出口臂
    //（空容器路径直达循环后——无 post-loop settle 覆盖则悬挂）
    if (unbounded) enterPromiseForkArm();
    try {
      body(
        item,
        unbounded
          ? abs({ k: "prim", type: "number" }, undefined, undefined, "partial")
          : abs(
              { k: "prim", type: "number" },
              { op: "lit", value: i },
              pTrue,
              "exact",
            ),
      );
    } catch (e) {
      if (isNudoBreak(e, opts?.label)) {
        // Bug 199：break 是 abrupt completion ⇒ IteratorClose（调 return()）
        // ABS-13：生成器按已消费下标回到挂起点重放 finalizer（否则已排空）
        if (!closeGeneratorAt(i + 1)) iteratorClose(closeTarget);
        // break 打断代表体（fork 的 break 臂冒泡，后续语句丢失）——完整
        // 迭代效应不可观测，「先跑任意次再 break」的累加器域必须整体宽化
        if (unbounded && e.abstract) widen?.markInterrupted();
        applyExitJoin();
        return;
      }
      if (isNudoContinue(e, opts?.label)) {
        // continue 同款：本迭代剩余语句丢失（单代表迭代后循环即结束）
        // ——循环**未**退出 ⇒ 不 IteratorClose（原生同：continue 不关闭迭代器）
        if (unbounded && e.abstract) widen?.markInterrupted();
        continue; // 下一个元素；已发生副作用保留
      }
      // 其余 abrupt completion（return / throw / 指向外层标签的 break 或
      // continue）——循环退出 ⇒ IteratorClose（原生规范：任何 abrupt
      // completion 都关闭迭代器）。close 内的异常取代原完成值。
      if (!closeGeneratorAt(i + 1)) iteratorClose(closeTarget);
      throw e;
    } finally {
      if (unbounded) leavePromiseForkArm();
    }
    if (unbounded) {
      // N5：出口臂（本迭代后退出——代表迭代之后的元素路径直达循环后）
      enterPromiseForkArm();
      leavePromiseForkArm();
      snapExit();
    }
  }
  if (unbounded && n === 0) {
    // N5：0 次出口臂（空容器路径）
    enterPromiseForkArm();
    leavePromiseForkArm();
    snapExit();
  }
  if (liveColl && liveColl.rest().length > 0) {
    // Bug 198：live 集合迭代到硬上限仍未耗尽 ⇒ 截断观测（与具体迭代超限同口径）
    noteLoopTruncation(LOOP_TRUNCATION_LABEL);
    if (pack && unpack) unpack(confPartialPacked(pack()));
    return;
  }
  if (liveArr && liveArr.rest() > 0) {
    // Bug 248：live 数组迭代到硬上限仍未耗尽 ⇒ 截断观测（同 live 集合口径）
    noteLoopTruncation(LOOP_TRUNCATION_LABEL);
    if (pack && unpack) unpack(confPartialPacked(pack()));
    return;
  }
  if (concreteOverrun) {
    noteLoopTruncation(LOOP_TRUNCATION_LABEL);
    if (pack && unpack) unpack(confPartialPacked(pack()));
    return;
  }
  applyExitJoin();
}

/**
 * Map/Set forEach：条目表逐条调用回调（value, key, recv）。
 * 回调是 求值引擎 JS 函数（transpile 内联箭头）直接调用；Abs fn 走 $call。
 * 回调返回值丢弃；forEach 表达式值恒 undefined。
 *
 * Bug 198：**live 视图**——原生 forEach 持条目指针：迭代期间新增的条目被
 * 访问、删除的条目被跳过（`m.forEach(v => { out.push(k); m.set("b",2) })`
 * 原生 "a,b"，引擎快照口径只有 "a"）。表不干净（shadow / maybeAbsent）⇒
 * 无 live 视图 ⇒ 沿用快照口径。
 */
