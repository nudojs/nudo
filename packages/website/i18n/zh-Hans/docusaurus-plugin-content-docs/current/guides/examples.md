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

## 6. 模板字符串 — Nudo vs TypeScript

Nudo 在字符串拼接中保留结构信息，实现 TypeScript 无法达到的精确推断。

```javascript
/**
 * @nudo:case "symbolic" (T.string)
 */
function makeApiUrl(path) {
  return "https://api.example.com" + path;
}
```

**Nudo 推断：** `https://api.example.com${string}`

**TypeScript 推断：** `string`（丢失了已知前缀）

这意味着 Nudo 可以对结果进行推理：

```javascript
/**
 * @nudo:case "symbolic" (T.string)
 */
function isApiUrl(path) {
  const url = "https://api.example.com" + path;
  return url.startsWith("https://");  // → true（从模板前缀推导）
}
```

Nudo 知道结果一定是 `true`，因为模板的前缀以 `"https://"` 开头。TypeScript 只能推断为 `boolean`。

---

## 7. 精确的字符串方法

Nudo 在编译时对字面量执行字符串方法，产生精确结果。

```javascript
/**
 * @nudo:case "test" ()
 */
function stringDemo() {
  const upper = "hello".toUpperCase();    // → "HELLO"（TS: string）
  const parts = "a,b,c".split(",");       // → ["a", "b", "c"]（TS: string[]）
  const idx = "hello".indexOf("l");       // → 2（TS: number）
  const sliced = "hello".slice(1, 3);     // → "el"（TS: string）
  const len = "hello".length;             // → 5（TS: number）
  return { upper, parts, idx, sliced, len };
}
```

每个结果都是精确的字面量类型。TypeScript 对这些操作只能推断出 `string`、`string[]` 或 `number`。

---

## 8. 循环求值

Nudo 可以对具体边界的循环进行求值，在类型层面计算精确结果——这是 TypeScript 完全无法做到的。

```javascript
/**
 * @nudo:case "concrete" (5)
 * @nudo:case "symbolic" (T.number)
 */
function sumTo(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum = sum + i;
  }
  return sum;
}
```

**推断输出：**

```
=== sumTo ===

Case "concrete": (5) => 10
Case "symbolic": (number) => number

Combined: number
```

输入具体值 `5` 时，Nudo 执行循环并产生精确结果 `10`。输入抽象值 `T.number` 时，通过不动点迭代拓宽为 `number`。

---

## 9. 用户自定义精化类型

用户可以通过 `T.refine` 创建自定义类型约束，附加领域特定的运算规则。

```javascript
const Odd = T.refine(T.number, {
  name: "odd",
  check: (v) => Number.isInteger(v) && v % 2 !== 0,
  ops: {
    "%"(self, other) {
      if (other.kind === "literal" && other.value === 2) return T.literal(1);
      return undefined;
    },
  },
});

/**
 * @nudo:case "test" (Odd)
 */
function checkOdd(x) {
  return x % 2;  // → 1（自定义运算规则）
}
```

`Odd` 类型知道 `odd % 2` 总是 `1`。没有自定义规则的运算（如 `+`）回退到 `T.number` 的默认行为。

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
