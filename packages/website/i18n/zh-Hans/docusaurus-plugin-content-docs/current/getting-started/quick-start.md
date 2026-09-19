---
sidebar_position: 2
description: "在普通 JavaScript 上观测执行，并用侧车契约做校验——npx nudojs infer / check。"
---

# 快速开始

**读完你能带走：** 来自调用点的观测结果、一份侧车契约，以及一条可读的 `nudo check` 失败信息。

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

## 2. 观测（Day 0）

```bash
npx nudojs infer calc.js
```

```text
=== formatName ===

Case "call@L9": ("Ada", "Lovelace") => "Ada Lovelace"
Combined: `Ada Lovelace`

=== scale ===

Case "call@L0": (5) => 6  #exact
Combined: number
```

Nudo 用实际看到的实参执行了这些函数。泛化视图还会给出中间量上的代数（`term` / `pred` / `conf`）——那是可观测层，不是第二套类型语言。

## 3. 加上显式契约（Day 1）

在源码旁创建 `calc.nudo.js`：

```javascript
import { number, fn } from "@nudojs/core";

export const scale = fn({ x: number().gt(0) }, number());
```

## 4. 用 check 把关

```bash
npx nudojs check calc.js
```

```text
scale(0)  actual: 1  #exact
          expected: x > 0
          nudo:constraint-violated   actual ⊭ expected
```

加一个错误调用即可复现：

```javascript
scale(0); // 违反侧车 —— x 必须 > 0
```

`if` 守卫**不是** refinement。契约只来自侧车 / `@nudo:refine` / `@nudo:interface`。

## 选项

- **`--dts`** — 生成有损的 `.d.ts` 投影以对接生态：

  ```bash
  npx nudojs infer calc.js --dts
  ```

- **Watch 模式**

  ```bash
  npx nudojs watch src/ --dts
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

case 实参请用具体值。符号化 `T.*` 属遗留语法，现行示例不再使用。

## 下一步

- [概念分层](../concepts/layers.md)
- [nudo check](../guides/check.md)
- [指令 — refine / interface / 侧车](../concepts/directives.md)
- [Playground](/playground)
