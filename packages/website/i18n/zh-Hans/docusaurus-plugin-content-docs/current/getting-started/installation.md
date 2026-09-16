---
sidebar_position: 1
description: 安装 Nudo 的 CLI、VS Code 扩展与 Vite 插件，支持 npm、pnpm、yarn——发布包要求 Node.js >= 20。
---

# 安装

可通过 npm、pnpm 或 yarn 安装 Nudo 工具。

## 前置要求

- **运行发布版 CLI**：Node.js >= 20（各发布包 `engines`）
- **开发本仓库**：Node.js >= 20（CI 使用 Node 24）

发布包以编译后的 ESM `dist/` 发布（`files: ["dist"]`），不是 TypeScript 源码。

## CLI

```bash
npm install @nudojs/cli
# or
pnpm add @nudojs/cli
# or
yarn add @nudojs/cli
```

然后运行类型推断：

```bash
npx nudo infer path/to/file.js
```

## VS Code 扩展

安装 **nudo-vscode** 扩展可获得内联类型提示和诊断信息：

1. 打开 VS Code
2. 进入 **扩展**（Ctrl+Shift+X / Cmd+Shift+X）
3. 搜索 **nudo-vscode**（或「Nudo」）
4. 点击 **安装**

也可以通过命令行安装：

```bash
code --install-extension wmzy.nudo-vscode
```

## Vite 插件

使用 **vite-plugin-nudo** 在开发或构建时运行 Nudo：

```bash
npm install vite-plugin-nudo --save-dev
```

在 `vite.config.js` 中：

```javascript
import { defineConfig } from "vite";
import nudo from "vite-plugin-nudo";

export default defineConfig({
  plugins: [nudo()],
});
```

该插件会在构建过程中分析带有 `@nudo:` 指令的文件，并将 Nudo 诊断——求值器问题加精化门禁违例（`nudo:constraint-violated`、`nudo:assign-mismatch`、`nudo:arg-structure`）——报告为构建警告；设置 `failOnError` 后变为构建错误。参见 [Vite 插件指南](../guides/vite-plugin.md)。
