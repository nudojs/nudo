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
| `schema` | `--dialect` 的 zod JS 模块（`import { z } from "zod"`，目前 `zod`）→ `*.nudo.schema.zod.ts` |
| `standard` | [Standard Schema](https://standardschema.dev) v1 模块（`~standard`，vendor `nudo`） |
| `all` | dts + guard + schema + standard |

`--dialect zod` 作用于 `--format schema|all`。`--out dir` 写出文件；不带它时 export 打印到 stdout。Export 是一次性出货命令——没有 `--watch`。

```bash
nudo export src/api.js --format dts --out dist/types
nudo export src/api.js --format schema --dialect zod --out dist
nudo export src/api.js --format all --out dist
```

各格式的输入与示例：[运行时生成](./runtime-generation.md)。Flag / 退出码契约：[CLI 参考](../api/cli-reference.md#nudo-export)。

## 每种格式用在哪

| 格式 | 何时用 | 投影自 | 示例消费者 |
|---|---|---|---|
| `dts` | JS 包给 TS 编辑器 / npm 的类型 | 调用点用例（参数加宽，返回保精度） | `tsc`、IDE 跳转 |
| `guard` | 内联运行时检查、零依赖 | 合并后的调用点 Abs | `if (!isUserOutput(x)) …` |
| `schema` | 自己组装 Zod（或方言）模块 | 逐用例 Abs（`call@L…` / `entry@L…`） | Zod / resolver 生态 |
| `standard` | 接入任何 Standard Schema 库 | 侧车 / `@nudo:contract` 域，否则合并调用点 Abs | `~standard.validate` |

### dts —— 给 TS 消费者的声明

```bash
nudo export src/api.js --format dts --out dist/types
```

每个函数一份加宽签名；用例精度留在 JSDoc `Case:` 行里（调试用外延笔记，不是接口产品）。适合 JS 包需要 `.d.ts` 面、又不想上 TypeScript 的场景。

### guard —— 零依赖类型守卫

```bash
nudo export src/api.js --format guard --out dist
```

纯 `typeof` 检查，每个导出一个函数（`is<Fn>Output`）。适合不想引入 schema 库的运行时代码：

```js
export function iscreateUserOutput(data) {
  return typeof data === "object" && data !== null && data.id === 123 && data.name === "Ada" && data.age === 36;
}
```

### schema —— Zod 方言源码

```bash
nudo export src/api.js --format schema --dialect zod --out dist
# 写出 dist/*.nudo.schema.zod.ts
```

按用例打印 schema 表达式（注释或文件）。常数数值界 / `int` / 字符串长度 pred 在可表达时被投影；无法投影的 pred 出现在 `dropped preds` 下。组装进你自己的模块，交给 resolver（React Hook Form 等）。

### standard —— Standard Schema 校验器

```bash
nudo export src/api.js --format standard --out dist
# 写出 <fn>.nudo.standard.ts
```

每个参数一个校验器（`<fn>_<param>`），外加返回值（存在返回契约时为 `<fn>Return`）。契约精化被烘进去（`number().ge(0)` → `numBound { op: "ge", n: 0 }`）。在任何支持 Standard Schema 的地方消费 —— 无需 Zod 依赖：

```js
const r = createUser_input["~standard"].validate(body);
if (r.issues) return Response.json({ errors: r.issues }, { status: 400 });
```

## 校验 vs 投影

| | `nudo check` | `nudo export` |
|---|---|---|
| 角色 | Abs 上的静态蕴含门禁 | Abs 的单向投影 |
| 方向 | 读源码 + 契约 | 写产物；没人把它们读回来 |
| 失败形态 | L1/L2 错误退出 `1` | 仅 usage / IO 错误退出 `1` |
| watch | 支持 `--watch` | 一次性出货命令 |

Abs 只算一次；`check` 门禁它，`export` 出货它的视图。绝不把投影当作第二套类型语言 —— 改源码契约或代码，再重新 export。

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

## CI 集成

先门禁、再出货产物 —— export 在绿树上是确定性的：

```yaml
# .github/workflows/nudo.yml
jobs:
  nudo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm i -g nudojs
      - run: npx nudojs check src/
      - run: npx nudojs export src/api.js --format all --out dist
      # 随你的包发布 dist/
```

`export` 成功退出 `0`、usage / IO 错误退出 `1` —— 它不会重跑契约门禁。与 `check` 配对（固化了 `call@` 用例时可再加 `health`）。配方：[Recipes](./recipes.md)。

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
