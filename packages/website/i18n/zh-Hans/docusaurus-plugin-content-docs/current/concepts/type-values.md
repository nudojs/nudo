---
sidebar_position: 1
---

# 类型值

类型值是 Nudo 中的基础抽象。它们是**可能 JavaScript 值集合的符号化表示**——不是持有单个具体值（如 `42` 或 `"hello"`），而是表示具有某类特征的所有值（例如「任意数字」或「字面量 1」）。当 Nudo 执行你的代码时，它使用类型值而非具体值，执行结果本身也是类型值——即推断出的类型。

## TypeValue 层级结构

Nudo 的类型系统围绕类型值种类的 discriminated union 构建：

```
TypeValue
├── Literal<V>      — 单一具体值: 1, "hello", true, null, undefined
├── Primitive<T>    — 基本类型的所有可能值: number, string, boolean, bigint, symbol
├── ObjectType      — 具有已知属性类型的对象
├── ArrayType       — 具有元素类型的数组
├── TupleType       — 固定长度数组
├── FunctionType    — 具有参数、函数体和闭包的函数
├── UnionType       — 类型值的联合
├── NeverType       — 空集（不可达）
└── UnknownType     — 全集（任意值）
```

### Literal\<V\>

表示恰好一个具体值。当引擎已知精确值时会使用，例如代码中的字面量或具体的 `@nudo:case` 参数。

```javascript
T.literal(1)       // the number 1
T.literal("hello") // the string "hello"
T.literal(true)   // the boolean true
```

### Primitive\<T\>

表示 JavaScript 基本类型的所有可能值：`number`、`string`、`boolean`、`bigint` 或 `symbol`。当值已知属于该类型但不是具体值时使用。

```javascript
T.number   // any number
T.string   // any string
T.boolean  // true or false
```

### ObjectType

表示具有已知结构的对象——每个属性都有关联的类型值。

```javascript
T.object({ id: T.number, name: T.string })
T.object({ x: T.literal(1), y: T.literal(2) })
```

### ArrayType

表示元素共享同一类型的数组。

```javascript
T.array(T.number)           // number[]
T.array(T.union(T.string, T.number))  // (string | number)[]
```

### TupleType

表示固定长度数组，每个索引有特定类型。

```javascript
T.tuple([T.literal(1), T.string, T.boolean])
```

### FunctionType

表示具有参数名、函数体 AST 和闭包（环境）的函数。当函数作为一等公民时在内部使用。

### UnionType

表示多个类型值的联合——值可以是其任意成员。

```javascript
T.union(T.literal(1), T.literal(2), T.literal(3))
T.union(T.string, T.number)
```

### NeverType

空集。表示不可达代码或不可能的类型（例如 narrowing 排除了所有可能性后的结果）。

### UnknownType

全集。当类型无法确定时表示「任意值」。

---

## T Factory API

在指令和代码中定义类型值时，使用 `T` factory：

| API | 描述 |
|-----|-------------|
| `T.literal(value)` | 单一具体值：`1`、`"hello"`、`true`、`null`、`undefined` |
| `T.number` | 所有数字 |
| `T.string` | 所有字符串 |
| `T.boolean` | 所有布尔值 |
| `T.bigint` | 所有 bigint |
| `T.symbol` | 所有 symbol |
| `T.null` | 值 `null` |
| `T.undefined` | 值 `undefined` |
| `T.unknown` | 任意值 |
| `T.never` | 空集（不可达） |
| `T.object({ key: TypeValue })` | 具有已知属性类型的对象 |
| `T.array(element)` | 具有元素类型的数组 |
| `T.tuple([...])` | 固定长度数组 |
| `T.union(...)` | 类型值的联合 |
| `T.fn(params, body, closure)` | 函数类型（内部使用） |

### 指令中的示例

```javascript
/**
 * @nudo:case "concrete" (5, 3)
 * @nudo:case "symbolic" (T.number, T.number)
 * @nudo:case "mixed" (T.literal(0), T.string)
 */
function combine(a, b) {
  return a + b;
}
```

```javascript
// In @nudo:case or @nudo:mock expressions:
T.union(T.string, T.number)
T.object({ id: T.number, name: T.string })
T.array(T.object({ x: T.number, y: T.number }))
T.tuple([T.literal(1), T.literal(2), T.literal(3)])
```

---

## 设计原则

Nudo 的类型值系统遵循四个核心原则，支配操作和推断的行为。

### 1. 字面量保留（Literal Preservation）

当所有输入都是字面量时，输出也是字面量。引擎会计算具体结果。

```javascript
T.literal(1) + T.literal(2)   // → T.literal(3), not T.number
T.literal("a") + T.literal("b") // → T.literal("ab"), not T.string
```

当有足够信息时，这能保持推断类型的精确性。

### 2. 抽象时拓宽（Widening on Abstraction）

当任意输入是抽象的（非字面量）时，结果拓宽为合适的抽象类型。

```javascript
T.literal(1) + T.number   // → T.number
T.string + T.literal("!") // → T.string
```

输入的抽象意味着输出的抽象。

### 3. 联合类型懒分配（Lazy Union Distribution）

联合类型在函数中按原样传播。仅当运算符或方法*必须*区分成员时才展开。这避免了组合爆炸。

```javascript
const a = T.union(T.literal(1), T.literal(2));
const b = T.union(T.literal("x"), T.literal("y"));

// Not expanded — members don't need to be distinguished
const arr = [a, b];  // → T.tuple([T.union(1, 2), T.union("x", "y")])

// Expanded — operator must distinguish members
const sum = a + b;   // → T.union("1x", "1y", "2x", "2y")
```

懒分配保留了相关性：`a + a` 正确地为 `T.union(2, 4)`，而非 `1+1, 1+2, 2+1, 2+2`。

### 4. 守卫窄化（Guard Narrowing）

类型守卫在分支内窄化类型值。当你检查 `typeof x === "string"` 或 `x === null` 时，引擎会在 `if` 分支内窄化 `x`，并在 `else` 分支中排除这些类型。

```javascript
function process(x) {
  if (typeof x === "string") {
    // x is T.string here
    return x.length;  // → T.number
  }
  if (x === null) {
    // x is T.null here
    return 0;
  }
  // x is narrowed (e.g. T.number if input was T.union(T.string, T.number, T.null))
  return x;
}
```

窄化规则支持 `typeof`、`===`、`!==`、`instanceof` 以及真值检查。
