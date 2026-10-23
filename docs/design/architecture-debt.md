# 架构债台账（A 类）· 10 条

> **性质**：这些不是「还没排期的 bug」，而是**卡在求值模型 / Abs 表示层的欠账**。
> 局部修不动 —— 改法要么引入新的 wrong-exact（比现状更坏），要么需要**改内核表示**
> ⇒ 影响 `leqAbs` ⇒ 影响**全部门禁精度** ⇒ 必须**独立排期 + 独立回归基线**。
>
> **状态**：2026-10-23 起，本文档单独记录 A 类；B / C 两类（**可修**）在
> `tmp/bugs/_修复进度.md` 的各族「遗留」表里逐条推进。
>
> **分类依据**：台账遗留表 `归属` 列含「架构债」的行（B / C 两类见
> `tmp/bugs/_修复进度.md`「📊 精度债的可修性分类」段）。

---

## A1 · Bug 212 · 生成器体在**构造期**就跑完

| | |
|---|---|
| **现象** | 生成器体在构造期整个跑完 ⇒ 外层绑定被提前改写，且改成一个**在任何原生观测点都不成立**的值（引擎 `1` / 原生 `0`；引擎 `"ab"` / 原生 `""`；引擎 `5` / 原生 `1`；引擎 `"ab"` / 原生 `"a"`）。dts 面连带污染：`Generator<any \| number>`、`Case: entry@L1 () => 1` |
| **根因** | `$gen`（`packages/core/src/algebra/exec/runtime/async.ts`）在**构造期**调 `body()`；转译后的体对**外层绑定**的写是**闭包变量的裸 JS 赋值**（`return n = __v`）⇒ 写必然落地且提前落地 |
| **两条硬约束**（各自足以否掉 runtime 侧修法） | ① **eager 收集是值域/签名面的承重结构**：元素域与 `conf`（exact/path/widened）在构造期就烘进 `Abs` 的 shape ⇒ 惰性化会把 `Generator<any \| number>` 退成 `Generator<unknown>` 并降 `conf` ⇒ 冲击 L1/L2 门禁精度<br>② **写穿在 runtime 侧无句柄可拦**：`$assignRecord` 只能观测、其返回值被丢弃 ⇒ 任何能中和「写穿」的方案都必须先有转译侧钩子 |
| **最小可行修法**（纯转译侧、不动公开面） | 在 `$gen` 的体外套「**自由写快照 + `$join` 折回**」—— 复用仓里已有的 `collectFreeAssignedNames`（`exec/transpile/helpers.ts`）算「该体写到的外层绑定」；`$copy` / `$join` 均为既有导出 ⇒ 不触公共 API 冻结。**把「确定的错值」变成 sound 的过近似**（`0\|1` 而非 `1`）；逐点精确需「真挂起」（另立族） |
| **落点冲突** | 唯一落点在 `exec/transpile/**`（与族 45 的临时名避让机制同侧）⇒ 两族同源，宜合并承接 |
| **待拍板** | 折回用 `$join`（sound，推荐）还是「还原成事前值」（构造点精确、消费点欠近似 ⇒ 可能 L1 假绿） |
| **状态** | **架构债，未修**。详细数据流 / 11 项消费面清单 / 4 步改造路径 → [`generator-laziness.md`](./generator-laziness.md) |

---

## A2 · `class C {}; C()` 不抛 TypeError

| | |
|---|---|
| **现象** | 用户类构造器**裸调用**（无 `new`）引擎不抛（原生硬抛 `TypeError`）⇒ 产品面对「用户类构造器作 `replacer`」报 may-throw —— sound，但**非确定抛** |
| **根因** | 同 A1：eager 快照模型下「类不是可调用值」这一判定需要知道调用形态与 `new.target` 的关系 |
| **阻塞** | 需要 core 的 `callable` 面（见 A8）—— 同一个内核表示缺口 |
| **状态** | **架构债**。与 A1 同族 01/02 的求值模型面 |

---

## A3 · relation 面（无 apply）没有 throws 通道

