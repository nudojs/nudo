---
sidebar_position: 4
description: 按主题浏览 Nudo 推断的实用示例——函数与对象、字符串、循环与范围、联合类型、校验函数与运行时环境。
---

# 示例

本指南展示 Nudo 类型推断的实用示例，按主题分组。每个示例包含带指令的输入代码和推断出的类型。

下方所有输出块都是对上面代码真实运行 `nudo infer` 的结果。输出块只展示 **case 头与 `Combined:` 行**——它们是逐调用点的真实精度。完整输出里的 `intension:` / `abs:` 行是用 `unknown` 形参重估的泛化签名，对多分支函数只会显示回退路径的结果；分支级精度请以 case 头与 `Combined:` 为准。当调用点路径更精确时示例使用调用点（`call@L…`）形态，否则使用 `@nudo:case` 指令。

> 仓库内 CI 自验证的示例套件在 [`docs/examples/`](https://github.com/nudojs/nudo/blob/main/docs/examples/README.md)：其中每条命令与承诺的退出码都由 `pnpm run verify:examples` 校验，并有逐示例的输出钉对照文档声称的输出行。本指南按主题浏览同一引擎；仓库套件是真值门禁。

---

## 基础推断

### 1. 带字面量与符号 case 的基本函数

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

```text
=== subtract ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: number
```

具体 case 保留其字面量结果（`2`、`-9`），符号 case `(T.number, T.number)` 产生 `number`。合并类型是所有 case 结果的并集，并按吸收律化简——字面量被基类型 `number` 吸收，得到 `number`。

---

### 2. 带类型收窄的对象操作

属性访问。Nudo 通过对象形状推断类型，字符串拼接保留字面量结构。

```javascript
function greet(user) {
  return user.name + " is " + user.age;
}
greet({ name: "Alice", age: 30 });
```

**推断输出：**

```text
=== greet ===

Case "call@L4": ({ name: "Alice", age: 30 }) => "Alice is 30"
```

Nudo 用具体形状求值该调用：`user.name` 与 `user.age` 解析为字面量值，`+` 拼接产生精确结果 `"Alice is 30"`——而不是被拍平的 `string`。

目前参数解构不会拆开实参形状——同样的函数体与调用写成 `function greet({ name, age })` 会返回 `number | string`（解构出的字段以 `unknown` 到达，`+` 因而拓宽为其普通 JS 语义的结果），因此要获得形状级精度，属性访问是可靠写法。

spread 形状合并是配置对象的主力工具——右侧槽位覆盖同名左侧槽位，其余槽位取并集，每个调用点保留自己的字面量：

```js
function mixin(base, ext) {
  return { ...base, ...ext };
}
mixin({ host: "localhost", port: 8080 }, { port: 3000, debug: true });
mixin({ id: 1 }, { name: "ada" });
```

```text
=== mixin ===

Case "call@L4": ({ host: "localhost", port: 8080 }, { port: 3000, debug: true }) => { host: "localhost", port: 3000, debug: true }
Case "call@L5": ({ id: 1 }, { name: "ada" }) => { id: 1, name: "ada" }

Combined: { host: "localhost", port: 3000, debug: true } | { id: 1, name: "ada" }
```

字面量 key 的索引投影会精确取出对应槽位——对扮演 "env" 角色的对象同样精确：

```js
function pick(obj, key) {
  return obj[key];
}
pick({ a: 1, b: "x" }, "a");
const env = { PATH: "/usr/bin", HOME: "/root" };
pick(env, "PATH");
```

```text
=== pick ===

Case "call@L4": ({ a: 1, b: "x" }, "a") => 1
Case "call@L6": ({ PATH: "/usr/bin", HOME: "/root" }, "PATH") => "/usr/bin"

Combined: 1 | "/usr/bin"
```

符号 key（`T.string`）无法选定槽位，退化为 `unknown`——仓库示例（CI 钉住）：[`docs/examples/algebra/e-index-proj.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/algebra/e-index-proj.js)。spread meet 钉在 [`docs/examples/algebra/d-mixin-meet.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/algebra/d-mixin-meet.js)；`--dts` 投影（单一拓宽签名、字面量并返回）由[示例矩阵](https://github.com/nudojs/nudo/blob/main/docs/examples/README.md)的 `a-spread-optional.js --dts` 行钉住——生成的 `a-spread-optional.d.ts` 即真值输出。

---

### 3. 使用 map 的数组处理

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

```text
=== doubleAll ===

Case "concrete": ([1, 2, 3]) => [2, 4, 6]
Case "symbolic": (number[]) => number[]

Combined: [2, 4, 6] | number[]
```

Nudo 通过 `map` 跟踪元素类型。具体输入 `[1, 2, 3]` 被逐元素求值为 `[2, 4, 6]`，符号输入 `T.array(T.number)` 产生 `number[]`。仓库示例（CI 钉住）：[`docs/examples/algebra/b-hof-map.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/algebra/b-hof-map.js)。

`reduce` 同样精确——字面量数组经累加器逐元素折叠，符号数组经累加器不动点（`acc ⊔ (acc + A)`）收敛：

```javascript
/**
 * @nudo:case "literal" ([1, 2, 3, 4, 5])
 * @nudo:case "symbolic" (T.array(T.number))
 */
function sum(numbers) {
  return numbers.reduce((acc, n) => acc + n, 0);
}
```

```text
=== sum ===

Case "literal": ([1, 2, 3, 4, 5]) => 15
Case "symbolic": (number[]) => number

Combined: number
```

数组方法支持并不均匀——依赖某个方法前先查这条边界。`forEach` 回调的副作用**不会写回**（被回调闭包捕获的累加器停留在初值），`some` / `every` 返回 `unknown`：

```js
function forEachSum(arr) {
  let s = 0;
  arr.forEach((x) => { s = s + x; });
  return s;
}
forEachSum([1, 2, 3, 4, 5]);    // → 0 —— s = s + x 的写回从未落地

function someBig(arr) {
  return arr.some((x) => x > 3);
}
someBig([1, 2, 3, 4, 5]);       // → unknown
```

请改用 `map` / `reduce`（以及 `filter → map → reduce` 链，逐级保留字面量精度）。仓库示例（CI 钉住）：[`docs/examples/algebra/c-reduce-sum.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/algebra/c-reduce-sum.js)、[`docs/examples/algebra/h-array-boundary.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/algebra/h-array-boundary.js)。

---

## 异步调用与错误

### 4. 带 mock fetch 的异步函数

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

```text
=== fetchUser ===

Case "user": (1) => Promise<{ id: 1, name: "Alice" }>
```

mock 就位后，Nudo 推断 `fetchUser` 返回 `Promise<{ id: 1, name: "Alice" }>`，无需真实网络请求。内联 mock 有两条硬性规则：表达式**必须单行**（多行会被截断并报 `nudo:mock-invalid`）；mock body 内**不可用 `T.*`**——只能写普通 JavaScript 值和闭包。`stub().resolves(...)` helper 只在纯数据上等价：字面量槽位保留（`stub().resolves({ ok: true, id: 1 })` → `Promise<{ ok: true, id: 1 }>`），但 resolved 值里的**闭包槽位不被桥接**——`json` 到达时无 body（`json: () => ?`），于是 `res.json()` 求值为 `unknown`，本示例退化为 `Promise<unknown>`。mock 结果要被调用时，用上面的箭头函数形态。仓库示例（CI 钉住）：[`docs/examples/algebra/f-async-eff.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/algebra/f-async-eff.js)——其中 `@nudo:mock` 是**必填**而非可选：没有它，B 路径会执行真实 `fetch` 并以 `ERR_INVALID_URL` 崩溃。

---

### 5. 带 throws 追踪的错误处理

会抛出的函数。Nudo 同时追踪正常返回类型和抛出类型。

```javascript
/**
 * @nudo:case "valid" (10)
 * @nudo:case "negative" (-1)
 */
function half(x) {
  if (x < 0) {
    throw new RangeError("negative input");
  }
  return x / 2;
}
```

**推断输出：**

```text
=== half ===

Case "valid": (10) => 5
Case "negative": (-1) => never throws RangeError

Combined: 5
```

Nudo 建模控制流：`valid` case 返回 `5`，`negative` case 抛出 `RangeError` 且永不返回——其结果为 `never`，同时追踪抛出的值。合并后的值类型为 `5`。像这样静态可判定的 throw 不会产生额外诊断——`never throws RangeError` 就是全部信息。只有**条件性** throw（抛出分支由 unknown 条件守卫，如示例 15）才会为对应 case 追加报告 `nudo-may-throw`。

---

## 字符串与模板

### 6. 模板字符串 — Nudo vs TypeScript

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
function buildApiUrl(host, path) {
  return "https://" + host + path;
}
buildApiUrl("api.example.com", "/users");   // → "https://api.example.com/users"
```

字面量前缀与具体调用实参折叠为精确的 URL。前缀/后缀/包含检查在调用点对字面量接收者同样折叠：

```javascript
function checkUrl(url) {
  return url.startsWith("https://");
}
checkUrl("https://api.example.com/users");
```

**推断输出：**

```text
=== checkUrl ===

Case "call@L4": ("https://api.example.com/users") => true
```

`startsWith`、`endsWith` 与 `includes` 在调用点对字面量接收者折叠为确定的布尔值（同一函数体在 `@nudo:case` 指令下会泛化为 `unknown`）。并非所有方法都已建模——`"a,b,c".split(",")` 与 `"hello".indexOf("l")` 在两条路径上都会求值为 `unknown`（见示例 7）。

---

### 7. 精确的字符串方法

Nudo 在编译时对部分字符串方法做字面量求值，产生精确结果。

```javascript
function stringDemo() {
  const upper = "hello".toUpperCase();    // → "HELLO"（TS: string）
  const sliced = "hello".slice(1, 3);     // → "el"（TS: string）
  const len = "hello".length;             // → 5（TS: number）
  return { upper, sliced, len };
}
stringDemo();
```

**推断输出：**

```text
=== stringDemo ===

Case "call@L7": () => { upper: "HELLO", sliced: "el", len: 5 }
```

`toUpperCase`、`slice` 和 `.length` 在调用点折叠为精确字面量，TypeScript 对这些操作只能推断出 `string` 或 `number`。并非所有方法都已建模——`"a,b,c".split(",")` 与 `"hello".indexOf("l")` 目前会求值为 `unknown`，依赖具体方法前请先跑 `nudo infer` 确认。

---

## 循环与范围

### 8. 循环求值

Nudo 可以对具体边界的循环进行求值，在类型层面计算精确结果——这是 TypeScript 完全无法做到的。

```javascript
function sumTo(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum = sum + i;
  }
  return sum;
}
sumTo(5);
```

**推断输出：**

```text
=== sumTo ===

Case "call@L8": (5) => 10
```

输入具体值 `5` 时，Nudo 执行循环并产生精确结果 `10`。输入抽象边界（`T.number`）时循环条件无法判定，结果会拓宽为 `number | string`——即累加器未知时 `+` 的真实 JS 语义。

---

### 9. 范围收窄

比较守卫按调用点收窄输入：每个具体调用只执行与其实参匹配的分支。

```javascript
function pickAdult(age) {
  if (age >= 18) return age;
  return -1;
}
pickAdult(25);
pickAdult(12);
```

**推断输出：**

```text
=== pickAdult ===

Case "call@L5": (25) => 25
Case "call@L6": (12) => -1

Combined: 25 | -1
```

`pickAdult(25)` 走 `age >= 18` 分支返回 `25`；`pickAdult(12)` 落到回退分支返回 `-1`。合并类型保留两个字面量结果。（对抽象 `T.number` 实参，守卫无法分叉，只会报告回退结果 `-1`。）仓库示例（CI 钉住）：[`docs/examples/algebra/g-narrow-subtract.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/algebra/g-narrow-subtract.js)。

