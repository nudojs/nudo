---
sidebar_position: 1
description: "@nudojs/core API —— 类型值体系、T 工厂（含 T.fnSig）、联合/精度工具函数、运算符语义、mock 帮助函数与 Environment。"
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
| `refined` | 基础类型的子集，携带元数据和自定义运算规则 |
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
T.fnSig(paramTypes, returnType, throwsType?, impl?)  // 仅签名的函数（见下）
T.refine(base, refinement)
```

### 仅签名函数

`T.fn` 描述真实的函数值（参数**名**、函数体 AST、闭包）。`T.fnSig` 只描述**签名**——env 文件与 harvester 用它表达「接受这些类型、返回那个类型的函数」，无需函数体：

```typescript
T.fnSig(paramTypes: TypeValue[], returnType: TypeValue,
        throwsType: TypeValue = T.never, impl?: SigImpl): TypeValue

type SigImpl = (args: TypeValue[], thisVal?: TypeValue) => TypeValue | undefined;
```

提供 `impl` 时，调用该函数会用实参 TypeValue 执行它（收割出的 `join` 之所以真的能拼接模板字符串，靠的就是 impl）；不提供 `impl` 时，调用直接返回声明的 `returnType`。用 [`isFnSig`](#工具函数) 判断、`getFnSig` 读回 `{ paramTypes, returnType, throwsType, impl }` 记录。

```typescript
T.fnSig([T.array(T.string)], T.string)
// 一个 (string[]) => string 的函数
```

### 精化类型

`T.refine` 创建精化类型——基础类型的子集，可选自定义运算规则：

```typescript
type Refinement = {
  name: string;                    // 可读名称，用于 toString/toTSType
  meta: Record<string, unknown>;   // 元数据（如模板 parts、区间边界）
  check?: (value: unknown) => boolean;  // 判断具体值是否属于此类型
  ops?: Record<string, (self: TypeValue, other: TypeValue) => TypeValue | undefined>;
  methods?: Record<string, (self: TypeValue, args: TypeValue[]) => TypeValue | undefined>;
  properties?: Record<string, (self: TypeValue) => TypeValue | undefined>;
};
```

任何 handler 返回 `undefined` 将回退到基础类型的行为。

---

## 工具函数

| 函数 | 描述 |
|----------|-------------|
| `typeValueEquals(a, b)` | 两个 TypeValue 的深度相等比较。 |
| `simplifyUnion(members)` | 扁平化嵌套联合、去重、移除 `never`，并把字面量吸收进共存的基类型（`3 \| number` → `number`）。若为空返回 `T.never`，单一成员则返回该成员，若任一成员为 unknown 则返回 `T.unknown`。 |
| `widenLiteral(tv)` | 将字面量转换为对应基本类型：`T.literal(1)` → `T.number` 等。非字面量原样返回。 |
| `collapseLiteralUnion(tv, maxLiterals)` | 同一基本类型的字面量联合超过 `maxLiterals` 个时坍缩（`1 \| 2 \| … \| 20` → `number`）。异构联合与未超阈值的联合原样返回。 |
| `isSubtypeOf(a, b)` | 检查 `a` 是否为 `b` 的子类型。 |
| `typeValueToString(tv)` | 人类可读的字符串表示（如 `"number"`、`"string \| number"`）。 |
| `narrowType(tv, predicate)` | 按谓词过滤联合成员（再 `simplifyUnion`）；对非联合，谓词通过保留原值，否则返回 `T.never`。 |
| `subtractType(tv, predicate)` | 保留谓词为 false 的成员（即谓词取反后的 `narrowType`）。 |
| `getPrimitiveTypeOf(tv)` | 返回 `typeof` 字符串：`"number"`、`"string"`、`"object"`、`"function"` 或 `undefined`。 |
| `deepCloneTypeValue(tv, idMap?)` | 深度克隆；可选 `idMap` 在克隆间保持对象同一性。 |
| `getRefinedBase(tv)` | 递归解包精化类型，获取最内层的非精化基础类型。 |
| `mergeObjectProperties(a, b)` | 合并两个对象 TypeValue；重叠键变为联合类型。 |
| `isFnSig(tv)` | 判断 `tv` 是否为仅签名的函数（由 `T.fnSig` 创建）。 |
| `getFnSig(tv)` | 读回 `T.fnSig` 值的 `FunctionSignature`；普通函数返回 `undefined`。 |

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

### 分派函数（精化类型感知）

这些函数封装了基本运算，支持精化类型的回退链：

```typescript
dispatchBinaryOp(op: string, left: TypeValue, right: TypeValue): TypeValue
dispatchMethod(receiver: TypeValue, name: string, args: TypeValue[]): TypeValue | undefined
dispatchProperty(receiver: TypeValue, name: string): TypeValue | undefined
```

分派链：尝试精化类型的自定义 handler → 返回 `undefined` 则解包到 base → 递归直到原始类型 → 使用默认 `Ops`。

---

## 内置精化类型

### 模板字符串

```typescript
createTemplate(parts: TypeValue[]): TypeValue   // 如 [T.literal("0x"), T.string]
isTemplate(tv: TypeValue): boolean
getTemplateParts(tv: TypeValue): TypeValue[] | undefined
concatTemplates(left: TypeValue, right: TypeValue): TypeValue
getKnownPrefix(parts: TypeValue[]): string      // 前导字面量 parts 拼接
getKnownSuffix(parts: TypeValue[]): string      // 尾部字面量 parts 拼接
```

模板字符串在字面量字符串与抽象字符串拼接时自动创建。支持 `startsWith`、`endsWith`、`includes` 方法和 `length` 属性。

### 数值区间

```typescript
createRange(opts: { min?: number; max?: number; integer?: boolean }): TypeValue
isRange(tv: TypeValue): boolean
getRangeMeta(tv: TypeValue): { min?: number; max?: number; integer?: boolean } | undefined
```

区间通过比较窄化创建（如 `x >= 0`）。支持 `>=`、`>`、`<=`、`<` 比较运算符，当边界已知时返回确定性结果。

---

## Mock 帮助函数

`@nudo:mock` 表达式与 env 文件共享的类型安全 mock 构造器——`MockHelper` 是一个普通记录，由 `mockHelperToTypeValue` 转换为函数 TypeValue：

```typescript
type MockHelper = {
  kind: "mock-helper";
  returnValue?: TypeValue;        // stub().returns(v)
  resolvedValue?: TypeValue;      // stub().resolves(v) —— 调用返回 Promise<v>
  rejectedValue?: TypeValue;      // stub().rejects(v) —— 调用抛出/拒绝 v
  onFirstCallValue?: TypeValue;   // stub().onFirstCall(v)
  onSecondCallValue?: TypeValue;  // stub().onSecondCall(v)
  withArgsCases?: { args: TypeValue[]; returnValue: TypeValue }[];  // stub().withArgs(...)
  callsFakeImpl?: TypeValue;      // stub().callsFake(fn) —— 调用时执行 fn
  implementation?: (...args: TypeValue[]) => TypeValue;
};

