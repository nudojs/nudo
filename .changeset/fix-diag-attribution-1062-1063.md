---
"@nudojs/service": major
---

**BREAKING**: 重复声明 `@nudo:mock-module` 的诊断**码**与**默认严重级**变了 ——
分析器通道此前把它一律报成 `nudo:module-missing`（**error**，fail-closed），
现在按**错误种类**还原码：重复声明 ⇒ `nudo:mock-invalid`（**warning**，与 check
面同码同级）；mock 文件缺失 / 装载失败 / 点名缺失 ⇒ `nudo:module-missing`
（error，fail-closed）**逐字不变**。

谁会坏：按**诊断码**分流 / 静音 / 快照的下游 —— 重复声明这一路径的码从
`nudo:module-missing` 变成 `nudo:mock-invalid`，严重级从 error 变成 warning ⇒

- 只静音 `nudo:module-missing` 的规则**不再**静音重复声明（改按
  `nudo:mock-invalid` 静音）；
- 把 `nudo:module-missing` 当 error 断言的快照 / 闸门**变红→变黄**（重复声明
  不再拦构建）。

怎么迁移：按**新码** `nudo:mock-invalid` 调整静音规则与快照；真正的模块缺失 /
装载失败仍是 `nudo:module-missing`（error），语义不变。

fix(service): 指令诊断的**码归因**与**文案贯通** —— `@nudo:mock-module` 重复声明不再被说成「模块缺失」（Bug 1062 / 1063 收口）

上一版把两条指令的**本体**修好了（`@nudo:replace` 目标未命中 ⇒ 显式诊断；
`@nudo:mock-module` 重复声明 ⇒ 显式诊断 + 导出名并集），但**码**在
`nudo test` / `health` 面上**丢了**：分析器通道把 `composed.mockErrors`
（**只有 message**）一律映射成固定码 `nudo:module-missing` ⇒「重复声明」被说成
「模块缺失」（归因错误：码与文案不自洽），且重复声明这种**指令写法歧义**被按
fail-closed 的 **error** 级上报。

- **码归因**：分析器通道按错误**种类**还原码 —— 重复声明 ⇒ `nudo:mock-invalid`
  （warning，与 check 面同码同级：指令写法有歧义，导出表取并集 ⇒ 分析仍然
  sound）；mock 文件缺失 / 装载失败 / 点名缺失 ⇒ `nudo:module-missing`
  （error，fail-closed）**逐字不变**。
- **文案贯通**：check 补充通道的 suggestion 按**具体种类**分族 —— 重复声明 ⇒
  「只保留一条声明」；导出名缺失 ⇒ 点名那个**缺失的导出**；表达式解析失败 /
  文件缺失 ⇒ 原句逐字保留。
- **同族表缺口**：service 侧 body-read 的「接收者无歧义是 string」证据集补
  `trimLeft` / `trimRight`（宿主 `String.prototype` 上真实存在的
  `trimStart` / `trimEnd` 别名；**Array 上不存在**这两个方法 ⇒ 不触发该表刻意
  排除 `includes`/`indexOf` 的那类歧义）⇒ `param.trimLeft()` 能推出
  `param: string()`（补前只是**保守漏证据**，不是假红）。

回归钉 `packages/service/src/__tests__/service-bug-1062-1063-diag-attribution.test.ts`：
码归因（含「不得再被说成 `nudo:module-missing`」负控）、既有码不被误改、
suggestion 分族文案、body-read 的 `trimLeft` 推断 + `includes` 负控。
