/**
 * 迭代协议与 spread/rest 投影：$elems/$forOf/$concat/$arrRest/$iterCheck。
 *
 * Invariants:
 * - brand 只是名义标签，结构面在内层（issue #147）：内层 total → total；
 *   否则 may——**绝不下 definite 非可迭代结论**（TypedArray/Buffer 等
 *   内层空 obj，原型链 @@iterator 不在内层建模）。
 * - 生成器/模板标签/matchAll 迭代物挂对象侧表：迭代 = 消费（从当前位
 *   取剩余），体内延迟异常在消费点重放（不得静默截断成前缀，Bug 34）。
 * - unbounded（长度未知）单代表迭代只跑一次：0 次/出口臂由 fork-arm +
 *   snapExit join 承接；break/continue 打断代表体 → widen.markInterrupted
 *   （完整迭代效应不可观测，累加器域整体宽化）。
 */
import type { Abs } from "../../../abs.ts";
import { abs, bool, confJoin, litValue, numLit, str, unknown } from "../../../abs.ts";
import { lit } from "../../../term.ts";
import { pTrue } from "../../../pred.ts";
import { absFunction } from "../../../abs-fn.ts";
import {
  joinAbs,
  isNullProtoObj,
  setSlot,
} from "../../../objects.ts";
import {
  isMapAbs,
  isSetAbs,
  setElementsAbs,
  collectionExactLen,
  mapEntriesAbs,
} from "../../../collections.ts";
import { shouldWidenArrayLiteral, widenedArrayConf, TUPLE_MATERIALIZE_CAP } from "../../../containers.ts";
import { registerTplElements, matchIterElements, replayGenDeferred, drainGenElements, genDrainViewOf } from "../../match-iter.ts";
import {
  getPropFlags,
  enumOwnKeys,
  enterPromiseForkArm,
  leavePromiseForkArm,
} from "../../../builtins.ts";
import { typedArrayEnumKeyView } from "../../../builtins/object/enum-entries.ts";
import {
  anyMemberResult,
} from "../../member-diag.ts";
import { errorTypeAbs, recordMayThrow } from "../../may-throw.ts";
import {
  NudoThrow,
  undef,
  asAbsVal,
  $lit,
  isNudoReturn,
  isNudoBreak,
  isNudoContinue,
  noBody,
  confPartialPacked,
} from "../state.ts";
import { markDomainShared } from "../../../len-sharing.ts";
import { DEFAULT_MAX_LOOP_ITERS, MAX_CONCRETE_LOOP_ITERS, LOOP_TRUNCATION_LABEL } from "../loop-budget.ts";
import { makeLoopWidener } from "../loop-widen.ts";
import { noteLoopTruncation } from "../../../call-budget.ts";
import { isNudoThrow, callAtFunctionBoundary } from "../state.ts";
import { $call } from "../../call.ts";
import { $arr, tupleOrWiden, drainTupleOrWiden } from "./arr-make.ts";

