---
description: "@nudojs/service API —— analyzeFile/analyzeFileAsync、调用记录采集、模块图与脏集合、语义 token、.d.ts/zod/守卫生成、用例固化。"
---

# @nudojs/service

service 包提供类型推断的主要编程 API。整合解析、指令提取与求值，产出适用于工具链（LSP、CLI、IDE 扩展）的分析结果。

## analyzeFile

```typescript
analyzeFile(
  filePath: string,
  source: string,
  activeCases?: Map<string, number>,
  externalCallRecords?: CallRecord[],
  loadModule?: LoadModule
): AnalysisResult
```

对文件运行类型推断。使用 `filePath` 进行模块解析和诊断。`activeCases` 将函数名映射到用例索引，用于诊断（如 IDE 中当前“激活”的用例）。

`externalCallRecords` 接收由 [`collectCallRecords`](#collectcallrecords) 从使用现场文件（测试、示例、上层应用）收集的调用记录。能解析到本文件所定义函数的记录会被匹配并注入为合成的 `call@L` 用例——参见[调用点发现指南](../guides/callsite-discovery.md)。

没有 `@nudo:case` 指令的函数也不会被跳过：全程序推断会为每个观测到的调用点合成一个 `call@L` 用例；找不到调用点时合成参数为 **`any`** 的 `entry@L` 用例（并在 [`FunctionAnalysis`](#functionanalysis) 上标记 `entryOnly`）。入口无约束参数是 `any`；真 `unknown` 表示推导失败。

**返回：** `AnalysisResult`

---

## analyzeFileAsync

```typescript
analyzeFileAsync(
  filePath: string,
  source: string,
  activeCases?: Map<string, number>,
  externalCallRecords?: CallRecord[],
  loadModule?: LoadModule
): Promise<AnalysisResult>
```

`analyzeFile` 的异步入口：先通过动态 import 预加载基于路径的 env 文件（`/// @nudo:env ./nudo-harvest-node.ts`）——在 ESM 中无法同步完成——再运行同步分析，后者会从 env 加载器缓存中取用预加载的工厂。异步工具链（CLI、LSP）应使用它；当被分析文件声明了路径 env 时，同步的 `analyzeFile` 会降级。

**返回：** `Promise<AnalysisResult>`

---

## collectCallRecords

```typescript
collectCallRecords(filePath: string, source: string): CallRecord[]
```

调用点发现的第一阶段：求值使用现场文件的顶层代码，记录其中每一次调用及其在调用点实际观测到的实参类型与结果类型。测试框架的回调（`it`、`test`、`describe`）会以 `unknown` 参数被手动执行，从而捕获测试体内的调用点——测试框架本身从不运行。该阶段不产出诊断、也不会抛出异常：使用现场文件可能依赖未 mock 的全局，收集尽力而为。

将返回的记录作为 `externalCallRecords` 传给 `analyzeFile`/`analyzeFileAsync`，即可注入为 `call@L` 用例。两阶段流程见[调用点发现 — 编程 API](../guides/callsite-discovery.md#编程接口)。

**返回：** `CallRecord[]`（见 [`CallRecord`](#callrecord)）

---

## getTypeAtPosition

```typescript
getTypeAtPosition(
  filePath: string,
  source: string,
  line: number,
  column: number,
  activeCases?: Map<string, number>
): Abs | null
```

返回指定源码位置（1-based 行、0-based 列）的 Abs（无损的 `shape × term × pred × conf` 值）。当位置位于带有用例的函数内时，按函数使用对应的激活用例索引。

**返回：** `Abs`，若无类型则返回 `null`。

---

## getTypeAtPositionAsync

```typescript
getTypeAtPositionAsync(
  filePath: string,
  source: string,
  line: number,
  column: number,
  activeCases?: Map<string, number>
): Promise<Abs | null>
```

`getTypeAtPosition` 的异步入口，带路径 env 预加载（见 [`analyzeFileAsync`](#analyzefileasync)）。

**返回：** `Promise<Abs | null>`

---

## getCompletionsAtPosition

```typescript
getCompletionsAtPosition(
  filePath: string,
  source: string,
  line: number,
  column: number
): CompletionItem[]
```

返回指定位置的补全项。支持变量补全以及 `obj.` 之后的属性/方法补全。

**返回：** `CompletionItem` 数组

---

## getCasesForFile

```typescript
getCasesForFile(filePath: string, source: string): {
  functionName: string;
  cases: { name: string; index: number }[];
  loc: SourceLocation;
}[]
```

列出所有带有 `@nudo:case` 指令的函数及其用例名称/索引。用于 IDE 中的用例切换。

---

## isNudoTargetPath

```typescript
isNudoTargetPath(path: string): boolean
```

CLI 收集器、监视模式与 LSP `isNudoFile` 判定共享的扩展名门。纯路径规则（文件无需存在）：

| 路径 | 是否目标 |
|------|----------|
| `.js` / `.mjs` / `.ts`（大小写不敏感） | **是** |
| `.d.ts`、`.tsx`、`.jsx`、`.cjs`、`.mts`、`.cts` 及其余扩展 | 否 |
| `*.nudo.{js,mjs,ts}` 侧车 | 否（契约模块，非实现源码） |
| `*.nudo.draft.{js,mjs,ts}` | 否（draft 产物） |

---

## shouldAnalyzeFile

```typescript
shouldAnalyzeFile(
  filePath: string,
  source: string | undefined,
  config?: AnalysisConfig,
): boolean
```

**自动路径**（LSP validate、watch、Vite 插件）是否应对该缓冲/文件跑分析。具名路径 CLI（`nudo check src/lib.js`）不受本门限制，直接分析所点名文件。

门禁顺序：

1. `isNudoTargetPath` —— 非目标路径恒不分析
2. `nudo.analysis.exclude` / `include`（默认 exclude：`node_modules` / `dist` / `coverage`）
3. `package.json#nudo.analysis.mode`（出厂默认 **`"exports"`**；`DEFAULT_ANALYSIS_MODE`）：
   - `"directives"` —— 仅含 `@nudo:*` 指令的文件
   - `"exports"`（默认）—— 指令 **或** 含 export（ESM/CJS）**或** 同名 `*.nudo.js` 侧车
   - `"all"` —— 通过 include/exclude 的全部目标路径

默认值真源：[`PUBLIC_API.md`](https://github.com/nudojs/nudo/blob/main/packages/lsp/PUBLIC_API.md) §7。模式语义：[共存](../guides/coexistence.md#何时用-modedirectives-vs-modeexports)。

相关：`DEFAULT_ANALYSIS_MODE`（再导出常量，`"exports"`）、`filterDiagnosticsByLevel`、`diagnosticsLevelForFile`、`sourceHasNudoDirectives`。

---

## buildSemanticTokens

```typescript
buildSemanticTokens(
  filePath: string,
  source: string,
  opts?: { loadModule?: LoadModule; autoBind?: boolean },
): number[]
```

从分析结果产出 LSP 编码的语义 token（五元组：deltaLine/deltaStartChar/length/tokenType/tokenModifiers）——函数绑定标为 `function`，其余绑定标为 `variable`，参数标为 `parameter`。顶层 **named-export** 函数绑定额外带 interface 档 modifier（`contract` / `generated` / `derived`），与 CodeLens `● interface` 经 `interfaceTierOf` 同源（A7）；非导出声明只带 `declaration`。LSP 服务器的 semanticTokens handler 直接消费它。

配套的图例与编码器从同一模块导出，LSP 包再原样再导出（`TOKEN_TYPES`/`TOKEN_MODIFIERS`），因此 tokenType 索引不可能与提取器漂移：

```typescript
SEMANTIC_TOKEN_TYPES: readonly string[]    // ["function", "variable", "parameter", "property",
                                           //  "type", "keyword", "string", "number", "comment",
                                           //  "decorator", "method"]
SEMANTIC_TOKEN_MODIFIERS: readonly string[] // ["declaration", "readonly", "deprecated", "unreachable",
                                           //  "contract", "generated", "derived"]

type SemanticToken = {
  line: number; char: number; length: number;
  typeIndex: number; modifierBitmask: number;
};

encodeSemanticTokens(tokens: SemanticToken[]): number[];
interfaceTierModifierBit(src: "handwritten" | "generated" | "implicit"): number;
```

`encodeSemanticTokens` 把 `{ line, char, … }` token 增量编码为 LSP 期望的扁平 `number[]`——`buildSemanticTokens` 已经返回编码后的输出，只有自己构造 token 时才需要它。

---

## buildModuleGraph

```typescript
buildModuleGraph(
  files: string[],
  cache?: ModuleGraphCache,
): {
  imports: Map<string, Set<string>>;    // 文件 → 它导入的文件
  dependents: Map<string, Set<string>>; // 文件 → 导入它的文件
}

type ModuleGraphCache = Map<string, { mtimeMs: number; size: number; edges: string[] }>;
```

静态抽取每个文件的相对导入边——增量分析的基础构件。扩展名解析规则与模块解析一致（`''`、`.js`、`.ts`、`.mjs`）；裸 npm 说明符会被跳过。CLI 的 watch 模式和 LSP 的脏传播都用它在各自已知文件集上建图。

传入 `cache` 可跨重建保留每文件的导入边（LSP 会话以 `moduleGraphCache` 导出一份）：文件 `mtimeMs` **和** `size` 均未变时命中——只做一次 `stat`，零磁盘读取、零解析；未命中则重读文件并回填条目。

---

## computeDirtySet

```typescript
computeDirtySet(dependents: Map<string, Set<string>>, changedFile: string): string[]
```

返回变更文件及其全部传递依赖方（沿 `dependents` 反向边 BFS）。对导入环安全。

---

## topoSortDirty

```typescript
topoSortDirty(imports: Map<string, Set<string>>, dirty: string[]): string[]
```

将脏文件集按依赖在前、依赖方在后的顺序拓扑排序（只统计脏集内部的导入边；容忍环——剩余文件以任意顺序追加）。按此顺序重新分析可保证依赖方先看到其依赖更新后的类型。

典型的增量分析循环：

```typescript
const graph = buildModuleGraph(files);
const dirty = computeDirtySet(graph.dependents, changedFile);
for (const file of topoSortDirty(graph.imports, dirty)) {
  // 重新读取并重新分析 `file`
}
```

---

## absToTSType

```typescript
absToTSType(a: Abs): string
```

将 Abs 序列化为 TypeScript 类型语法（如 `number`、`string | number`、`{ id: number; name: string }`）。

---

## generateDts

```typescript
generateDts(result: AnalysisResult): string
```

根据分析结果生成 TypeScript 声明内容（`.d.ts`）。产出带真实参数名、推断返回类型和 JSDoc 注释的 `declare function` 签名。

---

## generateFunctionDtsLines

```typescript
generateFunctionDtsLines(fn: FunctionAnalysis): string[]
```

[`generateDts`](#generatedts) 的按函数切片——JSDoc 加一行 `export declare function`。CLI 的 `nudo export --format dts` 与 `generateDts` 共用本函数，两条路径的声明输出字节级一致。无用例的函数不产出（或仅 `combined` 已知时产出一行 rest-args 的 `(...args: unknown[])` 声明）；`noDeclaration` 函数（CJS `exports.X = fn`）不产出，只留在 check/test JSON 输出中。

---

## absToSchemaSource

```typescript
absToSchemaSource(a: Abs, opts?: { dialect?: SchemaDialect }): string
projectAbsToSchema(a: Abs, opts?: { dialect?: SchemaDialect }): {
  source: string;
  dialect: SchemaDialect;
  dropped: string[];
}
absToSchemaNode(a: Abs): { node: SchemaNode; dropped: string[] }
```

Abs → dialect schema **源码**（单向、有损）。中间层 `SchemaNode` 承载 Abs pred 可表达的 refinement（数值界、`int`、字符串长度）以及不可投影 pred 的 `dropped` 注记。默认 dialect 为 `zod`。

**示例：**
```typescript
absToSchemaSource(numVar("x", gt(v("x"), lit(0))))
// → "z.number().gt(0)"
```

---

## absToStandardSchema / absToStandardSchemaModule

```typescript
absToStandardSchema(a: Abs, opts?: { name?: string }): { source: string; dropped: string[] }
absToStandardSchemaModule(
  exports: Record<string, Abs>,
  opts?: { banner?: string },
): { source: string; dropped: string[] }
validateSchemaNode(node: SchemaNode, value: unknown): StandardSchemaResult
```

Abs → **Standard Schema v1** 运行时模块源码（`~standard`，`vendor: "nudo"`）。零第三方校验库依赖。`validate` 与 schema dialect 投影共用同一套 SchemaNode refinement（数值界 / int / 字符串长度）。这是生态运行时路径，**不能**替代 `nudo check`。

`validateSchemaNode` 是可测语义核心；生成模块内联同一套检查逻辑。

---

## generateGuardFunction

```typescript
generateGuardFunction(name: string, abs: Abs): string
generateGuardFunctionFromAbs(name: string, abs: Abs): string
```

生成零依赖的运行时类型守卫函数字符串。生成的函数使用 `typeof`、`Array.isArray` 和属性检查进行验证。

**示例：**
```typescript
generateGuardFunction("isUser", obj({ name: str() }))
// → "function isUser(data) { ... }"
```

---

## 用例固化

用例固化（case emission）这组函数把合成的 `call@L` 用例写回源码文本。CLI 的 `nudo test --freeze[=update]` 只是对它们的薄封装——工作流与合并策略见 [CLI 使用指南](../guides/cli.md#nudo-test)。

### serializeCaseArg

```typescript
serializeCaseArg(a: Abs): string | null
```

把单个 Abs 序列化为指令文法（`parseCaseArgExpr`）能原样读回的表达式文本。指令表达不了的形状返回 `null`：函数、promise（eff）与 brand 值，`bigint` 字面量，非有限/科学计数法数字，以及含结构字符或控制字符的字符串/对象键。

**示例：**
```typescript
serializeCaseArg(num())       // → "number()"
serializeCaseArg(strLit("a")) // → '"a"'
```

### buildCaseDirective

```typescript
buildCaseDirective(name: string, argsAbs: Abs[]): string | null
```

组装单行指令 ` * @nudo:case "name" (a, b)`（带前导 ` *`，无尾换行），可直接拼进 JSDoc 块。任一实参序列化失败、或名字含双引号/换行时整体返回 `null`。

**示例：**
```typescript
buildCaseDirective("call@L2", [str()])
// → ' * @nudo:case "call@L2" (string())'
```

### stripGeneratedCaseDirectives

```typescript
stripGeneratedCaseDirectives(source: string): { source: string; removed: string[] }
```

从源码删除所有生成的 `@nudo:case` 指令行（名字以保留前缀 `call@` 开头）；若所属 JSDoc 块因此再无其他指令或文字，则连同块首 `/**` 与块尾 `*/` 行整块删除。绝不触碰非 case 指令与普通注释。`removed` 按出现顺序返回被删的用例名。这是 `update` 模式的前半步——注意手写但以 `call@…` 命名的用例同样会被删除，因为该前缀是保留的。

### insertGeneratedCaseDirectives

```typescript
insertGeneratedCaseDirectives(source: string, analysis: AnalysisResult): EmitResult
```

把分析结果中的合成用例（`source === "callsite"`）固化进 `source`：指令插入在每个函数声明行的正上方——已有 JSDoc 块则插到 `/**` 行后，无块则新建。含手写用例或已有 `call@` 指令的函数会被跳过（见 [`EmitResult`](#emitresult)），entry-only 函数同样跳过；序列化失败的用例按函数逐条报告。返回改写后的源码及写入/跳过报告。

### unifiedDiff

```typescript
unifiedDiff(a: string, b: string, path: string): string
```

行级 unified diff（`--- a/path` 头、`@@` hunk、3 行上下文），零第三方依赖；文本相同时返回 `""`。`--dry-run` 用它预览固化结果。

### EmitResult

```typescript
type EmitSkipReason =
  | "hand-written"            // 函数含非 call@ 命名的用例指令
  | "already-generated"       // 函数已有 call@ 指令（add 模式不碰）
  | "entry-only"              // 未找到调用点——没有可固化的内容
  | "no-serializable-cases"   // 没有任何用例能表达为指令文本
  | "no-declaration"          // CJS 绑定/赋值函数，无稳定声明
  | "skipped";                // 函数本身被分析器跳过

type EmitResult = {
  source: string;             // 改写后的源码（无变化时与输入相同）
  changed: boolean;           // 是否写入了任何函数
  written: Array<{ fn: string; cases: string[] }>;
  skipped: Array<{ fn: string; reason: EmitSkipReason; detail?: string }>;
};
```

最小化的 `add` / `update` 流程：

```typescript
import { analyzeFileAsync, insertGeneratedCaseDirectives, stripGeneratedCaseDirectives } from "@nudojs/service";

// add：把合成用例按原样插入源码
const result = await analyzeFileAsync(filePath, source, undefined, records);
const emitted = insertGeneratedCaseDirectives(source, result);

// update：先剥离旧的生成指令，重新分析，再插入
const stripped = stripGeneratedCaseDirectives(source);
const reanalyzed = await analyzeFileAsync(filePath, stripped.source, undefined, records);
const synced = insertGeneratedCaseDirectives(stripped.source, reanalyzed);
```

---

## 结果类型

### AnalysisResult

```typescript
type AnalysisResult = {
  functions: FunctionAnalysis[];
  diagnostics: Diagnostic[];
  bindings: Map<string, BindingInfo>;
  nodeAbsMap: Map<Node, Abs>;
  caseHints: CaseHint[];
  /** 从其他模块导入的函数，由分析本文件时观测到的
      跨文件调用点合成 */
  externalFunctions?: FunctionAnalysis[];
}
```

### FunctionAnalysis

```typescript
type FunctionAnalysis = {
  name: string;
  loc: SourceLocation;
  paramNames: string[];        // AST 中的实际参数名
  cases: CaseResult[];
  combinedAbs?: Abs;          // 用例结果 Abs 的 join；dts 返回位来源
  entryOnly?: boolean;        // 合成的 entry@L 用例，未找到调用点
  skipped?: boolean;
  /** CJS 风格绑定/赋值函数（exports.X = fn）没有声明级稳定的
      名称；.d.ts 生成会跳过它们，但 check/test JSON 输出仍会报告 */
  noDeclaration?: boolean;
  /** 该函数所属导入模块的绝对路径（仅 externalFunctions） */
  fromModule?: string;
}
```

### CaseResult

```typescript
type CaseResult = {
  name: string;
  argAbs: Abs[];              // 无损实参 Abs
  abs: Abs;                   // 无损结果 Abs
  throwsAbs: Abs;             // 无损抛出 Abs（未抛为 never）
  throwLoc?: SourceLocation;
  source?: "directive" | "callsite"; // "callsite" = 由观测到的调用点合成；
                                     // 手写用例与 entry@ 回退不设置该字段
  expected?: Abs;             // `@nudo:case "name" (…) => expected`——存在即标记为测试断言
  aggregatedFrom?: number;    // 折叠进符号化用例的额外调用点数
  intension?: {               // 内涵摘要（代数 generalize）
    display?: string; term?: string; pred?: string; conf?: string;
    abs?: string;             // 无损 Abs 单行（formatAbs）
    absMultiline?: string;
  };
}
```

### CallRecord

由 [`collectCallRecords`](#collectcallrecords) 在使用现场观测到的一次调用：

```typescript
type CallRecord = {
  fnName: string;             // 调用点观测到的被调函数名
  argAbs: Abs[];              // 观测到的无损实参 Abs
  resultAbs: Abs;             // 观测到的结果 Abs（调用抛出时为 never）
  throwsAbs: Abs;             // 观测到的抛出 Abs（未抛为 never）
  callLoc?: { line: number; column: number }; // 调用位置；行号即 call@L 用例名中的 L
  targetModule?: string;      // 被调函数绑定来源的模块
  targetExport?: string;      // 被调函数绑定时使用的导出名
  targetAliases?: string[];   // 后续再导出名（barrel、CJS 转发 shim）
  fnModule?: string;          // 求值时创建该函数值的模块（定义处）
}
```

`targetModule`/`targetExport`/`fnModule` 字段驱动归属守卫：一条记录只会匹配其模块真正指向的文件，因此测试文件里的同名辅助函数不会把记录涂抹到无关文件上。参见[调用点发现 — 安全设计](../guides/callsite-discovery.md#安全性设计)。

### CaseInfo

```typescript
type CaseInfo = {
  functionName: string;
  caseName: string;
  caseIndex: number;
}
```

以函数名 + 用例名 + 索引定位单个函数的单个用例。

### CaseHint

```typescript
type CaseHint = {
  line: number;
  label: string;
  ok: boolean;
}
```

IDE 集成在指令旁渲染的内联提示（行号、文案、通过/失败）。

### Diagnostic

```typescript
type Diagnostic = {
  range: SourceLocation;
  severity: DiagnosticSeverity;   // "error" | "warning" | "info"
  message: string;
  tags?: DiagnosticTag[];         // 如 ["unnecessary"]
  code?: string;                  // 如 "nudo:unknown-recv"、"nudo:mock-invalid"、"nudo-unreachable"
  suggestions?: string[];
  data?: unknown;                 // 用于代码操作的额外上下文
  /** 接收者值的来源（流入该错误的调用点实参） */
  origin?: { line: number; column: number };
}
```

`DiagnosticSeverity` 为 `"error" | "warning" | "info"`；`DiagnosticTag` 目前只有 `"unnecessary"`。

### SourceLocation

```typescript
type SourceLocation = {
  start: { line: number; column: number };
  end: { line: number; column: number };
}
```

### BindingInfo

```typescript
type BindingInfo = {
  abs: Abs;
  loc?: SourceLocation;
}
```

顶层绑定的类型（及可选位置），以名称为键存放在 `AnalysisResult.bindings` 中。

### CompletionItem

```typescript
type CompletionItem = {
  label: string;
  kind: "property" | "method" | "variable";
  detail?: string;
}
```

### SymbolInfo / ReferenceInfo / SymbolTable

```typescript
type SymbolInfo = {
  name: string;
  kind: "function" | "variable" | "class" | "parameter";
  loc: SourceLocation;
  uri?: string;
}

type ReferenceInfo = {
  name: string;
  loc: SourceLocation;
  uri?: string;
}

type SymbolTable = {
  definitions: Map<string, SymbolInfo>;
  references: ReferenceInfo[];
}
```

用于跳转定义 / 查找引用工具链的定义与引用信息；LSP 包在其打开的文档上构建此形状的表。

## Export inventory

<!-- NUDO-API-SKELETON:BEGIN -->
> 由 `pnpm run docs:gen:api` 从包导出面（`PUBLIC_API.md` / `src/index.ts`）生成 —— 请勿手改本块。重新生成：`node scripts/gen-api-docs.mjs`。

含 `@nudojs/service`（`src/index.ts`）面与 `@nudojs/service/emit` 公开 emit 面。

| 名称 | 种类 | 说明 | 签名 |
|------|------|------|------|
| `AbsGraphOptions` | type | — | `AbsGraphOptions = { loadModule?: AbsLoadModule; seedVars?: Record<string, Abs>; seedFns?: Record<string, { params: string[]; body: Node; ...` |
| `AbsMockSeeds` | type | — | `AbsMockSeeds = { seedVars: Record<string, Abs>; seedFns: Record<string, { params: string[]; body: Node; async?: boolean; fingerprint?: st...` |
| `AbsModuleCacheEntry` | type | 会话级依赖模块缓存条目：stat 指纹 + 导出 + 子树装载 issue。 | `AbsModuleCacheEntry = { mtimeMs: number; size: number; exports: AbsModuleExports; issues: AbsModuleLoadIssue[]; }` |
| `AbsModuleGraphResult` | type | — | `AbsModuleGraphResult = { modules: Record<string, AbsModuleExports>; byPath: Map<string, AbsModuleExports>; issues: AbsModuleLoadIssue[]; }` |
| `AbsModuleLoadIssue` | type | 模块加载守卫：与 TypeValue loadModuleEnv 口径对齐，供 analyzer 映射诊断 | `AbsModuleLoadIssue = { kind: "cycle" \| "depth" \| "missing"; label: string; reason: string; }` |
| `absToSchemaNode` | fn | Abs → SchemaNode + dropped（优先 core absToConstraint；失败则 shape 尽力） | `absToSchemaNode(a: Abs)` |
| `absToSchemaSource` | fn | — | `absToSchemaSource(a: Abs, opts?: { dialect?: SchemaDialect }): string` |
| `absToStandardSchema` | fn | 便捷：单个 Abs → 单导出模块（默认导出名 `schema`）。 | `absToStandardSchema( a: Abs, opts?: { name?: string }, ): StandardSchemaModuleProjection` |
| `absToStandardSchemaModule` | fn | Abs → Standard Schema v1 模块源码。 | `absToStandardSchemaModule( exports: Record<string, Abs>, opts?: { banner?: string }, ): StandardSchemaModuleProjection` |
| `absToTSType` | fn | Abs → TS 类型串。有损：pred / 非 lit term 落到 shape 基类型。 | `absToTSType(a: Abs, typeVars?: Map<string, string>): string` |
| `absToZodSchemaModule` | fn | Abs 导出表 → 可 import 的 zod JS 模块源码。 | `absToZodSchemaModule( exports: Record<string, Abs>, opts?: { banner?: string }, ): ZodModuleProjection` |
| `ambientSourcesOfSidecar` | fn | `lib.nudo.js\|ts` → candidate ambient sources next to it | `ambientSourcesOfSidecar(sidecarPath: string): string[]` |
| `ANALYSIS_ABI` | const | 带包版本：升级 @nudojs/* 后旧 CheckJson 不得继续命中。 | `const ANALYSIS_ABI` |
| `analysisConfig` | fn | 归一化 `nudo.analysis`。默认 mode=exports（A1：无指令但有 export/侧车的文件 进 IDE 分析；`all` / `directives` 需显式配置）。 | `analysisConfig(config: NudoConfig \| null \| undefined): AnalysisConfig` |
| `AnalysisConfig` | type | — | `AnalysisConfig = { include: string[]; exclude: string[]; mode: AnalysisMode; diagnostics: DiagnosticsLevel; callSiteBudget: number; evalM...` |
| `analysisFileCacheKey` | fn | — | `analysisFileCacheKey( filePath: string, source: string, activeCases?: Map<string, number>, externalCallRecords?: CallRecord[], analysisCfg?: { mode: string; evalMissingSlot: string; callSiteBudget: number; diagnostics: string }, loadModule?: AnalyzeLoadModule, projectEnvNames?: string[], autoBind?: boolean, caseMode: DirectiveCaseMode = "all", )` |
| `AnalysisMode` | type | — | `AnalysisMode = "directives" \| "exports" \| "all"` |
| `AnalysisResult` | type | — | `AnalysisResult = { functions: FunctionAnalysis[]; diagnostics: Diagnostic[]; bindings: Map<string, BindingInfo>; nodeAbsMap: Map<Node, Ab...` |
| `AnalysisSession` | type | — | `AnalysisSession = { evictForDependents(files: string[]): void; clear(): void; reset(): void; analyze( filePath: string, source: string, a...` |
| `analyzeExportsFromSource` | fn | 分析单文件导出 + 内涵签名（source 由 host 提供） | `analyzeExportsFromSource( filePath: string, source: string, ): ModuleExports` |
| `analyzeFile` | fn | 整文件分析。同 (path, source, cases, external) 命中 memo → O(1)。 | `analyzeFile( filePath: string, source: string, activeCases?: Map<string, number>, externalCallRecords?: CallRecord[], loadModule?: AnalyzeLoadModule, caseMode: DirectiveCaseMode = "all", ): AnalysisResult` |
| `analyzeFileAsync` | fn | Async entry to analyzeFile: preloads path-based env files (`/// @nudo:env ./nudo-harvest-node.ts`) via dynamic import — impossible synchronously in ESM — then runs the sync analysis, which picks the preloaded factories up from the env-loader cache. | `analyzeFileAsync( filePath: string, source: string, activeCases?: Map<string, number>, externalCallRecords?: CallRecord[], loadModule?: AnalyzeLoadModule, caseMode: DirectiveCaseMode = "all", ): Promise<AnalysisResult>` |
| `applyBForkBudgetFromConfig` | fn | 把 fork 预算写进 core（core 保持无 IO）。 | `applyBForkBudgetFromConfig( config: NudoConfig \| null \| undefined, env: NodeJS.ProcessEnv = process.env, ): number` |
| `applyMockModuleDirectives` | fn | Overlay `@nudo:mock-module` directives onto a modules map. | `applyMockModuleDirectives( base: Record<string, AbsModuleExports>, fileDirectives: FileDirective[], opts: { fromFile: string; loadModule?: LoadModule }, ): MockModuleApplyResult` |
| `applyMockModuleDirectivesFromSource` | fn | Source string → apply mock-module (CLI / one-shot hosts). | `applyMockModuleDirectivesFromSource( source: string, base: Record<string, AbsModuleExports>, opts: { fromFile: string; loadModule?: LoadModule }, ): MockModuleApplyResult` |
| `applySessionCacheConfig` | fn | 接线 package.json#nudo.sessionCache（进程内 LRU 上限）并立刻 trim。 | `applySessionCacheConfig(config: NudoConfig \| null \| undefined): SessionCacheLimits` |
| `BindingInfo` | type | — | `BindingInfo = { abs: Abs; loc?: SourceLocation; }` |
| `BPathBuiltinUnknown` | type | — | `BPathBuiltinUnknown = { name: string; range: BPathLoc }` |
| `BPathDiagnostics` | type | — | `BPathDiagnostics = { unreachable: BPathUnreachable[]; builtinUnknown: BPathBuiltinUnknown[]; }` |
| `BPathRunResult` | type | — | `BPathRunResult = { exports: Record<string, unknown>; modules: Record<string, AbsModuleExports>; memberDiags?: BMemberDiag[]; moduleIssues...` |
| `BPathUnreachable` | type | — | `BPathUnreachable = { range: BPathLoc }` |
| `buildCaseDirective` | fn | 组装单行 ` * @nudo:case "name" (a, b)` 指令文本（无尾换行）。 | `buildCaseDirective(name: string, argsAbs: Abs[]): string \| null` |
| `buildModuleGraph` | fn | Statically extract each file's relative import edges (extension resolution identical to CLI resolveModule: ''/'.js'/'.ts'/'.mjs'; bare npm specifiers skipped). | `buildModuleGraph( files: string[], cache?: ModuleGraphCache, )` |
| `CallRecord` | type | — | — |
| `CaseHint` | type | — | `CaseHint = { line: number; label: string; ok: boolean; }` |
| `CaseJson` | type | — | `CaseJson = { version: 1; file: string; summary: { functions: number; externalFunctions: number; cases: number; diagnostics: number; }; fu...` |
| `CaseJsonCase` | type | — | `CaseJsonCase = { name: string; args: string[]; result: string; throws: string \| null; source: string \| null; aggregatedFrom?: number; arg...` |
| `CaseJsonFunction` | type | — | `CaseJsonFunction = { name: string; loc: SourceLocation; entryOnly: boolean; noDeclaration?: boolean; cases: CaseJsonCase[]; combined?: st...` |
| `CaseResult` | type | — | `CaseResult = { name: string; argAbs: Abs[]; abs: Abs; throwsAbs: Abs; throwLoc?: SourceLocation; source?: "directive" \| "callsite"; expec...` |
| `checkCacheKey` | fn | check 报告键：abi + 相对路径 + 源码 sha + autoBind + **侧车 sha** + **@nudo:import / 传递契约依赖内容 sha**（依赖变更必须 miss）。 | `checkCacheKey( filePath: string, source: string, opts: { autoBind: boolean; projectDir?: string; sidecarContent?: string \| null; depContents?: Array<{ path: string; content: string \| null }>; projectEnvNames?: string[]; analysisCfg?: { mode?: string; evalMissingSlot?: string; callSiteBudget?: number; entryThrows?: string; ignoreThrows?: string; }; }, ): string` |
| `checkConfig` | fn | package.json#nudo.check → 执法选项 | `checkConfig(config: NudoConfig \| null \| undefined): CheckConfig` |
| `CheckConfig` | type | — | `CheckConfig = { entryThrows: "error" \| "warning" \| "off"; ignoreThrows: string[]; }` |
| `clearAbsModuleCache` | fn | — | `clearAbsModuleCache(): void` |
| `clearAnalysisFileCache` | fn | — | `clearAnalysisFileCache(): void` |
| `clearAnalysisSessionCaches` | fn | 清空全部会话级分析缓存（service + core）。 | `clearAnalysisSessionCaches(): void` |
| `clearBPathCache` | fn | — | `clearBPathCache(): void` |
| `clearEnvPathDeps` | fn | — | `clearEnvPathDeps(): void` |
| `clearFnAnalysisCache` | fn | — | `clearFnAnalysisCache(): void` |
| `clearPathEnvCaches` | fn | Host cache-clear hooks (CLI watch / vite / tests) must drop path-env modules too | `clearPathEnvCaches(): void` |
| `collectAbsBindingsFromGraph` | fn | 收集顶层绑定名 → Abs（含相对 import / 裸包 harvest 注入）。 | `collectAbsBindingsFromGraph( source: string, filePath: string, opts: AbsGraphOptions = {}, ): Map<string, Abs>` |
| `collectBPathDiagnostics` | fn | 静态收集 B 路径诊断。 | `collectBPathDiagnostics( source: string, extraKnown?: Iterable<string>, ): BPathDiagnostics` |
| `collectBPathReplacements` | fn | 收集 @nudo:replace + @nudo:as → transpile 注入表 | `collectBPathReplacements(source: string)` |
| `collectCallRecords` | fn | 调用点发现（阶段一）：在"使用现场"文件（测试 / 上层应用）中求值 顶层代码，收集它对（外部模块导出的）函数的调用记录。每条记录带 真实的实参类型与结果类型——后续 analyzeFile 将其注入合成 case， 使被使用方从 entry-only（参数全 unknown）升级为真实调用形态。 | `collectCallRecords(filePath: string, source: string): CallRecord[]` |
| `collectDependencySpecs` | fn | 从 AST 收集静态相对依赖（ESM import + CJS require） | `collectDependencySpecs(ast: File): string[]` |
| `collectEnvGlobals` | fn | — | `collectEnvGlobals(envNames: string[]): Record<string, Abs>` |
| `collectEnvModules` | fn | — | `collectEnvModules(envNames: string[]): Record<string, AbsModuleExports>` |
| `collectEnvNames` | fn | — | `collectEnvNames(filePath: string, source: string, includeProject: boolean): string[]` |
| `collectLoadDepContents` | fn | — | `collectLoadDepContents( filePath: string, source: string, loadModule: (spec: string, fromFile: string) => string \| undefined, )` |
| `collectParamBodyAccesses` | fn | Draft-only：收集每个顶层函数形参上的成员读取键（`user.name` → name）。 | `collectParamBodyAccesses( source: string, ): Map` |
| `collectSkipReturns` | fn | 每个带 `@nudo:skip` 的顶层函数 → 声明的返回 Abs；`null` = 未声明返回类型。 | `collectSkipReturns(source: string): Map<string, Abs \| null>` |
| `collectStaticImports` | fn | 从入口文件沿静态相对 import/require 收集（仅类型事实，不是运行时加载器）。 | `collectStaticImports( entryFile: string, maxDepth = 8, ): Map<string, ModuleExports>` |
| `CompletionItem` | type | — | `CompletionItem = { label: string; kind: "property" \| "method" \| "variable"; detail?: string; }` |
| `computeDirtySet` | fn | changed plus its transitive dependents (reverse-edge BFS); cycle-safe via visited. | `computeDirtySet(dependents: Map<string, Set<string>>, changedFile: string): string[]` |
| `ConstraintSourceExpr` | type | — | `ConstraintSourceExpr = { expr: string; importFrom?: string; importName?: string; }` |
| `constraintToSchemaNode` | fn | NudoConstraint → SchemaNode（与 absToConstraint 投影语义对齐） | `constraintToSchemaNode(c: NudoConstraint): SchemaNode` |
| `currentBForkBudgetLimit` | fn | 当前生效 fork 上限（调试/测试；与 core getBForkBudgetLimit 同源） | `currentBForkBudgetLimit(): number` |
| `DEFAULT_ANALYSIS_MODE` | const | ", ]; /** A1 产品默认：exports — 普通带导出的 .js 进 IDE；directives/all 需显式 | `const DEFAULT_ANALYSIS_MODE` |
| `DEFAULT_SESSION_CACHE_LIMITS` | const | 保守默认：多项目共存时不悄悄吃内存（大仓请显式调高） | `const DEFAULT_SESSION_CACHE_LIMITS` |
| `defaultAbsLoadModule` | fn | 相对说明符 → 源码 | `defaultAbsLoadModule(spec: string, fromFile: string): string \| undefined` |
| `defaultLoadModule` | fn | 默认 loadModule：支持 .js/.mjs/.ts 与 index 入口 | `defaultLoadModule(spec: string, fromFile: string): string \| undefined` |
| `DepContent` | type | — | `DepContent = { path: string; content: string \| null }` |
| `DerivedExport` | type | — | `DerivedExport = { file: string; fn: string; paramNames: string[]; params: DerivedParam[]; returns?: { constraint: NudoConstraint; dsl: st...` |
| `DerivedParam` | type | — | `DerivedParam = { name: string; constraint: NudoConstraint; dsl: string; prelude: string[]; imports: Array<{ name: string; from: string }>...` |
| `deriveFromRoot` | fn | 入口：对 filePath 做 root 驱动下行推导。 | `deriveFromRoot( filePath: string, opts: RootDeriveOpts = {}, ): RootDeriveResult` |
| `detectEntryVariantsFromPackageJson` | fn | Detect browser/node dual faces in a parsed package.json. | `detectEntryVariantsFromPackageJson(pkg: unknown): EntryVariantFaces \| null` |
| `Diagnostic` | type | — | `Diagnostic = { range: SourceLocation; severity: DiagnosticSeverity; message: string; tags?: DiagnosticTag[]; code?: string; suggestions?:...` |
| `DiagnosticSeverity` | type | — | `DiagnosticSeverity = "error" \| "warning" \| "info"` |
| `DiagnosticsLevel` | type | — | `DiagnosticsLevel = "off" \| "errors" \| "default" \| "verbose"` |
| `diagnosticsLevelForFile` | fn | — | `diagnosticsLevelForFile(filePath: string): DiagnosticsLevel` |
| `DiagnosticTag` | type | — | `DiagnosticTag = "unnecessary"` |
| `DirectiveCaseMode` | type | `@nudo:case` 求值档： - `none`（默认）：不跑 case；有 case 的函数也走 entry@ 出签名（check / IDE） - `all`：逐 case 真跑（`nudo test` / CaseJson / freeze） - `selected`：只跑 `activeCases` 选中的那条（LSP selectCase） | `DirectiveCaseMode = "none" \| "all" \| "selected"` |
| `DiskCache` | fn | — | `DiskCache { private readonly root: string \| undefined; private readonly ns: string; enabled = false; constructor(opts: DiskCacheOptions) ...` |
| `DiskCacheOptions` | type | — | `DiskCacheOptions = { root?: string \| undefined; namespace: string; }` |
| `diskCacheRoot` | fn | 磁盘缓存根（B3）：config.cache / NUDO_CACHE_DIR / 默认关 | `diskCacheRoot( config: NudoConfig \| null \| undefined, projectDir: string \| undefined, ): string \| undefined` |
| `DraftEvidence` | type | DraftEvidence `body` = 仅来自函数体对形参的成员读取（草稿建议，非义务）。 | `DraftEvidence = "callsite" \| "directive" \| "symbolic" \| "body" \| "none"` |
| `draftInterface` | fn | 为单文件顶层导出生成 interface 草稿（不写盘）。 | `draftInterface( filePath: string, opts: InterfaceDraftOpts = {}, ): Promise<InterfaceDraftResult>` |
| `emitDerivedFromRoot` | fn | — | `emitDerivedFromRoot( rootFile: string, opts: { fnNames?: string[]; mode: "add" \| "update"; dryRun?: boolean; loadModule?: LoadModule; autoBind?: boolean; refreshExistingOnly?: boolean; }, ): EmitDerivedResult` |
| `EmitDerivedResult` | type | — | `EmitDerivedResult = { sidecars: Array<{ file: string; sidecarPath: string; fn: string; written: boolean; changed: boolean; skipped?: "nam...` |
| `emitInterface` | fn | 单文件 emit：分析 → 逐目标投影/自检 → 组装侧车内容 →（非 dryRun）写盘。 | `emitInterface( filePath: string, opts: EmitInterfaceOpts, ): Promise<EmitInterfaceResult>` |
| `EmitInterfaceOpts` | type | — | `EmitInterfaceOpts = { fnNames?: string[]; mode: "add" \| "update"; all?: boolean; dryRun?: boolean; records?: CallRecord[]; source?: strin...` |
| `EmitInterfaceResult` | type | — | `EmitInterfaceResult = { written: string[]; skipped: Array<{ fn: string; reason: EmitInterfaceSkipReason }>; changed: boolean; diff?: stri...` |
| `EmitInterfaceSkipReason` | type | — | `EmitInterfaceSkipReason = \| "name-clash" \| "not-projectable" \| "not-an-export" \| "no-change" \| "emit-denied" \| "multi-declarator"` |
| `EmitResult` | type | — | `EmitResult = { source: string; changed: boolean; written: Array<{ fn: string; cases: string[] }>; skipped: Array<{ fn: string; reason: Em...` |
| `EmitSkipReason` | type | — | `EmitSkipReason = \| "hand-written" \| "already-generated" \| "entry-only" \| "no-serializable-cases" \| "no-declaration" \| "skipped"` |
| `entryVariantForFile` | fn | Dual-entry info for an analyzed file: the owning package must declare two differing faces **and** this file must be one of the entry targets. | `entryVariantForFile(filePath: string): EntryVariantInfo \| null` |
| `EntryVariantInfo` | type | — | `EntryVariantInfo = { pkgPath: string; pkgDir: string; pkgName?: string; kind: "exports-conditions" \| "browser-field"; browserPaths: strin...` |
| `EntryVariantIssue` | type | Host-facing info issue (CLI check / JSON) for one analyzed entry variant. | `EntryVariantIssue = { severity: "info"; code: "nudo:dual-entry"; message: string; suggestion: string; line: number; column: number; }` |
| `entryVariantIssueForFile` | fn | — | `entryVariantIssueForFile(filePath: string): EntryVariantIssue \| null` |
| `EnvHarvestConflict` | type | Conflict when handwritten env overwrote a harvest module/export (B8). | `EnvHarvestConflict = { module: string; exports: string[]; defaultOverwritten: boolean; }` |
| `envPathDependents` | fn | 依赖该 env 模板的源文件列表 | `envPathDependents(envPath: string): string[]` |
| `evalAbsModuleGraph` | fn | 递归求值相对依赖 + 裸包 harvest，产出入口可用的 modules 表。 | `evalAbsModuleGraph( entrySource: string, entryFile: string, opts: AbsGraphOptions = {}, ): AbsModuleGraphResult` |
| `evictAbsModuleCacheFiles` | fn | — | `evictAbsModuleCacheFiles(paths: string[]): void` |
| `evictAnalysisCachesForFiles` | fn | 依赖内容变更后：按入口文件定向逐出 service 层缓存。 | `evictAnalysisCachesForFiles(files: string[]): void` |
| `evictAnalysisFileCacheForFiles` | fn | 依赖变更后：按入口文件逐出 | `evictAnalysisFileCacheForFiles(files: string[]): number` |
| `evictBPathCacheForFiles` | fn | 依赖文件变更后：逐出以这些文件为入口的 B-path 缓存 | `evictBPathCacheForFiles(files: string[]): number` |
| `evictFnAnalysisCacheForFiles` | fn | Dependency content changed: drop every per-fn entry for these entry files. | `evictFnAnalysisCacheForFiles(files: string[]): number` |
| `extractFnConstraintSources` | fn | — | `extractFnConstraintSources( sidecarSrc: string, fnName: string, )` |
| `extractNudoImportSpecs` | fn | 从源码提取 `@nudo:import` / `@nudo:import * as` 的 specifier | `extractNudoImportSpecs(source: string): string[]` |
| `filterDiagnosticsByLevel` | fn | 按 analysis.diagnostics 档过滤 evaluator/check **显示路径**诊断。 | `filterDiagnosticsByLevel<T extends { severity: string; code?: string }>( diags: T[], level: DiagnosticsLevel, ): T[]` |
| `findOwningPackage` | fn | Nearest package.json walking up from the file's directory. | `findOwningPackage( fromFile: string, )` |
| `findProjectConfig` | fn | — | `findProjectConfig( startDir: string, )` |
| `formatDerivedSection` | fn | 组装生成段（组合式 + import + prelude）。 | `formatDerivedSection( row: DerivedExport, opts: { rootSidecarDir: string; targetSidecarDir: string; takenNames?: Iterable<string>; }, )` |
| `formatDraftModule` | fn | 草稿模块文本（人读 + 可复制到 *.nudo.js / *.nudo.ts） | `formatDraftModule( filePath: string, entries: InterfaceDraftEntry[], sidecarPath?: string, ): string` |
| `formatDraftSummary` | fn | — | `formatDraftSummary( sourceRel: string, draftRel: string, result: InterfaceDraftResult, write?: WriteDraftResult, ): string[]` |
| `formatEmitSummary` | fn | emit 摘要行（CLI runInterfaceEmit 与 LSP agent 面共用；路径由调用方按 展示口径传入——CLI 传 cwd 相对、agent 传绝对路径）。 | `formatEmitSummary( sourcePath: string, sidecarRel: string, result: EmitInterfaceResult, ): string[]` |
| `formatInterfaceSurfaceLine` | fn | 单条 interface 打印行（CLI runInterface 与 LSP agent 面共用） | `formatInterfaceSurfaceLine(e: InterfaceSurfaceEntry): string` |
| `FunctionAnalysis` | type | — | `FunctionAnalysis = { name: string; loc: SourceLocation; paramNames: string[]; formals?: FormalParam[]; cases: CaseResult[]; combinedAbs?:...` |
| `generateDts` | fn | — | `generateDts(result: AnalysisResult): string` |
| `generateFunctionDtsLines` | fn | 为单个函数生成 .d.ts 声明行（JSDoc + 单一 widen 主签名）。 | `generateFunctionDtsLines(fn: FunctionAnalysis): string[]` |
| `generateGuardFunction` | fn | 兼容别名：Abs 路径唯一 | `generateGuardFunction(name: string, abs: Abs): string` |
| `generateGuardFunctionFromAbs` | fn | Abs 指称守卫（设计 §2.7）：保留 pred | `generateGuardFunctionFromAbs(name: string, abs: Abs): string` |
| `getAbsModuleCacheSize` | fn | 测试/诊断：当前条目数（≤ ABS_MODULE_CACHE_MAX） | `getAbsModuleCacheSize(): number` |
| `getAnalysisFileCacheSize` | fn | — | `getAnalysisFileCacheSize(): number` |
| `getAnalysisSession` | fn | 进程内默认 AnalysisSession（LSP server / CLI watch / agent tools 共用） | `getAnalysisSession(): AnalysisSession` |
| `getBPathCacheSize` | fn | 测试/诊断：当前 B-path run 缓存条目数（≤ getSessionCacheLimits().maxBRuns） | `getBPathCacheSize(): number` |
| `getEnvHarvestConflictCollector` | fn | Read-only peek for tests / nested restore. | `getEnvHarvestConflictCollector()` |
| `getEnvPathDepsSize` | fn | 测试/诊断：反向依赖驻留规模 | `getEnvPathDepsSize(): number` |
| `getFnAnalysisCacheSize` | fn | 测试/诊断：当前条目数（≤ getSessionCacheLimits().maxFns） | `getFnAnalysisCacheSize(): number` |
| `getPathEnvCacheSizes` | fn | 测试/诊断：path-env 驻留规模（均 ≤ 对应上限） | `getPathEnvCacheSizes()` |
| `getSessionCacheLimits` | fn | — | `getSessionCacheLimits( env: NodeJS.ProcessEnv = process.env, ): SessionCacheLimits` |
| `ifaceCacheKey` | fn | effectiveInterface 表键（L1 Phase B，design-persistent-cache）。 | `ifaceCacheKey( filePath: string, source: string, opts: { autoBind: boolean; projectDir?: string; sidecarSource?: string \| undefined; depContents?: Array<{ path: string; content: string \| null }>; projectEnvNames?: string[]; }, ): string` |
| `injectBindings` | fn | — | `injectBindings( source: string, bindings: TypeBinding[], )` |
| `insertGeneratedCaseDirectives` | fn | 把 analysis 中的合成 case（source === "callsite"）固化为源码指令： 1. | `insertGeneratedCaseDirectives(source: string, analysis: AnalysisResult): EmitResult` |
| `interfaceConfig` | fn | 归一化 `nudo.contract` 配置段。 | `interfaceConfig(config: NudoConfig \| null \| undefined): InterfaceConfig` |
| `InterfaceConfig` | type | — | `InterfaceConfig = { autoBind: boolean; emit: string[]; }` |
| `InterfaceDraftEntry` | type | — | `InterfaceDraftEntry = { fn: string; params: Array<{ name: string; constraint?: NudoConstraint; display: string; projected: boolean; bodyA...` |
| `InterfaceDraftOpts` | type | — | `InterfaceDraftOpts = { fnNames?: string[]; records?: CallRecord[]; loadModule?: LoadModule; autoBind?: boolean; bodyAccesses?: boolean; s...` |
| `InterfaceDraftResult` | type | — | `InterfaceDraftResult = { file: string; entries: InterfaceDraftEntry[]; draftSource: string; sidecarPath: string; }` |
| `interfaceSurface` | fn | 单文件 interface 表面：analyzer 推断结果给出函数清单与 implicit 展示， effectiveInterface 给出契约命中（手写 &gt; 生成段）。诊断 side-channel 在收尾时取走丢弃——打印命令不执法，interface-load 等错误留给 check 路径。 | `interfaceSurface( filePath: string, opts: InterfaceSurfaceOpts = {}, ): Promise<InterfaceSurfaceEntry[]>` |
| `InterfaceSurfaceEntry` | type | — | `InterfaceSurfaceEntry = { fn: string; kind: "export" \| "local"; source: "handwritten" \| "generated" \| "implicit"; params: Array<{ name: s...` |
| `InterfaceSurfaceOpts` | type | — | `InterfaceSurfaceOpts = { autoBind?: boolean; loadModule?: LoadModule; records?: CallRecord[]; source?: string; }` |
| `isBPathCapable` | fn | 可走 transpile+exec 的快速预判（env 经 loadEnvs 内置 + 已 preload 的路径型）。 | `isBPathCapable(source: string, envNames: string[] = []): boolean` |
| `isDraftableEntry` | fn | Parse-layer draftable: at least one entry has generated DSL and was not skipped | `isDraftableEntry(entries: ReadonlyArray<Pick<InterfaceDraftEntry, "dsl" \| "skipped">>): boolean` |
| `isEnvTemplatePath` | fn | watch 门禁：env 模板变更必须可被接收（即便扩展名不进 isNudoTargetPath） | `isEnvTemplatePath(path: string): boolean` |
| `isNudoTargetPath` | fn | nudo 推断目标文件判定（纯扩展名规则，路径无需存在）。 | `isNudoTargetPath(path: string): boolean` |
| `isProjectConfigPath` | fn | — | `isProjectConfigPath(path: string): boolean` |
| `isSidecarPath` | fn | Formal sidecar contracts only — drafts never ambient-bind and need not reanalyze | `isSidecarPath(path: string): boolean` |
| `isWatchRelevantPath` | fn | Watch accept gate: analysis targets + sidecar/config/env-template invalidators | `isWatchRelevantPath(path: string): boolean` |
| `LoadModule` | type | — | `LoadModule = (spec: string, fromFile: string) => string \| undefined` |
| `locFromNode` | fn | — | `locFromNode(node: Node): SourceLocation` |
| `matchesEmitAllowlist` | fn | 极简 glob（`**` / `*` / `?`）：相对 projectDir 匹配**源文件**绝对路径 （不是侧车路径；侧车随源文件同目录写出）。无白名单 → true。 | `matchesEmitAllowlist( absPath: string, projectDir: string \| undefined, patterns: string[], ): boolean` |
| `MergeHarvestOptions` | type | — | `MergeHarvestOptions = { onConflict?: (c: EnvHarvestConflict) => void; }` |
| `mergeHarvestUnderEnv` | fn | Handwritten `@nudojs/env` wins over harvest / graph modules on overlapping module keys and overlapping export names (docs/versioning.md B8 + website harvester API). | `mergeHarvestUnderEnv( harvestModules: Record<string, AbsModuleExports>, envModules: Record<string, AbsModuleExports>, opts?: MergeHarvestOptions, ): Record<string, AbsModuleExports>` |
| `mockDirectivesToAbsSeeds` | fn | 从函数上的 @nudo:mock 指令收集 Abs seed | `mockDirectivesToAbsSeeds( functions: Array<{ directives: FunctionWithDirectives["directives"] }>, opts?: { fromFile?: string; loadModule?: LoadModule; }, ): AbsMockSeeds` |
| `MockModuleApplyResult` | type | — | `MockModuleApplyResult = { modules: Record<string, AbsModuleExports>; errors: FromMockError[]; applied: boolean; }` |
| `mockSeedsForSource` | fn | 便捷入口：源码 → @nudo:mock 的 B 注入 Abs 绑定（checkSource 注入管线用） | `mockSeedsForSource( source: string, opts?: { fromFile?: string; loadModule?: LoadModule }, ): Record<string, Abs>` |
| `mockSeedsToAbsMocks` | fn | B 路径注入用：seedVars + seedFns 统一为 Abs 函数绑定。 | `mockSeedsToAbsMocks(seeds: AbsMockSeeds): Record<string, Abs>` |
| `ModuleExports` | type | — | `ModuleExports = { path: string; named: Map<string, string>; defaultExport?: string; source: string; poly: Map<string, PolyFn>; }` |
| `ModuleGraphCache` | type | mtime 边缓存：key 为文件路径，edges 为已抽取的相对 import 边（与 buildModuleGraph 返回语义一致）。 | `ModuleGraphCache = Map<string, { mtimeMs: number; size: number; edges: string[] }>` |
| `noteEnvPathDeps` | fn | 源码里的 path-based load specs 解析为绝对路径后登记反向边 | `noteEnvPathDeps(sourcePath: string, source: string): void` |
| `NudoConfig` | type | — | `NudoConfig = { env?: string[]; mocks?: Record<string, string>; contract?: { autoBind?: boolean; emit?: string[] \| string; }; analysis?: {...` |
| `projectAbsToSchema` | fn | — | `projectAbsToSchema(a: Abs, opts?: { dialect?: SchemaDialect }): SchemaProjection` |
| `ReferenceInfo` | type | — | `ReferenceInfo = { name: string; loc: SourceLocation; uri?: string; }` |
| `relativizePath` | fn | 相对化路径，避免绝对路径进磁盘键；树外路径用稳定内容 hash | `relativizePath(p: string, root?: string): string` |
| `resetAllAnalysisCaches` | fn | 比 clearAnalysisSessionCaches 更彻底：再丢 AST LRU（测试 / 进程复用场景） | `resetAllAnalysisCaches(): void` |
| `resetSessionCacheLimitState` | fn | 测试：丢弃 env 惰性缓存，重新读 process.env | `resetSessionCacheLimitState(): void` |
| `resolveModule` | fn | — | `resolveModule(source: string, fromDir: string)` |
| `RootDeriveOpts` | type | — | `RootDeriveOpts = { loadModule?: LoadModule; autoBind?: boolean; fnNames?: string[]; refreshExistingOnly?: boolean; }` |
| `RootDeriveResult` | type | — | `RootDeriveResult = { roots: string[]; derived: DerivedExport[]; hasRoot: boolean; }` |
| `SchemaDialect` | type | — | `SchemaDialect = "zod"` |
| `SchemaNode` | type | — | `SchemaNode = \| { k: "lit"; value: string \| number \| boolean \| null \| undefined } \| { k: "prim"; type: "number" \| "string" \| "boolean" \| "...` |
| `schemaNodeToZod` | fn | — | `schemaNodeToZod(node: SchemaNode): string` |
| `SchemaProjection` | type | — | `SchemaProjection = { source: string; dialect: SchemaDialect; dropped: string[]; }` |
| `SchemaRefinement` | type | — | `SchemaRefinement = \| { kind: "numBound"; op: "gt" \| "ge" \| "lt" \| "le"; n: number } \| { kind: "int" } \| { kind: "strMin"; n: number } \| {...` |
| `serializeCaseArg` | fn | 单个 Abs → parseCaseArgExpr 可解析回去的表达式文本；不可表达返回 null | `serializeCaseArg(a: Abs): string \| null` |
| `serializeCaseJson` | fn | — | `serializeCaseJson( result: AnalysisResult, file: string, ): CaseJson` |
| `SessionCacheLimits` | type | 会话级内存 LRU 上限（进程内，非磁盘 cache）。 | `SessionCacheLimits = { maxFiles: number; maxFns: number; maxBRuns: number; }` |
| `setAnalysisSession` | fn | 测试：替换默认 session（返回旧值以便恢复） | `setAnalysisSession(session: AnalysisSession \| undefined): AnalysisSession \| undefined` |
| `setEnvHarvestConflictCollector` | fn | Install conflict collector; returns the previous one so nested/concurrent analyzeFile callers can save/restore (module-global is not re-entrant). | `setEnvHarvestConflictCollector( collector: ((c: EnvHarvestConflict) => void) \| null, )` |
| `setSessionCacheFromProject` | fn | package.json#nudo.sessionCache 层（findProjectConfig / 宿主接线） | `setSessionCacheFromProject(partial: PartialLimits \| null \| undefined): void` |
| `setSessionCacheLimits` | fn | 显式覆盖（宿主 / 测试）。传 null 清除显式层 | `setSessionCacheLimits(partial: PartialLimits \| null): SessionCacheLimits` |
| `sha256Hex` | fn | — | `sha256Hex(data: string \| Buffer): string` |
| `shouldAnalyzeFile` | fn | 是否应对该文件跑分析（自动路径，如 LSP validate）。 | `shouldAnalyzeFile( filePath: string, source: string \| undefined, config?: AnalysisConfig, ): boolean` |
| `sidecarDraftPath` | fn | `lib.js\|ts` → `lib.nudo.draft.js\|ts`（不进 ambient sidecar 表） | `sidecarDraftPath(filePath: string): string` |
| `sourceHasNudoDirectives` | fn | — | `hasNudoDirectives(source: string): boolean` |
| `SourceLocation` | type | — | `SourceLocation = { start: { line: number; column: number }; end: { line: number; column: number }; }` |
| `StandardSchemaIssue` | type | — | `StandardSchemaIssue = { message: string; path?: ReadonlyArray<PropertyKey>; }` |
| `StandardSchemaModuleProjection` | type | — | `StandardSchemaModuleProjection = { source: string; dropped: string[]; }` |
| `StandardSchemaResult` | type | — | `StandardSchemaResult = \| { value: unknown; issues?: undefined } \| { issues: ReadonlyArray<StandardSchemaIssue>; value?: undefined }` |
| `stripGeneratedCaseDirectives` | fn | 从源码剥离所有本模块生成的 @nudo:case 指令（名字以 call@ 开头，整行删除）。 | `stripGeneratedCaseDirectives(source: string)` |
| `SymbolInfo` | type | — | `SymbolInfo = { name: string; kind: "function" \| "variable" \| "class" \| "parameter"; loc: SourceLocation; uri?: string; }` |
| `SymbolTable` | type | — | `SymbolTable = { definitions: Map<string, SymbolInfo>; references: ReferenceInfo[]; }` |
| `topoSortDirty` | fn | Topological order with dependencies before dependents (only imports edges internal to dirty; cycles tolerated — remaining files appended in arbitrary order). | `topoSortDirty(imports: Map<string, Set<string>>, dirty: string[]): string[]` |
| `trimAnalysisFileCache` | fn | 立刻压到当前 maxFiles（调低上限时收内存） | `trimAnalysisFileCache(): void` |
| `trimBPathCache` | fn | 立刻压到当前 maxBRuns（调低上限时收内存） | `trimBPathCache(): void` |
| `trimFnAnalysisCache` | fn | 立刻压到当前 maxFns（调低上限时收内存） | `trimFnAnalysisCache(): void` |
| `tryBPathCall` | fn | B 路径求值具名导出（仅成功结果） | `tryBPathCall( source: string, filePath: string, fnName: string, args: Abs[], opts: { envNames?: string[]; mocks?: Record<string, Abs>; phi?: Phi } = {}, ): Abs \| undefined` |
| `tryBPathCallFull` | fn | B 路径求值具名导出（结果 + throws）；opts.collectCalls 时附带调用点记录。 | `tryBPathCallFull( source: string, filePath: string, fnName: string, args: Abs[], opts: { collectCalls?: boolean; collectMemberDiags?: boolean; envNames?: string[]; mocks?: Record<string, Abs>; phi?: Phi; } = {}, )` |
| `tryRunBPath` | fn | 模块图 + runTranspiled（默认 analyze 模式） | `tryRunBPath( source: string, filePath: string, opts: { maxLoopIters?: number; mode?: "exec" \| "analyze"; envNames?: string[]; mocks?: Record<string, Abs>; lenientGlobals?: boolean; } = {}, ): BPathRunResult \| undefined` |
| `TypeBinding` | type | — | `TypeBinding = { name: string; type: string }` |
| `typeExprToDirective` | fn | agent 面类型表达式 → `@nudo:as` 文法 | `typeExprToDirective(expr: string): string` |
| `unifiedDiff` | fn | 行级 unified diff：`--- a/path` 头 + `@@` hunk + 上下文 3 行；相同返回 "" | `unifiedDiff(a: string, b: string, path: string): string` |
| `validateSchemaNode` | fn | SchemaNode 同步校验（生成模块与测试共用语义）。 | `validateSchemaNode(node: SchemaNode, value: unknown): StandardSchemaResult` |
| `WriteDraftResult` | type | — | `WriteDraftResult = { draftPath: string; written: boolean; changed: boolean; draftable: boolean; draftSource: string; }` |
| `writeInterfaceDraft` | fn | 写入 `*.nudo.draft.js`（覆盖草稿文件本身；不碰正式 `*.nudo.js`）。 | `writeInterfaceDraft( filePath: string, draftSource: string, opts: { dryRun?: boolean; projectDir?: string; entries?: ReadonlyArray<Pick<InterfaceDraftEntry, "dsl" \| "skipped">>; draftable?: boolean; } = {}, ): WriteDraftResult` |
| `ZodModuleProjection` | type | — | `ZodModuleProjection = { source: string; dialect: SchemaDialect; dropped: string[]; }` |
<!-- NUDO-API-SKELETON:END -->
