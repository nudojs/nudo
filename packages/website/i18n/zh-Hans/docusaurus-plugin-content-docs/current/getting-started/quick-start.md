---
description: "在普通 JavaScript 上门禁签名与用例——npx nudojs check / test。"
---

# 快速开始

**读完你能带走：** `nudo check` 的签名、`nudo test` 的用例、一份侧车契约、一条可读的 `nudo check` 失败信息，以及让门禁重新变绿的收尾闭环。

更想在浏览器里试？打开 [Playground](/playground)。

:::tip 30 秒，不开仓库
直接对任何一份**你信任的** JavaScript 文件粘贴：

```bash
npx nudojs check /path/to/your/util.js
```

应立刻看到**签名**（如 `scale(x: any) => number | string`)，然后要么 `(no issues)`，要么一行 L1/L2 发现。入口参数显示为 `any` 而不是 `unknown`——未约束就是未约束，不是推断失败。后文逐项解释你刚看到的东西。
:::

> **信任边界。** Nudo 通过**执行**目标代码来分析（Abs 语义，进程内求值）。不要对不可信代码运行 `nudo check` / `nudo test`；在 CI 里这与跑项目测试是同一信任级别。

## 1. 写普通 JavaScript

创建 `calc.js`：

```javascript verify
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
```

```text
nudo check  calc.js
OK
  0 error · 0 warning · 0 info · 2 fn

signatures
  scale(x: any) => number | string
  formatName(first: any, last: any) => string

(no issues)
```

这个 `number | string` 是老实的 JavaScript 语义，不是 bug：`+` 的操作数无约束（`any`）时，既可能走数值相加，也可能走字符串拼接（`"7" + 1`），Nudo 两条分支都保留。给 `x` 加约束——侧车契约或调用点证据——联合就会坍缩为 `number`。见[语言语义](../concepts/semantics.md)。

可选调试用例（`nudo test` —— 不是产品门禁）：

```text
=== scale ===
  call@L10  (5) => 6

=== formatName ===
  call@L9  ("Ada", "Lovelace") => "Ada Lovelace"

assertions
  — 0 passed · 0 failed · 0 unchecked (no declared @nudo:case expectations; 2 synthetic case(s) printed above)
```

Nudo 用实际看到的实参执行了这些函数。无约束入口参数显示为 **`any`**（不是 `unknown`）。观察 = `check` 签名 + IDE hover；`nudo test` 是可选的调试用例报告器。

## 3. 加上显式契约（Day 1）

在源码旁创建 `calc.nudo.js`：

```javascript verify-sidecar
import { number, fn } from "@nudojs/core";

export const scale = fn({ x: number().gt(0) }, number());
```

## 4. 用 check 把关

加一个违反侧车的调用：

```javascript verify
scale(0); // fails the sidecar — x must be > 0
```

跑门禁：

```bash
npx nudojs check calc.js
```

```text
nudo check  calc.js
FAILED
  1 error · 0 warning · 0 info · 2 fn

signatures
  scale(x: number) => number
  formatName(first: any, last: any) => string

issues
  [ERROR L12 scale] scale[x]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   0  #exact
      expected: x > 0
      → use a value satisfying x > 0, or relax the precondition on x
```

违例按调用点上报。修正调用（或放宽契约）后 `check` 通过——仍会打印签名。

`if` 守卫**不是** refinement。显式契约只来自侧车 / `@nudo:contract`。没有它们时，L2 仍门禁导出上的未消化 may-throw（入口参数为 `any`）。

## 5. 收尾闭环：变绿、CI、IDE

修正违规调用——任何满足 `x > 0` 的值都行：

```js
scale(2); // satisfies the sidecar — x must be > 0
```

再跑一次门禁：

```bash
npx nudojs check calc.js
```

```text
nudo check  calc.js
OK
  0 error · 0 warning · 0 info · 2 fn

signatures
  scale(x: number) => number
  formatName(first: any, last: any) => string

(no issues)
```

变绿了——签名照常打印；只有 `OK` / `FAILED` 行和退出码（`0`）说明门禁是否通过。闭环还剩两个落点：

- **CI** —— 把 `nudo check` 接入 GitHub Actions：[CI 集成 → GitHub Actions](../guides/check.md#github-actions)
- **IDE** —— VS Code 里的悬浮、内联提示与用例切换：[VS Code 指南](../guides/vscode.md)

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

## Export bridge + adoption profile（契约层 → 生态）

check 变绿之后（或迁移进行中），把 Abs 向外投影——编辑器要的 `.d.ts`，边界代码要的 Zod / Standard Schema / 守卫：

```bash
npx nudojs export calc.js --format all --out dist
```

schema 管边界数据；Nudo 管内部算出来的事实。完整故事：[Export：通向生态的桥](../guides/export-ecosystem.md)。

遗留 JS 在 L2 下太吵？用命名的迁移门禁档位——L1 契约违例保持 **error**，只有入口 may-throw 降到 warning：

```bash
npx nudojs check calc.js --profile adoption
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

- [心智模型](./mental-model.md) —— 产品面
- [故障排查](./troubleshooting.md) —— 第一个小时的高频问题
- [错误对照](../guides/error-faces.md)
- [概念分层](../concepts/layers.md)
- [nudo check](../guides/check.md)
- [指令 — refine / interface / 侧车](../concepts/directives.md)
- [从 TypeScript 迁移](../guides/migrating-from-typescript.md) —— 退役 `tsc`
- [Playground](/playground)
