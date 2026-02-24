---
sidebar_position: 2
---

# @nudojs/parser

parser 包负责源代码解析和指令提取。产出 Babel 兼容的 AST 以及供求值器使用的结构化指令数据。

## parse

```typescript
parse(source: string): File
```

将 JavaScript/TypeScript 源码解析为 Babel `File` AST。

**选项：**
- `sourceType: "module"`
- `plugins: ["typescript", "jsx"]`
- `attachComment: true`（指令提取需要）

**返回：** Babel `File` 节点（根 AST）。

---

## 指令类型

指令从块注释中提取，使用 `@nudo:` 命名空间。

### CaseDirective

```typescript
type CaseDirective = {
  kind: "case";
  name: string;
  args: TypeValue[];
  expected?: TypeValue;
  commentLine?: number;
}
```

具名执行用例，带输入参数。可选 `expected` 用于返回值类型校验。

### MockDirective

```typescript
type MockDirective = {
  kind: "mock";
  name: string;
  expression?: string;   // inline expression
  fromPath?: string;     // path to mock module
}
```

将某绑定替换为类型值感知的 mock 实现。

### PureDirective

```typescript
type PureDirective = { kind: "pure" }
```

标记函数为纯函数，启用记忆化。

### SkipDirective

```typescript
type SkipDirective = {
  kind: "skip";
  returns?: TypeValue;
}
```

跳过求值；使用 `returns` 或已有类型注解。

### SampleDirective

```typescript
type SampleDirective = {
  kind: "sample";
  count: number;
}
```

在不动点分析之前要执行的循环迭代次数。

### ReturnsDirective

```typescript
type ReturnsDirective = {
  kind: "returns";
  expected: TypeValue;
}
```

断言推断的返回类型是 `expected` 的子类型。

---

## FunctionWithDirectives

```typescript
type FunctionWithDirectives = {
  node: Node;        // Babel AST node (function declaration/expression)
  name: string;     // function name
  directives: Directive[];
}
```

顶层函数及其关联指令。

---

## extractDirectives

```typescript
extractDirectives(ast: Node): FunctionWithDirectives[]
```

从顶层语句的前导块注释中提取 `@nudo:*` 指令。仅包含至少有一条指令的语句。支持：

- `FunctionDeclaration`
- `ExportDefaultDeclaration`（内含 FunctionDeclaration）
- `VariableDeclaration`（第一个声明）

**返回：** 函数及其指令的数组，每个带标注的语句对应一项。

---

## parseTypeValueExpr

```typescript
parseTypeValueExpr(expr: string): TypeValue
```

将字符串表达式解析为 TypeValue。用于指令参数（如 `@nudo:case` 的 args、`@nudo:returns` 的 expected 类型）。

**支持形式：**
- 基本类型：`T.number`、`T.string`、`T.boolean`、`T.unknown`、`T.never`、`T.null`、`T.undefined`
- 字面量：`T.literal(...)`、`true`、`false`、`null`、`undefined`、数字、带引号字符串
- 复合类型：`T.object({...})`、`T.array(...)`、`T.tuple([...])`、`T.union(...)`
- JSON 风格：`{ "key": value }`、`[a, b, c]`

**返回：** 解析得到的 TypeValue，无法识别的表达式返回 `T.unknown`。
