---
sidebar_position: 1
---

# 设计文档

> **Nudo** — 面向 JavaScript 的类型推断引擎，通过对符号化的类型值执行代码来推导精确类型（抽象解释）。

---

## 1. 愿景与核心思想

### 1.1 问题

TypeScript 的类型系统强大，但它运行在一个**独立于 JavaScript 的语言**中。复杂的类型级计算需要「类型体操」——条件类型、映射类型、`infer`、模板字面量类型——这是一套与开发者日常编写的值级 JavaScript 完全不同的编程模型。

```typescript
// 开发者在值层面编写的代码（直观）：
function transform(x) {
  if (typeof x === "string") return x.toUpperCase();
  if (typeof x === "number") return x + 1;
  return null;
}

// 他们必须在类型层面编写的代码（晦涩）：
type Transform<T> =
  T extends string ? Uppercase<T> :
  T extends number ? number :
  null;
```

这两种表示描述的是**同一个逻辑**，却存在于两个互不相通的世界。当逻辑复杂时，保持它们同步既痛苦又容易出错。

### 1.2 核心洞察

**如果值级代码本身就是类型级计算呢？**

Nudo 既不像 TypeScript 那样静态分析代码，也不像测试那样用具体值运行代码，而是**用符号化的「类型值」来执行代码**——这些特殊对象代表一组可能的值。执行过程本身就产生了类型。

```
传统方式：   源代码  →  静态分析  →  类型
Nudo：       源代码  +  类型值     →  执行  →  类型
```

这不是「通过样例归纳类型」（从有限样本进行归纳推理）。这是**抽象解释（Abstract Interpretation）**——编程语言理论中一种成熟的技术——以「运行代码」这一熟悉的心智模型呈现。

### 1.3 关键区分：具体执行 vs 符号执行

| 方式 | 输入 | 输出 | 完备性 |
|----------|-------|--------|--------------|
| 单元测试 | 具体值（`1`、`"hello"`） | 具体结果 | 仅覆盖测试用例 |
| Nudo | 类型值（`T.number`、`T.string`） | 类型值 | 覆盖类型集合中的所有值 |
| TypeScript | AST（不执行） | 类型 | 覆盖所有语法路径 |

当 Nudo 执行 `transform(T.string)` 时，引擎将 `T.string` 在函数体中传播。在 `typeof x === "string"` 处，引擎知道该分支会被进入。在 `x.toUpperCase()` 处，引擎知道结果是 `T.string`。结果不是一个具体值——而是一个**类型**。

---

## 2. 类型值体系

**类型值（Type Value）** 是基础抽象。一个类型值代表一组可能的 JavaScript 值，并知道如何参与 JS 运算。

### 2.1 类型值层级

```
TypeValue
├── Literal<V>          — 单个具体值：1, "hello", true, null, undefined
├── Primitive<T>        — 某基本类型的所有可能值：number, string, boolean, bigint, symbol
├── RefinedType         — 基础类型的精化子集，携带元数据和自定义运算规则
├── ObjectType          — 具有已知属性类型的对象：{ id: number, name: Literal<"Alice"> }
├── ArrayType           — 具有元素类型的数组：Array<number>
├── TupleType           — 固定长度数组：[Literal<1>, Primitive<string>]
├── FunctionType        — 具有 params、body、closure 的函数
├── UnionType           — 类型值的联合：Literal<1> | Literal<2> | Primitive<string>
├── NeverType           — 空集（不可达）
└── UnknownType         — 全集（任意值）
```

### 2.2 设计原则

**原则 1：字面量保留。** 当所有输入都是字面量时，结果也应该是字面量。

```javascript
T.literal(1) + T.literal(2)  // → T.literal(3)，而非 T.number
```

**原则 2：抽象时拓宽。** 当任一输入是抽象的（非字面量），结果拓宽为对应的抽象类型——但通过精化类型尽可能保留结构信息。

```javascript
T.literal(1) + T.number       // → T.number
T.literal("0x") + T.string    // → `0x${string}`（模板精化类型）
```

**原则 3：联合类型懒分配。** 对联合类型的运算分配到每个成员上，但采用**懒求值**策略——联合类型作为整体传播，只在运算符**必须区分成员**时才展开。这避免了笛卡尔积导致的组合爆炸。

```javascript
const a = T.union(T.literal(1), T.literal(2));
const b = T.union(T.literal("x"), T.literal("y"));

// 不展开——成员间无需区分
const arr = [a, b];  // → T.tuple([T.union(1, 2), T.union("x", "y")])

// 展开——运算需要区分成员
const sum = a + b;   // → 展开为 1+"x", 1+"y", 等 → 字面量的联合
```

