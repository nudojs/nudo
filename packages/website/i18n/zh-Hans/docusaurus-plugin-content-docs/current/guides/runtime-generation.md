---
description: 用 nudo export 把 Abs 投影为生态产物——Standard Schema 运行时校验器、零依赖守卫、Zod 方言 schema 与 .d.ts 声明。
---

# 运行时校验与生态投影

Nudo 的推断不止于静态分析。`nudo export` 把 CI 门禁所检查的同一个 Abs 投影成**运行时产物**：Standard Schema 校验器、零依赖守卫、Zod 方言 schema 与 `.d.ts` 声明。

```text
JS 代码（+ 可选侧车契约） → Abs → nudo export → 运行时校验器 / .d.ts / schema
```

所有投影都是**单向且有损的**——Abs 才是真相源，`nudo check` 始终是门禁。export 是一次性出货命令，不接受 `--watch`。

## `nudo export` 命令

```bash
nudo export <file> [--format dts|guard|schema|standard|all] [--dialect zod] [--out dir]
```

完整选项 / exit-code 规格：[CLI 参考](../api/cli-reference.md#nudo-export)。要点：

| 格式 | 产物 | 投影输入 |
|------|------|----------|
| `standard` | `<fn>.nudo.standard.ts` — Standard Schema v1 模块（不依赖 Zod） | **侧车 / `@nudo:refine` 契约域**，否则为观测调用点 Abs 的 join |
| `dts` | TypeScript 声明（默认格式） | 调用点 case：参数放宽，返回保持精度 |
| `guard` | 零依赖 `typeof` 守卫函数 | 调用点 Abs 的 join |
| `schema` | `--dialect`（目前 `zod`）的 schema 源码注释 | 逐 case Abs（`call@L…` / `entry@L…`） |
| `all` | dts + guard + schema + standard | — |

## 契约先行：从侧车生成校验器

最强的工作流：在侧车里声明一次域，让 `export` 从中生成运行时门禁。

```js verify
// src/api/users.js
export function createUser(input) {
  return { id: 123, name: input.name, age: input.age };
}
```

```js verify-sidecar
// src/api/users.nudo.js — 契约（同样是普通 JS）
import { number, string, shape, fn } from "@nudojs/core";

export const createUser = fn(
  { input: shape({ name: string(), age: number().ge(0) }) },
  shape({ id: number(), name: string(), age: number() })
);
```

```bash
nudo export src/api/users.js --format standard --out dist
# 写入 dist/createUser.nudo.standard.ts
```

生成的模块为每个参数导出一个校验器（`<fn>_<param>`），另有返回值校验器——存在返回契约时命名为 **`<fn>Return`**（仅当无契约或只有参数契约时才用 `<fn>Output`）。**契约精化直接烘焙进校验器**——`age: number().ge(0)` 变成 `numBound { op: "ge", n: 0 }` 检查，`lit(42)` 契约则钉死确切值：

```ts
// dist/createUser.nudo.standard.ts（节选）
// （另导出 createUserReturn —— 侧车返回 shape 校验器）
export const createUser_input = {
  "~standard": {
    version: 1,
    vendor: "nudo",
    validate(value) {
      const issues = [];
      __nudoCheck({"k":"obj","slots":[
        {"key":"name","node":{"k":"prim","type":"string","refinements":[]}},
        {"key":"age","node":{"k":"prim","type":"number","refinements":[{"kind":"numBound","op":"ge","n":0}]}}
      ]}, value, [], issues);
      return issues.length ? { issues } : { value };
    },
  },
} as const;
```

在任何支持 Standard Schema 的地方消费——不需要 Zod/Valibot 依赖：

```js
import { createUser_input } from "./dist/createUser.nudo.standard.js";

const r = createUser_input["~standard"].validate(body);
if (r.issues) return Response.json({ errors: r.issues }, { status: 400 });
const user = createUser(r.value);
```

它是运行时门禁——**不是** `nudo check` 的替代品。CI 仍在 Abs 上检查同一份契约。

## 证据驱动：从调用点生成校验器

没有侧车时，export 投影**观测到的调用点 Abs 的 join**——你的代码实际传入的东西，而不是手写类型：

```js
// src/api/inline.js
export function createUser(input) {
  return { id: 123, name: input.name, age: input.age };
}

createUser({ name: "Ada", age: 36 });
```

```bash
nudo export src/api/inline.js --format standard --out dist
```

调用点观测到的字面量会钉死确切值（`z.literal` / lit 节点 / `=== "Ada"` 检查）。想要契约界（`gt/ge/lt/le`、`int`、字符串长度）而不是观测字面量时，加上侧车。

诚实边界：**未被调用**的导出回退到 `entry@L…`——参数投影为 `unknown`，不做猜测。这是 `--from` 天花板（[Limits](../concepts/limits.md#调用点发现上限)），不是推断 bug。

## Zod 方言 schema（`--format schema`）

Schema 源码按 case 以注释形式打印——把片段组装进你自己的模块：

```bash
nudo export src/api/inline.js --format schema --dialect zod
# 或直接写盘：
nudo export src/api/inline.js --format schema --dialect zod --out dist
# 写入 dist/inline.nudo.schema.zod.ts
```

```js
// === createUser Schema (zod) ===
// call@L5:
// Input: { arg0: z.object({ name: z.literal("Ada"), age: z.literal(36) }) }
// Output: z.object({ id: z.literal(123), name: z.literal("Ada"), age: z.literal(36) })
```

Abs 上可表达的常量数值界 / `int` / 字符串长度 pred 会被投影；不可表达的出现在 `dropped preds`。

组装并与你喜欢的 resolver 一起用：

```js
// src/api/users.schema.js — 由打印表达式组装
import { z } from "zod";

export const createUserInput = z.object({ name: z.string(), age: z.number() });

// React Hook Form
import { zodResolver } from "@hookform/resolvers/zod";
const { register, handleSubmit } = useForm({ resolver: zodResolver(createUserInput) });
```

## 零依赖守卫（`--format guard`）

守卫是纯 `typeof` 检查，无外部导入、无 schema 解释——每个导出函数一个，命名为 `is<Fn>Output`：

```bash
nudo export src/api/inline.js --format guard
# 或直接写盘：
nudo export src/api/inline.js --format guard --out dist
# 写入 dist/inline.nudo.guard.ts
```

```js verify
// === createUser Type Guards ===
export function iscreateUserOutput(data) {
  return typeof data === "object" && data !== null && data.id === 123 && data.name === "Ada" && data.age === 36;
}
```

把打印出的函数存进模块（`src/api/users.guard.js`）再导入。选择前用你的实际载荷形状分别测一下 guard 与 schema 两条路径；权衡点是错误信息丰富度 vs 零依赖。

## TypeScript 声明（`--format dts`）

每个函数一个放宽后的签名。参数位（逆变）把字面量放宽到基类型，让调用方可以传任何兼容值；返回类型保持推断精度：

```bash
nudo export src/api/inline.js --format dts
```

```ts
/**
 * Case: call@L5 ({ name: "Ada"; age: 36 }) => { id: 123; name: "Ada"; age: 36 }
 * @param input - { name: string; age: number }
 * @returns { id: 123; name: "Ada"; age: 36 }
 */
export declare function createUser(input: { name: string; age: number }): { id: 123; name: "Ada"; age: 36 };
```

多个 case 时签名仍保持单个——参数跨 case 取并集并放宽；每个 case 的精确结果保留在 `Case:` JSDoc 行里。写 `.d.ts` 文件到目录：`nudo export <file> --format dts --out <dir>`。

## 在 CI 里

把校验器生成纳入构建，产出不进 review：

```json
{
  "scripts": {
    "generate": "nudo export src/api/users.js --format standard --out src/generated",
    "gate": "nudo check src/"
  }
}
```

流水线用的机器可读事实来自 `nudo check --json` / `nudo test --json`——见 [CLI 参考](../api/cli-reference.md#nudo-check)。

## 下一步

- [契约](./contract.md) — 起草 / 接受 / 固化侧车接口
- [nudo check](./check.md) — 同一 Abs 上的 CI 门禁
- [迁移已有 JS](./migrating-js.md) — 契约先行的迁移路径
- [与 TypeScript 共存](./coexistence.md) — `.d.ts` 互操作配方
