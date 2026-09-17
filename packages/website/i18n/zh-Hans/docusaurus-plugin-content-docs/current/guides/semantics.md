---
sidebar_position: 9
description: 了解 Nudo 求值器目前精确建模的 JavaScript 语义——字符串方法、for-of、break、Object.keys、递归——以及仍会退化为 unknown 的构造。
---

# 语言语义

Nudo 通过*执行*你的代码来推断类型，所以推断质量正好等于求值器 JavaScript 语义的质量。本指南列出求值器在调用点路径上精确建模的语言行为——下方所有输出块都是对上面代码真实运行 `nudo infer` 的结果——随后列出仍会退化为 `unknown`、依赖前需要验证的构造。精确语义也是[调用点发现](./callsite-discovery.md)生效的前提：采集到的调用形态只有求值器真的能跟下去才值钱。

## 已精确建模

### 字面量上的字符串方法

字面量接收者上的字符串方法在求值期折叠。

```js
function upper() { return "hello".toUpperCase(); }
upper();                              // → "HELLO"

function slen() { return "hello".length; }
slen();                               // → 5

function sli() { return "hello".slice(1, 3); }
sli();                                // → "el"
```

```text
=== upper ===

Case "call@L2": () => "HELLO"
```

`toUpperCase`、`toLowerCase`、`slice`、`.length` 与 `split`（字面量接收者 + 字面量分隔符）产生精确结果——`"a,b,c".split(",")` 在调用点路径折叠为 `["a", "b", "c"]`，无逗号的接收者如 `"abc".split("b")` 在 `@nudo:case` 指令路径折叠为 `["a", "c"]`。指令路径无法表达含逗号的接收者：指令解析器按逗号拆分用例实参，`@nudo:case "split" ("a,b,c")` 会变成三个 `unknown` 形参而非一个字符串。前缀/后缀/包含检查——`startsWith`、`endsWith`、`includes`——对字面量接收者折叠为确定的布尔值。`indexOf` 只得 `number` 原语，丢字面量下标。

### 具体边界的循环

具体边界的 `for` 循环求值出精确结果。

```js
function sumTo(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum = sum + i;
  }
  return sum;
}
sumTo(5);
```

```text
=== sumTo ===

Case "call@L8": (5) => 10
```

具体数组上的 `for...of` 同样精确：

```js
function sumArr(arr) {
  let s = 0;
  for (const x of arr) {
    s = s + x;
  }
  return s;
}
sumArr([1, 2, 3]);                    // → 6
```

### `break` 保留跳出值

循环跳转是信号：跳出迭代中绑定的值被保留。

```js
function findBig() {
  let found;
  for (const x of [1, 2, 3, 4]) {
    if (x > 2) {
      found = x;
      break;
    }
  }
  return found;
}
findBig();
```

```text
=== findBig ===

Case "call@L11": () => 3
```

结果是字面量 `3`——循环跳出时绑定的值。

### 具体形状上的 `Object.keys`

具体对象上的 `Object.keys` 返回精确的键元组。

```js
function keysOf() { return Object.keys({ port: 3000, host: "x" }); }
keysOf();
```

```text
=== keysOf ===

Case "call@L2": () => ["port", "host"]
```

### Math 方法

字面量数值实参上的 `Math` 方法在求值期折叠——调用点与 `@nudo:case` 两条路径皆然。

```js
function root(n) { return Math.sqrt(n); }
root(9);
```

```text
=== root ===

Case "call@L2": (9) => 3
```

`sqrt`、`pow`、`abs`、`floor`、`ceil`、`round`、`sign`、`min`、`max` 都在字面量实参上折叠为精确数值结果；符号实参拓宽为 `number`。

### 原始值转换与解析

全局强制转换构造器与数值解析器在字面量上折叠为精确结果——调用点与 `@nudo:case` 两条路径皆然：

```js
function strOf(x) { return String(x); }
strOf(5);                            // → "5"

function boolOf(x) { return Boolean(x); }
boolOf("hi");                        // → true

function numOf(x) { return Number(x); }
numOf("42");                         // → 42

function intOf(s) { return parseInt(s); }
intOf("42px");                       // → 42

function floatOf(s) { return parseFloat(s); }
floatOf("3.14");                     // → 3.14
```

```text
=== strOf ===

Case "call@L2": (5) => "5"
```

