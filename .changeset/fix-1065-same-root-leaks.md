---
"@nudojs/core": patch
"@nudojs/service": patch
---

fix(core,service): `-0` 保真渲染的**同根因漏点**一并补齐（族 20 · Bug 1065 收口）

Bug 1065 的根因是「用 `String(v)` 渲染数值」⇒ `String(-0) === "0"` ⇒ 负号被抹掉。
主修只覆盖了 `litToString` / `lengthBound` 两处；收口时按**同一根因**把其余
漏点一并补齐（**诊断陈述的契约 ≠ 用户写的契约**是同一个错）：

- **core（`packages/core/src/algebra/interface.ts` · `predToChain`）**：其余三处
  常数界渲染 —— `.min(n)` / `.max(n)`（`length` 上的 `ge` / `le` 界）与
  `.<op>(n)`（变量上的常数界）—— 改走保真口径 `litToString` ⇒ `.min(-0)` /
  `.max(-0)` 不再被抹成 `.min(0)` / `.max(0)`；`.length(n)` 的常数界渲染同款。
- **service（`packages/service/src/emit/standard-schema.ts` · `describeValue`）**：
  `typeof value === "number"` 的渲染改用 `Object.is(value, -0) ? "-0" : String(value)`
  ⇒ 该文件**此前存在两套 `-0` 口径**（另一处已保真、这一处没有）⇒ 同款收敛。

诊断文本、侧车 DSL 回写与 schema 产物现在**全部**走同一套保真口径
⇒ `-0` 在所有面上渲染一致，不再出现「一处保真、一处抹零」。
