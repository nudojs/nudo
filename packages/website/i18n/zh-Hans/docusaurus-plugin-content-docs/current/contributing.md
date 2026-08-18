---
sidebar_position: 100
---

# 贡献指南

感谢你对 Nudo 的贡献兴趣。本文档涵盖环境准备、项目结构、开发流程以及如何扩展系统。

---

## 环境要求

- **Node.js** 18 或更高
- **pnpm** 8 或更高

```bash
npm install -g pnpm
```

---

## 克隆与配置

```bash
git clone https://github.com/nudojs/nudo.git
cd nudo
pnpm install
pnpm run build
```

---

## 项目结构

本 monorepo 使用 pnpm workspaces。主要包如下：

| 包 | 描述 |
|---------|-------------|
| `@nudojs/core` | 类型值、Ops、Environment |
| `@nudojs/parser` | Babel 解析、指令提取、`parseTypeValueExpr` |
| `@nudojs/cli` | 求值器、`nudo infer` / `nudo watch` |
| `@nudojs/service` | 高层 API：`analyzeFile`、`getTypeAtPosition`、`getCompletionsAtPosition` |
| `@nudojs/lsp` | Language Server Protocol 实现 |
| `@nudojs/harvester` | 把 `@types/*.d.ts` 声明转换为 Nudo env 文件（`nudo harvest` 的底层引擎） |
| `@nudojs/mcp` | 面向 AI 代理暴露推断工具的 MCP 服务器 |
| `@nudojs/env-es` | 内置 ES 标准全局 API 类型定义（`/// @nudo:env es`） |
| `@nudojs/env-node` | 内置 Node.js API 类型定义（`/// @nudo:env node`） |
| `@nudojs/env-web` | 内置 Web 平台 API 类型定义（`/// @nudo:env web`） |
| `vite-plugin-nudo` | 开发阶段的类型推断 Vite 插件 |
| `nudo-vscode` | VS Code / Cursor 扩展 |
| `website` | Docusaurus 文档站点 |

---

## 开发流程

### 运行测试

```bash
pnpm run test
pnpm run test:watch   # 监视模式
```

### 构建所有包

```bash
pnpm run build
```

### 本地运行 CLI

```bash
pnpm exec tsx packages/cli/src/index.ts infer path/to/file.js
# 或
pnpm exec nudo infer path/to/file.js
```

---

## 如何添加新的运算符语义（Ops）

1. **在 `packages/core/src/ops.ts` 中添加 op：**

   ```typescript
   export const Ops = {
     // ...
     myOp(left: TypeValue, right: TypeValue): TypeValue {
       // 处理 literal × literal、literal × abstract、abstract × abstract
       return T.unknown; // 兜底
     },
   } as const;

   const binaryOpMap = {
     // ...
     "myOpSymbol": Ops.myOp,
   };
   ```

2. **在求值器中接入**（`packages/cli/src/evaluator.ts`）：
   - 二元运算：在 `BinaryExpression` 处理中将 AST 运算符字符串映射到你的 op。
   - 求值器对标准二元运算使用 `applyBinaryOp(op, left, right)`；如需要可扩展 `binaryOpMap`。
   - 一元运算：在 `UnaryExpression` 分支中添加处理并调用 `Ops.myUnary(operand)`。

3. **添加测试**，位于 `packages/core/src/__tests__/ops.test.ts` 或 `packages/cli/src/__tests__/evaluator*.test.ts`。

---

## 如何添加新指令

1. **在 `packages/parser/src/directives.ts` 中定义指令类型：**

   ```typescript
   export type MyDirective = { kind: "my"; param: string };
   export type Directive = CaseDirective | ... | MyDirective;
   ```

2. **在 `parseDirectivesFromComments` 中添加正则与解析逻辑：**

   ```typescript
   const MY_REGEX = /@nudo:my\s+(\w+)/g;
   // 在循环中：match、extract、push { kind: "my", param: ... }
   ```

3. **在求值器或 service 中使用指令：**
   - `packages/cli/src/index.ts` 或 `packages/service/src/analyzer.ts` 中实现分析行为。
   - 用 `d.kind === "my"` 过滤 `fn.directives` 并应用你的逻辑。

4. 若指令接收类型值参数，需**更新 `parseTypeValueExpr`**。

5. **添加测试**，位于 `packages/parser/src/__tests__/directives*.test.ts`。

---

## PR 规范

- 保持 PR 聚焦； prefer 多个小 PR 而非一个大 PR。
- 为新行为添加或更新测试。
- 提交前运行 `pnpm run build` 和 `pnpm run test`。
- 添加指令或公开 API 时更新文档（如 `docs/concepts/directives.md`、API 参考）。
- **文档防漂移规则**：修改 CLI 命令/选项、导出 API 或指令语法时，必须在同一个 PR 中同步更新 `packages/website` 下的文档 —— 英文源（`docs/`）与中文镜像（`i18n/zh-Hans/docusaurus-plugin-content-docs/current/`）都要改。

---

## 代码风格

- **TypeScript**：strict 模式，ES modules。
- **类型**：prefer `type` 而非 `interface` 和 `enum`。
- **结构**：避免 class/OOP；使用普通函数和对象。
- **可变性**：尽量减少 `let`；prefer `const` 和纯函数。
- **控制流**：减少条件分支；使用 early return 和小函数。
