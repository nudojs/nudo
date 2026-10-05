---
slug: /guides/errors-vs-typescript
description: 十个真实错误场景、同一份代码 —— tsc 报什么（或静默）、Nudo 报什么（值 + 谓词）、以及修复路径。可运行、CI 钉住。
---

# 错误信息对照：Nudo vs tsc

业务代码出错那天的十个真实场景。同一份源码过两道门：每个场景对照 `tsc` 报什么（常常什么都不报）、`nudo check` 报什么 —— 一个**值和一条谓词**（`actual` / `expected`）—— 以及一键修复路径。Nudo 在这里的口号不是「报得更多」，是**「报得更真、带证据、带下一步」**。

## 本页怎么跑

下面的代码块全部可执行。文档管线把 `verify` 块按页序拼成一个 `errors-vs-typescript.js`，把 `verify-sidecar` 块拼成同名旁挂的 `errors-vs-typescript.nudo.js` —— 其中的 `fn()` 绑定按同名自动绑到源函数。这也是为什么十个场景的顶层名字互不重复、sidecar 的构建器导入只在第一个块出现一次。

一条命令重放整个目录 —— 下面是那次真实运行的头部与签名：

```bash
npx nudojs check errors-vs-typescript.js
```

```text
nudo check  errors-vs-typescript.js
FAILED
  12 error · 0 warning · 0 info · 10 fn

signatures
  setDelay(ms: number) => number
  greet(u: { id: number, name: string }) => string
  getName(user: any) => any  throws TypeError
  bad() => 0
  inc(x: any) => number | string  throws TypeError
  incPositive(x: number) => number
  tag(s: string) => string
  arm(ms: number) => number
  bump(x: number) => number
  cooldown(ms: number) => number
```

每个场景的 `text` 块就是这次运行针对该场景打印的 `issues` 条目原文 —— 本页没有任何编造的输出。

## 1. 数值约束 — `setDelay(0)`

**tsc：**只有你把注解写得更紧才会得到 `Argument of type 'number' is not assignable…` —— 对普通的 `ms: number`，这次调用**静默**。

Nudo 用值和谓词在调用点拦下，`fix:` 行直接给出下一步命令：

```javascript verify
// 1. Numeric bound: tsc's `ms: number` accepts 0; the Pred blocks the call.
export function setDelay(ms) {
  return ms;
}

setDelay(250); // ok
setDelay(0);   // 0 ⊭ ms > 0
```

```javascript verify-sidecar
// errors-vs-typescript.nudo.js — import preamble for every sidecar block below
import { fn, number, shape, string } from "@nudojs/core";

export const setDelay = fn({ ms: number().gt(0) }, number());
```

```text
  [ERROR L7 setDelay] setDelay[ms]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   0  #exact
      expected: ms > 0
      → use a value satisfying ms > 0, or relax the precondition on ms
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

## 2. shape 缺字段 — `greet({ id: 2 })`

**tsc：**想报错得先写 `interface User`；具体报不报、报 `Property 'name' is missing` 还是沉默，取决于推断。

字段名就在 `expected` 行里，形状只活在一份 sidecar 中 —— 全程没有 interface 语法：

```javascript verify
// 2. Missing shape field: the contract names the field, no interface needed.
export function greet(u) {
  return "hi " + u.name;
}

greet({ id: 1, name: "Ada" }); // ok
greet({ id: 2 });              // missing field u.name
```

```javascript verify-sidecar
// errors-vs-typescript.nudo.js (continued)
export const greet = fn({ u: shape({ id: number(), name: string() }) }, string());
```

```text
  [ERROR L14 greet] greet[u]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   { id: 2 }  #exact
      expected: missing field u.name
      → add the missing field u.name
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

## 3. 重赋值丢槽 — `config = { host: "y" }`

**tsc：**依赖推断出的对象类型；宽泛的 `any` / index signature 下静默。

左值当前形状与右值并排给出，箭头行点名缺失的槽：

```javascript verify
// 3. Reassignment drops a slot: left shape vs right value, side by side.
export let config = { host: "localhost", port: 8080 };

config = { host: "api", port: 3000 }; // ok
config = { host: "y" };               // missing slot port
```

```text
  [ERROR L19 config] config: assignment ⊭ existing shape  (nudo:assign-mismatch)
      actual:   { host: "y" }  #exact
      expected: { host: "api", port: 3000 }  #exact
      → missing slot port
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

## 4. 入口 may-throw — `user.name`

**tsc：**没有 throws 叙事 —— 什么都不报，运行时才炸。

Nudo 把运行时效果放进签名（`throws TypeError`）并作 L2 门禁 —— 附建议清单（refine / guard / try-catch / `@nudo:throws`）。其他场景的 sidecar 只绑定具名函数，不会波及这里：`getName` 没有契约，无约束入口正是 L2 要抓的：

```javascript verify
// 4. Entry may-throw: unconstrained user — the runtime bomb reaches CI.
export function getName(user) {
  return user.name;
}
```

```text
  [ERROR L21 getName] getName (export): may throw TypeError  (nudo:entry-may-throw)
      actual:   getName(user: any) => any    throws TypeError
      expected: entry total, or @nudo:throws / try-catch
      → property 'name' on any (unconstrained value) → @nudo:throws TypeError / refine / guard / try-catch
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

## 5. 返回契约 — `> 0` 之下 `return 0`

**tsc：**返回 `number` 就放行 —— `0` 合法，绿灯。

前置与返回共用同一套 Pred 语言；这里触发的是同一个 `fn()` 绑定的返回侧：

```javascript verify
// 5. Return contract: declared return > 0, returns 0.
export function bad() {
  return 0;
}

bad();
```

```javascript verify-sidecar
// errors-vs-typescript.nudo.js (continued)
export const bad = fn({}, number().gt(0));
```

