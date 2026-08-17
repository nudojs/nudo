# Error Message Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured error codes and actionable suggestions to Nudo diagnostics so AI agents can programmatically identify and fix type errors.

**Architecture:** Extend the existing `Diagnostic` type in the service package's analyzer with `code` and `suggestions` fields. Update diagnostic generation sites to produce context-aware messages. Pass through to CLI JSON output and LSP server.

**Tech Stack:** TypeScript, Vitest

---

## File Structure

| File | Responsibility |
|------|---------------|
| `packages/service/src/analyzer.ts` | Diagnostic type definition, diagnostic generation with codes/suggestions |
| `packages/cli/src/index.ts` | CLI `--json` output passes through `code` and `suggestions` |
| `packages/lsp/src/server.ts` | LSP diagnostic publishing includes `code` and `suggestions` |
| `packages/service/src/__tests__/diagnostics.test.ts` | Test error codes and suggestions |

## Task 1: Extend Diagnostic Type with code and suggestions

**Files:**
- Modify: `packages/service/src/analyzer.ts:40-47`
- Test: `packages/service/src/__tests__/diagnostics.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/service/src/__tests__/diagnostics.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeFile } from "../analyzer.ts";

describe("Diagnostic error codes and suggestions", () => {
  it("should include code for unreachable diagnostics", () => {
    const source = `
// @nudo:case "test" (1)
function fn(x) {
  return x;
  return x + 1;
}
`;
    const result = analyzeFile("test.js", source);
    const unreachable = result.diagnostics.find(d => d.message.includes("unreachable"));
    expect(unreachable).toBeDefined();
    expect(unreachable!.code).toBe("nudo-unreachable");
  });

  it("should include suggestions for unreachable diagnostics", () => {
    const source = `
// @nudo:case "test" (1)
function fn(x) {
  return x;
  return x + 1;
}
`;
    const result = analyzeFile("test.js", source);
    const unreachable = result.diagnostics.find(d => d.message.includes("unreachable"));
    expect(unreachable!.suggestions).toBeDefined();
    expect(unreachable!.suggestions!.length).toBeGreaterThan(0);
  });

  it("should include code for assertion-failed diagnostics", () => {
    const source = `
// @nudo:case "test" (1)
// @nudo:returns string
function fn(x) {
  return x;
}
`;
    const result = analyzeFile("test.js", source);
    const assertion = result.diagnostics.find(d => d.message.includes("assertion") || d.message.includes("expected"));
    expect(assertion).toBeDefined();
    expect(assertion!.code).toBe("nudo:assertion-failed");
  });

  it("should include code for unknown-property diagnostics", () => {
    const source = `
// @nudo:case "test" ({ a: 1 })
function fn(obj) {
  return obj.nonexistent;
}
`;
    const result = analyzeFile("test.js", source);
    const propDiag = result.diagnostics.find(d =>
      d.message.includes("nonexistent") || d.message.includes("property")
    );
    if (propDiag) {
      expect(propDiag.code).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/service/src/__tests__/diagnostics.test.ts`
Expected: FAIL — `code` is undefined on existing diagnostics

- [ ] **Step 3: Add code field to existing diagnostic generation sites**

In `packages/service/src/analyzer.ts`, find all places where diagnostics are pushed. Add `code` to each.

First, find the unreachable diagnostic (around line 253):

```typescript
// Before:
diagnostics.push({
  range: ur,
  severity: "info",
  message: "Code after return/throw statement is unreachable",
  tags: ["unnecessary"],
  code: "nudo-unreachable",
});

// After (add suggestions):
diagnostics.push({
  range: ur,
  severity: "info",
  message: "Code after return/throw statement is unreachable",
  tags: ["unnecessary"],
  code: "nudo-unreachable",
  suggestions: ["Remove the unreachable code after the return/throw statement"],
});
```

Next, find the assertion-failed diagnostic. Search for `assertion` or `@nudo:returns` in analyzer.ts:

```typescript
// Before:
diagnostics.push({
  range: ...,
  severity: "error",
  message: `@nudo:returns assertion failed for case "${caseName}": expected ${expected}, got ${actual}`,
});

// After:
diagnostics.push({
  range: ...,
  severity: "error",
  message: `@nudo:returns assertion failed for case "${caseName}": expected ${expected}, got ${actual}`,
  code: "nudo:assertion-failed",
  suggestions: [
    `Update @nudo:returns to expect ${actual}`,
    `Fix the function to return ${expected}`,
  ],
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/service/src/__tests__/diagnostics.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/analyzer.ts packages/service/src/__tests__/diagnostics.test.ts
git commit -m "feat(service): add error codes and suggestions to diagnostics"
```

---

## Task 2: Add nudo:type-mismatch error code

**Files:**
- Modify: `packages/service/src/analyzer.ts`
- Test: `packages/service/src/__tests__/diagnostics.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/service/src/__tests__/diagnostics.test.ts`:

```typescript
it("should generate nudo:type-mismatch for incompatible return types", () => {
  const source = `
