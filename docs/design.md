# Nudo 设计文档

> **Nudo** — 一个 JS 超集求值引擎，通过对符号化的"类型值"执行代码来推导精确类型。

## 1. 愿景与核心思想

### 1.1 问题

TypeScript 的类型系统虽然强大，但它运行在一个**独立于 JavaScript 的语言**中。复杂的类型级计算需要"类型体操"——条件类型、映射类型、`infer`、模板字面量类型——这是一套与开发者日常编写的值级 JS 代码完全不同的编程模型。

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

Nudo 既不像 TypeScript 那样静态分析代码，也不像测试那样用具体值运行代码，而是**用符号化的"类型值"来执行代码**——这些特殊对象代表一组可能的值。执行过程本身就产生了类型。

```
传统方式：   源代码  →  静态分析  →  类型
Nudo： 源代码  +  类型值    →  执行  →  类型
```

这不是"通过样例归纳类型"（从有限样本进行归纳推理）。这是**抽象解释（Abstract Interpretation）**——编程语言理论中一种成熟的技术——以开发者熟悉的"运行代码"心智模型呈现。

### 1.3 关键区分：具体执行 vs 符号执行

| 方式 | 输入 | 输出 | 完备性 |
|---|---|---|---|
| 单元测试 | 具体值（`1`, `"hello"`） | 具体结果 | 仅覆盖测试用例 |
| Nudo | 类型值（`T.number`, `T.string`） | 类型值 | 覆盖类型集合中的所有值 |
| TypeScript | AST（不执行） | 类型 | 覆盖所有语法路径 |

当 Nudo 执行 `transform(T.string)` 时，引擎将 `T.string` 在函数体中传播。在 `typeof x === "string"` 处，引擎知道该分支会被进入。在 `x.toUpperCase()` 处，引擎知道结果是 `T.string`。结果不是一个具体值——而是一个**类型**。

---

## 2. 类型值体系（Type Value System）

**类型值（Type Value）** 是整个系统的基础抽象。一个类型值代表一组可能的 JavaScript 值，并且知道如何参与 JS 运算。

### 2.1 类型值层级

```
TypeValue
├── Literal<V>          — 单个具体值：1, "hello", true, null, undefined
├── Primitive<T>        — 某个原始类型的所有可能值：number, string, boolean, bigint, symbol
├── ObjectType          — 具有已知属性类型的对象：{ id: Primitive<number>, name: Literal<"Alice"> }
├── ArrayType           — 具有元素类型的数组：Array<Primitive<number>>
├── TupleType           — 固定长度的数组：[Literal<1>, Primitive<string>]
├── FunctionType        — 具有参数/返回/异常类型的函数：{ params, returns, throws }
├── UnionType           — 类型值的联合：Literal<1> | Literal<2> | Primitive<string>
├── NeverType           — 空集（不可达）
└── UnknownType         — 全集（任意值）
```

### 2.2 设计原则

**原则 1：字面量保留。** 当所有输入都是字面量时，结果也应该是字面量。

```javascript
T.literal(1) + T.literal(2)  // → T.literal(3)，而非 T.number
```

**原则 2：抽象时拓宽。** 当任一输入是抽象的（非字面量），结果拓宽为对应的抽象类型。

```javascript
T.literal(1) + T.number  // → T.number
```

**原则 3：联合类型懒分配。** 对联合类型的运算分配到每个成员上，但采用**懒求值**策略——联合类型作为整体在函数中传播，只在运算符/方法**必须区分成员**时才展开。这避免了笛卡尔积导致的组合爆炸。

```javascript
const a = T.union(T.literal(1), T.literal(2));
const b = T.union(T.literal("x"), T.literal("y"));

// 不展开——成员间无需区分
const arr = [a, b];  // → T.tuple([T.union(T.literal(1), T.literal(2)), T.union(T.literal("x"), T.literal("y"))])

// 展开——运算需要区分成员
const sum = a + b;   // → 展开为 1+"x", 1+"y", 2+"x", 2+"y" → T.union(T.literal("1x"), T.literal("1y"), T.literal("2x"), T.literal("2y"))
```

懒求值天然保持了"同一绑定"的关联性：

```javascript
const a = T.union(T.literal(1), T.literal(2));
const result = a + a;
// 正确：只展开为 1+1, 2+2 → T.union(T.literal(2), T.literal(4))
// 而非错误地展开为 1+1, 1+2, 2+1, 2+2
```

