---
sidebar_position: 1
---

# CLI 使用指南

`nudo` CLI 是在使用 Nudo 指令的 JavaScript 文件上运行类型推断的主要方式。可通过全局安装或 `npx` 使用：

```bash
npm install -g @nudojs/cli
# or
pnpm add -g @nudojs/cli
```

## `nudo infer`

从使用 `@nudo:*` 指令的 JavaScript 文件推断类型。

```bash
nudo infer <file>
```

### 选项

| Option | Description |
|--------|-------------|
| `--dts` | 在源文件旁生成 `.d.ts` 声明文件 |
| `--loc` | 在输出中显示源码位置（file:line:column） |

### 示例

基本推断：

```bash
nudo infer math.js
```

输出：

```
=== subtract ===

Case "positive numbers": (5, 3) => 2
Case "negative result": (1, 10) => -9
Case "symbolic": (number, number) => number

Combined: number
```

生成 TypeScript 声明文件：

```bash
nudo infer math.js --dts
```

这会在源文件旁创建 `math.d.ts`，包含推断出的函数签名。

显示源码位置：

```bash
nudo infer src/utils.js --loc
```

输出包含位置信息：

```
=== subtract (src/utils.js:15:1) ===

Case "positive numbers": (5, 3) => 2
...
```

---

## `nudo watch`

监听文件或目录变化，在变更时重新运行推断。

```bash
nudo watch <path>
```

### 选项

| Option | Description |
|--------|-------------|
| `--dts` | 每次运行时生成 `.d.ts` 文件 |

### 示例

监听当前目录：

```bash
nudo watch .
```

监听特定文件：

```bash
nudo watch src/math.js
```

监听并生成 `.d.ts`：

```bash
nudo watch . --dts
```

### 监听模式行为

- **文件过滤**：监听模式仅处理至少包含一个 Nudo 指令的 `.js` 文件：`@nudo:case`、`@nudo:mock`、`@nudo:pure`、`@nudo:skip`、`@nudo:sample` 或 `@nudo:returns`。
- **目录监听**：监听目录时，Nudo 会递归扫描匹配的文件，排除 `node_modules`。
- **防抖**：文件变更会防抖（200ms），避免在快速编辑时重复执行。

---

## 实用工作流

1. **使用监听模式开发**：编辑时在终端运行 `nudo watch . --dts`。每次保存都会触发重新推断和 `.d.ts` 生成。

2. **CI / 提交前检查**：运行 `nudo infer src/**/*.js` 验证整个代码库的推断是否成功。

3. **生成声明文件**：使用 `nudo infer main.js --dts` 为需要 TypeScript 定义的使用方生成 `.d.ts`。
