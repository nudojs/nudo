---
sidebar_position: 7
---

# 运行时类型生成

Nudo 的类型推断不仅止于静态分析。你可以直接从推断的类型生成运行时验证器，在开发时推断和生产时验证之间建立无缝桥梁。

```
JS code → Nudo infers types → Generate validators → Runtime validation
```

这意味着你编写纯 JavaScript，让 Nudo 推断类型，然后生成完整的运行时类型检查——无需手写验证器，无需重复的类型定义。

## `nudo generate` 命令

```bash
nudo generate <file> [options]
```

| 选项 | 描述 |
|---|---|
| `--format <format>` | 输出格式：`zod`、`guard`、`dts`、`all`（默认：`all`） |
| `--output <dir>` | 输出目录（默认：`.`） |

运行 `nudo generate` 会读取源文件的推断类型，并以一种或多种格式输出验证器。

### 基本用法

```bash
# 生成所有格式
nudo generate src/api/users.js

# 仅生成 Zod schema
nudo generate src/api/users.js --format zod

# 输出到指定目录
nudo generate src/api/users.js --output generated/
```

## Zod Schema 生成

使用 `--format zod` 时，Nudo 会从推断类型生成 [Zod](https://zod.dev) schema 字符串。当你想与更广泛的 Zod 生态系统集成时非常有用。

### 示例

给定以下源文件：

```js
// src/api/users.js

/**
 * @nudo:case { name: string, age: number }
 * @nudo:returns { id: number, name: string, age: number }
 */
function createUser(input) {
  return { id: Date.now(), name: input.name, age: input.age };
}
```

运行：

```bash
nudo generate src/api/users.js --format zod --output generated/
```

生成：

```ts
// generated/users.zod.ts
import { z } from "zod";

export const CreateUserInput = z.object({
  name: z.string(),
  age: z.number(),
});

export const CreateUserOutput = z.object({
  id: z.number(),
  name: z.string(),
  age: z.number(),
});
```

### 与框架集成

**React Hook Form** ——将生成的 schema 用作表单解析器：

```js
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CreateUserInput } from "./generated/users.zod";

const { register, handleSubmit } = useForm({
  resolver: zodResolver(CreateUserInput),
});
```

**tRPC** ——在过程中使用 schema 进行输入/输出验证：

```js
import { CreateUserInput, CreateUserOutput } from "./generated/users.zod";

const appRouter = router({
  createUser: publicProcedure
    .input(CreateUserInput)
    .output(CreateUserOutput)
    .mutation(({ input }) => createUser(input)),
});
```

**Next.js API Routes** ——验证请求体：

```js
import { CreateUserInput } from "./generated/users.zod";

export async function POST(request) {
  const body = await request.json();
  const parsed = CreateUserInput.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.issues }, { status: 400 });
  }
  const user = createUser(parsed.data);
  return Response.json(user);
}
```

## 原生 Guard 生成

使用 `--format guard` 时，Nudo 会生成零依赖的运行时类型守卫函数。这些是纯 JavaScript 函数，没有外部导入，非常适合库、边缘函数或任何关注包体积的场景。

### 示例

```bash
nudo generate src/api/users.js --format guard --output generated/
```

生成：

```ts
// generated/users.guard.ts

export function isCreateUserInput(data: unknown): data is {
  name: string;
  age: number;
} {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.name !== "string") return false;
  if (typeof obj.age !== "number") return false;
  return true;
}

export function isCreateUserOutput(data: unknown): data is {
  id: number;
  name: string;
  age: number;
} {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.id !== "number") return false;
  if (typeof obj.name !== "string") return false;
  if (typeof obj.age !== "number") return false;
  return true;
}
```

### 性能优势

Guard 函数执行一系列 `typeof` 检查，没有 schema 解释开销。在基准测试中，手写或生成的 guard 在验证密集型工作负载中始终比 schema 解释器（Zod、Yup、io-ts）快 2-10 倍。在高频验证大型负载时，这个差异会累积。

## TypeScript 声明

使用 `--format dts` 时，Nudo 会生成 `.d.ts` 文件，包含从源码提取的真实参数名、带 `@param` 和 `@returns` 标签的 JSDoc 注释，以及在存在多个 `@nudo:case` 指令时生成多个重载。

### 示例

```bash
nudo generate src/api/users.js --format dts --output generated/
```

生成：

```ts
// generated/users.d.ts

/**
 * Creates a new user record.
 *
 * @param input - The user data to create.
 * @param input.name - The user's display name.
 * @param input.age - The user's age in years.
 * @returns The newly created user with an assigned id.
 */
export function createUser(input: {
  name: string;
  age: number;
}): {
  id: number;
  name: string;
  age: number;
};
```

当存在多个 `@nudo:case` 指令时，生成的声明包含重载：

```ts
export function formatValue(value: string): string;
export function formatValue(value: number): string;
export function formatValue(value: boolean): string;
```

## JSON 输出

用于程序化消费和 CI/CD 集成时，使用 `nudo infer --json` 获取机器可读的输出。

```bash
nudo infer src/api/users.js --json
```

输出结构：

```json
{
  "functions": {
    "createUser": {
      "cases": [
        {
          "params": [
            {
              "name": "input",
              "type": "{ name: string; age: number }"
            }
          ],
          "return": "{ id: number; name: string; age: number }"
        }
      ]
    }
  },
  "diagnostics": []
}
```

### CI/CD 集成

在管道中使用 JSON 输出来强制类型契约：

```bash
# 如果报告了任何诊断则失败
nudo infer src/ --json | jq '.diagnostics | length == 0'
```

在构建中生成验证器：

```json
{
  "scripts": {
    "generate": "nudo generate src/api/ --format all --output generated/",
    "build": "npm run generate && tsc && vite build"
  }
}
```

## 完整工作流

以下是从源代码到运行时验证的端到端示例。

**1. 编写带 Nudo 指令的纯 JavaScript：**

```js
// src/api/products.js

/**
 * @nudo:case { name: string, price: number, tags: string[] }
 * @nudo:returns { id: number, name: string, price: number, tags: string[] }
 */
function createProduct(input) {
  return {
    id: Date.now(),
    name: input.name,
    price: input.price,
    tags: input.tags,
  };
}
```

**2. 生成所有验证器格式：**

```bash
nudo generate src/api/products.js --format all --output src/generated/
```

**3. 在应用中使用生成的验证器：**

```js
import { isCreateProductInput } from "./generated/products.guard";
import { CreateProductInput } from "./generated/products.zod";

// 快速 guard 检查（零依赖）
if (!isCreateProductInput(body)) {
  throw new ValidationError("Invalid product data");
}

// 或使用 Zod 获取详细错误信息
const result = CreateProductInput.safeParse(body);
if (!result.success) {
  return Response.json({ errors: result.error.issues }, { status: 400 });
}
```

**4. 在消费端 TypeScript 代码中使用声明实现类型安全：**

```ts
// 消费端代码无需任何手动注解即可看到完整类型
import { createProduct } from "./api/products";

const product = createProduct({ name: "Widget", price: 9.99, tags: ["sale"] });
//    ^? { id: number; name: string; price: number; tags: string[] }
```

这个工作流让你的源代码保持无注解状态，同时在边界上提供完整的运行时安全和编辑器支持。
