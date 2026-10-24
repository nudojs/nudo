---
description: "使用 vite-plugin-nudo 在 Vite 构建中分析 @nudo: 类型推断指令：支持 include/exclude glob 配置、构建警告与 failOnError 构建失败。"
---

# Vite 插件

**vite-plugin-nudo** 将 Nudo 的类型推断集成到 Vite 构建中。文件筛选与 LSP/CLI 同源：经 `nudo.analysis.mode`（`shouldAnalyzeFile`）门控；默认 `"exports"`。模式语义：[共存](./coexistence.md#何时用-modedirectives-vs-modeexports)。

## 安装

```bash
npm install vite-plugin-nudo --save-dev
```

```bash
pnpm add -D vite-plugin-nudo
```

## 配置

在 `vite.config.ts` 中添加插件：

```typescript
import { defineConfig } from "vite";
import nudo from "vite-plugin-nudo";

export default defineConfig({
  plugins: [
    nudo(),
    // ... other plugins
  ],
});
```

### 选项

| Option        | Type       | Default                 | Description                                                                 |
|---------------|------------|-------------------------|-----------------------------------------------------------------------------|
| `include`     | `string[]` | `["**/*.js", "**/*.mjs", "**/*.ts"]` | 要分析的文件 glob 模式（与 `isNudoTargetPath` 对齐）。同时按**绝对模块路径**与**相对 Vite 工程根（`config.root`）的路径**匹配 |
| `exclude`     | `string[]` | `["**/node_modules/**", "**/*.d.ts"]` | 要跳过的文件 glob 模式（与 `include` 同样的双口径匹配）。**依赖永远被跳过**，即便给了自定义 `exclude` |
| `failOnError` | `boolean`  | `false`                 | 设为 `true` 时，Nudo 类型错误会变为构建错误                                 |

### 带选项的示例

```typescript
import { defineConfig } from "vite";
import nudo from "vite-plugin-nudo";

export default defineConfig({
  plugins: [
    nudo({
      include: ["**/*.js", "**/*.mjs"],
      exclude: ["**/node_modules/**", "**/dist/**"],
      failOnError: true,
    }),
  ],
});
```

glob 模式支持任意扩展名（`**/*.js`、`**/*.mjs`、`**/*.ts` 等）、目录段模式（`**/node_modules/**`、`**/dist/**`）；不含通配符的模式按字面量子串与文件路径匹配。

每个模式按**两个口径**求值：**绝对模块路径**与**相对 Vite 工程根（`config.root`）的路径**。命中任一即算命中 ⇒ 项目相对 glob（如 `src/**`）在此处与 `package.json#nudo.analysis.include` / `exclude` 里的语义一致。`config.root` 之外的路径（依赖、工程外文件）**永远跳过**。

## 行为

- **文件匹配**：插件会处理匹配 `include` 且不匹配 `exclude` 的文件，`exclude` 总是优先。默认 `include` 为 `["**/*.js", "**/*.mjs", "**/*.ts"]`，与 `isNudoTargetPath` 一致（`.cjs`/`.cts`/`.mts`/`.tsx` 不是分析目标）。匹配在**剥掉 query 串（`?t=` / `?v=`）**的模块 id 上进行 ⇒ HMR 更新前后选中的文件集合相同。
- **分析门控**：glob 之后经 `shouldAnalyzeFile`（`package.json#nudo.analysis.mode`）。默认 `"exports"`；可配置 `"all"` / `"directives"`。
- **分析**：匹配文件使用 `@nudojs/service` 的 `analyzeFileAsync` 运行类型推断。
- **源码顺序**：插件在 Vite 的 `esbuild` 转换**之前**运行 ⇒ 它看到的是 `.ts` 文件的**原始源码**（含类型注解）。⇒ 写在注释里的 `@nudo:` 指令对分析可见，`.ts` 文件与同一份 `.js` 写法**判定完全一致**。诊断行号指的是**你的源码文件**，不是转译产物。分析器无法解析的源码（例如 decorator）只报一条 `Failed to analyze` 警告；**构建不中断**。
- **契约门禁**：匹配的文件同时会经过 Abs 契约门禁（`@nudojs/core` 的 `checkSource`）：`nudo:constraint-violated`、`nudo:assign-mismatch`、`nudo:arg-structure` 问题会并入同一条诊断管线，与求值器诊断一起报告。
- **缓存**：分析结果按文件缓存。缓存在 `buildStart` 及每次 `watchChange`（dev server 文件变更）时清除。
- **诊断**：分析诊断先经项目 `package.json#nudo.analysis.diagnostics` 档位过滤（默认档：error + warning 减噪码）再发出；幸存者作为 Vite 警告（`failOnError` 为 `true` 时为错误）发出。因此设置 `"diagnostics": "errors"` 会在构建期静音警告。**`"off"` 档只静音「显示通道」** —— 契约门禁仍然生效：error 级门禁诊断（L1 `nudo:constraint-violated`、L2 `nudo:entry-may-throw`）**仍会报告**，且在 `failOnError: true` 下**仍会让构建失败**。构建结束时输出摘要：`[nudo] Analysis complete: X error(s), Y warning(s)`。摘要走 **Vite logger**，因此 `build.logLevel: "silent"` 下**什么都不输出**——连摘要行也不输出。

## `failOnError`

- **`failOnError: false`**（默认）：Nudo 的类型错误以 Vite 警告形式报告，构建继续。
- **`failOnError: true`**：Nudo 类型错误作为构建错误报告，导致构建失败。**每一条 error 级诊断都会被报告**：第一条让构建失败，其余的以警告形式记录 ⇒ 实际报告的诊断条数**恒等于**摘要里的计数。

当希望 Nudo 在 CI 或生产构建中强制执行类型正确性时，可使用 `failOnError: true`。

## 下一步

- [安装](../getting-started/installation.md) —— 把插件接入项目
- [nudo check](./check.md) —— CI 上的同一 Abs 门禁
- [与 TypeScript 共存](./coexistence.md) —— 混合 monorepo 配方
- [版本与发布](./versioning.md) —— 什么算破坏性变更
