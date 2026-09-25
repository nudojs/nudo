---
slug: /guides/error-faces
description: Nudo 与 TypeScript 的错误对照 —— 真值、Pred、下一步。可运行、CI 钉住样例。
---

# 错误对照：Nudo vs TypeScript

**读完你会知道：** 业务代码出错那天，Nudo 违例怎么读 —— 为什么比 `tsc` 类型名更快修好。

目标：**不是「报得更多」，是「报得更真、带证据、带下一步」。**

完整 CI 钉住套件：[`docs/examples/errors/`](https://github.com/nudojs/nudo/tree/main/docs/examples/errors)（`pnpm run verify:examples`）。仓库深文：[`docs/errors-vs-typescript.md`](https://github.com/nudojs/nudo/blob/main/docs/errors-vs-typescript.md)。

## 每条违例共有的脸

```text
      actual:   <调用点 / 右值的 Abs>
      expected: <契约 Pred 或既有形状>
      → <一行怎么改>
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

看到的是**值与谓词**，不是发明出来的类型名。`fix:` 总是指向可审阅的契约草稿 —— 接受草稿才会产生 L1 义务（绝不静默）。

## 可运行巡览（四张脸）

下面的块是真实门禁：界 Pred、返回 Pred、长度 Pred、入口 may-throw、形状重赋值 —— 一次 `nudo check`。

```javascript verify
/// @nudo:import { delay, positive, nonEmpty } from "./error-faces.nudo.js"

/**
 * @nudo:contract ms delay
 */
export function setDelay(ms) {
  return ms;
}

/**
 * @nudo:contract return positive
 */
export function bad() {
  return 0;
}

/**
 * @nudo:contract s nonEmpty
 */
export function tag(s) {
  return "[" + s + "]";
}

export function getName(user) {
  return user.name;
}

export let config = { host: "localhost", port: 8080 };
config = { host: "y" };

setDelay(0);
bad();
tag("");
```

```javascript verify-sidecar
import { number, string } from "@nudojs/core";

export const delay = number().gt(0);
export const positive = number().gt(0);
export const nonEmpty = string().min(1);
```

```bash
npx nudojs check error-faces.js
```

```text
nudo check  error-faces.js
FAILED
  5 error · 0 warning · 0 info · 4 fn

signatures
  setDelay(ms: number) => number
  bad() => 0
  tag(s: string) => string
  getName(user: any) => any  throws TypeError

issues
  [ERROR bad] bad: return value ⊭ @nudo:contract return positive  (nudo:constraint-violated)
      actual:   0  #exact
      expected: return > 0
      → return a value satisfying > 0
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)

  [ERROR L24 getName] getName (export): may throw TypeError  (nudo:entry-may-throw)
      actual:   getName(user: any) => any    throws TypeError
      expected: entry total, or @nudo:throws / try-catch
      → property 'name' on any (unconstrained value) → refine / guard / try-catch / --ignore-throws TypeError
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)

  [ERROR L31 setDelay] setDelay[ms]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   0  #exact
      expected: ms > 0
      → use a value satisfying ms > 0, or relax the precondition on ms
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)

  [ERROR L33 tag] tag[s]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   ""  #exact
      expected: length(s) ≥ 1
      → use a value whose length is ≥ 1, or relax the precondition on s
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)

  [ERROR L29 config] config: assignment ⊭ existing shape  (nudo:assign-mismatch)
      actual:   { host: "y" }  #exact
      expected: { host: "localhost", port: 8080 }  #exact
      → missing slot port
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

每条 issue 独立 —— 按任意顺序修。在 GitHub Actions / GitLab 上，`nudo check` 还会出内联注解 / Code Quality 行。

## 对照表

| # | 场景 | TypeScript | Nudo |
|---|------|------------|------|
| 1 | `setDelay(0)` 数值界 | 常**静默**（`ms: number` 合法） | `actual: 0 #exact` · `expected: ms > 0` |
| 2 | `greet({ id: 2 })` 缺 `name` | 要先写 `interface`，否则可能不报 | `missing field u.name` · 形状一处侧车 |
| 3 | `config = { host: "y" }` 丢 `port` | 依赖推断；宽类型下静默 | `assign-mismatch` · `missing slot port` |
| 4 | 无约束 `user` 上 `user.name` | **不展示 throws** —— 运行时炸 | `throws TypeError` + L2 `entry-may-throw` 进 CI |
| 5 | `positive` 下 `return 0` | 返回 `number` 接受 `0` | `return value ⊭ …` · `expected: return > 0` |
| 6 | 真实 `+`（`x + 1`） | 常谎称 `number`（对 `"7"`） | 诚实 `number \| string`，或契约拦调用 |
| 7 | `n = "str"`（在 `n = 2` 后） | 熟悉的类型名，无值 | `prim string ⊭ prim number` · `#exact` 字面量 |
| 8 | `tag("")` 长度界 | `string` 合法；要品牌类型 | `length(s) ≥ 1` · `actual: ""` |
| 9 | 多违例一次 | 嵌套泛型噪声 | 每站独立 `actual`/`expected`/`fix:` |
| 10 | 怎么修？ | “Not assignable” | **`fix: nudo contract --draft`** |

更好修的原因：报告是**一个值和一条谓词**，外加一条下一步命令 —— 不是类型名谜语。

## 读 `actual` / `expected`

| 你看到 | 含义 |
|--------|------|
| `#exact` | 该点字面量 / 全知 Abs |
| `expected: ms > 0` | 来自已接受契约的 **Pred**（参与代数） |
| `missing field u.name` | 你声明的形状的结构面 |
| `throws TypeError` | 该入口的 JS 运行时效果 —— 作 L2 门禁 |

诊断码与更多例子：[诊断词典](../reference/diagnostics.md)。

## 相关

- [十分钟心智模型](../getting-started/mental-model.md)
- [nudo check](./check.md) —— L1 + L2 门禁
- [契约](./contract.md) —— draft / 接受
- [Nudo vs TypeScript](./vs-typescript.md)
- 可运行矩阵：[`docs/examples/errors/`](https://github.com/nudojs/nudo/tree/main/docs/examples/errors)
