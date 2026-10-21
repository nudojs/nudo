/**
 * 迭代协议与 spread/rest 投影：$elems/$forOf/$concat/$arrRest/$iterCheck。
 *
 * Invariants:
 * - brand 只是名义标签，结构面在内层（issue #147）：内层 total → total；
 *   否则 may——**绝不下 definite 非可迭代结论**（TypedArray/Buffer 等
 *   内层空 obj，原型链 @@iterator 不在内层建模）。
 * - 生成器/模板标签/matchAll 迭代物挂对象侧表：迭代 = 消费（从当前位
 *   取剩余），体内延迟异常在消费点重放（不得静默截断成前缀，Bug 34）。
 * - async generator（仅 @@asyncIterator 槽的**生成器对象**，Bug 141）：
 *   for-await 的元素域走**元素侧表**（与同步 generator 同口径：元素取
 *   侧表剩余条目，长度亦由侧表给出）——不得落 asyncOnly 的 unknown 快
 *   路径（元素域精度回退）；非生成器的仅异步可迭代对象元素域不可静态刻
 *   画 → 仍折 unknown。
 * - unbounded（长度未知）单代表迭代只跑一次：0 次/出口臂由 fork-arm +
 *   snapExit join 承接；break/continue 打断代表体 → widen.markInterrupted
 *   （完整迭代效应不可观测，累加器域整体宽化）。
 * - Bug 195：标签模板对象是**冻结的数组 exotic**（原生 GetTemplateObject →
 *   CreateArrayFromList + SetIntegrityLevel(frozen)）⇒ 元槽（length / raw /
 *   @@iterator）**非枚举**、对象**冻结**（extState）、JSON 走**数组序列化面**
 *   （数组视图标注）。未冻结的普通 obj 不得被误标。
 * - Bug 198：Map/Set 的条目遍历（forEach / for-of）必须是**接收者的 live
 *   视图**——回调里的增删删改对迭代可见（live 视图按访问序取，条目身份去重）。
 * - Bug 198（S20）：live 集合 / 数组迭代器**不登记静态元素侧表**（静态表是
 *   创建期拷贝 ⇒ 元素面与长度冻结在创建时刻）⇒ 迭代物判定（$arrRest 的
 *   「侧表迭代物」门、$yieldStarElems 的长度可知性）必须**同口径**认
 *   **消费视图**（registerGenDrain）——只查静态侧表会把 live 迭代物误判成
 *   「非迭代物」（rest 解构退 unknown）。
 * - Bug 199：非正常出口（break / return / throw / label break）与**解构模式
 *   填满而迭代器未耗尽**必须 IteratorClose（调用户迭代器的 return()）；continue
 *   与自然耗尽**不**调；无 return 槽**不**凭空抛（抽象面不判定）。
 * - Bug 200：for..in 遍历 brand 实例须**沿原型链**枚举可枚举键（原型上的
 *   class 方法非可枚举 ⇒ 不出现）。
 * - Bug 215：for-of 的**具体出口**（无快照 join）也须实施 @nudo:invariant 公理
 *   （无公理时不取绑定包——零行为变化）。
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
  getSlot,
  getProtoAbs,
  canonicalArrayIndex,
} from "../../../objects.ts";
import {
  isMapAbs,
  isSetAbs,
  setElementsAbs,
  collectionExactLen,
  mapEntriesAbs,
} from "../../../collections.ts";
import { shouldWidenArrayLiteral, widenedArrayConf, TUPLE_MATERIALIZE_CAP } from "../../../containers.ts";
import { registerTplElements, matchIterElements, replayGenDeferred, drainGenElements, genDrainViewOf, registerUserIter, userIterOf, registerUserIterLen, userIterLenOf } from "../../match-iter.ts";
import { getPropFlags, enumOwnKeys, enterPromiseForkArm, leavePromiseForkArm, protoBrandAbs, markExtState, setPropFlags } from "../../../builtins.ts";
// Bug 195：模板对象是**数组 exotic**（原生 GetTemplateObject → CreateArrayFromList
// + SetIntegrityLevel(frozen)）⇒ JSON.stringify 走数组序列化面（数组视图标注，
// 与 RegExp exec 结果同款机制；直连 regexp.ts 不经 barrel）。
import { markMatchArrayView } from "../../../builtins/regexp.ts";
// Bug 198：集合条目 live 视图（直连 builtins/error/iterator.ts，不经 barrel——
// 与 invoke-arr.ts 同款「避开 barrel re-export」的直连口径）。
import { collectionLiveEntries } from "../../../builtins/error/iterator.ts";
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
  litTruth,
} from "../state.ts";
import { markDomainShared } from "../../../len-sharing.ts";
import { getFnImpl } from "../../../abs-fn.ts";
import { getEvalClass, lookupClassValue, fnProtoOf } from "../../class-registry.ts";
import { DEFAULT_MAX_LOOP_ITERS, MAX_CONCRETE_LOOP_ITERS, LOOP_TRUNCATION_LABEL } from "../loop-budget.ts";
import { makeLoopWidener } from "../loop-widen.ts";
// Bug 215（S10 转来）：for-of 的出口 join 须实施 @nudo:invariant 公理——
// 无公理时不取绑定包（零行为变化，见 invariant-apply.ts 的 hasInvariantSpecs 注释）。
import { applyExitJoinInvariants, hasInvariantSpecs } from "../invariant-apply.ts";
import { noteLoopTruncation } from "../../../call-budget.ts";
import { isNudoThrow, callAtFunctionBoundary } from "../state.ts";
import { $call } from "../../call.ts";
import { $arr, tupleOrWiden, drainTupleOrWiden } from "./arr-make.ts";
// $get 放在 builtins 之后导入：member.ts → builtins.ts → array.ts → iterate.ts
// 已是既有环（函数级调用，无模块期求值）；保持导入序 = builtins 先求值。
import { $get } from "./member.ts";
// 同理置于最后：members.ts（类链/链洞工具）依赖 builtins.ts，导入序保持
// builtins → member → members 的既有求值次序（函数级调用，无模块期求值）。
import { evalClassChain, classChainHasHole } from "../members.ts";

/** 数组 rest：`const [a, ...rest] = arr` → rest = 从 start 起的尾段 */
export function $arrRest(a: Abs, start: number): Abs {
  // Bug 22：侧表迭代物（生成器对象）rest 解构按元素切片（原 tuple 路径）
  // Bug 54：解构是消费——从生成器当前位取剩余再切（此后生成器耗尽）
  // Bug 198（S20）：**live 集合 / 数组迭代器不登记静态元素侧表**（S17 根治点
  // ——静态表是创建期拷贝，会把长度探针与元素面冻结在创建时刻）⇒ 只查
  // matchIterElements 会漏判这类迭代物 ⇒ 门改为「静态侧表 **或** 消费视图」
  // （消费视图 = registerGenDrain 的 live 视图，元素面与长度都取当前剩余）。
  const gv = genDrainViewOf(a);
  const mi = matchIterElements(a);
  if (mi || gv) {
    // R1b：exact 生成器视图（线性收集序列）→ 切片越过 cap 出 exact 元组
    const exact = gv?.exact === true;
    const sliced = (drainGenElements(a) ?? mi ?? gv!.peekAll()).slice(start);
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
  // Bug 82：Set/Map rest 解构——同源侧表切片（`const [...all] = new Set(…)`
  // 此前落尾 unknown，all.length 假不可判；Map 条目是 [k, v] 元组）
  if (isSetAbs(a)) return tupleOrWiden(setElementsAbs(a).slice(start), a.conf);
  if (isMapAbs(a)) return tupleOrWiden(mapEntriesAbs(a).slice(start), a.conf);
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
    // Bug 236：boxed String 品牌——字符序列精确展开（原生 String 包装对象
    // 可迭代：String.prototype[Symbol.iterator] 按 code point 产出字符）
    const boxedChars = boxedStringChars(x);
    if (boxedChars) return boxedChars;
    // Bug 54：生成器对象是消费——从当前位取剩余（drain），此后耗尽
    const drained = drainGenElements(x);
    if (drained) return drained;
    const mi = matchIterElements(x);
    if (mi) return mi;
    // Bug 140：用户 iterable——按迭代序精确展开（GetIterator + IteratorNext）
    const ui = collectUserIterElems(x, USER_ITER_MAX_STEPS);
    if (ui) return ui.truncated ? [...ui.els, unknown] : ui.els;
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

/** 可迭代性三档判定（$elems/$iterCheck/$concat 共享；Bug 110 起 Array.from
 *  的 obj 臂同槽复用——@@iterator 槽即 total，两个消费者口径一致）。 */
export function iterabilityKind(a: Abs): IterabilityKind {
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
    // Bug 236：内建 brand 的**原型面 @@iterator 存在性**（原生规范固定，可静态
    // 判定）。此前一律「内层 total → total，否则 may」⇒ **全部 brand 一律判
    // 「可能不可迭代」**：`[...new String("ab")]` 记 may-throw TypeError
    // （L1/L2 假红——原生返回 ["a","b"]），而 `new Number(1)`（原生确实不
    // 可迭代、展开定抛）也只记 may（不精确）。查原型而非内层 ⇒ 分流成立。
    const protoKind = builtinBrandProtoIterability(s.name);
    if (protoKind) return protoKind;
    return iterabilityKind(s.shape) === "total" ? "total" : "may";
  }
  return "may";
}

/**
 * Bug 236：内建 brand 的原型链 @@iterator 存在性（原生规范固定 ⇒ 静态可判）。
 *
 * - String：String.prototype[Symbol.iterator] 存在 ⇒ **可迭代**（total）
 * - Number / Boolean：原型无 @@iterator ⇒ **不可迭代**（definite——展开
 *   定抛 TypeError，与原生一致）
 *
 * 只对**未被用户类占用**的品牌名生效：用户 `class Number { *[Symbol.iterator](){} }`
 * 是自定义可迭代家族，不得套内建结论（回落 may）。其余内建 brand 不在表内
 * （TypedArray 家族原型确有 @@iterator，但内层空 obj 不承诺 ⇒ 保守 may，
 * 与 Bug 236 前的口径一致，无回归）。
 */
function builtinBrandProtoIterability(name: string): IterabilityKind | undefined {
  if (name !== "String" && name !== "Number" && name !== "Boolean") return undefined;
  if (getEvalClass(name)) return undefined; // 用户类同名 → 不可套内建结论
  return name === "String" ? "total" : "definite";
}

/**
 * Bug 236：boxed String 品牌（`new String("ab")` / `Object("ab")`）的字符
 * 序列——内层 obj 带 "0".."n-1" 字符槽（原生 String 包装对象的自有索引
 * 属性）+ length 槽；原生 String.prototype[Symbol.iterator] 按 code point
 * 展开 ⇒ 元素域 = 字符序列（非 literal 抽象串 → undefined，交给上层降级）。
 */
function boxedStringChars(a: Abs): Abs[] | undefined {
  if (a.shape.k !== "brand" || a.shape.name !== "String") return undefined;
  const inner = a.shape.shape;
  if (!inner || inner.shape.k !== "obj") return undefined;
  const slots = inner.shape.slots;
  const lenR = litValue(getSlot(slots, "length")?.value ?? unknown);
  if (!lenR.ok || typeof lenR.value !== "number") return undefined;
  const out: Abs[] = [];
  for (let i = 0; i < lenR.value; i++) {
    const sl = getSlot(slots, String(i));
    if (!sl) return undefined; // 槽缺 → 不可判（不得折确定长度）
    out.push(sl.value);
  }
  return out;
}

/** Bug 236：boxed String 品牌的长度（原生 String 包装对象 length 自有槽） */
function boxedStringLength(a: Abs): number | undefined {
  if (a.shape.k !== "brand" || a.shape.name !== "String") return undefined;
  const inner = a.shape.shape;
  if (!inner || inner.shape.k !== "obj") return undefined;
  const lenR = litValue(getSlot(inner.shape.slots, "length")?.value ?? unknown);
  return lenR.ok && typeof lenR.value === "number" ? lenR.value : undefined;
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

/**
 * Bug 140：用户迭代器协议（GetIterator + IteratorNext）——步数安全上界。
 *
 * 原生迭代器是**惰性**的（可能无限 / 永不 done），引擎是抽象解释 ⇒ 必须
 * 有界，否则用户迭代器不终止时挂死。超界 ⇒ 元素域折 unknown（sound：
 * 剩余元素个数不可知，不得折确定长度 / 确定元素）。
 */
const USER_ITER_MAX_STEPS = 1024;

/**
 * fn 值是否**真实现**（可驱动）。
 *
 * 引擎自建迭代器的 `@@iterator` 是**空体占位** fn（`absFunction([], { body:
 * noBody })`——无 apply、无真 body）；用户方法（`$fnVal` / 转译函数）有
 * apply 钩子或真 body。占位 fn 调出来是 undefined（不是迭代器）⇒ 不算
 * 用户 iterable。
 *
 * 不变量：`noBody` 是**全局唯一**占位 body 单例（`exec/runtime/state.ts` 与
 * `builtins/shared.ts` 共用同一对象）——按身份判「是否占位」才成立。此前两
 * 模块各有一份同形对象 ⇒ 身份比较对 builtins 侧建的占位恒失配 ⇒ 引擎原生
 * 迭代器（`abstractSeqIteratorAbs` 的 `@@iterator`）被误判为真实现 ⇒ 跑
 * 用户协议调占位 fn ⇒ 确定 TypeError（`[...Array.from('ab').keys()]` 假抛）。
 */
function hasRealImpl(fn: Abs): boolean {
  const impl = getFnImpl(fn);
  if (!impl) return false;
  if (typeof impl.apply === "function") return true;
  return !!impl.body && impl.body !== noBody;
}

/**
 * 用户 iterable 的 `@@iterator` 槽值（非用户 iterable → undefined）。
 *
 * 判据（与原生 GetMethod 一致）：接收者带**自有** `@@iterator` 槽 **且**
 * 引擎无其元素模型——生成器对象 / `$tpl` 标签对象 / 集合迭代器
 * （Array/Map/Set 的 values/keys/entries）/ matchAll 迭代器各有侧表 ⇒ 走
 * 既有消费路径（`$idx` peek / drain / 侧表切片），**不进**用户协议。
 */
function userIteratorFn(a: Abs): Abs | undefined {
  if (matchIterElements(a) !== undefined) return undefined;
  const fn = $get(a, "@@iterator", { symbolKey: true });
  if (!fn || !hasRealImpl(fn)) return undefined;
  return fn;
}

/**
 * 用户迭代器协议采集：调 `@@iterator`（this = 接收者）拿迭代器 → 反复调
 * `next()`（this = 迭代器）→ 读结果对象的 `value` / `done` → 元素列表
 * （**迭代序**，不是索引序）。
 *
 * 返回 null = 非用户 iterable（调用方走既有 `$idx` / `$arrRest` 快速路径）。
 * `truncated` = 元素列表可能不完整（步数上界触顶 / `done` 抽象不可判）⇒
 * 尾域折 unknown（sound）。
 */
function collectUserIterElems(
  a: Abs,
  maxSteps: number,
): { els: Abs[]; truncated: boolean } | null {
  const iterFn = userIteratorFn(a);
  if (!iterFn) return null;
  const limit = Math.max(0, Math.min(maxSteps, USER_ITER_MAX_STEPS));
  // GetIterator：调 @@iterator（this = 接收者）
  const iter = $call(iterFn, [], a);
  // Bug 199：登记迭代器对象——非正常退出（break/return/throw）的
  // IteratorClose（调 return()）按此取用。
  registerUserIter(a, iter);
  const els: Abs[] = [];
  let truncated = false;
  let exhausted = false;
  for (let i = 0; i < limit; i++) {
    const nextFn = $get(iter, "next");
    if (!hasRealImpl(nextFn)) {
      // 原生：iter.next 不可调用 → TypeError（引擎保守：may-throw + 尾域折
      // unknown——不因引擎建模缺口定抛假错）
      recordMayThrow({ kind: "TypeError", cause: "iterator has no callable next method" });
      truncated = true;
      break;
    }
    // IteratorNext：调 next()（this = 迭代器）读结果对象的 value / done
    const res = $call(nextFn, [], iter);
    if (res.shape.k !== "obj" && res.shape.k !== "brand") {
      recordMayThrow({ kind: "TypeError", cause: "iterator result is not an object" });
      truncated = true;
      break;
    }
    // done 语义 = ToBoolean（原生 Get(result, "done") 的真值判定）
    const dt = litTruth($get(res, "done"));
    if (dt !== false) {
      // done 为真 → 迭代结束；done 抽象（不可判）→ 保守停（尾域折 unknown）
      exhausted = dt === true;
      truncated = dt === undefined;
      break;
    }
    els.push($get(res, "value"));
  }
  // 步数上界触顶（未 done）⇒ 剩余元素个数不可知 → 折 unknown（sound）
  if (els.length >= limit && limit >= USER_ITER_MAX_STEPS) truncated = true;
  // Bug 199：迭代器报告 done ⇒ 元素数确切（for-of 迭代次数据此定 N 次，
  // 与原生同）；未耗尽 ⇒ 长度不可知 ⇒ 沿用 unbounded 单代表口径。
  registerUserIterLen(a, exhausted && !truncated ? els.length : undefined);
  return { els, truncated };
}

/**
 * 用户 iterable 的**迭代序**元素读取器（`$iterCheck` 返回值）：
 * - `get(i)`：第 i 个元素（迭代序）；越界 = 迭代已 done → exact undefined；
 *   列表被截断（truncated）→ unknown（sound）。
 * - `rest(i)`：从第 i 项起的剩余元素（原生 rest 语义：迭代到 done 为止）；
 *   截断 → unknown（剩余长度不可知）。
 */
export interface UserIterReader {
  get(i: number): Abs;
  rest(i: number): Abs;
}

/**
 * Bug 199：IteratorClose——对**用户迭代器**调 `return()`（原生规范：
 * ForIn/OfBodyEvaluation 的任何 abrupt completion，以及数组解构模式填满
 * 而迭代器未耗尽时，都触发 IteratorClose）。
 *
 * 规范细节（ECMA-262 IteratorClose / GetMethod）：
 * - 无 `return` 槽（GetMethod 得 undefined/null）⇒ 不调用（原生无副作用）。
 * - `return` 槽是**确定的非可调用值** ⇒ GetMethod 定抛 TypeError。
 * - `return()` 抛错 ⇒ 该抛错**取代**原完成值（break 被换成 throw）⇒ 冒泡。
 * - `return()` 的返回值**必须是对象**⇒ 否则原生定抛 TypeError（`return(){}`
 *   无返回值即抛——原生实测）。
 * - 抽象面（占位 fn / 不可判值）⇒ 不判定（不得凭空抛——引擎建模缺口
 *   不得折成原生定抛）。
 */
function iteratorClose(iter: Abs | undefined): void {
  if (!iter) return;
  const ret = $get(iter, "return", { silent: true });
  if (!ret) return;
  const lit = ret.term?.op === "lit" ? (ret.term as { value: unknown }).value : undefined;
  if (ret.term?.op === "lit") {
    // GetMethod：undefined/null ⇒ 无 return 槽（不调用）
    if (lit === undefined || lit === null) return;
    // 确定的非可调用值 ⇒ GetMethod 定抛 TypeError
    if (typeof lit !== "function") throw new NudoThrow(errorTypeAbs("TypeError"));
  }
  // 抽象/占位 fn ⇒ 不判定（不得凭空抛）
  if (!hasRealImpl(ret)) return;
  const r = $call(ret, [], iter);
  // IteratorClose step 5：return() 的返回值必须是对象 ⇒ 否则定抛 TypeError
  if (r?.term?.op === "lit") {
    const v = (r.term as { value: unknown }).value;
    if (v === null || (typeof v !== "object" && typeof v !== "function")) {
      throw new NudoThrow(errorTypeAbs("TypeError"));
    }
  }
}

/**
 * 数组解构模式接收者守卫 + **用户 iterable 迭代序元素读取器**。
 *
 * 两件事（同一调用，避免生成码再判一次接收者形态）：
 * ①守卫：原生数组解构 = GetIterator + IteratorNext，非可迭代接收者抛
 *   TypeError（definite）；抽象接收者记 may-throw。
 * ②返回用户 iterable（对象带自有 `@@iterator` 槽、引擎无其元素模型）的
 *   迭代序元素读取器；**非**用户 iterable → null ⇒ 调用方走既有 `$idx` /
 *   `$arrRest` 快速路径（tuple / 数组 / 字符串 / Set / Map / 生成器 /
 *   `$tpl` / 数组迭代器…逐字不变）。
 *
 * `maxElements`：本次最多取几个元素（原生按需取：模式有 n 个位置就取 n 个，
 * 空位也消耗一个）；缺省 / 负数 = 取到 done（受 USER_ITER_MAX_STEPS 上界约束）。
 */
export function $iterCheck(a: unknown, maxElements?: number): UserIterReader | null {
  const v = asAbsVal(a);
  guardIterable(v, "array destructuring");
  // Bug 34：体内抛错的生成器（延迟异常挂对象侧表）——解构消费触达抛点
  replayGenDeferred(v);
  const bounded = maxElements !== undefined && maxElements >= 0;
  const r = collectUserIterElems(
    v,
    maxElements === undefined || maxElements < 0 ? USER_ITER_MAX_STEPS : maxElements,
  );
  if (!r) return null;
  const { els, truncated } = r;
  // Bug 199：模式填满（无 rest）而迭代器未耗尽 ⇒ IteratorClose（原生调
  // `return()`——`const [a,b] = it` 也会触发）。模式带 rest（取到 done）
  // 或迭代器已耗尽 ⇒ 不调用（原生同）。
  if (bounded && els.length >= maxElements! && !truncated) {
    iteratorClose(userIterOf(v));
  }
  return {
    get: (i: number): Abs => (i < els.length ? els[i]! : truncated ? unknown : undef()),
    rest: (i: number): Abs => (truncated ? unknown : $arr(els.slice(i))),
  };
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
  // Bug 198（S20）：live 集合 / 数组迭代器的元素面在**消费视图**里（静态侧表
  // 已撤）⇒ 长度可知性必须同口径认消费视图——只查静态侧表会把「元素个数
  // 确定」的委托降级成 path（bumpGenPathSensitive）。消费视图存在即元素个数
  // 确定（含 R1b 的 exact 生成器视图——它是消费视图的一种）。
  const lengthKnown =
    s.k === "tuple" ||
    s.k === "never" ||
    (s.k === "prim" && s.type === "string") ||
    isSetAbs(a) ||
    isMapAbs(a) ||
    matchIterElements(a) !== undefined ||
    genDrainViewOf(a) !== undefined;
  return { els, lengthKnown };
}

/** 模板标签对象（GetTemplateObject，Bug 34）：冻结的类数组 obj——数字槽
 *  为 cooked 字符串（无效转义序列时 cooked 是 undefined，原生实测）、
 *  length 精确、.raw 为 raw 字符串数组；@@iterator 槽给函数形状
 * （`[...s]` / `for..of` / `Symbol.iterator in s` 均按可迭代面判定，
 *  不得把冻结数组误判 definite 不可迭代）。
 *
 * Bug 195：原生 GetTemplateObject = `CreateArrayFromList` + `SetIntegrityLevel(frozen)`
 * ⇒ 模板对象是**冻结的数组 exotic**：
 * - `length` / `raw` / `@@iterator` 是**非枚举**自有属性（原生三者全非枚举；
 *   `Object.keys(s)` 只有下标 "0".."n-1"）——此前平铺为可枚举槽 ⇒ Object.keys
 *   折出 "0,1,length,raw,@@iterator"（错值）。
 * - `Object.isFrozen(s)` / `Object.isFrozen(s.raw)` 均为 true（原生冻结）——
 *   此前 false。冻结走 extState 侧表（`Object.isFrozen` 的判定源）。
 * - `JSON.stringify(s)` 走**数组序列化**（原生 `["a","b"]`）——此前走 obj 面
 *   折 `{"0":"a",...}`。数组视图标注（markMatchArrayView）复用 RegExp exec
 *   结果同款机制（json.ts 消费，不改 json.ts）。
 *
 * **未建模（越界，需 member.ts / builtins/array.ts）**：
 * - `Array.isArray(s)` 原生 **true**（模板对象是数组 exotic）——引擎 isArray
 *   只认 arr/tuple 形状 ⇒ 仍折 false（需 builtins/array.ts 查模板对象标注）。
 * - 数组原型方法（`s.join` / `s.map` / `s.slice` / `s.indexOf` / `s.concat`）
 *   原生可调（模板对象继承 Array.prototype）——引擎 obj 接收者的数组方法
 *   派发面只认 tuple/arr 形状 ⇒ 此前折**确定抛 TypeError**（假抛）。
 *   需 member.ts 的 $get 数组方法臂认模板对象（按元素侧表投影）。
 */
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
  const rawArr = $arr(raw.map((r) => $lit(r)));
  setSlot(slots, "raw", { value: rawArr });
  setSlot(slots, "@@iterator", {
    value: absFunction([], { body: noBody }, { ctor: false }),
  });
  const t = abs({ k: "obj", slots }, undefined, undefined, "exact");
  // Bug 195：元槽非枚举 + 不可写（原生冻结数组的自有属性全 non-writable/
  // non-configurable；length/raw/@@iterator 另 non-enumerable）。
  for (const k of ["length", "raw", "@@iterator"]) {
    setPropFlags(t, k, { enumerable: false, writable: false, configurable: false });
  }
  // Bug 195：冻结（原生 SetIntegrityLevel(frozen)——s 与 s.raw 皆冻结）。
  markExtState(t, "frozen");
  markExtState(rawArr, "frozen");
  // Bug 195：数组序列化视图（原生模板对象是 Array ⇒ JSON.stringify 走数组面）
  markMatchArrayView(t);
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
  // Bug 236：boxed String 品牌——字符序列精确展开（原生可迭代）
  const boxedChars = boxedStringChars(a);
  if (boxedChars) return boxedChars;
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
  // Bug 140：用户 iterable（对象带自有 `@@iterator` 槽，引擎无其元素模型）——
  // 元素按**迭代序**取（GetIterator + IteratorNext），不是按索引序。步数上界
  // 触顶时尾域折 unknown（sound：剩余元素个数不可知）。
  const ui = collectUserIterElems(a, USER_ITER_MAX_STEPS);
  if (ui) return ui.truncated ? [...ui.els, unknown] : ui.els;
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
/** 数组索引键（原生属性序：整数键升序在前） */
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

export function $forInKeys(o: Abs): Abs {
  const shape = o.shape;
  if (shape.k === "sum") {
    // DEC-006：空 sum 成员 join 无单位元——不得裸 reduce
    const members = shape.members.map((m) => $forInKeys(m));
    return members.length ? members.reduce((a, b) => joinAbs(a, b)) : unknown;
  }
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
      const own = enumOwnKeys(inner, inner.shape.slots).filter(
        (k) => !(shape.name === "String" && k === "length"),
      );
      // Bug 200：原型链上的可枚举键（原生 for-in **沿原型链**枚举）——此前
      // 只枚举自有槽，原型上的可枚举属性被整体丢弃（`class A{};
      // A.prototype.b = 2; for (k in new A())` 原生 "ab"，引擎 "a"）。
      const protoKeys = brandProtoEnumerableKeys(shape.name, o);
      if (protoKeys === undefined) {
        // 链不可判定（动态父 / 链洞 / 显式改过原型）⇒ 不得断言精确键序列
        // （可能漏键）——按 Bug 18 口径降级为抽象字符串键数组。
        return abs({ k: "arr", element: str() }, undefined, undefined, "partial");
      }
      const seen = new Set<string>();
      const all: string[] = [];
      for (const k of [...own, ...protoKeys]) {
        if (seen.has(k)) continue;
        seen.add(k);
        all.push(k);
      }
      return $arr(all.map((k) => $lit(k)));
    }
    return $arr([]);
  }
  // 其余（num/bool/bigint/symbol/null/undefined prim 字面量或抽象、fn、eff）：
  // 原生 ToObject 后零可枚举键 → 键域确定为空，体 0 次。
  return $arr([]);
}

