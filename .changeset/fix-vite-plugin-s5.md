---
"vite-plugin-nudo": patch
---

fix(vite-plugin): 补 Bug 901 的回归钉 —— info 不计入 warning 计数 + info 走 info 通道（假阳性片）

- **Bug 901 的核心症状已由族 26 随 `f87c9f9d` 落地**（changeset
  `fix-lsp-core-F.md` 的「Bug 779 vite 半」）：`buildEnd` 汇总行的 warning 计数
  改成只数 `severity === "warning"`（此前是 `totalDiags - errorCount` ⇒ 把
  info 级诊断算成告警），诊断上报循环新增 **info → `this.info`** 分支（此前
  info 级诊断**一条都不上屏** ⇒ 汇总行与构建日志自相矛盾）。

- 本次**只补回归钉**（`packages/vite-plugin/src/__tests__/vite-bug-901-info-not-counted-as-warning.test.ts`），
  **未改动任何实现**：钉住两条已成立的行为 ——

  1. **info 不计入 warning 计数**：汇总行 `[nudo] Analysis complete: X error(s), Y warning(s)`
     的 `Y` 只数 warning 级诊断；info 级诊断不计入，且汇总不得比「实际 warning 条数」多。
  2. **info 走 `this.info` 上屏**：info 级诊断出现在 vite 的 info 通道，**不混进 warn 流**
     （否则 info 冒充告警）。

- 该钉在 **HEAD 只读副本上通过**（它钉的是已修好的行为 ⇒ 本族唯一的「反向闸例外」），
  在**族 26 修复前的副本上 3/3 失败** ⇒ 仍是一道有效的回归守护。