/** 数组 rest：`const [a, ...rest] = arr` → rest = 从 start 起的尾段 */
export function $arrRest(a: Abs, start: number): Abs {
  // Bug 22：侧表迭代物（生成器对象）rest 解构按元素切片（原 tuple 路径）
  // Bug 54：解构是消费——从生成器当前位取剩余再切（此后生成器耗尽）
  const mi = matchIterElements(a);
  if (mi) {
    // R1b：exact 生成器视图（线性收集序列）→ 切片越过 cap 出 exact 元组
    const exact = genDrainViewOf(a)?.exact === true;
    const sliced = (drainGenElements(a) ?? mi).slice(start);
    if (sliced.length === 0) return abs({ k: "arr", element: unknown }, undefined, undefined, "path");
    if ((!exact || sliced.length > TUPLE_MATERIALIZE_CAP) && shouldWidenArrayLiteral(sliced.length)) {
      const element = sliced.reduce((x, y) => joinAbs(x, y));
      return abs({ k: "arr", element }, undefined, undefined, widenedArrayConf());
    }
    return abs({ k: "tuple", elements: sliced }, undefined, undefined, a.conf);
  }
  a = asAbsVal(a);
  // Bug 56/N3：Arguments brand → 委托 tuple 内层——方法形参 rest 绑定
  //（emitParamBindingFromArgs 的 $arrRest 读 $arguments 槽）此前落尾
  // unknown（rest 形参在「读 arguments 的方法」里同样丢精度）
  if (a.shape.k === "brand" && a.shape.name === "Arguments") {
    return $arrRest(a.shape.shape, start);
  }
  if (a.shape.k === "sum") {
    // DEC-006：空 sum 成员 join 无单位元——不得裸 reduce
    const parts = a.shape.members.map((m) => $arrRest(m, start));
    return parts.length ? parts.reduce((x, y) => joinAbs(x, y)) : unknown;
  }
  if (a.shape.k === "tuple") {
    // 源带 rest 槽：尾段含 rest 的未知长度元素，不得只切固定位前缀
    if (a.shape.rest) {
      const sliced = a.shape.elements.slice(start);
      if (start < a.shape.elements.length && !shouldWidenArrayLiteral(sliced.length + 1)) {
        return abs(
          { k: "tuple", elements: sliced, rest: a.shape.rest },
          undefined,
          undefined,
          a.conf,
        );
      }
      // 起点落在 rest 段 / 切片超 cap：尾段退化为 rest 元素数组（join 固定前缀）
      const restEl = a.shape.rest.shape.k === "arr" ? a.shape.rest.shape.element : a.shape.rest;
      const el = sliced.reduce((x, y) => joinAbs(x, y), restEl);
      return abs({ k: "arr", element: el }, undefined, undefined, a.conf);
    }
    return tupleOrWiden(a.shape.elements.slice(start), a.conf);
  }
  if (a.shape.k === "arr") return a;
  if (a.shape.k === "any") return abs({ k: "arr", element: anyMemberResult() }, undefined, undefined, "path");
  return unknown;
}

