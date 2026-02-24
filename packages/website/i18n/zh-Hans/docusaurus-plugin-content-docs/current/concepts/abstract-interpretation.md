---
sidebar_position: 2
---

# 抽象解释

抽象解释是 Nudo 的理论基础。与使用具体值运行代码（如单元测试）或不运行代码仅分析代码（如 TypeScript）不同，Nudo **使用符号化的类型值执行代码**——执行过程本身产生类型。

## 三种方法对比

| 方法 | 输入 | 输出 | 完备性 |
|----------|-------|--------|--------------|
| 单元测试 | 具体值（`1`、`"hello"`） | 具体结果 | 仅覆盖测试用例 |
| Nudo | 类型值（`T.number`、`T.string`） | 类型值 | 类型集合中的所有值 |
| TypeScript | AST（不执行） | 类型 | 所有语法路径 |

当 Nudo 执行 `transform(T.string)` 时，引擎会将 `T.string` 在函数体中传播。在 `typeof x === "string"` 处，引擎知道该分支会被执行。在 `x.toUpperCase()` 处，引擎知道结果是 `T.string`。结果不是具体值——而是**类型**。

---

## 求值引擎架构

```
┌─────────────────────────────────────────────────────┐
│                   Nudo Engine                        │
│                                                     │
│  ┌───────────┐   ┌────────────┐   ┌──────────────┐ │
│  │  Parser   │──▶│ Directive  │──▶│  Evaluator   │ │
│  │ (Babel)   │   │ Extractor  │   │ (AST Walker) │ │
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

| 组件 | 职责 |
|-----------|----------------|
| **Parser** | 将 JS/TS 源码解析为 AST（委托给 Babel） |
| **Directive Extractor** | 从注释中提取 `@nudo:*` 指令 |
| **Evaluator** | 遍历 AST，用类型值求值每个节点 |
| **Ops** | 定义所有 JS 运算符和内置方法的类型值语义 |
| **Environment** | 管理变量作用域和绑定（name → TypeValue） |
| **Branch Executor** | 处理条件分支：分叉、窄化、求值、合并 |
| **Type Emitter** | 序列化最终 TypeValue 结果（可选导出为 TypeScript 类型） |

---

## 求值规则

求值器是一个 AST 遍历器。每种 AST 节点类型都有对应的求值规则。

### 字面量

```
eval(NumericLiteral { value: 42 })   →  T.literal(42)
eval(StringLiteral { value: "hi" })  →  T.literal("hi")
eval(BooleanLiteral { value: true }) →  T.literal(true)
eval(NullLiteral)                    →  T.null
```

### 变量

```
eval(Identifier { name: "x" })  →  env.lookup("x")
```

### 二元表达式

```
eval(BinaryExpression { left, op, right })  →  Ops[op](eval(left), eval(right))
```

### 赋值

```
eval(AssignmentExpression { left: "x", right: expr })
  →  env.bind("x", eval(expr))
```

### 条件语句（if-else）

这是引擎与普通解释器根本不同的地方。它不会选择单一分支，而可能**同时求值两个分支**，并使用窄化后的类型值：

```
eval(IfStatement { test, consequent, alternate }) →
  condition = eval(test)

  // Case 1: condition is a known literal
  if condition === T.literal(true)  → eval(consequent)
  if condition === T.literal(false) → eval(alternate)

  // Case 2: condition is abstract → fork both branches
  [envTrue, envFalse] = narrow(env, test)
  resultTrue  = eval(consequent, envTrue)
  resultFalse = eval(alternate, envFalse)
  return T.union(resultTrue, resultFalse)
```

### 函数声明

```
eval(FunctionDeclaration { id: "foo", params, body })
  →  env.bind("foo", TypeValueFunction { params, body, closure: env })
```

### 函数调用

```
eval(CallExpression { callee: "foo", args })
  →  fn = env.lookup("foo")
     argValues = args.map(eval)
     fnEnv = fn.closure.extend(zip(fn.params, argValues))
     eval(fn.body, fnEnv)
```

---

## 窄化规则

窄化根据条件细化类型值。引擎支持以下模式：

| 模式 | True 分支 | False 分支 |
|---------|-------------|--------------|
| `typeof x === "string"` | `x ∩ T.string` | `x - T.string` |
| `typeof x === "number"` | `x ∩ T.number` | `x - T.number` |
| `x === null` | `x ∩ T.null` | `x - T.null` |
| `x === undefined` | `x ∩ T.undefined` | `x - T.undefined` |
| `x === <literal>` | `x ∩ T.literal(v)` | `x - T.literal(v)` |
| `Array.isArray(x)` | `x ∩ T.array(T.unknown)` | `x - T.array(T.unknown)` |
| `x`（真值检查） | `x - T.null - T.undefined - T.literal(0) - T.literal("") - T.literal(false)` | complement |
| `x instanceof C` | `x ∩ T.instanceOf(C)` | `x - T.instanceOf(C)` |

其中 `∩` 为类型交集，`-` 为类型减法。

---

## 高级行为

### 循环（不动点迭代）

当循环次数依赖类型值时，引擎使用不动点迭代：

1. 若数组是具体 tuple，则展开循环。
2. 若数组是抽象的，则用元素类型执行一次循环体，并迭代直到变量类型趋于稳定：
   - 迭代 0：`sum = T.literal(0)`
   - 迭代 1：`sum = T.union(T.literal(0), T.number)` → `T.number`
   - 迭代 2：`sum = T.number`（达到不动点，停止）

### 闭包与高阶函数

函数是一等的类型值。当函数作为参数传入时，引擎使用其类型值表示来求值调用：

```javascript
map(T.array(T.number), (x) => x + 1)
// Engine evaluates: fn(T.number) → T.number + T.literal(1) → T.number
// Result: T.array(T.number)
```

### 递归（记忆化 + 拓宽）

1. 首次以给定类型值 signature 调用：记录并开始求值。
2. 若再次遇到相同 signature（递归调用）：返回占位符（`T.unknown`）。
3. 首次求值完成后，用已知返回类型重新求值。
4. 重复直到返回类型达到不动点。

### Async / Promise

Promise 建模为包装后的类型值：
- `await expr` 将 `T.promise(V)` 解包为 `V`
- `async function` 将返回值包装在 `T.promise(...)` 中

### 异常与 throws 追踪

Nudo 将异常视为函数类型的一等属性。每个函数的推断类型都同时包含 `returns` 和 `throws`：

```javascript
function divide(a, b) {
  if (b === 0) throw new Error("Division by zero");
  return a / b;
}
// divide(T.number, T.number):
//   returns: T.number
//   throws: T.instanceOf(Error)
```

`try-catch` 吸收抛出的类型。catch 参数接收 try 块中所有抛出类型的联合。若函数从不抛出，则 `throws` 为 `T.never`。

### 可变性（引用语义、写时复制）

对象类型值使用**引用语义**——赋值复制引用而非值。多个变量可以指向同一对象类型值。

进入条件分支时，引擎会对被修改对象进行深拷贝，使每个分支拥有自己的副本。合并时，重叠属性变为联合类型。若无分支，则就地应用变更，无额外开销。
