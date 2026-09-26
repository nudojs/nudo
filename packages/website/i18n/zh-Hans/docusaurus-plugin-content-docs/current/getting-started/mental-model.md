---
slug: /getting-started/mental-model
description: 十分钟建立 Nudo 心智模型 —— 纯 JS、check、契约、退役 tsc。不需要第二套类型语言。
---

# 十分钟心智模型

**读完你会知道：** Nudo 如何看待 JavaScript、第一天真正需要的三个产品动词，以及迁移离 `tsc` 的终点长什么样。

本页**不**以 Abs 代数开头——Day 0 是 signatures 与 cases。会读 JS、会跑 CLI，十分钟够了。Abs 细节放在折叠框里，等你想用 `--abs` 时再打开。

## 一句话模型

Nudo 在抽象值上**执行**你的 JavaScript，报告代码真实计算出什么 —— 然后门禁你声明的**契约**。源码保持普通 `.js`。

| 你写 | Nudo 做 |
|------|---------|
| 普通 `.js` + 调用点 | 观察真实行为并打印签名 |
| 可选 `*.nudo.js` / `@nudo:contract` | 门禁义务（`actual ⊭ expected`） |
| 什么都不写 | 仍门禁导出 may-throw（L2） |

**没有第二套类型语言。** 契约就是普通 JS 模块 + `number().gt(0)` 这类构造器。

## 0–3 分钟 —— Day 0：读 signatures 与 cases

Day 0 有**两张脸**。先读这两张——不是 Abs 代数。

| 脸 | 命令 | 你读到什么 |
|----|------|------------|
| **Signatures** | `nudo check` | 每个导出计算出什么（参数 / 返回 / may-throw） |
| **Cases** | `nudo test`*（可选调试）* | 逐调用 `call@` / entry 见证——仍不是 CI 义务 |

创建 `calc.js`：

```javascript verify
export function scale(x) {
  return x + 1;
}

scale(5);
```

```bash
npx nudojs check calc.js
```

```text
signatures
  scale(x: any) => number | string
```

这就是 Day 0 全循环：

1. 照常写 JS。
2. 留下调用点（`scale(5)`）—— 它们是**证据**。
3. 跑 `nudo check`。成功时也打印签名。
4. （可选）`nudo test` 看用例见证——`@nudo:case` 仅调试。

无约束参数显示为 **`any`**（尚无义务）。这里的返回是真实 JS `+` 面（`number | string`）。**`unknown`** 表示推导失败 —— 引擎债，不是你的标注风格。

<details>
<summary><strong>之后 / 进阶 —— 这些脸由什么构成（Abs）</strong></summary>

完成 Day 0 或 Day 1 **不需要**本段。signatures 与 cases 是产品脸；Abs 是底下的计算。

**Abs** = `shape × term × pred × conf` —— 可计算类型，其约束参与代数（`x>0` ⇒ `x+1>1`）。

| 组件 | Day-0 名字 | 它是什么 |
|------|------------|----------|
| **shape** | 你已经在读的签名脸 | `prim` / `obj` / `arr` / `fn` / `sum` / … |
| **term** | 值身份 | `lit`（精确 `42`）、`var`（符号 `A1`）、`app`（`x+1`） |
| **pred** | 违例里的 `expected:` 行 | term 上的约束（`x > 0`） |
| **conf** | `#exact` / `#path` 标记 | 抽象有多精确 |

**CLI 入口（想用时）：**

```bash
nudo check calc.js --abs              # algebra face (shape + conf)
nudo check calc.js --abs --generalize # adds symbolic term/pred α
nudo check calc.js --abs --assume "x>0"
```