/** 数组连接 [...a, ...b] / [...a, x]；结果超 cap 时与字面量同策略降 arr */
export function $concat(a: Abs, b: Abs): Abs {
  a = asAbsVal(a);
  b = asAbsVal(b);
  // 字符串 spread：按 code points 拆（surrogate pair 合并；原生迭代语义）
  const avR = litValue(a);
  const av = avR.ok ? avR.value : undefined;
  if (typeof av === "string") {
    return $concat($arr([...av].map((c) => $lit(c))), b);
  }
  const bvR = litValue(b);
  const bv = bvR.ok ? bvR.value : undefined;
  if (typeof bv === "string") {
    return $concat(a, $arr([...bv].map((c) => $lit(c))));
  }
  const as = a.shape;
  const bs = b.shape;
  if (as.k === "tuple" && bs.k === "tuple") {
    return tupleOrWiden([...as.elements, ...bs.elements], confJoin(a.conf, b.conf));
  }
  // 一侧是抽象数组（arr）：spread 语义按元素并入（元素 join），
  // 不得整体嵌为单元素——字面量链超 cap 降级为 arr 后继续吸收后续元素也走此分支
  if (as.k === "arr" || bs.k === "arr") {
    // 空 tuple 元素 join 无单位元——不得裸 reduce（DEC-006: Reduce of empty array）；
    // 单位元是 bottom（never）而非 unknown（top）——空 tuple spread 不贡献
    // 元素，join(never, x) = x（与下方 sideEl 同口径，Bug 4：[...xs] 元素域
    // 被 unknown 污染成 number | unknown 的根因）
    const ea: Abs = as.k === "tuple"
      ? (as.elements.length ? as.elements.reduce((x, y) => joinAbs(x, y)) : abs({ k: "never" }, undefined, undefined, "exact"))
      : as.k === "arr"
        ? as.element
        : a;
    const eb: Abs = bs.k === "tuple"
      ? (bs.elements.length ? bs.elements.reduce((x, y) => joinAbs(x, y)) : abs({ k: "never" }, undefined, undefined, "exact"))
      : bs.k === "arr"
        ? bs.element
        : b;
    return abs({ k: "arr", element: joinAbs(ea, eb) }, undefined, undefined, "path");
  }
  // 剩余：至少一侧非 tuple/arr/string 字面量。
  // 迭代性守卫对齐共享分类器（iterabilityKind/guardIterable，与 $elems /
  // $iterCheck 同口径）：非字符串 prim（字面量或抽象 prim 面）与闭 obj
  // （无 @@iterator 槽）→ definite TypeError；any/unknown/open obj/brand/
  // fn → may TypeError。此前 throwIfNonIterable 只查 lit term——`[...x]`
  // （x:any）静默不记，而 `Math.max(...x)` 经 $elems 记 may，同面不同判
  // （wave 2 残留）。字符串/元组/Set/Map 等可迭代面与字面量行为不变。
  guardIterable(a, "spread element");
  guardIterable(b, "spread element");
  // Bug 34：数组字面量 spread 经 $concat（不走 $elems）——生成器对象的
  // 体内延迟异常在此重放（definite 抛 / soft may-throw 重记）
  replayGenDeferred(a);
  replayGenDeferred(b);
  // Set/Map/matchAll 迭代器：条目精确展开（Map 是 entry 元组）；其余非容器
  // （unknown/any/brand/obj/抽象字符串）长度未知——必须 arr join，不得折单元素
  // tuple（[...x].length 假精确 1 的根因）
  const expand = (x: Abs): Abs[] | null => {
    if (isSetAbs(x)) return setElementsAbs(x);
    if (isMapAbs(x)) return mapEntriesAbs(x);
    // Bug 54：生成器对象是消费——从当前位取剩余（drain），此后耗尽
    const drained = drainGenElements(x);
    if (drained) return drained;
    const mi = matchIterElements(x);
    if (mi) return mi;
    // brand 结构面在内层（issue #147）：Set/Map/match-iter brand 已在上方
    // 按名命中，此处只兜结构 delegation（内层 tuple 精确展开等）。
    if (x.shape.k === "brand") return expand(x.shape.shape);
    // 内层 tuple 精确展开（裸 tuple 已被 $concat 顶部 tuple×tuple 分支
    // 吸收，此处只经 brand delegation 到达）：[...t1, ...brandT2] 保持
    // tuple 形状，元素域与长度均精确（此前折 arr）。
    if (x.shape.k === "tuple") return [...x.shape.elements];
    return null;
  };
  // 单侧元素域（与 expand 侧表配套）：any → any、tuple 逐元素 join、抽象
  // 字符串恒 string、brand delegation 到内层；其余 unknown。
  const sideEl = (x: Abs, expanded: Abs[] | null): Abs => {
    // DEC-006：空 Set/Map/match-iter 展开无元素——不得裸 reduce
    if (expanded) {
      return expanded.length
        ? expanded.reduce((u, y) => joinAbs(u, y))
        : abs({ k: "never" }, undefined, undefined, "exact");
    }
    if (x?.shape?.k === "any") return anyMemberResult();
    if (x?.shape?.k === "tuple") {
      const els = x.shape.elements;
      // 空 tuple spread 不贡献元素 → never；join(never, any) = any
      return els.length ? els.reduce((u, y) => joinAbs(u, y)) : abs({ k: "never" }, undefined, undefined, "exact");
    }
    // 抽象字符串按 code point 可迭代是 total 面（iterabilityKind 同口径；
    // 字面量字符串在 $concat 顶部已特判展开）——元素域恒 string（Bug 4：
    // [...s] 折 unknown[] 的缺口）
    if (x?.shape?.k === "prim" && x.shape.type === "string") {
      return abs({ k: "prim", type: "string" }, undefined, undefined, "path");
    }
    // arr 元素域 = 单代表元素（顶层 arr 已被函数首部分支吸收，此臂只服务
    // brand delegation 的内层）
    if (x?.shape?.k === "arr") return x.shape.element;
    // brand 结构面在内层（issue #147）：[...Array<T> brand] 元素域 = 内层
    // arr 元素，不再折 unknown（Set/Map/match-iter brand 在 expand 按名命中）。
    // expanded 在此必为 null（顶部 if (expanded) 已返回）——显式传 null。
    if (x?.shape?.k === "brand") return sideEl(x.shape.shape, null);
    return unknown;
  };
  if (as.k === "tuple") {
    const be = expand(b);
    if (be) {
      // R1b：exact 生成器视图（线性收集序列）→ 重组越过 cap 出 exact 元组
      return drainTupleOrWiden(
        [...as.elements, ...be],
        confJoin(a.conf, b.conf),
        genDrainViewOf(b)?.exact === true,
      );
    }
    // b 可能可迭代：spread 并入的是 b 的元素而非 b 本身。
    // any 的元素域是 any（无约束），不是 unknown（引擎债）。
    const bEl = sideEl(b, be);
    return abs(
      { k: "arr", element: [...as.elements, bEl].reduce((x, y) => joinAbs(x, y)) },
      undefined,
      undefined,
      "path",
    );
  }
  const ae = expand(a);
  if (ae && bs.k === "tuple") {
    // R1b：同上——[...g()] 的元素域来自 drain 的权威序列，不受形状面 cap
    return drainTupleOrWiden(
      [...ae, ...bs.elements],
      confJoin(a.conf, b.conf),
      genDrainViewOf(a)?.exact === true,
    );
  }
  // 双侧皆非精确容器：元素 join（any → any；空 tuple 不贡献元素）
  return abs(
    { k: "arr", element: joinAbs(sideEl(a, ae), sideEl(b, expand(b))) },
    undefined,
    undefined,
    "path",
  );
}