作为兜底，当展开后的联合成员数超过阈值时，拓宽为公共父类型（如大量数值字面量拓宽为 `T.number`）。

**原则 4：守卫窄化。** 类型守卫（typeof、instanceof、真值检查）在分支中窄化类型值。

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
T.boolean                     // 抽象 boolean（等价于 T.union(T.literal(true), T.literal(false))）
T.null                        // 字面量 null
T.undefined                   // 字面量 undefined
T.unknown                     // unknown 类型
T.never                       // never 类型

T.object({ key: TypeValue })  // 对象类型
T.array(TypeValue)            // 数组类型
T.tuple([TypeValue, ...])     // 元组类型
T.union(TypeValue, ...)       // 联合类型
T.fn({ params, returns, throws? })  // 函数类型（throws 默认为 T.never）

// --- 内省 ---
typeValue.kind                 // "literal" | "primitive" | "object" | "array" | "union" | ...
typeValue.contains(other)      // 此类型值的集合是否包含另一个？
typeValue.narrow(guard)        // 经过类型守卫后返回窄化的类型值
typeValue.widen()              // 将字面量拓宽为其原始类型：T.literal(1).widen() → T.number
typeValue.toString()           // 可读表示："number", "1", "string | number"
typeValue.toTSType()           // （可选导出）输出 TypeScript 类型语法
```

### 2.4 类型值上的运算符语义

由于 JavaScript 不支持运算符重载，引擎**不直接执行原始 JS**，而是解释 AST 并通过语义层分派运算：

```typescript
// 引擎将 `a + b` 转换为：
Ops.add(a, b)

// Ops.add 知道如何处理类型值：
function add(left: TypeValue, right: TypeValue): TypeValue {
  // 两个都是字面量 → 计算具体结果
  if (left.kind === "literal" && right.kind === "literal") {
    return T.literal(left.value + right.value);
  }

  // 涉及字符串 → 结果是 string
  if (left.isSubtypeOf(T.string) || right.isSubtypeOf(T.string)) {
    return T.string;
  }

  // 都是数值 → 结果是 number
  if (left.isSubtypeOf(T.number) && right.isSubtypeOf(T.number)) {
    return T.number;
  }

  // 兜底
  return T.union(T.number, T.string);
}

// 联合类型的展开由求值器在调用 Ops 之前统一处理（原则 3：懒分配），
// Ops 本身只需处理非联合的类型值。
```

每个 JS 运算符和内置方法都需要对应的类型值语义规则。这是主要的实现工作量，但它是**有限且定义明确的**——JS 运算符和核心内置方法的集合是固定的。

---

## 3. 求值引擎（Nudo Engine）

### 3.1 架构概览

```
┌─────────────────────────────────────────────────────┐
│                   Nudo Engine                  │
│                                                     │
│  ┌───────────┐   ┌────────────┐   ┌──────────────┐ │
│  │  Parser    │──▶│ Directive  │──▶│  Evaluator   │ │
│  │ (SWC /    │   │ Extractor  │   │ (AST Walker) │ │
│  │  Babel)   │   │            │   │              │ │
│  └───────────┘   └────────────┘   └──────┬───────┘ │
│                                          │         │
│                  ┌───────────────────────┐│         │
│                  │    Ops (Operator &    ││         │
│                  │  Built-in Semantics)  │◀         │
│                  └───────────────────────┘          │
│                                                     │
│  ┌──────────────┐  ┌─────────────┐  ┌───────────┐  │
│  │ Environment  │  │   Branch    │  │   Type    │  │
│  │   (Scope)    │  │  Executor   │  │  Emitter  │  │
│  └──────────────┘  └─────────────┘  └───────────┘  │
└─────────────────────────────────────────────────────┘
```

**组件说明：**

| 组件 | 职责 |
|---|---|
| **Parser** | 将 JS/TS 源码解析为 AST（委托给 SWC 或 Babel） |
| **Directive Extractor** | 从注释中提取 `@nudo:*` 指令 |
| **Evaluator** | 遍历 AST，使用类型值对每个节点求值 |
| **Ops** | 定义所有 JS 运算符和 native 内置方法（如 `Array.prototype.map`、`String.prototype.toUpperCase` 等无 JS 源码可执行的方法）的类型值语义 |
| **Environment** | 管理变量作用域和绑定（变量 → TypeValue） |
| **Branch Executor** | 处理条件分支：分叉、窄化、求值、合并 |
| **Type Emitter** | 将最终的 TypeValue 结果序列化为可读格式（可选导出为 TypeScript 类型） |

### 3.2 求值规则

求值器是一个 AST 遍历器。对于每种 AST 节点类型，都有对应的求值规则：

#### 字面量

```
eval(NumericLiteral { value: 42 })  →  T.literal(42)
eval(StringLiteral { value: "hi" }) →  T.literal("hi")
eval(BooleanLiteral { value: true }) → T.literal(true)
eval(NullLiteral)                   →  T.null
```

#### 变量

```
eval(Identifier { name: "x" })  →  env.lookup("x")
```

#### 二元表达式

```
eval(BinaryExpression { left, op, right })  →  Ops[op](eval(left), eval(right))
```

#### 赋值

```
eval(AssignmentExpression { left: "x", right: expr })
  →  env.bind("x", eval(expr))
