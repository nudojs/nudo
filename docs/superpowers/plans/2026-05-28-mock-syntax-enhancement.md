# Mock Syntax Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Nudo's mock syntax to support chain calls (`stub().returns().onFirstCall()`), `withArgs`, `callsFake`, and `spy().returns()`.

**Architecture:** Extend `parseNudoMockExpr` in the parser with new regex branches. Add optional fields to `MockHelper` type. Update `mockHelperToTypeValue` in core to handle new fields.

**Tech Stack:** TypeScript, Babel parser, Vitest

---

## File Structure

| File | Responsibility |
|------|---------------|
| `packages/core/src/mock-helpers.ts` | `MockHelper` type with new optional fields, `mockHelperToTypeValue` updated |
| `packages/parser/src/directives.ts` | `parseNudoMockExpr` with new regex branches |
| `packages/cli/src/__tests__/nudo-mock-syntax.test.ts` | Test new chain patterns |

## Task 1: Extend MockHelper type with chain fields

**Files:**
- Modify: `packages/core/src/mock-helpers.ts`
- Test: `packages/cli/src/__tests__/mock-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/cli/src/__tests__/mock-helpers.test.ts`:

```typescript
it("stub().returns().onFirstCall() should store onFirstCall value", () => {
  const env = createEnvironment();
  const helper = stub.returns(T.number);
  // After extending MockHelper, onFirstCall should be settable
  expect(helper.returnValue).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/cli/src/__tests__/mock-helpers.test.ts`
