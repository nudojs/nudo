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

`toUpperCase`、`toLowerCase`、`slice` 与 `.length` 产生精确字面量。`split` 与 `indexOf` 尚未建模，结果为 `unknown`。

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
| 方法调用中的 `this` | `return this.radius` 的 `circle.area()` 不会被记录为调用点（成员被调者不产生 `call@` case），`this.radius` 求值为 `unknown`（`nudo:unknown-recv`）——调用点与 `@nudo:case` 两条路径皆是 | 普通参数：`function area(circle) { return circle.radius * circle.radius; }` |
| `==` / `!=` 字面量折叠 | `1 == "1"` → `unknown` | 字面量上的 `===` 比较 |
| 原始值自动装箱 | `"nudo".constructor` → `unknown` | `.length`、上文的字符串方法 |
| `Object.prototype` 方法 | `({}).hasOwnProperty("key")` → `unknown` | `Object.keys(...)` / 形状检查 |
| `Symbol.iterator in x` | → `unknown` | `Array.isArray(x)` |
| `Set` / `Map` 上的 `for...of` | 元素 → `unknown` | 数组 / `.map` 回调 |
| Promise 执行器 | `new Promise((r) => r("done"))` → `Promise<unknown>` | `@nudo:mock` + `async` 函数 |
| 每迭代 `let` 闭包 | `fns[i]()` → `unknown` | 直接使用迭代结果 |
| `arguments` | → `unknown`（`nudo:builtin-unknown`） | 具名参数 |
| `JSON.parse` | `JSON.parse('{"port": 3000}')` → `unknown` | 对象字面量 |
| `String.fromCharCode` | → `unknown` | 字符串字面量 |
| 指数运算符 `**` | → `unknown` | `x * x` |
| `@nudo:case` 求值中的 `Math.*` | `Math.sqrt(9)` → `unknown` | 调用点（`sqrtOf(9)` → `3`） |

## 小结

| 能力 | 示例 | 结果 |
|---|---|---|
| 字符串方法 | `"hello".toUpperCase()` | `"HELLO"` |
| 具体边界循环 | `sumTo(5)` | `10` |
| `break` | 循环跳出值 | `3` |
| `Object.keys` | 具体形状 | `["port", "host"]` |
| 递归 | `walk(2)` | `3` |
| 收窄 | `typeof` / `===` / `Array.isArray` / `switch` | 逐调用点精度 |
