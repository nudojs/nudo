---
sidebar_position: 5
---

# 控制流收窄

Nudo 会追踪类型如何在分支、守卫和运算符的代码流中变化。当你使用条件测试一个值时，Nudo 会在条件为真的分支中收窄类型，并在假分支中保留互补类型。本指南涵盖 Nudo 支持的所有收窄模式。

## 真值收窄

当一个值出现在布尔上下文中（如 `if (x)`），Nudo 会从真分支中移除假值类型——`null`、`undefined`、`false`、`""` 和 `0`。假分支保留这些假值类型并移除真值类型。

```js
/**
 * @nudo:returns
 */
function greet(name) {
  if (name) {
    // name is string (null and undefined removed)
    return name.toUpperCase();
  }
  // name is null | undefined
  return "unknown";
}
```

```
nudo: true branch:  name: string
nudo: false branch: name: null | undefined
```

## 可选链（`?.`）

当你使用可选链（`?.`）时，Nudo 知道如果对象是 `null` 或 `undefined`，结果就是 `undefined`。访问操作本身会在非短路路径上将对象类型收窄为排除空值的类型。

```js
/**
 * @nudo:returns
 */
function getLength(maybeStr) {
  const len = maybeStr?.length;
  // len is number | undefined
  return len ?? 0;
}
```

```
nudo: maybeStr?.length -> number | undefined
```

## 空值合并（`??`）

空值合并运算符会从左操作数的类型中移除 `null` 和 `undefined`。结果是非空的左操作数类型或右操作数的类型。

```js
/**
 * @nudo:returns
 */
function getPort(config) {
  const port = config.port ?? 3000;
  // port is number (null | undefined removed from config.port)
  return port;
}
```

```
nudo: config.port: number | null | undefined
nudo: config.port ?? 3000 -> number
```

## 可辨识联合收窄

当你将属性与字符串字面量比较时（如 `obj.kind === "circle"`），Nudo 会过滤联合类型，仅保留判别属性匹配的成员。假分支保留其余成员。

```js
/**
 * @nudo:returns
 */
function area(shape) {
  if (shape.kind === "circle") {
    // shape: { kind: "circle", radius: number }
    return Math.PI * shape.radius ** 2;
  }
  if (shape.kind === "square") {
    // shape: { kind: "square", side: number }
    return shape.side ** 2;
  }
  // shape: { kind: "triangle", base: number, height: number }
  return shape.base * shape.height / 2;
}
```

```
nudo: shape: { kind: "circle", radius: number } | { kind: "square", side: number } | { kind: "triangle", base: number, height: number }
nudo: after shape.kind === "circle":  { kind: "circle", radius: number }
nudo: after shape.kind === "square":  { kind: "square", side: number }
nudo: else branch:                    { kind: "triangle", base: number, height: number }
```

## `in` 运算符收窄

在条件中使用 `"key" in obj` 会将对象类型收窄为仅包含拥有该属性的成员。假分支排除这些成员。

```js
/**
 * @nudo:returns
 */
function serialize(value) {
  if ("toJSON" in value) {
    // value narrowed to types with a toJSON property
    return value.toJSON();
  }
  return String(value);
}
```

```
nudo: true branch:  value: { toJSON: () => any, ... }
nudo: false branch: value: string | number | boolean | ...
```

## Switch 语句收窄

Nudo 按 `case` 子句收窄判别值。每个 case 分支获得匹配该字面量值的类型。`default` 分支捕获所有剩余类型。

```js
/**
 * @nudo:returns
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
      // status: string (exhausted literal cases removed if union is complete)
      return "Unknown";
  }
}
```

```
nudo: case "active":  status: "active"
nudo: case "paused":  status: "paused"
nudo: case "stopped": status: "stopped"
nudo: default:        status: string
```

## `Array.isArray()` 收窄

在条件中调用 `Array.isArray(value)` 会将类型分为数组和非数组两个分支。

```js
/**
 * @nudo:returns
 */
function flatten(input) {
  if (Array.isArray(input)) {
    // input: array
    return input.flat();
  }
  // input: number | string | ...
  return [input];
}
```

```
nudo: true branch:  input: array
nudo: false branch: input: number | string | ...
```

## 总结

| 模式 | 条件 | 真分支 | 假分支 |
|---|---|---|---|
| 真值收窄 | `if (x)` | 排除 `null`、`undefined`、`false`、`""`、`0` | 保留假值类型 |
| 可选链 | `x?.prop` | 结果为 `T \| undefined` | 对象为 `null \| undefined` |
| 空值合并 | `x ?? fallback` | 结果排除 `null \| undefined` | 不适用（表达式） |
| 可辨识联合 | `x.kind === "lit"` | 保留匹配的联合成员 | 保留其余成员 |
| `in` 运算符 | `"key" in x` | 保留拥有该属性的类型 | 保留没有该属性的类型 |
| Switch | `switch (x) { case ... }` | 按 case 字面量收窄 | default 获取剩余类型 |
| `Array.isArray()` | `Array.isArray(x)` | 仅数组类型 | 仅非数组类型 |
