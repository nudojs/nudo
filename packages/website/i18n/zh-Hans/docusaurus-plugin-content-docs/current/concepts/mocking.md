---
description: 求值期间模拟外部依赖——@nudo:mock 五种形式（箭头函数、stub 帮助函数、构造器、from 模块）、单行规则与 B-path 注意事项。
---

# 模拟外部依赖

`@nudo:mock` 在求值期间用 mock 替换外部依赖。用于 `fetch`、文件系统 API 或 Nudo 无法直接执行的其他代码。（模块级替换见 [@nudo:mock-module](./directives.md#nudo--模块级-mock)。）

## 语法

支持五种形式。**每个内联表达式必须写在一行内**——见下方警告。

**1. 单行箭头函数。** 函数体是普通 JavaScript；参数接收 Abs 值：

```text
@nudo:mock name = (arg) => body
```

**2. Mock 帮助函数** — `stub()`、`spy()`、`mock()`，可链式 `.returns(...)`、`.resolves(...)`、`.rejects(...)`、`.withArgs(...)`、`.callsFake(...)`：

```text
@nudo:mock name = stub().returns(value)
```

**3. Sinon 风格等价物** — `sinon.stub()` / `sinon.spy()`，链式相同：

```text
@nudo:mock name = sinon.stub().returns(value)
```

**4. 约束构造器表达式**（或具体值）：

```text
@nudo:mock name = number()
@nudo:mock retries = 3
```

**5. 从模块** — 模块必须定义与被 mock 名称相同的绑定：

```text
@nudo:mock name from "path"
```

- **name** — 要 mock 的标识符（如 `fetch`、`fs`）。
- **path** — 提供 mock 的模块路径。

**警告：表达式必须单行。** 解析器只读到行尾，多行表达式会在第一行截断并报 `nudo:mock-invalid`。下面这种写法**不**生效：

```text
@nudo:mock fetch = (url) => ({ ok: true,
  json: () => ({ id: 1 })
})
```

截断行的真实诊断：

```text
[warning] example.js:0:0 Mock expression "(url) => ({ ok: true," could not be parsed as a known pattern (nudo:mock-invalid)
[warning] example.js:10:9 Cannot resolve 'json' on unknown value (nudo:unknown-recv)
```

**警告：箭头函数 mock 体内不能调用构造器。** 约束构造器只存在于指令类型表达式（case 参数、`@nudo:skip`、`@nudo:as`……）中。mock 体内写普通 JavaScript——普通对象与闭包——或改用 `stub().returns(...)` / `stub().resolves(...)` 帮助函数。

**警告：未 mock 的全局量会在 B 路径上真实执行。** 对 B-hosted 文件（无顶层 `this.` 的源码默认路径），当没有 mock 绑定该名称时，转译代码会调用真实的 Node 运行时全局量。内建量如 `fetch` 因此会拿抽象值当 URL 并让运行崩溃（`ERR_INVALID_URL`，exit `1`），而不是求值为 `unknown`。把你分析代码调用的每个全局量都 mock 掉：`@nudo:mock fetch = (url) => ({ ok: true, json: () => ({ ... }) })`。

## 示例

用箭头函数 mock `fetch`。函数体是单行普通 JavaScript：

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

debug "user": (1) => promise<{ id: 1, name: "Alice" }>
```

解析 promise 的 mock 帮助函数——`stub().resolves(value)` 让每次调用返回 `promise<value>`：

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

**这里结果不同：** 被 resolve 对象的闭包槽不会桥接——`json` 到达时没有函数体（`json: () => ?`），所以 `res.json()` 求值为 `unknown`，本示例推断出 `promise<unknown>`（abs `promise<unknown> #partial`），而不是箭头 mock 的 `promise<{ id: 1, name: "Alice" }>`。`resolves` 对纯数据保持全精度（`stub().resolves({ ok: true, id: 1 })` → `promise<{ ok: true, id: 1 }>`）；当 mock 结果还要被调用时，用箭头函数形式。同步帮助函数：

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

```text
=== readPort ===

debug "default": () => 8080
```

约束构造器表达式直接把名称绑定到抽象域：

```javascript
/**
 * @nudo:mock retries = number()
 * @nudo:case "plan" ()
 */
function plan() {
  return retries + 1;
}
```

**推断输出：**

```text
=== plan ===

debug "plan": () => number
```

从模块——模块必须定义与被 mock 名称相同的绑定：

```javascript
/**
 * @nudo:mock fs from "./mocks/fs.js"
 * @nudo:case "read" (string())
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

```text
=== readConfig ===

debug "read": (string) => unknown

[warning] read-config.js:6:9 Built-in API "fs" is not covered by Nudo's type inference (nudo:builtin-unknown)
```

**当前局限：** `from` mock 尚未种入 B 路径——而生产分析是 Abs 原生的（没有第二套求值 IR），所以该 mock 目前在所有地方都被丢弃：名称求值为未知全局量（`nudo:builtin-unknown`），对真实 Node 全局量则直接触达裸调用。上面的单行箭头函数形式可用；在 `from` 种入 B 路径之前请优先使用它。