---

## 联合类型与安全访问

### 10. 判别联合状态机

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

```text
=== handleState ===

Case "idle": ({ status: "idle" }) => "Waiting..."
Case "loading": ({ status: "loading", requestId: "abc" }) => "Loading abc..."
Case "success": ({ status: "success", data: { name: "test" } }) => "test"
Case "error": ({ status: "error", message: "fail" }) => "fail"

Combined: "Waiting..." | "Loading abc..." | "test" | "fail"
```

Nudo 根据判别字段在每个 `case` 分支内收窄 `state`。`"loading"` case 中 `state.requestId` 是可用的字面量 `"abc"`，模板被完整求值为 `"Loading abc..."`；`"success"` case 中 `state.data.name` 解析为 `"test"`。合并类型保留所有字面量结果。

---

### 11. 可选链与空值合并

可选链与空值合并是求值期运算符。它们目前的精度有限，因此值得精确了解它们实际产生什么。

```javascript
function getTheme(config) {
  return config.user?.profile?.settings?.theme ?? "light";
}
getTheme({ user: { profile: { name: "Alice", settings: { theme: "dark" } } } });
getTheme({ user: { profile: { name: "Bob" } } });
```

**推断输出：**

```text
=== getTheme ===

Case "call@L4": ({ user: { profile: { name: "Alice", settings: { theme: "dark" } } } }) => string
Case "call@L5": ({ user: { profile: { name: "Bob" } } }) => unknown

Combined: unknown
```