/** 迭代消费（原生 GetIterator）的可迭代性分类：
 *  - total：string prim（任意取值恒可迭代）/ tuple / arr / Set / Map /
 *    matchAll 迭代器 / generator eff / never —— 原生全量
 *  - definite：非 string prim（num/bool/bigint/symbol/null/undefined——这些
 *    prim 的任何取值都没有 @@iterator，含字面量与抽象 prim）与闭 obj
 *    （无 @@iterator 槽；Object.prototype 原型链亦无）
 *  - may：any / unknown / open obj（未知键可能含 @@iterator）/ fn /
 *    promise eff —— 抽象面可能非可迭代
 *  brand：名义标签，结构面在内层——内层 total 则 total（env/harvest 的
 *    Array<T> brand 整族，issue #147）；其余 may，绝不下 definite 结论
 *    （TypedArray/Buffer 等内层空 obj，原型链 @@iterator 不在内层建模）。
 *  sum：逐臂归约（全臂 definite → definite；任一臂非 total → may） */
type IterabilityKind = "total" | "may" | "definite";

function iterabilityKind(a: Abs): IterabilityKind {
  const s = a.shape;
  if (s.k === "sum") {
    let sawNonTotal = false;
    let allDefinite = true;
    for (const m of s.members) {
      const k = iterabilityKind(m);
      if (k !== "definite") allDefinite = false;
      if (k !== "total") sawNonTotal = true;
    }
    return s.members.length > 0 && allDefinite
      ? "definite"
      : sawNonTotal
        ? "may"
        : "total";
  }
  // lit 字面量精确判定（与 $concat 的 throwIfNonIterable 同口径）：非字符串
  // prim 字面量恒不可迭代 → definite。nullish lit 的形状是 unknown（无独立
  // nullish shape），必须先看 term 再看形状。
  if (a.term?.op === "lit") {
    const v: unknown = (a.term as { value: unknown }).value;
    if (
      v === null ||
      v === undefined ||
      typeof v === "number" ||
      typeof v === "boolean" ||
      typeof v === "bigint" ||
      typeof v === "symbol"
    ) {
      return "definite";
    }
  }
  if (s.k === "tuple" || s.k === "arr" || s.k === "never") return "total";
  if (isSetAbs(a) || isMapAbs(a) || matchIterElements(a)) return "total";
  if (s.k === "eff") return s.eff === "generator" ? "total" : "may";
  if (s.k === "prim") return s.type === "string" ? "total" : "definite";
  if (s.k === "obj") {
    if (s.slots["@@iterator"]) return "total";
    return s.open ? "may" : "definite";
  }
  // brand 只是名义标签，不改变结构可迭代性（issue #147）：
  // 内层全量可迭代 → total；否则 may——不下 definite（内层结构不承诺
  // 原型链无 @@iterator）。
  if (s.k === "brand") {
    return iterabilityKind(s.shape) === "total" ? "total" : "may";
  }
  return "may";
}

/** for await（GetIterator hint=async）：@@asyncIterator 槽即全量（异步可迭代）；
 *  其余口径与同步迭代一致（数字等 prim definite、闭 obj 无任何迭代器槽
 *  definite、any/unknown/open obj may；数组/字符串走同步回退故仍 total）。 */