**原则 4：守卫窄化。** 类型守卫（`typeof`、`instanceof`、真值检查）在分支中窄化类型值。

```javascript
const x = T.union(T.number, T.string);
if (typeof x === "string") {
  // 在此分支中，x 被窄化为 T.string
}
```

### 2.3 类型值 API

```typescript
// --- 构造 ---
T.literal(value)              // 字面量类型值
T.number                      // 抽象 number
T.string                      // 抽象 string
T.boolean                     // 抽象 boolean
T.null                        // 字面量 null
T.undefined                   // 字面量 undefined
T.unknown                     // unknown 类型
T.never                       // never 类型

T.object({ key: TypeValue })  // 对象类型
T.array(TypeValue)            // 数组类型
T.tuple([TypeValue, ...])     // 元组类型
T.union(TypeValue, ...)       // 联合类型
T.fn(params, body, closure)  // 函数类型
T.refine(base, refinement)   // 基础类型的精化子集，携带自定义规则

// --- 内省 ---
typeValue.kind                // "literal" | "primitive" | "refined" | "object" | "array" | ...
typeValueToString(tv)         // 可读表示："number", "1 | 2", "string | number"
isSubtypeOf(a, b)             // 子类型检查
```

### 2.4 类型值上的运算符语义

由于 JavaScript 不支持运算符重载，引擎**解释 AST** 并通过语义层分派：

```typescript
// 引擎将 `a + b` 转换为：
Ops.add(a, b)

// Ops.add 知道如何处理类型值：
// - 两个都是字面量 → 计算具体结果
// - 涉及字符串 → 结果是 string
// - 都是数字 → 结果是 number
// - 兜底 → T.union(T.number, T.string)
```

每个 JS 运算符和内置方法在 Ops 中都有对应的类型值语义规则。

对于**精化类型**，引擎使用分派回退链：首先尝试精化类型的自定义 `ops`/`methods`/`properties` handler；如果返回 `undefined`，则解包到基础类型并递归，直到到达原始类型的默认规则。

---

## 3. 求值引擎（Nudo Engine）

### 3.1 架构概览

```
┌─────────────────────────────────────────────────────┐
│                   Nudo Engine                       │
│                                                     │
│  ┌───────────┐   ┌────────────┐   ┌──────────────┐ │
│  │  Parser   │──▶│ Directive  │──▶│  Evaluator   │ │
│  │ (Babel)   │   │ Extractor  │   │ (AST Walker)  │ │
│  └───────────┘   └────────────┘   └──────┬───────┘ │
│                                          │         │
│                  ┌───────────────────────┐│         │
│                  │    Ops (Operator &    ││         │
│                  │  Built-in Semantics) │◀         │
│                  └───────────────────────┘          │
│                                                     │
│  ┌──────────────┐  ┌─────────────┐  ┌───────────┐  │
│  │ Environment  │  │   Branch    │  │   Type    │  │
│  │   (Scope)    │  │  Executor   │  │  Emitter  │  │
│  └──────────────┘  └─────────────┘  └───────────┘  │
└─────────────────────────────────────────────────────┘
```

| 组件 | 职责 |
|-----------|-----------|
| **Parser** | 将 JS/TS 源码解析为 AST（Babel） |
| **Directive Extractor** | 从注释中提取 `@nudo:*` 指令 |
| **Evaluator** | 遍历 AST，用类型值对每个节点求值 |
| **Ops** | 定义运算符和内置方法的类型值语义 |
| **Environment** | 变量绑定（名称 → TypeValue） |
| **Branch Executor** | 在条件处分叉、窄化、求值、合并 |
| **Type Emitter** | 将最终 TypeValue 序列化（如转 TypeScript） |

### 3.2 求值规则

求值器是一个 AST 遍历器。对每种节点类型有对应规则：

**字面量：**
```
eval(NumericLiteral 42)  →  T.literal(42)
eval(StringLiteral "hi") →  T.literal("hi")
eval(NullLiteral)       →  T.null
```

**变量：**
```
eval(Identifier "x")  →  env.lookup("x")
```

**二元表达式：**
```
eval(BinaryExpression { left, op, right })  →  Ops[op](eval(left), eval(right))
```

**条件语句（if-else）：** 引擎可能**同时求值两个分支**，各自使用窄化后的类型值，再合并：