```

#### 条件语句（if-else）

这是引擎与普通解释器的关键区别。它不是选择一个分支，而是可能**同时求值两个分支**，各自使用窄化后的类型值：

```
eval(IfStatement { test, consequent, alternate }) →
  let condition = eval(test)

  // 情况 1：条件是已知的字面量
  if condition === T.literal(true)  → eval(consequent)
  if condition === T.literal(false) → eval(alternate)

  // 情况 2：条件涉及类型窄化
  let [envTrue, envFalse] = narrow(env, test)
  let resultTrue  = eval(consequent, envTrue)
  let resultFalse = eval(alternate, envFalse)
  return T.union(resultTrue, resultFalse)
```

#### 函数声明

```
eval(FunctionDeclaration { id: "foo", params, body })
  →  env.bind("foo", TypeValueFunction { params, body, closure: env })
```

#### 函数调用

```
eval(CallExpression { callee: "foo", args })
  →  let fn = env.lookup("foo")
      let argValues = args.map(eval)
      // 创建新环境，将参数绑定到类型值
      let fnEnv = fn.closure.extend(zip(fn.params, argValues))
      eval(fn.body, fnEnv)
```

### 3.3 窄化规则

窄化（Narrowing）是根据条件精炼类型值的过程。引擎支持以下窄化模式：

| 模式 | 窄化为（true 分支） | 窄化为（false 分支） |
|---|---|---|
| `typeof x === "string"` | `x ∩ T.string` | `x - T.string` |
| `typeof x === "number"` | `x ∩ T.number` | `x - T.number` |
| `x === null` | `x ∩ T.null` | `x - T.null` |
| `x === undefined` | `x ∩ T.undefined` | `x - T.undefined` |
| `x === <literal>` | `x ∩ T.literal(v)` | `x - T.literal(v)` |
| `Array.isArray(x)` | `x ∩ T.array(T.unknown)` | `x - T.array(T.unknown)` |
| `x`（真值检查） | `x - T.null - T.undefined - T.literal(0) - T.literal("") - T.literal(false)` | 补集 |
| `x instanceof C` | `x ∩ T.instanceOf(C)` | `x - T.instanceOf(C)` |

其中 `∩` 是类型交集，`-` 是类型差集。

---

## 4. 复杂结构的处理

### 4.1 循环

当循环次数依赖于类型值时，无法具体展开。引擎使用**不动点迭代（Fixed-Point Iteration）**：

```javascript
// 源代码：
let sum = 0;
for (let i = 0; i < arr.length; i++) {
  sum += arr[i];
}
```

策略：
1. 如果 `arr` 是具体元组（如 `T.tuple([T.literal(1), T.literal(2)])`），具体展开循环。
2. 如果 `arr` 是抽象数组（如 `T.array(T.number)`），用 `arr[i]` 为 `T.number` 执行一次循环体，计算 `sum` 类型的不动点：
   - 第 0 次迭代：`sum = T.literal(0)`
   - 第 1 次迭代：`sum = T.union(T.literal(0), T.number)` → `T.number`
   - 第 2 次迭代：`sum = T.number`（达到不动点，停止）

### 4.2 闭包与高阶函数

函数是一等类型值。当函数作为参数传递时，引擎用函数的类型值表示来求值调用：

```javascript
function map(arr, fn) {
  const result = [];
  for (const item of arr) {
    result.push(fn(item));
  }
  return result;
}

// 调用：
map(T.array(T.number), (x) => x + 1)
// 引擎求值：fn(T.number) → T.number + T.literal(1) → T.number
// 结果：T.array(T.number)

