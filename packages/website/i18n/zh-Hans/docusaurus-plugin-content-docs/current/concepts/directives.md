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

在求值期间将外部依赖替换为 mock 实现。适用于 `fetch`、文件系统 API 或其他 Nudo 无法直接执行的代码。

### 语法

支持五种形式。**所有内联表达式必须写在单行内**——见下方警告。

**1. 单行箭头函数。** body 是普通 JavaScript；参数接收类型值：

```text
@nudo:mock name = (arg) => body
```

**2. Mock helper** — `stub()`、`spy()`、`mock()`，可链式调用 `.returns(...)`、`.resolves(...)`、`.rejects(...)`、`.withArgs(...)`、`.callsFake(...)`：

```text
@nudo:mock name = stub().returns(value)
```

**3. sinon 风格等价物** — `sinon.stub()` / `sinon.spy()`，支持相同链式调用：

```text
@nudo:mock name = sinon.stub().returns(value)
```

**4. 类型值表达式：**

```text
@nudo:mock name = T.number
```

**5. 从模块导入** — 模块中必须定义与 mock 同名的绑定：

```text
@nudo:mock name from "path"
```

- **name** — 要 mock 的标识符（如 `fetch`、`fs`）。
- **path** — 提供 mock 的模块路径。

**警告：表达式必须单行。** 解析器只读取到行尾，多行表达式会在第一行被截断并报 `nudo:mock-invalid`。以下写法**不**可用：

```text
@nudo:mock fetch = (url) => T.promise(T.object({
  ok: T.boolean,
  json: T.fn({ params: [], returns: T.object({ ... }) })
}))
```

截断行的真实诊断：

```text
[warning] example.js:0:0 Mock expression "(url) => T.promise(T.object({" could not be parsed as a known pattern (nudo:mock-invalid)
[warning] example.js:10:9 Cannot resolve 'json' on unknown value (nudo:unknown-recv)
```

**警告：箭头函数 body 内不可用 `T.*`。** `T` 只存在于指令表达式中（case 参数、`= T.string` 等）。mock body 内只能写普通 JavaScript——普通对象和闭包——或改用 `stub().returns(...)` / `stub().resolves(...)` helper。

### 示例

用箭头函数 mock `fetch`。body 是单行普通 JavaScript：

```javascript
/**
 * @nudo:mock fetch = (url) => ({ ok: true, json: () => ({ id: 1, name: "Alice" }) })
 * @nudo:case "user" (1)
 */
async function fetchUser(id) {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
}
```

**推断输出：**

```
=== fetchUser ===

Case "user": (1) => Promise<{ id: 1, name: "Alice" }>
```

用 mock helper 达到同样效果——`stub().resolves(value)` 让每次调用都返回 `Promise<value>`：

```javascript
/**
 * @nudo:mock fetch = stub().resolves({ ok: true, json: () => ({ id: 1, name: "Alice" }) })
 * @nudo:case "user" (1)
 */
async function fetchUser(id) {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
}
```

同样推断为 `Promise<{ id: 1, name: "Alice" }>`。同步 helper：

```javascript
/**
 * @nudo:mock getPort = stub().returns(8080)
 * @nudo:case "default" ()
 */
function readPort() {
  return getPort();
}
```

**推断输出：**

```
=== readPort ===

Case "default": () => 8080
```

类型值表达式直接把名称绑定到类型值：

```javascript
/**
 * @nudo:mock retries = T.number
 * @nudo:case "plan" ()
 */
function plan() {
  return retries + 1;
}
```

**推断输出：**

```
=== plan ===

Case "plan": () => number
```

从模块导入——模块中必须定义与 mock 同名的绑定：

```javascript
/**
 * @nudo:mock fs from "./mocks/fs.js"
 * @nudo:case "read" (T.string)
 */
function readConfig(path) {
  return fs.readFileSync(path, "utf-8");
}
```

```javascript
// mocks/fs.js
const fs = { readFileSync: (path, encoding) => "{ \"port\": 3000 }" };
```

**推断输出：**

```
=== readConfig ===

Case "read": (string) => "{ \"port\": 3000 }"
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

跳过抽象解释。引擎不求值函数体。没有返回类型表达式时，函数报告为 `Skipped (no return type declared)`；在指令后添加类型值表达式即可声明返回类型。

### 语法

```text
@nudo:skip
@nudo:skip returnsExpr
```

- **returnsExpr**（可选）— 用作返回类型的类型值表达式。

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

**推断输出：**

```
=== heavyComputation ===

Skipped (no return type declared)
```

```javascript
/**
 * @nudo:skip T.number
 */
function unannotatedHeavy(x) {
  // 通过指令显式指定返回类型
  return expensiveOp(x);
}
```

**推断输出：**

```
=== unannotatedHeavy ===

Skipped (declared): number
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

## @nudo:env — 运行时环境

声明文件中可用的运行时环境 API。这是一个**文件级**指令，使用三斜线注释放在文件顶部。Nudo 内置了常见环境的类型定义，无需手动为标准 API 编写 mock。