```
eval(IfStatement { test, consequent, alternate }) →
  condition = eval(test)
  if condition === T.literal(true)  → eval(consequent)
  if condition === T.literal(false) → eval(alternate)
  else:
    [envTrue, envFalse] = narrow(env, test)
    resultTrue  = eval(consequent, envTrue)
    resultFalse = eval(alternate, envFalse)
    return T.union(resultTrue, resultFalse)
```

### 3.3 窄化规则

| 模式 | True 分支 | False 分支 |
|---------|-------------|-------------|
| `typeof x === "string"` | `x ∩ T.string` | `x - T.string` |
| `typeof x === "number"` | `x ∩ T.number` | `x - T.number` |
| `x === null` | `x ∩ T.null` | `x - T.null` |
| `x === <literal>` | `x ∩ T.literal(v)` | `x - T.literal(v)` |
| `Array.isArray(x)` | `x ∩ T.array(T.unknown)` | `x - T.array(T.unknown)` |
| `x`（真值检查） | `x - T.null - T.undefined - falsy` | 补集 |
| `x instanceof C` | `x ∩ T.instanceOf(C)` | `x - T.instanceOf(C)` |

---

## 4. 复杂结构

### 4.1 循环

当循环次数依赖于类型值时，引擎使用**不动点迭代**：

```javascript
let sum = 0;
for (let i = 0; i < arr.length; i++) {
  sum += arr[i];
}
```

策略：若 `arr` 是抽象的，用 `arr[i]` 作为元素类型执行循环体，直到 `sum` 的类型达到不动点（如 `T.literal(0)` → `T.number`）。

### 4.2 闭包与高阶函数

函数是一等类型值。当函数作为参数传递时，引擎用函数的类型值表示来求值调用。

### 4.3 递归

递归通过**记忆化 + 拓宽**处理：相同签名的递归调用返回占位符，随后 refining 直到结果达到不动点。

### 4.4 异步 / Promise

Promise 被建模为包装的类型值。`await` 解包 Promise 类型；`async function` 将返回值包装为 `T.promise(...)`。

### 4.5 异常与 throws 追踪

Nudo 将异常作为函数类型的一等部分追踪。每个函数不仅有 `returns` 还有 `throws`——这是 TypeScript 类型系统所不具备的。try-catch 会从函数的 `throws` 中移除被捕获的类型；catch 参数接收到所抛类型的联合。

### 4.6 可变性（引用语义，写时复制）

对象类型值使用**引用语义**。赋值复制引用。进入分支时，对被修改的对象进行深拷贝，使每个分支拥有自己的副本；合并时对属性做联合。

---

## 5. 指令系统

指令是引导引擎的结构化注释，使用 `@nudo:` 命名空间。

| 指令 | 用途 |
|-----------|---------|
| `@nudo:case` | 提供具名执行用例（具体或符号化输入） |
| `@nudo:mock` | 用类型值实现 mock 外部依赖 |
| `@nudo:pure` | 标记函数为纯函数，启用记忆化 |
| `@nudo:skip` | 跳过求值；使用类型注解或 `@nudo:returns` |
| `@nudo:sample` | 不动点之前的循环迭代次数 |
| `@nudo:returns` | 断言预期返回类型 |

---

## 6. 相比 TypeScript 的优势

### 6.1 无需独立的类型语言

值级代码即类型计算。无需学习或维护并行的类型语言。

### 6.2 TypeScript 无法表达的计算

算术、正则、复杂字符串操作在 Nudo 的执行模型中很直接；在 TypeScript 类型系统中则极其困难或不可能。

### 6.3 第三方 JS 库

对有 JS 源码的库，Nudo 可直接执行代码推导类型。对 native 或 opaque 依赖，`@nudo:mock` 提供类型值感知的 stub。

### 6.4 依赖类型

Nudo 自然产生依赖类型（依赖值的类型），无需特殊语法：

```javascript
function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
// clamp(5, 0, 10) → T.literal(5)
// clamp(T.number, 0, 10) → T.number
```

### 6.5 更精确的字符串拼接

Nudo 在字符串拼接中保留结构，产生模板字符串类型：

```javascript
const url = "https://api.example.com" + T.string;
// Nudo: `https://api.example.com${string}`
// TypeScript: string（丢失已知前缀）

