---
sidebar_position: 2.6
description: "Nudo 语言服务器在 VS Code、Zed、Neovim、Helix 及通用 LSP 客户端上的能力对齐表与已知缺口。"
---

# LSP 客户端矩阵

Nudo 只交付**一个**语言服务器（`@nudojs/lsp`）。编辑器差异仅在如何启动它、以及客户端侧打开了哪些能力。本页是对齐表：服务器提供什么、各客户端如何消费、缺口在哪里。

服务器按设计与 `tsserver` / `vtsls` **并存**，而不是替代它们。

## 服务器能力

在 `initialize` 时声明（详见 [@nudojs/lsp API](../api/lsp.md)）：

| 能力 | 服务器 handler | 说明 |
|------|----------------|------|
| Diagnostics | `validateText`（push） | 自适应防抖 300/400/800 ms；过期 generation 可取消（A8） |
| Hover | `onHover` | Abs / intension；导出函数名首行 `● interface / handwritten\|generated\|implicit`（A7） |
| 补全（`.`） | `onCompletion` | 按推断类型给出 property/method |
| CodeLens | `onCodeLens` | **interface 档在前**：`● interface / <source>` + persist/update；case 为 debug 副层 |
| Inlay hints | `languages.inlayHint` | case 提示 + Abs 参数/返回（implicit 导出标 `derived`） |
| 跳转定义 / 引用 / 重命名 | 标准 LSP | 含侧车绑定名（A5） |
| 文档 / 工作区符号 | 标准 LSP | |
| Signature help | `onSignatureHelp` | 触发 `(`、`,` |
| Code actions（`quickfix`） | `onCodeAction` | 不可达代码清理；契约/参数修复（A6） |
| Semantic tokens（full） | `languages.semanticTokens` | 图例含 `contract` / `generated` / `derived` interface modifier（A7） |
| Execute command | `nudo.*` | `selectCase`、`interface`、`interfaceEmit`、agent 工具 |
| Custom request | `nudo/…` | 与 command 同一 handler（E5）；协议契约用 slash 形式 |
| Pull diagnostics | `diagnosticProvider` | `interFileDependencies: false` |

**文件检测（A1/A2）：** 目标为 `.js` / `.mjs` / `.ts`。部分旧文档仍写「无指令不分析」；项目级可用 `package.json#nudo.analysis.mode`（`exports` | `all`）打开无指令分析。CodeLens interface 档使用更宽的目标路径——诊断可对无指令文件保持安静，档位仍可见。

## 客户端支持矩阵

图例：**Y** = 原生客户端 + 本服务器即可 · **C** = 需要设置 / 次要 language server · **N** = 客户端 UI 不提供（服务器仍响应协议） · **—** = 不适用

| 能力 | VS Code（`nudo-vscode`） | Zed（`nudo-zed`） | Neovim（nvim-lspconfig） | Helix | 通用 stdio LSP |
|------|:-------------------------:|:-----------------:|:------------------------:|:-----:|:--------------:|
| 启动 | 扩展捆绑 `server.js`（IPC） | `nudo-lsp` / 项目 `node_modules` / Zed npm | `cmd = nudo-lsp` | `command = nudo-lsp` | 启动 `nudo-lsp` 或 `node dist/server.js` |
| Diagnostics | Y | Y | Y | Y | Y |
| Hover（Abs + interface 档） | Y | Y | Y | Y | Y |
| 补全 | Y | Y | Y | C | Y |
| CodeLens interface + case | Y | C（`code_lens: "on"`） | C（插件因实现而异） | N | C（视客户端） |
| Inlay hints | Y | C（`inlay_hints.enabled`） | C | C | C |
| 定义 / 引用 / 重命名 | Y | Y | Y | Y | Y |
| 文档符号 | Y | Y | Y | Y | Y |
| Signature help | Y | Y | Y | C | Y |
| Code actions / Quickfix | Y | Y | Y | Y | C |
| Semantic tokens | Y | C（`semantic_tokens: "combined"`） | C | C | C |
| Active-case 装饰 | Y（扩展） | N | N | N | N |
| Agent 命令（`nudo.check` / `nudo.hover` / …） | Y（executeCommand / MCP 桥） | Y（agent / custom request） | Y（custom LSP request） | C | Y |
| 未保存侧车 buffer（A4） | Y | Y | Y | Y | Y |

