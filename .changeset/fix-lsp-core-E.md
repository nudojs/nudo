---
"@nudojs/lsp": patch
---

fix(lsp): 诊断 range 夹到行尾 + check 通道保留 info 级（Bug 778 / 779 LSP 半）

- **Bug 778**：service 的 `column: 999`「整行」哨兵被原样写进 LSP
  `end.character` ⇒ 协议层 range 越界（push / pull 两条通道都越界）。诊断
  range 的**唯一计算点** `lspDiagnosticRange`（`validation.ts`）：行号 1 基
  → 0 基、列号夹到该行长度以内、同 line 时 end ≥ start；行长表由本轮源码
  逐行算出（会话条目缓存 ⇒ pull 通道无源码参数时同样夹取）。
- **Bug 779**（LSP 半）：`checkToLspDiagnostics` 在转换前就把 info 级砍掉 ⇒
  下游档位过滤器永远看不到 info ⇒ `nudo.analysis.diagnostics: "verbose"` 对
  check 诊断是空操作（`nudo:assume-relied` / `nudo:invariant-relied` /
  `nudo:opaque-result` 永不上屏，与 CLI `nudo check` 两侧集合不一致）。转换点
  改为保留三档，档位取舍只由 `filterCheckLspByLevel` 决定（verbose 放行
  info；default / errors / off 不放行，`off` 的门禁码可见性不变）。
- **env 通道同档同 range**：`nudo:env-unresolved` 改走与 check 主通道同一个
  转换点（`checkIssueToLspDiagnostic`）⇒ severity 与 range 与主通道同口径。
- 对外交付两个前置件：`envUnresolvedDiags` 改为 export（供 pull 诊断面
  消费）；`handleNudoDepFileChanged` 排除变更文件自身（防自激重检）。