### 语法

```text
/// @nudo:env name1, name2, ...
```

- **names** — 逗号分隔的环境名称。内置环境：`es`、`web`、`node`。
- `web` 和 `node` 自动包含 `es`。

### 支持的环境

| 名称 | 提供的 API |
|------|----------|
| `es` | `JSON`、`Math`、`Number`、`Array`、`console`、`Promise`、`Date`、错误构造函数等 |
| `web` | `fetch`、`Request`、`Response`、`URL`、`localStorage`、`document`、`navigator`、`crypto`、`performance`、定时器等 |
| `node` | `process`、`Buffer`、`__dirname`、`__filename`、定时器，以及模块：`fs`、`path`、`os`、`crypto`、`url`、`child_process`、`util` |

### 示例

```javascript
/// @nudo:env web

/**
 * @nudo:case "test" (T.number)
 */
async function fetchUser(id) {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
}
```

```javascript
/// @nudo:env node

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @nudo:case "test" (T.string)
 */
function loadConfig(dir) {
  const content = readFileSync(join(dir, "config.json"), "utf-8");
  return JSON.parse(content);
}
```

### 项目级配置

也可以在 `package.json` 中设置环境，使项目中的所有文件都使用：

```json
{
  "nudo": {
    "env": ["node"]
  }
}
```

文件级 `@nudo:env` 指令会与项目级设置合并（取所有环境名称的并集）。

---

## @nudo:mock-module — 模块级 Mock

替换或部分替换导入的模块为自定义 mock 文件。这是一个**文件级**指令，使用三斜线注释。

### 语法

**完全替换：**

```text
/// @nudo:mock-module "original-module" from "./mock-file.js"
```

**部分替换（仅指定的导出）：**

```text
/// @nudo:mock-module "original-module" { export1, export2 } from "./mock-file.js"
```

- **original-module** — 要拦截的模块标识符（如 `"lodash"`、`"node:fs"`）。
- **exports**（可选）— 要替换的特定命名导出。未指定的导出回退到原始模块。
- **mock-file** — 提供 mock 实现的文件路径。

### 示例

```javascript
/// @nudo:mock-module "axios" from "./mocks/axios.js"

import axios from "axios";

/**
 * @nudo:case "test" ()
 */
async function getUsers() {
  const res = await axios.get("/api/users");
  return res.data;
}
```

```javascript
/// @nudo:mock-module "lodash" { debounce } from "./mocks/lodash-debounce.js"

import { debounce, throttle } from "lodash";
// debounce 来自 mock；throttle 正常解析
```

### 项目级配置

```json
{
  "nudo": {
    "mocks": {
      "axios": "./nudo-mocks/axios.js"
    }
  }
}
```

文件级 `@nudo:mock-module` 指令会覆盖同一模块的项目级 mock。

---

## @nudo:as — 类型断言

覆盖下一条语句的值类型。类似 TypeScript 的 `as` 关键字，但以行注释的形式放在语句上方。影响 `VariableDeclaration`、`ReturnStatement` 和 `ExpressionStatement`。

### 语法

```text
// @nudo:as typeValueExpr
```

### 示例

```javascript
// @nudo:as T.object({ port: T.number, host: T.string })
const config = JSON.parse(content);
// config 现在是 { port: number, host: string } 而不是 unknown
```

```javascript
// @nudo:as T.array(T.object({ id: T.number, name: T.string }))
return JSON.parse(response);
```

---

## @nudo:replace — 子表达式类型替换

替换下一条语句中特定子表达式的类型。目标表达式通过源码文本与 AST 节点匹配，不会匹配部分标识符或字符串内容。

### 语法

```text
// @nudo:replace targetExpr typeValueExpr
```

- **targetExpr** — 要替换的表达式源码文本（如 `a`、`res.data`、`JSON.parse(input)`）。
- **typeValueExpr** — 用于替换的类型值。

### 示例

```javascript
// @nudo:replace a T.number
const x = a + b;
// 只有 `a` 被替换；`b` 正常求值
```

```javascript
// @nudo:replace res.data T.array(T.object({ id: T.number }))
const items = res.data;
```

```javascript
// @nudo:replace JSON.parse(input) T.object({ name: T.string })
const data = JSON.parse(input);
```

可以叠加多个替换：

```javascript
// @nudo:replace a T.number
// @nudo:replace b T.string
const result = a + b;
```

**注意：** 每个 `@nudo:replace` 只影响紧跟的下一条语句。

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
| `@nudo:env` | `name1, name2`（文件级 `///`） | 声明运行时环境 API |
| `@nudo:mock-module` | `"module" from "path"`（文件级 `///`） | 替换导入的模块为 mock |
| `@nudo:as` | `typeValueExpr`（行注释 `//`） | 覆盖下一条语句的值类型 |
| `@nudo:replace` | `targetExpr typeValueExpr`（行注释 `//`） | 替换下一条语句中子表达式的类型 |
