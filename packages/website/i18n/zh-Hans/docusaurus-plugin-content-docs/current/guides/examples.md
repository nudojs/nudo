---
sidebar_position: 4
---

# 示例

本指南展示 Nudo 类型推断的实用示例。每个示例包含带指令的输入代码和推断出的类型。

---

## 1. 带字面量与符号 case 的基本函数

一个函数具有多个 case：具体值和符号类型值。Nudo 会合并结果。

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

**推断输出：**

```
=== subtract ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: 2 | -9 | number
```

具体 case 保留字面量结果（`2`、`-9`），符号 case `(T.number, T.number)` 产生 `number`。合并类型是所有 case 结果的并集。

---

## 2. 带类型收窄的对象操作

解构和属性访问。Nudo 通过对象形状推断类型。

```javascript
/**
 * @nudo:case "concrete" ({ name: "Alice", age: 30 })
 * @nudo:case "symbolic" (T.object({ name: T.string, age: T.number }))
 */
function greet({ name, age }) {
  return `Hello, ${name}! You are ${age} years old.`;
}
```

**推断输出：**

```
=== greet ===

Case "concrete": ({ name: "Alice", age: 30 }) => "Hello, Alice! You are 30 years old."
Case "symbolic": ({ name: string, age: number }) => `Hello, ${string}! You are ${number} years old.`

Combined: "Hello, Alice! You are 30 years old." | `Hello, ${string}! You are ${number} years old.`
```

Nudo 从每个 case 的对象形状收窄 `name` 和 `age`。模板结果不会被拍平为 `string`：具体 case 得到完整求值的字面量，符号 case 保留带插值参数类型的模板类型。

---

## 3. 使用 map 的数组处理

数组和高阶函数。Nudo 通过 `map` 和 `filter` 跟踪元素类型。

```javascript
/**
 * @nudo:case "concrete" ([1, 2, 3])
 * @nudo:case "symbolic" (T.array(T.number))
 */
function doubleAll(arr) {
  return arr.map((x) => x * 2);
}
```

**推断输出：**

```
=== doubleAll ===

Case "concrete": ([1, 2, 3]) => [2, 4, 6]
Case "symbolic": (number[]) => number[]

Combined: [2, 4, 6] | number[]
```

Nudo 通过 `map` 跟踪元素类型。具体输入 `[1, 2, 3]` 被逐元素求值为 `[2, 4, 6]`，符号输入 `T.array(T.number)` 产生 `number[]`。

---

## 4. 带 mock fetch 的异步函数

异步函数和外部 API。使用 `@nudo:mock` 将 `fetch`（或其他全局对象）替换为 body 为普通 JavaScript 的 mock，且必须写在单行内。

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

mock 就位后，Nudo 推断 `fetchUser` 返回 `Promise<{ id: 1, name: "Alice" }>`，无需真实网络请求。内联 mock 有两条硬性规则：表达式**必须单行**（多行会被截断并报 `nudo:mock-invalid`）；mock body 内**不可用 `T.*`**——只能写普通 JavaScript 值和闭包。要 mock 已决议的 Promise，可用 helper 形式 `@nudo:mock fetch = stub().resolves({ ok: true, json: () => ({ id: 1, name: "Alice" }) })`，推断结果相同。

---

## 5. 带 throws 追踪的错误处理

会抛出的函数。Nudo 同时追踪正常返回类型和抛出类型。

```javascript
/**
 * @nudo:case "valid" (10)
 * @nudo:case "negative" (-1)
 */
function safeSqrt(x) {
  if (x < 0) {
    throw new RangeError("negative input");
  }
  return Math.sqrt(x);
}
```

**推断输出：**

```
=== safeSqrt ===

Case "valid": (10) => number
Case "negative": (-1) => never throws RangeError { message: "negative input" }

Combined: number

Diagnostics:

  [info] safeSqrt.js:6:13 Code after return/throw statement is unreachable (nudo-unreachable)
```

Nudo 建模控制流：`valid` case 返回 `number`，`negative` case 抛出 `RangeError` 且永不返回——其结果为 `never`，同时追踪抛出的值。合并后的值类型为 `number`。当 Nudo 发现问题时会在输出末尾附加 `Diagnostics:` 段；这里是一条关于 `throw` 之后语句的 `[info]` 提示。

---

## 6. 模板字符串 — Nudo vs TypeScript

