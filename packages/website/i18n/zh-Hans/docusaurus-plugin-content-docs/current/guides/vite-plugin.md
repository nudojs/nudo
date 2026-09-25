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
| `include`     | `string[]` | `["**/*.js", "**/*.mjs", "**/*.ts"]` | 要分析的文件 glob 模式（与 `isNudoTargetPath` 对齐） |
| `exclude`     | `string[]` | `["**/node_modules/**", "**/*.d.ts"]` | 要跳过的文件 glob 模式                                                      |
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

## 行为

- **文件匹配**：插件会处理匹配 `include` 且不匹配 `exclude` 的文件，`exclude` 总是优先。默认 `include` 为 `["**/*.js", "**/*.mjs", "**/*.ts"]`，与 `isNudoTargetPath` 一致（`.cjs`/`.cts`/`.mts`/`.tsx` 不是分析目标）。
- **分析门控**：glob 之后经 `shouldAnalyzeFile`（`package.json#nudo.analysis.mode`）。默认 `"exports"`；可配置 `"all"` / `"directives"`。
- **分析**：匹配文件使用 `@nudojs/service` 的 `analyzeFileAsync` 运行类型推断。
- **契约门禁**：匹配的文件同时会经过 Abs 契约门禁（`@nudojs/core` 的 `checkSource`）：`nudo:constraint-violated`、`nudo:assign-mismatch`、`nudo:arg-structure` 问题会并入同一条诊断管线，与求值器诊断一起报告。
- **缓存**：分析结果按文件缓存。缓存在 `buildStart` 及每次 `watchChange`（dev server 文件变更）时清除。
- **诊断**：分析诊断先经项目 `package.json#nudo.analysis.diagnostics` 档位过滤（默认档：error + warning 减噪码）再发出；幸存者作为 Vite 警告（`failOnError` 为 `true` 时为错误）发出。因此设置 `"diagnostics": "errors"` 会在构建期静音警告，`"off"` 则完全静音插件诊断输出。构建结束时输出摘要：`[nudo] Analysis complete: X error(s), Y warning(s)`。

## `failOnError`

- **`failOnError: false`**（默认）：Nudo 的类型错误以 Vite 警告形式报告，构建继续。
- **`failOnError: true`**：Nudo 类型错误作为构建错误报告，导致构建失败。

当希望 Nudo 在 CI 或生产构建中强制执行类型正确性时，可使用 `failOnError: true`。