// 使用字面量：
map(T.tuple([T.literal(1), T.literal(2)]), (x) => x * 2)
// 引擎展开：fn(T.literal(1)) → T.literal(2), fn(T.literal(2)) → T.literal(4)
// 结果：T.tuple([T.literal(2), T.literal(4)])
```

### 4.3 递归

递归函数通过**记忆化 + 拓宽**处理：

1. 首次以给定类型值签名调用时，记录并开始求值。
2. 如果再次遇到相同签名（递归调用），返回一个**占位符**（`T.unknown`）。
3. 首次求值完成后，用已知的返回类型重新求值。
4. 重复直到返回类型达到不动点。

```javascript
function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

// factorial(T.number)：
// 分支 1（n <= 1）：返回 T.literal(1)
// 分支 2（n > 1）：返回 T.number * factorial(T.number) → T.number * T.number → T.number
// 结果：T.union(T.literal(1), T.number) → 简化为 T.number
```

### 4.4 异步 / Promise

Promise 被建模为包装类型值：

```javascript
async function fetchUser(id) {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
}

// 配合 mock：
// @nudo:mock fetch = (url) => T.promise(T.object({ json: T.fn({ params: [], returns: T.object({ id: T.number, name: T.string }) }) }))
//
// fetchUser(T.number) → T.promise(T.object({ id: T.number, name: T.string }))
```

引擎将 `await` 视为解包 Promise 类型值，将 `async function` 视为将返回值包装为 Promise。

### 4.5 异常与 `throws` 类型

Nudo 将异常视为函数类型的一等属性。每个函数的推导结果不仅包含 `returns`，还包含 `throws`——这是 TypeScript 类型系统不具备的能力。

#### 4.5.1 基本模型

引擎同时追踪抛出的类型值和返回的类型值：

```javascript
function divide(a, b) {
  if (b === 0) throw new Error("Division by zero");
  return a / b;
}

// divide(T.number, T.number)：
// 分支 1（b === 0）：抛出 T.instanceOf(Error)
// 分支 2（b !== 0）：返回 T.number
// 推导结果：
T.fn({
  params: [T.number, T.number],
  returns: T.number,
  throws: T.instanceOf(Error)
})
```

当函数不会抛出异常时，`throws` 为 `T.never`。

#### 4.5.2 throws 的自动传播

当函数 A 调用函数 B 时，B 的 `throws` 自动传播到 A，除非被 `try-catch` 捕获：

```javascript
function riskyCalc(a, b) {
  const result = divide(a, b);  // divide 可能 throw Error
  return result * 2;
}

// riskyCalc 的推导结果：
T.fn({
  params: [T.number, T.number],
  returns: T.number,
  throws: T.instanceOf(Error)  // 从 divide 传播而来
})
```

多个可能抛出异常的调用，其 `throws` 类型自动合并为联合：

```javascript
function combined(input) {
  const data = JSON.parse(input);     // throws SyntaxError
  const result = divide(data.x, data.y); // throws Error
  return result;
}

// combined 的推导结果：
T.fn({
  params: [T.string],
  returns: T.number,
  throws: T.union(T.instanceOf(SyntaxError), T.instanceOf(Error))
})
```

#### 4.5.3 try-catch 消化 throws

`try-catch` 会捕获 `throws`，将其从函数的 `throws` 中移除，同时 `catch` 块中的参数 `e` 被绑定为 `try` 块中所有可能抛出类型的联合：

```javascript
function safeDivide(a, b) {
  try {
    return divide(a, b);
  } catch (e) {
    // e 的类型：T.instanceOf(Error)（来自 divide 的 throws）
    return T.literal(0);
  }
}

// safeDivide 的推导结果：
T.fn({
  params: [T.number, T.number],
  returns: T.union(T.number, T.literal(0)),
  throws: T.never  // throws 被 catch 消化了
})
```

如果 `catch` 块自身又抛出异常，则该异常成为新的 `throws`：

```javascript
function rethrow(a, b) {
  try {
    return divide(a, b);
  } catch (e) {
    throw new TypeError("Invalid operation");
  }
}

