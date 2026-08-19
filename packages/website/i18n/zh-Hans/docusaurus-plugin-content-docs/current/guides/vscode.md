---
sidebar_position: 2
description: "安装 nudo-vscode 扩展：悬停类型、补全、用例切换 CodeLens、内联提示，以及由 Nudo 语言服务器驱动的诊断。"
---

# VS Code 扩展

**nudo-vscode** 扩展将 Nudo 的类型推断带入编辑器，提供悬停类型、补全、CodeLens 和内联提示。

## 安装

1. 打开扩展视图（`Cmd+Shift+X` / `Ctrl+Shift+X`）
2. 搜索 **nudo-vscode** 或 "Nudo"
3. 点击 **安装**

或从命令行安装：

```bash
code --install-extension wmzy.nudo-vscode
```

## 激活

打开 JavaScript 文件时扩展会激活。它使用 `@nudojs/lsp` 包运行 Language Server Protocol（LSP）服务器，提供所有编辑器功能。

**文件检测**：语言服务器会分析包含 Nudo 指令的 `.js`、`.ts` 和 `.mjs` 文件——`@nudo:case`、`@nudo:mock`、`@nudo:pure`、`@nudo:skip`、`@nudo:sample`、`@nudo:returns`、`@nudo:env`、`@nudo:mock-module`、`@nudo:as`、`@nudo:replace`。每个指令的完整语法见[指令参考](../concepts/directives.md)。不含这些指令的文件不会参与分析。

## 功能

### 悬停类型

将鼠标悬停在表达式上可查看其推断类型。扩展通过 `getTypeAtPosition` 计算光标处的类型，并在悬停工具提示中显示。

```javascript
/**
 * @nudo:case "test" (42)
 */
function double(x) {
  return x * 2;  // hover over x → number
}
```

### 补全

在表达式后输入 `.` 时会触发补全。LSP 会根据该位置的推断类型建议属性和方法。

```javascript
/**
 * @nudo:case "test" ("hello")
 */
function upper(s) {
  return s.  // completions: toUpperCase, toLowerCase, slice, etc.
}
```

### `@nudo:case` 行上的 CodeLens

每个 `@nudo:case` 指令会在函数上方显示 CodeLens。点击 lens 可将该 case 选为类型推断的当前上下文。当前激活的 case 会以不同样式高亮显示。

- **● case "name"** — 当前激活
- **○ case "name"** — 点击激活

这样可以在不修改文件的情况下查看不同输入下的类型。

### 内联提示

内联提示会在行内显示类型信息。在每个 case 的结果之后或相关位置，Nudo 会将推断的类型以灰色注释形式显示。

### 状态栏

右侧状态栏在扩展激活时显示 `Nudo`，悬停提示为 "Nudo Type Inference Engine"。

### 跳转到定义

跳转到函数、变量或类的定义。将光标放在标识符上并按 `F12`（或右键 -> Go to Definition）。

```javascript
function process(data) {
  return transform(data);  // F12 on transform → jumps to its definition
}
```

### 查找引用

在当前文件中查找符号的所有使用。按 `Shift+F12`（或右键 -> Find All References）。

### 重命名符号

安全地重命名符号及其所有引用。按 `F2`（或右键 -> Rename Symbol）。Nudo 会验证新名称不会与现有符号冲突。

### 签名帮助

在函数调用的括号内输入时，Nudo 会显示参数提示。在输入 `(` 或 `,` 时自动激活。

```javascript
/**
 * @nudo:case "test" (T.string, T.number)
 */
function createUser(name, age) { ... }

createUser(  // ← signature help shows: (name: string, age: number)
```

### 代码操作 / 快速修复

当 Nudo 报告诊断时，可使用快速修复建议。点击灯泡图标或按 `Cmd+.` / `Ctrl+.` 查看可用修复：

- **移除不可达代码** ——针对 `return`/`throw` 之后的代码
- **更新 @nudo:returns** ——当断言与推断类型不匹配时

### 语义标记

Nudo 根据推断类型提供语法高亮。函数、变量和死代码的高亮与标准语法着色不同。

### 命令："Nudo: Select Case"

也可以调用命令面板（`Cmd+Shift+P` / `Ctrl+Shift+P`）并运行 **Nudo: Select Case**。该命令注册为 `nudo.selectCase`，供 CodeLens 用于切换函数的激活 case。

---

## 资源占用

Nudo 语言服务器的设计目标是在你的其他工具旁保持轻量：

- **内存有界。** 请求之间，服务器只持有轻量簿记 —— 文件路径、函数名和少量每文件记录 —— 你一关闭文件，它的分析结果即被丢弃。服务器绝不在内存中保留解析后的语法树，其定位是与 TypeScript 自身的语言功能**并排**运行，而非取而代之。
- **打开即出诊断。** 打开文件就会立即分析；无需先编辑一次才能看到 Nudo 的诊断。
- **陈旧诊断在重开时消除。** 你*关闭*的文件不会因其依赖发生变化而被重新分析 —— 它的诊断保持原样，直到你再次打开该文件时刷新。从磁盘删除的文件会自动清空诊断。

---

## 总结

| 功能             | 描述                                                     |
|-------------------|----------------------------------------------------------|
| 悬停              | 通过 `getTypeAtPosition` 在光标处显示推断类型             |
| 补全              | 在 `.` 后触发；属性和方法建议                            |
| CodeLens          | `@nudo:case` 行上的 case 选择                            |
| 内联提示          | 内联类型注释                                             |
| 跳转到定义        | 跳转到符号定义（`F12`）                                  |
| 查找引用          | 查找符号的所有使用（`Shift+F12`）                        |
| 重命名符号        | 重命名符号及其所有引用（`F2`）                           |
| 签名帮助          | 函数调用内的参数提示                                     |
| 代码操作          | 诊断的快速修复                                           |
| 语义标记          | 基于类型的语法高亮                                       |
| 状态栏            | 激活时显示 "Nudo" 指示器                                 |
| 命令              | `nudo.selectCase` — 选择推断的激活 case                  |
