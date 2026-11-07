---
"@nudojs/core": minor
"@nudojs/service": minor
---

**静态元素域通道（「第三种」）**：把生成器的元素域从「隐式编码在 `shape`
数字下标槽、dts 靠 `CANONICAL_INDEX` 正则反推」升级为随 `Abs` 值携带的
显式承载位，并把源码返回类型注解从「可覆盖观测」降级为**一致性校验**。

**core**
- `AbsFacets.genElements?: Abs[]`：`makeGenObject` 填 `$gen` 的**完整 yield
  序列**（`full`，不是 `$arr` 之后可能 widen 的 `els`；Bug 53 点名前者才是
  权威数据）。`shape` 数字槽**并存不替换**，消费点 / 族 01 口径不变。
- `cloneAbsFacets` 拷贝数组（Abs 元素按引用共享）⇒ `snapshotAbs` /
  `substAbs` / `renameAbs` / `join` 四处经统一 clone 自动搬运，副本不串台。
- `facetKey` 新增 `ge:` 段（逐项 `absKey`）⇒ 元素域不同的生成器不共享
  memo / 指纹；无 `genElements` 的旧键逐字节不变。

**service**
- `iteratorTSType` 优先读 `genElements`，**严格 fallback**：字段为
  `undefined`（手工构造 / 静态收割 / 旧 Abs）时仍扫数字槽 ⇒ 旧产物逐字不变。
  端到端实测 fork 分支 `if (f) yield 1; else yield "s"` 从
  `Generator<unknown>` 恢复为 **`Generator<number | string>`**；只有
  `genElements`、无数字槽的手工 Abs 也能投影出精确元素类型。
- `FunctionAnalysis.declaredReturnType` 透传 `nudoReturnTypeText`（此前全仓
  只有写入、无读取点）；新增 `nudo:return-annotation-mismatch` 台账：
  声明与观测同为单一基类型且互斥时留痕，**产物恒用观测口径**（不覆盖、
  不用声明兜底）⇒ 不重演 BUG-168 在形参位修掉的「两面相反裁决」。
  联合 / 泛型 / 字面量 / `unknown` 一律不判，避免 widen 口径差异被误报。

兼容性：`genElements` 是可缺省槽位；静态声明收割（harvest）不构造生成器
运行时值 ⇒ 不进 `HARVEST_DISK_ABI`，冷 / 热产物一致。公共导出符号名不变
⇒ 公共 API 冻结不受影响。

**已知边界**：**不解锁 A1 步骤 3** —— `genElements` 仍由构造期跑体填充，
体延后到首消费点 ⇒ 字段也空，而 dts 是纯投影、导出期无消费点。本变更
只预置了承载位与「未填充」语义；步骤 3 仍需静态 yield 域推断通道或产品
接受 `Generator<unknown>` 降级。详见 `docs/design/generator-laziness.md`
「dts 元素域通道 · 第三种已落地」。

版本定性：新增诊断码 + additive API ⇒ **minor**；按整批裁决不判定
breaking，无 BREAKING / Migration 标注。

回归：`gen-elements-facet.test.ts`（7 例）/ `emit-gen-elements-facet.test.ts`
（9 例）；全仓 `1658 入口`，`20 失败 = 基线 20`，**0 新增 / 0 消失**。