function stub(): MockHelper;
function spy(): MockHelper;
function mock(): MockHelper;
function mockHelperToTypeValue(helper: MockHelper, env: Environment): TypeValue;
```

`stub`、`spy`、`mock` 返回相同的基础 helper，只是语义意图不同；行为来自**挂在 `stub`/`spy` 上的静态构造器**——每个都返回完整的 `MockHelper`（没有实例级链式调用）：

```typescript
stub.returns(v: TypeValue): MockHelper
stub.resolves(v: TypeValue): MockHelper       // 调用返回 Promise<v>
stub.rejects(v: TypeValue): MockHelper        // 调用以 v 拒绝
stub.onFirstCall(v: TypeValue): MockHelper
stub.onSecondCall(v: TypeValue): MockHelper
stub.withArgs(...args: TypeValue[]): MockHelper
stub.callsFake(fn: TypeValue): MockHelper
spy.returns(v: TypeValue): MockHelper
```

在 `@nudo:mock` 表达式中写的是 sinon 风格链 `stub().…`——解析器对整条链做模式匹配，构造等价的 `MockHelper`（`stub()` 调用本身不会执行）：

```javascript
/**
 * @nudo:mock fetch = stub().resolves({ ok: true })
 * @nudo:mock parse = stub().withArgs(T.string).returns(T.number)
 */
```

`withArgs` 按位置逐位匹配实参（sinon 深比较的保守近似），在更长链中优先级高于全局 `returnValue`；`callsFake(fn)` 直接解析为 fake 函数值本身，调用时会以真实实参执行它——与行内箭头函数 mock 走同一机制。

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
| `extend(bindings)` | 创建带有新绑定的子 env（普通 `Record<string, TypeValue>`）。 |
| `fork()` | 创建共享当前作用域链的空子 env——分支分叉时使用。 |
| `has(name)` | 检查名称是否已绑定（当前 env 或父 env）。 |
| `snapshot()` | env 的深拷贝（用于分支分叉）。 |
| `getOwnBindings()` | 获取仅当前 env 绑定的 `Record<string, TypeValue>`。 |
