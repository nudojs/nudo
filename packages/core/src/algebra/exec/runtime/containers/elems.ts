/**
 * 迭代元素投影：$elems / $yieldStarElems / elemsOf。
 *
 * 从 iterate.ts 抽出；可迭代性守卫与能力查询由 iterate 提供。
 */
import type { Abs } from "../../../abs.ts";
import { abs, litValue, unknown } from "../../../abs.ts";
import { $lit } from "../state.ts";
import {
  drainGenElements,
  genDrainViewOf,
  matchIterElements,
  replayGenDeferred,
} from "../../match-iter.ts";
import {
  boxedStringChars,
  typedArrayIterElems,
} from "./iterate-brand-elements.ts";
import {
  USER_ITER_MAX_STEPS,
  collectUserIterElems,
} from "./user-iterator.ts";
import { abstractSeqElementOf } from "../../../builtins/error/iterator.ts";
import { isMapAbs, isSetAbs } from "../../../collections.ts";
import { anyMemberResult } from "../../member-diag.ts";
import { markDomainShared } from "../../../len-sharing.ts";
import { TYPED_ARRAY_ELEMENT } from "../../../builtins/shared.ts";
import { guardIterable, iterableExactElements } from "./iterate.ts";

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


/**
 * TypedArray brand 的**精确**迭代元素序列：长度槽可判且内层索引槽齐备时
 * 逐槽取值（`[...new Uint8Array([1,2])]` → [1,2]）；任一位不可判 → undefined
 * （调用方退元素域单代表，不得折半精确元组）。
 */


export function elemsOf(a: Abs): Abs[] {
  if (a.shape.k === "tuple") return [...a.shape.elements];
  // #175 残留：arr 元素域分发标记（len-sharing.ts——跨读不保证同值）
  if (a.shape.k === "arr") return [markDomainShared(a.shape.element)];
  // BUG-401：注解 `Map<K,V>` / `Set<T>` 的 obj 模型携带集合身份 facet
  // （方法面保留 obj，元素域由 genElements 承载）——长度不可知，不能先过
  // `iterableExactElements`（它按协议故意返回 null）。
  if (a.facets?.brand === "Map" || a.facets?.brand === "Set") {
    const els = a.facets.genElements;
    if (els && els.length > 0) return els;
  }
  // Set/Map、URLSearchParams、boxed String、生成器消费视图、match 迭代器、
  // 字面量字符串、已走完的用户 iterable、TypedArray、brand 内层 tuple ——
  // 精确序列只有一个来源。
  const exact = iterableExactElements(a);
  if (exact) return exact;
  // BUG-364：长度未知的序列迭代器（arr.keys/values/entries 的抽象臂、
  // 抽象字符串迭代器）——元素域取单代表（表不声明长度 ⇒ for-of 仍
  // unbounded，0 次出口由调用方 join 承接）。
  const ase = abstractSeqElementOf(a);
  if (ase !== undefined) return [ase];
  // 抽象字符串 prim：code point 迭代，元素域恒 string（Bug 19：for-of /
  // yield* 循环变量折 unknown → 算术/成员读级联污染）——单代表元素，与
  // arr 臂 [element] 同口径（长度不可知由 $forOf unbounded 出口 join 承接）
  if (a.shape.k === "prim" && a.shape.type === "string") {
    return [abs({ k: "prim", type: "string" }, undefined, undefined, "path")];
  }
  // Bug 140：用户 iterable 的**截断**尾域（exact 能力返回 null）——
  // 元素按迭代序取，触顶后补 unknown（剩余元素个数不可知）。
  const ui = collectUserIterElems(a, USER_ITER_MAX_STEPS);
  if (ui) return ui.truncated ? [...ui.els, unknown] : ui.els;
  // TypedArray brand 的非精确回退：内层索引槽未物化 ⇒ 元素域单代表。
  if (a.shape.k === "brand") {
    const elem = TYPED_ARRAY_ELEMENT[(a.shape as { name?: string }).name ?? ""];
    if (elem) return [abs({ k: "prim", type: elem }, undefined, undefined, "path")];
    // brand 结构面在内层（issue #147）：env/harvest 的 Array<T> brand 的
    // for-of / spread 元素域 = 内层 arr 元素（此前折 unknown）。Set/Map/
    // match-iter brand 已由能力函数命中，此处只兜结构 delegation。
    return elemsOf(a.shape.shape);
  }
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


/**
 * Bug 285：Proxy 的 for…in 键序列（ES2024 13.7.5.9 + 10.5.5）——
 * 1. [[OwnPropertyKeys]] → ownKeys 陷阱（proxyOwnKeysTrapKeys：**单一实现**，
 *    含规范不变量校验——重复名 / 非字符串键 / 漏靶的不可配置自有键 ⇒ TypeError）；
 * 2. 每个键按 [[GetOwnProperty]] 判**可枚举性**（代理的 getOwnPropertyDescriptor
 *    陷阱优先；无该陷阱 ⇒ 靶的自有描述符）——不可枚举 / 靶上不存在 ⇒ 不进结果；
 * 3. 键序 = **陷阱结果的顺序**（原生 for-in 不重排整数键——与普通对象路径的
 *    「整数键升序在前」不同）。
 *
 * 返回 undefined = **无 ownKeys 陷阱** ⇒ 调用方落**靶**语义（原生规范 step 6）。
 */




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


/** 类名 → 其原型对象的内层 obj（注册类走规格身份；函数声明走伪父）。 */


/** 侧表迭代物（生成器对象 / 模板标签 / matchAll 迭代器，Bug 22）的精确
 *  长度——matchIterElements 命中即长度已知（for-of 精确展开用）。
 *  Bug 141：async generator **没有 @@iterator 槽**（原生只有 @@asyncIterator）
 *  ⇒ matchIterElements 不命中；改读生成器消费视图的剩余条目数（与同步
 *  generator 同口径：剩余 = 未消费条目）。 */


/** Bug 98：for-in 快照键的在场重查——原生 EnumerateObjectProperties 到键
 *  时回查 [[GetOwnProperty]]，进体前被 delete 的键跳过该迭代。仅闭 obj
 *  （自有槽 hasOwnProperty 判定）与 tuple（hole 判定）可精确重查；其余面
 *  （any/unknown/prim/开 obj/抽象 arr/brand/fn/eff）键序列本身已是抽象
 *  近似 → 恒在场（保持体执行，0..N 出口 join 承接）。不走 $in：prim 接收
 *  者（字符串键来自字面量面，不可 delete）会被 $in 记 definite TypeError，
 *  而原生 for-in 对 prim 接收者零迭代不抛；$in 的原型链命中口径也与
 *  for-in 的「自有可枚举」判据不符。跳过 = 过近似的安全侧（漏跳只失精度）。 */


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


/** 无界迭代代表元的 join 上限（Bug 220）：用户迭代器采集可达
 *  USER_ITER_MAX_STEPS（1024）条，1024 路字面量并集会把下游算术/成员读
 *  拖死；超过即折 unknown（等价抽象、廉价）。 */


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