function asyncIterabilityKind(a: Abs): IterabilityKind {
  const s = a.shape;
  if (s.k === "sum") {
    let sawNonTotal = false;
    let allDefinite = true;
    for (const m of s.members) {
      const k = asyncIterabilityKind(m);
      if (k !== "definite") allDefinite = false;
      if (k !== "total") sawNonTotal = true;
    }
    return s.members.length > 0 && allDefinite
      ? "definite"
      : sawNonTotal
        ? "may"
        : "total";
  }
  if (
    s.k === "obj" &&
    !s.slots["@@iterator"] &&
    s.slots["@@asyncIterator"]
  ) {
    return "total";
  }
  // brand 同步口径（issue #147）：内层仅异步可迭代（只有 @@asyncIterator 槽）
  // → total；其余委派 iterabilityKind（其 brand 臂按内层结构面判）。
  if (s.k === "brand") {
    const ish = s.shape.shape;
    if (
      ish.k === "obj" &&
      !ish.slots["@@iterator"] &&
      ish.slots["@@asyncIterator"]
    ) {
      return "total";
    }
  }
  return iterabilityKind(a);
}

/** 迭代消费守卫：definite 非可迭代 → 原生 TypeError（hard NudoThrow）；
 *  抽象面可能非可迭代 → recordMayThrow（值域投影不变）。
 *  $elems（for-of / spread 实参）与 $iterCheck（数组解构）共用。 */
function guardIterable(a: Abs, ctx: string): void {
  const kind = iterabilityKind(a);
  if (kind === "definite") throw new NudoThrow(errorTypeAbs("TypeError"));
  if (kind === "may") {
    recordMayThrow({
      kind: "TypeError",
      cause: `${ctx} over possibly non-iterable value`,
    });
  }
}

/** 数组解构模式接收者守卫：原生数组解构 = GetIterator + IteratorNext，
 *  非可迭代接收者抛 TypeError。emitDestructure 的 ArrayPattern 分支在逐项
 *  $idx / $arrRest 投影前调用；值域投影不变（字符串/元组等可迭代接收者
 *  不受影响）。 */
export function $iterCheck(a: unknown): void {
  const v = asAbsVal(a);
  guardIterable(v, "array destructuring");
  // Bug 34：体内抛错的生成器（延迟异常挂对象侧表）——解构消费触达抛点
  replayGenDeferred(v);
}

/** 元素列表（tuple 展开；arr 抽象；C1 Set/Map 逐条目；matchAll 迭代器逐匹配项；
 *  字符串按 code points）。Map 迭代语义是 entry `[key, value]` 元组，不是裸 value。
 *  消费前先过可迭代性守卫（Bug 6）：prim 字面量接收者 → 原生 definite
 *  TypeError；any/unknown → may。$forOf 与 call/new spread 实参路径继承。
 *  Bug 34：生成器对象的体内延迟异常（definite 抛 / soft may-throw 重记）
 *  在消费点重放——迭代不再静默截断成前缀。 */
export function $elems(a: Abs): Abs[] {
  guardIterable(a, "iteration");
  replayGenDeferred(a);
  return elemsOf(a);
}

/** yield* 委托展开（Bug 82）：迭代性守卫与元素列表同 $elems，另报长度
 *  可知性——tuple / 字符串 prim / Set / Map / match-iter 是全量精确展开
 *  （元素个数确定）；arr / any / obj / brand / sum 等给单代表元素，
 *  长度不可判（收集器不得以 exact 元组出货）。 */
export function $yieldStarElems(a: Abs): { els: Abs[]; lengthKnown: boolean } {
  // any 接收者的元素域是 any（无约束），不是 unknown（引擎债）——与
  // $concat sideEl 同口径（`[...x]`（x:any）→ any[]）。但可迭代性守卫
  // 不得跳过（Bug 34 gate 面）：GetIterator 对 any 是 may TypeError——
  // 生成器体内记进 $gen 帧，消费点重放（`for (const v of x)` 同判）
  if (a.shape.k === "any") {
    guardIterable(a, "yield* delegation");
    return { els: [anyMemberResult()], lengthKnown: false };
  }
  const els = $elems(a);
  const s = a.shape;
  // R1b：exact 生成器视图（线性收集序列）长度可知——yield* 委托并出的
  // 元素序列是权威列表，不 bumpGenPathSensitive（外层生成器保持 exact）
  const lengthKnown =
    s.k === "tuple" ||
    s.k === "never" ||
    (s.k === "prim" && s.type === "string") ||
    isSetAbs(a) ||
    isMapAbs(a) ||
    matchIterElements(a) !== undefined ||
    genDrainViewOf(a)?.exact === true;
  return { els, lengthKnown };
}

