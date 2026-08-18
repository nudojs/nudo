---
sidebar_position: 6
---

# @nudojs/lsp

Nudo 语言服务器协议（LSP）包的 API 参考。`@nudojs/lsp` 把[服务层](./service.md)封装为编辑器可消费的语言服务器：诊断、悬停类型、补全、用例切换 CodeLens、内联提示和符号导航。[nudo-vscode 扩展](../guides/vscode.md)通过 IPC 启动这个服务器，驱动其全部编辑器功能。

## 包结构

包的入口点（`main`）是 `src/server.ts` —— **导入它就会启动服务器**：它以模块副作用调用 `createConnection(ProposedFeatures.all)` 和 `connection.listen()`，通过 stdio/IPC 讲 LSP。不存在 `createServer()` 之类的工厂函数。

可测试的编程式 API 位于三个同级源码模块中，它们特意从 `server.ts` 抽出，从而无需真实 LSP 连接即可直接驱动：

| 模块 | 用途 |
|--------|---------|
| `src/validation.ts` | 诊断管线、分析缓存、脏传播、Nudo 文件检测 |
| `src/symbols.ts` | 符号表构建与定义/引用查找，支撑导航类 handler |
| `src/semantic-tokens.ts` | 语义 token 图例与增量编码器 |

`server.ts` 把这些函数接到 `connection` / `documents` 上；测试则把它们接到伪造实现上。

## validation.ts

### validateText

```typescript
validateText(
  filePath: string,
  uri: string,
  text: string,
  version: number,
  deps: ValidateTextDeps,
  propagate?: boolean,           // 默认 false
): Promise<void>
```

端到端分析一个文档：

1. **门控** —— 若提供了 `deps.isNudoUri` 且拒绝了该 URI，发布空诊断列表并返回。
2. **分析** —— 运行 `@nudojs/service` 的 `analyzeFileAsync`（异步入口，因此基于路径的 `/// @nudo:env` 文件会通过动态 import 预加载）。分析错误会发布为单条 error 诊断（`Analysis error: <message>`），而不是抛出。
3. **发布** —— 把每条 `AnalysisResult` 诊断映射为 LSP 诊断：severity `error`/`warning`/`info`、`source: "nudo"`、诊断 `code`、`unnecessary` 标签，并把 `origin` 溯源映射为 `relatedInformation`（`"value originates here"`，1 基位置转换为 0 基）。
4. **缓存** —— 结果存入 `analysisCache`（按文件路径键控、带版本），并将文件登记到 `knownFiles`。
5. **传播** —— 当 `propagate` 为 `true` 且提供了 `getOpenDocumentByPath` 时，对 `knownFiles` 构建模块图，从变更文件计算脏集合，并以 `propagate = false` 对每个**打开的**依赖方重验一次 —— 脏不会再级联下去。

`ValidateTextDeps` 是一个依赖注入记录，这正是该管线可以在真实连接之外测试的原因：

```typescript
type ValidateTextDeps = {
  sendDiagnostics: (params: { uri: string; diagnostics: LspDiagnostic[] }) => void;
  isNudoUri?: (uri: string) => boolean;
  getActiveCases?: (uri: string) => Map<string, number>;
  getOpenDocumentByPath?: (filePath: string) => OpenDocumentLike | undefined;
};

type OpenDocumentLike = {
  uri: string;
  version: number;
  getText(): string;
};
```

示例 —— 用伪造依赖验证一个缓冲区（包内测试的用法）：

```typescript
import { validateText } from "@nudojs/lsp/src/validation.ts";

const sent = new Map<string, LspDiagnostic[]>();
await validateText("/src/app.js", "file:///src/app.js", source, 1, {
  sendDiagnostics: (p) => sent.set(p.uri, p.diagnostics),
});
```

该包没有声明 `exports` 映射且直接发布 TypeScript 源码，因此这些模块按路径导入（`@nudojs/lsp/src/validation.ts`、`src/symbols.ts`、`src/semantic-tokens.ts`），并需要 `tsx` 这类感知 TS 的加载器 —— 与 VS Code 扩展运行服务器本体所用的是同一个加载器。

### getCachedOrAnalyze

```typescript
getCachedOrAnalyze(
  filePath: string,
  source: string,
  version: number,
  activeCases?: Map<string, number>,
): AnalysisResult
```

面向高频 handler（悬停、补全）的同步、带缓存分析。文档版本匹配时返回缓存的 `AnalysisResult`；否则运行同步 `analyzeFile` 并刷新缓存。基于路径的 `@nudo:env` 文件在这条路径上会降级 —— 异步预加载只发生在 `validateText` 内部。

### hasNudoDirectives

```typescript
hasNudoDirectives(source: string): boolean
```