// rethrow 的推导结果：
T.fn({
  params: [T.number, T.number],
  returns: T.number,
  throws: T.instanceOf(TypeError)  // 原始 Error 被消化，新的 TypeError 产生
})
```

#### 4.5.4 隐式 throws（JS 内置行为）

JS 中许多操作会隐式抛出异常，引擎在 Ops 层识别这些情况：

| 操作 | 行为 |
|---|---|
| `null.prop` / `undefined.prop` | throws `TypeError` |
| `JSON.parse(badInput)` | throws `SyntaxError` |
| `decodeURI(badURI)` | throws `URIError` |
| `new Array(-1)` | throws `RangeError` |
| `arr[-1]` | 不抛异常，返回 `T.undefined` |
| `({}).missingProp` | 不抛异常，返回 `T.undefined` |

当操作数是抽象类型值时，引擎需要判断是否**可能**抛出异常。例如：

```javascript
function access(obj) {
  return obj.name;
}

// access(T.union(T.object({ name: T.string }), T.null))：
// 分支 1（obj 是对象）：返回 T.string
// 分支 2（obj 是 null）：throws TypeError
// 推导结果：
T.fn({
  params: [T.union(T.object({ name: T.string }), T.null)],
  returns: T.string,
  throws: T.instanceOf(TypeError)
})
```

#### 4.5.5 finally 块

`finally` 块始终执行，其中的 `return` 会覆盖 `try`/`catch` 的返回值，其中的 `throw` 会覆盖之前的异常：

```javascript
function withFinally() {
  try {
    return divide(T.number, T.number);
  } finally {
    cleanup(); // cleanup 的 throws 会传播到 withFinally
  }
}
```

### 4.6 可变性追踪

对象类型值在引擎中使用**引用语义**，与 JS 的实际行为一致。赋值只复制引用，多个变量可以指向同一个对象类型值。只在分支分叉时才对被修改的对象进行深拷贝。

#### 4.6.1 引用语义

```javascript
const a = { x: T.literal(1) };
const b = a;  // b 和 a 指向同一个对象类型值
b.x = T.literal(2);
// a.x 也变为 T.literal(2)——符合 JS 语义
```

#### 4.6.2 分支中的写时复制

当执行进入条件分支时，引擎对当前环境做快照。分支内对对象的修改作用于深拷贝的副本，不影响另一个分支。分支合并时，将两个副本的属性类型联合：

```javascript
const obj = { x: T.literal(1), y: T.literal(2) };

if (condition) {
  obj.x = T.literal(10);
  // 此分支中 obj = { x: T.literal(10), y: T.literal(2) }
} else {
  obj.x = T.literal(20);
  // 此分支中 obj = { x: T.literal(20), y: T.literal(2) }
}

// 合并后 obj = { x: T.union(T.literal(10), T.literal(20)), y: T.literal(2) }
```

#### 4.6.3 线性修改

没有分支时，不需要复制，直接就地修改，无额外开销：

```javascript
const obj = { x: T.literal(1) };
obj.x = T.literal(2);
obj.y = T.literal(3);
// obj = { x: T.literal(2), y: T.literal(3) }
```

#### 4.6.4 别名与分支的交互

当存在别名且进入分支时，深拷贝需要保持别名关系：

```javascript
const a = { x: T.literal(1) };
const b = a;

if (condition) {
  b.x = T.literal(10);
  // 此分支中 a.x 和 b.x 都是 T.literal(10)（a 和 b 仍指向同一对象）
} else {
  // 此分支中 a.x 和 b.x 都是 T.literal(1)
}

// 合并后 a.x = b.x = T.union(T.literal(1), T.literal(10))
```

实现要点：分支分叉时的深拷贝以**对象标识**为单位，而非以变量为单位。同一个对象只拷贝一次，所有指向它的变量在新分支中指向同一个副本。

---

## 5. 指令系统（`@nudo:*`）

指令是引导引擎行为的结构化注释。它们位于 JSDoc 风格的块注释中，使用 `@nudo:` 命名空间以避免冲突。

### 5.1 `@nudo:case` — 提供输入样例

定义一个具名执行用例，可使用具体值或符号化的类型值。

```javascript
/**
 * @nudo:case "positive numbers" (5, 3)
 * @nudo:case "negative result" (1, 10)
 * @nudo:case "symbolic" (T.number, T.number)
 */
function subtract(a, b) {
  return a - b;
}