/** 模板标签对象（GetTemplateObject，Bug 34）：冻结的类数组 obj——数字槽
 *  为 cooked 字符串（无效转义序列时 cooked 是 undefined，原生实测）、
 *  length 精确、.raw 为 raw 字符串数组；@@iterator 槽给函数形状
 * （`[...s]` / `for..of` / `Symbol.iterator in s` 均按可迭代面判定，
 *  不得把冻结数组误判 definite 不可迭代）。 */
export function $tpl(cooked: Array<string | undefined>, raw: string[]): Abs {
  const slots: Record<string, { value: Abs }> = Object.create(null);
  const els: Abs[] = [];
  for (let i = 0; i < cooked.length; i++) {
    const c = cooked[i]!;
    const v = typeof c === "string" ? $lit(c) : $lit(undefined);
    els.push(v);
    setSlot(slots, String(i), { value: v });
  }
  setSlot(slots, "length", { value: numLit(cooked.length) });
  setSlot(slots, "raw", { value: $arr(raw.map((r) => $lit(r))) });
  setSlot(slots, "@@iterator", {
    value: absFunction([], { body: noBody }, { ctor: false }),
  });
  const t = abs({ k: "obj", slots }, undefined, undefined, "exact");
  // 元素侧表：spread / for-of / join 按 cooked 精确展开
  registerTplElements(t, els);
  return t;
}

function elemsOf(a: Abs): Abs[] {
  if (a.shape.k === "tuple") return [...a.shape.elements];
  // #175 残留：arr 元素域分发标记（len-sharing.ts——跨读不保证同值）
  if (a.shape.k === "arr") return [markDomainShared(a.shape.element)];
  if (isSetAbs(a)) return setElementsAbs(a);
  if (isMapAbs(a)) return mapEntriesAbs(a);
  // Bug 54：生成器对象——从当前位取剩余并推进状态（迭代 = 消费），不再从 0 重放
  const drained = drainGenElements(a);
  if (drained) return drained;
  const mi = matchIterElements(a);
  if (mi) return mi;
  const svR = litValue(a);
  const sv = svR.ok ? svR.value : undefined;
  // 字面量字符串：code points 精确展开（必须先于抽象 prim 臂——lit 也是
  // prim string shape）
  if (typeof sv === "string") return [...sv].map((c) => $lit(c));
  // 抽象字符串 prim：code point 迭代，元素域恒 string（Bug 19：for-of /
  // yield* 循环变量折 unknown → 算术/成员读级联污染）——单代表元素，与
  // arr 臂 [element] 同口径（长度不可知由 $forOf unbounded 出口 join 承接）
  if (a.shape.k === "prim" && a.shape.type === "string") {
    return [abs({ k: "prim", type: "string" }, undefined, undefined, "path")];
  }
  // brand 结构面在内层（issue #147）：env/harvest 的 Array<T> brand 的
  // for-of / spread 元素域 = 内层 arr 元素（此前折 unknown）。Set/Map/
  // match-iter brand 已在上方按名命中侧表，此处只兜结构 delegation。
  if (a.shape.k === "brand") return elemsOf(a.shape.shape);
  return [unknown];
}

/**
 * for-of：对 iterable 每个元素跑 body；有界展开。
 * body(item, i) 可返回 void；状态由外部 JS 变量承接。
 * - 具体空 tuple：体 0 次（不得用 `length || maxIters` 展开成 maxIters）
 * - 抽象 arr / 未知长度：0..maxIters 出口与 pack 状态 join
 */
/**
 * for-in 键序列：原生顺序为整数键升序 → 其余键按插入序；
 * 数组 hole 槽不出键（读值为 undefined 但不可枚举）。仅自有可枚举键。
 */
