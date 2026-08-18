---
sidebar_position: 3
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

`externalCallRecords` 接收由 [`collectCallRecords`](#collectcallrecords) 从使用现场文件（测试、示例、上层应用）收集的调用记录。能解析到本文件所定义函数的记录会被匹配并注入为合成的 `call@L` 用例——参见[调用点发现指南](/docs/guides/callsite-discovery)。

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

将返回的记录作为 `externalCallRecords` 传给 `analyzeFile`/`analyzeFileAsync`，即可注入为 `call@L` 用例。两阶段流程见[调用点发现 — 编程 API](/docs/guides/callsite-discovery#编程接口)。

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

## buildModuleGraph

```typescript
buildModuleGraph(files: string[]): {
  imports: Map<string, Set<string>>;    // 文件 → 它导入的文件
  dependents: Map<string, Set<string>>; // 文件 → 导入它的文件
}
```

静态抽取每个文件的相对导入边——增量分析的基础构件。扩展名解析规则与模块解析一致（`''`、`.js`、`.ts`、`.mjs`）；裸 npm 说明符会被跳过。CLI 的 watch 模式和 LSP 的脏传播都用它在各自已知文件集上建图。

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
  source?: "directive" | "callsite"; // 手写 @nudo:case 或合成 call@L
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

`targetModule`/`targetExport`/`fnModule` 字段驱动归属守卫：一条记录只会匹配其模块真正指向的文件，因此测试文件里的同名辅助函数不会把记录涂抹到无关文件上。参见[调用点发现 — 安全设计](/docs/guides/callsite-discovery#安全性设计)。

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
