---
sidebar_position: 7
---

# 运行时类型生成

Nudo 的类型推断不仅止于静态分析。你可以直接从推断的类型生成运行时验证器，在开发时推断和生产时验证之间建立无缝桥梁。

```
JS code → Nudo infers types → Generate validators → Runtime validation
```

这意味着你编写纯 JavaScript，让 Nudo 推断类型，然后生成完整的运行时类型检查——无需手写验证器，无需重复的类型定义。

所有生成结果都打印到 stdout。用管道或粘贴的方式放进项目里合适的文件即可。

## `nudo generate` 命令

```bash
nudo generate <file> [options]
```

| 选项 | 描述 |
|---|---|
| `--format <format>` | 输出格式：`zod`、`guard`、`dts`、`all`（默认：`all`） |
| `--output <dir>` | 已声明但**尚未实现**——输出始终走 stdout，请改用 shell 重定向。 |

运行 `nudo generate` 会读取源文件的推断类型，并以指定格式打印验证器。

### 基本用法

```bash
# 打印所有格式（zod、guard、dts）
nudo generate src/api/users.js

# 仅打印 Zod schema
nudo generate src/api/users.js --format zod

# 自行把 stdout 捕获到文件
nudo generate src/api/users.js --format zod > users.schema.txt
```

## 示例源码

本页所有示例都使用下面的文件。注意真实的指令语法：`@nudo:case "<名字>" (<类型表达式>)`——case 名字必须带引号，类型表达式必须包在括号里，并使用 `T.*` 构造器。

```js
// src/api/users.js

// @nudo:case "input" (T.object({ name: T.string, age: T.number }))
function createUser(input) {
  return { id: 123, name: input.name, age: input.age };
}
```

## Zod Schema 生成

