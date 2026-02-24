---
sidebar_position: 3
---

# 指令系统

指令是控制 Nudo 如何分析代码的结构化注释。它们使用 `@nudo:` 命名空间以避免与 JSDoc 和其他工具冲突。将指令放在函数上方的块注释中。

## 指令语法

所有指令都在 `@nudo:` 命名空间下，以结构化注释的形式编写：

```javascript
/**
 * @nudo:case "name" (arg1, arg2)
 * @nudo:mock fetch = ...
 */
function myFunction(a, b) {
  // ...
}
```

多个指令可以出现在同一个注释块中。解析器会在引擎运行前提取它们。

---

## @nudo:case — 具名执行用例

提供具名执行用例。每个用例定义输入（具体值或符号值），供 Nudo 执行函数时使用。

### 语法

```text
@nudo:case "name" (arg1, arg2, ...)
@nudo:case "name" (arg1, arg2) => expectedType
```

- **name** — 用例的字符串标识符（如 `"positive numbers"`）。
- **args** — 逗号分隔的参数：具体值（`5`、`"hello"`）或类型表达式（`T.number`、`T.union(T.string, T.number)`）。
- **expected**（可选）— `=>` 之后的类型值表达式，用于验证预期返回类型。

### 示例

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

```javascript
/**
 * @nudo:case "strings" (T.string)
 * @nudo:case "numbers" (T.number)
 * @nudo:case "array" (T.array(T.number))
 */
function process(x) {
  if (typeof x === "string") return x.length;
  if (typeof x === "number") return x * 2;
  return x.length;
}
```

带有预期返回类型：

```javascript
/**
 * @nudo:case "basic" (T.string) => T.number
 * @nudo:case "empty" ("") => T.literal(0)
 */
function len(s) {
  return s.length;
}
```

---

## @nudo:mock — Mock 外部依赖

在求值期间将外部依赖替换为类型值感知的 mock 实现。适用于 `fetch`、文件系统 API 或其他 Nudo 无法直接执行的代码。

### 语法

**内联表达式：**

```text
@nudo:mock name = expression
```

**从模块导入：**

```text
@nudo:mock name from "path"
```

- **name** — 要 mock 的标识符（如 `fetch`、`fs`）。
- **expression** — 返回类型值或接受类型值的函数的 JavaScript 表达式。
- **path** — 提供 mock 的模块路径。

### 示例

```javascript
/**
 * @nudo:mock fetch = (url) => T.promise(T.object({
 *   ok: T.boolean,
 *   json: T.fn({ params: [], returns: T.object({ id: T.number, name: T.string }) })
 * }))
 * @nudo:case "user" (T.number)
 */
async function fetchUser(id) {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
}
```

```javascript
/**
 * @nudo:mock fs from "./mocks/fs.js"
 * @nudo:case "read" (T.string)
 */
function readConfig(path) {
  return fs.readFileSync(path, "utf-8");
}
```

---

## @nudo:pure — 标记纯函数

将函数标记为纯函数，使引擎可以记忆化结果。相同的类型值输入产生相同的输出，因此重复调用可以复用缓存的结果。

### 语法

```text
@nudo:pure
```

### 示例

```javascript
/**
 * @nudo:pure
 * @nudo:case "add" (T.number, T.number)
 */
function add(a, b) {
  return a + b;
}
```

---

## @nudo:skip — 跳过求值

跳过抽象解释。引擎不求值函数体，而是使用已有的类型信息（如 TypeScript/JSDoc 注解或 `@nudo:returns`）。

### 语法

```text
@nudo:skip
@nudo:skip returnsExpr
```

- **returnsExpr**（可选）— 当没有注解可用时，用于指定返回类型的类型值表达式。

### 示例

```javascript
/**
 * @nudo:skip
 */
function heavyComputation(data) {
  // Nudo 不应求值的复杂算法
  return processData(data);
}
```

```javascript
/**
 * @nudo:skip T.number
 */
function unannotatedHeavy(x) {
  // 没有 TypeScript 注解；显式指定返回类型
  return expensiveOp(x);
}
```

---

## @nudo:sample — 循环采样

控制引擎在切换到不动点分析之前求值多少次循环迭代。用于在精度和性能之间权衡。

### 语法

```text
@nudo:sample N
```

- **N** — 正整数：泛化之前运行的具体迭代次数。

### 示例

```javascript
/**
 * @nudo:sample 10
 * @nudo:case "reduce" (T.array(T.number))
 */
function sum(arr) {
  let total = 0;
  for (let i = 0; i < arr.length; i++) {
    total += arr[i];
  }
  return total;
}
```

---

## @nudo:returns — 断言预期返回类型

断言推断的返回类型匹配给定的类型或谓词。适用于测试和文档化。

### 语法

```text
@nudo:returns (typeValueExpr)
```

- **typeValueExpr** — 类型值表达式。引擎检查推断的返回类型是否等于或是此类型的子类型。

### 示例

```javascript
/**
 * @nudo:case "numbers" (T.number, T.number)
 * @nudo:returns (T.number)
 */
function add(a, b) {
  return a + b;
}
```

```javascript
/**
 * @nudo:case "union" (T.union(T.string, T.number))
 * @nudo:returns (T.union(T.number, T.string))
 */
function process(x) {
  if (typeof x === "string") return x.length;
  return x;
}
```

---

## 汇总表

| 指令 | 语法 | 用途 |
|-----------|--------|---------|
| `@nudo:case` | `"name" (args...)` 或 `"name" (args) => type` | 提供具名执行用例 |
| `@nudo:mock` | `name = expr` 或 `name from "path"` | Mock 外部依赖 |
| `@nudo:pure` | （无参数） | 标记纯函数以启用记忆化 |
| `@nudo:skip` | `[returnsExpr]` | 跳过求值，使用已有类型信息 |
| `@nudo:sample` | `N` | 控制不动点之前的循环采样次数 |
| `@nudo:returns` | `(typeValueExpr)` | 断言预期返回类型 |
