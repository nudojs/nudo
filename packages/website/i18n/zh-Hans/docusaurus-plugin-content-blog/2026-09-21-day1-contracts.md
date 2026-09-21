---
title: 契约就是 JS —— Day 1 与侧车 *.nudo.js
authors: [default]
tags: [nudo, contracts, check]
---

Nudo 的契约产品**不是**第二套类型语言。契约是普通 JavaScript 模块：自动绑定同名导出的侧车 `*.nudo.js`，或源码内 `@nudo:refine`。

```javascript
// pricing.nudo.js
import { number, fn } from "@nudojs/core";

export const lineTotal = fn(
  { price: number().gt(0), qty: number().ge(1) },
  number().gt(0)
);
```

```bash
npx nudojs check pricing.js
```

```text
issues
  [error] lineTotal: actual ⊭ expected  (nudo:constraint-violated)
    actual:   0  #exact
    expected: price > 0
```

<!-- truncate -->

## 产品规则

| 规则 | 含义 |
|------|------|
| 契约面 | `*.nudo.js` / `@nudo:refine`（`@nudo:interface` 是别名） |
| `@nudo:case` | 仅调试见证——绝不是契约产品 |
| 草稿 | `nudo contract --draft` 可审查；从不自动绑定 |
| check vs export | `check` 校验 Abs；`export` 有损投影 dts/zod/guards |
| any vs unknown | 入口 `any` = 无约束；`unknown` = 推导失败 |

逻辑先行的团队从调用点起草；契约先行的团队先写侧车。两者在同一 Abs 面上汇合。

下一步：[契约指南](/docs/guides/contract) · [诊断码](/docs/reference/diagnostics) · [配方](/docs/guides/recipes)。
