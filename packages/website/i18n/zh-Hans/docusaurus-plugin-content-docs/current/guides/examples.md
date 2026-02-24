---
sidebar_position: 4
---

# 示例

本指南展示 Nudo 类型推断的实用示例。每个示例包含带指令的输入代码和推断出的类型。

---

## 1. 带字面量与符号 case 的基本函数

一个函数具有多个 case：具体值和符号类型值。Nudo 会合并结果。

```javascript
/**
 * @nudo:case "positive numbers" (5, 3)
 * @nudo:case "negative result" (1, 10)
 * @nudo:case "symbolic" (T.number, T.number)
 */
function subtract(a, b) {
  return a - b;
}
```

**推断输出：**

```
=== subtract ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: number
```

符号 case `(T.number, T.number)` 产生 `number`。只有一个 case 时即为结果；有多个匹配 case 时，Nudo 报告合并后的类型。

---

## 2. 带类型收窄的对象操作

解构和属性访问。Nudo 通过对象形状推断类型。

```javascript
/**
 * @nudo:case "concrete" ({ name: "Alice", age: 30 })
 * @nudo:case "symbolic" (T.object({ name: T.string, age: T.number }))
 */
function greet({ name, age }) {
  return `Hello, ${name}! You are ${age} years old.`;
}
```

**推断输出：**

```
=== greet ===

Case "concrete": ({ name: "Alice", age: 30 }) => string
Case "symbolic": ({ name: string, age: number }) => string

Combined: string
```

Nudo 从每个 case 的对象形状收窄 `name` 和 `age`，因此返回类型被推断为 `string`。

---

## 3. 使用 map 的数组处理

数组和高阶函数。Nudo 通过 `map` 和 `filter` 跟踪元素类型。

```javascript
/**
 * @nudo:case "concrete" ([1, 2, 3])
 * @nudo:case "symbolic" (T.array(T.number))
 */
function doubleAll(arr) {
  return arr.map((x) => x * 2);
}
```

**推断输出：**

```
=== doubleAll ===

Case "concrete": ([1, 2, 3]) => number[]
Case "symbolic": (number[]) => number[]

Combined: number[]
```

输入 `number[]` 得到输出 `number[]`。使用 `T.array(T.number)` 表示符号化数组输入。

---

## 4. 带 mock fetch 的异步函数

异步函数和外部 API。使用 `@nudo:mock` 将 `fetch`（或其他全局对象）替换为类型值 mock。

```javascript
/**
 * @nudo:mock fetch = (url) => T.promise(T.object({
 *   ok: T.boolean,
 *   json: T.fn({ params: [], returns: T.promise(T.object({ id: T.number, name: T.string })) })
 * }))
 * @nudo:case "test" ("https://api.example.com/user")
 */
async function fetchUser(url) {
  const res = await fetch(url);
  const data = await res.json();
  return data;
}
```

**推断输出：**

在 mock 就位后，Nudo 推断 `fetchUser` 返回 `Promise<{ id: number; name: string }>`。

`@nudo:mock` 在抽象解释阶段替换 `fetch`，使 Nudo 无需真实网络请求即可建模响应形状。

---

## 5. 带 throws 追踪的错误处理

会抛出的函数。Nudo 同时追踪正常返回类型和抛出类型。

```javascript
/**
 * @nudo:case "valid" (10)
 * @nudo:case "negative" (-1)
 */
function safeSqrt(x) {
  if (x < 0) {
    throw new RangeError("negative input");
  }
  return Math.sqrt(x);
}
```

**推断输出：**

```
=== safeSqrt ===

Case "valid": (10) => number
Case "negative": (-1) => never throws RangeError

Combined: number
```

Nudo 建模控制流：`valid` case 返回 `number`，`negative` case 抛出 `RangeError` 且永不返回。合并后的值类型为 `number`；Nudo 还会追踪该函数可能抛出异常。

---

## 所用指令小结

| Directive       | Purpose                                      |
|-----------------|----------------------------------------------|
| `@nudo:case`    | 提供具体或符号化的输入样本                   |
| `@nudo:mock`    | 用类型值 mock 替换全局对象/模块              |
| `@nudo:pure`    | 标记纯函数以便缓存                           |
| `@nudo:skip`    | 跳过求值；使用声明的返回类型                 |
| `@nudo:sample`  | 控制循环采样次数                             |
| `@nudo:returns` | 断言期望的返回类型                           |

关于类型值（`T.number`、`T.object` 等）和抽象解释的更多内容，请参阅 [Type Values](/docs/concepts/type-values) 和 [Abstract Interpretation](/docs/concepts/abstract-interpretation)。
