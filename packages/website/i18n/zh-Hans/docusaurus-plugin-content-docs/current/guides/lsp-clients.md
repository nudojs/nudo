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
| Execute command | `nudo.*` | `selectCase`、`contract`、`contract.draft`、`contract.emit`、agent 工具 |
| Custom request | `nudo/…` | 与 command 同一 handler（E5）；协议契约用 slash 形式 |
| Pull diagnostics | `diagnosticProvider` | `interFileDependencies: false` |

**文件检测（A1/A2）：** 目标为 `.js` / `.mjs` / `.ts`。**出厂默认 `nudo.analysis.mode = "exports"`** — 含 `export` / 侧车 / 指令的文件进 IDE 分析；`"all"` 全量目标路径，`"directives"` 回到保守门禁。CodeLens interface 档使用更宽的目标路径——诊断可对无指令文件保持安静，档位仍可见。

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

## 配置要点（可复制最小配置）

先确保 `nudo-lsp` 在 `PATH` 上（项目内 `npm i -D @nudojs/lsp` 或全局安装）。冻结清单见 [`packages/lsp/PUBLIC_API.md`](https://github.com/nudojs/nudo/blob/main/packages/lsp/PUBLIC_API.md) / [API](../api/lsp.md)。

### VS Code

安装 `wmzy.nudo-vscode`。扩展捆绑服务器并注册 `nudo.selectCase`。见 [VS Code 扩展](./vscode.md)（含发布检查清单）。

### Zed — 最小配置

1. 安装 [nudojs/nudo-zed](https://github.com/nudojs/nudo-zed)，或直接指定本地 server 二进制。
2. 项目 `package.json`：`"devDependencies": { "@nudojs/lsp": "^0.8.0" }`。
3. `~/.config/zed/settings.json`（或项目 `.zed/settings.json`）：

```json
{
  "languages": {
    "JavaScript": {
      "language_servers": ["vtsls", "nudo", "..."]
    },
    "TypeScript": {
      "language_servers": ["vtsls", "nudo", "..."]
    }
  },
  "lsp": {
    "nudo": {
      "binary": {
        "path": "npx",
        "arguments": ["--yes", "@nudojs/lsp"]
      }
    }
  },
  "code_lens": "on",
  "inlay_hints": { "enabled": true }
}
```

若 `nudo-lsp` 已在 `PATH`，优先 `"binary": { "path": "nudo-lsp", "arguments": [] }`。Semantic tokens：`"semantic_tokens": "combined"`。详见 [Zed 扩展](./zed.md)。

### Neovim — 最小配置

`lazy.nvim` + `nvim-lspconfig`（下列为 Neovim 0.11+ `vim.lsp.config`；旧版用 `require("lspconfig").nudo.setup{…}`）：

```lua
-- 已安装 @nudojs/lsp，nudo-lsp 在 PATH 上
vim.lsp.config("nudo", {
  cmd = { "nudo-lsp" },
  filetypes = { "javascript", "javascriptreact", "typescript", "typescriptreact" },
  root_markers = { "package.json", ".git" },
})
vim.lsp.enable("nudo")

-- inlay hints（内置）
vim.lsp.inlay_hint.enable(true, { bufnr = 0 })

-- 可选：CodeLens UI 插件（glance / nvim-code-action-menu 等）
```

旧版 lspconfig：

```lua
require("lspconfig").nudo.setup({
  cmd = { "nudo-lsp" }, -- 或 { "node", "node_modules/@nudojs/lsp/dist/server.js" }
  filetypes = { "javascript", "javascriptreact", "typescript", "typescriptreact" },
  root_dir = require("lspconfig").util.root_pattern("package.json", ".git"),
})
```

Agent 命令示例：

```lua
vim.lsp.buf.execute_command({
  command = "nudo.check",
  arguments = { { file = vim.api.nvim_buf_get_name(0) } },
})
```

Custom request（slash 形式是协议契约）：

```lua
vim.lsp.buf_request(0, "nudo/check", { file = vim.api.nvim_buf_get_name(0) }, function(err, result) end)
```

### Helix — 最小配置

`~/.config/helix/languages.toml`：

```toml
[language-server.nudo]
command = "nudo-lsp"
# args = ["--stdio"]  # 可选；无 transport 参数时 server 默认 stdio

[[language]]
name = "javascript"
language-servers = [ "vtsls", "nudo" ]

[[language]]
name = "typescript"
language-servers = [ "vtsls", "nudo" ]
```

Helix 渲染诊断 / hover / 定义 / 重命名。**UI 无 CodeLens**——用 CLI `nudo contract` / `nudo check` 拿同一数据。Signature help 视 Helix 版本而定；缺失时用 CLI / agent 工具。

### 通用 / agent 桥

任意 LSP 客户端可 `workspace/executeCommand` 或发送 `nudo/<tool>` custom request。slash 形式（`nudo/check`）是协议契约；dot 形式（`nudo.check`）对齐 MCP 风格桥的 command 名。两者路由到同一 handler（E5）。见 [Agent 集成](./mcp-server.md) 与 [`PUBLIC_API.md`](https://github.com/nudojs/nudo/blob/main/packages/lsp/PUBLIC_API.md)。

## 已知缺口

非 VS Code 客户端落地时关注这些。**服务器语义共享**；缺口几乎都在**客户端 UI**。每条均给出权宜 + 跟踪锚。

| 缺口 | 影响客户端 | 权宜 | 跟踪 |
|------|------------|------|------|
| Active-case 装饰（高亮当前 case 函数体） | Zed、Neovim、Helix | 客户端渲染 CodeLens 时仍可用 `●`/`○` 切换 case，hover 跟随；无 CodeLens UI 时用 CLI `nudo check` / agent `nudo.hover` | 客户端限制 — 无 tracking issue（Zed 无 decoration API；Neovim 需自写插件） |
| 不渲染 CodeLens | Helix、部分精简 Neovim | CLI `nudo contract` / `nudo check`；agent `nudo.contract` / `nudo.contract.draft`；需要 UI 时用 VS Code / Zed | 客户端限制 — 无 tracking issue（Helix 无 CodeLens UI） |
| Semantic tokens 默认关闭 | Zed、Neovim、Helix | 按上文 Setup notes 打开客户端设置（Zed `semantic_tokens: "combined"`；Neovim treesitter/semantic-tokens 插件；Helix `editor.semantic-tokens`） | 已按客户端记录在本页 — 无独立 issue |
| 次要 server 诊断可能与 tsserver 噪声叠加 | 全部 | 收窄 `package.json#nudo.analysis.include` / `exclude`，或 `mode: "directives"` — 完整步骤见 [共存](./coexistence.md#recipe-mixed-js-ts-no-double-error-storm) | 配置问题，非 bug — 跟踪文档即 [共存配方](./coexistence.md#recipe-mixed-js-ts-no-double-error-storm) |
| 文档中的文件检测滞后于 analysis-mode 默认 | 文档 | 以 `package.json#nudo.analysis` + [`PUBLIC_API.md`](https://github.com/nudojs/nudo/blob/main/packages/lsp/PUBLIC_API.md) 为准 | 文档同步 — 本页 + PUBLIC_API.md |
| 部分客户端不用 pull diagnostics | 较旧客户端 | push 路径仍有效；didOpen 即 validate | 协议代差 — 无 tracking issue（服务器保留 push） |
| 部分客户端补全触发 / signature help 偏弱 | Helix（视版本） | 用 hover + `nudo check` / `nudo test`（CLI）；signature help UI 用 VS Code / Zed | 客户端限制 — 无 tracking issue |

## 同源保证

下列表面共用同一计算（测试钉住）：

| 表面 | 共享数据源 |
|------|------------|
| CodeLens `● interface` | `interfaceTierOf` |
| Hover 首行 + 契约展示 | `interfaceTierOf` + `getHoverAtPosition` |
| Inlay `interfaceSource` / `derived` | `collectAbsInlays` + `interfaceTierOf` |
| Semantic token modifiers | `buildSemanticTokens` + `interfaceTierOf` |
| Agent `nudo.check` / `nudo.hover` / `nudo.contract` / infer/whatIf/trace | 同一 service/core 入口 + buffer-aware `loadModule`（E5 `AGENT_TOOL_SOURCES`）；工具错误带 `isError: true` |
| CLI `nudo check` / `nudo contract` | 同一 service/core 入口 |
| executeCommand `nudo.*` ↔ slash `nudo/…` | 同一 dispatch 表；清单钉在 `packages/lsp/PUBLIC_API.md` + `public-api-surface.test.ts` |

## 参见

- [VS Code 扩展](./vscode.md)
- [Zed 扩展](./zed.md)
- [与 TypeScript 共存](./coexistence.md)
- [迁移已有 JS](./migrating-js.md)
- [Agent 集成](./mcp-server.md)
- [版本与发布](./versioning.md)
- [@nudojs/lsp API](../api/lsp.md)
