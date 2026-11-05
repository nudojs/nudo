# 架构债台账（A 类）· 10 条

> **性质**：这些不是「还没排期的 bug」，而是**卡在求值模型 / Abs 表示层的欠账**。
> 局部修不动 —— 改法要么引入新的 wrong-exact（比现状更坏），要么需要**改内核表示**
> ⇒ 影响 `leqAbs` ⇒ 影响**全部门禁精度** ⇒ 必须**独立排期 + 独立回归基线**。
>
> **状态**：2026-10-23 起，本文档单独记录 A 类；B / C 两类（**可修**）在
> 各自的「遗留」表里逐条推进。**排期以每条的「状态」字段为准**：已闭环条目
> 保留编号（避免引用漂移）但不再计入待排期；状态与代码不一致时以
> `git log` / changeset / 回归测试为准，并在发现的当次 PR 内订正。
>
> **分类依据**：精度债的可修性分类（B / C 两类见对应台账的
> 「📊 精度债的可修性分类」段）。
>
> **编号说明**：现有 **10 条**（A1–A8 / A10 / A11），与标题的「10 条」一致。
> **A9 号空缺** —— 起草时该号未落条目；编号**保留不复用**，以免既有引用漂移。

---

## A1 · Bug 212 · 生成器体在**构造期**就跑完

| | |
|---|---|
| **现象** | 生成器体在构造期整个跑完 ⇒ 外层绑定被提前改写，且改成一个**在任何原生观测点都不成立**的值（引擎 `1` / 原生 `0`；引擎 `"ab"` / 原生 `""`；引擎 `5` / 原生 `1`；引擎 `"ab"` / 原生 `"a"`）。dts 面连带污染：`Generator<any \| number>`、`Case: entry@L1 () => 1` |
| **根因** | `$gen`（`packages/core/src/algebra/exec/runtime/async.ts`）在**构造期**调 `body()`；转译后的体对**外层绑定**的写是**闭包变量的裸 JS 赋值**（`return n = __v`）⇒ 写必然落地且提前落地 |
| **两条硬约束**（各自足以否掉 runtime 侧修法） | ① **eager 收集是值域/签名面的承重结构**：元素域与 `conf`（exact/path/widened）在构造期就烘进 `Abs` 的 shape ⇒ 惰性化会把 `Generator<any \| number>` 退成 `Generator<unknown>` 并降 `conf` ⇒ 冲击 L1/L2 门禁精度<br>② **写穿在 runtime 侧无句柄可拦**：`$assignRecord` 只能观测、其返回值被丢弃 ⇒ 任何能中和「写穿」的方案都必须先有转译侧钩子 |
| **最小可行修法**（纯转译侧、不动公开面） | 在 `$gen` 的体外套「**自由写快照 + `$join` 折回**」—— 复用仓里已有的 `collectFreeAssignedNames`（`exec/transpile/helpers.ts`）算「该体写到的外层绑定」；`$copy` / `$join` 均为既有导出 ⇒ 不触公共 API 冻结。**把「确定的错值」变成 sound 的过近似**（`0\|1` 而非 `1`）；逐点精确需「真挂起」（另立族） |
| **落点冲突** | 唯一落点在 `exec/transpile/**`（与族 45 的临时名避让机制同侧）⇒ 两族同源，宜合并承接 |
| **待拍板** | ~~折回用 `$join`（sound，推荐）还是「还原成事前值」~~ 已拍板 `$join`（2026-11-04 落地） |
| **状态** | **步骤 1（最小收窄）已落地（2026-11-04）**：wrong-exact 已消灭。四个 `$gen` 发射点（声明 / 函数表达式 / 对象方法 / 类方法）统一走 `exec/transpile/emit.ts` 的 `genOuterFreeWriteNames`（= `collectFreeAssignedNames` 扣形参模式名与体内 var 提升名，再经 `expandAliasNames` 扩 const 别名伙伴）+ `genFreeWriteWrap`（快照 `$copy`（共享 memo）+ `finally` 里 `n = $join(事前, 事后)`）；临时名 `__g0_<n>` / `__gCopyMemo` 经 `internalTmpName` 避让。四行症状 `1`/`"ab"`/`5`/`"ab"` → `0\|1`/`""\|"ab"`/`0\|5`/`""\|"ab"`（native 构造点值均 ∈ join）；eager 值域 / `conf` 承重与元素面**不变**（不写外层绑定的生成器产物逐字不变）。回归：`eval-bug-212-generator-body-eager.test.ts`（四行症状 + 四发射点 + 元素面 + 负控制）。**残余 = 步骤 2–4**（可延后元素面 / 首消费点触发 / 真挂起）：首个 yield 挂起点的中间值（native `1` / `"a"`）仍不在 join 内 ⇒ 仍为架构债（债面收窄为「时间轴缺失」）。详细数据流 / 11 项消费面清单 / 4 步改造路径 → [`generator-laziness.md`](./generator-laziness.md) |

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
| **状态** | **已修（2026-11-04）**。承载位 = `impl.relation.throws`（`relationFn` opts 透传；与 `AbsApplyResult.throws` 同一表示）；`$call` 关系臂消费时经 `routeApplyThrows` 单点路由（may-throw → `pushThrowExit`）。env 声明侧 `envFn` 无 apply 分支透传 `opts.throws`（`packages/env/src/abs-helpers.ts`）。回归：`abs-apply-throws-channel.test.ts`（A3 段）+ `env-bug-s0-mechanism.test.ts`（A3 段）。公共 API 快照只钉导出名，未新增导出 ⇒ 无快照变更 |