Nudo 在字符串拼接中保留结构信息，实现 TypeScript 无法达到的精确推断。

```javascript
/**
 * @nudo:case "symbolic" (T.string)
 */
function makeApiUrl(path) {
  return "https://api.example.com" + path;
}
```

**Nudo 推断：** `https://api.example.com${string}`

**TypeScript 推断：** `string`（丢失了已知前缀）

这意味着 Nudo 可以对结果进行推理：

```javascript
/**
 * @nudo:case "symbolic" (T.string)
 */
function isApiUrl(path) {
  const url = "https://api.example.com" + path;
  return url.startsWith("https://");  // → true（从模板前缀推导）
}
```

Nudo 知道结果一定是 `true`，因为模板的前缀以 `"https://"` 开头。TypeScript 只能推断为 `boolean`。

---

## 7. 精确的字符串方法

Nudo 在编译时对字面量执行字符串方法，产生精确结果。

```javascript
/**
 * @nudo:case "test" ()
 */
function stringDemo() {
  const upper = "hello".toUpperCase();    // → "HELLO"（TS: string）
  const parts = "a,b,c".split(",");       // → ["a", "b", "c"]（TS: string[]）
  const idx = "hello".indexOf("l");       // → 2（TS: number）
  const sliced = "hello".slice(1, 3);     // → "el"（TS: string）
  const len = "hello".length;             // → 5（TS: number）
  return { upper, parts, idx, sliced, len };
}
```

每个结果都是精确的字面量类型。TypeScript 对这些操作只能推断出 `string`、`string[]` 或 `number`。

---

## 8. 循环求值

Nudo 可以对具体边界的循环进行求值，在类型层面计算精确结果——这是 TypeScript 完全无法做到的。

```javascript
/**
 * @nudo:case "concrete" (5)
 * @nudo:case "symbolic" (T.number)
 */
function sumTo(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum = sum + i;
  }
  return sum;
}
```

**推断输出：**

```
=== sumTo ===

Case "concrete": (5) => 10
Case "symbolic": (number) => number

Combined: 10 | number
```

输入具体值 `5` 时，Nudo 执行循环并产生精确结果 `10`。输入抽象值 `T.number` 时，通过不动点迭代拓宽为 `number`，合并类型保留两者。

---

## 9. 精化类型 — 范围收窄

精化类型（refined type）在基础类型上附加约束。它们是内置能力：比较守卫会把 `number` 精化为带约束的范围，并保留在推断输出中。

```javascript
/**
 * @nudo:case "symbolic" (T.number)
 */
function pickAdult(age) {
  if (age >= 18) return age;
  return -1;
}
```

**推断输出：**

```
=== pickAdult ===

Case "symbolic": (number) => number (>= 18) | -1
```

在 `if (age >= 18)` 分支内，`age` 不再是普通的 `number`——它携带 `>= 18` 约束，推断结果显示为 `number (>= 18)`。没有匹配规则的运算会回退到精化类型的基础类型。模板字符串（示例 6 中的 `` `https://api.example.com${string}` ``）也是精化类型——它把已知前缀和后缀作为约束携带。

---

## 10. 判别联合状态机

每个状态形状不同的状态机。Nudo 根据判别字段 `status` 收窄联合类型。

```javascript
/**
 * @nudo:case "idle" ({ status: "idle" })
 * @nudo:case "loading" ({ status: "loading", requestId: "abc" })
 * @nudo:case "success" ({ status: "success", data: { name: "test" } })
 * @nudo:case "error" ({ status: "error", message: "fail" })
 */
function handleState(state) {
  switch (state.status) {
    case "idle": return "Waiting...";
    case "loading": return `Loading ${state.requestId}...`;
    case "success": return state.data.name;
    case "error": return state.message;
  }
}
```

**推断输出：**

```
=== handleState ===

Case "idle": ({ status: "idle" }) => "Waiting..."
Case "loading": ({ status: "loading", requestId: "abc" }) => "Loading abc..."
Case "success": ({ status: "success", data: { name: "test" } }) => "test"
Case "error": ({ status: "error", message: "fail" }) => "fail"

Combined: "Waiting..." | "Loading abc..." | "test" | "fail"
```

Nudo 根据判别字段在每个 `case` 分支内收窄 `state`。`"loading"` case 中 `state.requestId` 是可用的字面量 `"abc"`，模板被完整求值为 `"Loading abc..."`；`"success"` case 中 `state.data.name` 解析为 `"test"`。合并类型保留所有字面量结果。

