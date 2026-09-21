---
description: 安装 Nudo 的 CLI、VS Code 扩展与 Vite 插件，支持 npm、pnpm、yarn——发布包要求 Node.js >= 20。
---

# 安装

可通过 npm、pnpm 或 yarn 安装 Nudo 工具。

## 前置要求

- **运行发布版 CLI**：Node.js >= 20（各发布包 `engines`）
- **开发本仓库**：Node.js >= 18（CI 使用 Node 24）

发布包以编译后的 ESM `dist/` 发布（`files: ["dist"]`），不是 TypeScript 源码。

## CLI

```bash
# 薄壳包（发布名为 `nudojs`；安装后得到 `nudo` 命令）
npm install -g nudojs
# 或完整 CLI 包
npm install @nudojs/cli
# 或
pnpm add @nudojs/cli
# 或
yarn add @nudojs/cli
```

然后观察并门禁你的代码：

```bash
npx nudojs check path/to/file.js   # 签名 + 契约门禁
npx nudojs test path/to/file.js    # 调用点 case 报告
# 若已全局安装，命令就是 `nudo`
```

一级动词：`check` / `test` / `contract` / `export` / `health` / `env harvest`。**没有** `infer` 动词——观察来自 `check` 签名、`test` 用例与 IDE hover。

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

构建过程中，插件按 `nudo.analysis.mode` 筛选文件（出厂默认 `"exports"`），并将 Nudo 诊断——求值器问题加精化门禁违例（`nudo:constraint-violated`、`nudo:assign-mismatch`、`nudo:arg-structure`）——报告为构建警告；设置 `failOnError` 后变为构建错误。参见 [Vite 插件指南](../guides/vite-plugin.md)。
