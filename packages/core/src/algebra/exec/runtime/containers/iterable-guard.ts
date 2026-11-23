/** 迭代消费守卫：definite 非可迭代 → TypeError；may → 软效果。 */
import type { Abs } from "../../../abs.ts";
import { NudoThrow } from "../state.ts";
import { errorTypeAbs, recordMayThrow } from "../../may-throw.ts";
import { iterabilityKind } from "./iterability.ts";

export function guardIterable(a: Abs, ctx: string): void {
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


/**
 * 用户 iterable 的 `@@iterator` 槽值（非用户 iterable → undefined）。
 *
 * 判据（与原生 GetMethod 一致）：接收者带**自有** `@@iterator` 槽 **且**
 * 引擎无其元素模型——生成器对象 / `$tpl` 标签对象 / 集合迭代器
 * （Array/Map/Set 的 values/keys/entries）/ matchAll 迭代器各有侧表 ⇒ 走
 * 既有消费路径（`$idx` peek / drain / 侧表切片），**不进**用户协议。
 */


/**
 * 用户迭代器协议采集：调 `@@iterator`（this = 接收者）拿迭代器 → 反复调
 * `next()`（this = 迭代器）→ 读结果对象的 `value` / `done` → 元素列表
 * （**迭代序**，不是索引序）。
 *
 * 返回 null = 非用户 iterable（调用方走既有 `$idx` / `$arrRest` 快速路径）。
 * `truncated` = 元素列表可能不完整（步数上界触顶 / `done` 抽象不可判）⇒
 * 尾域折 unknown（sound）。
 */


/**
 * 用户 iterable 的**迭代序**元素读取器（`$iterCheck` 返回值）：
 * - `get(i)`：第 i 个元素（迭代序）；越界 = 迭代已 done → exact undefined；
 *   列表被截断（truncated）→ unknown（sound）。
 * - `rest(i)`：从第 i 项起的剩余元素（原生 rest 语义：迭代到 done 为止）；
 *   截断 → unknown（剩余长度不可知）。
 */


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


/** 元素列表（tuple 展开；arr 抽象；C1 Set/Map 逐条目；matchAll 迭代器逐匹配项；
 *  字符串按 code points）。Map 迭代语义是 entry `[key, value]` 元组，不是裸 value。
 *  消费前先过可迭代性守卫（Bug 6）：prim 字面量接收者 → 原生 definite
 *  TypeError；any/unknown → may。$forOf 与 call/new spread 实参路径继承。
 *  Bug 34：生成器对象的体内延迟异常（definite 抛 / soft may-throw 重记）
 *  在消费点重放——迭代不再静默截断成前缀。 */


/** yield* 委托展开（Bug 82）：迭代性守卫与元素列表同 $elems，另报长度
 *  可知性——tuple / 字符串 prim / Set / Map / match-iter 是全量精确展开
 *  （元素个数确定）；arr / any / obj / brand / sum 等给单代表元素，
 *  长度不可判（收集器不得以 exact 元组出货）。 */


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
