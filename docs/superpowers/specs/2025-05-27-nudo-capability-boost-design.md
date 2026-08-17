# Nudo Capability Boost Design

> A comprehensive roadmap to level up Nudo's type inference precision, editor experience, AI agent integration, and runtime type generation.

## Background

Nudo is a type inference engine for JavaScript powered by abstract interpretation. It executes code with symbolic type values (`T.number`, `T.string`, etc.) instead of concrete values, deriving types from runtime semantics without TypeScript annotations.

### Current Strengths (vs TypeScript)
- Concrete literal evaluation: `"hello".toUpperCase()` returns `T.literal("HELLO")`, not just `string`
- Automatic overload generation from `@nudo:case` analysis
- Abstract interpretation with widening/fixed-point for loops
- Works on plain `.js` files with no build step

### Key Gaps (identified via comparison with TypeScript, Hegel, Flow, Typia, Zod)
- Control flow narrowing is minimal (only `typeof`, `===`, `instanceof`, numeric comparisons)
- Missing modern JS syntax support (optional chaining, generators, private fields)
- LSP only has diagnostics, hover, basic completion
- No runtime type generation (bridge static types to runtime validation)
- No AI agent integration (MCP support)

### Research Sources
- **TypeScript**: Control flow analysis, discriminated unions, template literal types, language service
- **Hegel**: Failed due to single maintainer, performance, incomplete JS coverage — lessons in sustainability
- **Flow**: Exact objects, typed holes, opaque types — declined due to ecosystem effects
- **Typia**: AOT compilation of types to runtime validators — proves demand for static→runtime bridge
- **Zod/ArkType/Valibot**: Runtime type schemas — ecosystem integration matters more than raw performance
- **Sorbet**: Incremental adoption (strictness levels), auto-generated type stubs

---

## Phase 1: Control Flow Narrowing

The biggest UX gap vs TypeScript. Current narrowing only handles `typeof`, `===`/`!==`, `instanceof`, numeric comparisons, and `!expr`. Everyday JS patterns return `unknown`.

### 1.1 Truthiness Narrowing

```js
let x = getValue(); // string | null | undefined
if (x) {
  // x: string (excludes null, undefined, 0, "", false, NaN)
} else {
  // x: null | undefined | 0 | "" | false | NaN
}
```

**Implementation**: In `narrowing.ts`, add truthiness handling. When expr is a union type, use `subtractType` to remove falsy members for the true environment. Also handle `x && y`, `x || y` truthiness propagation.

### 1.2 Optional Chaining (`?.`)

```js
let result = obj?.foo;
// If obj is {foo: string} | undefined, result is string | undefined
```

**Implementation**: Add `OptionalMemberExpression` and `OptionalCallExpression` cases in `evaluator.ts`. If the object type includes `null | undefined`, union the result with `undefined`. For non-nullish members, perform normal member access.

### 1.3 Nullish Coalescing (`??`)

```js
let x = maybeNull ?? fallback;
// If maybeNull is string | null, x is string (right side known non-null)
```

**Implementation**: In `LogicalExpression`'s `??` branch, use `subtractType` to remove null/undefined from the left type. If remaining type is not `never`, use it; otherwise use the right type.

### 1.4 Discriminated Union Narrowing

```js
// shape: {kind: "circle", radius: number} | {kind: "rect", w: number, h: number}
if (shape.kind === "circle") {
  shape.radius; // number — narrowed to circle member
}
```

**Implementation**: In `narrow`, handle `MemberExpression === literal` on object unions. Filter union members where the property value matches the literal. Requires extending `narrowType` to filter by property values.

### 1.5 `in` Operator Narrowing

```js
if ("value" in node) {
  node.value; // narrowed to types that have a `value` property
}
```

**Implementation**: In `narrow`, add `BinaryExpression` with `in` operator. When left is a string literal and right is an object union, filter members containing that property.

### 1.6 Switch Statement Narrowing

```js
switch (shape.kind) {
  case "circle": return shape.radius; // narrowed to circle
  case "rect": return shape.w;        // narrowed to rect
}
```

**Implementation**: In evaluator's `SwitchStatement`, narrow the discriminant for each case. Execute each case consequent in the narrowed environment.

### 1.7 `Array.isArray()` Narrowing

```js
if (Array.isArray(x)) {
  x; // narrowed to array type
} else {
  x; // array types excluded
}
```

**Implementation**: In `narrow`, detect `Array.isArray(expr)` pattern. True environment filters to array types, false environment excludes them.

