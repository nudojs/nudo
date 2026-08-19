---
sidebar_position: 3
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
  externalCallRecords?: CallRecord[]
): AnalysisResult
```

对文件运行类型推断。使用 `filePath` 进行模块解析和诊断。`activeCases` 将函数名映射到用例索引，用于诊断（如 IDE 中当前“激活”的用例）。

`externalCallRecords` 接收由 [`collectCallRecords`](#collectcallrecords) 从使用现场文件（测试、示例、上层应用）收集的调用记录。能解析到本文件所定义函数的记录会被匹配并注入为合成的 `call@L` 用例——参见[调用点发现指南](../guides/callsite-discovery.md)。

没有 `@nudo:case` 指令的函数也不会被跳过：全程序推断会为每个观测到的调用点合成一个 `call@L` 用例；找不到调用点时合成参数为 `T.unknown` 的 `entry@L` 用例（并在 [`FunctionAnalysis`](#functionanalysis) 上标记 `entryOnly`）。

**返回：** `AnalysisResult`

---

## analyzeFileAsync

```typescript
analyzeFileAsync(
  filePath: string,
  source: string,
  activeCases?: Map<string, number>,
  externalCallRecords?: CallRecord[]
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
): TypeValue | null
```

返回指定源码位置（1-based 行、0-based 列）的 TypeValue。当位置位于带有用例的函数内时，按函数使用对应的激活用例索引。

**返回：** `TypeValue`，若无类型则返回 `null`。

---

## getTypeAtPositionAsync

```typescript
getTypeAtPositionAsync(
  filePath: string,
  source: string,
  line: number,
  column: number,
  activeCases?: Map<string, number>
): Promise<TypeValue | null>
```

`getTypeAtPosition` 的异步入口，带路径 env 预加载（见 [`analyzeFileAsync`](#analyzefileasync)）。

**返回：** `Promise<TypeValue | null>`

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

CLI 收集器、监视模式与 LSP `isNudoFile` 判定共享的扩展名门：`.js`/`.mjs`/`.ts`（大小写不敏感）为推断目标；`.d.ts`、`.tsx` 及其余扩展名不是。

---

## buildSemanticTokens

```typescript
buildSemanticTokens(filePath: string, source: string): number[]
```

从分析结果产出 LSP 编码的语义 token（五元组：deltaLine/deltaStartChar/length/tokenType/tokenModifiers）——函数绑定标为 `function`，其余绑定标为 `variable`，参数标为 `parameter`。LSP 服务器的 semanticTokens handler 直接消费它。

配套的图例与编码器从同一模块导出，LSP 包再原样再导出（`TOKEN_TYPES`/`TOKEN_MODIFIERS`），因此 tokenType 索引不可能与提取器漂移：

```typescript
SEMANTIC_TOKEN_TYPES: readonly string[]    // ["function", "variable", "parameter", "property",
                                           //  "type", "keyword", "string", "number", "comment",
                                           //  "decorator", "method"]
SEMANTIC_TOKEN_MODIFIERS: readonly string[] // ["declaration", "readonly", "deprecated", "unreachable"]

type SemanticToken = {
  line: number; char: number; length: number;
  typeIndex: number; modifierBitmask: number;
};

encodeSemanticTokens(tokens: SemanticToken[]): number[];
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

## typeValueToTSType

```typescript
typeValueToTSType(tv: TypeValue): string
```

将 TypeValue 序列化为 TypeScript 类型语法（如 `number`、`string | number`、`{ id: number; name: string }`）。

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