export function $forInKeys(o: Abs): Abs {
  const shape = o.shape;
  if (shape.k === "sum") {
    // DEC-006：空 sum 成员 join 无单位元——不得裸 reduce
    const members = shape.members.map((m) => $forInKeys(m));
    return members.length ? members.reduce((a, b) => joinAbs(a, b)) : unknown;
  }
  const isArrayIndexKey = (k: string): boolean => {
    const n = Number(k);
    return (
      k !== "" &&
      String(n) === k &&
      Number.isInteger(n) &&
      n >= 0 &&
      n < 4294967295
    );
  };
  if (shape.k === "obj") {
    // Bug 18：open obj（Object.create(proto) / setPrototypeOf / spread 开面
    // 产物）原型链未跟踪（Object.create 不记 protoTable）——可携带任意
    // 可枚举继承键，不得断言精确（可能为空的）自有键序列（for-in over
    // Object.create({x:1}) 原生跑 1 次）。诚实降级为抽象字符串键数组
    // （体 0..N 次，与 any 接收者臂同口径）；null-proto 标记链终止于
    // null，闭 obj（原型恰为无可枚举自有的 Object.prototype）仍精确。
    if (shape.open && !isNullProtoObj(o)) {
      return abs({ k: "arr", element: str() }, undefined, undefined, "partial");
    }
    // 仅自有可枚举键——与 Object.keys 的 enumKeys 同口径
    // （getPropFlags().enumerable === false 的 defineProperty 键剔除）
    const keys = enumOwnKeys(o, shape.slots);
    const intKeys = keys.filter(isArrayIndexKey).sort((a, b) => Number(a) - Number(b));
    const strKeys = keys.filter((k) => !isArrayIndexKey(k));
    return $arr([...intKeys, ...strKeys].map((k) => $lit(k)));
  }
  if (shape.k === "tuple") {
    const idxs: number[] = [];
    for (let i = 0; i < shape.elements.length; i++) {
      if (shape.holes?.includes(i)) continue;
      idxs.push(i);
    }
    return $arr(idxs.map((i) => $lit(String(i))));
  }
  if (shape.k === "arr") {
    // 抽象数组：索引域未知，单代表元素迭代（与 $forOf 抽象近似同口径）
    return abs({ k: "arr", element: $lit("0") }, undefined, undefined, "partial");
  }
  const svR = litValue(o);
  const sv = svR.ok && typeof svR.value === "string" ? svR.value : undefined;
  if (typeof sv === "string") {
    return $arr(Array.from({ length: sv.length }, (_, i) => $lit(String(i))));
  }
  // 键域未知 ≠ 键域为空（Bug 68）：any/unknown 接收者可能携带任意可枚举键，
  // 体必须至少跑一次（抽象字符串键），否则体内的 may-throw 丢失、计数器
  // 折成假精确 0。抽象 string prim 同理（索引键 0..len-1 域未知）。
  // 例外：nullish lit 的形状就是 unknown（无独立 nullish shape），原生
  // ToObject 后零可枚举键——先看 term 排除，键域确定为空。
  const isNullishLit =
    o.term?.op === "lit" &&
    ((o.term as { value: unknown }).value === null ||
      (o.term as { value: unknown }).value === undefined);
  if (
    !isNullishLit &&
    (shape.k === "any" ||
      shape.k === "unknown" ||
      (shape.k === "prim" && shape.type === "string"))
  ) {
    return abs({ k: "arr", element: str() }, undefined, undefined, "partial");
  }
  // brand：内层 obj 槽的可枚举键（类实例字段等）；内建（Date/Map/Promise）
  // 零自有可枚举键 → 空键序列。
  if (shape.k === "brand") {
    // Bug 125：TypedArray——整数索引异质属性是自有可枚举键 "0".."n-1"，
    // 与 Object.keys 同口径（typedArrayEnumKeyView 读内层 length 槽）；
    // 长度可知 → 精确键序列；长度开放 → 抽象字符串键（体 0..N 次——
    // 空 TA 0 次、非空 n 次，不得折空）。此前整族折 []（wrong-exact）。
    const taView = typedArrayEnumKeyView(o);
    if (taView) {
      return taView.k === "exact"
        ? $arr(Array.from({ length: taView.count }, (_, i) => $lit(String(i))))
        : abs({ k: "arr", element: str() }, undefined, undefined, "partial");
    }
    const inner = shape.shape;
    if (inner.shape.k === "obj") {
      // boxed String brand（Bug 57 附带，T2 移交）：length 不可枚举——原生
      // for (k in new String("ab")) 只枚举 ["0","1"]（内部槽已标 enumerable:false）
      const keys = enumOwnKeys(inner, inner.shape.slots).filter(
        (k) => !(shape.name === "String" && k === "length"),
      );
      return $arr(keys.map((k) => $lit(k)));
    }
    return $arr([]);
  }
  // 其余（num/bool/bigint/symbol/null/undefined prim 字面量或抽象、fn、eff）：
  // 原生 ToObject 后零可枚举键 → 键域确定为空，体 0 次。
  return $arr([]);
}

