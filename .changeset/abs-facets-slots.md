---
"@nudojs/core": minor
"@nudojs/service": minor
"@nudojs/harvester": minor
---

**BREAKING**: `Abs` 现在携带可选 `facets` 槽位容器（`callable` / `protoOwnKeys` / `brand`），三个槽位均已在引擎内启用。缺省不出现 ⇒ 旧 `Abs` 的键、投影与 `leqAbs` 接受集逐字节不变；但**带上槽位的值**在以下面给出比以前更精确的判定：

- `callable`：类值裸调用判据不再只靠 `class-mark.ts` 的 WeakMap 与 `_rest` 形参启发式 ⇒ 快照 / `substAbs` / 重铸后的类值仍定抛 `TypeError`。该槽位表达「无 `new` 的 [[Call]] 定抛」，**不是**规范 `IsCallable`。
- `protoOwnKeys`：原型对象的自有键集随值携带（`Object.getOwnPropertyNames` / `Object.hasOwn` / `getOwnPropertySymbols`），不再只能按 brand 名查固定表。
- `brand`：生成器对象身份随值携带，dts 的 `iteratorTSType` 不再只靠 `next` / `@@iterator` 槽启发式 ⇒ 丢了内部协议槽的重建产物仍投影 `Generator<T>`（泛型实参照旧推导，不输出裸名以免 TS2314）。

Migration: 直接构造 `Abs` 字面量 / 只读取既有字段的代码无需改动 —— `facets` 缺省即旧行为。用 `Object.keys(abs)`、结构化克隆或自有实现的序列化器枚举 `Abs` 全部字段的内部代码，需容忍新增的可选 `facets`（不读它即与旧行为一致）。`absKey` 只对**非空**容器进键 ⇒ 带槽位的值会自然得到不同的 memo / 指纹，无需手工清缓存。core `formatShape` 的展示面**不发布**生成器身份（既有契约，逐字不变）。

**残余批次（同批发布）**：
- **A2 声明/收割面**：`declare class` 类值挂 `callable:false`；`JSON.stringify(obj, 类构造器)` 由 `may-throw` 升为确定抛 TypeError。`HarvestSig.fn` 新增 `callable` 字段、**`HARVEST_DISK_ABI` v14 → v15**（`~/.cache/nudo/deps/` 旧收割缓存会干净 miss，无需手工清理）；`harvestedValueToAbs` 的 `absFunction` mock 重建也整包搬运槽位。
- **A10 内建原型**：`Array` / `Object` / `Map` / `Set` / `Promise` / `String` / `Number` / `Date` / `RegExp` 等的 `Object.getOwnPropertyNames` / `Object.hasOwn` / `getOwnPropertySymbols` 由保守 `string[]` / `boolean` / `symbol[]` 升为与宿主**动态对拍**的精确面（键集随 Node 版本给出各自真实值，不写死清单）。
- **A11 TReturn / TNext**：`AbsFacets` 新增可选 `genReturn` / `genNext`，dts 输出 `Generator<T, TReturn>` / `AsyncGenerator<T, TReturn>`（恒带类型实参，无 TS2314）。本轮进一步接通 **TNext 保守域**：`makeGenObject` 填 `unknown`（引擎不建模 `.next(v)` 入参 ⇒ 与 TS 该类型形参默认值等价，**不是精度承诺**），`iteratorTSType` **仅当** `facets.genNext` 存在才输出第 3 实参 ⇒ `Generator<T, TReturn, unknown>`；三实参仍恒带 `<…>`，无 TS2314。手工构造 / 无 `genReturn` 的旧 Abs 输出逐字不变；填真实 v 域依赖 A1 步骤 4 真挂起（明确停点）。
- **A1 步骤 2 骨架（零语义）**：`exec/match-iter.ts` 把 7 个元素面读出函数收口到模块私有的幂等触发器表，生产侧不登记 ⇒ eager 时序与全部值面逐字不变；不进任何 barrel，公共 API 冻结不变。为后续「首消费点触发」预置接线，不改变任何对外行为。
- **schema / guard 生成器身份投影：明确不做**（产品语义决策）。`emit-bug-130` 钉住 `z.object({  })` 且产物须真接受生成器；`z.custom` 判别会把校验器接受集从「任意对象」收紧为「必须生成器」，`z.instanceof` 路径经运行时实证不可行（无全局 `GeneratorFunction`）。决策记录见 `docs/design/architecture-debt.md`，PoC 见 `emit-generator-identity-poc.test.ts`。

Migration（补充）：① 自行解析磁盘收割 JSON 或依赖 `HARVEST_DISK_ABI` 的下游需接受 `HarvestSig.fn.callable` 新字段（旧缓存按 v15 自动失效）；② 枚举 `Abs.facets` 全部字段的代码需容忍新增的 `genReturn` / `genNext`（不读即旧行为）；③ 曾断言内建原型 `gOPN` 为 `string[]` / `hasOwn` 为 `boolean` 的内部测试需改为与宿主对拍的精确断言；④ 解析生成器 dts 类型实参的下游需容忍**三实参** `Generator<T, TReturn, unknown>`（无 `genNext` 的旧手工 Abs 仍两实参 / 一实参，逐字不变）。

Evidence: 三槽各独立全仓回归 0 新增失败；最终 2159 文件 / 17191 用例 0 新增失败；金标 1.0/1.0、真包 0 FP、差分语料 0 回退、公共 API 冻结未变。发布级别按仓库既有「暂无外部用户 ⇒ 破坏性变更以 minor 发布并保留 `**BREAKING**:` 标注」政策（见 `packages/nudojs/CHANGELOG.md` 与 `d8e46b54`）；一旦有外部用户依赖这些包面，即刻回到 `docs/versioning.md` 的「1.x + API/schema break ⇒ major」。
