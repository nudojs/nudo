---
slug: /guides/contract
description: nudo contract —— 打印 / 草稿 / 固化 / 逆向 TypeScript 为侧车契约。契约层产品面，位于 nudo check 旁。
---

# nudo contract

`nudo contract` 管理**契约表面**（`*.nudo.js` 侧车 + 源码内 `@nudo:contract`）。它不替代 `nudo check` —— check 是 CI 门禁；contract 负责打印、起草与固化义务。

```bash
npx nudojs contract <paths…> [--from paths…]
npx nudojs contract --draft <paths…> [--write] [--fn name] [--json]
npx nudojs contract --emit <paths…> [--fn name] [--all] [--dry-run] [--exit-on-diff]
npx nudojs contract --from-dts <paths…> [--write] [--dry-run]
```

**产品规则：** 手写契约即义务。草稿与 `@generated` 段是可审阅的快照 —— 它们绝不会静默变成 check 错误。

## 分层 {#layers}

| 层 | 来源 | 迁移动作 |
|------|--------|------------------|
| `handwritten` | `*.nudo.js` / `@nudo:contract` | 保留；用 `nudo check` 执法 |
| `generated` | 调用点域固化进 `@generated` | 使用变化时用 `--emit` 刷新 |
| `implicit` | 仅推断 —— 展示用 | 草稿候选 |

打印示例 —— 尚无任何契约时，`contract` 以 implicit 层展示它观察到的域（`lineTotal  [implicit]  (qty: 3 | 2, price: 4.5 | 10) → 13.5 | 20`）。侧车被接受后，同一命令打印 `[handwritten]` 与已接受的绑定。

```bash
npx nudojs contract src/lib.js
```

## 观察层 → 草稿（逻辑优先）

```bash
npx nudojs contract --draft src/lib.js
npx nudojs contract --draft --write src/lib.js --fn lineTotal
```

输出落在 `src/lib.nudo.draft.js` —— **不会** ambient 加载。将审阅过的行拷入 `src/lib.nudo.js`。

草稿里每个槽位都带**证据标签**，标明约束的来源：

| 证据 | 来源 | 落进草稿的内容 |
|----------|---------------------|------------------------|
| `callsite` | 真实调用点观测到的实参 —— 文件内，或经 `--from <paths…>` 从使用处文件注入 | `fn({ … })` 行里一条**加宽后**的约束；原始观测保留为 `/* observed … */` 注释 |
| `directive` | 函数上声明的 `@nudo:case` 见证 | 与 `callsite` 同一条投影路径 —— 二者合称最佳起点 |
| `body` | 实现读取的字段（`user.name`） | 仅一条注释建议（`shape({ name: /* TODO */ })`）—— 绝不进 DSL 义务 |
| `symbolic` | 泛化返回 shape（`generalizeFromAst`） | 返回槽注释；返回类型手工补 |
| *（省略）* | 完全无证据 | 槽位不写入 `fn({})`，留 TODO 注释 |

**不变式 —— 草稿永不发明 check 义务。** 只有 `callsite` / `directive` 证据会投影进 DSL，且投影前先加宽（`lit(3)` + `lit(2)` → `number()`），单次演示调用绝无可能固化成硬契约。`body` 读取与 `symbolic` 返回停留在注释层（C0：禁止从 body AST 扫描发明义务）。从未被调用的导出，其返回槽可能打印 `/* observed: string() — confirm before accepting */` —— 那是供你确认的求值事实，不是义务。手写契约永不被覆盖：已在 `*.nudo.js` 绑定的函数会列为 `[handwritten] skipped`。

人工审阅把 `number()` 收紧为 `number().gt(0)` 等。只有被接受的侧车才是 L1。