完整路径存在时链式解析成功，`?? "light"` 得到 `string`；链式短路时结果退化为 `unknown`。组合类型是 `unknown`——基类型 `unknown` 成员吸收了 `string`。已知属性上的浅层 `??` 更精确：

```javascript
function getPort(config) {
  const port = config.port ?? 3000;
  return port;
}
getPort({ port: 8080 });   // → number
```

深层 `?.` 链目前给不出精确的**报告结果**：短路调用上回退字面量存活在内部 Abs 里（`abs: unknown | "light"  #exact`），但 case 结果退化为 `unknown` 并被 `Combined:` 吸收。请用 `nudo infer` 验证你自己的链式写法。

---

### 12. API 响应校验

处理不同状态码的 API 响应。Nudo 在每个调用点根据状态检查收窄响应形状。

```javascript
function parseResponse(response) {
  if (response.status === 200) {
    return { success: true, user: response.data };
  }
  return { success: false, error: response.error };
}
parseResponse({ status: 200, data: { id: 1, name: "Alice", email: "alice@example.com" } });
parseResponse({ status: 404, error: "Not found" });
```

**推断输出：**

```text
=== parseResponse ===

Case "call@L7": ({ status: 200, data: { id: 1, name: "Alice", email: "alice@example.com" } }) => { success: true, user: { id: 1, name: "Alice", email: "alice@example.com" } }
Case "call@L8": ({ status: 404, error: "Not found" }) => { success: false, error: "Not found" }

Combined: { success: true, user: { id: 1, name: "Alice", email: "alice@example.com" } } | { success: false, error: "Not found" }
```