---

## A4 · core `$new` 丢弃 apply 的 throws 面

| | |
|---|---|
| **现象** | `packages/core/src/algebra/exec/class/declare.ts` 取 `isAbsApplyResult(afterR) ? afterR.abs : afterR` ⇒ **构造路径**（`new X()`）丢 throws 面 ⇒ 构造器声明的 throws **只在调用面生效** |
| **根因** | 同 A3：Abs 的 apply 结果没有统一的 throws 承载位；构造路径多一层解包把 side-channel 丢了 |
| **阻塞** | 与 A3 同源 —— 建议**合并立项**（先定 throws 在 Abs 里的承载位，再修两处消费点） |
| **状态** | **已修（2026-11-04，与 A3 合并立项）**。两处解包点（`exec/class/construct.ts` 的 `$new` impl.apply 分支 + `exec/class/invoke.ts` 的 bind 产物 [[Construct]] facet）改为经 `routeApplyThrows` 单点路由（may-throw → `pushThrowExit`；always-throw → `NudoThrow`）。env 面 `new URL(非法)` 假绿钉（`env-bug-64` 2.4）已改写为正向断言。回归：`abs-apply-throws-channel.test.ts`（A4 段 + 源码门禁） |

---

## A5 · core union 方法分派只认 `string` 成员

| | |
|---|---|
| **现象** | Bug 771 / 263 / 827：`convert(1).toFixed()` 的 **L2/L5 假红仍在**（2026-11-04 复现：types-only overload 包上 `nudo check` 对 `convert(1).toFixed()` / `convert("a").toUpperCase()` 各报一条 ERROR `nudo:entry-may-throw`，分别点名 string / number receiver；`tsc --strict` 同场景 exit 0）。原归因「分派按**成员名**匹配 `string` 一族，不看接收者实际形状」**对今日代码不成立**（见状态） |
| **根因** | 假红的真根源 = **A6**：fn 形状无 overload 集合承载位 ⇒ harvest 把 `convert` 塌成 `(string \| number) => string \| number`（`harvest-bug-827-overload-set.test.ts` 钉住）⇒ 调用面无法按实参选 arm ⇒ `.toFixed()` 的接收者是**真 union**（`string \| number`），派发层只能按 union 语义处理 |
| **阻塞** | 并入 **A6**（overload 承载位 / 按实参选 arm）。派发层已无可做：union 接收者上「缺方法成员记 may-throw」对真 union 是 **sound** 的（`pick(y)` 抽象实参 ⇒ `1 \| "a"`，string 臂 `("a").toFixed()` 原生定抛；`core-bug-263-union-member-method-criterion.test.ts` #2/#3 钉住）——派发层无从分辨 union 来自真分叉还是 overload 塌缩，压掉它 = 真 union 假绿 |
| **状态** | **派发层已闭合（2026-11-04 复测订正）**。`invokeUnionReceiver`（`exec/class/invoke.ts`）逐成员 `$invoke(m, …)`，成员判据 `memberLikelyHasMethod` 按成员**自身**的原型方法表（`PRIM_PROTO_METHODS`：string / number / boolean / symbol / bigint 各自的真实表）+ fn 静态槽面（Bug 1045 后续）+ 判据不足保守放行——自 Bug 263（族 03，ec0a9e4c，2026-10-22）起即按形状选 arm；回归锚 `core-bug-263-union-member-method-criterion.test.ts`（6/6 绿）。本条 2026-10-24 建档时「派发层仍未按形状分」的判断与代码不符，已订正；残余假红（overload 塌缩半边）**并入 A6 立项**，修 A6 后自消 |

