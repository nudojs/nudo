---
sidebar_position: 2
description: 解释 Nudo 如何用符号化类型值执行代码——求值引擎、窄化与合并背后的抽象解释模型。
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

```text
┌─────────────────────────────────────────────────────┐
│                   Nudo Engine                        │
│                                                     │
│  ┌───────────┐   ┌────────────┐   ┌──────────────┐ │
│  │  Parser   │──▶│ Directive  │──▶│  Evaluator   │ │
│  │ (Babel)   │   │ Extractor  │   │ (AST Walker) │ │
│  └───────────┘   └────────────┘   └──────┬───────┘ │
│                                          │         │
│                  ┌───────────────────────┐│         │
│                  │  algebra surface /   ││         │
│                  │  arithmetic / route  │◀         │
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
| **Evaluator** | B-path 转译+执行（ast-eval 回退）：用 Abs 求值每个节点 |
| **surface / arithmetic / abs-route** | 在 Abs 上定义算术、比较、一元、spread 的运算符语义 |
| **Environment** | 管理变量作用域和绑定（name → Abs） |
| **Branch Executor** | 处理条件分支：分叉、窄化、求值、合并 |
| **Type Emitter** | 序列化最终 Abs 结果（可选导出为 TypeScript 类型） |

---

## 求值规则

求值器用 **Abs** 值执行函数体。主 B 路径把源码转译后直接用 Abs 操作数运行；ast-eval 回退路径用同样的 Abs 规则直接遍历 AST。每种 AST 节点类型都有对应的求值规则。

### 字面量

```text
eval(NumericLiteral { value: 42 })   →  numLit(42)
eval(StringLiteral { value: "hi" })  →  strLit("hi")
eval(BooleanLiteral { value: true }) →  boolLit(true)
eval(NullLiteral)                    →  null Abs
```

### 变量

```text
eval(Identifier { name: "x" })  →  env.vars.get("x")
```

### 二元表达式

```text
eval(BinaryExpression { left, op, right })  →  tryAbsBinary(op, eval(left), eval(right))
```

### 赋值

```text
eval(AssignmentExpression { left: "x", right: expr })
  →  env = withVar(env, "x", eval(expr))
```

### 条件语句（if-else）

这是引擎与普通解释器根本不同的地方。它不会选择单一分支，而可能**同时求值两个分支**，并使用窄化后的 Abs 值：

```text
eval(IfStatement { test, consequent, alternate }) →
  condition = eval(test)

  // Case 1: condition is a known literal
  if isDefinitelyTrue(condition)   → eval(consequent)
  if isDefinitelyFalse(condition)  → eval(alternate)

  // Case 2: condition is abstract → fork both branches
  [envTrue, envFalse] = narrow(env, test)
  resultTrue  = eval(consequent, envTrue)
  resultFalse = eval(alternate, envFalse)
  return joinAbs(resultTrue, resultFalse)
```

### 函数声明

```text
eval(FunctionDeclaration { id: "foo", params, body })
  →  env.fns.set("foo", absFunction(params, { body, closure: env }))
```

### 函数调用

```text
eval(CallExpression { callee: "foo", args })
  →  fn = env.fns.get("foo")
     argValues = args.map(eval)
     fnEnv = fn.closure.extend(zip(fn.params, argValues))
     eval(fn.body, fnEnv)
```

---

## 窄化规则

窄化根据条件细化值。引擎支持以下模式：

| 模式 | True 分支 | False 分支 |
|---------|-------------|--------------|
| `typeof x === "string"` | `x ∩ string` | `x - string` |
| `typeof x === "number"` | `x ∩ number` | `x - number` |
| `x === null` | `x ∩ null` | `x - null` |
| `x === undefined` | `x ∩ undefined` | `x - undefined` |
| `x === <literal>` | `x ∩ lit(v)` | `x - lit(v)` |
| `Array.isArray(x)` | `x ∩ array` | `x - array` |
| `x`（真值检查） | `x - null - undefined - lit(0) - lit("") - lit(false)` | 补集 |
| `x instanceof C` | `x ∩ instance(C)` | `x - instance(C)` |
| `"key" in x` | 含有 `key` 属性的联合成员 | 不含 `key` 属性的联合成员 |
| `x?.prop` | 正常成员访问（nullish 时短路为 `undefined`） | — |
| `a ?? b` | 移除 null/undefined 后的 `a` | — |
| `switch(x) { case v: ... }` | 每个 case 对应 `x ∩ lit(v)` | 所有 case 之外的剩余部分 |
| `x.kind === "a"`（可辨识联合） | `kind` 匹配该字面量的联合成员 | `kind` 不同的联合成员 |

其中 `∩` 为类型交集，`-` 为类型减法。

---

## 高级行为

### 循环（有界展开）

当循环边界是具体值时，引擎按该次数展开循环。当边界抽象时，条件永远不会*确定地为假*，引擎最多展开到有界上限（`DEFAULT_MAX_LOOP_ITERS = 8`）——这是抽象条件无法诚实终止时的兜底预算，而非不动点合并。在上限之内，当测试变为确定地为假、或相邻两个循环状态不再变化（`leqAbs`）时提前退出。

### 闭包与高阶函数

函数是一等 Abs 值（`fn` shape）。当函数作为参数传入时，引擎经其 Abs 表示（参数、函数体、闭包环境）求值调用：

```javascript
map(number[], (x) => x + 1)
// 引擎求值：fn(number) → number + lit(1) → number
// 结果：number[]
```

### 递归（调用预算）

递归由调用预算（`MAX_CALL_DEPTH = 64`）约束，而非精化到不动点：

1. 递归调用以当前实参求值。
2. 当签名重新进入超过预算时，该调用被截断。
3. 截断的结果拓宽为 `unknown`，报 `nudo:recursion-truncated`（`nudo check` 中的 warning）。

预算内的具体基例仍求值为字面量；符号自递归拓宽为 `unknown` 而非发散。

### Async / Promise

Promise 建模为效果形状（`eff`）：
- `await expr` 将 `promise<V>` 解包为 `V`
- `async function` 将返回值包装在 `promise<...>` 中

### 异常与 throws 追踪

Nudo 将异常视为函数类型的一等属性。每个函数的推断类型都同时包含 `returns` 和 `throws`：

```javascript
function divide(a, b) {
  if (b === 0) throw new Error("Division by zero");
  return a / b;
}
// divide(number, number):
//   returns: number
//   throws: instance(Error)
```

`try-catch` 吸收抛出的类型。catch 参数接收 try 块中所有抛出类型的联合。若函数从不抛出，则 `throws` 为 `never`。

### 可变性（引用语义、写时复制）

对象 Abs 值使用**引用语义**——赋值复制引用而非值。多个变量可以指向同一对象 Abs 值。

进入条件分支时，引擎会对被修改对象进行深拷贝，使每个分支拥有自己的副本。合并时，重叠属性变为联合类型。若无分支，则就地应用变更，无额外开销。
