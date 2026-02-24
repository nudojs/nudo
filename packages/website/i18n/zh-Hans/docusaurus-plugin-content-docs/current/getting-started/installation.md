---
sidebar_position: 1
---

# 安装

可通过 npm、pnpm 或 yarn 安装 Nudo 工具。需要 Node.js 18 及以上版本。

## 前置要求

- **Node.js 18+**

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
code --install-extension nudojs.nudo-vscode
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

该插件会分析带有 `@nudo:` 指令的文件，并在构建过程中报告类型信息。