深潜：[Abs](../concepts/abs.md) · 分层笔记：[进阶 — Abs](../concepts/layers.md#advanced-abs)。

</details>

## 3–6 分钟 —— Day 1：声明一条义务

契约写在源码旁的侧车（`calc.nudo.js`）或函数上的 `@nudo:contract`。只有一种形态，构造器：

```javascript verify-sidecar
import { number, fn } from "@nudojs/core";

export const scale = fn({ x: number().gt(0) }, number());
```

加一条违例调用：

```javascript verify
scale(0); // must be > 0
```

```bash
npx nudojs check calc.js
```

```text
issues
  [ERROR L6 scale] scale[x]: argument ⊭ precondition  (nudo:constraint-violated)
      actual:   0  #exact
      expected: x > 0
      → use a value satisfying x > 0, or relax the precondition on x
      fix:  nudo contract --draft  (emit a sidecar draft you can edit)
```

每条违例都回答三个问题：

| 字段 | 含义 |
|------|------|
| `actual:` | 调用点真实携带的值 |
| `expected:` | 契约 Pred（不是类型名） |
| `fix:` | 一条可执行的下一步命令 |

`if` **不是**契约。义务只来自你接受的声明。

## 6–8 分钟 —— 产品命令面

| 阶段 | 命令 | 你得到 |
|------|------|--------|
| **Day 0** | `nudo check` | 签名 + L2 入口 may-throw 门禁 |
| **Day 1** | `nudo contract` + `nudo check` | 审阅过的契约，然后同一门禁 |
| **生态** | `nudo export` | `.d.ts` / Zod / Standard Schema（有损视图） |
| **离开 tsc** | `nudo migrate` | 单向门：`status` → `strip` → `verify` → `retire` |

观察 = **check 签名（+ 可选 cases）+ IDE hover**。`nudo test` 是可选调试用例报告器 —— 不是主路径。没有 `infer` 动词。

## 8–10 分钟 —— 替代 TypeScript，不是永久共存

JS 包的终局是：**循环里没有 `tsc`**。

```bash
npx nudojs migrate status ./my-pkg
npx nudojs migrate strip ./my-pkg/src --write
npx nudojs migrate verify ./my-pkg/src
npx nudojs migrate retire ./my-pkg
```

| 步骤 | 作用 |
|------|------|
| `status` | 审计 `.ts` 数量、`tsc` scripts、`typescript` 依赖与 blockers |
| `strip` | `.ts` → `.js`（注解出、运行时留） |
| `verify` | `nudo check` 必须在 JS 上通过 |
| `retire` | 摘掉 `typescript`，把 `tsc` scripts 改写成 `nudo check` |

与 `tsc` 共存只是**迁移期战术**。出口是 `retire`。细流程：[从 TypeScript 迁移](../guides/migrating-from-typescript.md) · 真实包故事：[`docs/examples/retire-real/`](https://github.com/nudojs/nudo/tree/main/docs/examples/retire-real)。

## 四条省一小时的规则

1. **调用点是证据。** 真实调用越多，签名越尖。
2. **`any` ≠ `unknown`。** `any` = 入口无约束（你细化它）。`unknown` = 引擎失败（我们修）。
3. **契约是义务，不是注解。** 它们参与代数（`x>0` ⇒ `x+1>1`）。
4. **`@nudo:case` 仅调试。** 它不制造 CI 义务。

## 现在可以先不管

- Abs（`shape × term × pred × conf`）—— 只在想用 `--abs` 时打开上面的**之后 / 进阶**折叠框；深页：[Abs](../concepts/abs.md)
- Harvest / env 内部 —— 之后：[依赖类型](../guides/env-harvest.md)
- 导出方言 —— 只在消费方要 `.d.ts` 或校验器时再看

## 下一步

- [快速开始](./quick-start.md) —— 同一路径，输出更全
- [错误对照](../guides/error-faces.md) —— 违例相对 `tsc` 长什么样
- [Nudo vs TypeScript](../guides/vs-typescript.md) —— 替代 / 不替代地图
- [从 TypeScript 迁移](../guides/migrating-from-typescript.md) —— 退役 `tsc`
- [Playground](/playground)