### Architecture Impact
- `packages/cli/src/narrowing.ts` — add truthiness, `in`, Array.isArray, discriminated union narrowing
- `packages/cli/src/evaluator.ts` — modify `OptionalMemberExpression`, `LogicalExpression ??`, `SwitchStatement`
- No changes to `core` TypeValue structure — all narrowing uses existing `narrowType`/`subtractType`

---

## Phase 2: Enhanced LSP Editor Experience

Current LSP has diagnostics, hover, completion (only `.` trigger), and codeLens. Missing the features that make an editor feel "smart".

### 2.1 Go-to-Definition

Let users jump to function/variable definitions.

**Implementation**: Maintain a `DefinitionMap: Map<string, {uri, range}>` during evaluation. Map symbol names to source locations when processing `FunctionDeclaration`, `VariableDeclaration`, `ClassDeclaration`. LSP handler looks up the map on `textDocument/definition`.

### 2.2 Find References

Find all usages of a symbol across files.

**Implementation**: Build a `ReferenceMap: Map<string, Array<{uri, range}>>` during analysis. Collect all `Identifier` node reference locations. Leverage `service` package's file traversal for cross-file analysis.

### 2.3 Rename

Safely rename symbols, updating all references.

**Implementation**: Based on find references. On `textDocument/rename`, find all reference locations, generate `WorkspaceEdit`. Validate new name doesn't conflict with existing symbols.

### 2.4 Code Actions / Quick Fixes

Provide automated fixes when Nudo reports diagnostics.

**Priority actions:**
- **Add `@nudo:case` directive**: Auto-generate a case based on parameter types when function lacks one
- **Add missing property**: Suggest adding when accessing non-existent property on an object
- **Type guard suggestion**: Suggest adding a type guard when type doesn't match

**Implementation**: Carry `code` and `data` in diagnostics. On `textDocument/codeAction`, return `CodeAction` with `WorkspaceEdit` based on diagnostic code.

### 2.5 Semantic Tokens

Syntax highlighting based on inferred types.

**Priority highlights:**
- Functions vs variables (different token types)
- Dead code (unreachable code after return/throw)
- Inferred types vs explicit annotations

**Implementation**: Generate `SemanticToken[]` after analysis with line, col, length, type, modifiers. Reuse existing dead code detection (`BranchSignal`/`ReturnSignal` ranges). Encode for `textDocument/semanticTokens/full`.

### 2.6 Signature Help

Show function parameter hints inside call parentheses.

**Implementation**: When cursor is inside a `CallExpression`, look up the called function's type. Extract parameter names and types from `FunctionType`. Highlight current parameter index by counting commas.

### Architecture Impact
- `packages/lsp/src/server.ts` — register new LSP handlers
- `packages/lsp/src/symbols.ts` (new) — symbol table and reference collection
- `packages/lsp/src/semantic-tokens.ts` (new) — semantic token encoding
- `packages/service/src/analyzer.ts` — include symbol location info in analysis results

Estimated: ~500-800 new lines across lsp and service packages.

---

## Phase 2.5: AI Agent Integration (MCP)

AI coding agents (Claude Code, Cursor, Copilot) lack type context when writing JavaScript. Nudo can be their type awareness layer via Model Context Protocol.

### 2.5.1 `nudo/what-if` — Hypothetical Type Analysis

The core feature. AI sets type assumptions, observes how types flow.

```
AI: "If x is number at line 5, what's result at line 12?"
Nudo: Evaluates with x: number → result is string
AI: "What if x is string?"
Nudo: result is number
```

**Why this is valuable for AI:**
- Type hypothesis testing without writing code
- Understanding type flow through intermediate steps
- Comparing behavior under different input types
- Binary-search debugging of type errors

**This is an interactive version of `@nudo:case`** — Nudo already has the core capability (symbolic execution with user-provided type bindings).

**MCP Tool:**
```typescript
{
  file: string,           // file path
  bindings: Array<{       // type assumptions
    name: string,         // variable name or expression like "obj.foo"
    type: TypeValueJson,  // e.g., "number", "string | null", "{kind: 'a', value: number}"
  }>,
  target: string,         // target variable or expression
  position?: number,      // optional: target line number
}
// Returns: { type: TypeValueJson, chain?: string[] }  // chain is the type derivation path
```

### 2.5.2 `nudo/trace` — Type Derivation Tracing

Trace how a type transforms from input to output.

