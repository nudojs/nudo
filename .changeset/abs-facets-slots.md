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

Evidence: 三槽各独立全仓回归 0 新增失败；最终 2159 文件 / 17191 用例 0 新增失败；金标 1.0/1.0、真包 0 FP、差分语料 0 回退、公共 API 冻结未变。发布级别按仓库既有「暂无外部用户 ⇒ 破坏性变更以 minor 发布并保留 `**BREAKING**:` 标注」政策（见 `packages/nudojs/CHANGELOG.md` 与 `d8e46b54`）；一旦有外部用户依赖这些包面，即刻回到 `docs/versioning.md` 的「1.x + API/schema break ⇒ major」。
