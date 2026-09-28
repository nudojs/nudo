---
description: Nudo 实用示例 —— 调用点观察、侧车契约、字符串、循环、联合、env/mock —— 附真实 check/test 输出。
---

# 示例

**读完你能带走：** Nudo 如何观察真实调用点、侧车契约如何门禁义务，以及哪些仍会退化为 `unknown`。

**产品路径优先。** 观察是 `nudo check` 签名（调用点是证据）。契约是 `*.nudo.js` / `@nudo:contract`。`@nudo:case` 仅是**调试见证** —— 可选，不是契约产品。

下方每个输出块都摘录自对上面代码的真实引擎运行（`nudo check` / `nudo test` 头部行与 assertions 摘要按标注省略）。仓库内 CI 钉住的套件在 [`docs/examples/`](https://github.com/nudojs/nudo/blob/main/docs/examples/README.md)（`pnpm run verify:examples`）；本指南按主题浏览同一引擎。

套件的主题目录一览（退出码是命令矩阵钉住的期望 —— 负例行**故意**非零退出，报出的行才是演示内容）：

| 主题目录 | 演示什么 | 代表文件 | 期望 exit code |
|---|---|---|---|
| [`constraints/`](https://github.com/nudojs/nudo/tree/main/docs/examples/constraints) | `@nudo:contract` × Pred：标量 / 形状 / 返回精化；`if` 不是精化 | [`set-delay.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/constraints/set-delay.js) · [`register.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/constraints/register.js) · [`return-contract.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/constraints/return-contract.js) | 负例 `1` · register / `test:cli` 为 `0` |
| [`structure/`](https://github.com/nudojs/nudo/tree/main/docs/examples/structure) | Abs `leq`：赋值 / 传参结构（宽度子类型） | [`assign.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/structure/assign.js) · [`arg-structure.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/structure/arg-structure.js) | `1`（两行均为负例） |
| [`vs-ts/`](https://github.com/nudojs/nudo/tree/main/docs/examples/vs-ts) | 同一逻辑与 TypeScript 并排对照 | [`constraints/nudo.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/vs-ts/constraints/nudo.js) · [`constraints/tsc.ts`](https://github.com/nudojs/nudo/blob/main/docs/examples/vs-ts/constraints/tsc.ts) · [`structure/nudo.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/vs-ts/structure/nudo.js) | nudo `1` · tsc `0` / `2` |
| [`mini-repo/`](https://github.com/nudojs/nudo/tree/main/docs/examples/mini-repo) | 多文件集成（ESM + class + async） | [`user-service.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/mini-repo/user-service.js) · [`store.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/mini-repo/store.js) · [`validators.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/mini-repo/validators.js) | user-service `check` `1`（L2）· 其余 `0` |
| [`algebra/`](https://github.com/nudojs/nudo/tree/main/docs/examples/algebra) | 类型即计算（spread / HOF / reduce / mixin） | [`0-add-intensional.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/algebra/0-add-intensional.js) · [`b-hof-map.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/algebra/b-hof-map.js) · [`c-reduce-sum.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/algebra/c-reduce-sum.js) | `0` |
| [`interface-derivation/`](https://github.com/nudojs/nudo/tree/main/docs/examples/interface-derivation) | 契约分层推导（手写根 → 生成下游行） | [`lib.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/interface-derivation/lib.js) · [`lib.nudo.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/interface-derivation/lib.nudo.js) · [`add.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/interface-derivation/add.js) | `0` |
| [`interface-draft/`](https://github.com/nudojs/nudo/tree/main/docs/examples/interface-draft) | 代码优先：从逻辑生成可审阅契约草稿 | [`greet.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/interface-draft/greet.js) · [`README.md`](https://github.com/nudojs/nudo/blob/main/docs/examples/interface-draft/README.md) | `0`（`contract --draft`） |
| [`migrate/`](https://github.com/nudojs/nudo/tree/main/docs/examples/migrate) | 退役 tsc 样板包（单向 before/after 门） | [`before/src/math.ts`](https://github.com/nudojs/nudo/blob/main/docs/examples/migrate/before/src/math.ts) · [`after/src/math.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/migrate/after/src/math.js) · [`before/package.json`](https://github.com/nudojs/nudo/blob/main/docs/examples/migrate/before/package.json) | `0`（status / strip / verify / retire） |
| [`errors/`](https://github.com/nudojs/nudo/tree/main/docs/examples/errors) | Top-10 错误面孔（Nudo 真实输出） | [`01-constraint-gt.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/errors/01-constraint-gt.js) · [`04-entry-throws.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/errors/04-entry-throws.js) · [`10-fix-path.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/errors/10-fix-path.js) | `1`（全部十例） |
| [`retire-real/`](https://github.com/nudojs/nudo/tree/main/docs/examples/retire-real) | 真实包 `ms` 的 tsc 退役案例（非合成夹具） | [`before/src/age.ts`](https://github.com/nudojs/nudo/blob/main/docs/examples/retire-real/before/src/age.ts) · [`after/src/age.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/retire-real/after/src/age.js) | `0` |
| [`retire-debug/`](https://github.com/nudojs/nudo/tree/main/docs/examples/retire-debug) | 真实包 `debug` 的 tsc 退役案例（visionmedia/debug） | [`before/src/logger.ts`](https://github.com/nudojs/nudo/blob/main/docs/examples/retire-debug/before/src/logger.ts) · [`after/src/logger.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/retire-debug/after/src/logger.js) | `0` |

根目录的 [`l2-export-any.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/l2-export-any.js) 在目录之外钉住 L2 export-`any` 门禁：`check` 退出 `1`，`--ignore-throws TypeError` 退出 `0`。一条命令验证整个矩阵：`pnpm run verify:examples`。

在 [Playground](/playground) 试跑任意示例。

---

## 调用点与契约（产品路径）

### 1. 调用点减法 —— 观察层观察

普通 JS + 调用点。无注解。`nudo check` 打印签名；调用点提供证据。

```javascript verify
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

### 2. 侧车契约 —— 契约层义务

```javascript verify
// pricing.js
export function lineTotal(price, qty) {
  return price * qty;
}

lineTotal(12, 3);
lineTotal(0, 2);
```

```javascript verify-sidecar
// pricing.nudo.js — contract (also plain JS)
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

`if` 守卫**不是**契约。义务来自侧车 / `@nudo:contract`。见[契约](./contract.md)与 [nudo check](./check.md)。

### 3. 来自调用点的对象 shape

```javascript verify
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

```js verify
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

```javascript verify
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

```javascript verify
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

```javascript verify
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

```javascript verify
/// @nudo:env web
```

内置 `es` / `web` / `node` env 模块为常见 API 提供类型；第三方 `@types` 在分析期自动补洞。见[依赖类型](./env-harvest.md)。**Env/harvest 不是 mock 的替代品**（尤其原生运行时回调）—— 见[边界](../concepts/limits.md)。

### 11. Mock 外部依赖

```javascript verify
// @nudo:mock fetch = (url) => ({ ok: true, json: () => ({ id: 1 }) })
```

优先使用单行箭头函数 mock。完整语法：[指令 —— mock](../concepts/directives.md#nudo--mock-外部依赖)。

---

## 调试见证（可选，不是产品）

`@nudo:case` 为 `nudo test` / LSP 用例切换注入场景输入。它**不**创建 CI 义务。

```javascript verify
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
| Abs 代数 | [Abs](../concepts/abs.md) |
| Recipes（CI、monorepo、export） | [Recipes](./recipes.md) |

| 指令 | 在本指南中的角色 |
|-----------|-------------------|
| 调用点 | 观察层证据（主要） |
| `*.nudo.js` / `@nudo:contract` | 契约层契约（主要） |
| `@nudo:env` / `@nudo:mock` | 环境与边界 |
| `@nudo:case` | 仅可选调试见证 |
