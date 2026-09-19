---
sidebar_position: 2
description: "几分钟上手：写带调用点的纯 JavaScript，运行 npx nudojs infer。契约写在 *.nudo.js 侧车。"
---

# 快速开始

本指南带你从 JavaScript 文件推断类型。Nudo 是 Abs 原生的：生产分析在抽象解释下执行**观测到的调用点**。契约来自 `*.nudo.js` 侧车与 `@nudo:refine` / `@nudo:interface`。`@nudo:case` 是调试 / `nudo test` 子层——不是契约产品。

## 1. 创建 JavaScript 文件

创建 `math.js`，包含一个函数和调用点（不需要指令）：

```javascript
export function subtract(a, b) {
  return a - b;
}

subtract(5, 3);
subtract(1, 10);
```

调用点是 Nudo 执行的证据。可选的契约与调试见证是另一层表面——见下文。

## 2. 运行推断

在项目目录下执行：

```bash
npx nudojs infer math.js
```

## 3. 输出

```text
=== subtract ===

call@L6: (5, 3) => 2
call@L7: (1, 10) => -9

Observed: 2 | -9
```

每一行 `call@L…` 是一条观测到的调用点事实（调用所在行）。函数有多条观测时，`Observed:` 打印结果的并集，并按吸收律化简——基类型已在并集中的字面量会被吸收（例如 `2 | -9 | number` 坍缩为 `number`）；纯字面量并集保留每个字面量。

## 选项

- **`--dts`** — 在源文件旁生成 `.d.ts` 声明文件：

  ```bash
  npx nudojs infer math.js --dts
  ```

  在上面的标准输出之后，CLI 会打印：

  ```text
  Generated: math.d.ts
  ```

  生成的 `math.d.ts` 中每个函数对应一条拓宽后的单一签名，具体观测保留在 JSDoc 中：

  ```typescript
  /**
   * Case: call@L6 (5, 3) => 2
   * Case: call@L7 (1, 10) => -9
   * @param a - number
   * @param b - number
   * @returns number
   */
  export declare function subtract(a: number, b: number): number;
  ```

- **`--loc`** — 在输出中显示源码位置：

  ```bash
  npx nudojs infer math.js --loc
  ```

  ```text
  === subtract (math.js:1:0) ===

  call@L6: (5, 3) => 2
  call@L7: (1, 10) => -9

  Observed: 2 | -9
  ```

## Watch 模式

文件变更时重新运行推断：

```bash
npx nudojs watch .
```

用 `--dts` 在每次变更时生成 `.d.ts`：

```bash
npx nudojs watch . --dts
```

Watch 递归扫描目录下每个 `.js`、`.mjs`、`.ts` 文件（排除 `node_modules`）——包括没有指令的文件。

## 没有调用点的函数

没有任何被分析代码调用的函数仍会得到一条 `entry@L` 观测，以便输出其签名，参数默认为 `unknown`：

```text
=== addPrefix ===

entry@L1: (unknown, unknown) => unknown
# no call sites found; parameters default to unknown
```

要把无指令代码升级为真实调用形状，用 `--callsites` 从测试中收割——见[调用点发现指南](../guides/callsite-discovery.md)。

## 调试见证（`@nudo:case`）

`@nudo:case` **仅用于调试 / `nudo test`**——手工场景或 CI 断言的见证，不是接口产品。实参是具体值或约束构建器（`number()`、`lit(42)`、`shape({...})`、`union(...)`、`array(...)`）：

```javascript
/**
 * @nudo:case "positive numbers" (5, 3)
 * @nudo:case "negative result" (1, 10)
 * @nudo:case "symbolic" (number(), number())
 */
function subtract(a, b) {
  return a - b;
}
```

```text
=== subtract ===

debug "positive numbers": (5, 3) => 2
debug "negative result": (1, 10) => -9
debug "symbolic": (number, number) => number

Observed: number
```

具名见证打印为 `debug "name": (…) => …`。符号见证贡献基类型（`number`），会在 `Observed:` 中吸收字面量结果。

## 发生了什么？

1. **解析** — Nudo 解析文件，找到 `subtract` 函数（以及任何调用点 / 指令）。
2. **执行** — 对每条观测，用抽象解释执行函数体：`a - b` 等操作数用 Abs 值求值。
3. **合并** — 多条观测合并为 `Observed:`，并按吸收律化简。

关于 Abs、指令与抽象解释的深入细节，见[核心概念](../concepts/type-values.md)。

## 精化契约（无类型语法）

推断之外，可声明进入 Abs 并参与代数的**精化**。没有 `interface` / `type`——契约写在 `*.nudo.js` 模板里。

创建 `shapes.nudo.js`：

```javascript
import { number, string, shape } from "@nudojs/core";

export const positive = number().gt(0);
export const user = shape({
  id: number().gt(0),
  name: string(),
});
```

创建 `app.js`：

```javascript
/// @nudo:import { positive, user } from "./shapes.nudo.js"

/**
 * @nudo:refine x positive
 * @nudo:refine return positive
 */
function inc(x) {
  return x + 1;
}

/**
 * @nudo:refine u user
 */
function register(u) {
  return `${u.id}:${u.name}`;
}

inc(1);                              // ok
// inc(0);                          // error: 0 ⊭ x > 0
register({ id: 1, name: "ada" });    // ok
// register({ id: -1, name: "a" }); // error: u.id ⊭ > 0
```

用下面的命令执法：

```bash
npx nudojs check app.js
```

报告使用 `actual ⊭ expected`。精化也会流入推断：带 `@nudo:refine x positive` 的 `inc` 推断出 `number = (x + 1) where (x + 1) > 1`。

见 [nudo check](../guides/check.md) 与[指令](../concepts/directives.md#nudorefine--refinement-contract)。

## 已有 JavaScript 包

如果逻辑已经存在且没有标注，不要从指令开始——先从代码起草契约，再收紧：

- 指南：[迁移已有 JS](../guides/migrating-js.md)
- 样例：[`docs/examples/interface-draft/`](https://github.com/nudojs/nudo/tree/main/docs/examples/interface-draft)
- 仓库演示：`pnpm run migrate-demo`
