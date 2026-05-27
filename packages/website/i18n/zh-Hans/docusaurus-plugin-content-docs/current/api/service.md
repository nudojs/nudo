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
  activeCases?: Map<string, number>
): AnalysisResult
```

对文件运行类型推断。使用 `filePath` 进行模块解析和诊断。`activeCases` 将函数名映射到用例索引，用于诊断（如 IDE 中当前“激活”的用例）。

**返回：** `AnalysisResult`

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
}
```

### Diagnostic

```typescript
type Diagnostic = {
  range: SourceLocation;
  severity: "error" | "warning" | "info";
  message: string;
  tags?: DiagnosticTag[];
  code?: string;   // 如 "nudo-unreachable"、"nudo-may-throw"、"nudo-assertion-failed"
  data?: unknown;  // 用于代码操作的额外上下文
}
```

### CompletionItem

```typescript
type CompletionItem = {
  label: string;
  kind: "property" | "method" | "variable";
  detail?: string;
}
```
