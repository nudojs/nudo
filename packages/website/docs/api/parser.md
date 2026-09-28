---
description: "@nudojs/parser API — parse() with TypeScript stripping, stripTypes, function/file/inline directive extraction, and directive type definitions."
---

# @nudojs/parser

The parser package handles source code parsing and directive extraction. It produces Babel-compatible ASTs and structured directive data for the evaluator.

## parse

```typescript
parse(source: string, opts?: { errorRecovery?: boolean }): File
```

Parses JavaScript/TypeScript source into a Babel `File` AST, then runs [`stripTypes`](#striptypes) on it — the returned AST contains no TS-only nodes, which is why `.ts` inputs work in every downstream consumer (evaluator, analyzer, LSP) without per-caller wiring.

Fixed Babel options: `sourceType: "module"`, `plugins: ["typescript", "jsx"]`, `attachComment: true` (required for directive extraction).

`opts.errorRecovery` enables Babel error recovery for best-effort passes (e.g. `collectCallRecords` over legacy CJS usage-site files); the default `false` fails fast on syntax errors.

**Returns:** Babel `File` node (root AST), with TS-only syntax stripped in place.

---

## stripTypes

```typescript
stripTypes<T extends Node>(ast: T): T
```

Strips TS-only syntax from a Babel AST **in place** and returns the same tree — no `loc`/`start`/`end` is rewritten and sibling order is preserved (`@nudo:case` comments align by comment loc). `parse()` runs this pass unconditionally, so you only need it directly when you parsed with `@babel/parser` yourself.

What it removes or unwraps: type assertions (`as`, `satisfies`, `<T>x`, `x!`) are unwrapped to their expression; interfaces, type aliases, `declare` statements, TS enums, and type-only imports/exports are deleted; parameter/return type annotations and type parameter lists are dropped. Enum references degrade to `unknown`-global diagnostics — the evaluator has no enum semantics. Non-`declare` namespaces and `import x = require(...)` are left in place and evaluate as `unknown`.

---

## Directive Types

Directives are extracted from comments using the `@nudo:` namespace. Function-level directives come from the leading comments (block or line) of top-level statements; file-level and inline directives come from **line** comments (see [`extractFileDirectives`](#extractfiledirectives) / [`extractInlineDirectives`](#extractinlinedirectives)).

The `Directive` union covers the five function-level kinds:

```typescript
type Directive =
  | CaseDirective
  | MockDirective
  | PureDirective
  | SkipDirective
  | SampleDirective;
```

### CaseDirective

```typescript
type CaseDirective = {
  kind: "case";
  name: string;
  argsAbs: Abs[];
  expected?: Abs;
  commentLine?: number;
}
```

Debug witness case with input arguments (constraint builders + concrete literals). Optional `expected` for `nudo test` return-type assertions.

### MockDirective

```typescript
type MockDirective = {
  kind: "mock";
  name: string;
  expression?: string;   // inline expression (raw text)
  fromPath?: string;     // path to mock module
  arrowFn?: { params: string[]; body: Node; paramPatterns: Node[] }; // parsed inline arrow function
  sinonExpr?: SinonExpression;  // stub()/spy()/mock() expression
  nudoMock?: MockHelper;        // parsed mock-helper form (from @nudojs/core)
}
```

Replaces a binding with an Abs-aware mock implementation. An inline arrow function (`@nudo:mock fetch = (url) => ({ ok: true })`) is parsed into `arrowFn`; sinon-style and `stub()`-style expressions are normalized into `nudoMock` (a `MockHelper` from `@nudojs/core`).

### SinonExpression

```typescript
type SinonExpression = {
  type: "stub" | "spy" | "mock";
  returnValue?: Abs;
  resolvedValue?: Abs;
  rejectedValue?: Abs;
}
```

The sinon-flavored form of `@nudo:mock` (`@nudo:mock fetch = sinon.stub().resolves({...})`), normalized from the `stub()`/`spy()`/`mock()` prefix.

### PureDirective

```typescript
type PureDirective = { kind: "pure" }
```

Marks the function as pure for memoization.

### SkipDirective

```typescript
type SkipDirective = {
  kind: "skip";
  returns?: Abs;
}
```

Skips evaluation; uses `returns` or existing type annotations.

### SampleDirective

```typescript
type SampleDirective = {
  kind: "sample";
  count: number;
}
```

Requested loop iteration count. Parsed for source compatibility but not consumed by the analyzer — loop evaluation uses bounded unrolling, so this directive has no effect on output.

### FileDirective

Line comments anywhere in the file, shared by every function in it:

```typescript
type FileDirective = EnvDirective | MockModuleDirective;

type EnvDirective = {
  kind: "env";
  envs: string[];          // named or path-based envs, comma-separated
}

type MockModuleDirective = {
  kind: "mock-module";
  source: string;          // import specifier to replace
  fromPath: string;        // file providing the mock module
  names?: string[];        // partial form: only these exports are mocked
}
```

### InlineDirective

Line comments attached to an inner statement or expression:

```typescript
type InlineDirective = AsDirective | ReplaceDirective;

type AsDirective = {
  kind: "as";
  typeAbs: Abs;             // assumed type: // @nudo:as string
}

type ReplaceDirective = {
  kind: "replace";
  targetSource: string;    // expression text to override
  typeAbs: Abs;            // replacement type
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

A top-level function with its associated directives.

---

## extractDirectives

```typescript
extractDirectives(ast: Node): FunctionWithDirectives[]
```

Extracts `@nudo:*` directives from the leading comments (block or line) of top-level statements. Only statements with at least one directive are included. Supports:

- `FunctionDeclaration`
- `ExportDefaultDeclaration` (with FunctionDeclaration)
- `VariableDeclaration` (first declaration)

**Returns:** Array of functions with their directives, one entry per annotated statement.

---

## extractFileDirectives

```typescript
extractFileDirectives(ast: Node): FileDirective[]
```

Extracts file-level directives from the AST's **line comments** (any position): `/// @nudo:env` (one or more comma-separated envs) and `/// @nudo:mock-module "source" from "path"` (optionally with a `{ a, b }` names list for partial mocking). Non-`File` nodes return an empty array.

**Example:**
```javascript
/// @nudo:env node, ./nudo-harvest-node.ts
```

---

## extractInlineDirectives

```typescript
extractInlineDirectives(node: Node): InlineDirective[]
```

Extracts `@nudo:as` and `@nudo:replace` directives from the **line comments** attached to a single node — the mechanism behind agent-side type assumptions (`nudo.whatIf` injects `// @nudo:as <type>` lines this way). The comment must sit on its own line above the statement (a same-line trailing comment is not a leading comment of the node); other comment types are ignored.

**Example:**
```javascript
// @nudo:as string()
const y = f(x);
```

---

## parseCaseArgExpr

```typescript
parseCaseArgExpr(expr: string): Abs
```

Parses a directive type expression into an Abs — the product grammar is constraint builders + concrete literals + structural literals. Used for `@nudo:case` args, `@nudo:as`/`@nudo:replace`, mock return values, and `@nudo:skip` return expressions.

**Supported forms (in precedence order):**
- Constraint expressions (primary grammar): `number()`, `number().gt(0)`, `lit(...)`, `union(…)`, `shape({…})`, `array(…)`, `fn({…}, …)`, `and`, `partial`/`pick`/`omit`
- Bare literals: `true`, `false`, `null`, `undefined`, numbers, quoted strings
- Functions: arrow expressions (`(x) => x + 1`) and `function(x) { ... }` — parsed into a real function Abs
- JSON-like: `{ "key": value }`, `[a, b, c]`

**Returns:** Parsed Abs, or `unknown` for unrecognized expressions.

## Export inventory

<!-- NUDO-API-SKELETON:BEGIN -->
> Generated by `pnpm run docs:gen:api` from package export surfaces (`PUBLIC_API.md` / `src/index.ts`) — do not edit this block. Regenerate with `node scripts/gen-api-docs.mjs`. Summaries quote the source JSDoc first sentence as-is — CJK text means the symbol's doc is not yet English, and `—` means no JSDoc at all. Each row's name carries a stable anchor `#slug` (the lowercased symbol name).

| Name | Kind | Summary | Signature |
|------|------|------|------|
| <a id="asassignmentexpression"></a>`asAssignmentExpression` | fn | — | `asAssignmentExpression( node: Node \| null \| undefined, ): AssignmentExpression \| undefined` |
| <a id="asdirective"></a>`AsDirective` | type | — | `AsDirective = { kind: "as"; typeAbs: Abs; }` |
| <a id="asexpression"></a>`asExpression` | fn | — | `asExpression(node: Node \| null \| undefined): Expression \| undefined` |
| <a id="asidentifier"></a>`asIdentifier` | fn | — | `asIdentifier(node: Node \| null \| undefined): Identifier \| undefined` |
| <a id="asmemberexpression"></a>`asMemberExpression` | fn | — | `asMemberExpression( node: Node \| null \| undefined, ): MemberExpression \| undefined` |
| <a id="asprogram"></a>`asProgram` | fn | File → its Program; Program → itself. | `asProgram(ast: Node \| File \| Program \| null \| undefined): Program \| undefined` |
| <a id="casedirective"></a>`CaseDirective` | type | — | `CaseDirective = { kind: "case"; name: string; argsAbs: Abs[]; expected?: Abs; commentLine?: number; }` |
| <a id="classidname"></a>`classIdName` | fn | ClassDeclaration/ClassExpression `id?.name`. | `classIdName(node: Node \| null \| undefined): string \| undefined` |
| <a id="classinstancemethods"></a>`classInstanceMethods` | fn | Instance methods of a class-like node. | `classInstanceMethods(node: Node \| null \| undefined): InstanceMethod[]` |
| <a id="classmemberkey"></a>`classMemberKey` | fn | Key node of a class member (for range selection). | `classMemberKey(member: Node \| null \| undefined): Node \| undefined` |
| <a id="classmemberkeyname"></a>`classMemberKeyName` | fn | `key.name ?? key.value` on a class/object member key. | `classMemberKeyName(member: Node \| null \| undefined): string \| number \| undefined` |
| <a id="directive"></a>`Directive` | type | — | `Directive = CaseDirective \| MockDirective \| PureDirective \| SkipDirective \| SampleDirective` |
| <a id="envdirective"></a>`EnvDirective` | type | — | `EnvDirective = { kind: "env"; envs: string[]; }` |
| <a id="exportspecifierexportedname"></a>`exportSpecifierExportedName` | fn | ExportSpecifier exported name (`exported.name ?? exported.value`). | `exportSpecifierExportedName( spec: Node \| null \| undefined, ): string \| number \| undefined` |
| <a id="exportspecifierlocalname"></a>`exportSpecifierLocalName` | fn | ExportSpecifier local name — Identifier only (matches `local.name`). | `exportSpecifierLocalName(spec: Node \| null \| undefined): string \| undefined` |
| <a id="extractdirectives"></a>`extractDirectives` | fn | — | `extractDirectives(ast: Node): FunctionWithDirectives[]` |
| <a id="extractfiledirectives"></a>`extractFileDirectives` | fn | — | `extractFileDirectives(ast: Node): FileDirective[]` |
| <a id="extractinlinedirectives"></a>`extractInlineDirectives` | fn | — | `extractInlineDirectives(node: Node): InlineDirective[]` |
| <a id="filedirective"></a>`FileDirective` | type | — | `FileDirective = EnvDirective \| MockModuleDirective` |
| <a id="fnorclassidloc"></a>`fnOrClassIdLoc` | fn | `id.loc` of a named function/class (undefined when anonymous or unlocated). | `fnOrClassIdLoc(node: Node \| null \| undefined): Node` |
| <a id="fnorclassidname"></a>`fnOrClassIdName` | fn | Function/Class declaration or expression `id?.name`. | `fnOrClassIdName(node: Node \| null \| undefined): string \| undefined` |
| <a id="functionwithdirectives"></a>`FunctionWithDirectives` | type | — | `FunctionWithDirectives = { node: Node; name: string; directives: Directive[]; }` |
| <a id="getclassmembers"></a>`getClassMembers` | fn | Class body members; empty when node is not a class. | `getClassMembers(node: Node \| null \| undefined): ClassBody` |
| <a id="getdeclarations"></a>`getDeclarations` | fn | VariableDeclaration.declarations; empty for other nodes. | `getDeclarations(node: Node \| null \| undefined): VariableDeclarator[]` |
| <a id="getdeclaratorid"></a>`getDeclaratorId` | fn | VariableDeclarator id narrowed to Identifier. | `getDeclaratorId(node: Node \| null \| undefined): Identifier \| undefined` |
| <a id="getdeclaratorinit"></a>`getDeclaratorInit` | fn | First declarator's init (fn-binding extraction). | `getDeclaratorInit(node: Node \| null \| undefined): Expression \| undefined` |
| <a id="getexportdeclaration"></a>`getExportDeclaration` | fn | Inner declaration of `export default` / `export …` (undefined for other nodes). | `getExportDeclaration(node: Node \| null \| undefined): Node \| undefined` |
| <a id="getexportspecifiers"></a>`getExportSpecifiers` | fn | ExportNamedDeclaration.specifiers (empty for other nodes). | `getExportSpecifiers( node: Node \| null \| undefined, )` |
| <a id="getexpressionstatementexpression"></a>`getExpressionStatementExpression` | fn | ExpressionStatement.expression. | `getExpressionStatementExpression( node: Node \| null \| undefined, ): Expression \| undefined` |
| <a id="getfirstdeclaratorid"></a>`getFirstDeclaratorId` | fn | First declarator of a VariableDeclaration, narrowed to Identifier id. | `getFirstDeclaratorId(node: Node \| null \| undefined): Identifier \| undefined` |
| <a id="identifiername"></a>`identifierName` | fn | Identifier.name only (undefined for string export names). | `identifierName(node: Node \| null \| undefined): string \| undefined` |
| <a id="inlinedirective"></a>`InlineDirective` | type | — | `InlineDirective = AsDirective \| ReplaceDirective` |
| <a id="instancemethod"></a>`InstanceMethod` | type | — | `InstanceMethod = { name: string; node: Node }` |
| <a id="ismoduleexportsmember"></a>`isModuleExportsMember` | fn | `module.exports` / `module["exports"]` is rejected here: computed keys return false. | `isModuleExportsMember(member: Node \| null \| undefined): boolean` |
| <a id="memberobjectname"></a>`memberObjectName` | fn | Identifier name of a non-computed member's object (e.g. | `memberObjectName(member: Node \| null \| undefined): string \| undefined` |
| <a id="memberpropertykey"></a>`memberPropertyKey` | fn | Non-computed member property key text (Identifier.name or StringLiteral.value). | `memberPropertyKey(member: Node \| null \| undefined): string \| null` |
| <a id="memberpropertyname"></a>`memberPropertyName` | fn | Identifier name of a non-computed member's property (e.g. | `memberPropertyName(member: Node \| null \| undefined): string \| undefined` |
| <a id="methodfunctionnode"></a>`methodFunctionNode` | fn | Class/TSDeclare method function node (ESTree MethodDefinition → its `value`). | `methodFunctionNode(member: Node \| null \| undefined): Node \| undefined` |
| <a id="mockdirective"></a>`MockDirective` | type | — | `MockDirective = { kind: "mock"; name: string; expression?: string; fromPath?: string; arrowFn?: { params: string[]; body: Node; paramPatt...` |
| <a id="mockmoduledirective"></a>`MockModuleDirective` | type | — | `MockModuleDirective = { kind: "mock-module"; source: string; names?: string[]; fromPath: string; }` |
| <a id="nameorstringvalue"></a>`nameOrStringValue` | fn | Identifier.name, else StringLiteral.value (module string export names). | `nameOrStringValue(node: Node \| null \| undefined): string \| undefined` |
| <a id="paramdisplayname"></a>`paramDisplayName` | fn | Parameter display label: `name`, `...rest`, or `_`. | `paramDisplayName(param: Node \| null \| undefined): string` |
| <a id="paramname"></a>`paramName` | fn | RestElement argument name, else plain Identifier name. | `paramName(param: Node \| null \| undefined): string \| undefined` |
| <a id="parse"></a>`parse` | fn | 所有权：Babel 解析与 TS 剥除的**实现**在 `@nudojs/core` （`algebra/parse-source.ts` / `strip-types.ts`）—— core 代数层 （check/scan/generalize）需要 AST 且不能反向依赖本包。本包职责是 `@nudo:` 指令抽取与 AST 卫兵；`parse()` 是宿主入口，委托 core 同一实现与 AST LRU。 | `parse(source: string, opts?: { errorRecovery?: boolean }): File` |
| <a id="parsecaseargexpr"></a>`parseCaseArgExpr` | fn | case 实参 / 指令类型表达式唯一文法：约束构建器优先，其余为具体字面量、 结构字面量与箭头函数。`T.*` 文法已物理删除。 | `parseCaseArgExpr(expr: string): Abs` |
| <a id="programbody"></a>`programBody` | fn | Top-level statements of a File/Program (empty when neither). | `programBody(ast: Node \| File \| Program \| null \| undefined): Statement[]` |
| <a id="puredirective"></a>`PureDirective` | type | — | `PureDirective = { kind: "pure"; }` |
| <a id="replacedirective"></a>`ReplaceDirective` | type | — | `ReplaceDirective = { kind: "replace"; targetSource: string; typeAbs: Abs; }` |
| <a id="sampledirective"></a>`SampleDirective` | type | — | `SampleDirective = { kind: "sample"; count: number; }` |
| <a id="sinonexpression"></a>`SinonExpression` | type | — | `SinonExpression = { type: "stub" \| "spy" \| "mock"; returnValue?: Abs; resolvedValue?: Abs; rejectedValue?: Abs; }` |
| <a id="skipdirective"></a>`SkipDirective` | type | — | `SkipDirective = { kind: "skip"; returns?: Abs; }` |
| <a id="striptypes"></a>`stripTypes` | const | — | — |
| <a id="unwrapdefaultexport"></a>`unwrapDefaultExport` | fn | CJS/ESM default interop: callable module or `{ default }` wrapper. | `unwrapDefaultExport<T>(mod: T \| { default: T }): T` |
| <a id="unwrapexport"></a>`unwrapExport` | fn | Unwrap an export form: named/default exports yield their inner declaration with `exported: true`; any other statement is returned as-is with `exported: false`. | `unwrapExport(node: Node \| null \| undefined)` |
<!-- NUDO-API-SKELETON:END -->
