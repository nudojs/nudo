---
sidebar_position: 6
description: "@nudojs/lsp API —— 基于 @nudojs/service 的语言服务器：验证管线与缓存、符号、语义 token、agent 工具、服务器能力。"
---

# @nudojs/lsp

Nudo 语言服务器协议（LSP）包的 API 参考。`@nudojs/lsp` 把[服务层](./service.md)封装为编辑器可消费的语言服务器：诊断、悬停类型、补全、用例切换 CodeLens、内联提示和符号导航。[nudo-vscode 扩展](../guides/vscode.md)通过 IPC 启动这个服务器；[Zed 扩展](../guides/zed.md)通过 stdio 启动同一服务器。

## 包结构

包的入口点（`main`）是 `dist/server.js`（由 `src/server.ts` 构建）。**导入它就会启动服务器**：它以模块副作用调用 `createConnection(ProposedFeatures.all)` 和 `connection.listen()`，通过 stdio/IPC 讲 LSP。不存在 `createServer()` 之类的工厂函数。包还提供带 shebang 的 `nudo-lsp` bin（指向 `dist/server.js`），供以裸命令拉起服务器的编辑器使用——[Zed 扩展](../guides/zed.md)与 agent 桥接走这条路径。

可测试的编程式 API 位于三个同级源码模块中，它们特意从 `server.ts` 抽出，从而无需真实 LSP 连接即可直接驱动：

| 模块 | 用途 |
|--------|---------|
| `src/validation.ts` | 诊断管线、分析缓存、脏传播、Nudo 文件检测 |
| `src/symbols.ts` | 符号表构建与定义/引用查找，支撑导航类 handler |
| `src/semantic-tokens.ts` | 语义 token 图例与增量编码器（从 `@nudojs/service` 再导出） |
| `src/agent-tools.ts` | agent 命令实现（`nudo.whatIf`/`suggestCase`/`trace`）——见 [Agent API](./agent.md) 页 |

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
  /** buffer-aware 模块装载器（A4/E5）；缺省走磁盘 defaultLoadModule */
  loadModule?: (spec: string, fromFile: string) => string | undefined;
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

发布包只含编译后的 `dist/`（`files: ["dist"]`），带 `exports` 映射与 `nudo-lsp` bin——请 import 入口或直接跑 bin，不要从 npm 包按路径 import `src/*`。上表中的同级模块（`src/validation.ts`、`src/symbols.ts`、`src/semantic-tokens.ts`、`src/agent-tools.ts`）是 monorepo 内的可测面：在仓库里通过 `tsx` 这类 TS 加载器（或 workspace path alias）直接驱动。

### getCachedOrAnalyze

```typescript
getCachedOrAnalyze(
  filePath: string,
  source: string,
  version: number,
  activeCases?: Map<string, number>,
  loadModule?: (spec: string, fromFile: string) => string | undefined,
): AnalysisResult
```

面向高频 handler（悬停、补全、pull 诊断）的同步、带缓存分析。文档 `version` **与** `casesHash` 同时命中时复用缓存的 `AnalysisResult`；否则运行同步 `analyzeFile`（可传 buffer-aware `loadModule`）并刷新缓存。基于路径的 `@nudo:env` 文件在这条路径上会降级 —— 异步预加载只发生在 `validateText` 内部。侧车/依赖变更经 `handleNudoDepFileChanged` 失效（删缓存 + force 重验 + `workspace/diagnostic/refresh`）。

### isNudoFile 门控

服务端 `isNudoFile(uri)` **不是**纯指令扫描，而是：

1. `isNudoTargetPath` —— 仅 `.js` / `.mjs` / `.ts`，排除 `.d.ts`、JSX、`*.nudo.{js,mjs,ts}` 侧车与 `*.nudo.draft.{js,mjs,ts}` draft 产物；
2. `shouldAnalyzeFile(filePath, text)` —— 路径 + `package.json#nudo.analysis.mode`（出厂默认 `exports`；`all` / `directives` 可显式配置）。

结果按 URI 缓存，open/change/close 时失效。

### toLspDiagnostic

```typescript
toLspDiagnostic(d: Diagnostic, uri: string): LspDiagnostic
```

