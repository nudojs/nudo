---
sidebar_position: 1
description: "Nudo 设计内幕：Abs = shape × term × pred × conf 作为类型系统，TypeValue 作为评估 IR，指令系统与抽象解释。"
---

# 设计文档

> **Nudo** — 面向 JavaScript 的类型推断引擎。类型系统是 **Abs**（`shape × term × pred × conf`）——类型是可计算值，携带约束并参与代数。**TypeValue** 是评估 IR（环境绑定、dts/LSP/序列化），不是平行类型系统；Abs ⇄ TypeValue 经有损 bridge。

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

Nudo 既不像 TypeScript 那样静态分析代码，也不像测试那样用具体值运行代码，而是**用抽象值（Abs）执行代码**——类型携带 shape、符号项与约束。执行本身产生类型；约束随运算传播（`x>0` ⇒ `x+1>1`）。

```text
传统方式：   源代码  →  静态分析  →  类型
Nudo：       源代码  +  Abs     →  执行  →  类型 + 约束
```

这不是「通过样例归纳类型」。这是**抽象解释（Abstract Interpretation）**——以「运行代码」这一熟悉心智模型呈现。

### 1.3 关键区分：具体执行 vs 符号执行

| 方式 | 输入 | 输出 | 完备性 |
|----------|-------|--------|--------------|
| 单元测试 | 具体值（`1`、`"hello"`） | 具体结果 | 仅覆盖测试用例 |
| Nudo | Abs（shape × term × pred） | Abs（展示时投影为 TypeValue） | 覆盖抽象集合中的所有值 |
| TypeScript | AST（不执行） | 类型 | 覆盖所有语法路径 |

---

## 2. 类型系统：Abs 与 TypeValue IR

### 2.1 Abs —— 类型系统本体

**Abs** 是唯一类型系统：`shape × term × pred × conf`。

| 分量 | 含义 |
|-----------|---------|
| **shape** | 结构种类：`any` / `unknown` / `prim` / `obj` / `arr` / `tuple` / `fn` / `brand` / `eff` / `sum` / `never` |
| **term** | 值的符号身份：字面量、变量或应用（`x+1`） |
| **pred** | 相对 term 的约束：`x>0`、合取等 |
| **conf** | 置信度：`exact` / `path` / `widened` / `partial` / `opaque` |

`any` 表示「任意 JS 值」（无约束参数）；`unknown` 表示「分析拿不到信息」。二者不同。

Abs 上的运算是代数的：单调算术、比较、`leq` 可赋值、谓词蕴含。`nudo check` 是这套代数上的 CI 门禁（金标 recall = precision = 1.0）。

### 2.2 TypeValue —— 评估 IR（不是第二套类型系统）

TypeValue 供环境绑定、dts、LSP hover 外延侧与序列化消费。它是 Abs 的**投影**（`bridge.ts` 的 `absToTypeValue` / `typeValueToAbs`）。bridge 有损：非字面量 term 与无法 encode 的 pred 会丢；丢信息时不得假装 `exact`。

```text
TypeValue
├── Literal<V>          — 单个具体值
├── Primitive<T>        — 某基本类型的所有可能值
├── RefinedType         — 基础类型的精化子集（IR 原语；源码契约用 @nudo:refine）
├── ObjectType          — 具有已知属性类型的对象
├── ArrayType / TupleType
├── FunctionType
├── UnionType
├── NeverType / UnknownType
```

### 2.3 设计原则

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

```text
parser ──▶ core
            ├── algebra/     ← 类型本体（Abs / Term / Pred / Φ / check）
            ├── type-value   ← 评估 IR
            ├── ops          ← 代数未覆盖的语言表面
            └── bridge       ← Abs ⇄ TypeValue（有损）
                 │
                 ▼
            service/evaluator    ← AST 抽象解释；算术先走 Abs
                 │
                 ▼
            service / lsp / vite / dts
```