`status === 200` 检查按调用点收窄：success 调用走 `if` 分支，`response.data` 完整可用；404 调用落到错误分支。合并类型是两个具体形状的并集。

---

## 校验函数

### 13. 表单数据处理

带多个 `return` 分支的顺序校验检查。Nudo 在每个调用点精确求值转换操作，并报告与具体输入匹配的分支。

```javascript
function validateForm(data) {
  const age = Number(data.age);
  if (isNaN(age)) return { valid: false, error: "Invalid age" };
  if (!data.email) return { valid: false, error: "Missing email" };
  return { valid: true, name: data.name, age, email: data.email };
}
validateForm({ name: "Alice", age: "25", email: "alice@example.com" });
validateForm({ name: "Bob", age: "abc", email: "bob@example.com" });
validateForm({ name: "Charlie" });
```

**推断输出：**

```text
=== validateForm ===

Case "call@L7": ({ name: "Alice", age: "25", email: "alice@example.com" }) => { valid: true, name: "Alice", age: 25, email: "alice@example.com" }
Case "call@L8": ({ name: "Bob", age: "abc", email: "bob@example.com" }) => { valid: false, error: "Invalid age" }
Case "call@L9": ({ name: "Charlie" }) => { valid: true, name: "Charlie", age: number, email: unknown }

Combined: { valid: true, name: "Alice", age: 25, email: "alice@example.com" } | { valid: false, error: "Invalid age" } | { valid: true, name: "Charlie", age: number, email: unknown }
```