[Playground 草稿故事](/playground) · 示例：[`docs/examples/interface-draft/`](https://github.com/nudojs/nudo/tree/main/docs/examples/interface-draft)

## 完整一圈：草稿 → 收紧 → 接受 → 门禁

在一个小模块上走完整个 Day 1 闭环。从纯 JS 起步 —— 零注解。（尚无契约时，`nudo check` 展示的是 Day 0 面 —— `greet(user: any) => string  throws TypeError`，L2 入口 may-throw，因为 `.name` 读自无约束参数；完整故事见 [nudo check](./check.md#l2--entry-throws)。）

```javascript verify
export function lineTotal(qty, price) {
  return qty * price;
}

export function greet(user) {
  return `Hello, ${user.name}`;
}

export function tag(label) {
  return `[${label}]`;
}

lineTotal(3, 4.5);
lineTotal(2, 10);
```

**1. 从证据起草。** `--draft --write` 把可审阅草稿落盘（`Draft written → src/lib.nudo.draft.js`）；草稿模块内联展示每个证据标签 —— 头部从略，其内容重申该文件不是侧车、并重申证据策略：

```text
import { fn, number, shape } from "@nudojs/core";

// lineTotal — param: callsite, return: callsite
//   qty: number()  /* observed: union(lit(2), lit(3)) */
//   price: number()  /* observed: union(lit(4.5), lit(10)) */
export const lineTotal = fn({ qty: number(), price: number() }, number());

// greet — param: body, return: symbolic
//   user: /* body-read { name } — fill types when accepting */
//   suggested (body-read, not a contract): greet = fn({ user: shape({ name: /* TODO */ }) })
//   returns: /* symbolic: string — greet: (user: A1) => string */
export const greet = fn({});

// tag — param: none, return: body
//   label: /* no evidence — tighten */
//   returns: /* observed: string() — confirm before accepting */
export const tag = fn({});
```

拿[证据表](#观察层--草稿逻辑优先)对照这三个函数：`lineTotal` 有真实调用点，参数与返回都被投影（加宽）。`greet` 从未被调用 —— 只有 body-read 建议与符号返回，DSL 因此保持 `fn({})`。`tag` 完全无证据；连它的观测返回都是*确认后再接受*的注释。

**2. 人工收紧并接受。** 逐行审阅，把你**有意**要求的部分加强，然后把结果拷进 `src/lib.nudo.js` —— 这个拷贝动作就是接受：

```javascript verify-sidecar
// src/lib.nudo.js — accepted after review
export const lineTotal = fn({ qty: number().int().gt(0), price: number().ge(0) }, number());
export const greet = fn({ user: shape({ name: string() }) }, string());
export const tag = fn({ label: string() }, string());
```

审阅在此处做的改变：`qty` 从加宽的 `number()` 收紧为 `number().int().gt(0)`（数量是正整数 —— 草稿无从知晓这一点）；`greet` 的 body-read 建议 `{ name }` 提升为真正的 `shape` 义务，同时消除 L2 throw；`tag` 的无证据槽位由人工填为 `string()`。

**3. 门禁。** 被接受的侧车自动绑定，`check` 转绿 —— 签名展示的是受约束后的面：

```text
nudo check  src/lib.js
OK
  0 error · 0 warning · 0 info · 3 fn

signatures
  lineTotal(qty: number, price: number) => number
  greet(user: { name: string }) => string
  tag(label: string) => string
```

**4. 故意打破。** 违反收紧后 pred 的调用以 `1 error` 让门禁失败（L1）—— 这是你接受的义务，不是草稿发明的：

```javascript verify
lineTotal(-1, 5); // ⊭ qty > 0 → nudo:constraint-violated
```

```text
issues
  [ERROR L16 lineTotal] lineTotal[qty]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   -1  #exact
      expected: qty > 0
      → use a value satisfying qty > 0, or relax the precondition on qty
```

## 契约优先（契约层风格）

先手写侧车，再在同一契约面下实现：

```javascript verify-sidecar
// contract.nudo.js
import { number, fn } from "@nudojs/core";

export const positive = number().gt(0);
export const add2 = fn({ x: number().gt(0) }, number());
```

侧车中的函数绑定**必须**是一等 `fn({ params }, returns?)`。裸的 `number().gt(0)` 是值级模板（供 `@nudo:contract` / 共享槽使用），不是函数导出契约——上面 `positive` 是模板，`add2` 是绑定。

源码内形态：

```javascript verify
/// @nudo:import { positive } from "./contract.nudo.js"
/**
 * @nudo:contract x positive
 */
export function needsPositive(x) {
  return x;
}

needsPositive(-1); // ⊭ x > 0 → nudo:constraint-violated
```

`@nudo:contract` 引用的模板必须用 `@nudo:import` 引入 —— 侧车只自动绑定同名 `fn` 导出。

`@nudo:contract` 是唯一的源内契约指令（历史拼写 `@nudo:refine` / `@nudo:interface` 已移除，没有别名层）。产品名：**contract**。

## 固化生成段

`--emit` 把**观测到的**调用点域固化进侧车 `@generated` 段 —— 关于用法的事实，不是义务。可信用法（演示调用、测试）用它；要执法的 API 面保持手写绑定。一个尚无契约的叶子模块：

```js
export function wrap(text) {
  return `(${text})`;
}

wrap(42);
```

固化观测域（默认模式只刷新已有段；`--fn` / `--all` 创建新段）：

```bash
npx nudojs contract --emit src/tags.js --fn wrap
```

```text
Updated src/tags.js → src/tags.nudo.js
  written: wrap
  re-run `nudo check src/tags.js` to see the persisted contracts in action
```

侧车此刻携带快照 —— 注意它固化的是观测到的*精确*字面量，与草稿的加宽不同：

```javascript verify-sidecar
// @generated by nudo — do not edit; regenerate with `nudo contract --emit`
// source: tags.js:wrap
export const wrap = fn({ text: lit(42) }, lit("(42)"));
```

### 漂移

数周后演示调用变了 —— 如今跑的是 `wrap("hot")` 而不是 `wrap(42)`：

```javascript verify
export function wrap(text) {
  return `(${text})`;
}

wrap("hot");
```

`check` 把已固化段与今日重算的域对比并**警告** —— 调用本身不是错误，因为 `generated` 永不执法：

```text
nudo check  src/tags.js
OK
  0 error · 2 warning · 0 info · 1 fn

signatures
  wrap(text: number) => string

issues
  [WARNING L5 wrap] wrap[text]: persisted @generated segment ≠ today's call-site domain  (nudo:interface-drift)
      → re-run nudo contract --emit to refresh the generated segment, or check the call sites of text
  [WARNING L5 wrap] wrap[return]: persisted @generated segment ≠ today's inferred return  (nudo:interface-drift)
      → re-run nudo contract --emit to refresh the generated segment, or check the return value
```

`nudo:interface-drift` 是 **warning —— 不挡 exit**（上面这次运行退出码为 0）。新用法是有意的就刷新（`nudo contract --emit src/tags.js` 打印同样的 `Updated … written: wrap` 摘要，段变为 `fn({ text: lit("hot") }, lit("(hot)"))`）；证据未变时重跑为 no-op（`src/tags.js: no interface changes`）。

### CI 漂移门禁

要让「本应刷新」在 CI 里可见，把 emit 当作 diff 即失败的 dry-run 跑：

```bash
npx nudojs contract --emit src/tags.js --dry-run --exit-on-diff
```

```text
[dry-run] would update src/tags.js:
--- a/src/tags.nudo.js
+++ b/src/tags.nudo.js
@@ -1,4 +1,4 @@
 // @generated by nudo — do not edit; regenerate with `nudo contract --emit`
 // source: tags.js:wrap
-export const wrap = fn({ text: lit("hot") }, lit("(hot)"));
+export const wrap = fn({ text: lit(7) }, lit("(7)"));

```

命令退出码为 `1` —— 维护者在本地刷新并提交。`--exit-on-diff` 必须搭配 `--emit --dry-run`（裸传 `--exit-on-diff` 是用法错误）；手写绑定始终优先 —— emit 若会覆盖某条绑定，会报 `nudo:interface-name-clash` 并跳过写入。使用处文件可以供证据：`contract --emit src/lib.js --from test/`（见[调用点发现](./callsite-discovery.md)）。

## 逆向 TypeScript 声明（--from-dts）

正在迁出 TypeScript？`--from-dts` 把 `.d.ts` 文件、带注解的 `.ts` / `.mts` 源、目录、或 npm 包的类型逆向成可审阅的 `@nudo:draft` —— 这是 [TypeScript 退役路径](./migrating-from-typescript.md)中的契约步骤。一个小型遗留模块：

```ts
export interface User {
  id: number;
  name: string;
}

export function lineTotal(qty: number, price: number): number {
  return qty * price;
}

export function badge(user: { name: string; admin?: boolean }): string {
  return user.admin ? `[${user.name}]` : user.name;
}

export function findUser(id: number): User {
  return { id, name: "n" };
}
```

```bash
npx nudojs contract --from-dts legacy/pricing.ts
```

```text
// @nudo:draft
// Generated by `nudo contract --from-dts` from pricing.ts
// Sources: pricing.ts
//
// Reverse-engineered from TypeScript declarations — NOT a sidecar contract.
// This file is never loaded for check. Review each export, then copy it
// into <target>.nudo.js to accept (that is when obligations go live).
//
// After accept: strengthen with Pred builders (number().gt(0) …) —
// dts cannot express algebraic implications (x>0 ⇒ x+1>1).

import { fn, number, string, boolean, any, shape } from "@nudojs/core";

// lineTotal — from TypeScript
export const lineTotal = fn({ qty: number(), price: number() }, number());

// badge — from TypeScript
export const badge = fn({ user: shape({ name: string(), admin: boolean().optional() }) }, string());

// findUser — from TypeScript
export const findUser = fn({ id: number() }, any());

// 3 projectable exports · 0 skipped · 1 d.ts
// pass --write to save as pricing.nudo.draft.js; copy into *.nudo.js to enforce
```

诚实地读这份投影：基元、字面量联合、数组与对象字面量映射为构建器；可选字段（`admin?: boolean`）变成 `boolean().optional()`；但 `findUser` 的 `User` 返回退化为 **`any()`** —— 未建模的类型引用，如实标注而非猜测。interface 与 type alias 整体跳过（类型不是运行时契约）。

**`--from-dts` 不执法。** 草稿只打印（或经 `--write` 落为工作目录里的 `pricing.nudo.draft.js` —— `next   review, then copy exports into a *.nudo.js sidecar to accept (not enforced until then)`），永不 ambient 加载。审阅后把接受的导出拷进 `*.nudo.js` 侧车，它们才成为 L1 —— 那也是加强 `.d.ts` 永远表达不了的东西的时刻：`qty: number` 对正负只字未提，`number().int().gt(0)` 才有（Pred 进入 Abs 参与代数 —— `x>0 ⇒ x+1>1`）。

## 旗标

| 旗标 | 配合 | 效果 |
|------|------|--------|
| `--draft` | — | 从现有代码打印可审阅草稿（代码优先） |
| `--write` | `--draft` / `--from-dts` | 把 `*.nudo.draft.js` 写入磁盘 |
| `--emit` | — | 写入/更新 `@generated` 段（默认：只刷新已有段） |
| `--fn <name>` / `--all` | `--draft` / `--emit` | 限定导出名 / 目标为全部导出 |
| `--from <paths…>` | 打印 / `--draft` / `--emit` | 供域证据的使用处文件 |
| `--from-dts` | — | 逆向 `.d.ts` / 带注解 TS / 包类型为草稿（**不执法**） |
| `--dry-run` | `--emit` / `--draft --write` | 只打印不写盘 |
| `--exit-on-diff` | `--emit --dry-run` | 侧车将变化时退出码 `1` |
| `--json` | `--draft` | 供 agent 审阅的 `{ draftSource, diff, entries[] }` |

打印 / `--draft` / `--from-dts` 仅在用法 / IO 错误时失败；`--emit` 另在 `--exit-on-diff` 且有 diff 时失败 —— emit 期间看到的分析诊断只打印，绝不挡 exit。完整表：[CLI Reference](../api/cli-reference.md#nudo-contract)。

## 用 check 门禁

![侧车自动绑定](/img/sidecar-bind.svg)

*同名侧车 `*.nudo.js` 自动绑定到 `calc.js` 导出，作为 L1 进入 `nudo check`。*

```bash
npx nudojs check src/
```

见 [nudo check](./check.md) 与[诊断术语表](../reference/diagnostics.md)。

## 下一步

- [迁移现有 JS](./migrating-js.md) —— 完整 draft → accept → CI 路径
- [从 TypeScript 迁移](./migrating-from-typescript.md) —— 退役流水线中的 `--from-dts`
- [Recipes](./recipes.md) —— 渐进契约、monorepo
- [指令](../concepts/directives.md) —— `@nudo:contract` 文法
- [边界](../concepts/limits.md) —— promote ≠ 义务；诚实边界
