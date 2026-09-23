---
description: 了解 Nudo 求值器目前精确建模的 JavaScript 语义——字符串方法、for-of、break、Object.keys、递归——以及仍会退化为 unknown 的构造。
---

# 语言语义

Nudo 通过*执行*你的代码来推断类型，所以推断质量正好等于求值器 JavaScript 语义的质量。本指南列出求值器在调用点路径上精确建模的语言行为——下方所有输出块均摘录自对上面代码真实运行 `nudo test` 的结果（`nudo test <file>` 头部与断言摘要已省略）——随后列出仍会退化为 `unknown`（推导失败 / 引擎债，**不是**无约束入口参数的默认值；入口默认为 `any`）、依赖前需要验证的构造。精确语义也是[调用点发现](../guides/callsite-discovery.md)生效的前提：采集到的调用形态只有求值器真的能跟下去才值钱。

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

  call@L2  () => "HELLO"
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

  call@L8  (5) => 10
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

  call@L11  () => 3
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

  call@L2  () => ["port", "host"]
```

### Math 方法

字面量数值实参上的 `Math` 方法在求值期折叠——调用点与 `@nudo:case` 两条路径皆然。

```js
function root(n) { return Math.sqrt(n); }
root(9);
```

```text
=== root ===

  call@L2  (9) => 3
```

`sqrt`、`pow`、`abs`、`floor`、`ceil`、`round`、`sign`、`min`、`max` 都在字面量实参上折叠为精确数值结果；符号实参拓宽为 `number`。

### 集合（Set / Map 迭代、Symbol.iterator）

对具体 `Set` / `Map` 的 `for...of` 逐元素折叠；在已知接收者上，`Symbol.iterator in x` 协议探测折叠为确定布尔值：

```js verify
function firstSet() {
  const seen = new Set(["a", "b"]);
  for (const x of seen) return x;
}
firstSet();

function firstMap() {
  const m = new Map([["k", 1]]);
  for (const [k, v] of m) return v;
}
firstMap();

function hasIter(x) { return Symbol.iterator in x; }
hasIter([1]);
```

```text
=== firstSet ===

  call@L5  () => "a"

=== firstMap ===

  call@L11  () => 1

=== hasIter ===

  call@L14  ([1]) => boolean
```

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

  call@L2  (5) => "5"
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

  call@L11  (5) => 25
```

指令路径在实参为字面量时同样精确（对 `compute` 写 `@nudo:case "member" (5)` → `(5) => 25`）；空实参表 `()` 时形参是 `unknown`，结果退化为 `unknown #partial`。成员调用（`circle.area()`、`obj.method()`）会作为调用点采集（`Class.method` / 裸 `method`），与具名调用一样合成 `call@` case。

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

  call@L6  (0) => 0
  call@L7  (1) => 1
  call@L8  (2) => 3

```

超过精确 case 上限的更多调用会聚合为一个实参拓宽的 `call@symbolic` case。

### 字面量相等、`JSON.parse`、数值格式化、`**`

求值器在调用点路径与 `@nudo:case` 下执行的更多字面量折叠：

```js
function eqCheck() { return 1 == "1"; }
eqCheck();                            // → true

function jp() { return JSON.parse('{"port": 3000}'); }
jp();                                 // → { port: 3000 }

function fixed(cents) { return (cents / 100).toFixed(2); }
fixed(1050);                          // → "10.50"