转换被精确求值：`Number("25")` 折叠为 `25`，合法路径胜出；`Number("abc")` 折叠为 `NaN`，`isNaN` 守卫返回 `"Invalid age"` 错误。缺失属性是已知局限：`missing` 输入上的 `data.email` 解析为 `unknown`（而不是 `undefined`），因此 `!data.email` 不是确定的 `true`，报告的是回退分支而不是 `"Missing email"`。

---

### 14. 类型守卫函数

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

```text
=== isString ===

Case "string": ("hello") => true
Case "number": (42) => false
Case "object": ({ type: "user", name: "Alice" }) => false

Combined: true | false
```

Nudo 在类型层面对每个字面量输入求值 `typeof`。`"hello"` 的 `typeof` 是 `"string"`，比较结果为 `true`。数字和对象产生 `false`。合并类型是并集 `true | false`。

---

## 运行时环境

### 15. Web 环境 — fetch、localStorage、URL

用 `@nudo:env web` 加载 Web 全局对象的内置类型定义。对网络代码而言环境类型目前仍很浅，要获得精确响应形状仍需 `@nudo:mock` 覆盖。

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

```text
=== fetchUser ===

Case "get user": (1) => never throws unknown
Case "symbolic": (number) => never throws unknown

Combined: never

Diagnostics:

  [warning] env.js:7:0 Cannot resolve 'ok' on unknown value (nudo:unknown-recv)
  [warning] env.js:7:0 Cannot resolve 'status' on unknown value (nudo:unknown-recv)
  [warning] env.js:7:0 Function "fetchUser" case "get user" may throw: unknown. Consider adding a try-catch block or using @nudo:refine return <constraint> (nudo-may-throw)
```

`fetch` 由环境绑定，但其响应类型是 `unknown`——成员访问报告 `nudo:unknown-recv`，两个 case 都以 `never throws unknown` 告终。要获得精确响应形状，请使用 `@nudo:mock fetch = ...` 覆盖且**不要**同时写 `@nudo:env web`（示例 4 推断出 `Promise<{ id: 1, name: "Alice" }>`）；两者组合目前会把 mock 退化为 `unknown`。

非网络全局对象表现相同：

```javascript
/// @nudo:env web

function savePreference(key, value) {
  localStorage.setItem(key, value);
  return localStorage.getItem(key);
}
savePreference("theme", "dark");
```

**推断输出：** `unknown`——`localStorage` 作为带类型的全局对象存在，但其方法目前返回 `unknown` 而非 `string | null`。

---

### 16. Node.js 环境 — fs、path、crypto

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

```text
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

**推断输出：**

```text
=== hashContent ===

Case "hash": ("hello world") => unknown

Diagnostics:

  [warning] env.js:10:2 Cannot resolve 'update' on unknown value (nudo:unknown-recv)
  [warning] env.js:11:9 Cannot resolve 'digest' on unknown value (nudo:unknown-recv)
```

`node:crypto` 尚未建模：`createHash` 解析为 `unknown`，方法调用报告 `nudo:unknown-recv`。node 环境中可靠的部分是上面的 fs/path 示例。

---

## 本指南用到的指令

| 指令           | 出现于 | 用途                                       |
|----------------|--------|--------------------------------------------|
| `@nudo:case`   | 1、3、4、5、6、10、14、15、16 | 提供具体或符号化的输入样本 |
| `@nudo:mock`   | 4 | 用单行纯 JS mock 替换全局对象              |
| `@nudo:env`    | 15、16 | 加载内置环境类型（web / node）             |

完整指令集——`@nudo:refine` 契约、`@nudo:pure`、`@nudo:skip`、`@nudo:sample`、`@nudo:mock-module` 等——见 [指令](../concepts/directives.md)。

关于类型值（`T.number`、`T.object` 等）和抽象解释的更多内容，请参阅 [Type Values](../concepts/type-values.md) 和 [Abstract Interpretation](../concepts/abstract-interpretation.md)。
