---
sidebar_position: 2
description: "几分钟上手：给 JavaScript 文件添加 @nudo:case 指令并运行 npx nudo infer。"
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

```text
=== subtract ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: number
```

Nudo 对该函数执行了三次——两次使用具体输入，一次使用符号化的 `T.number` 作为两个参数。`Combined` 是所有用例结果的联合，并按吸收律化简：符号化用例已贡献 `number`，因此字面量结果 `2`、`-9` 被吸收——`2 | -9 | number` 坍缩为 `number`。不含基类型成员的纯字面量联合会保留每个字面量。

## 选项

- **`--dts`** — 在源文件旁生成 `.d.ts` 声明文件：

  ```bash
  npx nudo infer math.js --dts
  ```

  在上面的标准输出之后，CLI 会打印：

  ```text
  Generated: math.d.ts
  ```

  生成的 `math.d.ts` 中每个函数对应一条拓宽后的单一签名，具体用例保留在 JSDoc 中：

  ```typescript
  /**
   * Case: positive numbers (5, 3) => 2
   * Case: negative result (1, 10) => -9
   * @param a - number
   * @param b - number
   * @returns number
   */
  export declare function subtract(a: number, b: number): number;
  ```

- **`--loc`** — 在输出中显示源码位置：

  ```bash
  npx nudo infer math.js --loc
  ```

  ```text
  === subtract (math.js:6:0) ===

  Case "positive numbers": (5, 3) => 2
  Case "negative result": (1, 10) => -9
  Case "symbolic": (number, number) => number

  Combined: number
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

watch 会递归扫描目录下的所有 `.js`、`.mjs`、`.ts` 文件（排除 `node_modules`）——包括没有指令的文件。

## 没有指令的函数

没有 `@nudo:case` 指令的函数同样不会被跳过。CLI 会做全程序推断：在被分析代码某处被调用的函数，会从调用点合成一个用例，携带调用点实际观测到的实参类型。

创建 `utils.js`——全程没有任何 `@nudo:` 指令：

```javascript
function formatPrice(cents) {
  return "$" + (cents / 100).toFixed(2);
}

console.log(formatPrice(1999));
```

```bash
npx nudo infer utils.js
```

```text
=== formatPrice ===

Case "call@L5": (1999) => `$${string}`
```

用例以调用所在行命名为 `call@L5`——`console.log(formatPrice(1999))` 位于 `utils.js` 的第 5 行。没有被任何已分析代码调用的函数仍会得到一个 `entry@L` 用例以保证签名被输出，参数默认为 `unknown`：

```text
=== addPrefix ===

Case "entry@L1": (unknown, unknown) => `${unknown}: ${unknown}`
# no call sites found; parameters default to unknown
```

要让没有指令的代码获得真实调用形态，可用 `--callsites` 从测试中收集用例——参见[调用点发现指南](../guides/callsite-discovery.md)。

## 发生了什么？

1. **解析** — Nudo 解析文件，找到带有 `@nudo:case` 指令的 `subtract` 函数。
2. **执行** — 对每个 case，它使用抽象解释运行函数体：像 `a - b` 这样的操作数会用类型值而非具体数字进行计算。
3. **合并** — 有多个 case 时，Nudo 将推断出的返回类型合并为联合类型，再按吸收律化简：字面量 `2`、`-9` 被符号化用例贡献的 `number` 吸收，得到 `number`。不含基类型成员的纯字面量联合会保留每个字面量。

想进一步了解类型值、指令和抽象解释，请参阅 [核心概念](../concepts/type-values.md)。
