---
sidebar_position: 3
---

# Vite 插件

**vite-plugin-nudo** 将 Nudo 的类型推断集成到 Vite 构建中。它会分析含有 `@nudo:*` 指令的文件，并在开发和生产构建时报告诊断信息。

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
| `include`     | `string[]` | `["**/*.js"]`           | 要分析的文件 glob 模式                                                      |
| `exclude`     | `string[]` | `["**/node_modules/**"]`| 要跳过的文件 glob 模式                                                      |
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

## 行为

- **文件匹配**：插件会处理匹配 `include` 且不匹配 `exclude` 的文件。默认的 `**/*.js` 会包含所有 JavaScript 文件。
- **指令检查**：不含 Nudo 指令（`@nudo:case`、`@nudo:mock`、`@nudo:pure`、`@nudo:skip`、`@nudo:sample`、`@nudo:returns`）的文件会被跳过，不进行分析。
- **分析**：对于匹配且有指令的文件，插件使用 `@nudojs/service` 的 `analyzeFile` 运行类型推断。
- **缓存**：分析结果按文件缓存。缓存在 `buildStart` 时清除。
- **诊断**：分析产生的错误和警告会作为 Vite 警告发出（当 `failOnError` 为 `true` 时为错误）。构建结束时，会输出摘要：`[nudo] Analysis complete: X error(s), Y warning(s)`。

## `failOnError`

- **`failOnError: false`**（默认）：Nudo 的类型错误以 Vite 警告形式报告，构建继续。
- **`failOnError: true`**：Nudo 类型错误作为构建错误报告，导致构建失败。

当希望 Nudo 在 CI 或生产构建中强制执行类型正确性时，可使用 `failOnError: true`。