---

## 11. 可选链与空值合并

通过可选链进行安全属性访问，用空值合并提供回退。Nudo 追踪每个分支中哪些属性存在。

```javascript
/**
 * @nudo:case "full" ({ user: { profile: { name: "Alice", settings: { theme: "dark" } } } })
 * @nudo:case "partial" ({ user: { profile: { name: "Bob" } } })
 * @nudo:case "empty" ({})
 */
function getTheme(config) {
  return config.user?.profile?.settings?.theme ?? "light";
}
```

**推断输出：**

```
=== getTheme ===

Case "full": ({ user: { profile: { name: "Alice", settings: { theme: "dark" } } } }) => "dark"
Case "partial": ({ user: { profile: { name: "Bob" } } }) => "light"
Case "empty": ({}) => "light"

Combined: "dark" | "light"
```

完整路径存在时，Nudo 返回字面量 `"dark"`。`settings` 或 `user` 缺失时，`??` 回退产生 `"light"`。合并类型是字面量结果的并集。

---

## 12. API 响应校验

处理不同状态码的 API 响应。Nudo 根据状态检查收窄响应形状。

```javascript
/**
 * @nudo:case "success" ({ status: 200, data: { id: 1, name: "Alice", email: "alice@example.com" } })
 * @nudo:case "not-found" ({ status: 404, error: "Not found" })
 * @nudo:case "error" ({ status: 500, error: "Server error" })
 */
function parseResponse(response) {
  if (response.status === 200) {
    return { success: true, user: response.data };
  }
  return { success: false, error: response.error };
}
```

**推断输出：**

```
=== parseResponse ===

Case "success": ({ status: 200, data: { id: 1, name: "Alice", email: "alice@example.com" } }) => { success: true, user: { id: 1, name: "Alice", email: "alice@example.com" } }
Case "not-found": ({ status: 404, error: "Not found" }) => { success: false, error: "Not found" }
Case "error": ({ status: 500, error: "Server error" }) => { success: false, error: "Server error" }

Combined: { success: true, user: { id: 1, name: "Alice", email: "alice@example.com" } } | { success: false, error: "Not found" } | { success: false, error: "Server error" }

Diagnostics:

  [info] parseResponse.js:10:2 Code after return/throw statement is unreachable (nudo-unreachable)
```

`status === 200` 检查收窄响应：`if` 分支内 `response.data` 可用；分支外 `response.error` 已知存在。每个 case 返回完全具体的对象，合并类型是三个形状的并集。

---

## 13. 表单数据处理

带多个 `return` 分支的顺序校验检查。Nudo 精确求值转换操作，并将各分支结果报告为并集。

```javascript
/**
 * @nudo:case "valid" ({ name: "Alice", age: "25", email: "alice@example.com" })
 * @nudo:case "invalid-age" ({ name: "Bob", age: "abc", email: "bob@example.com" })
 * @nudo:case "missing" ({ name: "Charlie" })
 */
function validateForm(data) {
  const age = Number(data.age);
  if (isNaN(age)) return { valid: false, error: "Invalid age" };
  if (!data.email) return { valid: false, error: "Missing email" };
  return { valid: true, name: data.name, age, email: data.email };
}
```

**推断输出：**

```
=== validateForm ===

Case "valid": ({ name: "Alice", age: "25", email: "alice@example.com" }) => { valid: false, error: "Invalid age" } | { valid: true, name: "Alice", age: 25, email: "alice@example.com" }
Case "invalid-age": ({ name: "Bob", age: "abc", email: "bob@example.com" }) => { valid: false, error: "Invalid age" } | { valid: true, name: "Bob", age: NaN, email: "bob@example.com" }
Case "missing": ({ name: "Charlie" }) => { valid: false, error: "Invalid age" } | { valid: false, error: "Missing email" }

Combined: { valid: false, error: "Invalid age" } | { valid: true, name: "Alice", age: 25, email: "alice@example.com" } | { valid: false, error: "Invalid age" } | { valid: true, name: "Bob", age: NaN, email: "bob@example.com" } | { valid: false, error: "Invalid age" } | { valid: false, error: "Missing email" }

Diagnostics:

  [info] validateForm.js:9:19 Code after return/throw statement is unreachable (nudo-unreachable)
```

