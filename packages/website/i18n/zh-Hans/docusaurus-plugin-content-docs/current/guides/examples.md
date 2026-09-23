---
description: Nudo 实用示例 —— 调用点观察、侧车契约、字符串、循环、联合、env/mock —— 附真实 check/test 输出。
---

# 示例

**读完你能带走：** Nudo 如何观察真实调用点、侧车契约如何门禁义务，以及哪些仍会退化为 `unknown`。

**产品路径优先。** 观察是 `nudo check` 签名（调用点是证据）。契约是 `*.nudo.js` / `@nudo:refine`。`@nudo:case` 仅是**调试见证** —— 可选，不是契约产品。

下方每个输出块都摘录自对上面代码的真实引擎运行（`nudo check` / `nudo test` 头部行与 assertions 摘要按标注省略）。仓库内 CI 钉住的套件在 [`docs/examples/`](https://github.com/nudojs/nudo/blob/main/docs/examples/README.md)（`pnpm run verify:examples`）；本指南按主题浏览同一引擎。

在 [Playground](/playground) 试跑任意示例。

---

## 调用点与契约（产品路径）

### 1. 调用点减法 —— Day 0 观察

普通 JS + 调用点。无注解。`nudo check` 打印签名；调用点提供证据。

```javascript
export function subtract(a, b) {
  return a - b;
}

subtract(5, 3);
subtract(1, 10);
```

```bash
npx nudojs check subtract.js
```

```text
nudo check  subtract.js
OK
  0 error · 0 warning · 0 info · 1 fn

signatures
  subtract(a: any, b: any) => number

(no issues)
```

无约束入口参数显示为 **`any`**。有更丰富的调用证据（或侧车）时，Abs 会保留字面量与代数 —— 跑 `nudo check --abs` 或在 IDE 打开该文件。

可选调试用例报告（`nudo test` —— 门禁不要求）：

```text
=== subtract ===
  call@L5  (5, 3) => 2
  call@L6  (1, 10) => -9
```

### 2. 侧车契约 —— Day 1 义务

```javascript
// pricing.js
export function lineTotal(price, qty) {
  return price * qty;
}

lineTotal(12, 3);
lineTotal(0, 2);
```

```javascript
// pricing.nudo.js —— 契约（同样是普通 JS）
import { number, fn } from "@nudojs/core";

export const lineTotal = fn(
  { price: number().gt(0), qty: number().ge(1) },
  number().gt(0)
);
```

```bash
npx nudojs check pricing.js
```

```text
nudo check  pricing.js
FAILED
  1 error · 0 warning · 0 info · 1 fn

signatures
  lineTotal(price: number, qty: number) => number

issues
  [ERROR L6 lineTotal] lineTotal[price]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   0  #exact
      expected: price > 0
      → use a value satisfying price > 0, or relax the precondition on price
```

`if` 守卫**不是**精化。义务来自侧车 / `@nudo:refine`。见[契约](./contract.md)与 [nudo check](./check.md)。

### 3. 来自调用点的对象 shape

```javascript
function greet(user) {
  return user.name + " is " + user.age;
}
greet({ name: "Alice", age: 30 });
```

```text
=== greet ===
  call@L4  ({ name: "Alice", age: 30 }) => "Alice is 30"
```

拼接保留字面量结果 `"Alice is 30"` —— 不是被拍平的 `string`。参数解构同样拆开实参形状：

```js verify
function addP({ x, y }) { return x + y; }
addP({ x: 1, y: 2 });
```

```text
=== addP ===
  call@L2  ({ x: 1, y: 2 }) => 3
```

spread 合并 shape：

```js
function mixin(base, ext) {
  return { ...base, ...ext };
}
mixin({ host: "localhost", port: 8080 }, { port: 3000, debug: true });
```

```text
=== mixin ===
  call@L9  ({ host: "localhost", port: 8080 }, { port: 3000, debug: true }) => { host: "localhost", port: 3000, debug: true }
```

---

## 字符串与模板

### 4. 模板字符串 —— 超越声明类型

```javascript
export function coupon(code) {
  return `SAVE-${code.toUpperCase()}`;
}

coupon("vip");
```

```text
=== coupon ===
  call@L5  ("vip") => "SAVE-VIP"
```

TypeScript 通常把它拓宽为 `string`。Nudo 在调用点观察到具体的模板结果。对照[为什么选 Nudo](../why-nudo.md) 的表格与首页「超越声明类型」一节。

### 5. 精确的字符串方法

`toUpperCase`、`toLowerCase`、`slice`、`.length` 与 `split`（字面量接收者）在调用点路径上产生精确结果：`"a,b,c".split(",")` 折叠为 `["a", "b", "c"]`。完整精确/退化地图见[语言语义](../concepts/semantics.md)。

---

## 循环与范围

### 6. 具体边界的循环

```javascript
function sumTo(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += i;
  return sum;
}
sumTo(5);
```

```text
=== sumTo ===
  call@L6  (5) => 10
```

边界具体时循环求和保持字面量 —— 同一套 Abs 代数支撑 `nudo check`。

### 7. 范围收窄

路径谓词在分支内窄化 Abs（`x > 5` → term 上的范围 pred）。详见[控制流收窄](../concepts/control-flow-narrowing.md)。

---

## 联合与安全访问

### 8. `typeof` 判别

```javascript
export function transform(x) {
  if (typeof x === "string") return x.toUpperCase();
  if (typeof x === "number") return x + 1;
  return null;
}

transform("hi");
transform(41);
transform(null);
```

每个调用点保留自己的精确臂（`"HI"`、`42`、`null`）。符号 `unknown` 条件目前会合并分支 —— 见[语义](../concepts/control-flow-narrowing.md)。

### 9. 可选链

已知形状的接收者在任意深度折叠（`a.b.c ?? 5` 传 `{ b: {} }` → `5`）；无约束（`any`）接收者上结果保持 `any` 并带 `throws TypeError`（引擎债 `unknown` 不适用 —— 见[控制流收窄](../concepts/control-flow-narrowing.md)）。

---

## 运行时环境与 mock

### 10. 通过 `@nudo:env web` 使用 Web API

```javascript
/// @nudo:env web
```

内置 `es` / `web` / `node` env 模块为常见 API 提供类型；第三方 `@types` 在分析期自动补洞。见[依赖类型](./env-harvest.md)。**Env/harvest 不是 mock 的替代品**（尤其原生运行时回调）—— 见[边界](../concepts/limits.md)。

### 11. Mock 外部依赖

```javascript
// @nudo:mock fetch = (url) => ({ ok: true, json: () => ({ id: 1 }) })
```

优先使用单行箭头函数 mock。完整语法：[指令 —— mock](../concepts/directives.md#nudo--mock-外部依赖)。

---

## 调试见证（可选，不是产品）

`@nudo:case` 为 `nudo test` / LSP 用例切换注入场景输入。它**不**创建 CI 义务。

```javascript
/**
 * @nudo:case "double digits" (10)
 */
export function scale(x) {
  return x + 1;
}
```

```text
=== scale ===
  debug "double digits"  (10) => 11
```

优先使用具体值或约束构建器（`number()`、`lit(42)`）。仅已声明 case 上的断言（`=> expected`）影响 `nudo test` 退出码 —— 合成 `call@` / `entry@` 绝不会让运行失败。

---

## 下一步去哪里

| 主题 | 页面 |
|-------|------|
| 契约草稿 / 接受 / emit | [契约](./contract.md) |
| CI 门禁 + 诊断码 | [nudo check](./check.md) · [诊断](../reference/diagnostics.md) |
| 哪些会退化为 `unknown` | [语言语义](../concepts/semantics.md) |
| Abs 代数 | [Abs](../concepts/type-values.md) |
| Recipes（CI、monorepo、export） | [Recipes](./recipes.md) |

| 指令 | 在本指南中的角色 |
|-----------|-------------------|
| 调用点 | Day 0 证据（主要） |
| `*.nudo.js` / `@nudo:refine` | Day 1 契约（主要） |
| `@nudo:env` / `@nudo:mock` | 环境与边界 |
| `@nudo:case` | 仅可选调试见证 |