---

## A6 · Abs fn 形状无 overload 集合承载位

| | |
|---|---|
| **现象** | Bug 805 / 827 的「**按实参选 arm**」在收割面无法实现（此前只能给 union 返回面） |
| **根因** | `Abs` 的 fn 形状只带**单个**返回面，没有 overload 集合的承载位 |
| **修法（2026-11-04 落地）** | fn shape 增**可选** `overloads?: FnOverload[]`（缺省不出现 ⇒ 旧形状逐字节不变）。消费点：`instantiateReturn` 按**声明序首个命中** arm（同元数 + 逐参 leq，arm 内 α 各自 bind/subst）派发返回位；零命中回落 union 返回面（不新造 may-throw）。harvest 顶层函数面与方法面共用 `collectOverloadArms`（Bug 807 两路同形）；`HarvestSig` 增 `overloads` 随磁盘缓存往返（`HARVEST_DISK_ABI` v13→v14，旧缓存干净 miss）；subst / snapshot 搬运；`absKey` 纳入（memo/fingerprint 不串）。**口径**：union 面（`paramTypes`/`returnType`）仍是权威外延面——`leqAbs` / `formatShape` / dts / schema / guard 只读它；overloads 是**派发精化**，不是赋值语义。 |
| **测试锚** | `abs-overload-dispatch.test.ts`（10）、`harvest-bug-827-overload-set.test.ts`（6，含 JSON 往返）、`harvest-bug-807-method-two-paths.test.ts`；e2e：types-only 包双 overload，`nudo check` 由 2 条 L2 假红 → OK（与 `tsc --strict` exit 0 对齐）；金标 223 全绿 |
| **状态** | **已修（2026-11-04）**。残余：dts 导出面仍投影 union 签名（重载声明不逐条发射——TS 消费方可接受 union 面；逐条 overload 发射属独立投影增强） |

---

## A7 · core `substAbs` 丢 fn impl

| | |
|---|---|
| **现象** | `packages/core/src/algebra/hof.ts` 的 `substShape` case `"fn"` 丢掉 impl ⇒ 引擎面的泛型方法调用退化为 `unknown`（Bug 810 的引擎面半边） |
| **根因** | `substShape` 的 fn 分支只替换形状、不搬运 impl 侧表 |
| **阻塞** | 相对最轻的一条 —— 属**实现缺陷**而非表示缺口，但会触及 `hof.ts` 的泛型替换路径 ⇒ 影响面需要独立回归基线 |
| **状态** | **已修（2026-11-04）**：`substFnImpl` 搬运 impl 侧表（行为面/标量 facet 原样、relation 槽按 map 替换且与 shape 同引用）；`snapshotAbs` 镜像同修（快照不再退化成 shape-only）。测试锚：`hof-subst-impl.test.ts`（10）、`abs-overload-dispatch.test.ts`（snapshot 段） |

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
第 0 层（不动 Abs 表示）                              ✅ 已闭环
  └─ A7  substAbs 丢 fn impl          ← 已修（2026-11-04，纯实现缺陷，未动 Abs）
第 1 层（定承载位、影响面局部）                        ✅ 已闭环
  ├─ A3 + A4  throws 承载位（relation 面 + apply 结果）← 已修（2026-11-04）
  └─ A5     union 方法分派 ← 派发层已闭合（Bug 263）；残余假红由 A6 修后自消
第 2 层（动 Abs 形状 ⇒ 需全仓回归基线；执行方案见下节）
  ├─ A6     fn 形状 overload 承载位    ✅ 已修（2026-11-04，可选槽位范式）
  ├─ A2 + A8  callable 面（类 ≠ 可调用值）           ⏳ 待排期
  ├─ A10    原型对象自有键集承载位                    ⏳ 待排期
  └─ A11    生成器 brand("Generator")                ⏳ 待排期
第 3 层（求值模型层，独立于 Abs 表示）
  └─ A1 步骤 1（快照 + $join 折回）已落地（2026-11-04，wrong-exact 消灭）；
     A1 步骤 2–4（真挂起 / 首消费点）与 A2（裸调用不抛）待续