`String(x)`、`Number(x)`、`Boolean(x)` 把 number/string/boolean 字面量折叠为精确强转结果；`parseInt(s)` / `parseFloat(s)` 把 string/number 字面量折叠为精确数值前缀/解析结果。符号实参拓宽为目标原语（`string` / `number` / `boolean`）。仓库示例（CI 钉住）：[`docs/examples/algebra/l-primitive-conversion.js`](https://github.com/nudojs/nudo/blob/main/docs/examples/algebra/l-primitive-conversion.js)。

### 方法调用与 `this`

在函数体内进行的方法调用会把 `this` 绑定到 receiver——调用点与 `@nudo:case` 两条路径皆然。

```js
class Circle {
  constructor(r) { this.radius = r; }
  area() { return this.radius * this.radius; }
}

function compute(r) {
  const circle = new Circle(r);
  return circle.area();
}
compute(5);
```

```text
=== compute ===

Case "call@L11": (5) => 25
```

指令路径在实参为字面量时同样精确（对 `compute` 写 `@nudo:case "member" (5)` → `(5) => 25`）；空实参表 `()` 时形参是 `unknown`，结果退化为 `unknown #partial`。剩下的缺口在调用点**采集**而非求值：顶层裸成员调用（`circle.area()` 作语句）不产生 `call@` case——成员被调者不会被采集为调用点。把成员调用包进函数里即可看到。

### 递归按调用点展开

递归函数按观测到的调用求值：每个顶层调用被完整展开，作为独立的 `call@` case 报告精确结果。

```js
function walk(n) {
  if (n <= 0) return 0;
  return n + walk(n - 1);
}

walk(0);
walk(1);
walk(2);
```

```text
=== walk ===

Case "call@L6": (0) => 0
Case "call@L7": (1) => 1
Case "call@L8": (2) => 3

Combined: 0 | 1 | 3
```

超过精确 case 上限的更多调用会聚合为一个实参拓宽的 `call@symbolic` case。

### 收窄守卫

`===` 比较、`typeof`、`Array.isArray` 与 `switch` 按具体调用点收窄——已验证模式见[控制流收窄](./control-flow-narrowing.md)。

## 尚未建模

以下构造目前求值为 `unknown`（通常伴随 `nudo:unknown-recv` 或 `nudo:builtin-unknown` 诊断）。请优先使用旁边列出的已建模替代方案。

| 构造 | 当前行为 | 已建模替代 |
|---|---|---|
| `==` / `!=` 字面量折叠 | `1 == "1"` → `true` | 双字面量 Abstract Equality（C2.3） |
| 原始值自动装箱 | `"nudo".constructor` → `unknown` | `.length`、上文的字符串方法 |
| `Object.prototype` 方法 | `({}).hasOwnProperty("key")` → `unknown` | `Object.keys(...)` / 形状检查 |
| `Symbol.iterator in x` | → `unknown` | `Array.isArray(x)` |
| `Set` / `Map` 上的 `for...of` | 元素 → `unknown` | 数组 / `.map` 回调 |
| Promise 执行器 | `new Promise((r) => r("done"))` → `promise<unknown>` | `@nudo:mock` + `async` 函数 |
| `try`/`catch` 形参 | `catch (err)` → `err` 为 `unknown`（`nudo:builtin-unknown`） | `try` 体内的确定性 `return`（无抛点）折叠为精确 |
| 每迭代 `let` 闭包 | `fns[i]()` → `unknown` | 直接使用迭代结果 |
| `arguments` | → `unknown`（`nudo:builtin-unknown`） | 具名参数 |
| `JSON.parse` | `JSON.parse('{"port": 3000}')` → `unknown` | 对象字面量 |
| 数值格式化方法 | `(cents / 100).toFixed(2)` → `unknown`（`nudo:no-method`） | `Math.round` / 算术 |
| `String.fromCharCode` | → `unknown` | 字符串字面量 |
| 指数运算符 `**` | → `unknown` | `x * x` |

## 小结

| 能力 | 示例 | 结果 |
|---|---|---|
| 字符串方法 | `"hello".toUpperCase()` | `"HELLO"` |
| 具体边界循环 | `sumTo(5)` | `10` |
| `break` | 循环跳出值 | `3` |
| `Object.keys` | 具体形状 | `["port", "host"]` |
| 递归 | `walk(2)` | `3` |
| 收窄 | `typeof` / `===` / `Array.isArray` / `switch` | 逐调用点精度 |
