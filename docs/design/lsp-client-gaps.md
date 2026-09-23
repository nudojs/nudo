# LSP 客户端缺口跟踪

> **状态**：现行。服务器语义共享；缺口几乎都在**客户端 UI**。
> 用户可见对照表：website `guides/lsp-clients.md`「Known gaps」。
> 关闭一条 = 本表改状态 + 同步 website 表；**不**为客户端限制开 GitHub issue 充数。

---

## 编号与关闭条件

| ID | 缺口 | 影响客户端 | 关闭条件 | 状态 |
|----|------|------------|----------|------|
| **LSP-G1** | Active-case 装饰（高亮选中 case 函数体） | Zed / Neovim / Helix | 客户端提供 decoration API，或 nudo 插件落地 | 开放（客户端限制） |
| **LSP-G2** | 不渲染 CodeLens | Helix / 部分精简 Neovim | Helix 上游 CodeLens UI，或用户接受 CLI/agent 权宜 | 开放（客户端限制） |
| **LSP-G3** | Semantic tokens 默认关闭 | Zed / Neovim / Helix | 各客户端 Setup notes 已写权宜；**本表只记配置债**——出厂配置随客户端插件默认打开才算关 | 权宜已文档化 |
| **LSP-G4** | 次要 server 诊断与 tsserver 噪声叠加 | 全部 | 非 bug。关闭条件 = 共存配方成为默认叙事且用户可自助收窄 | 配置面（见 coexistence 配方） |
| **LSP-G5** | 文件探测 / analysis-mode 默认文档一致 | 文档 | `isNudoTargetPath` + `shouldAnalyzeFile` + `DEFAULT_ANALYSIS_MODE` 在 api/service、api/lsp、PUBLIC_API 与 website guides 同口径 | **已同步**（2026-09） |
| **LSP-G6** | 部分客户端不用 pull diagnostics | 较旧客户端 | 服务器保留 push；客户端升级消费 `diagnosticProvider` | 开放（协议代差） |
| **LSP-G7** | 补全触发 / signature help 偏弱 | Helix（视版本） | Helix 补全/signature UI 稳定，或用户用 hover + CLI | 开放（客户端限制） |
| **LSP-G8** | Docusaurus CodeBlock swizzle 布局 | website | Docusaurus v4 将 Content/{String,Element} 上提至 CodeBlock 根时跟迁 | 押后（v4） |

---

## 权宜（不重复展开）

| ID | 权宜锚 |
|----|--------|
| LSP-G1 | CodeLens `●`/`○` 切 case；无 CodeLens UI → CLI `nudo check` / agent `nudo.hover` |
| LSP-G2 | CLI `nudo contract` / `nudo check`；agent `nudo.contract*` |
| LSP-G3 | website lsp-clients Setup notes（Zed `semantic_tokens: "combined"` 等） |
| LSP-G4 | website `guides/coexistence.md` 配方（include/exclude 或 `mode: "directives"`） |
| LSP-G5 | `package.json#nudo.analysis` + `packages/lsp/PUBLIC_API.md` §7 |
| LSP-G6 | push 路径仍有效；didOpen 即 validate |
| LSP-G7 | hover + `nudo check` / `nudo test` |
| LSP-G8 | 保持现 swizzle 路径；迁移时改 theme 目录即可 |

---

## 不变量

- 服务器能力不因客户端缺口降级；协议面照常交付。
- 文档同步缺口（LSP-G5）关闭后 **不得**再开「文档滞后」行——以本表 + PUBLIC_API §7 为真值。