使用 `--format zod` 时，Nudo 会为每个 case 的输入和输出类型打印 [Zod](https://zod.dev) schema 表达式。schema 以注释形式输出——把其中的表达式复制出来，组装成你自己的 schema 模块。

```bash
nudo generate src/api/users.js --format zod
```

输出（stdout）：

```js
// === createUser Zod Schemas ===
// Case "input":
// Input: { arg0: z.object({ name: z.string(), age: z.number() }) }
// Output: z.object({ id: z.literal(123), name: z.string(), age: z.number() })
```

注意 `z.literal(123)`：源码中的字面量值（`id: 123`）会被推断为字面量类型，因此输出的 schema 会钉住精确值。

### 组装 Schema 模块

把打印出的表达式粘贴到模块中并导出：

```js
// src/api/users.schema.js -- 由上面的输出来组装
import { z } from "zod";

export const createUserInput = z.object({ name: z.string(), age: z.number() });
export const createUserOutput = z.object({ id: z.literal(123), name: z.string(), age: z.number() });
```

### 与框架集成

**React Hook Form** ——将组装好的 schema 用作表单解析器：

```js
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createUserInput } from "./api/users.schema.js";

const { register, handleSubmit } = useForm({
  resolver: zodResolver(createUserInput),
});
```

**tRPC** ——在过程中使用 schema 进行输入/输出验证：

```js
import { createUserInput, createUserOutput } from "./api/users.schema.js";

const appRouter = router({
  createUser: publicProcedure
    .input(createUserInput)
    .output(createUserOutput)
    .mutation(({ input }) => createUser(input)),
});
```

**Next.js API Routes** ——验证请求体：

```js
import { createUserInput } from "./api/users.schema.js";

export async function POST(request) {
  const body = await request.json();
  const parsed = createUserInput.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.issues }, { status: 400 });
  }
  const user = createUser(parsed.data);
  return Response.json(user);
}
```

## 原生 Guard 生成

使用 `--format guard` 时，Nudo 会打印零依赖的运行时类型守卫函数。这些是纯 JavaScript 函数，没有外部导入，非常适合库、边缘函数或任何关注包体积的场景。

Guard 的命名为 `is` + 函数名 + case 名 + `Output`（每个 case 一个 guard，校验该 case 的输出类型）：

```bash
nudo generate src/api/users.js --format guard
```

输出（stdout）：

```js
// === createUser Type Guards ===
export function iscreateUserInputOutput(data) {
  return typeof data === 'object' && data !== null && data.id === 123 && typeof data.name === 'string' && typeof data.age === 'number';
}
```

把打印出的函数保存到模块中（例如 `src/api/users.guard.js`）并导入使用。

### 性能优势

Guard 函数执行一系列 `typeof` 检查，没有 schema 解释开销。在基准测试中，手写或生成的 guard 在验证密集型工作负载中始终比 schema 解释器（Zod、Yup、io-ts）快 2-10 倍。在高频验证大型负载时，这个差异会累积。

## TypeScript 声明

使用 `--format dts` 时，Nudo 为每个函数打印一条拓宽后的单一签名——与 `nudo infer <file> --dts` 输出一致。有三点需要了解：

- 参数名来自源码（如 `user`）；只有声明节点无法恢复名称时才回退为按位置的 `arg0`、`arg1`。
- 参数位置（逆变位）会被拓宽：字面量参数坍缩为基类型（`"hello"` → `string`、`[1, 2, 3]` → `number[]`），调用方可以传入任意兼容值。返回类型保留推断精度，包括嵌套字面量。

```bash
nudo generate src/api/users.js --format dts
```

输出（stdout）：

```ts
// === createUser TypeScript Declarations ===
/**
 * Case: input ({ name: "Alice"; age: 30 }) => { id: 123; name: "Alice"; age: 30 }
 * @param user - { name: string; age: number }
 * @returns { id: 123; name: "Alice"; age: 30 }
 */
export declare function createUser(user: { name: string; age: number }): { id: 123; name: "Alice"; age: 30 };
```

存在多个 `@nudo:case` 指令时签名仍然是单一的——参数跨 case 取联合并拓宽，每个 case 的精确结果保留在 JSDoc 中：

```js
// @nudo:case "string input" ("hello")
// @nudo:case "number input" (42)
function formatValue(value) {
  return String(value);
}
```

```bash
nudo generate src/api/format.js --format dts
```

```ts
// === formatValue TypeScript Declarations ===
/**
 * Case: string input ("hello") => "hello"
 * Case: number input (42) => "42"
 * @param value - string | number
 * @returns string
 */
export declare function formatValue(value: string | number): string;
```

如果想把 `.d.ts` 文件直接写到源码旁边而不是打印，可使用 `nudo infer <file> --dts`。

## JSON 输出

用于程序化消费和 CI/CD 集成时，使用 `nudo infer --json` 获取机器可读的输出。

```bash
nudo infer src/api/users.js --json
```

输出结构：

```json
{
  "functions": [
    {
      "name": "createUser",
      "loc": { "start": { "line": 4, "column": 0 }, "end": { "line": 6, "column": 1 } },
      "cases": [
        {
          "name": "input",
          "args": ["{ name: string, age: number }"],
          "result": "{ id: 123, name: string, age: number }",
          "throws": null,
          "source": null
        }
      ],
      "entryOnly": false
    }
  ],
  "diagnostics": []
}
```

`functions` 中的每个条目包含：

- `name` 与 `loc`——函数名及其源码位置。
- `cases`——每个 case 一条。`args` 列出参数类型，`result` 是返回类型，`throws` 是抛出类型或 `null`。`source` 对 `@nudo:case` 指令为 `null`，对由全程序调用点发现合成的 case 为 `"callsite"`。
- `entryOnly`——当函数在整个程序中没有调用点时为 `true`。

### CI/CD 集成

在管道中使用 JSON 输出来强制类型契约。`infer` 接受文件路径，不接受目录：

```bash
# 如果报告了任何诊断则失败
nudo infer src/api/users.js --json | jq '.diagnostics | length == 0'
```

在构建中打印验证器，并把 stdout 捕获进项目：

```json
{
  "scripts": {
    "generate": "nudo generate src/api/users.js --format zod > src/api/users.schema.txt",
    "build": "npm run generate && tsc && vite build"
  }
}
```

## 完整工作流

以下是从源代码到运行时验证的端到端示例。

**1. 编写带一条 Nudo 指令的纯 JavaScript：**

```js
// src/api/products.js

// @nudo:case "input" (T.object({ name: T.string, price: T.number, tags: T.array(T.string) }))
function createProduct(input) {
  return {
    id: 456,
    name: input.name,
    price: input.price,
    tags: input.tags,
  };
}
```

**2. 打印所有验证器格式：**

```bash
nudo generate src/api/products.js --format all
```

输出（stdout）：

```
// === createProduct Zod Schemas ===
// Case "input":
// Input: { arg0: z.object({ name: z.string(), price: z.number(), tags: z.array(z.string()) }) }
// Output: z.object({ id: z.literal(456), name: z.string(), price: z.number(), tags: z.array(z.string()) })

// === createProduct Type Guards ===
export function iscreateProductInputOutput(data) {
  return typeof data === 'object' && data !== null && data.id === 456 && typeof data.name === 'string' && typeof data.price === 'number' && Array.isArray(data.tags) && data.tags.every(item => typeof item === 'string');
}

// === createProduct TypeScript Declarations ===
/**
 * Case: input ({ name: "Widget"; price: 9.99; tags: ["a"] }) => { id: 456; name: "Widget"; price: 9.99; tags: ["a"] }
 * @param product - { name: string; price: number; tags: string[] }
 * @returns { id: 456; name: "Widget"; price: 9.99; tags: ["a"] }
 */
export declare function createProduct(product: { name: string; price: number; tags: string[] }): { id: 456; name: "Widget"; price: 9.99; tags: ["a"] };
```

**3. 把需要的部分粘贴进你的应用：**

```js
// src/api/products.guard.js -- 粘贴自上面的 stdout
export function iscreateProductInputOutput(data) {
  return typeof data === 'object' && data !== null && data.id === 456 && typeof data.name === 'string' && typeof data.price === 'number' && Array.isArray(data.tags) && data.tags.every(item => typeof item === 'string');
}
```

```js
// src/api/products.schema.js -- 由上面的 Zod 行组装
import { z } from "zod";

export const createProductInput = z.object({ name: z.string(), price: z.number(), tags: z.array(z.string()) });
```

```js
import { iscreateProductInputOutput } from "./api/products.guard.js";
import { createProductInput } from "./api/products.schema.js";

// 快速 guard 检查（零依赖）
if (!iscreateProductInputOutput(body)) {
  throw new ValidationError("Invalid product data");
}

// 或使用 Zod 获取详细错误信息
const result = createProductInput.safeParse(body);
if (!result.success) {
  return Response.json({ errors: result.error.issues }, { status: 400 });
}
```

**4. 在消费端 TypeScript 代码中使用声明实现类型安全：**

把声明行粘贴到源码旁的 `.d.ts` 中：

```ts
// src/api/products.d.ts -- 粘贴自上面的 stdout
/**
 * Case: input ({ name: "Widget"; price: 9.99; tags: ["a"] }) => { id: 456; name: "Widget"; price: 9.99; tags: ["a"] }
 * @param product - { name: string; price: number; tags: string[] }
 * @returns { id: 456; name: "Widget"; price: 9.99; tags: ["a"] }
 */
export declare function createProduct(product: { name: string; price: number; tags: string[] }): { id: 456; name: "Widget"; price: 9.99; tags: ["a"] };
```

```ts
// 消费端代码无需任何手动注解即可看到完整类型
import { createProduct } from "./api/products.js";

const product = createProduct({ name: "Widget", price: 9.99, tags: ["sale"] });
//    ^? { id: 456; name: "Widget"; price: 9.99; tags: ["sale"] }
```

每个函数只需一行指令，这个工作流就能在 JavaScript/TypeScript 边界上提供完整的运行时安全和编辑器支持。