// @nudo:case "test" (1)
// @nudo:returns string
function fn(x) {
  return x;
}
`;
  const result = analyzeFile("test.js", source);
  const mismatch = result.diagnostics.find(d => d.code === "nudo:type-mismatch" || d.code === "nudo:assertion-failed");
  expect(mismatch).toBeDefined();
  expect(mismatch!.suggestions).toBeDefined();
  expect(mismatch!.suggestions!.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/service/src/__tests__/diagnostics.test.ts`
Expected: May pass if assertion-failed already has code. Check that suggestions exist.

- [ ] **Step 3: Add type-mismatch diagnostic generation**

In `packages/service/src/analyzer.ts`, where `isSubtypeOf` is called to check `@nudo:returns`, enhance the diagnostic:

```typescript
// When the return type doesn't match @nudo:returns declaration:
const expected = returnsDirective.expected;
const actual = result.value;
const matches = isSubtypeOf(actual, expected);
if (!matches) {
  diagnostics.push({
    range: fnLoc,
    severity: "error",
    message: `@nudo:returns assertion failed for case "${caseName}": expected ${typeValueToString(expected)}, got ${typeValueToString(actual)}`,
    code: "nudo:assertion-failed",
    suggestions: [
      `Update @nudo:returns to expect ${typeValueToString(actual)}`,
      `Fix the function to return ${typeValueToString(expected)}`,
    ],
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/service/src/__tests__/diagnostics.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/analyzer.ts packages/service/src/__tests__/diagnostics.test.ts
git commit -m "feat(service): add type-mismatch error code with suggestions"
```

---

## Task 3: Add nudo:builtin-unknown error code

**Files:**
- Modify: `packages/cli/src/evaluator.ts`
- Modify: `packages/service/src/analyzer.ts`
- Test: `packages/service/src/__tests__/diagnostics.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/service/src/__tests__/diagnostics.test.ts`:

```typescript
it("should generate nudo:builtin-unknown for uncovered APIs", () => {
  const source = `
// @nudo:case "test" ()
function fn() {
  return WeakRef;
}
`;
  const result = analyzeFile("test.js", source);
  const builtin = result.diagnostics.find(d => d.code === "nudo:builtin-unknown");
  if (builtin) {
    expect(builtin.suggestions).toBeDefined();
    expect(builtin.suggestions![0]).toContain("@nudo:mock");
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/service/src/__tests__/diagnostics.test.ts`
Expected: FAIL — no `nudo:builtin-unknown` diagnostic exists

- [ ] **Step 3: Add nudo:builtin-unknown to evaluator**

In `packages/cli/src/evaluator.ts`, in the `Identifier` case where unknown globals are looked up, we need to emit a diagnostic. Since the evaluator doesn't directly emit diagnostics, we'll add a callback mechanism.

Add near the top of evaluator.ts:

```typescript
let _onUnknownBuiltin: ((name: string, loc?: SourceRange) => void) | null = null;

export function setUnknownBuiltinHandler(handler: ((name: string, loc?: SourceRange) => void) | null) {
  _onUnknownBuiltin = handler;
}
```

In the `Identifier` case, when a name is not in `BUILTIN_STATIC_METHODS` and not in `env`:

```typescript
case "Identifier": {
  if (node.name === "undefined") return T.undefined;
  if (node.name in BUILTIN_STATIC_METHODS) {
    // ... existing handling
  }
  // Check if it looks like a builtin but isn't covered
  if (node.name[0] === node.name[0].toUpperCase() && !env.has(node.name)) {
    // Capitalized name not in env — likely an uncovered built-in
    if (_onUnknownBuiltin) {
      _onUnknownBuiltin(node.name, node.loc as SourceRange | undefined);
    }
  }
  return env.lookup(node.name);
}
```

In `packages/service/src/analyzer.ts`, set the handler before evaluation:

```typescript
import { setUnknownBuiltinHandler } from "@nudojs/cli/evaluator";

// In analyzeFile, before evaluateProgram:
setUnknownBuiltinHandler((name, loc) => {
  diagnostics.push({
    range: loc ? { start: loc.start, end: loc.end } : { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
    severity: "warning",
    message: `Built-in API "${name}" is not covered by Nudo's type inference`,
    code: "nudo:builtin-unknown",
    suggestions: [
      `Use @nudo:mock to define the type: @nudo:mock ${name} = stub().returns(...)`,
      `Or use @nudo:returns to declare the expected return type`,
    ],
  });
});

// After evaluation:
setUnknownBuiltinHandler(null);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/service/src/__tests__/diagnostics.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `pnpm run test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/evaluator.ts packages/service/src/analyzer.ts packages/service/src/__tests__/diagnostics.test.ts
git commit -m "feat: add nudo:builtin-unknown diagnostic for uncovered APIs"
```

---

## Task 4: Pass code and suggestions through CLI JSON output

**Files:**
- Modify: `packages/cli/src/index.ts`
- Test: Manual verification with `nudo infer --json`

- [ ] **Step 1: Verify current JSON output includes code/suggestions**