// Case "positive numbers"：subtract(5, 3) → T.literal(2)
// Case "negative result"： subtract(1, 10) → T.literal(-9)
// Case "symbolic"：        subtract(T.number, T.number) → T.number
// 组合类型：((5, 3) => 2) & ((1, 10) => -9) & ((number, number) => number)
```

当没有提供 `@nudo:case` 时，引擎从 TypeScript 注解推断输入类型（如果有的话），否则每个参数默认为 `T.unknown`。

### 5.2 `@nudo:mock` — Mock 外部依赖

在求值期间将函数或模块替换为类型值感知的 mock 实现。

```javascript
/**
 * @nudo:mock fetch = (url: T.string) => T.promise(T.object({
 *   ok: T.boolean,
 *   json: T.fn({ params: [], returns: T.object({ id: T.number, name: T.string }) })
 * }))
 */

/**
 * @nudo:mock fs from "./mocks/fs.js"
 */
```

Mock 的作用是为引擎无法直接执行的外部依赖提供类型值级别的替代实现。与静态的类型声明不同，Mock 本身就是可执行的代码，因此它们可组合、可测试，并且能表达任意复杂的类型逻辑。

### 5.3 `@nudo:pure` — 标记纯函数

启用记忆化。引擎对相同类型值输入的结果进行缓存。

```javascript
/**
 * @nudo:pure
 */
function add(a, b) {
  return a + b;
}
```

### 5.4 `@nudo:skip` — 跳过求值

指示引擎跳过函数体的求值，直接使用已有的类型信息（TypeScript 注解或 `@nudo:returns` 指定的类型）。

```javascript
/**
 * @nudo:skip
 */
function heavyComputation(data: number[]): number {
  // ... 复杂算法 ...
}
// 引擎从返回类型注解得到 T.number，不求值函数体
```

### 5.5 `@nudo:sample` — 循环采样

控制引擎在切换到不动点分析之前，对循环求值多少次迭代。

```javascript
/**
 * @nudo:sample 10
 */
for (let i = 0; i < arr.length; i++) {
  // 引擎求值 10 次具体迭代，然后泛化
}
```

### 5.6 `@nudo:returns` — 断言预期类型

验证指令。求值完成后，引擎检查推导出的类型是否满足谓词。

```javascript
/**
 * @nudo:returns (type) => type.isSubtypeOf(T.union(T.number, T.string))
 */
function process(x) { /* ... */ }
```

这对于测试引擎本身以及文档化类型契约都很有用。

---

## 6. 相比 TypeScript 的优势

### 6.1 无需独立的类型语言

TypeScript 要求学习两种语言：JavaScript 用于值，TypeScript 类型语言用于类型。Nudo 将它们统一——值级代码本身就是类型计算。

**TypeScript：**
```typescript
// 值层面
function repeat(s: string, n: number): string {
  return s.repeat(n);
}

// 类型层面（要获得精确的字面量类型）
type Repeat<S extends string, N extends number, Acc extends string = ""> =
  N extends 0 ? Acc :
  Repeat<S, Subtract<N, 1>, `${Acc}${S}`>;
// （还需要一个单独的 Subtract 类型工具等等……）
```

**Nudo：**
```javascript
function repeat(s, n) {
  return s.repeat(n);
}
// repeat(T.literal("ab"), T.literal(3)) → T.literal("ababab")
// repeat(T.string, T.number) → T.string
// 不需要单独的类型级代码。
```

### 6.2 TypeScript 无法表达的计算

TypeScript 的类型系统无法在类型层面执行算术运算、正则匹配或复杂的字符串操作（或只能以极其困难的方式实现）。

```javascript
function parseVersion(str) {
  const [major, minor, patch] = str.split(".").map(Number);
  return { major, minor, patch };
}

// Nudo：
// parseVersion(T.literal("1.2.3"))
// → T.object({ major: T.literal(1), minor: T.literal(2), patch: T.literal(3) })

// TypeScript 无法在类型层面计算这个。
```

### 6.3 第三方 JS 库

对于有 JS 源码的第三方库，Nudo 可以直接执行其代码来推导类型，不需要 `.d.ts`。对于 native 模块或引擎无法直接执行的依赖，则通过 `@nudo:mock` 提供类型值级别的替代实现：

```javascript
// 有 JS 源码的库——直接执行推导
import { groupBy } from "lodash-es";

const result = groupBy(
  T.array(T.object({ type: T.union(T.literal("a"), T.literal("b")), value: T.number })),
  "type"
);
// 引擎执行 lodash-es 的 groupBy 源码，推导出：
// → T.object({ a: T.array(...), b: T.array(...) })

