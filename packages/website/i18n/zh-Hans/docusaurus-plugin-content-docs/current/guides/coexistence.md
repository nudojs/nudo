---
sidebar_position: 8
slug: /guides/coexistence
description: JS 用 Nudo、TS 包继续用 tsc——同一 monorepo 里互不打架的配方。
---

# 与 TypeScript 共存

Nudo 与 `tsc` 可以共享仓库。Nudo 面向 **JavaScript**（以及剥掉类型标注后的 `.ts` 源码）；它不替代 `.ts` 优先包上的 TypeScript 编译器。

## 配方 1：JS 包用 Nudo，TS 包用 tsc

```
apps/
  web/          # TypeScript → tsc / ts-node
packages/
  legacy-js/    # 纯 .js → nudo check + Nudo LSP
```

`packages/legacy-js/package.json`：

```json
{
  "nudo": {
    "interface": { "autoBind": true },
    "analysis": { "mode": "exports", "diagnostics": "default" }
  }
}
```

该包的 CI：

```bash
npx nudojs check packages/legacy-js/src
```

**不要**对 `apps/web/**/*.ts` 跑 `nudo check`，除非你有意剥类型分析。

## 配方 2：仅对 `src/**/*.js` 开 Nudo

```json
{
  "nudo": {
    "analysis": {
      "include": ["src/**/*.js"],
      "exclude": ["**/node_modules/**", "**/dist/**", "**/*.ts"],
      "mode": "exports"
    }
  }
}
```

`.ts` 文件交给 tsc。Nudo LSP 仍会对匹配 `include` 的已打开 `.js` 文件提供 hover/inlay。

## 配方 3：渐进契约

1. 先 infer——不需要指令。
2. 某个函数需要 CI 门禁时，在旁边加 `fn.nudo.js`。
3. `nudo check` 只执法**手写**侧车；`@generated` 段是事实 + drift，不产生新义务。

## 不要做的事

- 不要指望 Nudo 理解 TypeScript 类型语法（条件类型、`infer` 等）。
- 不要让两个工具在冲突严重级别下扫同一 `.ts` 源——请拆路径。
- 不要把 `.d.ts` 投影（`nudo emit`）当真理源——Abs 才是；`.d.ts` 是单向兼容通道。

## IDE

在已有 TS server 旁安装 Nudo VS Code 扩展即可共存：TS 处理 `.ts`，Nudo 按 `nudo.analysis.mode` 分析 `.js`。

> **默认注意**：`analysis.mode` 出厂默认为 `exports`（含 `export` / 侧车 / 指令的文件进引擎）；`all` 可全量分析，`directives` 可回到保守门禁。
