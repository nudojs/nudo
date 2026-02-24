---
sidebar_position: 2
---

# 快速开始

本指南将带你通过 Nudo 指令和 CLI 从 JavaScript 文件推断类型。

## 1. 创建 JavaScript 文件

创建 `math.js`，包含一个函数和 `@nudo:case` 指令：

```javascript
/**
 * @nudo:case "positive numbers" (5, 3)
 * @nudo:case "negative result" (1, 10)
 * @nudo:case "symbolic" (T.number, T.number)
 */
function subtract(a, b) {
  return a - b;
}
```

每个 `@nudo:case` 为 Nudo 提供一个具名输入用于执行。你可以使用：

- **具体值**，如 `(5, 3)` 或 `("hello")`
- **符号类型值**，如 `(T.number, T.number)` 或 `T.union(T.string, T.number)`

## 2. 运行推断

在项目目录下执行：

```bash
npx nudo infer math.js
```

## 3. 输出

```
=== subtract ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: number
```

Nudo 对该函数执行了三次——两次使用具体输入，一次使用符号化的 `T.number` 作为两个参数。它推断出 `subtract` 始终返回 `number`，并将结果合并。

## 选项

- **`--dts`** — 在源文件旁生成 `.d.ts` 声明文件：

  ```bash
  npx nudo infer math.js --dts
  ```

- **`--loc`** — 在输出中显示源码位置：

  ```bash
  npx nudo infer math.js --loc
  ```

## 监听模式

在文件变更时重新运行推断：

```bash
npx nudo watch .
```

配合 `--dts` 可在每次变更时生成 `.d.ts` 文件：

```bash
npx nudo watch . --dts
```

## 发生了什么？

1. **解析** — Nudo 解析文件，找到带有 `@nudo:case` 指令的 `subtract` 函数。
2. **执行** — 对每个 case，它使用抽象解释运行函数体：像 `a - b` 这样的操作数会用类型值而非具体数字进行计算。
3. **合并** — 有多个 case 时，Nudo 将推断出的返回类型合并为联合类型（若一致则为单一类型）。

想进一步了解类型值、指令和抽象解释，请参阅 [核心概念](/docs/concepts/type-values)。