Expected: PASS (this test already passes — we're checking baseline)

- [ ] **Step 3: Extend MockHelper type**

In `packages/core/src/mock-helpers.ts`:

```typescript
export type MockHelper = {
  kind: "mock-helper";
  returnValue?: TypeValue;
  resolvedValue?: TypeValue;
  rejectedValue?: TypeValue;
  implementation?: (...args: TypeValue[]) => TypeValue;
  // NEW: chain call fields
  onFirstCallValue?: TypeValue;
  onSecondCallValue?: TypeValue;
  onCallValues?: Map<number, TypeValue>;
  withArgsCases?: { args: TypeValue[]; returnValue: TypeValue }[];
  callsFakeImpl?: TypeValue; // function TypeValue
};
```

- [ ] **Step 4: Add chain methods to stub**

```typescript
stub.onFirstCall = function(value: TypeValue): MockHelper {
  return { kind: "mock-helper", onFirstCallValue: value };
};

stub.onSecondCall = function(value: TypeValue): MockHelper {
  return { kind: "mock-helper", onSecondCallValue: value };
};

stub.withArgs = function(...args: TypeValue[]): MockHelper {
  return { kind: "mock-helper", withArgsCases: [{ args, returnValue: T.unknown }] };
};

stub.callsFake = function(fn: TypeValue): MockHelper {
  return { kind: "mock-helper", callsFakeImpl: fn };
};
```

Also add `returns` method to `spy`:

```typescript
spy.returns = function(value: TypeValue): MockHelper {
  return { kind: "mock-helper", returnValue: value };
};
```

- [ ] **Step 5: Update mockHelperToTypeValue for chain fields**

```typescript
export function mockHelperToTypeValue(helper: MockHelper, env: Environment): TypeValue {
  const body = { type: "BlockStatement", body: [] } as any;
  const fn = T.fn(["...args"], body, env);

  // Priority: callsFake > resolvedValue/rejectedValue > returnValue > onFirstCallValue > unknown
  if (helper.callsFakeImpl) {
    (fn as any)._directReturn = helper.callsFakeImpl;
  } else if (helper.resolvedValue) {
    (fn as any)._directReturn = T.promise(helper.resolvedValue);
  } else if (helper.rejectedValue) {
    (fn as any)._directReturn = T.never;
  } else if (helper.returnValue) {
    (fn as any)._directReturn = helper.returnValue;
  } else if (helper.onFirstCallValue) {
    // Abstract interpretation doesn't track call counts, use onFirstCallValue as default
    (fn as any)._directReturn = helper.onFirstCallValue;
  } else {
    (fn as any)._directReturn = T.unknown;
  }

  return fn;
}
```

- [ ] **Step 6: Run tests to verify**

Run: `pnpm vitest run packages/cli/src/__tests__/mock-helpers.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/mock-helpers.ts
git commit -m "feat(core): extend MockHelper type with chain call fields"
```

---

## Task 2: Add chain call parsing to parseNudoMockExpr

**Files:**
- Modify: `packages/parser/src/directives.ts`
- Test: `packages/cli/src/__tests__/nudo-mock-syntax.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/cli/src/__tests__/nudo-mock-syntax.test.ts`:

```typescript
describe("Chain call syntax", () => {
  it("stub().returns(v).onFirstCall() should parse", () => {
    const results = runNudoTest(`
// @nudo:mock handler = stub().returns(42).onFirstCall()
// @nudo:case "test" ()
function fn() {
  return handler();
}
`);
    // Abstract interpretation uses the first .returns() value
    expect(results[0].result).toBe("42");
  });

  it("stub().callsFake((x) => x * 2) should parse", () => {
    const results = runNudoTest(`
// @nudo:mock transform = stub().callsFake((x) => x * 2)
// @nudo:case "test" (21)
function fn(x) {
  return transform(x);
}
`);
    expect(results[0].result).toBe("42");
  });

  it("spy().returns(v) should parse", () => {
    const results = runNudoTest(`
// @nudo:mock listener = spy().returns({ handled: true })
// @nudo:case "test" ()
function fn() {
  return listener();
}
`);
    expect(results[0].result).toContain("handled: true");
  });

  it("stub().withArgs(a, b).returns(v) should parse", () => {
    const results = runNudoTest(`
// @nudo:mock fetch = stub().withArgs("GET", "/api").returns({ status: 200 })
// @nudo:case "test" ()
function fn() {
  return fetch("GET", "/api");
}
`);
    expect(results[0].result).toContain("status: 200");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/cli/src/__tests__/nudo-mock-syntax.test.ts`
Expected: FAIL — new patterns not parsed

- [ ] **Step 3: Extend parseNudoMockExpr with chain patterns**

In `packages/parser/src/directives.ts`, add new regex branches in `parseNudoMockExpr`:

```typescript
function parseNudoMockExpr(expr: string): MockHelper | null {
  const s = expr.trim();

  // Match stub().returns(value).onFirstCall()
  const stubReturnsOnFirstMatch = s.match(/^stub\(\)\.returns\((.+)\)\.onFirstCall\(\)$/);
  if (stubReturnsOnFirstMatch) {
    const helper = stub.returns(parseTypeValueExpr(stubReturnsOnFirstMatch[1].trim()));
    helper.onFirstCallValue = helper.returnValue; // same value for abstract interpretation
    return helper;
  }

  // Match stub().returns(value).onSecondCall()
  const stubReturnsOnSecondMatch = s.match(/^stub\(\)\.returns\((.+)\)\.onSecondCall\(\)$/);
  if (stubReturnsOnSecondMatch) {
    return stub.returns(parseTypeValueExpr(stubReturnsOnSecondMatch[1].trim()));
  }

  // Match stub().returns(value).onCall(n)
  const stubReturnsOnCallMatch = s.match(/^stub\(\)\.returns\((.+)\)\.onCall\(\d+\)$/);
  if (stubReturnsOnCallMatch) {
    return stub.returns(parseTypeValueExpr(stubReturnsOnCallMatch[1].trim()));
  }

  // Match stub().callsFake((args) => body)
  const stubCallsFakeMatch = s.match(/^stub\(\)\.callsFake\((.+)\)$/);
  if (stubCallsFakeMatch) {
    const arrowFn = parseArrowFunctionExpr(stubCallsFakeMatch[1].trim());
    if (arrowFn) {
      const helper: MockHelper = { kind: "mock-helper" };
      helper.callsFakeImpl = T.fn(arrowFn.params, arrowFn.body, createEnvironment());
      return helper;
    }
    return stub(); // fallback
  }

  // Match stub().withArgs(args).returns(value)
  const stubWithArgsMatch = s.match(/^stub\(\)\.withArgs\((.+)\)\.returns\((.+)\)$/);
  if (stubWithArgsMatch) {
    const argsStr = stubWithArgsMatch[1].trim();
    const retVal = parseTypeValueExpr(stubWithArgsMatch[2].trim());
    const args = splitTopLevelArgs(argsStr).map(parseTypeValueExpr);
    const helper: MockHelper = { kind: "mock-helper", returnValue: retVal };
    helper.withArgsCases = [{ args, returnValue: retVal }];
    return helper;
  }

  // Match spy().returns(value)
  const spyReturnsMatch = s.match(/^spy\(\)\.returns\((.+)\)$/);
  if (spyReturnsMatch) {
    return spy.returns(parseTypeValueExpr(spyReturnsMatch[1].trim()));
  }

  // Match stub().resolves(value).onFirstCall()
  const stubResolvesOnFirstMatch = s.match(/^stub\(\)\.resolves\((.+)\)\.onFirstCall\(\)$/);
  if (stubResolvesOnFirstMatch) {
    return stub.resolves(parseTypeValueExpr(stubResolvesOnFirstMatch[1].trim()));
  }

  // ... existing patterns (stub().returns, stub().resolves, stub().rejects, stub(), spy(), mock())
}
```

Note: `splitTopLevelArgs` is already defined in directives.ts. Import `createEnvironment` from `@nudojs/core`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/cli/src/__tests__/nudo-mock-syntax.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/parser/src/directives.ts packages/cli/src/__tests__/nudo-mock-syntax.test.ts
git commit -m "feat(parser): add chain call syntax for mock expressions"
```

---

## Task 3: Update analyzer to handle new MockHelper fields

**Files:**
- Modify: `packages/service/src/analyzer.ts`

- [ ] **Step 1: Verify analyzer handles nudoMock correctly**

The analyzer's `applyMocks` function already calls `mockHelperToTypeValue(d.nudoMock, env)`. Since we updated `mockHelperToTypeValue` in Task 1, the analyzer should automatically benefit.

- [ ] **Step 2: Verify with a test**

Run: `pnpm vitest run packages/cli/src/__tests__/nudo-mock-syntax.test.ts`
Expected: All chain call tests pass

- [ ] **Step 3: Run full test suite**

Run: `pnpm run test`
Expected: All tests pass

- [ ] **Step 4: Commit (if changes needed)**

```bash
git add packages/service/src/analyzer.ts
git commit -m "feat(service): support new mock chain fields in analyzer"
```

---

## Task 4: Add mock parse error messages with supported formats

**Files:**
- Modify: `packages/parser/src/directives.ts`

- [ ] **Step 1: Add export for mock parse error info**

Add a function that returns supported mock formats:

```typescript
export function getMockSupportedFormats(): string[] {
  return [
    "stub() — returns unknown",
    "stub().returns(value) — returns specified value",
    "stub().resolves(value) — returns Promise with value",
    "stub().rejects(value) — returns rejected Promise",
    "stub().returns(v).onFirstCall() — first call returns v",
    "stub().withArgs(a, b).returns(v) — returns v when args match",
    "stub().callsFake((args) => body) — custom implementation",
    "spy() — returns unknown",
    "spy().returns(value) — spy with specified return",
    "mock() — returns unknown",
    "(args) => expression — arrow function mock",
    "(args) => { statements; return value; } — block body arrow function",
  ];
}
```

- [ ] **Step 2: Export from parser index**

In `packages/parser/src/index.ts`:

```typescript
export {
  // ... existing exports
  getMockSupportedFormats,
} from "./directives.ts";
```

- [ ] **Step 3: Use in analyzer mock-invalid diagnostic**

In `packages/service/src/analyzer.ts`, where `nudo:mock-invalid` diagnostic is generated:

```typescript
import { getMockSupportedFormats } from "@nudojs/parser";

// In the mock-invalid diagnostic:
suggestions: [
  "Supported mock formats:",
  ...getMockSupportedFormats().map(f => `  - ${f}`),
],
```

- [ ] **Step 4: Commit**

```bash
git add packages/parser/src/directives.ts packages/parser/src/index.ts packages/service/src/analyzer.ts
git commit -m "feat: add mock supported formats helper for error messages"
```