url.startsWith("https://")  // Nudo: true | TypeScript: boolean
```

### 6.6 字面量级别的字符串方法推导

Nudo 在编译时对字面量执行字符串方法：

```javascript
"hello".toUpperCase()    // Nudo: "HELLO"     | TS: string
"a,b,c".split(",")      // Nudo: ["a","b","c"]| TS: string[]
"hello".indexOf("l")    // Nudo: 2            | TS: number
```

### 6.7 循环的类型级求值

Nudo 对具体边界的循环求值，计算精确结果：

```javascript
let sum = 0;
for (let i = 0; i < 5; i++) sum += i;
// Nudo: sum → 10 | TS: number
```

### 6.8 用户可扩展的类型精化

用户可通过 `T.refine` 定义自定义精化类型，附加领域特定的运算规则：

```javascript
const Odd = T.refine(T.number, {
  name: "odd",
  check: (v) => Number.isInteger(v) && v % 2 !== 0,
  ops: { "%"(self, other) {
    if (other.kind === "literal" && other.value === 2) return T.literal(1);
    return undefined; // 回退到 T.number 行为
  }},
});
// Odd % 2 → 1（自定义规则）
// Odd + 1 → number（回退到基础类型）
```

---

## 7. 端到端示例：calc

**源码：**

```javascript
/**
 * @nudo:case "concrete" (1, 2)
 * @nudo:case "symbolic" (T.number, T.number)
 */
function calc(a, b) {
  if (a > b) return a - b;
  return a + b;
}
```

**Case "concrete" — `calc(T.literal(1), T.literal(2))`：**
1. 绑定：`a = T.literal(1)`，`b = T.literal(2)`
2. 条件：`a > b` → `T.literal(false)`
3. 走 alternate：`a + b` → `T.literal(3)`
4. 结果：`T.literal(3)`

**Case "symbolic" — `calc(T.number, T.number)`：**
1. 绑定：`a = T.number`，`b = T.number`
2. 条件：`a > b` → `T.boolean`（抽象）
3. 分叉两个分支：
   - True：`a - b` → `T.number`
   - False：`a + b` → `T.number`
4. 合并：`T.number`

**组合：** `((1, 2) => 3) & ((number, number) => number)`

---

## 8. 实现路线图

### 阶段 1：最小可行求值器（已完成）
- Babel 解析、TypeValue 核心、基本 Ops、求值器、窄化、`@nudo:case`、CLI。

### 阶段 2：对象与数组（已完成）
- ObjectType、ArrayType、TupleType、属性访问、`Array.prototype` 方法、`@nudo:mock`。

### 阶段 3：高级特性（已完成）
- 闭包、递归、async/Promise、try-catch、instanceof、`@nudo:pure`、`@nudo:skip`、`@nudo:sample`。

### 阶段 4：工具链（已完成）
- LSP、watch 模式、`.d.ts` 导出、Vite 插件、VS Code 扩展。

### 阶段 5：精化类型值（已完成）
- `RefinedType` 类型种类及 `Refinement` 接口（name、meta、check、ops、methods、properties）。
- 内置模板字符串精化（parts、拼接、startsWith/endsWith/includes、length）。
- 内置数值区间精化（min、max、integer、比较运算符）。
- 用户自定义精化类型 `T.refine`。
- 分派回退链：refined → base → primitive。

### 阶段 6：求值器完善（已完成）
- 完整字符串方法语义（20+ 方法，字面量与抽象）。
- 循环求值与不动点迭代（for、while、do-while）。
- `@nudo:sample` 指令控制循环采样次数。
- 比较窄化到区间类型。

---

## 9. 附录

### 相关工作对比

| 系统 | 方式 | 优势 | 局限 |
|--------|----------|----------|------------|
| TypeScript | 静态分析、结构化类型 | 快速、成熟、生态大 | 独立类型语言、计算能力有限 |
| Flow | 静态分析、名义类型 | 推导好 | 生态衰退 |
| io-ts / zod | 运行时 schema 验证 | 桥接运行时与编译时 | 需手写 schema，非推断 |
| Nudo | 通过执行的抽象解释 | 统一值/类型模型、依赖类型 | 新方案、运算符覆盖工作量 |

### 运算符语义表（非联合）

| 运算符 | Literal × Literal | Literal × Abstract | Abstract × Abstract |
|----------|-------------------|--------------------|---------------------|
| `+`（数值） | `T.literal(a + b)` | `T.number` | `T.number` |
| `+`（字符串） | `T.literal(a + b)` | `T.string` | `T.string` |
| `-`、`*`、`/`、`%` | `T.literal(op(a,b))` | `T.number` | `T.number` |
| `===`、`!==` | `T.literal(a === b)` | `T.boolean` | `T.boolean` |
| `>`、`<`、`>=`、`<=` | `T.literal(op(a,b))` | `T.boolean` | `T.boolean` |
| `typeof` | `T.literal("...")` | `T.literal("...")` | `T.string` |
| `!` | `T.literal(!a)` | `T.boolean` | `T.boolean` |
