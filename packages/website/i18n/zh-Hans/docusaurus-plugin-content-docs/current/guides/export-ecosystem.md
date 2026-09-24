---
slug: /guides/export-ecosystem
description: "用 nudo export 桥接到生态 —— dts / guard / schema / standard、Zod 方言，以及 Nudo 在哪里结束、schema 库从哪里开始。"
---

# Export：通向生态的桥

**读完你能带走：** `nudo export` 的命令面、它如何把事实交给 Zod / ArkType / TypeBox，以及一行分工。

> **schema 管边界；Nudo 管内部。**

`nudo check` 只做校验。产物来自 **`nudo export`** —— Abs 的单向、有损投影。Abs 保持真理源；没有任何东西把投影读回来。

## 命令面

```bash
nudo export <path> [--format dts|guard|schema|standard|all] [--dialect zod] [--out dir]
```

| `--format` | 产物 |
|---|---|
| `dts` | TypeScript 声明（默认）—— 单向 npm / 编辑器桥 |
| `guard` | 零依赖运行时类型守卫函数 |
| `schema` | `--dialect` 的 schema 源码（目前 `zod`）→ `*.nudo.schema.zod.ts` |
| `standard` | [Standard Schema](https://standardschema.dev) v1 模块（`~standard`，vendor `nudo`） |
| `all` | dts + guard + schema + standard |

`--dialect zod` 作用于 `--format schema|all`。`--out dir` 写出文件；不带它时 export 打印到 stdout。Export 是一次性出货命令——没有 `--watch`。

```bash
nudo export src/api.js --format dts --out dist/types
nudo export src/api.js --format schema --dialect zod --out dist
nudo export src/api.js --format all --out dist
```

各格式的输入与示例：[运行时生成](./runtime-generation.md)。Flag / 退出码契约：[CLI 参考](../api/cli-reference.md#nudo-export)。

## 分工

| | Zod / ArkType / TypeBox / Valibot | Nudo |
|---|---|---|
| 何时 | 在 API / 表单 / IO **边界** `parse` / `safeParse` | 在 **CI** 里对逻辑 + 契约跑 `nudo check` |
| 什么 | *进入*数据的形状 | 对*计算*结果的 Pred 义务 + 入口 throws |
| 真理 | schema 对象 | Abs（`shape × term × pred × conf`） |

它们可以组合：export **把** Abs **投影**进 schema 方言，让边界代码与 CI 对同一批事实达成一致。schema 是运行时门禁；Nudo 是静态蕴含门禁。不要把任何一方当作第二套类型语言。

- **边界校验** —— 在不可信数据进入的边缘保留 Zod / ArkType / TypeBox。
- **静态蕴含** —— 把 `nudo check` 留在内部计算（`x>0` ⇒ `x+1>1`）、L1 契约，以及 L2 入口 may-throw 上。
- 当你希望产物能接进任何符合规范的库、又不想引入 Zod 依赖时，优先 **Standard Schema** 输出。

Nudo 的诚实边界（以及什么时候*不要*用它）：[竞争格局](./competitive-landscape.md)。

## 迁移备注

把遗留 JS 包带上 Nudo 的过程中，L2 入口 may-throw 可能很吵。命名门禁档位可以保持 L1 严格、只软化 L2：

```bash
nudo check src/ --profile adoption   # L2 → warning；L1 契约违例仍是 error
nudo check src/ --profile strict     # 默认：L1 + L2 error
```

显式 `--entry-throws error|warning|off` 覆盖档位。见 [nudo check](./check.md)。

## 下一步

- [运行时生成](./runtime-generation.md) —— 完整 export 走读
- [竞争格局](./competitive-landscape.md) —— Nudo 相对 schema 库 / TS 的位置
- [nudo check](./check.md) —— 保持真理源的那道门
- [CLI 参考](../api/cli-reference.md#nudo-export)
