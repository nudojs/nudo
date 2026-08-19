---
sidebar_position: 5
description: 了解 Nudo 如何在分支中收窄类型——真值、判别联合、in 检查、switch 与 Array.isArray()，以及 `?.` 与 `??` 的求值期语义。
---

# 控制流收窄

Nudo 会追踪类型如何在分支、守卫和运算符的代码流中变化。当你使用条件测试一个值时，Nudo 会在条件为真的分支中收窄类型，并在假分支中保留互补类型。下面各节涵盖 Nudo 支持的所有分支收窄模式；最后一节介绍 `?.` 与 `??`——它们是求值期行为，并非收窄。

收窄效果通过 case 输入来观察：用 `@nudo:case` 给函数传入联合类型，再运行 `nudo infer`。输出中的每一行 `Case ... => ...` 都是该输入对应的结果类型——被收窄排除的分支不会出现在结果 union 之外。下文每个输出块都是紧邻代码的真实 `nudo infer` 运行结果。

## 真值收窄

当一个值出现在布尔上下文中（如 `if (x)`），Nudo 会从真分支中移除假值类型——`null`、`undefined`、`false`、`""` 和 `0`。假分支保留这些假值类型并移除真值类型。

```js
/**
 * @nudo:case "nullable name" (T.union(T.string, T.null, T.undefined))
 */
function greet(name) {
  if (name) {
    // name 收窄为 string（移除了 null 和 undefined）
    return name.toUpperCase();
  }
  // 此处 name 是 null | undefined
  return "unknown";
}
```

```text
=== greet ===

Case "nullable name": (string | null | undefined) => string | "unknown"
```

真分支得到 `string`（来自 `name.toUpperCase()`），假分支贡献字面量 `"unknown"`，结果保留两个成员。这次干净运行本身就是收窄的证据——如果没有守卫，同样的调用会报告 `Method 'toUpperCase' does not exist on type 'string | null | undefined' (nudo:no-method)`。

## 可辨识联合收窄

当你将属性与字符串字面量比较时（如 `obj.kind === "circle"`），Nudo 会过滤联合类型，仅保留判别属性匹配的成员。假分支保留其余成员。

```js
/**
 * @nudo:case "shape" (T.union(T.object({ kind: T.literal("circle"), radius: T.number }), T.object({ kind: T.literal("square"), side: T.number })))
 */
function area(shape) {
  if (shape.kind === "circle") {
    // shape 收窄为 { kind: "circle", radius: number }
    return shape.radius * 3.14159;
  }
  // shape 收窄为 { kind: "square", side: number }
  return shape.side * shape.side;
}
```

```text
=== area ===

Case "shape": ({ kind: "circle", radius: number } | { kind: "square", side: number }) => number
```

在 `if` 内部，`shape.radius` 能通过检查，因为联合已被过滤到 circle 成员；其后 `shape.side` 对 square 成员通过检查。两个分支都返回 `number`，因此结果是 `number`。

## `in` 运算符收窄

在条件中使用 `"key" in obj` 会将对象类型收窄为仅包含拥有该属性的成员。假分支排除这些成员。

```js
/**
 * @nudo:case "value" (T.union(T.object({ toJSON: () => "serialized" }), T.number))
 */
function serialize(value) {
  if ("toJSON" in value) {
    // value 收窄为 { toJSON: () => "serialized" }
    return value.toJSON();
  }
  // value 收窄为 number
  return String(value);
}
```

```text
=== serialize ===

Case "value": ({ toJSON: () => ... } | number) => "serialized" | string
```

真分支在收窄后的对象成员上调用 `toJSON` 方法，得到 `"serialized"`；假分支接收到 `number`，`String(value)` 得到 `string`。结果 union 保留两者。

## Switch 语句收窄

Nudo 按 `case` 子句收窄判别值。每个 case 分支获得匹配该字面量值的类型。`default` 分支捕获所有剩余类型。

```js
/**
 * @nudo:case "status" (T.union(T.literal("active"), T.literal("paused"), T.literal("stopped")))
 */
function describe(status) {
  switch (status) {
    case "active":
      // status: "active"
      return "Running";
    case "paused":
      // status: "paused"
      return "On hold";
    case "stopped":
      // status: "stopped"
      return "Shut down";
    default:
      return "Unknown";
  }
}
```

```text
=== describe ===

Case "status": ("active" | "paused" | "stopped") => "Running" | "On hold" | "Shut down" | "Unknown"
```