```

**每层的门槛**：动 Abs 形状的层，必须先跑**全仓门禁**（含 `check-recall-gold` / `check-gold` /
`check-real-packages` / 差分语料）并留**改前基线**，因为 `leqAbs` 的语义变化会**全局**影响
L1 / L2 门禁的接受集。

---

## 剩余槽位的受控 major 执行方案（A2+A8 / A10 / A11）

> **进度（2026-11-05）**：步骤 0（改前基线）与步骤 1（槽位容器 + 搬运链 +
> 键 + 回归钉）**已落地**；步骤 2（逐槽启用、更新 expectation）仍待排期。
> 三条共同缺的承载位已由容器解决，剩下的是消费点接线与精度基线逐条对齐。
> A6（2026-11-04）已经验证了安全的扩展范式，直接复用，不要另起炉灶。

**范式（照抄 A6）**：新增**可选**槽位（缺省不出现 ⇒ 旧形状逐字节不变），
`subst` / `snapshot` / `absKey` / 磁盘缓存 ABI 同步搬运；`leqAbs` / `formatShape` /
dts / schema / guard **只读既有外延面**，新槽位只参与运行期精化与投影增强。
A6 的 `overloads?: FnOverload[]` 即此形态（金标 223 全绿、e2e 假红消失）。

| 槽位 | 服务条目 | 承载内容 | 主要消费点 |
|---|---|---|---|
| `callable` | A2 + A8 | 值是否可裸调用 / [[Construct]] 形态 | `$call` 裸调用臂、`exec/class/*` |
| `protoOwnKeys` | A10 | 原型对象自有键集（含符号键） | `getOwnPropertyNames` / `hasOwn` / `keys` 族 |
| `brand` | A11 | 生成器对象身份（带泛型实参） | `formatShape` / dts / schema 投影 |

**步骤（每步一个 PR，禁止合并提交）**

0. **改前基线** ✅ 已跑全量 `pnpm run test` 并留档失败集合（16 文件 / 21 用例，
   均为本地 Node 22 与 CI Node 24 的宿主面差异，非代码回归）；单跑金标 / 真包 /
   差分语料 / `benchmark:oss` 同批留档。
1. **只加槽位容器 + 读写 API** ✅ 已落地：`Abs.facets?: AbsFacets` 与
   `cloneAbsFacets`（`algebra/abs.ts`）、`snapshotAbs` / `substAbs`（含 var 替换
   分支）/ `renameAbs` 整包搬运、`absKey` 只对**非空**容器进键（空容器 ≡ 缺省
   ⇒ 旧键逐字节不变）。`leqAbs` / `formatShape` / dts / schema / guard 不读容器。
   回归钉 `algebra/__tests__/abs-facets-carrier.test.ts`（8 例）；公共 API 冻结
   未变更、金标 + 真包 204 例全绿。
2. **逐条启用**：`callable` → `protoOwnKeys` → `brand`，每条独立 PR + 独立
   回归基线；`leqAbs` 只在新槽位非空时参与判定，保持既有接受集不变。
3. **全仓门禁复跑**并对比步骤 0；任何 `check-recall-gold` recall/precision < 1.0、
   真包 FP > 0、差分语料回退 ⇒ 回滚该槽位，其余槽位不受影响。
4. **一次性发 major**：核心包 + 下游联动，changeset 标注 BREAKING 与迁移说明；
   dts 面补 `Generator<T, TReturn, TNext>` 类型实参（A11 的 TS2314 风险）。

**验收门槛**：金标 1.0/1.0 · 真包 0 FP · 差分语料 0 回退 · 公共 API diff 只含新增 ·
空槽位下所有投影输出逐字节不变。**回滚**：槽位默认空 ⇒ 单条 revert 不牵动其余槽位。

**同期配套（2026-11-05，零语义重构）**：`algebra/` 顶层 93 个平铺 `.ts` 中 50 个
已由 `scripts/relocate-core-subdomains.mjs --apply` 归入 6 个子域（795 处相对
导入机械重写，codemod 幂等），剩余 43 个由 `scripts/check-core-subdomains.mjs`
冻结。`scripts/aggregate-tests.mjs` 的入口收敛全量试点因模块共享污染（新增 15 条
失败）已回滚，改为逐族验证后启用。这些重构与槽位启用互不依赖。