/**
 * Bug 200：brand 实例的**原型链可枚举键**（原生 for-in 沿原型链枚举）。
 *
 * 引擎模型下原型可枚举属性的落点：
 * - 注册类（`class A{}`）：`protoBrandAbs(name)` 的内层 obj——`A.prototype.b = 2`
 *   落此槽（`$set` 对 brand "A.prototype" 的内层 obj 写槽）。
 * - 函数声明（伪父 `function F(){}`）：`fnProtoOf(classValue)` 的 obj——
 *   `F.prototype.b = 2` 落此槽。
 * 两者都带 "constructor" 槽——原生 `A.prototype.constructor` **非枚举** ⇒ 剔除。
 *
 * 返回 undefined = **链不可判定**（extends 动态表达式 / 链洞 / 显式
 * setPrototypeOf 改过原型）⇒ 调用方不得断言精确键序列（可能漏键），
 * 按 Bug 18 口径降级为抽象字符串键数组。
 */
function brandProtoEnumerableKeys(brandName: string, recv: Abs): string[] | undefined {
  // 实例原型被显式改过 → 链不再是类注册表那条 ⇒ 不可判定
  if (getProtoAbs(recv) !== undefined) return undefined;
  // 链洞（未注册父名）⇒ 可能漏掉中间层的可枚举键
  if (classChainHasHole(brandName)) return undefined;
  const out: string[] = [];
  for (const n of evalClassChain(brandName)) {
    const inner = protoInnerOf(n);
    if (!inner || inner.shape.k !== "obj") continue;
    // 原型对象自身被显式改过原型 → 其上的可枚举键不可判定
    if (getProtoAbs(inner) !== undefined) return undefined;
    // 类方法 / 实例访问器在原生是**非枚举**属性（`class A{ m(){} }` 的
    // `A.prototype.m` 不可枚举——for-in 看不到）——原型 obj 里带着这些槽，
    // 必须剔除（`A.prototype.m = 5` 也不改可枚举性：原属性非枚举）。
    const spec = getEvalClass(n);
    const nonEnumerable = new Set<string>([
      ...Object.keys(spec?.methods ?? {}),
      ...Object.keys(spec?.accessors ?? {}),
    ]);
    const keys = enumOwnKeys(inner, inner.shape.slots).filter(
      (k) => k !== "constructor" && !nonEnumerable.has(k),
    );
    // 原生每层的键序：整数键升序 → 其余键按插入序
    const intKeys = keys.filter(isArrayIndexKey).sort((a, b) => Number(a) - Number(b));
    const strKeys = keys.filter((k) => !isArrayIndexKey(k));
    out.push(...intKeys, ...strKeys);
  }
  return out;
}