/** 侧表迭代物（生成器对象 / 模板标签 / matchAll 迭代器，Bug 22）的精确
 *  长度——matchIterElements 命中即长度已知（for-of 精确展开用）。 */
function sideIterLen(a: Abs): number | undefined {
  const mi = matchIterElements(a);
  return mi ? mi.length : undefined;
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
     *  元素取抽象 unknown（原生由 next() 链驱动）。 */
    forAwait?: boolean;
  },
): void {
  const pack = opts?.pack;
  const unpack = opts?.unpack;
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
    if (!exitJoin || !pack || !unpack) return;
    unpack(widen ? widen.widenFinal(joinAbs(exitJoin, pack())) : joinAbs(exitJoin, pack()));
  };

  const shape = iterable.shape;
  // for await：异步可迭代性校验 + 元素域。仅异步可迭代接收者（只有
  // @@asyncIterator 槽）元素取抽象 unknown——不得折同步 $elems 投影
  //（对象槽位不是迭代产出，Bug 13 值域）；同步可迭代接收者走同步元素
  //（规范回退：同步迭代器逐项 await，promise 元素解包内层）。
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
  const knownLen =
    lenShape.k === "tuple"
      ? lenShape.elements.length
      : typeof sv === "string"
        ? [...sv].length
        : collectionExactLen(iterable) ?? sideIterLen(iterable);
  const items = asyncOnly
    ? [unknown]
    : forAwait
      ? // Bug 34：for-await 消费生成器同样重放体内延迟异常（规范同步迭代器
        // 回退路径，元素逐项 await）
        (replayGenDeferred(iterable), elemsOf(iterable).map(awaitElem))
      : $elems(iterable);
  // 非具体容器：长度未知（可能空、可能更长）→ 单代表元素只跑一次
  // （同一元素重复 join 幂等，maxIters 次展开只会让索引假精确 + 大数组
  // 反复深拷贝把分析拖死）；0 次出口由下方 snapExit join，保持 sound。
  const unbounded = knownLen === undefined;

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
  const n =
    knownLen !== undefined
      ? Math.min(knownLen, concreteCap)
      : items.length > 0
        ? 1
        : 0;
  const concreteOverrun = knownLen !== undefined && knownLen > concreteCap;

  for (let i = 0; i < n; i++) {
    const item =
      items.length > 0 ? items[Math.min(i, items.length - 1)]! : unknown;
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
        // break 打断代表体（fork 的 break 臂冒泡，后续语句丢失）——完整
        // 迭代效应不可观测，「先跑任意次再 break」的累加器域必须整体宽化
        if (unbounded && e.abstract) widen?.markInterrupted();
        applyExitJoin();
        return;
      }
      if (isNudoContinue(e, opts?.label)) {
        // continue 同款：本迭代剩余语句丢失（单代表迭代后循环即结束）
        if (unbounded && e.abstract) widen?.markInterrupted();
        continue; // 下一个元素；已发生副作用保留
      }
      if (isNudoReturn(e) || isNudoThrow(e)) throw e;
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
 */
export function $collectionForEach(recv: Abs, cb: unknown): Abs | undefined {
  const invokeCb = (args: Abs[]): void => {
    if (typeof cb === "function") {
      callAtFunctionBoundary(() => {
        (cb as (...a: Abs[]) => unknown)(...args);
      });
      return;
    }
    if (cb && typeof cb === "object" && "shape" in (cb as object)) {
      $call(cb as Abs, args);
    }
  };
  if (isMapAbs(recv)) {
    for (const entry of mapEntriesAbs(recv)) {
      if (entry.shape.k === "tuple" && entry.shape.elements.length >= 2) {
        const key = entry.shape.elements[0]!;
        const value = entry.shape.elements[1]!;
        invokeCb([value, key, recv]);
      }
    }
    return undef();
  }
  if (isSetAbs(recv)) {
    for (const el of setElementsAbs(recv)) {
      invokeCb([el, el, recv]);
    }
    return undef();
  }
  return undefined;
}
