---
sidebar_position: 2
description: "@nudojs/parser API —— 带类型剥除的 parse()、stripTypes、函数级/文件级/行内指令提取，以及指令类型定义。"
---

# @nudojs/parser

parser 包负责源代码解析和指令提取。产出 Babel 兼容的 AST 以及供求值器使用的结构化指令数据。

## parse

```typescript
parse(source: string, opts?: { errorRecovery?: boolean }): File
```

将 JavaScript/TypeScript 源码解析为 Babel `File` AST，再对其执行 [`stripTypes`](#striptypes)——返回的 AST 不含任何 TS 专有节点，因此 `.ts` 输入在所有下游消费方（求值器、analyzer、LSP）零接线即可工作。

固定 Babel 选项：`sourceType: "module"`、`plugins: ["typescript", "jsx"]`、`attachComment: true`（指令提取需要）。

`opts.errorRecovery` 启用 Babel 错误恢复模式，供尽力而为的解析使用（例如对老 CJS 使用现场文件的 `collectCallRecords`）；默认 `false`，语法错误快速失败。

**返回：** Babel `File` 节点（根 AST），TS 专有语法已原地剥除。

---

## stripTypes

```typescript
stripTypes<T extends Node>(ast: T): T
```

从 Babel AST 中**原地**剥除 TS 专有语法并返回同一棵树——不重写任何 `loc`/`start`/`end`，兄弟节点顺序保持不变（`@nudo:case` 注释按 comment loc 对齐）。`parse()` 已无条件执行此 pass，只有当你自己用 `@babel/parser` 解析时才需要直接调用。

剥除/解包内容：类型断言（`as`、`satisfies`、`<T>x`、`x!`）解包为内层表达式；interface、类型别名、`declare` 语句、TS enum、type-only import/export 删除；参数/返回类型注解与类型参数列表丢弃。enum 成员引用会退化为 unknown-global 诊断——求值器没有 enum 求值语义。非 `declare` 的 namespace 和 `import x = require(...)` 保留原样，求值为 `unknown`。

---

## 指令类型

指令从注释中提取，使用 `@nudo:` 命名空间。函数级指令来自顶层语句的前导**块**注释；文件级与行内指令来自**行**注释（见 [`extractFileDirectives`](#extractfiledirectives) / [`extractInlineDirectives`](#extractinlinedirectives)）。

`Directive` 联合类型涵盖六种函数级指令：

```typescript
type Directive =
  | CaseDirective
  | MockDirective
  | PureDirective
  | SkipDirective
  | SampleDirective
  | ReturnsDirective;
```

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
  expression?: string;   // 行内表达式（原始文本）
  fromPath?: string;     // mock 模块路径
  arrowFn?: { params: string[]; body: Node; paramPatterns: Node[] }; // 解析后的行内箭头函数
  sinonExpr?: SinonExpression;  // stub()/spy()/mock() 表达式
  nudoMock?: MockHelper;        // 解析后的 mock-helper 形态（来自 @nudojs/core）
}
```

将某绑定替换为类型值感知的 mock 实现。行内箭头函数（`@nudo:mock fetch = (url) => ({ ok: true })`）解析进 `arrowFn`；sinon 风格与 `stub()` 风格表达式统一归一化为 `nudoMock`（`@nudojs/core` 的 `MockHelper`）。

### SinonExpression

```typescript
type SinonExpression = {
  type: "stub" | "spy" | "mock";
  returnValue?: TypeValue;
  resolvedValue?: TypeValue;
  rejectedValue?: TypeValue;
}
```

`@nudo:mock` 的 sinon 风格形态（`@nudo:mock fetch = sinon.stub().resolves({...})`），从 `stub()`/`spy()`/`mock()` 前缀归一化而来。

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

### FileDirective

文件顶部（任何语句之前）的行注释，对文件内所有函数生效：

```typescript
type FileDirective = EnvDirective | MockModuleDirective;

type EnvDirective = {
  kind: "env";
  envs: string[];          // 具名或基于路径的 env，逗号分隔
}

type MockModuleDirective = {
  kind: "mock-module";
  source: string;          // 要替换的 import 说明符
  fromPath: string;        // 提供 mock 模块的文件
  names?: string[];        // 部分形态：只 mock 这些导出
}
```

### InlineDirective

附着在内部语句或表达式上的行注释：

```typescript
type InlineDirective = AsDirective | ReplaceDirective;

type AsDirective = {
  kind: "as";
  typeExpr: TypeValue;     // 假设类型：// @nudo:as T.string
}

type ReplaceDirective = {
  kind: "replace";
  targetSource: string;    // 要覆盖的表达式文本
  typeExpr: TypeValue;     // 替换类型
}
```

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

## extractFileDirectives

```typescript
extractFileDirectives(ast: Node): FileDirective[]
```

从 AST 的顶层**行注释**提取文件级指令：`/// @nudo:env`（一个或多个逗号分隔的 env）与 `/// @nudo:mock-module "source" from "path"`（部分 mock 可带 `{ a, b }` 名单）。非 `File` 节点返回空数组。

**示例：**
```javascript
/// @nudo:env node, ./nudo-harvest-node.ts
```

---

## extractInlineDirectives

```typescript
extractInlineDirectives(node: Node): InlineDirective[]
```

从附着在单个节点上的**行注释**提取 `@nudo:as` 与 `@nudo:replace` 指令——agent 侧类型假设（`nudo.whatIf` 注入 `// @nudo:as <type>` 行）背后的机制。注释必须独占一行、位于语句上方（同一行的行尾注释不算该节点的前导注释）；其余注释类型被忽略。

**示例：**
```javascript
// @nudo:as T.string
const y = f(x);
```

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
- 函数：箭头表达式（`(x) => x + 1`）与 `function(x) { ... }`——解析为真实的 `T.fn` 值
- JSON 风格：`{ "key": value }`、`[a, b, c]`

**返回：** 解析得到的 TypeValue，无法识别的表达式返回 `T.unknown`。
