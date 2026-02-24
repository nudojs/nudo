---
sidebar_position: 1
---

# @nudojs/core

core 包提供类型值体系、运算符语义以及环境抽象，是 Nudo 抽象解释引擎的核心支撑。

## TypeValue

`TypeValue` 是一个 discriminated union，在类型层面表示一组可能的 JavaScript 值。使用 `kind` 属性来收窄类型。

### Discriminated Union 成员

| `kind` | 描述 |
|--------|-------------|
| `literal` | 单一具体值：`string \| number \| boolean \| null \| undefined` |
| `primitive` | 某基本类型的所有值：`number`、`string`、`boolean`、`bigint`、`symbol` |
| `object` | 具有已知属性类型的对象；有唯一 `id` 用于引用语义 |
| `array` | 具有单一元素类型的数组 |
| `tuple` | 固定长度数组，每个元素有各自类型 |
| `function` | 具有 `params`、`body`（AST）和 `closure`（Environment）的函数 |
| `promise` | 包装 TypeValue 的 Promise |
| `instance` | 类实例（如 `Error`），可选属性 |
| `union` | 多个 TypeValue 的联合 |
| `never` | 空集（不可达） |
| `unknown` | 全集（任意值） |

---

## T Factory

`T` 提供静态工厂函数和常量，用于构造 TypeValue。

### 字面量与基本类型

```typescript
T.literal(value)   // value: LiteralValue (string | number | boolean | null | undefined)
T.number
T.string
T.boolean
T.bigint
T.symbol
T.null
T.undefined
T.unknown
T.never
```

### 复合类型

```typescript
T.object(props)           // props: Record<string, TypeValue>
T.array(element)          // element: TypeValue
T.tuple(elements)         // elements: TypeValue[]
T.promise(value)          // value: TypeValue
T.instanceOf(className, properties?)  // className: string, properties?: Record<string, TypeValue>
T.union(...members)       // members: TypeValue[]
T.fn(params, body, closure)  // params: string[], body: Node (Babel AST), closure: Environment
```

---

## 工具函数

| 函数 | 描述 |
|----------|-------------|
| `typeValueEquals(a, b)` | 两个 TypeValue 的深度相等比较。 |
| `simplifyUnion(members)` | 扁平化嵌套联合、去重、移除 `never`。若为空返回 `T.never`，单一成员则返回该成员，若任一成员为 unknown 则返回 `T.unknown`。 |
| `widenLiteral(tv)` | 将字面量转换为对应基本类型：`T.literal(1)` → `T.number` 等。 |
| `isSubtypeOf(a, b)` | 检查 `a` 是否为 `b` 的子类型。 |
| `typeValueToString(tv)` | 人类可读的字符串表示（如 `"number"`、`"string \| number"`）。 |
| `narrowType(tv, predicate)` | 按谓词过滤联合成员；对非联合且谓词不满足的情况返回 `T.never`。 |
| `subtractType(tv, predicate)` | 保留谓词为 false 的成员。 |
| `getPrimitiveTypeOf(tv)` | 返回 `typeof` 字符串：`"number"`、`"string"`、`"object"`、`"function"` 或 `undefined`。 |
| `deepCloneTypeValue(tv, idMap?)` | 深度克隆；可选 `idMap` 在克隆间保持对象同一性。 |
| `mergeObjectProperties(a, b)` | 合并两个对象 TypeValue；重叠键变为联合类型。 |

---

## Ops（运算符语义）

在 TypeValue 上的运算符和一元运算。求值器使用这些而非真实 JavaScript 运算符。

### 二元运算

| Op | 函数 | 描述 |
|----|----------|-------------|
| `+` | `Ops.add(left, right)` | 数值加法或字符串拼接；literal + literal → literal。 |
| `-` | `Ops.sub(left, right)` | 减法；仅数值。 |
| `*` | `Ops.mul(left, right)` | 乘法。 |
| `/` | `Ops.div(left, right)` | 除法。 |
| `%` | `Ops.mod(left, right)` | 取模。 |
| `===` | `Ops.strictEq(left, right)` | 严格相等。 |
| `!==` | `Ops.strictNeq(left, right)` | 严格不等。 |
| `>` | `Ops.gt(left, right)` | 大于。 |
| `<` | `Ops.lt(left, right)` | 小于。 |
| `>=` | `Ops.gte(left, right)` | 大于等于。 |
| `<=` | `Ops.lte(left, right)` | 小于等于。 |

### 一元运算

| Op | 函数 | 描述 |
|----|----------|-------------|
| `typeof` | `Ops.typeof_(operand)` | 返回 `T.literal("number")`、`T.literal("string")` 等。 |
| `!` | `Ops.not(operand)` | 逻辑非。 |
| `-` | `Ops.neg(operand)` | 数值取负。 |

### 辅助函数

```typescript
applyBinaryOp(op: string, left: TypeValue, right: TypeValue): TypeValue
```

将运算符字符串（`"+"`、`"-"` 等）映射到对应的二元 Op。未知运算符返回 `T.unknown`。

---

## Environment

Environment 管理变量绑定（名称 → TypeValue），支持词法作用域。

```typescript
createEnvironment(parent?, bindings?)
```

- `parent` — 可选的父 Environment，用于作用域链。
- `bindings` — 可选的 `Map<string, TypeValue>`，作为初始绑定（默认：`new Map()`）。

### Environment 方法

| 方法 | 描述 |
|--------|-------------|
| `lookup(name)` | 获取 `name` 的 TypeValue；沿父链查找；未找到时返回 `T.undefined`。 |
| `bind(name, value)` | 在当前 env 中设置绑定；返回 env 以支持链式调用。 |
| `update(name, value)` | 更新当前 env 或父 env 中已有的绑定；返回 `boolean` 表示是否成功。 |
| `extend(bindings)` | 创建带有新绑定的子 env。 |
| `has(name)` | 检查名称是否已绑定（当前 env 或父 env）。 |
| `snapshot()` | env 的深拷贝（用于分支分叉）。 |
| `getOwnBindings()` | 获取仅当前 env 绑定的 `Record<string, TypeValue>`。 |