把一条 `@nudojs/service` 诊断映射为 LSP 形状：severity `error`→1/`warning`→2/`info`→3，1 基位置转 0 基，`source: "nudo"`、`tags: ["unnecessary"]`，并把 `origin` 映射为 `relatedInformation` 条目（`"value originates here"`）。导出它以便测试与其他客户端复用完全相同的映射。

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
| `moduleGraphCache` | `Map<string, { mtimeMs: number; size: number; edges: string[] }>` | 会话级模块图边缓存，与 `buildModuleGraph` 共享 —— 见[内存与隔离模型](#内存与隔离模型) |
| `forgetValidatedFile(filePath)` | `(filePath: string) => void` | 磁盘上被删除文件的 `knownFiles` 与 `analysisCache` 登记项一并移除 |
| `evictModuleGraphCacheEntries(uris)` | `(uris: string[]) => void` | 移除被删除文件的 `moduleGraphCache` 条目（接收 uri，按文件路径逐出） |
| `clearValidationState()` | `() => void` | 测试钩子 —— 重置以上全部 |

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

把 `{ line, char, length, typeIndex, modifierBitmask }` token 增量编码为 LSP 期望的扁平 `number[]`。`TOKEN_TYPES`（`function`、`variable`、`parameter`、`property`、`type`、`keyword`、`string`、`number`、`comment`、`decorator`、`method`）与 `TOKEN_MODIFIERS`（`declaration`、`readonly`、`deprecated`、`unreachable`、`contract`、`generated`、`derived`）构成服务器声明的图例。服务器的 semanticTokens handler 基于 `@nudojs/service` 的 `buildSemanticTokens` 对分析结果着色——函数绑定标为 `function`，其余绑定标为 `variable`，参数标为 `parameter`；顶层 named-export 函数绑定额外带与 CodeLens `● interface` 同源的 interface 档 modifier（A7）。

## 服务器能力

服务器在 `connection.onInitialize` 中注册的内容（源码 `src/server.ts`）：

| 能力 | Handler | 行为 |
|------------|---------|----------|
| 悬停 | `onHover` | 通过 `getTypeAtPosition` 获取光标处推断类型；光标落在导出函数名上时，首行为 `● interface / handwritten|generated|implicit`（与 CodeLens 同源），handwritten/generated 另附有效契约展示 |
| 补全（触发 `.`） | `onCompletion` | 来自 `getCompletionsAtPosition` 的属性/方法/变量项 |
| CodeLens | `onCodeLens` | interface 档在前：`● interface / handwritten|generated|implicit`（+ persist/update + 非手写导出上的 `⚡ draft interface`）；case 为 debug 副层——激活 `● case "name"`，其余 `○`。点击发送 `nudo.selectCase` / `nudo.interface` / `nudo.interface.draft` / `nudo.interfaceEmit` 并刷新透镜 |
| 内联提示 | `languages.inlayHint` | 行尾 case `Type` 提示 + Abs 参数/返回 inlay；implicit 导出带 `· derived` |
| 定义 | `onDefinition` | `buildSymbolTable` + `findDefinition`（含侧车绑定名） |
| 引用 | `onReferences` | `buildSymbolTable` + `findReferences` |
| 重命名 | `onRenameRequest` | 对定义及全部引用生成 workspace edit |
| 代码操作（`quickfix`） | `onCodeAction` | `nudo-unreachable` 对应 *Remove unreachable code*；契约/参数修复 |
| 签名帮助（触发 `(`、`,`） | `onSignatureHelp` | 定位包裹的调用、对被调函数求类型、高亮当前参数 |
| 语义 token（full） | `languages.semanticTokens` | `buildSemanticTokens` 推断着色；导出函数绑定带 interface 档 modifier（`contract`/`generated`/`derived`） |

跨编辑器支持矩阵：[LSP 客户端矩阵](../guides/lsp-clients.md)。

文本同步方式为 `Full`。打开文档会立即验证，内容变更则按缓冲区大小自适应防抖（5 万字符内 300 ms、20 万内 400 ms、更大 800 ms）—— 两条路径都以 `propagate = true` 触发 `validateText`（仅有的传播入口）；关闭文档会取消其计时器、丢弃缓存条目、bump 该文件的 validate generation（使在途结果作废）并清除诊断。被监视文件的删除事件在带外处理，且会话常驻的全部状态都是有界的 —— 见[内存与隔离模型](#内存与隔离模型)。

### 自定义请求

| 请求 | 参数 | 返回 |
|---------|--------|---------|
| `nudo/selectCase` | `{ uri: string; functionName: string; caseIndex: number }` | 以新的激活用例重验文档、请求 CodeLens 刷新，返回 `{ success: true }` |
| `nudo/getActiveCases` | `{ uri: string }` | `Record<string, number>` —— 每个函数的激活用例索引 |

## 内存与隔离模型

这个服务器的设计目标是与 `tsserver` **并排**运行，而不是取而代之 —— 本节的一切都由这个约束塑形。Nudo 的正确性单元是单个文件，因此会话只持有有界的、字符串级的状态：任何 AST 和源码文本都不会在请求之间留存。

### 常驻状态

服务器在整个会话期间持有的全部状态：

| 状态 | 结构 | 上界 | 逐出时机 |
|-------|-----------|-------|----------|
| `documents` | 打开的文档（`TextDocuments`） | 每个打开的编辑器文档一条 | 关闭即移除 |
| `analysisCache` | `Map<filePath, { version, result }>` | 每个分析过的文件一条带版本条目 | 对应文档关闭，或文件被从磁盘删除（`forgetValidatedFile`） |
| `knownFiles` | `Set<filePath>` | 本会话分析过的每个文件一条路径字符串 | 文件被从磁盘删除（`forgetValidatedFile`） |
| `activeCases` | `Map<uri, Map<函数名, index>>` | 用例选择，按 uri 与函数名键控 | 关闭/重开之间保留（选择不丢失）；文件被从磁盘删除时丢弃 |
| `nudoFileCache` | `Map<uri, boolean>` —— Nudo 文件检测记忆 | 每个打开的文档一个布尔值 | 其 uri 每次打开/变更/关闭/删除时失效 |
| `moduleGraphCache` | `Map<filePath, { mtimeMs, size, edges }>` | 进入过 import 图的每个文件一条；edges 为路径字符串 | `mtimeMs`+`size` 不一致时重读磁盘并回填；删除时逐出 |
| `debounceTimers` | `Map<uri, timer>` | 每个被编辑的文档一个待触发计时器 | 按缓冲区大小自适应延迟（300/400/800 ms）后触发，或关闭时取消 |

每一条都是路径、函数名、小整数或布尔值 —— 字符串级簿记，绝不是解析后的表示。`AnalysisResult` 对象只存在于 `analysisCache` 内，随其条目一起离开。

### 打开即验

`documents.onDidOpen` 会立即以 `propagate = true` 触发验证 —— 与编辑防抖路径同语义，包含对打开依赖项的一次脏传播。新打开的文件立刻就能看到诊断，而不是等到首次编辑或客户端拉取。（`didOpen` 不会触发 `onDidChangeContent`，因此打开路径必须显式验证一次。）

### stale-on-closed 契约

已关闭 —— 或从未打开过 —— 的依赖方，其已发布诊断**有意保持陈旧**：服务器绝不重新分析一个无法从打开缓冲区读取内容的文件。重新打开该文件会重新验证并消除陈旧。

删除是唯一被显式处理的带外事件。`workspace/didChangeWatchedFiles` 中类型为 `Deleted`、且**不在**打开集内的变更，会丢弃该文件的全部会话登记项：`forgetValidatedFile` 清掉 `knownFiles` 与 `analysisCache`，`activeCases` 和 `nudoFileCache` 丢弃该 uri，`moduleGraphCache` 条目被逐出，并推送空诊断列表。处于打开状态的文件会被跳过 —— 其内容归编辑流负责，编辑器自己会通过 `didOpen`/`didChange` 挽救被外部删除的缓冲区。

### 模块图边缓存

脏传播需要 `knownFiles` 上的 import 图，而重建它过去意味着重读并重解析每个已知文件。`buildModuleGraph`（来自 `@nudojs/service`）现在接收会话级的 `moduleGraphCache`：每个条目以纯字符串存储文件的 `mtimeMs`、`size` 与已抽取的 import 边。只做 `stat` 元数据比对 —— `mtimeMs` **和** `size` 均严格相等即命中，复用缓存的边；未命中则从磁盘重读该文件并回填条目。因此未变文件在每次传播中只花一次 `stat`：零磁盘读取、零解析。包内测试用 `chmod 000` 把依赖文件变为不可读来钉死这一行为 —— 传播仍能从缓存的边算出正确的脏集合。

单条结果的工作量同样有封顶：单个 `AnalysisResult` 对每个函数的合成精确 case 数设上限（`MAX_PRECISE_CALLSITE_CASES = 3`），其余调用记录折叠为一个符号聚合，不会无限增长。

### 求值守卫

验证与 CLI 共享同一个求值器，那里的模块加载带有守卫，病态的 import 会降级为诊断而不是挂死：import 环产生 `nudo:module-cycle` 警告并给出完整环链（环内绑定解析为其部分求值的类型 —— 求值不会中断）；深于 16 层的加载链产生 `nudo:module-depth` 警告并把尾部截断为 `unknown` 桩；缺失的 `import`/`require`/`@nudo:mock-module` 目标以 `nudo:module-missing` 错误暴露，并列出解析过的候选路径。

### `interFileDependencies: false`

`initialize` 声明 `diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false }`：每个文件的诊断对该文件独立正确，显式的 `@nudo:case` 指令就是契约面 —— 写进文件的用例*就是*它的接口。这是与 `tsserver` 的结构性差异：tsserver 的全 `Program` 常驻是结构化类型所迫 —— 任何跨文件形状都可能改变任何决策，因此一切都必须保持加载且最新。Nudo 用单文件正确性换取有界内存 —— 这正是两台服务器能在同一编辑器里并排运行的原因。Nudo 不以替代 `tsserver` 为目标。

## 与编辑器扩展的关系

`nudo-vscode` 扩展没有重新实现这些内容：它把 `@nudojs/lsp` 编译后的 `dist/server.js` 打进扩展（`server/server.js`），作为子进程经 IPC 启动，并把自定义的 `nudo.selectCase` 命令转发给服务器。[Zed 扩展](../guides/zed.md)通过 stdio 启动同一服务器（`nudo-lsp` / `node dist/server.js`）。编辑器侧视角见 [VS Code 指南](../guides/vscode.md)与 [Zed 指南](../guides/zed.md)。