```text
  [ERROR bad] bad: return value ⊭ @nudo:contract return number().gt(0)  (nudo:constraint-violated)
      actual:   0  #exact
      expected: return > 0
      → return a value satisfying > 0
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

## 6. 真实 JS `+` — `inc("7")` vs 契约

**tsc：**通常把 `x + 1` 标成 `number` —— 对 `"7"` 那次调用是在说谎 —— 或者强迫你收窄。

无契约：脸保持诚实 —— `inc(x: any) => number | string`（`inc("7")` 是 `"71"`），且 L2 标记这枚强制转换炸弹：无约束 `+` 可能抛 `TypeError`（原生 `Symbol` ToNumeric）。有契约：坏实参在调用点被拦 —— 义务放在哪一侧由你决定：

```javascript verify
// 6. Real JS `+`: no contract = honest number|string; a contract blocks the call.
export function inc(x) {
  return x + 1;
}

export function incPositive(x) {
  return x + 1;
}

inc("7");        // ok → "71"
incPositive(-1); // -1 ⊭ x > 0
```

```javascript verify-sidecar
// errors-vs-typescript.nudo.js (continued)
export const incPositive = fn({ x: number().gt(0) }, number());
```

```text
  [ERROR L31 inc] inc (export): may throw TypeError  (nudo:entry-may-throw)
      actual:   inc(x: any) => number | string    throws TypeError
      expected: entry total, or @nudo:throws / try-catch
      → ToNumeric/ToNumber coercion of abstract operand → @nudo:throws TypeError  |  sidecar: fn({ … }): shape({ <body-read fields> })  |  refine / guard / try-catch
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
  [ERROR L40 incPositive] incPositive[x]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   -1  #exact
      expected: x > 0
      → use a value satisfying x > 0, or relax the precondition on x
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

## 7. 原始类型重赋值 — `n = "str"`

**tsc：**`Type 'string' is not assignable to type 'number'` —— 熟悉，但没有值。

报告里是 **`#exact` 字面量**，不是抽象类型名 —— 槽当前持有 `2`，`"str"` 是肇事值：

```javascript verify
// 7. Primitive reassignment: the report shows the literal, not a type name.
export let n = 1;
n = 2;     // ok
n = "str"; // "str" ⊭ number
```

```text
  [ERROR L44 n] n: assignment ⊭ existing shape  (nudo:assign-mismatch)
      actual:   "str"  #exact
      expected: 2  #exact
      → prim string ⊭ prim number
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

## 8. 长度界 — `tag("")`

**tsc：**`string` 合法；要拦 `""` 得造 `NonEmptyString` 之类的品牌类型。

长度约束是作用在值上的 Pred —— `min(1)` —— 不是新的类型名：

```javascript verify
// 8. Length bound: min(1) is a Pred, not a branded NonEmptyString type.
export function tag(s) {
  return "[" + s + "]";
}

tag("ok"); // ok
tag("");   // "" ⊭ length(s) ≥ 1
```

```javascript verify-sidecar
// errors-vs-typescript.nudo.js (continued)
export const tag = fn({ s: string().min(1) }, string());
```

```text
  [ERROR L51 tag] tag[s]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   ""  #exact
      expected: length(s) ≥ 1
      → use a value whose length is ≥ 1, or relax the precondition on s
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

## 9. 多违例一次给全 — `arm(-1)` + `bump(0)`

**tsc：**同样是几条错，但各是独立的类型名行 —— 嵌套泛型让它们更吵，不是更清楚。

每条 issue 独立，各带自己的 `actual` / `expected` / `fix:` —— 扫列表、按任意顺序并行修。在 GitHub Actions / GitLab 上，注解落在 PR 的精确行上：

```javascript verify
// 9. Several violations, one run: every issue independent, all evidence at once.
export function arm(ms) {
  return ms;
}

export function bump(x) {
  return x + 1;
}

arm(30); // ok
bump(2); // ok
arm(-1); // -1 ⊭ ms > 0
bump(0); // 0 ⊭ x > 0
```

```javascript verify-sidecar
// errors-vs-typescript.nudo.js (continued)
export const arm = fn({ ms: number().gt(0) }, number());
export const bump = fn({ x: number().gt(0) }, number());
```

```text
  [ERROR L63 arm] arm[ms]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   -1  #exact
      expected: ms > 0
      → use a value satisfying ms > 0, or relax the precondition on ms
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
  [ERROR L64 bump] bump[x]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   0  #exact
      expected: x > 0
      → use a value satisfying x > 0, or relax the precondition on x
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

## 10. 修复路径 — `fix: nudo contract --draft`

**tsc：**只说不能这么赋值 —— 改接口还是改调用，自己猜。

每条违例类诊断固定带同一条下一步命令。`nudo contract --draft` 生成可审阅的 sidecar 草稿（`*.nudo.draft.js` —— 绝不自动加载）；接受草稿才产生 L1 义务。绝不静默：

```javascript verify
// 10. Fix path: every violation carries the same next command.
export function cooldown(ms) {
  return ms;
}

cooldown(0); // → fix: nudo contract --draft
```

```javascript verify-sidecar
// errors-vs-typescript.nudo.js (continued)
export const cooldown = fn({ ms: number().gt(0) }, number());
```

```text
  [ERROR L70 cooldown] cooldown[ms]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   0  #exact
      expected: ms > 0
      → use a value satisfying ms > 0, or relax the precondition on ms
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

## 另见

- [错误对照](../guides/error-faces.md) —— 一页五张共有的脸
- [Nudo vs TypeScript](../guides/vs-typescript.md) —— 定位与能力边界
- [诊断词典](../reference/diagnostics.md) —— 全部 `nudo:*` 码与锚点