// native 模块——通过 mock 提供类型
/* @nudo:mock fs from "./mocks/fs.js" */
```

### 6.4 精确的依赖类型

Nudo 天然产生依赖类型（依赖于值的类型），无需任何特殊语法：

```javascript
function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

// clamp(T.literal(5), T.literal(0), T.literal(10)) → T.literal(5)
// clamp(T.literal(-3), T.literal(0), T.literal(10)) → T.literal(0)
// clamp(T.number, T.literal(0), T.literal(10)) → T.number
```

---

## 7. 端到端示例

让我们完整追踪一个示例，展示引擎的工作过程。

### 源代码

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

### 求值过程：Case "concrete" — `calc(T.literal(1), T.literal(2))`

```
1. 进入函数，绑定：a = T.literal(1), b = T.literal(2)
2. 求值条件：a > b → T.literal(1) > T.literal(2) → T.literal(false)
3. 条件为 T.literal(false) → 跳过 consequent，求值 alternate
4. 求值：a + b → T.literal(1) + T.literal(2) → T.literal(3)
5. 返回：T.literal(3)

推导签名：(1, 2) => 3
```

### 求值过程：Case "symbolic" — `calc(T.number, T.number)`

```
1. 进入函数，绑定：a = T.number, b = T.number
2. 求值条件：a > b → T.number > T.number → T.boolean（抽象）
3. 条件是抽象的 → 分叉为两个分支：

   TRUE 分支（a > b）：
     窄化：a = T.number, b = T.number（> 运算无法进一步窄化）
     求值：a - b → T.number - T.number → T.number
     返回：T.number

   FALSE 分支（a <= b）：
     窄化：a = T.number, b = T.number
     求值：a + b → T.number + T.number → T.number
     返回：T.number

4. 合并分支：T.union(T.number, T.number) → T.number
5. 返回：T.number

