---
sidebar_position: 2
---

# VS Code 扩展

**nudo-vscode** 扩展将 Nudo 的类型推断带入编辑器，提供悬停类型、补全、CodeLens 和内联提示。

## 安装

1. 打开扩展视图（`Cmd+Shift+X` / `Ctrl+Shift+X`）
2. 搜索 **nudo-vscode** 或 "Nudo"
3. 点击 **安装**

或从命令行安装：

```bash
code --install-extension nudojs.nudo-vscode
```

## 激活

打开 JavaScript 文件时扩展会激活。它使用 `@nudojs/lsp` 包运行 Language Server Protocol（LSP）服务器，提供所有编辑器功能。

**文件检测**：扩展会分析包含 Nudo 指令（`@nudo:case`、`@nudo:mock`、`@nudo:pure`、`@nudo:skip`、`@nudo:sample`、`@nudo:returns`）的 `.js`、`.ts` 和 `.mjs` 文件。不含这些指令的文件不会参与分析。

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

### 命令："Nudo: Select Case"

也可以调用命令面板（`Cmd+Shift+P` / `Ctrl+Shift+P`）并运行 **Nudo: Select Case**。该命令注册为 `nudo.selectCase`，供 CodeLens 用于切换函数的激活 case。

---

## 总结

| Feature        | Description                                              |
|----------------|----------------------------------------------------------|
| Hover          | 通过 `getTypeAtPosition` 在光标处显示推断类型             |
| Completions    | 在 `.` 后触发；属性和方法建议                            |
| CodeLens       | `@nudo:case` 行上的 case 选择                            |
| Inlay hints    | 内联类型注释                                             |
| Status bar     | 激活时显示 "Nudo" 指示器                                 |
| Command        | `nudo.selectCase` — 选择推断的激活 case                  |