## 配置要点

### VS Code

安装 `wmzy.nudo-vscode`。扩展捆绑服务器并注册 `nudo.selectCase`。见 [VS Code 扩展](./vscode.md)。

### Zed

安装 [nudojs/nudo-zed](https://github.com/nudojs/nudo-zed)，作为 `vtsls` 旁的次要 language server。打开 `code_lens` 与 `inlay_hints`。见 [Zed 扩展](./zed.md)。

### Neovim

```lua
require("lspconfig").nudo.setup({
  cmd = { "nudo-lsp" }, -- 或 { "node", "/path/to/@nudojs/lsp/dist/server.js" }
  filetypes = { "javascript", "javascriptreact", "typescript", "typescriptreact" },
  root_dir = require("lspconfig").util.root_pattern("package.json", ".git"),
})
```

CodeLens / inlay 需要客户端插件。Agent 命令：`vim.lsp.buf.execute_command({ command = "nudo.check", arguments = { { file = vim.api.nvim_buf_get_name(0) } } })`。

### Helix

```toml
[language-server.nudo]
command = "nudo-lsp"

[[language]]
name = "javascript"
language-servers = [ "vtsls", "nudo" ]
```

Helix 渲染诊断 / hover / 定义；UI 无 CodeLens——用 CLI `nudo interface` / `nudo check` 拿同一数据。

### 通用 / agent 桥

任意 LSP 客户端可 `workspace/executeCommand` 或发送 `nudo/<tool>` custom request。slash 形式（`nudo/check`）是协议契约；dot 形式（`nudo.check`）对齐 MCP 风格桥的 command 名。两者路由到同一 handler（E5）。见 [Agent 集成](./mcp-server.md)。

## 已知缺口

非 VS Code 客户端落地时关注这些。**服务器语义共享**；缺口几乎都在**客户端 UI**。

| 缺口 | 影响客户端 | 权宜 | 跟踪 |
|------|------------|------|------|
| Active-case 装饰（高亮当前 case 函数体） | Zed、Neovim、Helix | CodeLens `●`/`○` 仍可切换 case；hover 跟随 | nudo-zed / 客户端插件；Zed 无 decoration API |
| 不渲染 CodeLens | Helix、部分精简 Neovim | CLI `nudo interface` / `nudo check`；agent `nudo.interface` | 客户端限制 |
| Semantic tokens 默认关闭 | Zed、Neovim、Helix | 按上表打开客户端 semantic token 设置 | 已按客户端记录 |
| 次要 server 诊断可能与 tsserver 噪声叠加 | 全部 | 收窄 `nudo.analysis.include` / 静音 implicit（A3） | 配置问题，非 bug |
| 文档中的文件检测滞后于 analysis-mode 默认 | 文档 | 以 `package.json#nudo.analysis` 为准 | 文档同步（本页） |
| 部分客户端不用 pull diagnostics | 较旧客户端 | push 路径仍有效；didOpen 即 validate | 协议代差 |

## 同源保证

下列表面共用同一计算（测试钉住）：

| 表面 | 共享数据源 |
|------|------------|
| CodeLens `● interface` | `interfaceTierOf` |
| Hover 首行 + 契约展示 | `interfaceTierOf` + `getHoverAtPosition` |
| Inlay `interfaceSource` / `derived` | `collectAbsInlays` + `interfaceTierOf` |
| Semantic token modifiers | `buildSemanticTokens` + `interfaceTierOf` |
| Agent `nudo.check` / `nudo.hover` / `nudo.interface` | `checkSource` / `getHoverAtPosition` / `interfaceSurface`（E5 `AGENT_TOOL_SOURCES`） |
| CLI `nudo check` / `nudo interface` | 同一 service/core 入口 |

## 参见

- [VS Code 扩展](./vscode.md)
- [Zed 扩展](./zed.md)
- [迁移已有 JS](./migrating-js.md)
- [Agent 集成](./mcp-server.md)
- [版本与发布](./versioning.md)
- [@nudojs/lsp API](../api/lsp.md)