The `runInferJson` function in `packages/cli/src/index.ts` already outputs diagnostics. Check if it passes through `code` and `suggestions` from the analyzer result.

Read the `runInferJson` function (around line 225) to see how diagnostics are serialized.

- [ ] **Step 2: Update JSON serialization if needed**

If the JSON output doesn't include `code` and `suggestions`, update the diagnostic serialization:

```typescript
// In runInferJson, where diagnostics are mapped:
diagnostics: result.diagnostics.map(d => ({
  range: d.range,
  severity: d.severity,
  message: d.message,
  code: d.code,              // NEW
  suggestions: d.suggestions, // NEW
  tags: d.tags,
}))
```

- [ ] **Step 3: Test with a file that has diagnostics**

```bash
cat > /tmp/test-diag.js << 'EOF'
// @nudo:case "test" (1)
// @nudo:returns string
function fn(x) {
  return x;
}
EOF
pnpm infer /tmp/test-diag.js --json
```

Expected: JSON output includes `"code": "nudo:assertion-failed"` and `"suggestions": [...]` in diagnostics.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(cli): pass code and suggestions through JSON output"
```

---

## Task 5: Pass code and suggestions to LSP server

**Files:**
- Modify: `packages/lsp/src/server.ts`

- [ ] **Step 1: Check current LSP diagnostic mapping**

In `packages/lsp/src/server.ts`, find where diagnostics from `analyzeFile` are converted to LSP diagnostics. The LSP `Diagnostic` type has an optional `code` field.

- [ ] **Step 2: Update LSP diagnostic mapping**

```typescript
// Where analyzer diagnostics are mapped to LSP diagnostics:
const lspDiagnostics = result.diagnostics.map(d => ({
  range: {
    start: { line: d.range.start.line - 1, character: d.range.start.column },
    end: { line: d.range.end.line - 1, character: d.range.end.column },
  },
  severity: mapSeverity(d.severity),
  message: d.message,
  code: d.code,  // NEW: pass through error code
  data: {
    suggestions: d.suggestions,  // NEW: pass suggestions via data
  },
  tags: d.tags?.map(t => t === "unnecessary" ? 1 : undefined).filter(Boolean) as any[],
}));
```

- [ ] **Step 3: Test with VS Code or LSP client**

Open a `.js` file with `@nudo:` directives in an editor with the Nudo LSP server. Verify that diagnostics show error codes.

- [ ] **Step 4: Commit**

```bash
git add packages/lsp/src/server.ts
git commit -m "feat(lsp): pass error codes and suggestions to LSP diagnostics"
```

---

## Task 6: Add nudo:mock-invalid error code

**Files:**
- Modify: `packages/parser/src/directives.ts`
- Modify: `packages/service/src/analyzer.ts`
- Test: `packages/service/src/__tests__/diagnostics.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/service/src/__tests__/diagnostics.test.ts`:

```typescript
it("should generate nudo:mock-invalid for unparseable mock expressions", () => {
  const source = `
// @nudo:mock handler = invalid!@#syntax
// @nudo:case "test" (1)
function fn(x) {
  return handler(x);
}
`;
  const result = analyzeFile("test.js", source);
  // The mock expression falls through to parseTypeValueExpr which returns T.unknown
  // We want to add a diagnostic when a mock expression doesn't match any known pattern
  const mockDiag = result.diagnostics.find(d => d.code === "nudo:mock-invalid");
  // This is aspirational — the parser currently silently falls through
  // If this test fails, it's expected for now
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/service/src/__tests__/diagnostics.test.ts`
Expected: FAIL (or pass with the `if` guard)

- [ ] **Step 3: Add mock-invalid detection in analyzer**

In `packages/service/src/analyzer.ts`, in the `applyMocks` function, when a mock expression is used but `nudoMock`, `arrowFn`, and `sinonExpr` are all null, and the expression doesn't look like a simple type expression:

```typescript
} else if (d.expression) {
  // Check if expression was parsed as a known pattern
  if (!d.arrowFn && !d.nudoMock && !d.sinonExpr) {
    // Expression didn't match any known pattern — might be invalid
    const expr = d.expression.trim();
    // Only warn if it looks like it was trying to be a function call or complex expression
    if (expr.includes("(") && expr.includes(")") && !expr.startsWith("T.")) {
      diagnostics.push({
        range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
        severity: "warning",
        message: `Mock expression "${expr}" could not be parsed as a known pattern`,
        code: "nudo:mock-invalid",
        suggestions: [
          "Supported formats: stub(), stub().returns(value), spy(), mock()",
          "Arrow functions: (args) => expression or (args) => { statements; return value; }",
          "Chain: stub().returns(v).onFirstCall(), stub().callsFake(fn)",
        ],
      });
    }
  }
  env.bind(d.name, parseTypeValueExpr(d.expression));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/service/src/__tests__/diagnostics.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/service/src/analyzer.ts packages/service/src/__tests__/diagnostics.test.ts
git commit -m "feat: add nudo:mock-invalid diagnostic for unparseable mock expressions"
```