源码包含任一 Nudo 指令时返回 `true`：`@nudo:case`、`@nudo:mock`、`@nudo:pure`、`@nudo:skip`、`@nudo:sample`、`@nudo:returns`、`@nudo:env`、`@nudo:mock-module`、`@nudo:as`、`@nudo:replace`。服务器将它（加上 `.js` / `.ts` / `.mjs` 扩展名检查）用作 `isNudoFile` 门控 —— 下文的每个功能 handler 对未通过门控的文件都是空操作。

### uriToFilePath

```typescript
uriToFilePath(uri: string): string
```

剥离 `file://` 前缀（并解码百分号转义）；非 `file://` 的 URI 原样返回。

### 模块状态

| 导出 | 类型 | 用途 |
|--------|------|---------|
| `analysisCache` | `Map<string, { version: number; result: AnalysisResult }>` | 每文件分析结果，按文件路径键控，版本来自 `TextDocument.version` |
| `knownFiles` | `Set<string>` | 本会话中成功分析过的所有文件 —— 脏传播的节点集 |
| `clearValidationState()` | `() => void` | 测试钩子 —— 同时重置两者 |

## symbols.ts

支撑跳转定义、查找引用和重命名 handler。相关类型（`SymbolTable`、`SymbolInfo`、`ReferenceInfo`）来自 `@nudojs/service`。

```typescript
buildSymbolTable(ast: Node, uri: string): SymbolTable;
findDefinition(symbolTable: SymbolTable, name: string): SymbolInfo | null;
findReferences(symbolTable: SymbolTable, name: string): ReferenceInfo[];
findIdentifierAtPosition(ast: Node, line: number, column: number): string | null;
```

`findIdentifierAtPosition` 接收 **1 基行号**和 0 基列号，与解析器位置一致。对不完整 AST 的遍历失败会被吞掉 —— 这些函数降级为空结果而不是抛出异常。

## semantic-tokens.ts

```typescript
encodeSemanticTokens(tokens: SemanticToken[]): number[];
```

把 `{ line, char, length, typeIndex, modifierBitmask }` token 增量编码为 LSP 期望的扁平 `number[]`。`TOKEN_TYPES`（`function`、`variable`、`parameter`、`property`、`type`、`keyword`、`string`、`number`、`comment`、`decorator`）与 `TOKEN_MODIFIERS`（`declaration`、`readonly`、`deprecated`、`unreachable`）构成服务器声明的图例。服务器的 semanticTokens handler 目前返回空 token 集 —— 图例和编码器已就位，供后续更丰富的着色使用。

## 服务器能力

`src/server.ts` 实际注册的内容（`connection.onInitialize`）：

| 能力 | Handler | 行为 |
|------------|---------|----------|
| 悬停 | `onHover` | 通过 `getTypeAtPosition` 获取光标处推断类型，渲染为 `nudo` 围栏 markdown 代码块 |
| 补全（触发 `.`） | `onCompletion` | 来自 `getCompletionsAtPosition` 的属性/方法/变量项 |
| CodeLens | `onCodeLens` | 每个 `@nudo:case` 一个透镜：激活用例显示 `● case "name"`，其余显示 `○ case "name"`；点击发送自定义 `nudo/selectCase` 请求并刷新透镜 |
| 内联提示 | `languages.inlayHint.on` | 来自分析 `caseHints` 的行尾 `Type` 提示 |
| 定义 | `onDefinition` | `buildSymbolTable` + `findDefinition` |
| 引用 | `onReferences` | `buildSymbolTable` + `findReferences` |
| 重命名 | `onRenameRequest` | 对定义及全部引用生成 workspace edit |
| 代码操作（`quickfix`） | `onCodeAction` | `nudo-unreachable` 对应 *Remove unreachable code*；`nudo-assertion-failed` 对应 *Update @nudo:returns to match inferred type* |
| 签名帮助（触发 `(`、`,`） | `onSignatureHelp` | 定位包裹的调用、对被调函数求类型、高亮当前参数 |
| 语义 token（full） | `languages.semanticTokens.on` | 声明了图例；当前不产出 token |

文本同步方式为 `Full`。内容变更防抖 300 ms 后才以 `propagate = true` 触发 `validateText`（这是唯一的传播入口）；关闭文档会取消其计时器、丢弃缓存条目并清除诊断。

### 自定义请求

| 请求 | 参数 | 返回 |
|---------|--------|---------|
| `nudo/selectCase` | `{ uri: string; functionName: string; caseIndex: number }` | 以新的激活用例重验文档、请求 CodeLens 刷新，返回 `{ success: true }` |
| `nudo/getActiveCases` | `{ uri: string }` | `Record<string, number>` —— 每个函数的激活用例索引 |

## 与 VS Code 扩展的关系

`nudo-vscode` 扩展没有重新实现这些内容：它把 `@nudojs/lsp` 的 `src/server.ts` 作为子进程启动（通过 `tsx`、走 IPC 传输），并把自定义的 `nudo.selectCase` 命令转发给服务器。编辑器侧视角的功能介绍见 [VS Code 指南](../guides/vscode.md)。
