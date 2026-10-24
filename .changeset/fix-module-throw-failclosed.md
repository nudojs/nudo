---
"@nudojs/core": minor
---

**BREAKING**: 模块顶层**必然抛**（装载期无条件 `throw`）现在 fail-closed：新增
error 级 `nudo:module-throw`（check 默认 error、可放行），不再「导出全丢 ⇒
零诊断 + exit 0」。

此前 `throw new TypeError("boom"); export function f(){ return 1; }` 的求值回落
`module-throw` ⇒ 导出全丢（签名退化 `f() => unknown`）、L2 无证据、CLI 打 `OK` /
exit 0 —— 引擎**完全没能分析**的模块被判绿（附录 A#1）。现在报一条**模块级**
`nudo:module-throw`（定位 = 顶层 `throw`，文案带抛出类型名），`nudo check` 非零
退出；`--json` / LSP / vite-plugin 走同一条 issue 通道（无 CLI 特判）。

判据**只认句法证据**：顶层语句序列（只穿过裸块）里**无条件**执行的 `throw`。
为什么不用引擎的「抽象上必抛」：真实包实测（node_modules 的 6 个文件：
`typescript/lib/_tsserver.js`、`react-dom/cjs/*`、`vitest/dist/chunks/*`）顶层
**没有** `throw` 语句却回落 `module-throw`（缺失依赖 → 闭合对象 → 方法不可调用
= 宿主 API 近似；react-dom 的两个 cjs bundle 原生 `require()` 实测成功）⇒ 拿
引擎结论做门禁 = 假红。条件抛（`if (typeof window === "undefined") throw`）、
`try/catch` 吸收的抛、引擎近似抛**不报**（现状不变；零 FP 语料库
`check-real-packages` 的 10 个包 / ~1060 个文件触发 0）。

抑制口径与 L2 同源：`--entry-throws off`（或 `package.json#nudo.check.entryThrows`）
关闸、`--entry-throws warning` 降档、`--ignore-throws <Kind>` 按抛出类型名放行
（`Error` 盖整族）。每个模块**一条**诊断，不按入口重复。

谁会坏：模块顶层无条件 `throw`（含 React Server entry stub、`vitest/index.cjs`
这类「import 即拒绝」的守卫文件）此前判绿，现在 error。这些模块原生**根本无法
导入**（导出本来就不可用）⇒ 此前是假绿；若装载即抛是有意行为，用
`--ignore-throws <Kind>` 或 `--entry-throws off` 显式放行。
