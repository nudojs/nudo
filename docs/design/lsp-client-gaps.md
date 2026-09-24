# LSP 客户端缺口跟踪

> **状态**：现行。服务器语义共享；缺口几乎都在**客户端 UI**。
> 用户可见对照表：website `guides/lsp-clients.md`「Known gaps」。
> 关闭一条 = 本表改状态 + 同步 website 表；**不**为客户端限制开 GitHub issue 充数。

---

## 编号与关闭条件

| ID | 缺口 | 影响客户端 | 关闭条件 | 状态 |
|----|------|------------|----------|------|
| **LSP-G1** | Active-case 装饰（高亮选中 case 函数体） | Zed / Neovim / Helix | 客户端提供 decoration API，或 nudo 插件落地 | **VS Code 已闭**（函数体 + case 行装饰）；Zed/Neovim/Helix 仍开（客户端限制） |
| **LSP-G2** | 不渲染 CodeLens | Helix / 部分精简 Neovim | Helix 上游 CodeLens UI，或用户接受 CLI/agent 权宜 | **观察面已补**：inlay 同源投影 `● interface / <source>`（`computeInterfaceLenses`）；CodeLens UI 本身仍为客户端限制 |
| **LSP-G3** | Semantic tokens 默认关闭 | Zed / Neovim / Helix | 各客户端 Setup notes 已写权宜；**本表只记配置债**——出厂配置随客户端插件默认打开才算关 | **VS Code 可染色**（`semanticTokenScopes`）；其它客户端权宜仍开 |
| **LSP-G4** | 次要 server 诊断与 tsserver 噪声叠加 | 全部 | 非 bug。关闭条件 = 共存配方成为默认叙事且用户可自助收窄 | **VS Code 可自助**（`nudo.coexistence.apply` + settings）；配方仍是真源 |
| **LSP-G5** | 文件探测 / analysis-mode 默认文档一致 | 文档 | `isNudoTargetPath` + `shouldAnalyzeFile` + `DEFAULT_ANALYSIS_MODE` 在 api/service、api/lsp、PUBLIC_API 与 website guides 同口径 | **已同步**（2026-09） |
| **LSP-G6** | 部分客户端不用 pull diagnostics | 较旧客户端 | 服务器保留 push；客户端升级消费 `diagnosticProvider` | **push 面已钉**（`push-diagnostics-g6.test.ts`：validateText 必 publish）；协议代差仍在（鼓励客户端吃 pull） |
| **LSP-G7** | 补全触发 / signature help 偏弱 | Helix（视版本） | Helix 补全/signature UI 稳定，或用户用 hover + CLI | **服务端已强化**（真实 paramTypes/return + `@nudo:` 指令补全 + `@` 触发）；Helix UI 仍视版本 |
| **LSP-G8** | Docusaurus CodeBlock swizzle 布局 | website | Docusaurus v4 将 Content/{String,Element} 上提至 CodeBlock 根时跟迁 | **shim 已就绪**（`CodeBlock/String.tsx` / `Element.tsx` 根级再导出；v4 只改 shim）；上游布局跟迁仍待 v4 |

---

## 权宜（不重复展开）

| ID | 权宜锚 |
|----|--------|
| LSP-G1 | VS Code 装饰已闭；其它客户端 CodeLens `●`/`○` 切 case；无 CodeLens UI → CLI `nudo check` / agent `nudo.hover` |
| LSP-G2 | inlay `● interface / …`（与 CodeLens 同源）；CLI `nudo contract` / `nudo check`；agent `nudo.contract*` |
| LSP-G3 | VS Code `semanticTokenScopes`；website lsp-clients Setup notes（Zed `semantic_tokens: "combined"` 等） |
| LSP-G4 | VS Code 命令 `nudo.coexistence.apply`；website `guides/coexistence.md` 配方（include/exclude 或 `mode: "directives"`） |
| LSP-G5 | `package.json#nudo.analysis` + `packages/lsp/PUBLIC_API.md` §7 |
| LSP-G6 | push 路径已测；didOpen 即 validate；pull 为增强非必需 |
| LSP-G7 | signature help 真类型 + `@nudo:` 补全；弱 UI 时 hover + `nudo check` / `nudo test` |
| LSP-G8 | `CodeBlock/{String,Element}.tsx` shim；v4 跟迁只动 shim |

---

## 不变量

- 服务器能力不因客户端缺口降级；协议面照常交付。
- 文档同步缺口（LSP-G5）关闭后 **不得**再开「文档滞后」行——以本表 + PUBLIC_API §7 为真值。
