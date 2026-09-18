---
sidebar_position: 2
slug: /concepts/layers
description: Day-0 零概念、Day-1 侧车契约、进阶 Abs——按需选层即可。
---

# 概念分层

Nudo 的设计是：你只学当下需要的那一层。

## Day 0 — 零概念

写普通 JavaScript，跑推断：

```bash
npx nudojs infer ./src/app.js
```

得到调用点 case：具体输入 → 推断结果。无注解、无配置。

用装了 Nudo 扩展的 VS Code 打开同一文件，可获得 hover 与 inlay。

**只想给既有 JS 补类型的话，停在这里即可。**

> 项目级可把 `package.json#nudo.analysis.mode` 设为 `all` 或 `directives`；**出厂默认是 `exports`**（含 export / 侧车 / 指令的文件进 IDE 分析）。

## Day 1 — 侧车契约

需要**义务**（CI 门禁）时，在源文件旁加侧车：

```javascript
// math.js
export function add2(x) {
  return x + 2;
}
```

```javascript
// math.nudo.js
export const add2 = number().gt(0);
```

```bash
npx nudojs check ./src/math.js
```

契约只来自：
- 显式侧车（`*.nudo.js`）/ `@nudo:refine`（约束构建器模板）
- 分析器观察到的调用点事实

无证据 → `any`/`unknown`。Nudo **不会**从 body AST 扫描发明必填 slot。

## 进阶 — Abs

内部类型是 **Abs**（`shape × term × pred × conf`）：类型是可计算的值。`nudo check --verbose` 会展示无损 Abs 面。日常开发很少需要直接接触。

## 下一步

- [快速开始](../getting-started/quick-start.md)
- [check 指南](../guides/check.md)
- [VS Code](../guides/vscode.md)
- [与 TypeScript 共存](../guides/coexistence.md)