```
AI: "How does the input type of `data` become the return type?"
Nudo: "data (unknown) → data.name (string via property access) →
       Number(data.age) (number via Number() call) →
       {name: string, age: number} (object literal)"
```

**Implementation**: Add logging in evaluator to record each type transformation step. Expose as MCP tool.

### 2.5.3 `nudo/suggest-case` — Auto-generate `@nudo:case`

Analyze a function and suggest appropriate `@nudo:case` directives based on parameter types and usage patterns.

### 2.5.4 `nudo/check` — Check File for Errors

Run inference and return diagnostics as structured JSON.

### 2.5.5 `nudo/type-at` — Get Type at Position

Get the inferred type of an expression at a specific position.

### Architecture Impact
- `packages/mcp` (new) — MCP server using `@modelcontextprotocol/sdk`
- Reuse `service` package's `analyze` function and `cli` package's evaluator
- Evaluator needs support for "start from middle" execution — via checkpoint/restore environment
- Derivation chain tracking requires logging additions in evaluator

---

## Phase 3: Runtime Type Generation

Bridge the gap between Nudo's inferred types and runtime validation. Complete the loop:

```
JS code → Nudo infers types → Generate validators → Runtime data validation
```

### 3.1 Zod Schema Generation (Ecosystem Integration)

```js
// Input: utils.js
/** @nudo:case */
function parseUser(data) { return { name: data.name, age: Number(data.age) } }

// Output: utils.nudo.zod.ts
import { z } from "zod";
export const parseUserInput = z.object({ name: z.string(), age: z.unknown() });
export const parseUserOutput = z.object({ name: z.string(), age: z.number() });
```

**Value**: Seamless integration with React Hook Form, tRPC, Next.js ecosystem.

### 3.2 Native Runtime Validator (Best Performance)

```js
// Output: utils.nudo.guard.ts
export function validateParseUserInput(data) {
  if (typeof data !== "object" || data === null) return false;
  if (typeof data.name !== "string") return false;
  return true;
}
```

**Value**: Zero dependencies, Typia-like AOT compilation, far faster than schema interpreters.

### 3.3 TypeScript Type Guards

```js
// Output: utils.nudo.guard.ts
export function isParseUserOutput(data: unknown): data is { name: string; age: number } {
  // ... validation logic
}
```

**Value**: Integration with TypeScript projects, provides `is` type guards.

### Implementation

**Generator architecture:**
```
TypeValue → SchemaGenerator → Zod schema string
          → GuardGenerator → Native validator string
          → DtsGenerator   → .d.ts file (existing, enhanced)
```

- `packages/service/src/schema-generator.ts` (new, ~200-300 lines) — Zod schema generation
- `packages/service/src/guard-generator.ts` (new, ~200-300 lines) — Native validator generation
- `packages/service/src/dts-generator.ts` (enhanced) — Fix param names, return types, JSDoc

**CLI integration:**
```bash
nudo generate --format zod src/utils.js      # Generate Zod schemas
nudo generate --format guard src/utils.js    # Generate native validators
nudo generate --format dts src/utils.js      # Generate .d.ts (existing, enhanced)
nudo generate --format all src/utils.js      # Generate all formats
```

**Vite plugin integration:**
Add options in `packages/vite-plugin` to auto-generate validator files during build.

### Architecture Impact
- `packages/service/src/schema-generator.ts` (new)
- `packages/service/src/guard-generator.ts` (new)
- `packages/service/src/dts-generator.ts` (enhanced)
- `packages/cli/src/index.ts` — add `nudo generate` subcommand
- `packages/vite-plugin/src/index.ts` — add generation options

---

## Phase Dependencies

```
Phase 1 (Narrowing) ──→ Phase 2 (LSP) ──→ Phase 2.5 (MCP)
                         Phase 2 also ──→ Phase 3 (Runtime Generation)
```

- Phase 1 improves type precision, which feeds into all downstream features
- Phase 2 (LSP) and Phase 3 (Runtime Gen) can proceed in parallel after Phase 1
- Phase 2.5 (MCP) depends on Phase 2's symbol table infrastructure
- Phase 3 is independent of Phase 2 and 2.5

## Success Metrics

- **Phase 1**: Nudo correctly narrows types for all 7 new patterns. Test coverage for each pattern.
- **Phase 2**: All 6 LSP features working in VS Code extension. Integration tests pass.
- **Phase 2.5**: MCP server responds to all 5 tools. AI agent can perform what-if analysis.
- **Phase 3**: Generated Zod schemas validate correctly. Native validators pass property-based tests. DTS output uses real param names.
