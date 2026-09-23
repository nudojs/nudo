---
description: 了解 Nudo 如何按调用点收窄类型——比较守卫、判别对象形状、typeof、Array.isArray、switch 与字面量真值判断——以及 unknown 条件分支、in 与 ?./?? 的当前局限。
---

# 控制流收窄

当 Nudo 能对**某个调用点的具体实参**判定条件时，它就会收窄类型。输出中的每一行 `call@L… => …` 报告一次调用的结果，用该调用的精确实参求值——被收窄消除的分支不会进入该 case 的结果；函数的合并类型是所有逐调用结果的并集（见 `nudo check` 签名与 IDE hover）。

收窄在**调用点路径**（顶层调用、报告为 `call@` case）与带**具体**实参的 `@nudo:case` 指令上都精确。符号实参（`number()`、`union(...)`）无法判定条件，其分支会合并而非收窄。下方所有输出块都是对上面代码真实运行 `nudo test` 的结果。

## 比较守卫

与字面量的比较按调用点收窄实参：每个具体调用只走与实参匹配的分支。

```js verify
function pickAdult(age) {
  if (age >= 18) return age;
  return -1;
}
pickAdult(25);
pickAdult(12);
```

```text
=== pickAdult ===

  call@L5  (25) => 25
  call@L6  (12) => -1

```

`pickAdult(25)` 满足 `age >= 18`，返回 `25`；`pickAdult(12)` 落到回退分支返回 `-1`。合并类型保留两个字面量结果。

## 判别对象形状

把属性与字符串字面量比较（`shape.kind === "circle"`）时，匹配调用的分支看到该调用实参的对象形状。

```js verify
function area(shape) {
  if (shape.kind === "circle") {
    return shape.radius * 3.14159;
  }
  return shape.side * shape.side;
}
area({ kind: "circle", radius: 2 });
area({ kind: "square", side: 3 });
```

```text
=== area ===

  call@L7  ({ kind: "circle", radius: 2 }) => 6.28318
  call@L8  ({ kind: "square", side: 3 }) => 9

```

circle 调用走 `if` 分支算出 `6.28318`；square 调用落到 `side * side` 得到 `9`。

## `typeof` 与 `Array.isArray()` 守卫

两类守卫都按具体调用分叉，收窄后的值在匹配分支中保持精确行为。

```js verify
function len(x) {
  if (typeof x === "string") return x.length;
  if (Array.isArray(x)) return x.length;
  return -1;
}
len("abc");
len([1, 2]);
len(5);
```

```text
=== len ===

  call@L6  ("abc") => 3
  call@L7  ([1, 2]) => 2
  call@L8  (5) => -1

```

字符串调用在收窄后的字符串上访问 `x.length`（`3`），数组调用在收窄后的数组上（`2`），数字调用穿过两道守卫落到 `-1`。收窄分支保留的是值本身：对收窄后的数组做索引（`x[0]`）解析为元素类型——字面量数组得到字面量，抽象数组得到元素类型——与 `.length` 一样。

## switch 语句

对判别字段的 `switch` 按 `case` 子句收窄——包括 `@nudo:case` 指令输入。

```js verify
/**
 * @nudo:case "idle" ({ status: "idle" })
 * @nudo:case "loading" ({ status: "loading", requestId: "abc" })
 * @nudo:case "success" ({ status: "success", data: { name: "test" } })
 * @nudo:case "error" ({ status: "error", message: "fail" })
 */
function handleState(state) {
  switch (state.status) {
    case "idle": return "Waiting...";
    case "loading": return `Loading ${state.requestId}...`;
    case "success": return state.data.name;
    case "error": return state.message;
  }
}
```

```text
=== handleState ===

  debug "idle"  ({ status: "idle" }) => "Waiting..."
  debug "loading"  ({ status: "loading", requestId: "abc" }) => "Loading abc..."
  debug "success"  ({ status: "success", data: { name: "test" } }) => "test"
  debug "error"  ({ status: "error", message: "fail" }) => "fail"

```

每个子句收到匹配的对象形状，因此 `state.requestId` 与 `state.data.name` 在各自分支内可以解析。

## 尚未收窄的模式

以下模式目前在调用点路径上**不会**分叉——要么固定落到单个分支，要么退化为 `unknown`（推导失败 / 引擎债）。依赖它们之前请显式加守卫或用 `nudo test` 验证：

| 模式 | 当前行为 |
|---|---|
| 条件为 unknown 的三元 | `flag ? "a" : "b"` 符号条件不分叉，两支合并（`string`）。确定条件在两条路径上都精确分叉——`pick(true)` → `"a"`、`x === 5 ? "five" : "other"` 传入 `5` → `"five"`——无需再改用 `if` 守卫。 |
| 符号输入 | `@nudo:case` 里的符号实参（`number()`、`union(...)`）不会分叉条件——分支合并；具体实参在两条路径上都收窄。 |
| `in` 运算符 | `if ("toJSON" in value)` 对对象实参收窄，但方法结果会拓宽（得到 `string` 而不是闭包的 `"serialized"`）；非对象实参还会报告 `nudo:no-method`。 |
| `?.` / `??` | 已知接收者形状上折叠——浅层（`config.port ?? 3000` → `number`）与深层（`a.b.c ?? 5` → `5`；`a?.b?.c` 传 `null` → `undefined`）都折叠。无约束（`any`）接收者上结果保持 `any` 并带 `throws TypeError`——引擎债 `unknown` 不适用。 |

## 可选链与空值合并

已知形状的接收者在任意深度都折叠；`any` 接收者保持 `any` 语义（外加 may-throw 效果）：

```js verify
function shallow(cfg) { return cfg.port ?? 3000; }
shallow({});

function deepchain(a) { return a.b.c ?? 5; }
deepchain({ b: {} });

function optchain(a) { return a?.b?.c; }
optchain(null);
```

```text
=== shallow ===

  call@L2  ({  }) => 3000

=== deepchain ===

  call@L5  ({ b: {  } }) => 5

=== optchain ===

  call@L8  (unknown) => undefined
```

## 小结

| 模式 | 按调用点收窄 | 示例 |
|---|---|---|
| 比较守卫 | 是 | `if (age >= 18)` → `25` / `-1` |
| 判别对象 | 是 | `if (shape.kind === "circle")` → `6.28318` / `9` |
| `typeof` | 是 | `typeof x === "string"` → `3` |
| `Array.isArray()` | 是 | `Array.isArray(x)` → `2` |
| `switch` | 是（含指令输入） | 逐子句字面量 |
| 真值判断 | 是（字面量实参） | `truthy(42)` → `"yes"`、`truthy(0)` → `"no"`；`undefined`/符号实参两支合并 |
| 三元 | 是（确定条件） | `pick(true)` → `"a"`；unknown 条件两支合并 |
| `in` | 部分 | 分叉，成员结果拓宽 |
| `?.` / `??` | 是（已知形状） | 浅层 + 深层 `??` / `?.` 折叠；`any` 接收者保持 `any` + `throws TypeError` |
