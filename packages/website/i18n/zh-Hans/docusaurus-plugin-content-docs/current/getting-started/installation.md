---
description: 安装 Nudo 的 CLI、VS Code 扩展与 Vite 插件，支持 npm、pnpm、yarn——发布包要求 Node.js >= 20。
---

# 安装

可通过 npm、pnpm 或 yarn 安装 Nudo 工具。覆盖面：**CLI**（`nudojs`）、**VS Code 扩展**（`nudo-vscode`）、**Zed 扩展**，以及 **Vite 插件**（`vite-plugin-nudo`）。

## 前置要求

- **运行发布版 CLI**：Node.js >= 20（各发布包 `engines`）
- **开发本仓库**：Node.js >= 20（CI 使用 Node 24）

发布包以编译后的 ESM `dist/` 发布（`files: ["dist"]`），不是 TypeScript 源码。没有额外运行时要装 —— CLI 就是普通 Node。

## CLI

```bash
# 全局安装 —— 得到 `nudo` 命令
npm install -g nudojs
# 或作为项目依赖安装
npm install nudojs
# 或
pnpm add nudojs
# 或
yarn add nudojs
```

然后观察并门禁你的代码：

```bash
npx nudojs check path/to/file.js   # 签名 + 契约门禁
npx nudojs test path/to/file.js    # 调用点 case 报告
# 若已全局安装，命令就是 `nudo`
```

一级动词：`check` / `test` / `contract` / `export` / `health`。**没有** `infer` 动词——观察来自 `check` 签名、`test` 用例与 IDE hover。

| 安装方式 | 命令形态 | 适用 |
|---|---|---|
| 全局（`npm i -g nudojs`） | `nudo check …` | 日常本地工作、shell 脚本 |
| 项目依赖（`pnpm add nudojs`） | `npx nudojs check …` | CI、与代码同仓锁定版本 |
| 一次性（`npx nudojs …`） | 不安装 | 决定引入依赖前先试用 |

### npx

`npx nudojs check src/` 是标准 CI 调用 —— 有项目本地安装时解析本地版本，否则临时下载。流水线里优先用项目依赖（加锁文件），把分析器版本钉死。

### Monorepo / pnpm workspaces

在 workspace 根装一次 `nudojs`，或在需要门禁的每个包里各装一份。用 `nudo.analysis.include` / `exclude` 圈定 IDE 分析范围，让 JS 包走 Nudo、TS 包留在 `tsc`：

```json
{
  "nudo": {
    "analysis": {
      "mode": "exports",
      "include": ["packages/js-lib/src/**"],
      "exclude": ["**/*.test.ts", "packages/ts-lib/**"]
    }
  }
}
```

细节：[与 TypeScript 共存](../guides/coexistence.md) · [Recipes —— monorepo](../guides/recipes.md)。

## VS Code 扩展

安装 **nudo-vscode** 扩展可获得内联类型提示和诊断信息：

1. 打开 VS Code
2. 进入 **扩展**（Ctrl+Shift+X / Cmd+Shift+X）
3. 搜索 **nudo-vscode**（或「Nudo」）
4. 点击 **安装**

发布在 [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=wmzy.nudo-vscode) 与 Open VSX。也可以通过命令行安装：

```bash
code --install-extension wmzy.nudo-vscode
```

vsix 自包含：扩展捆绑了语言服务器，无需另装 `@nudojs/lsp` 扩展即可启动。激活事件是 `onLanguage:javascript` / `onLanguage:typescript`；缓冲区是否*被分析*由 `nudo.analysis.mode` 门禁决定。完整面：[VS Code 指南](../guides/vscode.md)。

## Zed

**nudo** Zed 扩展把 Nudo 语言服务器作为*副*语言服务器挂到 JavaScript / TypeScript 缓冲区（与 `vtsls` 并列）。它在独立仓库（[nudojs/nudo-zed](https://github.com/nudojs/nudo-zed)），需要 `@nudojs/lsp` ≥ 0.5.0 在项目本地、全局，或经 Zed 的 npm 回退可用。

安装与设置走读：[Zed 扩展](../guides/zed.md)。其他编辑器：[LSP 客户端](../guides/lsp-clients.md)。

## Vite 插件

使用 **vite-plugin-nudo** 在开发或构建时运行 Nudo：

```bash
npm install vite-plugin-nudo --save-dev
# 或
pnpm add -D vite-plugin-nudo
```

在 `vite.config.js` 中：

```javascript
import { defineConfig } from "vite";
import nudo from "vite-plugin-nudo";

export default defineConfig({
  plugins: [nudo()],
});
```

构建过程中，插件按 `nudo.analysis.mode` 筛选文件（出厂默认 `"exports"`），并将 Nudo 诊断——求值器问题加契约门禁违例（`nudo:constraint-violated`、`nudo:assign-mismatch`、`nudo:arg-structure`）——报告为构建警告；设置 `failOnError` 后变为构建错误。参见 [Vite 插件指南](../guides/vite-plugin.md)。

## 验证安装

在任意小 JS 文件上对 CLI 做冒烟测试：

```bash
npx nudojs check path/to/file.js
```

成功*与*失败时都应看到 `signatures` 被打印 —— `check` 不是静默的。退出 `0` 表示门禁通过；退出 `1` 表示有 error 级诊断（L1 契约或 L2 入口 may-throw）。接着在 VS Code 或 Zed 里打开同一文件并 hover 导出：推断签名应与 CLI 一致。

若 `npx nudojs` 缺失或解析失败，检查 Node 版本（`node -v` ≥ 20），以及包名是 `nudojs`（npm 包名），而二进制是 `nudo` / `nudojs`。

## 下一步

- [快速开始](./quick-start.md) —— 签名、用例与第一份侧车契约
- [心智模型](./mental-model.md) —— Abs 分析与检查器有何不同
- [概念分层](../concepts/layers.md) —— 观察层 / 契约层 / 进阶，按需选择
- [CLI 参考](../api/cli-reference.md) —— 每个 flag 与退出码
