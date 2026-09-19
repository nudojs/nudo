---
sidebar_position: 2.5
description: "在 Zed 中安装 Nudo 语言服务器：hover 类型、诊断、CodeLens case 切换、inlay hints。"
---

# Zed 扩展

**nudo** Zed 扩展把 Nudo 语言服务器挂到 JavaScript / TypeScript buffer 上，作为**次要 language server**——与 `vtsls` / `typescript-language-server` 并存。

## 前置条件

- `PATH` 上有 Node.js（或使用 Zed 内置 Node 做 npm 回退）
- [`@nudojs/lsp` ≥ 0.5.0](https://www.npmjs.com/package/@nudojs/lsp) 可通过下列任一方式使用：
  - 项目本地 `node_modules/@nudojs/lsp`（`npm i @nudojs/lsp`）
  - 全局安装并提供 `nudo-lsp` bin（`npm i -g @nudojs/lsp`）
  - Zed 托管的 npm 安装（前两者都找不到时自动触发）

0.5.0+ 自带 `dist/server.js` 与 `nudo-lsp` shebang 入口，并在未传 transport 参数时默认走 stdio。

## 安装

扩展位于独立仓库：[nudojs/nudo-zed](https://github.com/nudojs/nudo-zed)。

### 源码安装（开发）

```bash
git clone https://github.com/nudojs/nudo-zed
```

在 Zed 中：**Extensions → Install Dev Extension…** → 选择克隆下来的 `nudo-zed` 目录。

### 设置

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
  "code_lens": "on",
  "inlay_hints": { "enabled": true }
}
```

`"..."` 会保留其余已注册 language server。若需要类型感知高亮：

```json
{
  "semantic_tokens": "combined"
}
```

### 覆盖二进制路径

跳过自动发现，直接指定服务器：

```json
{
  "lsp": {
    "nudo": {
      "binary": {
        "path": "node",
        "arguments": ["/abs/path/node_modules/@nudojs/lsp/dist/server.js"]
      }
    }
  }
}
```

或 PATH 上已有 `nudo-lsp` 时：

```json
{
  "lsp": {
    "nudo": {
      "binary": { "path": "nudo-lsp", "arguments": [] }
    }
  }
}
```

## 服务器解析顺序

扩展的 `language_server_command` 依次尝试：

1. `PATH` 上的 `nudo-lsp`
2. `<worktree>/node_modules/@nudojs/lsp/dist/server.js`（经 `node` 启动）
3. Zed 托管的 `npm install @nudojs/lsp`，用 `require.resolve` 解析路径

## Zed 中的能力

| 能力 | 说明 |
|------|------|
| Diagnostics | 分析目标（`.js`/`.mjs`/`.ts`）自动分析；无指令文件见 `nudo.analysis.mode` |
| Hover 类型 | 标准 LSP；导出函数名显示 `● interface / <source>`（与 CodeLens 同源） |
| 跳转定义 / 引用 / 重命名 | 标准 LSP（含侧车绑定名） |
| Inlay hints | 需打开 `inlay_hints.enabled`；implicit 导出标 `derived` |
| CodeLens | 需打开 `code_lens: "on"`——**interface 档在前**（`● interface`、persist/update、`⚡ draft interface`），case 副层在后 |
| Semantic tokens | 默认关闭，设 `semantic_tokens: "combined"`——含 `contract`/`generated`/`derived` modifier |
| Code actions / Signature help | 标准 LSP quickfix 与 signature help |
| Agent 命令（`nudo.check` / `nudo.contract.draft` / …） | 经任意 LSP 客户端或 Zed agent 工具可达 |

CodeLens `⚡ draft interface` 与 CLI `nudo contract --draft` 同源（仅客户端显式 `write: true` 时写 `*.nudo.draft.js`）。迁移步骤：[迁移已有 JS](./migrating-js.md)。

VS Code 扩展里 active case 的 decoration 在 Zed 无对应 API，请改用 CodeLens 的 case 选择。

完整客户端对比与已知缺口：[LSP 客户端矩阵](./lsp-clients.md)。

## 文件检测

分析目标为 `.js` / `.mjs` / `.ts`。指令模式偏保守；可用 `package.json#nudo.analysis.mode`（`exports` | `all`）打开无指令分析。CodeLens interface 档使用更宽的目标路径。

## 构建 WASM 扩展

安装 dev extension 时 Zed 会自行编译。手动构建：

```bash
rustup target add wasm32-wasip2
cd nudo-zed
cargo build --target wasm32-wasip2 --release
```

## 参见

- [VS Code 扩展](./vscode.md)
- [LSP 客户端矩阵](./lsp-clients.md)——跨编辑器能力对齐
- [迁移已有 JS](./migrating-js.md)
- [版本与发布](./versioning.md)
- [Agent 集成](./mcp-server.md)——同一服务器服务 coding agent
- [@nudojs/lsp API](../api/lsp.md)
