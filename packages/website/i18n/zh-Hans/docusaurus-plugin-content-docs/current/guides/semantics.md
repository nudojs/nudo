---
sidebar_position: 9
---

# 语言语义

Nudo 通过用符号值*执行*你的代码来推断类型，因此推断的质量就等于求值器 JavaScript 语义的质量。本指南列出 Nudo 精确建模的语言行为——每一项都是过去会退化成 `unknown`、如今能推断出具体结果的构造。这些能力也正是[调用点发现](/docs/guides/callsite-discovery)得以生效的基础：采集到的调用形状，只有在求值器真正跟得动它们时才有价值。

## `this` 绑定

方法调用会传递接收者，因此实例形状能流入函数体。

```js
function area() {
  return this.radius ** 2;
}

area.call({ radius: 3 });      // → 9
const circle = { radius: 5, area };
circle.area();                 // → 25
```

`obj.f()` 会把 `this` 绑定到 `obj` 的推断类型；`f.call(thisArg)` 与 `f.apply(thisArg, args)` 以相同的方式绑定显式接收者。

## 原始值自动装箱与 `Object.prototype`

对原始值的属性访问会经过它的包装对象，而每个对象都携带 `Object.prototype` 的方法表。

```js
"nudo".constructor;                 // → String constructor, not unknown
({}).hasOwnProperty("key");         // → boolean
config.hasOwnProperty("port");      // → resolves for any object shape
```

`hasOwnProperty`、`toString`、`valueOf` 及其同伴可以在任意对象形状上解析，而不是把结果放宽为 `unknown`。

## `Symbol.iterator in x`

`in` 运算符在字面量层面判定可迭代性，因此可以驱动收窄。

```js
Symbol.iterator in [1, 2, 3];   // → true
Symbol.iterator in "nudo";      // → true
Symbol.iterator in 42;          // → false
```

在 `if (Symbol.iterator in x)` 内部，真分支只保留联合类型中的可迭代成员。

## 对 `Set` 与 `Map` 的 `for...of`

迭代内建集合会产出类型精确的元素——包括解构出来的条目。

```js
const tags = new Set(["a", "b"]);
for (const t of tags) {
  t;                            // → "a" | "b"
}

const scores = new Map([["ok", 1], ["warn", 2]]);
for (const [status, code] of scores.entries()) {
  status;                       // → "ok" | "warn"
  code;                         // → 1 | 2
}
```

## Promise 解析

`new Promise` 的执行器在求值之下运行，而 resolve 的位置还会通过对嵌套闭包的静态扫描找到——因此埋在 `setTimeout` 回调里的 `resolve(value)` 依然能确定已解析的类型。

```js
const p = new Promise((resolve) => {
  setTimeout(() => resolve("done"), 10);
});
// p → Promise<"done">
```

链式调用 `.finally(...)` 时会拍下快照而不是污染类型：promise 保持 `Promise<"done">`，不会放宽为 `unknown`。

## `break` 与 `continue`

循环跳转是信号，而不是控制流的死胡同——退出迭代的那个状态会被保留。

```js
let found;
for (const x of [1, 2, 3, 4]) {
  if (x > 2) {
    found = x;
    break;
  }
}
found;                          // → 3
```

`continue` 切断当前迭代路径而不污染累加器；`break` 保留来自退出那一轮迭代的精确值。

## 每轮迭代的 `let` 绑定

`for (let ...)` 循环的每一轮都会得到一个全新的绑定，闭包捕获的是那一轮的副本——与真实的 JavaScript 语义一致。

```js
const fns = [];
for (let i = 0; i < 3; i++) {
  fns.push(() => i);
}

fns[0]();                       // → 0
fns[2]();                       // → 2
```

引擎不会把所有闭包都折叠成 `i` 的最终值。

## 作为元组的 `arguments`

在一次调用内部，`arguments` 是实际参数值组成的元组。

```js
function logAll() {
  return arguments.length;
}

logAll("a", "b", "c");          // → 3
```

`arguments.length`、索引（`arguments[0]`）与展开看到的都是被记录调用的具体参数类型。

## 内建函数的字面量求值

以字面量为参数的调用会精确求值，而不是返回一个泛化类型。

```js
JSON.parse('{"port": 3000}');       // → { port: 3000 }
String.fromCharCode(72, 105);       // → "Hi"
```

解析出的 JSON 保留其结构与字面量成员类型；字符码拼接成精确的字符串。

## 递归预算

深度递归会在预算处截断，并回退到目前已观察到的返回值并集——是优雅降级，而不是 `unknown`。

```js
function walk(n) {
  if (n <= 0) return 0;
  return n + walk(n - 1);
}

walk(5);                        // → 15 (fully evaluated)
walk(10_000);                   // → number (budget hit; union of observed returns)
```

## `Object.keys` 的联合类型分发

当接收者是多个对象形状的联合时，`Object.keys` 会对每个成员分别求键，再把键集合合并。

```js
function firstKey(shape) {
  // shape: { port: number } | { host: string }
  return Object.keys(shape)[0];
}
// → "port" | "host"
```

## 总结

| 能力 | 示例 | 结果 |
|---|---|---|
| `this` 绑定 | `circle.area()` | 接收者形状流入函数体 |
| 自动装箱 | `"nudo".constructor` | 包装对象的标记，而非 `unknown` |
| 可迭代性检查 | `Symbol.iterator in x` | 字面量 `true` / `false` |
| 集合迭代 | `for (const [k, v] of map.entries())` | 精确的元素类型 |
| Promise 解析 | `new Promise((res) => setTimeout(() => res("done")))` | `Promise<"done">` |
| 循环跳转 | `break` / `continue` | 保留退出迭代的那个状态 |
| 每轮迭代的 `let` | `fns[i]()` 捕获当轮的 `i` | `0`、`2` —— 而非最终值 |
| `arguments` | `arguments.length` | 实际参数组成的元组 |
| 字面量内建函数 | `JSON.parse('{"port": 3000}')` | `{ port: 3000 }` |
| 递归预算 | `walk(10_000)` | 观察到的并集，而非 `unknown` |
| `Object.keys` | 联合类型接收者 | 键字面量的并集 |