[`generateDts`](#generatedts) 的按函数切片——JSDoc 加一行 `export declare function`。CLI 的 `infer --dts` / `watch --dts` 与 `generateDts` 共用本函数，两条路径的声明输出字节级一致。无用例的函数不产出（或仅 `combined` 已知时产出一行 rest-args 的 `(...args: unknown[])` 声明）；`noDeclaration` 函数（CJS `exports.X = fn`）不产出，只留在 infer/JSON 输出中。

---

## typeValueToZodSchema

```typescript
typeValueToZodSchema(tv: TypeValue): string
```

将 TypeValue 转换为 Zod schema 字符串。处理所有类型种类，包括原始类型、字面量、对象、数组、元组、联合等。

**示例：**
```typescript
typeValueToZodSchema(T.object({ name: T.string, age: T.number }))
// → "z.object({ name: z.string(), age: z.number() })"
```

---

## generateGuardFunction

```typescript
generateGuardFunction(name: string, tv: TypeValue): string
```

生成零依赖的运行时类型守卫函数字符串。生成的函数使用 `typeof`、`Array.isArray` 和属性检查进行验证。

**示例：**
```typescript
generateGuardFunction("isUser", T.object({ name: T.string }))
// → "function isUser(data) { ... }"
```

---

## 用例固化

用例固化（case emission）这组函数把合成的 `call@L` 用例写回源码文本。CLI 的 `--emit-cases` 只是对它们的薄封装——工作流与合并策略见 [CLI 使用指南 —— 固化 case 指令](../guides/cli.md#固化-case-指令)。

### serializeCaseArg

```typescript
serializeCaseArg(tv: TypeValue): string | null
```

把单个 TypeValue 序列化为指令文法（`parseTypeValueExpr`）能原样读回的表达式文本。指令表达不了的形状返回 `null`：函数、promise、实例与 refined 值，`bigint`/`symbol` 原始类型，以及含结构字符或控制字符的字符串/对象键。

**示例：**
```typescript
serializeCaseArg(T.number)           // → "T.number"
serializeCaseArg(T.array(T.string))  // → "T.array(T.string)"
```

### buildCaseDirective

```typescript
buildCaseDirective(name: string, args: TypeValue[]): string | null
```

组装单行指令 ` * @nudo:case "name" (a, b)`（带前导 ` *`，无尾换行），可直接拼进 JSDoc 块。任一实参序列化失败、或名字含双引号/换行时整体返回 `null`。

**示例：**
```typescript
buildCaseDirective("call@L2", [T.string])
// → ' * @nudo:case "call@L2" (T.string)'
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
  nodeTypeMap: Map<Node, TypeValue>;
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
  combined?: TypeValue;        // 用例结果的联合
  assertionErrors?: string[]; // @nudo:returns 失败
  entryOnly?: boolean;         // 合成的 entry@L 用例，未找到调用点
  skipped?: boolean;
  /** CJS 风格绑定/赋值函数（exports.X = fn）没有声明级稳定的
      名称；.d.ts 生成会跳过它们，但 infer/JSON 输出仍会报告 */
  noDeclaration?: boolean;
  /** 该函数所属导入模块的绝对路径（仅 externalFunctions） */
  fromModule?: string;
}
```

### CaseResult

```typescript
type CaseResult = {
  name: string;
  args: TypeValue[];
  result: TypeValue;
  throws: TypeValue;
  throwLoc?: SourceLocation;
  source?: "directive" | "callsite"; // "callsite" = 由观测到的调用点合成；
                                     // 手写用例与 entry@ 回退不设置该字段
                                     //（CLI generate 路径会把指令求值的用例标为 "directive"）
  aggregatedFrom?: number;           // 折叠进符号化用例的额外调用点数
}
```

### CallRecord

由 [`collectCallRecords`](#collectcallrecords) 在使用现场观测到的一次调用：

```typescript
type CallRecord = {
  fnName: string;             // 调用点观测到的被调函数名
  argTypes: TypeValue[];      // 观测到的实参类型
  resultType: TypeValue;      // 观测到的结果类型
  throws: TypeValue;          // 观测到的抛出类型
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
  code?: string;                  // 如 "nudo:unknown-recv"、"nudo:mock-invalid"、"nudo-unreachable"、"nudo-assertion-failed"
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
  type: TypeValue;
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
