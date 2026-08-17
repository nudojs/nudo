# Nudo AI Agent Optimization Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize Nudo's developer experience for AI agents by expanding built-in API coverage, improving diagnostic quality, and enhancing mock syntax.

**Architecture:** Three independent workstreams that can be implemented and shipped separately. Each modifies specific subsystems without cross-dependencies.

**Tech Stack:** TypeScript, Babel parser, Vitest

---

## Workstream 1: Built-in API Coverage

### Problem

Many common JavaScript APIs return `unknown` because the evaluator lacks type definitions for them. This forces agents to write explicit type annotations or accept imprecise inference.

### Scope

**P0 - Daily high-frequency APIs:**

| Class | Methods/Properties | Return Types |
|---|---|---|
| `Promise` | `resolve(v)`, `reject(v)` | `Promise<T>`, `Promise<never>` |
| `Promise` | `all([...])` | `Promise<T[]>` |
| `Promise` | `race([...])` | `Promise<T>` |
| `Promise` | `allSettled([...])` | `Promise<{status, value/reason}[]>` |
| `Promise` | `any([...])` | `Promise<T>` |
| `Promise` | `.then()`, `.catch()`, `.finally()` | instance methods |
| `Map` | `get`, `set`, `has`, `delete`, `clear`, `size` | inferred from generics |
| `Set` | `add`, `has`, `delete`, `clear`, `size`, `values`, `keys` | inferred from generics |
| `RegExp` | `test`, `exec`, `source`, `flags` | `boolean` / `string` / `null` |
| `fetch` | global function | `Promise<Response>` |

**P1 - Common Web APIs:**

| Class | Methods/Properties | Return Types |
|---|---|---|
| `URL` | constructor, `href`, `origin`, `pathname`, `search`, `hash` | `string` |
| `URLSearchParams` | `get`, `set`, `has`, `delete`, `append`, `toString` | `string` / `boolean` |
| `Response` | `json()`, `text()`, `ok`, `status` | `Promise<T>` / `boolean` / `number` |
| `Headers` | `get`, `set`, `has`, `delete` | `string` / `boolean` |
| `FormData` | `get`, `set`, `has`, `append`, `delete` | `string` / `boolean` |
| `AbortController` | `signal`, `abort()` | `AbortSignal` / `void` |

**P2 - Advanced:**

| Class | Methods/Properties |
|---|---|
| `WeakMap` | `get`, `set`, `has`, `delete` |
| `WeakSet` | `add`, `has`, `delete` |
| `Symbol` | `for`, `keyFor`, `iterator`, `asyncIterator` |
| `Reflect` | `get`, `set`, `has`, `delete`, `apply`, `construct` |
| `Intl.DateTimeFormat`, `Intl.NumberFormat` | `format` |

### Implementation

- Each built-in class gets its own file: `packages/cli/src/builtins/builtin-promise.ts`, etc.
- Each file exports a static methods map and an instance methods map.
- The evaluator imports and merges all maps at startup.
- Instance methods that depend on constructor arguments (e.g., `Map<K,V>.get()` returns `V | undefined`) use a `_typeArgs` property on the instance TypeValue to track generic parameters.
- Tests: one test file per built-in class in `packages/cli/src/__tests__/builtin-*.test.ts`.

### Generic Type Tracking

For `Map<K,V>`, `Set<T>`, `Promise<T>`:

- When creating via constructor or literal, store type args on the TypeValue: `(obj as any)._typeArgs = { K: T.string, V: T.number }`
- Instance methods look up `_typeArgs` to determine return types.
- `new Map([["a", 1]])` → evaluate the array argument, infer key/value types from tuple entries. Each entry `[key, value]` contributes its key type to K union and value type to V union.
- `Promise.resolve(42)` → the argument type becomes the Promise's T. Return `T.promise(T.literal(42))`.
- `new Set([1, 2, 3])` → evaluate the array argument, infer T from element types.
- If constructor arguments are missing or empty: `new Map()` → `Map<unknown, unknown>`, `new Set()` → `Set<unknown>`.
- If type args cannot be inferred: fall back to `unknown` for that parameter.

---

## Workstream 2: Error Message Quality

### Problem

Diagnostic messages lack expected/got comparison and actionable suggestions, making it hard for agents to understand and fix type errors.

### Error Codes

Each diagnostic gets a unique error code for precise matching:

| Code | Meaning | Example |
|------|---------|---------|
| `nudo:type-mismatch` | Type mismatch | Function returns `string` but `@nudo:returns` declares `number` |
| `nudo:unknown-property` | Accessing nonexistent property | `obj.nonexistent` |
| `nudo:arg-count` | Wrong argument count | Function expects 2 args, got 3 |
| `nudo:unreachable` | Unreachable code | Already exists |
| `nudo:assertion-failed` | `@nudo:returns` assertion failed | Already exists |
| `nudo:mock-invalid` | Invalid mock expression | Parse failure |
| `nudo:builtin-unknown` | Unknown built-in API | Calling an uncovered method |

### Diagnostic Type Extension

The `Diagnostic` type is defined in `packages/service/src/analyzer.ts`. Add `code` and `suggestions` fields:

```typescript
type Diagnostic = {
  range: SourceLocation;
  severity: "error" | "warning" | "info";
  message: string;
  tags?: DiagnosticTag[];
  code?: string;           // NEW: error code for programmatic matching
  suggestions?: string[];  // NEW: actionable fix suggestions
};
```

### Suggestion Generation

For each error code, generate context-aware suggestions:

- `nudo:type-mismatch`: "Convert with Number(value)" or "Update @nudo:returns to expect string"
- `nudo:unknown-property`: "Did you mean `obj.existingProp`?" or "Add property to mock return value"
- `nudo:arg-count`: "Function expects N arguments, got M"
- `nudo:builtin-unknown`: "This API is not yet covered by Nudo. Use @nudo:mock to define its type."
- `nudo:mock-invalid`: "Check syntax: stub().returns(value) or (args) => expression"

### CLI JSON Enhancement

The `--json` output already exists. Enhance it to include `code` and `suggestions` fields in each diagnostic entry.

### LSP Integration

Pass `code` and `suggestions` through to the LSP server's diagnostic publishing. The LSP code actions can use `suggestions` to offer quickfixes.

---

## Workstream 3: Mock Syntax Enhancement

### Problem

Mock expressions are limited to simple patterns. Complex scenarios require more flexible syntax.

### 3.1 Chain Call Support

Extend `parseNudoMockExpr` in `packages/parser/src/directives.ts` to support:

| Syntax | Meaning |
|--------|---------|
| `stub().returns(v).onFirstCall()` | First call returns v |
| `stub().returns(v).onSecondCall()` | Second call returns v |
| `stub().returns(v).onCall(n)` | Nth call returns v |
| `stub().returns(v1).onFirstCall().returns(v2)` | First returns v2, rest return v1 |
| `stub().withArgs(a, b).returns(v)` | Returns v when args match |
| `stub().callsFake((x) => x * 2)` | Custom implementation |
| `spy().returns(v)` | Spy also supports returns |

**Simplification:** Since abstract interpretation doesn't track call counts, `onFirstCall`/`onSecondCall`/`onCall` are parsed but the first `.returns()` value is used for all calls. Document this limitation.

**`withArgs` matching:** For abstract interpretation, `withArgs` matching is simplified:
- If mock arguments are concrete literals (e.g., `stub().withArgs("GET", "/api").returns(okResponse)`), use the matched return value.
- If mock arguments are abstract types (e.g., `T.string`), always use the `.returns()` value regardless of `withArgs` (since we can't match at the type level).
- If multiple `withArgs` chains exist, use the first match or fall back to the default `.returns()`.

**Implementation:** Add regex branches in `parseNudoMockExpr`. The `MockHelper` type gets optional fields: `onFirstCall?: TypeValue`, `withArgs?: { args: TypeValue[], returnValue: TypeValue }`, `callsFake?: Node`.

### 3.2 Complex Logic Support

Arrow function block bodies are already supported by `parseArrowFunctionExpr`:

```js
// @nudo:mock validate = (x) => {
//   if (typeof x !== "string") return false;
//   return x.length > 0;
// }
```

**Improvement:** Document this capability clearly in error messages when a mock expression fails to parse:

> "Mock expression could not be parsed. Supported formats:
> - Simple: `stub()`, `stub().returns(value)`, `spy()`, `mock()`
> - Arrow function: `(args) => expression` or `(args) => { statements; return value; }`
> - Chain: `stub().returns(v).onFirstCall()`, `stub().callsFake(fn)`"

### 3.3 Mock Type Inference Enhancement

When mock uses `stub().returns(...)`, the return value type is precisely inferred:

```js
// @nudo:mock fetch = stub().returns({ status: 200, data: { ok: true } })
// Returns: { status: 200, data: { ok: true } } -- already works
```

Enhancement: support constructor-based type inference:

```js
// @nudo:mock cache = stub().returns(new Map())
// Should return: Map (currently returns unknown because Map constructor is not handled)
```

This is blocked by Workstream 1 (Map constructor support). Once Map/Set/Promise constructors are supported, mock type inference automatically benefits.

---

## Testing Strategy

- Each built-in class: dedicated test file with `@nudo:case` directives covering all methods
- Error messages: test that each error code is generated with correct suggestions
- Mock syntax: test each new chain pattern in `packages/cli/src/__tests__/nudo-mock-syntax.test.ts`
- Integration: update `examples/real-test/` with comprehensive examples using all new features

## File Structure

```
packages/cli/src/
  builtins/
    builtin-promise.ts
    builtin-map.ts
    builtin-set.ts
    builtin-regexp.ts
    builtin-url.ts
    builtin-web.ts          # Response, Headers, FormData, fetch, AbortController
    builtin-weak.ts         # WeakMap, WeakSet
    builtin-symbol.ts
    builtin-reflect.ts
    builtin-intl.ts
    index.ts                # merge all maps
  evaluator.ts              # import from builtins/index.ts
  __tests__/
    builtin-promise.test.ts
    builtin-map.test.ts
    builtin-set.test.ts
    builtin-regexp.test.ts
    builtin-url.test.ts
    builtin-web.test.ts
    ...

packages/parser/src/
  directives.ts             # extend parseNudoMockExpr

packages/service/src/
  analyzer.ts               # add error codes and suggestions
  diagnostics.ts            # (optional) structured diagnostic helpers
```

## Implementation Order

The three workstreams are independent but should be implemented sequentially to avoid merge conflicts:

1. **Workstream 2 (Error Messages)** — smallest scope, foundational for other work. Adds error codes and suggestions to the analyzer that benefit all subsequent features.
2. **Workstream 3 (Mock Syntax)** — medium scope, parser changes only. Extends mock syntax without touching the evaluator.
3. **Workstream 1 (Built-in APIs)** — largest scope, 9+ new files. Benefits from improved error messages (can report `nudo:builtin-unknown` with suggestions) and enhanced mock syntax (can use new chain patterns in tests).