推导签名：(number, number) => number
```

### 组合结果

引擎输出 Nudo 自有的类型值表示：

```
calc: T.fn([
  {
    params: [T.literal(1), T.literal(2)],
    returns: T.literal(3),
    throws: T.never
  },
  {
    params: [T.number, T.number],
    returns: T.number,
    throws: T.never
  }
])
```

可读形式：`((1, 2) => 3) & ((number, number) => number)`

---

## 8. 实现路线图

### 阶段 1：最小可行求值器

**目标：** 验证核心概念可行。

**范围：**
- 使用 Babel/SWC 解析 JS
- 实现 TypeValue 核心类型：Literal, Primitive（number, string, boolean）, Union, Never
- 实现运算符语义：`+`, `-`, `*`, `/`, `%`, `===`, `!==`, `>`, `<`, `>=`, `<=`, `typeof`, `!`
- 实现求值器：字面量、变量、二元表达式、if-else、函数声明、函数调用、return 语句
- 实现窄化：`typeof x === "..."`、`x === literal`
- 实现 `@nudo:case` 指令解析
- 输出 Nudo 类型值的可读表示

**交付物：** 一个 CLI 工具，接受 `.js` 文件并输出推导的类型值。

**预估工作量：** ~2-4 周

### 阶段 2：对象与数组支持

**目标：** 处理真实世界的数据结构。

**范围：**
- 实现 ObjectType, ArrayType, TupleType
- 属性访问、解构、展开运算符
- `Array.prototype` 方法：`map`, `filter`, `reduce`, `find`, `some`, `every`, `push`, `length`
- `Object.keys`, `Object.values`, `Object.entries`
- for-of 循环、for-in 循环
- 实现 `@nudo:mock` 指令

**预估工作量：** ~3-5 周

### 阶段 3：高级特性

**目标：** 处理复杂的真实世界模式。

**范围：**
- 闭包和高阶函数
- 递归与不动点
- async/await 和 Promise 建模
- try-catch 和异常类型追踪
- 类实例和 `instanceof`
- 模板字面量
- 正则表达式（基础）
- `@nudo:pure`, `@nudo:skip`, `@nudo:sample` 指令
- 模块导入/导出

**预估工作量：** ~4-8 周

### 阶段 4：工具链与集成

**目标：** 使其在真实开发工作流中可用。

**范围：**
- LSP（Language Server Protocol）实现，用于 IDE 集成
- Watch 模式与增量重新求值
- Source map 支持，用于错误报告
- （可选）TypeScript `.d.ts` 文件导出，便于与 TS 生态互操作
- 与现有构建工具集成（Vite, esbuild, webpack）
- VS Code / Cursor 扩展

**预估工作量：** ~4-6 周

### 技术选型

| 组件 | 推荐方案 | 理由 |
|---|---|---|
| 解析器 | **SWC**（Babel 作为备选） | SWC 速度快，JS/TS 支持好；Babel 插件生态更丰富 |
| AST 格式 | **Babel 兼容 AST** | 文档完善，广泛使用，工具丰富 |
| 实现语言 | **TypeScript** | 自举（dogfooding）；目标用户写 TS；适合原型开发 |
| 运行时 | **Node.js** | JS 工具链的标准选择 |
| 测试框架 | **Vitest** | 快速、现代、TS 支持好 |

---

## 9. 未来方向

- **增量求值：** 文件修改后只重新求值受影响的函数，而非整个文件。这对 IDE 实时反馈至关重要。
- **REPL：** 交互式环境，开发者可以直接输入表达式，实时看到类型值推导结果。与"通过执行理解类型"的心智模型天然契合。
- **Ops 社区扩展：** 内置方法的类型值语义（Ops）数量庞大，可以设计插件机制让社区贡献，如 `@nudojs/ops-lodash`、`@nudojs/ops-rxjs` 等。
- **类型值可视化：** 对于复杂的联合类型、嵌套对象类型，提供树状/图形化的可视化展示，帮助开发者理解推导结果。
- **求值追踪（Trace）：** 类似 debugger，展示类型值在函数中的传播路径，帮助开发者理解"为什么推导出了这个类型"。

---

## 附录 A：相关工作对比

| 系统 | 方式 | 优势 | 局限 |
|---|---|---|---|
| **TypeScript** | 结构化类型的静态分析 | 快速、成熟、庞大生态 | 独立类型语言，计算能力有限 |
| **Flow** | 名义类型的静态分析 | 推导能力好 | 生态衰退 |
| **Hegel** | 健全类型的静态分析 | 健全性保证 | 采用率低 |
| **io-ts / zod** | 运行时验证 schema | 桥接运行时和编译时 | 手动定义 schema，非推导 |
| **QuickCheck / fast-check** | 基于属性的测试 | 擅长发现边界情况 | 测试属性，非类型 |
| **Pyright** | Python 的静态分析 | 优秀的类型窄化 | Python 专用 |
| **Nudo** | 通过执行进行抽象解释 | 统一的值/类型模型，精确依赖类型 | 全新方案，未经验证，运算符覆盖工作量 |

## 附录 B：完整运算符语义表

联合类型的展开由求值器统一处理（原则 3），下表仅列出非联合类型值之间的运算语义。

| 运算符 | Literal × Literal | Literal × Abstract | Abstract × Abstract |
|---|---|---|---|
| `+`（数值） | `T.literal(a + b)` | `T.number` | `T.number` |
| `+`（字符串拼接） | `T.literal(a + b)` | `T.string` | `T.string` |
| `-`, `*`, `/`, `%` | `T.literal(op(a, b))` | `T.number` | `T.number` |
| `===` | `T.literal(a === b)` | `T.boolean` | `T.boolean` |
| `!==` | `T.literal(a !== b)` | `T.boolean` | `T.boolean` |
| `>`, `<`, `>=`, `<=` | `T.literal(op(a, b))` | `T.boolean` | `T.boolean` |
| `&&` | 短路求值 | 窄化感知 | `T.union(falsy_type, right_type)` |
| `\|\|` | 短路求值 | 窄化感知 | `T.union(left_type, right_type)` |
| `??` | 短路求值 | 窄化感知 | `T.union(non_nullish_left, right_type)` |
| `typeof` | `T.literal("...")` | `T.literal("...")` | `T.string`（已知子集） |
| `!` | `T.literal(!a)` | `T.boolean` | `T.boolean` |
| `in` | `T.literal(bool)` | `T.boolean` | `T.boolean` |
| `instanceof` | `T.literal(bool)` | `T.boolean` | `T.boolean` |

**属性访问语义：**

| 操作 | 结果 | throws |
|---|---|---|
| `T.object({ x: V }).x` | `V` | — |
| `T.object({}).x` | `T.undefined` | — |
| `T.null.x` / `T.undefined.x` | — | `T.instanceOf(TypeError)` |
| `T.array(V)[T.number]` | `T.union(V, T.undefined)` | — |
| `T.tuple([A, B])[T.literal(0)]` | `A` | — |