/** 类名 → 其原型对象的内层 obj（注册类走 protoBrandAbs；函数声明走伪父） */
function protoInnerOf(name: string): Abs | undefined {
  const cv = lookupClassValue(name);
  if (cv && cv.shape.k === "fn") return fnProtoOf(cv);
  if (getEvalClass(name)) {
    const pbs = protoBrandAbs(name).shape;
    return pbs.k === "brand" ? pbs.shape : undefined;
  }
  return undefined;
}

/** 侧表迭代物（生成器对象 / 模板标签 / matchAll 迭代器，Bug 22）的精确
 *  长度——matchIterElements 命中即长度已知（for-of 精确展开用）。
 *  Bug 141：async generator **没有 @@iterator 槽**（原生只有 @@asyncIterator）
 *  ⇒ matchIterElements 不命中；改读生成器消费视图的剩余条目数（与同步
 *  generator 同口径：剩余 = 未消费条目）。 */
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
    if (!pack || !unpack) return;
    // Bug 215：具体迭代（无快照 join）也须实施 @nudo:invariant——否则
    // for-of 的公理被静默丢弃（$for 走 applyExtJoin 有实施）。
    // 无公理时不取绑定包（零行为变化：取包会暴露转译侧 pack 闭包的既有缺陷）。
    if (!exitJoin) {
      if (!hasInvariantSpecs()) return;
      const cur = pack();
      const strengthened = applyExitJoinInvariants(cur);
      if (strengthened !== cur) unpack(strengthened);
      return;
    }
    const joined = joinAbs(exitJoin, pack());
    unpack(applyExitJoinInvariants(widen ? widen.widenFinal(joined) : joined));
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
  // 非具体容器：长度未知（可能空、可能更长）→ 单代表元素只跑一次
  // （同一元素重复 join 幂等，maxIters 次展开只会让索引假精确 + 大数组
  // 反复深拷贝把分析拖死）；0 次出口由下方 snapExit join，保持 sound。
  const unbounded = knownLen === undefined;
  // Bug 198：Map/Set 的 for-of 必须是接收者的 **live 视图**——原生迭代器
  // 持有条目指针：迭代期间新增的条目被访问、删除的条目被跳过
  // （`for (const [k] of m) { out.push(k); m.set("b",2) }` 原生 "a,b"，
  // 引擎快照口径只有 "a"）。表不干净 ⇒ 无 live 视图 ⇒ 沿用快照口径。
  const liveColl =
    isMapAbs(iterable) || isSetAbs(iterable) ? collectionLiveEntries(iterable) : undefined;

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
  const n = liveColl
    ? concreteCap
    : knownLen !== undefined
      ? Math.min(knownLen, concreteCap)
      : items.length > 0
        ? 1
        : 0;
  const concreteOverrun = knownLen !== undefined && knownLen > concreteCap;

  for (let i = 0; i < n; i++) {
    let item: Abs;
    if (liveColl) {
      // live 视图：每轮重读接收者当前条目表（删除的跳过、新增的进入）
      const e = liveColl.take();
      if (e === undefined) break; // 迭代耗尽（原生 done）
      item = e;
    } else {
      item = items.length > 0 ? items[Math.min(i, items.length - 1)]! : unknown;
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
        iteratorClose(userIter);
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
      iteratorClose(userIter);
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
  const live = collectionLiveEntries(recv);
  if (isMapAbs(recv)) {
    const visit = (entry: Abs): void => {
      if (entry.shape.k === "tuple" && entry.shape.elements.length >= 2) {
        const key = entry.shape.elements[0]!;
        const value = entry.shape.elements[1]!;
        invokeCb([value, key, recv]);
      }
    };
    if (live) {
      // live 视图有界：回调若不断新增条目，原生会**无限循环**——引擎必须
      // 终止（硬上限同具体循环上限；到达即停，不产出悬挂迭代）。
      for (let i = 0; i < MAX_CONCRETE_LOOP_ITERS; i++) {
        const e = live.take();
        if (e === undefined) break;
        visit(e);
      }
      return undef();
    }
    for (const entry of mapEntriesAbs(recv)) visit(entry);
    return undef();
  }
  if (isSetAbs(recv)) {
    if (live) {
      for (let i = 0; i < MAX_CONCRETE_LOOP_ITERS; i++) {
        const e = live.take();
        if (e === undefined) break;
        invokeCb([e, e, recv]);
      }
      return undef();
    }
    for (const el of setElementsAbs(recv)) {
      invokeCb([el, el, recv]);
    }
    return undef();
  }
  return undefined;
}