| | |
|---|---|
| **现象** | core 的 `relationFn` **不带 throws 字段** ⇒ 「宿主会抛、但声明侧没写 apply」的 env 声明仍记「不抛」⇒ **假绿** |
| **根因** | Abs 的 relation 形状没有承载 throws 的槽位 |
| **阻塞** | 需要 core 侧给 relation 面加 throws ⇒ **触及 core 公共 API 冻结**（`packages/core/src/index.ts` / `algebra/index.ts` / `internal.ts`） |
| **状态** | **架构债（core 侧）** |

---

## A4 · core `$new` 丢弃 apply 的 throws 面

| | |
|---|---|
| **现象** | `packages/core/src/algebra/exec/class/declare.ts` 取 `isAbsApplyResult(afterR) ? afterR.abs : afterR` ⇒ **构造路径**（`new X()`）丢 throws 面 ⇒ 构造器声明的 throws **只在调用面生效** |
| **根因** | 同 A3：Abs 的 apply 结果没有统一的 throws 承载位；构造路径多一层解包把 side-channel 丢了 |
| **阻塞** | 与 A3 同源 —— 建议**合并立项**（先定 throws 在 Abs 里的承载位，再修两处消费点） |
| **状态** | **架构债（core 侧）** |

---

## A5 · core union 方法分派只认 `string` 成员

| | |
|---|---|
| **现象** | Bug 771 / 263：`convert(1).toFixed()` 的 **L5 假红仍在** —— core 的方法分派按**成员名**匹配 `string` 一族，不看接收者的实际形状 |
| **根因** | 分派判据在 `Abs` 的形状分派层按 prim 家族硬编码 |
| **阻塞** | 需要**接收者形状感知的分派**（与族 49 的 `memberLikelyHasMethod` 补 fn 分支是同一类问题的不同层）⇒ 影响 `leqAbs` ⇒ 门禁精度 |
| **状态** | **架构债（core 冻结）**。注：族 49 已在**判据层**补了 fn 分支并收窄了「确定没有」的误报，但本条的**派发层**分派（选哪个 arm）仍未按形状分 |

---

## A6 · Abs fn 形状无 overload 集合承载位

| | |
|---|---|
| **现象** | Bug 805 / 827 的「**按实参选 arm**」在收割面无法实现（目前只能给 union 返回面） |
| **根因** | `Abs` 的 fn 形状只带**单个**返回面，没有 overload 集合的承载位 |
| **阻塞** | 需要 `Abs` 形状**新增槽位** ⇒ 触及公共类型层 ⇒ 影响 `leqAbs` / `absShapeKey` / 全部产物面（dts / schema / guard） |
| **状态** | **架构债（core 冻结）** |

---

## A7 · core `substAbs` 丢 fn impl

| | |
|---|---|
| **现象** | `packages/core/src/algebra/hof.ts` 的 `substShape` case `"fn"` 丢掉 impl ⇒ 引擎面的泛型方法调用退化为 `unknown`（Bug 810 的引擎面半边） |
| **根因** | `substShape` 的 fn 分支只替换形状、不搬运 impl 侧表 |
| **阻塞** | 相对最轻的一条 —— 属**实现缺陷**而非表示缺口，但会触及 `hof.ts` 的泛型替换路径 ⇒ 影响面需要独立回归基线 |
| **状态** | **架构债（core 冻结）**。**建议**：这条可**优先于其它 A 类**单独试做 —— 若改动面可控，它可能不需要动 Abs 表示 |

---

## A8 · 826 的类「不可裸调用」

| | |
|---|---|
| **现象** | TS 的「类不是可调用值」在引擎侧无对应面 |
| **根因** | core 的 fn 形状**不区分「类」与「可调用对象」** |
| **阻塞** | 需要 core 的 `callable` 面（与 A2 同一个缺口）⇒ 触及 Abs 形状 |
| **状态** | **架构债（core 冻结）**。与 A2 合并立项 |

---

## A10 · 原型对象**自有键集**在 Abs 里没有承载位