| 组件 | 职责 |
|-----------|-----------|
| **Parser** | 将 JS/TS 源码解析为 AST（Babel） |
| **Directive Extractor** | 提取 `@nudo:*`；refine/import 在 core 解析 |
| **algebra (Abs)** | 类型即计算：eval / check / leq / generalize |
| **Evaluator（TypeValue 路径）** | import/env/复杂 mock 文件的回落 AST walker |
| **Ops** | 代数未覆盖的运算符残差语义 |
| **bridge** | Abs → TypeValue（dts/LSP/序列化） |
| **Environment** | 变量绑定（名称 → TypeValue 或 Abs seed） |

### 3.2 求值规则

求值器是一个 AST 遍历器。对每种节点类型有对应规则：

**字面量：**
```text
eval(NumericLiteral 42)  →  T.literal(42)
eval(StringLiteral "hi") →  T.literal("hi")
eval(NullLiteral)       →  T.null
```

**变量：**
```text
eval(Identifier "x")  →  env.lookup("x")
```

**二元表达式：**
```text
eval(BinaryExpression { left, op, right })  →  Ops[op](eval(left), eval(right))
```

**条件语句（if-else）：** 引擎可能**同时求值两个分支**，各自使用窄化后的类型值，再合并：

```text
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
| `@nudo:skip` | 跳过求值；可选的类型表达式直接声明返回类型（如 `@nudo:skip T.number`） |
| `@nudo:sample` | 不动点之前的循环迭代次数 |
| `@nudo:refine` | 精化契约：`@nudo:refine param name` / `@nudo:refine return name`（Pred 进入 Abs） |
| `@nudo:env` | 声明运行时环境 API（文件级 `///` 注释） |
| `@nudo:mock-module` | 用 mock 文件替换导入的模块（文件级 `///` 注释） |
| `@nudo:as` | 覆盖下一条语句的值类型（行注释 `//`） |
| `@nudo:replace` | 替换下一条语句中子表达式的类型（行注释 `//`） |

每个指令的完整语法与约束见[指令参考](../concepts/directives.md)。

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
"hello".slice(1, 3)      // Nudo: "el"        | TS: string
"hello".startsWith("he") // Nudo: true        | TS: boolean
"a,b,c".split(",")       // Nudo: ["a","b","c"] | TS: string[]
```

### 6.7 循环的类型级求值

Nudo 对具体边界的循环求值，计算精确结果：

```javascript
let sum = 0;
for (let i = 0; i < 5; i++) sum += i;
// Nudo: sum → 10 | TS: number
```

### 6.8 声明式精化（无需类型语法）

用户侧契约用 `@nudo:refine` 和 `*.nudo.js` 模板声明——不是 `interface` / `type`，也不在源码里写 `T.refine`：

```javascript
// shapes.nudo.js
export const positive = number().gt(0);
export const user = shape({ id: number().gt(0), name: string() });

// app.js
/// @nudo:import { positive, user } from "./shapes.nudo.js"

/**
 * @nudo:refine x positive
 * @nudo:refine return positive
 */
function inc(x) {
  return x + 1;
}
```

Pred 进入 Abs 并参与代数（`x>0` ⇒ `x+1>1`）。`T.refine` 是这些模板 lowering 到的 TypeValue-IR 原语，不是源码级 API。

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

### 已完成
- **求值器 MVP** — Babel、TypeValue IR、ops、窄化、`@nudo:case`、CLI `infer`。
- **对象/数组** — 对象、数组、元组、Array 方法、`@nudo:mock`。
- **高级语言特性** — 闭包、递归预算、async/Promise、try-catch、类。
- **工具链** — LSP、watch、`.d.ts`、Vite 插件、VS Code 扩展。
- **精化 IR** — 模板/区间精化；源码契约 `@nudo:refine`。
- **Abs 代数（单轨）** — Term/Pred/Abs、算术核、`leqAbs`、generalize、`nudo check` / `nudo types` / `nudo test`、CheckJson、金标（recall = precision = 1.0）。
- **调用预算** — depth/cycle/total 守卫，递归 check 不再栈溢出。

### 待做
- emit 经 tsc 往返；harvest 自动化
- esbuild / webpack 插件；错误定位 source map

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