每个分支把自己返回的字面量贡献给结果。让每个分支直接返回判别值，可以更直观地看到收窄过程：

```js
/**
 * @nudo:case "status" (T.union(T.literal("active"), T.literal("paused"), T.literal("stopped")))
 */
function label(status) {
  switch (status) {
    case "active":
      return status; // "active"
    case "paused":
      return status; // "paused"
    case "stopped":
      return status; // "stopped"
    default:
      // 联合已穷尽——此处 status 是 never
      return status;
  }
}
```

```text
=== label ===

Case "status": ("active" | "paused" | "stopped") => "active" | "paused" | "stopped"
```

三个 case 分支各自返回自己收窄后的字面量，而 `default` 分支什么也没有贡献：联合已经穷尽，此处的 `status` 是 `never`。

## `Array.isArray()` 收窄

在条件中调用 `Array.isArray(value)` 会将类型分为数组和非数组两个分支。

```js
/**
 * @nudo:case "input" (T.union(T.array(T.number), T.string))
 */
function flatten(input) {
  if (Array.isArray(input)) {
    // input 收窄为 number[]
    return input[0];
  }
  // input 收窄为 string
  return input;
}
```

```text
=== flatten ===

Case "input": (number[] | string) => number | string
```

真分支中 `input` 是 `number[]`，因此 `input[0]` 得到 `number`；假分支中 `input` 是 `string`。

## 安全访问与缺省（`?.` 与 `??`）

可选链与空值合并不是分支收窄——它们在表达式求值期处理，不经过驱动上述模式的 `narrow()` 机制。`?.` 在接收方是**具体的** `null`/`undefined` 时短路为 `undefined`；`??` 从左操作数的类型中减去 `null` 和 `undefined`，若减完为空则回退到右侧。

### 可选链（`?.`）

当 `x?.prop` 的接收方求值为 `null` 或 `undefined` 时，链路短路，结果为 `undefined`。当接收方非空时，链路像普通访问一样解析属性。用两个 case 驱动可以同时展示这两条路径：

```js
/**
 * @nudo:case "object present" (T.object({ length: T.number }))
 * @nudo:case "null" (T.null)
 */
function getLength(maybeBox) {
  return maybeBox?.length ?? 0;
}
```

```text
=== getLength ===

Case "object present": ({ length: number }) => number
Case "null": (null) => 0

Combined: number
```

对象存在时，`maybeBox?.length` 解析为 `number`，`?? 0` 回退不会触发。传入 `null` 时，链路短路为 `undefined`，于是 `?? 0` 产生字面量 `0`。`Combined:` 行对所有 case 的结果取并集，再按吸收律化简——字面量 `0` 被另一 case 贡献的基类型 `number` 吸收。

注意 `?.` 只在接收方是**具体的**空值时短路，它本身不会收窄联合类型的接收方：若输入为 `T.union(T.object({ length: T.number }), T.null)`，访问 `maybeBox?.length` 仍会报告 `Property 'length' does not exist on type '{ length: number } | null' (nudo:no-method)`——应先用真值守卫，再做访问。

### 空值合并（`??`）

空值合并运算符会从左操作数的类型中移除 `null` 和 `undefined`。结果是非空的左操作数类型或右操作数的类型。

```js
/**
 * @nudo:case "config object" (T.object({ port: T.union(T.number, T.null, T.undefined) }))
 */
function getPort(config) {
  const port = config.port ?? 3000;
  return port;
}
```

```text
=== getPort ===

Case "config object": ({ port: number | null | undefined }) => number
```

`config.port` 到达时是 `number | null | undefined`，但 `?? 3000` 回退吸收了空值成员，因此 `port` 是 `number`。

## 总结

| 模式 | 条件 | 真分支 | 假分支 |
|---|---|---|---|
| 真值收窄 | `if (x)` | 排除 `null`、`undefined`、`false`、`""`、`0` | 保留假值类型 |
| 可辨识联合 | `x.kind === "lit"` | 保留匹配的联合成员 | 保留其余成员 |
| `in` 运算符 | `"key" in x` | 保留拥有该属性的类型 | 保留没有该属性的类型 |
| Switch | `switch (x) { case ... }` | 按 case 字面量收窄 | default 获取剩余类型（穷尽时为 `never`） |
| `Array.isArray()` | `Array.isArray(x)` | 仅数组类型 | 仅非数组类型 |

`?.` 与 `??` 有意不在这张表中：它们是求值期的短路与缺省行为（见上文*安全访问与缺省*），不是分支收窄。