function pow(x) { return x ** 2; }
pow(3);                               // → 9
```

- `==` / `!=` 在字面量操作数上折叠（`1 == "1"` → `true`、`1 != "1"` → `false`）。
- `JSON.parse` 对字面量字符串折叠为解析出的对象形状。
- `toFixed` 在字面量接收者上折叠（`"10.50"`）；符号接收者拓宽为 `string`。
- `**` 在字面量操作数上折叠（`3 ** 2` → `9`）；符号操作数拓宽为 `number`。
- `try`/`catch` **已建模**：`catch (err)` 绑定被抛出的 Abs，所以 `throw new Error("boom")` 之后 `err.message` 求值为 `"boom"`。
- `String.fromCharCode(...)` 对字面量码点按 ToUint16 折叠（`String.fromCharCode(65, 66)` → `"AB"`）；抽象实参拓宽为 `string`。
- `Object.prototype` 方法已建模：`hasOwnProperty` / `isPrototypeOf` / `propertyIsEnumerable` / `valueOf` / `toString` 在具体形状、元组、数组、字符串装箱上按自有槽/下标/`length`/holes 判定；`Object.prototype.hasOwnProperty.call(o, k)` 同语义；`Object.create(null)` 无这些方法（TypeError）。
- `Symbol()` / `Symbol("desc")` 产生非具体 unique symbol：`typeof` 为 `"symbol"`，`.description` 为字面量或 `undefined`，两个 `Symbol()` 的 `===` 为 `false`、同引用为 `true`；`String(sym)` 给出 `Symbol(desc)`，隐式 ToString（`+` / 模板）抛 `TypeError`。

### 收窄守卫

`===` 比较、`typeof`、`Array.isArray` 与 `switch` 按具体调用点收窄——已验证模式见[控制流收窄](./control-flow-narrowing.md)。

## 尚未建模

以下构造目前求值为 `unknown`（通常伴随 `nudo:unknown-recv` 或 `nudo:builtin-unknown` 诊断）。请优先使用旁边列出的已建模替代方案。

| 构造 | 当前行为 | 已建模替代 |
|---|---|---|
| 原始值自动装箱 | `"nudo".constructor` → `unknown` | `.length`、上文的字符串方法 |
| Promise 执行器 | `new Promise((r) => r("done"))` → `promise<unknown>` | `@nudo:mock` + `async` 函数 |
| 箭头 `arguments` 且外层无直接引用 | → `unknown`（见下文 `arguments`） | 具名参数 |

### 已建模：`arguments`（strict/ESM）

非箭头函数内的 `arguments` 是**已建模**的类数组对象（tuple 投影）：

| 模式 | 结果 |
|---|---|
| `arguments.length` | 精确实参个数（默认参/rest 不抬高 length） |
| `arguments[i]` | 第 i 个实参；越界 → `undefined` |
| `typeof arguments` | `"object"` |
| `[...arguments]` / `Array.from(arguments, mapFn)` | 展开实参列表 |
| `Array.from(arguments).join(sep)` | 可展开；join 精确折叠仍为抽象 `string`（既有数组 join 模型） |
| 写 `arguments[i] = v` | **不**写回形参 |
| 写形参 | **不**写回 `arguments[i]` |
| 箭头 `() => arguments…` | 外层非箭头函数也直接引用 `arguments` 时沿词法外层；否则诚实 `unknown` |
| 默认参 | `arguments.length` 只计实参（`f()` + `f(a=1)` → `0`） |
| rest 形参 | `arguments.length` 为实参个数；rest 绑定路径不变 |

Nudo 分析按 **ESM/strict**：`arguments` 与形参是**独立映射**。sloppy 非严格是 mapped arguments object（两侧写回互通）——刻意不建模。

### 已建模：每迭代 `let` 闭包

`for (let i = …)` **每迭代独立绑定**——闭包捕获当次 `i`（`fns.push(() => i)` 后 `fns[0]()` / `fns[1]()` / `fns[2]()` 分别折 `0` / `1` / `2`）。`for (var i = …)` 仍是**共享绑定**（闭包读到最终值）。`forEach((x) => …)` 每回调参数语义保持。抽象边界循环在 `$for` 出口仍保守 join——不假装精确捕获。

## Mock 边界（仍建议）

env 模块与 `@types` harvester 覆盖了大量常见 Node/Web API，但**并不**消除对 mock 的需要。下列类别仍**建议手写 mock**（或保持诚实的 `unknown` / `entry@` 结果）——与 `docs/design/limitations.md` §2 调用点天花板对齐：

| 类别 | 为何 mock / 为何 unknown | 可用办法 |
|---|---|---|
| Native bindings | `child_process.spawn`、原生 addon —— env 可有签名，无副作用模拟 | `@nudo:mock`，或把返回值当 opaque |
| 动态 `require` | 计算模块图无法静态解析 | `@nudo:mock-module` / 静态 import |
| 流机器回调 | Node Transform 内部由运行时驱动，无调用点记录可 harvest | mock 流工厂；不要期望内部回调被推断 |
| browser/node 双入口变体 | 调用点记录不跨文件（归因按文件） | 分析实际发布的入口；另一入口 mock |
| 无调用现场的函数 | 测试未触达的内部 helper → `entry@` 兜底 | 补调用现场，或接受 `entry@` 为诚实结果 |
| Promise executor 内部 | `new Promise((r) => r(...))` → `promise<unknown>` | `@nudo:mock` + async 包装 |

覆盖基线（`pnpm run coverage:env` → `docs/reports/env-coverage-baseline.md`）报告的是**解析率**，不是完备性。不要把高解析率当成 soundness 保证——另见 [harvester API](../api/harvester.md#mock-边界诚实清单) 中的 mock 边界。

## 小结

| 能力 | 示例 | 结果 |
|---|---|---|
| 字符串方法 | `"hello".toUpperCase()` | `"HELLO"` |
| 具体边界循环 | `sumTo(5)` | `10` |
| `break` | 循环跳出值 | `3` |
| `Object.keys` | 具体形状 | `["port", "host"]` |
| 递归 | `walk(2)` | `3` |
| 字面量折叠 | `1 == "1"` · `JSON.parse('{"port": 3000}')` · `3 ** 2` | `true` · `{ port: 3000 }` · `9` |
| 收窄 | `typeof` / `===` / `Array.isArray` / `switch` | 逐调用点精度 |
