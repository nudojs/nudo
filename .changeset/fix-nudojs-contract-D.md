---
"@nudojs/core": patch
"@nudojs/service": patch
---

fix(core,service): 侧车契约与 zod 产物不再把 `-0` 渲染成 `0`（族 20 · 片 D · Bug 1065）

`-0` 与 `0` 身份不同（`Object.is` / `1/x` 可观察），而 `String(-0) === "0"`
⇒ 负号被抹掉 ⇒ 同一个值在三处被渲染成**另一条契约**。

- **core（`packages/core/src/algebra/interface.ts`）**：`litToString` 的 number
  分支改用仓库既有的保真口径 `litKeyString`（`./term.ts`：`Object.is(v, -0) ⇒ "-0"`，
  与 `format.ts` 的 `formatLitValue` 同款判据）；`lengthBound` 的常数界渲染
  （`.length(n)`）同款口径一并改。⇒ 侧车写的 `lit(-0)` 现在**如实**渲染成
  `lit(-0)`：`nudo contract` 回显、`nudo check` 诊断的 `expected:` / `suggestion:`、
  以及侧车 DSL 回写（`nudo contract --emit`）都不再抹掉负号。
  ⇒ **零新增公开导出**（`litKeyString` 是同包相对 import，core 冻结面未动）。
- **service（`packages/service/src/emit/schema-generator.ts`）**：`case "lit"` 的
  数字分支**保真**写 `z.literal(-0)`（改前是 `z.literal(0)`）⇒ 产物不再
  **比门禁宽**（门禁按 `lit(-0)` 判红、产物却放行 `0` ⇒ 假绿）。
  ⚠ zod 的 literal 走 `===` 口径 ⇒ `-0` 与 `0` 在运行时**不可区分** ⇒ 该处
  **已知有损** ⇒ 产物就地加注释标明（消费方看得见），**不许静默放宽**。
  （zod 的运行时行为本次**未独立复现**——环境无 zod 依赖。）

诊断文本与 zod 产物是**同一个渲染上游**（`formatConstraint` ⇒ `litToString`）
⇒ 一处修，两面同时保真。