`Number(...)` 转换被精确求值——`Number("25")` 产生字面量 `25`，`Number("abc")` 产生 `NaN`。`isNaN(age)` 这类守卫不参与控制流收窄，因此每个 case 的结果是所有 `return` 分支的并集；你仍可以从并集中读出每个分支的精确值。

---

## 14. 类型守卫函数

返回类型充当类型守卫的函数。Nudo 为每个输入 case 推断布尔结果。

```javascript
/**
 * @nudo:case "string" ("hello")
 * @nudo:case "number" (42)
 * @nudo:case "object" ({ type: "user", name: "Alice" })
 */
function isString(value) {
  return typeof value === "string";
}
```

**推断输出：**

```
=== isString ===

Case "string": ("hello") => true
Case "number": (42) => false
Case "object": ({ type: "user", name: "Alice" }) => false

Combined: true | false
```

Nudo 在类型层面对每个字面量输入求值 `typeof`。`"hello"` 的 `typeof` 是 `"string"`，比较结果为 `true`。数字和对象产生 `false`。合并类型是并集 `true | false`。

---

## 15. Web 环境 — fetch、localStorage、URL

使用 `@nudo:env web` 获取 Web API 的内置类型定义。标准浏览器全局对象无需手动 mock。

```javascript
/// @nudo:env web

/**
 * @nudo:case "get user" (1)
 * @nudo:case "symbolic" (T.number)
 */
async function fetchUser(id) {
  const res = await fetch(`/api/users/${id}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}
```

**推断输出：**

```
=== fetchUser ===

Case "get user": (1) => Promise<unknown>
Case "symbolic": (number) => Promise<unknown>

Combined: Promise<unknown>
```

有了内置 Web 环境，无需 mock：`fetch` 的类型来自环境定义，`res.json()` 返回 `Promise<unknown>`，因此 `fetchUser` 推断为 `Promise<unknown>`。要得到精确的响应形状，可将 `@nudo:env web` 与 `@nudo:mock fetch = ...` 覆盖结合使用（见示例 4）。

```javascript
/// @nudo:env web

/**
 * @nudo:case "save" ("theme", "dark")
 */
function savePreference(key, value) {
  localStorage.setItem(key, value);
  return localStorage.getItem(key);
}
```

**推断输出：** `string | null` — Nudo 知道 `localStorage.getItem` 返回 `string | null`。

---

## 16. Node.js 环境 — fs、path、crypto

使用 `@nudo:env node` 获取 Node.js 全局对象和模块的内置类型定义。

```javascript
/// @nudo:env node

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * @nudo:case "test" (T.string)
 */
function loadConfig(dir) {
  const filePath = join(dir, "config.json");
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf-8");
  return JSON.parse(content);
}
```

**推断输出：**

```
=== loadConfig ===

Case "test": (string) => unknown
```

`JSON.parse` 返回 `unknown`（提前的 `return null` 会并入其中）。`@nudo:env node` 为 `readFileSync`、`existsSync` 和 `join` 提供类型，因此无需任何 mock。

```javascript
/// @nudo:env node

import { createHash } from "node:crypto";

/**
 * @nudo:case "hash" ("hello world")
 */
function hashContent(data) {
  const hash = createHash("sha256");
  hash.update(data);
  return hash.digest("hex");
}
```

**推断输出：** `string | Buffer` — 来自 `digest` 的返回类型。CLI 输出中 `Buffer` 会展开为完整的方法形状（`Buffer { toString: (_arg0: string) => string, … }`）。

---

## 所用指令小结

| 指令            | 用途                                         |
|-----------------|----------------------------------------------|
| `@nudo:case`    | 提供具体或符号化的输入样本                   |
| `@nudo:mock`    | 用类型值 mock 替换全局对象/模块              |
| `@nudo:pure`    | 标记纯函数以便缓存                           |
| `@nudo:skip`    | 跳过求值；使用声明的返回类型                 |
| `@nudo:sample`  | 控制循环采样次数                             |
| `@nudo:returns` | 断言期望的返回类型                           |
| `@nudo:env`     | 声明运行时环境（web、node、es）              |
| `@nudo:mock-module` | 替换导入的模块为 mock 文件              |

关于类型值（`T.number`、`T.object` 等）和抽象解释的更多内容，请参阅 [Type Values](/docs/concepts/type-values) 和 [Abstract Interpretation](/docs/concepts/abstract-interpretation)。
