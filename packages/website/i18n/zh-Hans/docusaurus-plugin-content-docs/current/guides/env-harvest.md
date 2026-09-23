---
slug: /guides/env-harvest
description: 依赖类型从哪来 —— 固定 es/web/node env、@types 分析期静默补洞，以及何时该 mock。
---

# 依赖类型

Nudo 不为用户提供 harvest 命令。产品 env 是**固定集合**（`@nudojs/env` 的 `es` / `web` / `node`）；其余要么分析期静默补洞，要么你自己 mock。

## 类型如何到达

| import 目标 | 发生什么 |
|---|---|
| 内建 API（`path`、`fs`、DOM…） | 手写 `@nudojs/env`（`es` / `web` / `node`） |
| 有可用 `.js`/`.mjs` 的 JS 源码包 | 分析**执行**源码（Abs 求值器） |
| `@types/*` 或包自带 `.d.ts` | 分析**自动 harvest** 声明进 env 模块 —— 无需 CLI 步骤 |
| 两者皆无 | 空 modules → 用 `@nudo:mock` 或路径 `/// @nudo:env` |

Harvest **不是**产品动词。第三方 `@types` 在 `nudo check` / `nudo test` / LSP 分析时自动注入；手写 `@nudojs/env` 在重叠模块键与导出名上 wins。

## 具名 env vs 路径 env

具名环境是固定的：

```javascript
/// @nudo:env node
```

需要自定义类型面（领域包、手调签名）时，自己写或生成 env 模块，按路径引用：

```javascript
/// @nudo:env ./my-env.ts
```

路径 env 导出 `defineEnv()`，用 `@nudojs/core` 的 Abs 构造器。`@nudojs/harvester` 可为 **env 包作者**从 `.d.ts` 生成该形态——它是库辅助，不是终端用户命令。

## 诚实边界

**Env / 自动 harvest 不能替代 mock。** 原生运行时回调、动态 `require` 与未建模的原生仍可能以 `unknown` / `entry@` 结果出现。覆盖率基线**不是**完备性承诺。见[边界](../concepts/limits.md)与[语言语义](../concepts/semantics.md)。

当 API 进程本地或高度动态时，改用 mock：

```javascript
// @nudo:mock fetch = (url) => ({ ok: true, json: () => ({ id: 1 }) })
```

## 下一步

- [指令 —— `@nudo:env`](../concepts/directives.md)
- [API · harvester](../api/harvester.md)（env 编写库）
- [Recipes](./recipes.md)
