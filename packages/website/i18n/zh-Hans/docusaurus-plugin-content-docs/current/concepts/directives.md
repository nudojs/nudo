---
description: "全部 @nudo: 指令（case、mock、pure、skip、sample、refine、import、env、mock-module、as、replace）的语法、约束与示例完整参考。"
---

# 指令系统

指令是控制 Nudo 如何分析代码的结构化注释。它们使用 `@nudo:` 命名空间以避免与 JSDoc 和其他工具冲突。将指令放在函数上方的块注释中。

**契约产品**（精化义务）主路径在侧车文件——`*.nudo.js` 模块自动绑定源码同名导出，`@nudo:refine` 是其源码内形态（`@nudo:interface` 是精确别名）。见 [@nudo:refine](#nudorefine--refinement-contract) 与 [`nudo contract`](../guides/contract.md) 命令。

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

函数级指令（`@nudo:case`、`@nudo:mock`、`@nudo:pure`、`@nudo:skip`、`@nudo:sample`）也接受紧贴函数上方的单行 `// @nudo:…` 注释：

```javascript
// @nudo:mock fetch = (url) => ({ ok: true, json: () => ({ id: 1 }) })
// @nudo:case "user" (1)
async function fetchUser(id) {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
}
```

两种形态解析完全一致——尤其是 mock 表达式的单行规则对两者都适用（见 [@nudo:mock](./mocking.md)）。当 `//` 前缀的指令可能被误读为被注释掉的代码时，优先使用块注释形态。

---

## @nudo:case — 调试见证

case 是 **debug 见证**：Nudo 为场景执行而使用的具体输入。它不是契约产品——精化契约住在 `*.nudo.js` 侧车 / `@nudo:refine`（见 [@nudo:refine](#nudorefine--refinement-contract)）。`@nudo:case` 仍支持 `nudo test` 断言与 LSP 场景切换。case 实参使用具体值或约束构建器。

提供具名执行用例。每个用例定义**具体**输入，供 Nudo 调试场景执行函数时使用。

### 语法

```text
@nudo:case "name" (arg1, arg2, ...)
@nudo:case "name" (arg1, arg2) => expected
```

- **name** — 用例的字符串标识符（如 `"double digits"`）。
- **args** — 逗号分隔的**具体**参数（`5`、`"hello"`、`{…}`）。
- **expected**（可选）— `=>` 之后的类型表达式（具体字面量或约束构建器，与 args 同一文法），由 `nudo test` 对推断结果断言。

### 示例

```javascript verify
/**
 * @nudo:case "positive numbers" (5, 3)
 * @nudo:case "negative result" (1, 10)
 */
function subtract(a, b) {
  return a - b;
}
```

```javascript
/**
 * @nudo:case "strings" ("hello")
 * @nudo:case "numbers" (42)
 * @nudo:case "array" ([1, 2, 3])
 */
function process(x) {
  if (typeof x === "string") return x.length;
  if (typeof x === "number") return x * 2;
  return x.length;
}
```

带有预期结果：

```javascript verify
/**
 * @nudo:case "basic" ("hello") => 5
 * @nudo:case "empty" ("") => 0
 */
function lengthOf(s) {
  return s.length;
}
```

## @nudo:mock — Mock 外部依赖

在求值期间将外部依赖替换为 mock 实现——`fetch`、文件系统 API 或其他 Nudo 无法直接执行的代码。完整语法（五种形式）、单行规则、B-path 注意事项与可运行示例：[模拟外部依赖](./mocking.md)。

---

## @nudo:pure — 标记纯函数

将函数标记为纯函数。Abs `fn` 值携带纯标记，求值器**按实参 Abs 记忆化调用结果**（同实参命中缓存）。仅用于无副作用函数；加不加指令分析结果都正确。

### 语法

```text
@nudo:pure
```

### 示例

```javascript
/**
 * @nudo:pure
 * @nudo:case "add" (number(), number())
 */
function add(a, b) {
  return a + b;
}
```

---

## @nudo:skip — 跳过求值

跳过函数体的抽象解释：引擎不求值它，所以被跳过的函数不会产生引擎债（`nudo:unknown-inference`）噪声。没有返回类型表达式时，函数报告为 `skipped (no return type declared)`，且 `nudo check` 把它的返回值打印为 `any`（无约束——不是保留给推导失败的 `unknown`）；在指令后添加约束构造器表达式即可声明返回类型。

### 语法

```text
@nudo:skip
@nudo:skip returnsExpr
```

- **returnsExpr**（可选）— 用作返回类型的类型值表达式。

### 范围

- **不求值函数体。** 声明的类型（或 `any`）成为签名返回值；被跳过的函数体不参与入口 may-throw（L2）求值。
- **形参义务保留。** `@nudo:refine` 前置条件仍会门禁调用点，形参展示仍来自手写契约——对带 `@nudo:refine x positive` 的被跳过函数 `needsPositive`，`nudo check` 报告 `needsPositive(x: number) => any`。
- **返回契约仍被检查。** `@nudo:refine return positive` 之下的 `@nudo:skip lit(0)` 会报告 `nudo:constraint-violated`。

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

**推断输出（`nudo test`）：**

```text
=== heavyComputation ===
  skipped (no return type declared)
```

```javascript
/**
 * @nudo:skip number()
 */
function unannotatedHeavy(x) {
  // 通过指令显式指定返回类型
  return expensiveOp(x);
}
```

**推断输出（`nudo test`）：**

```text
=== unannotatedHeavy ===
  skipped (declared): number
```

---

## @nudo:sample — 循环采样（保留，无效果）

`@nudo:sample` 已被解析但没有消费者——analyzer 会丢弃它（`service/src/analyzer.ts` 中的 `void sampleDirective`）。它不会改变循环求值：循环本就通过有界展开（`DEFAULT_MAX_LOOP_ITERS = 8`）终止，不存在可切换的不动点阶段。该指令为源码兼容而被接受，但对输出无任何影响；不要依赖它在精度与性能之间权衡。

### 语法

```text
@nudo:sample N
```

- **N** — 正整数。分析时被忽略。

---

## @nudo:refine — 精化契约 {#nudorefine--refinement-contract}

把精化契约挂到参数或返回值。约束以 Pred 进入 Abs，**参与代数**（`x>0` ⇒ `x+1>1`），不只是调用点挡板。

`@nudo:interface` 是 `@nudo:refine` 的**精确别名**（解析为同一源码内精化）。**产品名**是 **contract**（侧车 `*.nudo.js` / `@nudo:refine`）；部分诊断码仍保留历史 `interface` 词元（`nudo:interface-param-mismatch` 等）。

### 主路径：侧车自动绑定

推荐形态把契约写在源码旁的侧车文件里：`<file>.nudo.js`（对应 `.js`/`.mjs`）或 `<file>.nudo.ts`（对应 `.ts`/`.mts`）。每个 `export const <name> = fn({ ... }, ...)` **自动绑定**源码中同名本地 named export——源码零注解：

```javascript
// calc.js
export function addTax(x) {
  return x + 1;
}

export function greet(name) {
  return name;
}
```

```javascript
// std.nudo.js — 共享约束模板
import { number } from "@nudojs/core";

export const positive = number().gt(0);
```

```javascript
// calc.nudo.js — 侧车契约
import { fn, lit, number, string, union } from "@nudojs/core";
import { positive } from "./std.nudo.js";

export const addTax = fn({ x: positive.shift(1) }, number());
export const greet = fn({ name: union(lit("ada"), lit("bob")) }, string());
```

```bash
$ nudo contract calc.js
calc.js
  addTax  [handwritten]  (x: number().gt(1)) → number()
  greet  [handwritten]  (name: union(lit("ada"), lit("bob"))) → string()
```

侧车是真实 JS 模块：可从 `@nudojs/core` 引入构建器、经相对 import 从**其它侧车**引入约束。加载失败、import 成环、不识别导出形态都是 **error**（`nudo:interface-load`、`nudo:interface-cycle`），不再静默回落。

**构建器**（`@nudojs/core`，裸包名同样注入）：

| 构建器 | 含义 | 示例 |
|---------|------|------|
| `number()` / `string()` / `boolean()` | 原始类型域 | `number()` |
| `shape({ id: number() })` | 对象形状（字段递归） | `shape({ id: number().gt(0) })` |
| `array(c)` | 数组元素约束 | `array(string())` |
| `lit(v)` | 字面量域 | `lit(42)` / `lit("ada")` / `lit(true)` |
| `union(...cs)` | 域之并 | `union(lit(42), lit("a"))` |
| `fn(params, returns?, { throws? })` | 一等函数接口 | `fn({ x: number() }, number())` |
| `.gt(n)` `.ge(n)` `.lt(n)` `.le(n)` `.int()` | 数值界（链式） | `number().gt(0).int()` |
| `.min(n)` `.max(n)` | 长度界——`length(s)` pred（字符串/数组） | `string().min(1)` |
| `.length(n)` | 长度等值界（`length(s) = n`） | `string().length(3)` |
| `.shift(n)` | 每个常数界整体 `+n` 平移 | `positive.shift(1)` |
| `and(...cs)` | 标量合取（顶层函数，不是链式方法） | `and(positive, number().lt(10))` |
| `partial(c)` / `pick(c, keys)` / `omit(c, keys)` | 形状工具 | `partial(user)` |

`shift` 只对数值标量链合法（每个界的右端是字面量），否则 throw。`partial`/`pick`/`omit` 接受 `shape(...)` 约束。

**自动绑定规则：**

- 只绑定源码文件**同名本地 named export**（`export function` / `export const`）。re-export、`export default`、CJS 不参与。
- `node_modules/` 下的侧车永不自动加载。
- 源码注解与侧车对同参的约束**合取**；矛盾合取（如 `x > 0` ∧ `x < 0`）报 `nudo:interface-conflict`。
- 合并序：手写（源码注解 ∪ 侧车绑定）> 生成段 > 隐式推导。`nudo contract` 按层标注（`[handwritten]` / `[generated]` / `[implicit]`）。

### 源码内形态

```text
@nudo:refine <param> <constraint>
@nudo:refine return <constraint>
@nudo:interface <param> <constraint>   // 别名
```

- **param** — 参数名，或字面量 `return` 表示后置
- **constraint** — 来自 `*.nudo.js` 的导出名，经 `/// @nudo:import` 引入

### 示例

```javascript
/// @nudo:import { positive, delay } from "./shapes.nudo.js"

/**
 * @nudo:refine x positive
 * @nudo:refine return positive
 */
function inc(x) {
  return x + 1;
}

/**
 * @nudo:refine ms delay
 */
function setDelay(ms) {
  if (ms > 0) return ms;
  return 0;
}

setDelay(0);   // error: 0 ⊭ delay
setDelay(100); // ok
```

无需 `interface` 的 object 形状：

```javascript
// shapes.nudo.js
export const user = shape({
  id: number().gt(0),
  name: string(),
});

/**
 * @nudo:refine u user
 */
function register(u) {
  return `${u.id}:${u.name}`;
}
```

---

## @nudo:import — 约束模板引入

为 `@nudo:refine` 从 `*.nudo.js` 模块引入约束模板。**文件级**指令，三斜线注释。

### 语法

```text
/// @nudo:import { name1, name2 } from "./shapes.nudo.js"
/// @nudo:import * as ns from "./shapes.nudo.js"
```

- **具名** — 绑定 `@nudo:refine` 使用的导出模板名
- **命名空间** — `@nudo:import * as ns from "…"` 展开为 `@nudo:refine` 中的 `ns.exportName` 引用

### 示例

```javascript
/// @nudo:import { positive } from "./shapes.nudo.js"

/**
 * @nudo:refine x positive
 */
function inc(x) {
  return x + 1;
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
- 除内置名称外，还可以指向一个 TypeScript 文件：`/// @nudo:env ./nudo-env.ts`。该文件必须导出 `defineEnv()` 函数，返回 `{ globals, modules? }` 类型定义（与 Nudo 内置环境相同的形状）。

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
 * @nudo:case "test" (number())
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
 * @nudo:case "test" (string())
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

模块 mock 逐文件用 `@nudo:mock-module` 声明——不存在项目级 mock 配置。

---

## @nudo:as — 类型断言

覆盖下一条语句的值类型。类似 TypeScript 的 `as` 关键字，但以行注释的形式放在语句上方。在 B 路径上作用于被覆盖语句的 `VariableDeclaration` 初始化值与 `ReturnStatement` 返回值。

### 语法

```text
// @nudo:as typeValueExpr
```

### 示例

```javascript
// @nudo:as shape({ port: number(), host: string() })
const config = JSON.parse(content);
// config 现在是 { port: number, host: string } 而不是 unknown
```

```javascript
// @nudo:as array(shape({ id: number(), name: string() }))
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
// @nudo:replace a number()
const x = a + b;
// 只有 `a` 被替换；`b` 正常求值
```

```javascript
// @nudo:replace res.data array(shape({ id: number() }))
const items = res.data;
```

```javascript
// @nudo:replace JSON.parse(input) shape({ name: string() })
const data = JSON.parse(input);
```

可以叠加多个替换：

```javascript
// @nudo:replace a number()
// @nudo:replace b string()
const result = a + b;
```

**注意：** 每个 `@nudo:replace` 只影响紧跟的下一条语句。

---

## 汇总表

| 指令 | 语法 | 用途 |
|-----------|--------|---------|
| `@nudo:case` | `"name" (args...)` 或 `"name" (args) => type` | 调试 / `nudo test` 见证（不是契约产品） |
| `@nudo:mock` | `name = expr` 或 `name from "path"` | Mock 外部依赖 |
| `@nudo:pure` | （无参数） | 标记纯函数 —— 求值器按实参记忆化调用结果 |
| `@nudo:skip` | `[returnsExpr]` | 跳过求值，使用已有类型信息 |
| `@nudo:sample` | `N` | 保留的无效果指令（已解析，未消费） |
| `@nudo:refine` / `@nudo:interface` | `param constraint` / `return constraint` | 源码内精化契约（别名对；主路径是 `*.nudo.js` 侧车自动绑定） |
| `@nudo:import` | `{ name } from "spec"`（文件级 `///`） | 为 `@nudo:refine` 引入 `*.nudo.js` 约束模板 |
| `@nudo:env` | `name1, name2`（文件级 `///`） | 声明运行时环境 API |
| `@nudo:mock-module` | `"module" from "path"`（文件级 `///`） | 替换导入的模块为 mock |
| `@nudo:as` | `typeValueExpr`（行注释 `//`） | 覆盖下一条语句的值类型 |
| `@nudo:replace` | `targetExpr typeValueExpr`（行注释 `//`） | 替换下一条语句中子表达式的类型 |
