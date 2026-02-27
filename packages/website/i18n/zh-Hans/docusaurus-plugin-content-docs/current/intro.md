---
sidebar_position: 1
slug: /intro
---

# 简介

**Nudo** 是一个面向 JavaScript 的类型推断引擎，采用**抽象解释**（abstract interpretation）—— 用符号化的「类型值」代替具体值来执行你的代码，从而推导出类型。无需 TypeScript、无需 `.d.ts` 文件、无需构建步骤。只需带注释的 JavaScript 和基于运行时的类型推断。

## 工作原理

与静态分析或类型注解不同，Nudo 会实际*执行*你的函数 —— 但使用的是符号输入，例如 `T.number` 或 `T.string`。引擎跟踪值在分支、运算符和调用之间的流动，并生成推断出的返回类型。这让静态分析器难以处理的复杂逻辑也能推断类型。

## Nudo 与 TypeScript

| TypeScript | Nudo |
|------------|------|
| 事先声明类型，编译器检查使用情况 | 编写普通 JavaScript，引擎通过执行来推断类型 |
| 需要 `.ts` 文件或 JSDoc 注解 | 在 `.js` 文件中使用 `@nudo:case` 等注释指令 |
| 类型描述意图 | 类型从实际行为推导而来 |

**示例：带分支逻辑的函数**

```javascript
/**
 * @nudo:case "strings" (T.string)
 * @nudo:case "numbers" (T.number)
 */
function process(x) {
  if (typeof x === "string") return x.length;
  return x * 2;
}
```

通过 `@nudo:case` 指令，你可以告诉 Nudo 用哪些输入来「执行」。对于 `"strings"`，它用 `T.string` 运行 → 推断出 `number`。对于 `"numbers"`，它用 `T.number` 运行 → 推断出 `number`。Nudo 可以将这些结果合并得到最终类型。

**使用 TypeScript** 时，你通常需要自己写 `x: string | number` 和 `: number`。Nudo 则通过执行推断出两者。

## 超越 TypeScript

Nudo 可以推断出 TypeScript 类型系统无法表达的类型：

```javascript
// 字符串拼接保留结构
"0x" + T.string                // → `0x${string}`（TS: string）

// 字符串方法对字面量计算精确结果
"hello".toUpperCase()          // → "HELLO"（TS: string）
"a,b,c".split(",")            // → ["a", "b", "c"]（TS: string[]）

// 循环在类型层面求值
let sum = 0;
for (let i = 0; i < 5; i++) sum += i;
// sum → 10（TS: number）
```

用户还可以通过 `T.refine` 定义自定义精化类型，附加领域特定的运算规则。详见[示例](/docs/guides/examples)。

## 下一步

- **[安装](/docs/getting-started/installation)** — 安装 CLI、VS Code 扩展和 Vite 插件
- **[快速开始](/docs/getting-started/quick-start)** — 在第一个文件上运行 `nudo infer`
- **[核心概念](/docs/concepts/type-values)** — 类型值、指令与抽象解释