| | |
|---|---|
| **现象** | `Object.getOwnPropertyNames(Error.prototype)` / `Object.hasOwn(Error.prototype, "name")` / `Object.keys(Error.prototype)` 这类**原型自有键面**在 Abs 里只能折**保守域**（`string[]` / boolean 域）⇒ 用户写 `Error.prototype.hasOwnProperty("name")` 这类断言时，引擎给不出确定答案 |
| **根因** | Abs 的 obj 形状有**实例**槽表，但**没有**「原型对象的自有键集」承载位 ⇒ 原型面只能退回保守域 |
| **本轮的局部收口** | 族 58（片 W8）**只覆盖「引擎已建模过成员」的原型**：Error 家族（固定表）+ 用户类原型（`constructor` + 自有方法/访问器，按定义序）+ 生成器原型（自有键恒空）⇒ 这三类原型面**精确**；其余原型（Array / Object / Map / Promise …）**仍保守** `string[]` / boolean 域 |
| **阻塞** | 要覆盖**全体**内建原型 ⇒ 需要在 Abs 上**新增**「原型自有键集」承载位 ⇒ 触及 Abs 形状 ⇒ 影响 `leqAbs` ⇒ 需要全仓回归基线 |
| **状态** | **架构债（本波新发现 · 2026-10-23）**。建议与 **A5 / A6** 合并到「动 Abs 形状」那一层立项 |

---

## A11 · 生成器对象的**身份**在 Abs 里没有承载位（`brand("Generator")`）

| | |
|---|---|
| **现象** | 生成器对象（`function* g(){}` 的 `g()`）在**类型投影面**与**空对象**同形（`{ }`）⇒ 「这是个生成器对象」在签名 / dts / schema 面上不可见（`formatShape` 折不出 `Generator`） |
| **根因** | core 的生成器对象建模成**闭 obj**（`exec/runtime/async.ts` 的 `makeGenObject`：`abs({k:"obj", slots})`）⇒ Abs 里没有「生成器」这一族形状 ⇒ 投影面只能落回通用对象 |
| **本轮的局部收口** | 族 65（片 W17，BC #45）**不改形状**：补 `@@toStringTag = "Generator"`（internal + symbolKey 槽）⇒ `Object.prototype.toString.call(g())` 原生同款 `"[object Generator]"`（此前折 `"[object Object]"`——自信的错值）；`Object.getOwnPropertyNames(g())` / `Object.getOwnPropertySymbols(g())` 恒 `[]`（原生同）。**类型投影面仍与空对象同形** |
| **阻塞** | 根治需 `makeGenObject` 改 `brand("Generator")` ⇒ **触及 Abs 形状** ⇒ 影响 `leqAbs` / dts / schema / 约束面 ⇒ 需全仓回归基线；且 `Generator` 是 TS **泛型**内建名（`Generator<T, TReturn, TNext>`）⇒ dts 面需补类型实参（否则 TS2314，见 Bug 521 的泛型 brand 口径） |
| **状态** | **架构债（本波新发现 · 2026-10-23）**。建议与 **A5 / A6 / A10** 合并到「动 Abs 形状」那一层立项 |

---

## 立项建议（按依赖顺序）

```
第 0 层（不动 Abs 表示，可先试）
  └─ A7  substAbs 丢 fn impl          ← 最可能是纯实现缺陷
第 1 层（要定承载位，但影响面局部）
  ├─ A3 + A4  throws 在 Abs 里的承载位（relation 面 + apply 结果）⇒ 合并立项
  └─ A5     接收者形状感知的 union 方法分派
第 2 层（要动 Abs 形状 ⇒ 影响 leqAbs ⇒ 需要全仓回归基线）
  ├─ A2 + A8  core 的 callable 面（类 ≠ 可调用值）
  ├─ A6     fn 形状的 overload 集合承载位
  └─ A10    原型对象自有键集的承载位（族 58 的局部收口 ⇒ 全体内建原型）
第 3 层（求值模型层，独立于 Abs 表示）
  └─ A1 + A2  生成器体惰性（转译侧快照 + $join 折回；与族 45 同侧）
```

**每层的门槛**：动 Abs 形状的层，必须先跑**全仓门禁**（含 `check-recall-gold` / `check-gold` /
`check-real-packages` / 差分语料）并留**改前基线**，因为 `leqAbs` 的语义变化会**全局**影响
L1 / L2 门禁的接受集。
