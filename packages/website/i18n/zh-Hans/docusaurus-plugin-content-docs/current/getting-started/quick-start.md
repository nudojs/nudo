---
description: "在普通 JavaScript 上门禁签名与用例——npx nudojs check / test。"
---

# 快速开始

**读完你能带走：** `nudo check` 的签名、`nudo test` 的用例、一份侧车契约，以及一条可读的 `nudo check` 失败信息。

更想在浏览器里试？打开 [Playground](/playground)。

## 1. 写普通 JavaScript

创建 `calc.js`：

```javascript
export function scale(x) {
  return x + 1;
}

export function formatName(first, last) {
  return first + " " + last;
}

formatName("Ada", "Lovelace");
scale(5);
```

没有标注。调用点就是证据。

## 2. 观察（Day 0）

```bash
npx nudojs check calc.js
npx nudojs test calc.js
```

```text
signatures
  formatName(first: any, last: any) => number | string
  scale(x: any) => number | string
```

```text
=== formatName ===
  call@L9  ("Ada", "Lovelace") => "Ada Lovelace"
=== scale ===
  call@L10  (5) => 6
```

Nudo 用实际看到的实参执行了这些函数。无约束入口参数显示为 **`any`**（不是 `unknown`）。观察 = `check` 签名 + `test` 用例 + IDE hover。

## 3. 加上显式契约（Day 1）

在源码旁创建 `calc.nudo.js`：

```javascript
import { number, fn } from "@nudojs/core";

export const scale = fn({ x: number().gt(0) }, number());
```

## 4. 用 check 把关

加一个违反侧车的调用：

```javascript
scale(0); // 违反侧车 —— x 必须 > 0
```

跑门禁：

```bash
npx nudojs check calc.js
```

```text
scale(0)  actual: 1  #exact
          expected: x > 0
          nudo:constraint-violated   actual ⊭ expected
```

违例按调用点上报。修正调用（或放宽契约）后 `check` 通过——仍会打印签名。

`if` 守卫**不是** refinement。显式契约只来自侧车 / `@nudo:refine`（别名 `@nudo:interface`）。没有它们时，L2 仍门禁导出上的未消化 may-throw（入口参数为 `any`）。

## 选项

- **`.d.ts` 投影** —— 生态桥（单向有损；Abs 才是真理源）：

  ```bash
  npx nudojs export calc.js --format dts --out dist/types
  ```

- **Watch 模式**（旗标，不是动词）

  ```bash
  npx nudojs check src/ --watch
  npx nudojs test src/ --watch
  ```

## 调试见证（可选）

`@nudo:case` 用于**场景调试**（`nudo test`、LSP 用例切换）——不是契约产品：

```javascript
/**
 * @nudo:case "double digits" (10)
 */
export function scale(x) {
  return x + 1;
}
```

case 实参请用具体值或约束构建器。

## 下一步

- [概念分层](../concepts/layers.md)
- [nudo check](../guides/check.md)
- [指令 — refine / interface / 侧车](../concepts/directives.md)
- [Playground](/playground)
