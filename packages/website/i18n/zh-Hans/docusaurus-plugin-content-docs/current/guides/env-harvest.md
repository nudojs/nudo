---
slug: /guides/env-harvest
description: nudo env harvest —— 把 @types 声明转为 Nudo env 模块。
---

# nudo env harvest

`nudo env harvest` 把 `@types/<pkg>` 声明转换为 Nudo env 模块，使 `@nudo:env` 能在分析中为 Node/Web API 提供类型。

```bash
npx nudojs env harvest <pkg> [--out file]
npx nudojs env harvest node
# 自动 harvest：扫描目录中的裸 import，上报可 harvest 的 @types 包
npx nudojs env harvest --auto .
npx nudojs env harvest --auto src/
```

`--out` 接收输出**文件**路径（默认 `./nudo-harvest-<pkg>.ts`）——不是目录。`--auto [dir]` 上报目录树中可自动 harvest 的 `@types` 包（带 `--auto` 时 `<pkg>` 可省略）。

在源码中引用生成的 env：

```ts
/// @nudo:env ./nudo-harvest-node.ts
```

内置 `es` / `web` / `node` 环境已覆盖大量常见 API（`@nudojs/env`）。

## 诚实边界

**Env / harvest 不能替代 mock。** 原生运行时回调、动态 `require` 与未建模的原生仍可能以 `unknown` / `entry@` 结果出现。覆盖率基线**不是**完备性承诺。见[边界](../concepts/limits.md)与[语言语义](../concepts/semantics.md)。

当 API 进程本地或高度动态时，改用 mock：

```javascript
// @nudo:mock fetch = (url) => ({ ok: true, json: () => ({ id: 1 }) })
```

## 下一步

- [指令 —— `@nudo:env`](../concepts/directives.md)
- [API · harvester](../api/harvester.md)
- [Recipes](./recipes.md)
