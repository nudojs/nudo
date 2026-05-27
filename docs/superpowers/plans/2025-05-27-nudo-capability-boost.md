# Nudo Capability Boost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Level up Nudo's type inference precision, editor experience, AI agent integration, and runtime type generation across 4 phases.

**Architecture:** Phase 1 enhances narrowing in `packages/cli/src/narrowing.ts` and evaluator AST handlers. Phase 2 adds LSP features in `packages/lsp/src/server.ts` with new symbol tracking in `packages/service`. Phase 2.5 creates a new `packages/mcp` package for AI agent integration. Phase 3 adds runtime type generators in `packages/service`.

**Tech Stack:** TypeScript, Vitest, vscode-languageserver, @modelcontextprotocol/sdk, Zod

**Spec:** `docs/superpowers/specs/2025-05-27-nudo-capability-boost-design.md`

---

## File Structure

### New Files
- `packages/cli/src/__tests__/narrowing-truthiness.test.ts` — truthiness narrowing tests
- `packages/cli/src/__tests__/narrowing-optional-chaining.test.ts` — optional chaining tests
- `packages/cli/src/__tests__/narrowing-discriminated.test.ts` — discriminated union tests
- `packages/cli/src/__tests__/narrowing-in-operator.test.ts` — `in` operator tests
- `packages/cli/src/__tests__/narrowing-switch.test.ts` — switch narrowing tests
- `packages/cli/src/__tests__/evaluator-optional-chaining.test.ts` — optional chaining evaluator tests
- `packages/cli/src/__tests__/evaluator-nullish-coalescing.test.ts` — `??` operator tests
- `packages/lsp/src/__tests__/definition.test.ts` — go-to-definition tests
- `packages/lsp/src/__tests__/references.test.ts` — find references tests
- `packages/lsp/src/__tests__/rename.test.ts` — rename tests
- `packages/lsp/src/__tests__/semantic-tokens.test.ts` — semantic tokens tests
- `packages/lsp/src/symbols.ts` — symbol table and reference collection
- `packages/lsp/src/semantic-tokens.ts` — semantic token encoding
- `packages/mcp/package.json` — MCP server package
- `packages/mcp/tsconfig.json` — TypeScript config
- `packages/mcp/src/index.ts` — MCP server entry
- `packages/mcp/src/tools.ts` — MCP tool definitions
- `packages/mcp/src/__tests__/what-if.test.ts` — what-if tool tests
- `packages/service/src/schema-generator.ts` — Zod schema generator
- `packages/service/src/guard-generator.ts` — native validator generator
- `packages/service/src/__tests__/schema-generator.test.ts` — schema generator tests
- `packages/service/src/__tests__/guard-generator.test.ts` — guard generator tests

### Modified Files
- `packages/cli/src/narrowing.ts` — add truthiness, `in`, Array.isArray, discriminated union narrowing
- `packages/cli/src/evaluator.ts` — add OptionalMemberExpression, OptionalCallExpression, fix LogicalExpression `??`, fix SwitchStatement narrowing
- `packages/lsp/src/server.ts` — register definition, references, rename, semantic tokens handlers
- `packages/service/src/analyzer.ts` — add symbol location tracking, `analyzeWithBindings` for what-if
- `packages/service/src/dts-generator.ts` — fix param names, return types, JSDoc
- `packages/service/src/index.ts` — export new generators
- `packages/cli/src/index.ts` — add `nudo generate` subcommand, `--json` flag
- `packages/vite-plugin/src/index.ts` — add generation options
- `package.json` — add mcp workspace
- `pnpm-workspace.yaml` — add mcp package

---

## Phase 1: Control Flow Narrowing

### Task 1: Truthiness Narrowing

**Files:**
- Create: `packages/cli/src/__tests__/narrowing-truthiness.test.ts`
- Modify: `packages/cli/src/narrowing.ts`

- [ ] **Step 1: Write failing tests for truthiness narrowing**

```typescript
// packages/cli/src/__tests__/narrowing-truthiness.test.ts
import { describe, it, expect } from "vitest";
import { T, typeValueEquals, typeValueToString, createEnvironment } from "@nudojs/core";
import { parse } from "@nudojs/parser";
import { narrow } from "../narrowing.ts";
import type { ExpressionStatement } from "@babel/types";

function getTestExpr(source: string) {
  const ast = parse(source);
  const stmt = ast.program.body[0] as ExpressionStatement;
  return stmt.expression;
}

describe("narrow: truthiness", () => {
  it("narrows if(x) to exclude null and undefined", () => {
    const env = createEnvironment();
    env.bind("x", T.union(T.string, T.null, T.undefined));
    const expr = getTestExpr("x");
    const [trueEnv, falseEnv] = narrow(expr, env);
    expect(typeValueEquals(trueEnv.lookup("x"), T.string)).toBe(true);
    const falseType = falseEnv.lookup("x");
    expect(typeValueToString(falseType)).toBe("null | undefined");
  });

  it("narrows if(x) to exclude 0, empty string, false", () => {
    const env = createEnvironment();
    env.bind("x", T.union(T.number, T.string, T.boolean, T.null));
    const expr = getTestExpr("x");
    const [trueEnv, falseEnv] = narrow(expr, env);
    // true env excludes null; primitives stay because we can't distinguish falsy primitives at type level
    const trueType = trueEnv.lookup("x");
    expect(typeValueToString(trueType)).toBe("number | string | boolean");
  });

  it("does not narrow non-union types", () => {
    const env = createEnvironment();
    env.bind("x", T.string);
    const expr = getTestExpr("x");
    const [trueEnv, falseEnv] = narrow(expr, env);
    expect(typeValueEquals(trueEnv.lookup("x"), T.string)).toBe(true);
    expect(typeValueEquals(falseEnv.lookup("x"), T.string)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/cli/src/__tests__/narrowing-truthiness.test.ts`
Expected: FAIL — truthiness narrowing not implemented, returns `[env, env]`

- [ ] **Step 3: Implement truthiness narrowing**

Add to `packages/cli/src/narrowing.ts` before the final `return [env, env]`:

```typescript
// Truthiness narrowing: if (x)
if (test.type === "Identifier") {
  return narrowByTruthy(test.name, env);
}
```

Add the helper function:

```typescript
function isFalsyType(tv: TypeValue): boolean {
  if (tv.kind === "literal") {
    return tv.value === null || tv.value === undefined || tv.value === false || tv.value === 0 || tv.value === "";
  }
  return false;
}

function narrowByTruthy(varName: string, env: Environment): [Environment, Environment] {
  const current = env.lookup(varName);

  const narrowed = narrowType(current, (m) => !isFalsyType(m));
  const excluded = subtractType(current, (m) => !isFalsyType(m));

  const trueEnv = env.extend({});
  trueEnv.bind(varName, narrowed.kind === "never" ? current : narrowed);
  const falseEnv = env.extend({});
  falseEnv.bind(varName, excluded.kind === "never" ? current : excluded);
  return [trueEnv, falseEnv];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/cli/src/__tests__/narrowing-truthiness.test.ts`
Expected: PASS

- [ ] **Step 5: Run all narrowing tests to check for regressions**

Run: `pnpm vitest run packages/cli/src/__tests__/narrowing.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/narrowing.ts packages/cli/src/__tests__/narrowing-truthiness.test.ts
git commit -m "feat(narrowing): add truthiness narrowing for if(x) patterns"
```

---

### Task 2: `in` Operator Narrowing

**Files:**
- Create: `packages/cli/src/__tests__/narrowing-in-operator.test.ts`
- Modify: `packages/cli/src/narrowing.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/cli/src/__tests__/narrowing-in-operator.test.ts
import { describe, it, expect } from "vitest";
import { T, typeValueToString, createEnvironment } from "@nudojs/core";
import { parse } from "@nudojs/parser";
import { narrow } from "../narrowing.ts";
import type { ExpressionStatement } from "@babel/types";

function getTestExpr(source: string) {
  const ast = parse(source);
  const stmt = ast.program.body[0] as ExpressionStatement;
  return stmt.expression;
}

describe("narrow: in operator", () => {
  it("narrows 'key' in obj to objects with that property", () => {
    const env = createEnvironment();
    const objWithFoo = T.object({ foo: T.string });
    const objWithBar = T.object({ bar: T.number });
    env.bind("obj", T.union(objWithFoo, objWithBar));
    const expr = getTestExpr('"foo" in obj');
    const [trueEnv, falseEnv] = narrow(expr, env);
    expect(typeValueToString(trueEnv.lookup("obj"))).toBe("{ foo: string }");
    expect(typeValueToString(falseEnv.lookup("obj"))).toBe("{ bar: number }");
  });

  it("returns unchanged env when right side is not a union", () => {
    const env = createEnvironment();
    env.bind("obj", T.object({ foo: T.string }));
    const expr = getTestExpr('"foo" in obj');
    const [trueEnv, falseEnv] = narrow(expr, env);
    expect(typeValueToString(trueEnv.lookup("obj"))).toBe("{ foo: string }");
    expect(typeValueToString(falseEnv.lookup("obj"))).toBe("{ foo: string }");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/cli/src/__tests__/narrowing-in-operator.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `in` operator narrowing**

Add to `packages/cli/src/narrowing.ts` before the `!expr` handler:

```typescript
// "key" in obj
if (
  test.type === "BinaryExpression" &&
  test.operator === "in" &&
  test.left.type === "StringLiteral" &&
  test.right.type === "Identifier"
) {
  return narrowByPropertyIn(test.left.value, test.right.name, env);
}
```

Add the helper:

```typescript
function narrowByPropertyIn(propName: string, varName: string, env: Environment): [Environment, Environment] {
  const current = env.lookup(varName);

  const narrowed = narrowType(current, (m) =>
    m.kind === "object" && propName in m.properties
  );
  const excluded = subtractType(current, (m) =>
    m.kind === "object" && propName in m.properties
  );

  const trueEnv = env.extend({});
  trueEnv.bind(varName, narrowed.kind === "never" ? current : narrowed);
  const falseEnv = env.extend({});
  falseEnv.bind(varName, excluded.kind === "never" ? current : excluded);
  return [trueEnv, falseEnv];
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/cli/src/__tests__/narrowing-in-operator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/narrowing.ts packages/cli/src/__tests__/narrowing-in-operator.test.ts
git commit -m "feat(narrowing): add 'in' operator narrowing"
```

---

### Task 3: `Array.isArray()` Narrowing

**Files:**
- Modify: `packages/cli/src/__tests__/narrowing-truthiness.test.ts` (add tests)
- Modify: `packages/cli/src/narrowing.ts`

- [ ] **Step 1: Write failing tests**

Add to `packages/cli/src/__tests__/narrowing-truthiness.test.ts`:

```typescript
describe("narrow: Array.isArray", () => {
  it("narrows Array.isArray(x) to array type", () => {
    const env = createEnvironment();
    env.bind("x", T.union(T.array(T.string), T.object({ foo: T.number })));
    const expr = getTestExpr("Array.isArray(x)");
    const [trueEnv, falseEnv] = narrow(expr, env);
    expect(trueEnv.lookup("x").kind).toBe("array");
    expect(falseEnv.lookup("x").kind).toBe("object");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/cli/src/__tests__/narrowing-truthiness.test.ts`
Expected: FAIL on Array.isArray test

- [ ] **Step 3: Implement Array.isArray narrowing**

Add to `packages/cli/src/narrowing.ts`:

```typescript
// Array.isArray(x)
if (
  test.type === "CallExpression" &&
  test.callee.type === "MemberExpression" &&
  test.callee.object.type === "Identifier" &&
  test.callee.object.name === "Array" &&
  test.callee.property.type === "Identifier" &&
  test.callee.property.name === "isArray" &&
  test.arguments.length === 1 &&
  test.arguments[0].type === "Identifier"
) {
  return narrowByIsArray(test.arguments[0].name, env);
}
```

Add the helper:

```typescript
function narrowByIsArray(varName: string, env: Environment): [Environment, Environment] {
  const current = env.lookup(varName);

  const narrowed = narrowType(current, (m) => m.kind === "array" || m.kind === "tuple");
  const excluded = subtractType(current, (m) => m.kind === "array" || m.kind === "tuple");

  const trueEnv = env.extend({});
  trueEnv.bind(varName, narrowed.kind === "never" ? T.array(T.unknown) : narrowed);
  const falseEnv = env.extend({});
  falseEnv.bind(varName, excluded.kind === "never" ? current : excluded);
  return [trueEnv, falseEnv];
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/cli/src/__tests__/narrowing-truthiness.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/narrowing.ts packages/cli/src/__tests__/narrowing-truthiness.test.ts
git commit -m "feat(narrowing): add Array.isArray() narrowing"
```

---

### Task 4: Discriminated Union Narrowing

**Files:**
- Create: `packages/cli/src/__tests__/narrowing-discriminated.test.ts`
- Modify: `packages/cli/src/narrowing.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/cli/src/__tests__/narrowing-discriminated.test.ts
import { describe, it, expect } from "vitest";
import { T, typeValueToString, createEnvironment } from "@nudojs/core";
import { parse } from "@nudojs/parser";
import { narrow } from "../narrowing.ts";
import type { ExpressionStatement } from "@babel/types";

function getTestExpr(source: string) {
  const ast = parse(source);
  const stmt = ast.program.body[0] as ExpressionStatement;
  return stmt.expression;
}

describe("narrow: discriminated unions", () => {
  it("narrows shape.kind === 'circle' to circle member", () => {
    const env = createEnvironment();
    const circle = T.object({ kind: T.literal("circle"), radius: T.number });
    const rect = T.object({ kind: T.literal("rect"), w: T.number, h: T.number });
    env.bind("shape", T.union(circle, rect));
    const expr = getTestExpr('shape.kind === "circle"');
    const [trueEnv, falseEnv] = narrow(expr, env);
    expect(typeValueToString(trueEnv.lookup("shape"))).toBe("{ kind: \"circle\"; radius: number }");
    expect(typeValueToString(falseEnv.lookup("shape"))).toBe("{ kind: \"rect\"; w: number; h: number }");
  });

  it("narrows shape.kind !== 'circle' (inverted)", () => {
    const env = createEnvironment();
    const circle = T.object({ kind: T.literal("circle"), radius: T.number });
    const rect = T.object({ kind: T.literal("rect"), w: T.number, h: T.number });
    env.bind("shape", T.union(circle, rect));
    const expr = getTestExpr('shape.kind !== "circle"');
    const [trueEnv, falseEnv] = narrow(expr, env);
    expect(typeValueToString(trueEnv.lookup("shape"))).toBe("{ kind: \"rect\"; w: number; h: number }");
    expect(typeValueToString(falseEnv.lookup("shape"))).toBe("{ kind: \"circle\"; radius: number }");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/cli/src/__tests__/narrowing-discriminated.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement discriminated union narrowing**

Add to `packages/cli/src/narrowing.ts`, extending the existing `x === literal` pattern to handle `obj.prop === literal`:

```typescript
// obj.prop === literal (discriminated union)
if (
  test.type === "BinaryExpression" &&
  test.operator === "===" &&
  test.left.type === "MemberExpression" &&
  test.left.object.type === "Identifier" &&
  test.left.property.type === "Identifier" &&
  isLiteralNode(test.right)
) {
  return narrowByDiscriminant(test.left.object.name, test.left.property.name, getLiteralValue(test.right), env);
}

// literal === obj.prop
if (
  test.type === "BinaryExpression" &&
  test.operator === "===" &&
  isLiteralNode(test.left) &&
  test.right.type === "MemberExpression" &&
  test.right.object.type === "Identifier" &&
  test.right.property.type === "Identifier"
) {
  return narrowByDiscriminant(test.right.object.name, test.right.property.name, getLiteralValue(test.left), env);
}

// obj.prop !== literal
if (
  test.type === "BinaryExpression" &&
  test.operator === "!==" &&
  test.left.type === "MemberExpression" &&
  test.left.object.type === "Identifier" &&
  test.left.property.type === "Identifier" &&
  isLiteralNode(test.right)
) {
  const [trueEnv, falseEnv] = narrowByDiscriminant(test.left.object.name, test.left.property.name, getLiteralValue(test.right), env);
  return [falseEnv, trueEnv];
}
```

Add the helper:

```typescript
function narrowByDiscriminant(
  objName: string,
  propName: string,
  literalValue: TypeValue,
  env: Environment,
): [Environment, Environment] {
  const current = env.lookup(objName);

  const narrowed = narrowType(current, (m) => {
    if (m.kind !== "object") return false;
    const propType = m.properties[propName];
    if (!propType) return false;
    return typeValueEquals(propType, literalValue);
  });

  const excluded = subtractType(current, (m) => {
    if (m.kind !== "object") return false;
    const propType = m.properties[propName];
    if (!propType) return false;
    return typeValueEquals(propType, literalValue);
  });

  const trueEnv = env.extend({});
  trueEnv.bind(objName, narrowed.kind === "never" ? current : narrowed);
  const falseEnv = env.extend({});
  falseEnv.bind(objName, excluded.kind === "never" ? current : excluded);
  return [trueEnv, falseEnv];
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/cli/src/__tests__/narrowing-discriminated.test.ts`
Expected: PASS

- [ ] **Step 5: Run all narrowing tests**

Run: `pnpm vitest run packages/cli/src/__tests__/narrowing.test.ts packages/cli/src/__tests__/narrowing-truthiness.test.ts packages/cli/src/__tests__/narrowing-in-operator.test.ts packages/cli/src/__tests__/narrowing-discriminated.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/narrowing.ts packages/cli/src/__tests__/narrowing-discriminated.test.ts
git commit -m "feat(narrowing): add discriminated union narrowing via obj.prop === literal"
```

---

### Task 5: Optional Chaining (`?.`)

**Files:**
- Create: `packages/cli/src/__tests__/evaluator-optional-chaining.test.ts`
- Modify: `packages/cli/src/evaluator.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/cli/src/__tests__/evaluator-optional-chaining.test.ts
import { describe, it, expect } from "vitest";
import { T, typeValueToString, createEnvironment } from "@nudojs/core";
import { evaluateProgram } from "../evaluator.ts";
import { parse } from "@nudojs/parser";

function evalSource(source: string) {
  const ast = parse(source);
  const env = createEnvironment();
  evaluateProgram(ast, env);
  return env;
}

describe("optional chaining", () => {
  it("evaluates obj?.foo when obj is object", () => {
    const env = evalSource(`
      const obj = { foo: "hello" };
      const result = obj?.foo;
    `);
    expect(typeValueToString(env.lookup("result"))).toBe('"hello"');
  });

  it("evaluates obj?.foo when obj might be null", () => {
    const env = evalSource(`
      /** @nudo:case */
      function get(obj) { return obj?.name; }
    `);
    // result should include undefined from the optional chaining
  });

  it("evaluates arr?.[0] for optional computed access", () => {
    const env = evalSource(`
      const arr = [1, 2, 3];
      const result = arr?.[0];
    `);
    expect(typeValueToString(env.lookup("result"))).toBe("1");
  });

  it("evaluates fn?.() for optional call", () => {
    const env = evalSource(`
      const fn = () => 42;
      const result = fn?.();
    `);
    expect(typeValueToString(env.lookup("result"))).toBe("42");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/cli/src/__tests__/evaluator-optional-chaining.test.ts`
Expected: FAIL — `OptionalMemberExpression` not handled

- [ ] **Step 3: Implement optional chaining in evaluator**

In `packages/cli/src/evaluator.ts`, find the `case "MemberExpression"` block. Add a new case before or after it for `OptionalMemberExpression`. The Babel AST uses `OptionalMemberExpression` and `OptionalCallExpression` for `?.` syntax.

Add after the `MemberExpression` case:

```typescript
case "OptionalMemberExpression": {
  const obj = evaluate(node.object, env);
  if (isReturn(obj) || isBranch(obj) || isThrow(obj)) return obj;

  // If the object could be null/undefined, union the result with undefined
  const memberResult = evaluateMemberAccess(node, obj, env);
  if (isReturn(memberResult) || isBranch(memberResult) || isThrow(memberResult)) return memberResult;

  // Check if object type includes null or undefined
  const hasNullish = (obj.kind === "union" && obj.members.some(m =>
    (m.kind === "literal" && (m.value === null || m.value === undefined)) ||
    m.kind === "null" || m.kind === "undefined"
  )) || (obj.kind === "literal" && (obj.value === null || obj.value === undefined));

  if (hasNullish) {
    return simplifyUnion([memberResult, T.undefined]);
  }
  return memberResult;
}
```

Note: The actual implementation depends on how `MemberExpression` is currently handled. Check `evaluator.ts` line 683 for the existing pattern and extract the member access logic into a shared helper if needed.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/cli/src/__tests__/evaluator-optional-chaining.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/evaluator.ts packages/cli/src/__tests__/evaluator-optional-chaining.test.ts
git commit -m "feat(evaluator): add optional chaining (?.) support"
```

---

### Task 6: Nullish Coalescing (`??`) Type Narrowing

**Files:**
- Create: `packages/cli/src/__tests__/evaluator-nullish-coalescing.test.ts`
- Modify: `packages/cli/src/evaluator.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/cli/src/__tests__/evaluator-nullish-coalescing.test.ts
import { describe, it, expect } from "vitest";
import { T, typeValueToString, createEnvironment } from "@nudojs/core";
import { evaluateProgram } from "../evaluator.ts";
import { parse } from "@nudojs/parser";

function evalSource(source: string) {
  const ast = parse(source);
  const env = createEnvironment();
  evaluateProgram(ast, env);
  return env;
}

describe("nullish coalescing narrowing", () => {
  it("narrows ?? to exclude null/undefined from left side", () => {
    const env = evalSource(`
      /** @nudo:case */
      function get(x) { return x ?? "default"; }
    `);
    // When x is string | null, result should be string (not string | null | "default")
  });

  it("returns right side when left is always null", () => {
    const env = evalSource(`
      const x = null;
      const result = x ?? 42;
    `);
    expect(typeValueToString(env.lookup("result"))).toBe("42");
  });

  it("returns left side when left is never null", () => {
    const env = evalSource(`
      const x = "hello";
      const result = x ?? "default";
    `);
    expect(typeValueToString(env.lookup("result"))).toBe('"hello"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/cli/src/__tests__/evaluator-nullish-coalescing.test.ts`
Expected: FAIL

- [ ] **Step 3: Fix `??` operator in LogicalExpression**

In `packages/cli/src/evaluator.ts`, find the `??` branch in `LogicalExpression` (around line 340). Replace the current logic with:

```typescript
if (node.operator === "??") {
  if (leftVal.kind === "literal" && leftVal.value !== null && leftVal.value !== undefined) {
    return leftVal;
  }
  if (leftVal.kind === "literal" && (leftVal.value === null || leftVal.value === undefined)) {
    const rv = evaluate(node.right, env);
    return isReturn(rv) || isBranch(rv) || isThrow(rv) ? rv : rv;
  }
  // For non-literal types, narrow left side by removing null/undefined
  const narrowedLeft = subtractType(leftVal, (m) =>
    (m.kind === "literal" && (m.value === null || m.value === undefined)) ||
    m.kind === "null" || m.kind === "undefined"
  );
  if (narrowedLeft.kind !== "never") {
    return narrowedLeft;
  }
  const rv = evaluate(node.right, env);
  const rightTV = isReturn(rv) || isBranch(rv) || isThrow(rv) ? T.unknown : rv;
  return rightTV;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/cli/src/__tests__/evaluator-nullish-coalescing.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/evaluator.ts packages/cli/src/__tests__/evaluator-nullish-coalescing.test.ts
git commit -m "feat(evaluator): narrow types through nullish coalescing (??)"
```

---

### Task 7: Switch Statement Narrowing

**Files:**
- Create: `packages/cli/src/__tests__/narrowing-switch.test.ts`
- Modify: `packages/cli/src/evaluator.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/cli/src/__tests__/narrowing-switch.test.ts
import { describe, it, expect } from "vitest";
import { T, typeValueToString, createEnvironment } from "@nudojs/core";
import { evaluateProgram } from "../evaluator.ts";
import { parse } from "@nudojs/parser";

function evalSource(source: string) {
  const ast = parse(source);
  const env = createEnvironment();
  evaluateProgram(ast, env);
  return env;
}

describe("switch narrowing", () => {
  it("narrows discriminated union in switch cases", () => {
    const env = evalSource(`
      /** @nudo:case */
      function getArea(shape) {
        switch (shape.kind) {
          case "circle": return shape.radius * shape.radius * 3.14;
          case "rect": return shape.w * shape.h;
        }
      }
    `);
    // The function should infer proper types for each case
  });

  it("narrows typeof in switch", () => {
    const env = evalSource(`
      /** @nudo:case */
      function describe(x) {
        switch (typeof x) {
          case "string": return x.toUpperCase();
          case "number": return x + 1;
          default: return x;
        }
      }
    `);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/cli/src/__tests__/narrowing-switch.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement switch narrowing**

In `packages/cli/src/evaluator.ts`, modify `evaluateSwitchStatement` to narrow the discriminant for each case. When the discriminant is an `Identifier` and the case test is a literal, use the narrowing system.

Replace the non-concrete branch of `evaluateSwitchStatement` (around line 1818):

```typescript
// Non-concrete discriminant — narrow per case
const returnValues: TypeValue[] = [];
let remainingType = discriminant;

for (const caseNode of node.cases) {
  if (caseNode.test) {
    const testVal = evaluate(caseNode.test, env);
    if (isReturn(testVal) || isBranch(testVal) || isThrow(testVal)) return testVal;

    // Try to narrow discriminant for this case
    let caseEnv = env;
    if (node.discriminant.type === "Identifier" && testVal.kind === "literal") {
      const [narrowedEnv] = narrowByStrictEqual(node.discriminant.name, testVal, env);
      caseEnv = narrowedEnv;
    }

    const result = evaluateStatements(caseNode.consequent, caseEnv);
    if (isThrow(result)) continue;
    if (isReturn(result)) {
      returnValues.push(result.value);
      continue;
    }
    if (isBranch(result)) {
      returnValues.push(result.returnedValue);
      continue;
    }
  } else {
    // default case
    const result = evaluateStatements(caseNode.consequent, env);
    if (isThrow(result)) continue;
    if (isReturn(result)) {
      returnValues.push(result.value);
      continue;
    }
    if (isBranch(result)) {
      returnValues.push(result.returnedValue);
      continue;
    }
  }
}
```

Note: `narrowByStrictEqual` is a private function in `narrowing.ts`. Either export it or refactor to use the public `narrow` function with a constructed test node.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/cli/src/__tests__/narrowing-switch.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pnpm run test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/evaluator.ts packages/cli/src/__tests__/narrowing-switch.test.ts
git commit -m "feat(evaluator): add type narrowing in switch statement cases"
```

---

## Phase 2: Enhanced LSP Editor Experience

### Task 8: Symbol Table Infrastructure

**Files:**
- Create: `packages/lsp/src/symbols.ts`
- Modify: `packages/service/src/analyzer.ts`

- [ ] **Step 1: Define symbol types in service**

Add to `packages/service/src/analyzer.ts`:

```typescript
export type SymbolInfo = {
  name: string;
  kind: "function" | "variable" | "class" | "parameter";
  loc: SourceLocation;
  uri?: string;
};

export type ReferenceInfo = {
  name: string;
  loc: SourceLocation;
  uri?: string;
};

export type SymbolTable = {
  definitions: Map<string, SymbolInfo>;
  references: ReferenceInfo[];
};
```

- [ ] **Step 2: Create symbol table builder**

```typescript
// packages/lsp/src/symbols.ts
import type { Node } from "@babel/types";
import type { SymbolInfo, ReferenceInfo, SymbolTable, SourceLocation } from "@nudojs/service";

export function buildSymbolTable(ast: Node, uri: string): SymbolTable {
  const definitions = new Map<string, SymbolInfo>();
  const references: ReferenceInfo[] = [];

  // Walk AST to collect definitions and references
  // Uses the same traverse pattern as buildNodeTypeMap in analyzer.ts

  return { definitions, references };
}

export function findDefinition(
  symbolTable: SymbolTable,
  name: string,
): SymbolInfo | null {
  return symbolTable.definitions.get(name) ?? null;
}

export function findReferences(
  symbolTable: SymbolTable,
  name: string,
): ReferenceInfo[] {
  return symbolTable.references.filter((r) => r.name === name);
}
```

- [ ] **Step 3: Write tests for symbol table**

```typescript
// packages/lsp/src/__tests__/definition.test.ts
import { describe, it, expect } from "vitest";
import { parse } from "@nudojs/parser";
import { buildSymbolTable, findDefinition } from "../symbols.ts";

describe("symbol table", () => {
  it("finds function definition", () => {
    const source = `function add(a, b) { return a + b; }`;
    const ast = parse(source);
    const table = buildSymbolTable(ast, "file:///test.js");
    const def = findDefinition(table, "add");
    expect(def).not.toBeNull();
    expect(def!.kind).toBe("function");
    expect(def!.loc.start.line).toBe(1);
  });

  it("finds variable definition", () => {
    const source = `const x = 42;`;
    const ast = parse(source);
    const table = buildSymbolTable(ast, "file:///test.js");
    const def = findDefinition(table, "x");
    expect(def).not.toBeNull();
    expect(def!.kind).toBe("variable");
  });

  it("collects references", () => {
    const source = `const x = 42; const y = x + 1;`;
    const ast = parse(source);
    const table = buildSymbolTable(ast, "file:///test.js");
    const refs = table.references.filter((r) => r.name === "x");
    expect(refs.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/lsp/src/__tests__/definition.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/lsp/src/symbols.ts packages/lsp/src/__tests__/definition.test.ts packages/service/src/analyzer.ts
git commit -m "feat(lsp): add symbol table infrastructure for go-to-definition and references"
```

---

### Task 9: Go-to-Definition LSP Handler

**Files:**
- Modify: `packages/lsp/src/server.ts`

- [ ] **Step 1: Register definitionProvider capability**

In `packages/lsp/src/server.ts`, update `onInitialize` to add `definitionProvider: true`:

```typescript
connection.onInitialize((_params: InitializeParams): InitializeResult => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Full,
    hoverProvider: true,
    definitionProvider: true,  // ADD THIS
    completionProvider: {
      triggerCharacters: ["."],
      resolveProvider: false,
    },
    codeLensProvider: {
      resolveProvider: false,
    },
    inlayHintProvider: true,
  },
}));
```

- [ ] **Step 2: Implement onDefinition handler**

Add after the `onHover` handler:

```typescript
connection.onDefinition((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  if (!isNudoFile(params.textDocument.uri)) return null;

  const source = document.getText();
  const ast = parse(source);
  const table = buildSymbolTable(ast, params.textDocument.uri);

  const line = params.position.line + 1;
  const column = params.position.character;

  // Find the identifier at cursor position
  const identAtPos = findIdentifierAtPosition(ast, line, column);
  if (!identAtPos) return null;

  const def = findDefinition(table, identAtPos);
  if (!def) return null;

  return {
    uri: params.textDocument.uri,
    range: {
      start: { line: def.loc.start.line - 1, character: def.loc.start.column },
      end: { line: def.loc.end.line - 1, character: def.loc.end.column },
    },
  };
});
```

Note: `findIdentifierAtPosition` already exists in `analyzer.ts`. Either export it or duplicate it in the LSP package.

- [ ] **Step 3: Test manually in VS Code**

Open a `.js` file with `@nudo:case` directives. Ctrl+click on a function name. Verify it jumps to the definition.

- [ ] **Step 4: Commit**

```bash
git add packages/lsp/src/server.ts
git commit -m "feat(lsp): add go-to-definition support"
```

---

### Task 10: Find References LSP Handler

**Files:**
- Modify: `packages/lsp/src/server.ts`

- [ ] **Step 1: Register referencesProvider capability**

Add `referencesProvider: true` to capabilities.

- [ ] **Step 2: Implement onReferences handler**

```typescript
connection.onReferences((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  if (!isNudoFile(params.textDocument.uri)) return [];

  const source = document.getText();
  const ast = parse(source);
  const table = buildSymbolTable(ast, params.textDocument.uri);

  const line = params.position.line + 1;
  const column = params.position.character;
  const identAtPos = findIdentifierAtPosition(ast, line, column);
  if (!identAtPos) return [];

  const refs = findReferences(table, identAtPos);
  return refs.map((ref) => ({
    uri: params.textDocument.uri,
    range: {
      start: { line: ref.loc.start.line - 1, character: ref.loc.start.column },
      end: { line: ref.loc.end.line - 1, character: ref.loc.end.column },
    },
  }));
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/lsp/src/server.ts
git commit -m "feat(lsp): add find references support"
```

---

### Task 11: Rename LSP Handler

**Files:**
- Modify: `packages/lsp/src/server.ts`

- [ ] **Step 1: Register renameProvider capability**

Add `renameProvider: true` to capabilities.

- [ ] **Step 2: Implement onRename handler**

```typescript
connection.onRenameRequest((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  if (!isNudoFile(params.textDocument.uri)) return null;

  const source = document.getText();
  const ast = parse(source);
  const table = buildSymbolTable(ast, params.textDocument.uri);

  const line = params.position.line + 1;
  const column = params.position.character;
  const identAtPos = findIdentifierAtPosition(ast, line, column);
  if (!identAtPos) return null;

  const def = findDefinition(table, identAtPos);
  const refs = findReferences(table, identAtPos);

  const edits = [];

  // Include definition
  if (def) {
    edits.push({
      range: {
        start: { line: def.loc.start.line - 1, character: def.loc.start.column },
        end: { line: def.loc.end.line - 1, character: def.loc.end.column },
      },
      newText: params.newName,
    });
  }

  // Include all references
  for (const ref of refs) {
    edits.push({
      range: {
        start: { line: ref.loc.start.line - 1, character: ref.loc.start.column },
        end: { line: ref.loc.end.line - 1, character: ref.loc.end.column },
      },
      newText: params.newName,
    });
  }

  return {
    changes: {
      [params.textDocument.uri]: edits,
    },
  };
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/lsp/src/server.ts
git commit -m "feat(lsp): add rename support"
```

---

### Task 12: Semantic Tokens

**Files:**
- Create: `packages/lsp/src/semantic-tokens.ts`
- Modify: `packages/lsp/src/server.ts`

- [ ] **Step 1: Create semantic token encoder**

```typescript
// packages/lsp/src/semantic-tokens.ts
export const TOKEN_TYPES = [
  "function",
  "variable",
  "parameter",
  "property",
  "type",
  "keyword",
  "string",
  "number",
  "comment",
  "decorator",
] as const;

export const TOKEN_MODIFIERS = [
  "declaration",
  "readonly",
  "deprecated",
  "unreachable",
] as const;

export type SemanticToken = {
  line: number;
  char: number;
  length: number;
  typeIndex: number;
  modifierBitmask: number;
};

export function encodeSemanticTokens(tokens: SemanticToken[]): number[] {
  const result: number[] = [];
  let prevLine = 0;
  let prevChar = 0;

  for (const token of tokens) {
    const deltaLine = token.line - prevLine;
    const deltaChar = deltaLine === 0 ? token.char - prevChar : token.char;

    result.push(deltaLine, deltaChar, token.length, token.typeIndex, token.modifierBitmask);

    prevLine = token.line;
    prevChar = token.char;
  }

  return result;
}
```

- [ ] **Step 2: Register semanticTokensProvider capability**

```typescript
connection.onInitialize((_params: InitializeParams): InitializeResult => ({
  capabilities: {
    // ... existing capabilities
    semanticTokensProvider: {
      full: true,
      legend: {
        tokenTypes: [...TOKEN_TYPES],
        tokenModifiers: [...TOKEN_MODIFIERS],
      },
    },
  },
}));
```

- [ ] **Step 3: Implement semantic tokens handler**

```typescript
connection.languages.semanticTokens.on((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return { data: [] };
  if (!isNudoFile(params.textDocument.uri)) return { data: [] };

  const filePath = uriToFilePath(params.textDocument.uri);
  const source = document.getText();
  const cases = getActiveCasesForUri(params.textDocument.uri);

  try {
    const result = analyzeFile(filePath, source, cases);
    const tokens = collectSemanticTokens(result, source);
    return { data: encodeSemanticTokens(tokens) };
  } catch {
    return { data: [] };
  }
});
```

- [ ] **Step 4: Commit**

```bash
git add packages/lsp/src/semantic-tokens.ts packages/lsp/src/server.ts
git commit -m "feat(lsp): add semantic tokens support"
```

---

## Phase 2.5: AI Agent Integration (MCP)

### Task 13: MCP Server Package Setup

**Files:**
- Create: `packages/mcp/package.json`
- Create: `packages/mcp/tsconfig.json`
- Create: `packages/mcp/src/index.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@nudojs/mcp",
  "version": "0.1.0",
  "type": "module",
  "main": "src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@nudojs/service": "workspace:*",
    "@nudojs/core": "workspace:*"
  },
  "devDependencies": {
    "tsup": "^8.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [
    { "path": "../service" },
    { "path": "../core" }
  ]
}
```

- [ ] **Step 3: Create basic MCP server entry**

```typescript
// packages/mcp/src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.ts";

const server = new McpServer({
  name: "nudo",
  version: "0.1.0",
});

registerTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 4: Update workspace config**

Add `packages/mcp` to `pnpm-workspace.yaml` if not already included via glob.

- [ ] **Step 5: Install dependencies**

Run: `pnpm install`

- [ ] **Step 6: Commit**

```bash
git add packages/mcp/
git commit -m "feat(mcp): scaffold MCP server package"
```

---

### Task 14: MCP What-If Tool

**Files:**
- Create: `packages/mcp/src/tools.ts`
- Create: `packages/mcp/src/__tests__/what-if.test.ts`
- Modify: `packages/service/src/analyzer.ts`

- [ ] **Step 1: Add `analyzeWithBindings` to service**

Add to `packages/service/src/analyzer.ts`:

```typescript
export type TypeBinding = {
  name: string;
  type: TypeValue;
};

export function analyzeWithBindings(
  filePath: string,
  source: string,
  bindings: TypeBinding[],
  targetName: string,
): { type: TypeValue | null; chain: string[] } {
  const ast = parse(source);
  resetMemo();
  setModuleResolver(resolveModule);
  setCurrentFileDir(dirname(filePath));

  const globalEnv = createEnvironment();
  evaluateProgram(ast, globalEnv);

  // Apply user-provided type bindings
  for (const binding of bindings) {
    globalEnv.bind(binding.name, binding.type);
  }

  // Get the target type
  const type = globalEnv.has(targetName) ? globalEnv.lookup(targetName) : null;

  setModuleResolver(null);
  return { type, chain: [] };
}
```

- [ ] **Step 2: Register what-if tool**

```typescript
// packages/mcp/src/tools.ts
import { z } from "zod";
import { analyzeWithBindings } from "@nudojs/service";
import { T, typeValueToString } from "@nudojs/core";

export function registerTools(server: any) {
  server.tool(
    "nudo-what-if",
    "Set type assumptions and observe inferred types at other positions",
    {
      file: z.string().describe("Path to the JavaScript file"),
      bindings: z.array(z.object({
        name: z.string().describe("Variable name"),
        type: z.string().describe("Type expression, e.g., 'number', 'string | null'"),
      })).describe("Type assumptions to apply"),
      target: z.string().describe("Variable or expression to get the type of"),
    },
    async ({ file, bindings, target }: any) => {
      const source = require("fs").readFileSync(file, "utf-8");
      const typeBindings = bindings.map((b: any) => ({
        name: b.name,
        type: parseTypeExpr(b.type),
      }));
      const result = analyzeWithBindings(file, source, typeBindings, target);
      return {
        content: [{
          type: "text",
          text: result.type ? typeValueToString(result.type) : "unknown",
        }],
      };
    },
  );
}

function parseTypeExpr(expr: string): any {
  // Simple type expression parser
  // "number" -> T.number
  // "string | null" -> T.union(T.string, T.null)
  // For now, use a basic implementation
  if (expr === "number") return T.number;
  if (expr === "string") return T.string;
  if (expr === "boolean") return T.boolean;
  if (expr === "null") return T.null;
  if (expr === "undefined") return T.undefined;
  return T.unknown;
}
```

- [ ] **Step 3: Write tests**

```typescript
// packages/mcp/src/__tests__/what-if.test.ts
import { describe, it, expect } from "vitest";
import { analyzeWithBindings } from "@nudojs/service";
import { T, typeValueToString } from "@nudojs/core";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("what-if analysis", () => {
  it("infers type with injected binding", () => {
    const tmpFile = join(tmpdir(), "test-whatif.js");
    writeFileSync(tmpFile, `
      function add(a, b) { return a + b; }
    `);

    const result = analyzeWithBindings(
      tmpFile,
      `function add(a, b) { return a + b; }`,
      [{ name: "a", type: T.number }, { name: "b", type: T.number }],
      "add"
    );

    expect(result.type).not.toBeNull();
    unlinkSync(tmpFile);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/mcp/src/__tests__/what-if.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/tools.ts packages/mcp/src/__tests__/what-if.test.ts packages/service/src/analyzer.ts
git commit -m "feat(mcp): add what-if tool for hypothetical type analysis"
```

---

## Phase 3: Runtime Type Generation

### Task 15: Zod Schema Generator

**Files:**
- Create: `packages/service/src/schema-generator.ts`
- Create: `packages/service/src/__tests__/schema-generator.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/service/src/__tests__/schema-generator.test.ts
import { describe, it, expect } from "vitest";
import { T } from "@nudojs/core";
import { typeValueToZodSchema } from "../schema-generator.ts";

describe("schema-generator", () => {
  it("generates z.string() for string type", () => {
    expect(typeValueToZodSchema(T.string)).toBe("z.string()");
  });

  it("generates z.number() for number type", () => {
    expect(typeValueToZodSchema(T.number)).toBe("z.number()");
  });

  it("generates z.literal() for literal types", () => {
    expect(typeValueToZodSchema(T.literal("hello"))).toBe('z.literal("hello")');
    expect(typeValueToZodSchema(T.literal(42))).toBe("z.literal(42)");
    expect(typeValueToZodSchema(T.literal(true))).toBe("z.literal(true)");
  });

  it("generates z.object() for object types", () => {
    const obj = T.object({ name: T.string, age: T.number });
    expect(typeValueToZodSchema(obj)).toBe('z.object({ name: z.string(), age: z.number() })');
  });

  it("generates z.array() for array types", () => {
    expect(typeValueToZodSchema(T.array(T.string))).toBe("z.array(z.string())");
  });

  it("generates z.union() for union types", () => {
    const union = T.union(T.string, T.number);
    expect(typeValueToZodSchema(union)).toBe("z.union([z.string(), z.number()])");
  });

  it("generates z.null() and z.undefined()", () => {
    expect(typeValueToZodSchema(T.null)).toBe("z.null()");
    expect(typeValueToZodSchema(T.undefined)).toBe("z.undefined()");
  });

  it("generates z.promise() for promise types", () => {
    expect(typeValueToZodSchema(T.promise(T.string))).toBe("z.promise(z.string())");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/service/src/__tests__/schema-generator.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement schema generator**

```typescript
// packages/service/src/schema-generator.ts
import type { TypeValue } from "@nudojs/core";

export function typeValueToZodSchema(tv: TypeValue): string {
  switch (tv.kind) {
    case "literal": {
      if (tv.value === null) return "z.null()";
      if (tv.value === undefined) return "z.undefined()";
      if (typeof tv.value === "string") return `z.literal(${JSON.stringify(tv.value)})`;
      if (typeof tv.value === "boolean") return `z.literal(${tv.value})`;
      return `z.literal(${tv.value})`;
    }
    case "primitive":
      return `z.${tv.type}()`;
    case "refined":
      return typeValueToZodSchema(tv.base);
    case "object": {
      const entries = Object.entries(tv.properties)
        .map(([k, v]) => `${k}: ${typeValueToZodSchema(v)}`)
        .join(", ");
      return `z.object({ ${entries} })`;
    }
    case "array":
      return `z.array(${typeValueToZodSchema(tv.element)})`;
    case "tuple": {
      const inner = tv.elements.map(typeValueToZodSchema).join(", ");
      return `z.tuple([${inner}])`;
    }
    case "function":
      return "z.function()";
    case "promise":
      return `z.promise(${typeValueToZodSchema(tv.value)})`;
    case "instance":
      return `z.instanceof(${tv.className})`;
    case "union": {
      const members = tv.members.map(typeValueToZodSchema).join(", ");
      return `z.union([${members}])`;
    }
    case "never":
      return "z.never()";
    case "unknown":
      return "z.unknown()";
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/service/src/__tests__/schema-generator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/schema-generator.ts packages/service/src/__tests__/schema-generator.test.ts
git commit -m "feat(service): add Zod schema generator from inferred types"
```

---

### Task 16: Native Guard Generator

**Files:**
- Create: `packages/service/src/guard-generator.ts`
- Create: `packages/service/src/__tests__/guard-generator.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/service/src/__tests__/guard-generator.test.ts
import { describe, it, expect } from "vitest";
import { T } from "@nudojs/core";
import { generateGuardFunction } from "../guard-generator.ts";

describe("guard-generator", () => {
  it("generates guard for string type", () => {
    const guard = generateGuardFunction("isString", T.string);
    expect(guard).toContain("typeof data === 'string'");
  });

  it("generates guard for object type", () => {
    const obj = T.object({ name: T.string, age: T.number });
    const guard = generateGuardFunction("isUser", obj);
    expect(guard).toContain("typeof data === 'object'");
    expect(guard).toContain("typeof data.name === 'string'");
    expect(guard).toContain("typeof data.age === 'number'");
  });

  it("generates guard for union type", () => {
    const union = T.union(T.string, T.number);
    const guard = generateGuardFunction("isStringOrNumber", union);
    expect(guard).toContain("||");
  });

  it("generates guard for array type", () => {
    const guard = generateGuardFunction("isStringArray", T.array(T.string));
    expect(guard).toContain("Array.isArray(data)");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/service/src/__tests__/guard-generator.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement guard generator**

```typescript
// packages/service/src/guard-generator.ts
import type { TypeValue } from "@nudojs/core";

export function generateGuardFunction(name: string, tv: TypeValue): string {
  const body = generateGuardBody(tv, "data");
  return `export function ${name}(data) {\n  return ${body};\n}`;
}

function generateGuardBody(tv: TypeValue, varName: string): string {
  switch (tv.kind) {
    case "literal": {
      if (tv.value === null) return `${varName} === null`;
      if (tv.value === undefined) return `${varName} === undefined`;
      return `${varName} === ${JSON.stringify(tv.value)}`;
    }
    case "primitive":
      return `typeof ${varName} === '${tv.type}'`;
    case "refined":
      return generateGuardBody(tv.base, varName);
    case "object": {
      const checks = [`typeof ${varName} === 'object'`, `${varName} !== null`];
      for (const [key, val] of Object.entries(tv.properties)) {
        checks.push(generateGuardBody(val, `${varName}.${key}`));
      }
      return checks.join(" && ");
    }
    case "array":
      return `Array.isArray(${varName}) && ${varName}.every(item => ${generateGuardBody(tv.element, "item")})`;
    case "tuple": {
      const checks = [`Array.isArray(${varName})`, `${varName}.length === ${tv.elements.length}`];
      tv.elements.forEach((el, i) => {
        checks.push(generateGuardBody(el, `${varName}[${i}]`));
      }
      return checks.join(" && ");
    }
    case "union": {
      const members = tv.members.map((m) => generateGuardBody(m, varName));
      return members.join(" || ");
    }
    case "never":
      return "false";
    case "unknown":
      return "true";
    case "function":
      return `typeof ${varName} === 'function'`;
    case "promise":
      return `${varName} instanceof Promise`;
    case "instance":
      return `${varName} instanceof ${tv.className}`;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run packages/service/src/__tests__/guard-generator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/service/src/guard-generator.ts packages/service/src/__tests__/guard-generator.test.ts
git commit -m "feat(service): add native runtime guard generator"
```

---

### Task 17: DTS Generator Improvements

**Files:**
- Modify: `packages/service/src/dts-generator.ts`

- [ ] **Step 1: Fix function parameter names**

Update `generateDts` to use actual parameter names from the function AST instead of `arg0`, `arg1`. This requires passing function node info through `AnalysisResult`.

- [ ] **Step 2: Fix function return types**

Update the `function` case in `typeValueToTSType` to use the actual return type instead of `unknown`:

```typescript
case "function": {
  const params = tv.params
    .map((p, i) => `${p}: unknown`)
    .join(", ");
  // Use the stored return type if available
  const returnType = (tv as any)._returnType;
  const retStr = returnType ? typeValueToTSType(returnType) : "unknown";
  return `(${params}) => ${retStr}`;
}
```

- [ ] **Step 3: Add JSDoc generation**

```typescript
function generateJSDoc(fn: FunctionAnalysis): string {
  const lines: string[] = ["/**"];
  for (const c of fn.cases) {
    const params = c.args.map((a, i) => ` * @param arg${i} - ${typeValueToTSType(a)}`).join("\n");
    lines.push(params);
    lines.push(` * @returns ${typeValueToTSType(c.result)}`);
  }
  lines.push(" */");
  return lines.join("\n");
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/service/src/dts-generator.ts
git commit -m "feat(service): improve DTS generator with real param names and return types"
```

---

### Task 18: CLI `nudo generate` Command

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/service/src/index.ts`

- [ ] **Step 1: Export generators from service**

Add to `packages/service/src/index.ts`:

```typescript
export { typeValueToZodSchema } from "./schema-generator.ts";
export { generateGuardFunction } from "./guard-generator.ts";
```

- [ ] **Step 2: Add generate subcommand**

In `packages/cli/src/index.ts`, add a new command:

```typescript
program
  .command("generate")
  .description("Generate runtime validators from inferred types")
  .argument("<file>", "JavaScript file to analyze")
  .option("--format <format>", "Output format: zod, guard, dts, all", "all")
  .option("--output <dir>", "Output directory", ".")
  .action(async (file: string, options: { format: string; output: string }) => {
    const source = readFileSync(file, "utf-8");
    const result = analyzeFile(resolve(file), source);

    for (const fn of result.functions) {
      const baseName = fn.name;

      if (options.format === "zod" || options.format === "all") {
        // Generate Zod schema for each case
        for (const c of fn.cases) {
          const inputSchema = c.args.map((a) => typeValueToZodSchema(a)).join(", ");
          const outputSchema = typeValueToZodSchema(c.result);
          console.log(`// ${baseName} input: ${inputSchema}`);
          console.log(`// ${baseName} output: ${outputSchema}`);
        }
      }

      if (options.format === "guard" || options.format === "all") {
        for (const c of fn.cases) {
          const guard = generateGuardFunction(`is${baseName}Output`, c.result);
          console.log(guard);
        }
      }

      if (options.format === "dts" || options.format === "all") {
        console.log(generateDts(result));
      }
    }
  });
```

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/index.ts packages/service/src/index.ts
git commit -m "feat(cli): add 'nudo generate' command for runtime type generation"
```

---

### Task 19: CLI JSON Output

**Files:**
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Add --json flag to infer command**

Update the existing `infer` command to support `--json`:

```typescript
program
  .command("infer")
  .description("Run type inference on a JavaScript file")
  .argument("<file>", "JavaScript file to analyze")
  .option("--json", "Output as JSON")
  .action(async (file: string, options: { json?: boolean }) => {
    const source = readFileSync(file, "utf-8");
    const result = analyzeFile(resolve(file), source);

    if (options.json) {
      const jsonOutput = {
        functions: result.functions.map((fn) => ({
          name: fn.name,
          loc: fn.loc,
          cases: fn.cases.map((c) => ({
            name: c.name,
            args: c.args.map(typeValueToString),
            result: typeValueToString(c.result),
            throws: typeValueToString(c.throws),
          })),
          combined: fn.combined ? typeValueToString(fn.combined) : undefined,
        })),
        diagnostics: result.diagnostics,
      };
      console.log(JSON.stringify(jsonOutput, null, 2));
    } else {
      // Existing human-readable output
      // ...
    }
  });
```

- [ ] **Step 2: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(cli): add --json flag to nudo infer command"
```

---

### Task 20: Code Actions / Quick Fixes

**Files:**
- Modify: `packages/lsp/src/server.ts`
- Modify: `packages/service/src/analyzer.ts`

- [ ] **Step 1: Add diagnostic codes to service**

In `packages/service/src/analyzer.ts`, add `code` field to diagnostics:

```typescript
export type Diagnostic = {
  range: SourceLocation;
  severity: DiagnosticSeverity;
  message: string;
  tags?: DiagnosticTag[];
  code?: string;  // ADD THIS
  data?: unknown; // ADD THIS for code action context
};
```

Assign codes to existing diagnostics:
- Unreachable code: `code: "nudo-unreachable"`
- Throw warning: `code: "nudo-may-throw"`
- Assertion failure: `code: "nudo-assertion-failed"`

- [ ] **Step 2: Register codeActionProvider capability**

```typescript
connection.onInitialize((_params: InitializeParams): InitializeResult => ({
  capabilities: {
    // ... existing capabilities
    codeActionProvider: {
      codeActionKinds: ["quickfix"],
    },
  },
}));
```

- [ ] **Step 3: Implement onCodeAction handler**

```typescript
connection.onCodeAction((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  if (!isNudoFile(params.textDocument.uri)) return [];

  const actions = [];

  for (const diag of params.context.diagnostics) {
    if (diag.data?.code === "nudo-missing-case") {
      // Suggest adding a @nudo:case directive
      const fnName = diag.data.functionName;
      actions.push({
        title: `Add @nudo:case for ${fnName}`,
        kind: "quickfix",
        diagnostics: [diag],
        edit: {
          changes: {
            [params.textDocument.uri]: [{
              range: diag.range,
              newText: `/** @nudo:case */\n`,
            }],
          },
        },
      });
    }
  }

  return actions;
});
```

- [ ] **Step 4: Commit**

```bash
git add packages/lsp/src/server.ts packages/service/src/analyzer.ts
git commit -m "feat(lsp): add code actions for quick fixes"
```

---

### Task 21: Signature Help

**Files:**
- Modify: `packages/lsp/src/server.ts`

- [ ] **Step 1: Register signatureHelpProvider capability**

```typescript
connection.onInitialize((_params: InitializeParams): InitializeResult => ({
  capabilities: {
    // ... existing capabilities
    signatureHelpProvider: {
      triggerCharacters: ["(", ","],
    },
  },
}));
```

- [ ] **Step 2: Implement onSignatureHelp handler**

```typescript
connection.onSignatureHelp((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  if (!isNudoFile(params.textDocument.uri)) return null;

  const filePath = uriToFilePath(params.textDocument.uri);
  const source = document.getText();
  const line = params.position.line + 1;
  const column = params.position.character;
  const cases = getActiveCasesForUri(params.textDocument.uri);

  try {
    // Find the CallExpression enclosing the cursor
    const ast = parse(source);
    const callInfo = findEnclosingCall(ast, line, column);
    if (!callInfo) return null;

    const fnType = getTypeAtPosition(filePath, source, callInfo.calleeLine, callInfo.calleeCol, cases);
    if (!fnType || fnType.kind !== "function") return null;

    const paramLabels = fnType.params.map((p, i) => `${p}: unknown`);
    const activeParam = callInfo.currentParamIndex;

    return {
      signatures: [{
        label: `(${paramLabels.join(", ")}) => unknown`,
        parameters: paramLabels.map((label) => ({ label })),
        activeParameter: activeParam,
      }],
      activeSignature: 0,
      activeParameter: activeParam,
    };
  } catch {
    return null;
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/lsp/src/server.ts
git commit -m "feat(lsp): add signature help for function calls"
```

---

### Task 22: MCP Additional Tools (trace, suggest-case, check, type-at)

**Files:**
- Modify: `packages/mcp/src/tools.ts`
- Modify: `packages/service/src/analyzer.ts`

- [ ] **Step 1: Add type derivation tracing to evaluator**

In `packages/cli/src/evaluator.ts`, add an optional tracing callback:

```typescript
let _traceCallback: ((step: { from: string; to: string; op: string }) => void) | null = null;

export function setTraceCallback(cb: typeof _traceCallback): void {
  _traceCallback = cb;
}
```

Hook into key operations (binary ops, method calls, property access) to emit trace steps.

- [ ] **Step 2: Register remaining MCP tools**

```typescript
// In packages/mcp/src/tools.ts, add to registerTools:

// nudo-trace: trace type derivation
server.tool(
  "nudo-trace",
  "Trace how a type transforms from input to output",
  {
    file: z.string(),
    functionName: z.string().describe("Function to trace"),
  },
  async ({ file, functionName }: any) => {
    // Run with trace callback enabled, return derivation chain
    return { content: [{ type: "text", text: "trace result" }] };
  },
);

// nudo-suggest-case: suggest @nudo:case directives
server.tool(
  "nudo-suggest-case",
  "Suggest @nudo:case directives for a function",
  {
    file: z.string(),
    functionName: z.string(),
  },
  async ({ file, functionName }: any) => {
    const source = readFileSync(file, "utf-8");
    const result = analyzeFile(file, source);
    const fn = result.functions.find((f) => f.name === functionName);
    if (!fn) return { content: [{ type: "text", text: "Function not found" }] };

    // Generate suggested case based on parameter analysis
    const suggestions = fn.cases.length === 0
      ? `/** @nudo:case */\nfunction ${functionName}(...args) { ... }`
      : `Function already has ${fn.cases.length} case(s)`;
    return { content: [{ type: "text", text: suggestions }] };
  },
);

// nudo-check: check file for errors
server.tool(
  "nudo-check",
  "Check a file for type errors",
  {
    file: z.string(),
  },
  async ({ file }: any) => {
    const source = readFileSync(file, "utf-8");
    const result = analyzeFile(file, source);
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    return {
      content: [{
        type: "text",
        text: errors.length === 0
          ? "No type errors found"
          : errors.map((e) => `${e.range.start.line}: ${e.message}`).join("\n"),
      }],
    };
  },
);

// nudo-type-at: get type at position
server.tool(
  "nudo-type-at",
  "Get the inferred type at a specific position",
  {
    file: z.string(),
    line: z.number(),
    column: z.number(),
  },
  async ({ file, line, column }: any) => {
    const source = readFileSync(file, "utf-8");
    const type = getTypeAtPosition(file, source, line, column);
    return {
      content: [{
        type: "text",
        text: type ? typeValueToString(type) : "unknown",
      }],
    };
  },
);
```

- [ ] **Step 3: Commit**

```bash
git add packages/mcp/src/tools.ts packages/cli/src/evaluator.ts
git commit -m "feat(mcp): add trace, suggest-case, check, and type-at tools"
```

---

## Final Integration

### Task 23: Run Full Test Suite and Fix Regressions

### Task 20: Run Full Test Suite and Fix Regressions

- [ ] **Step 1: Run all tests**

Run: `pnpm run test`
Expected: ALL PASS (fix any regressions from previous tasks)

- [ ] **Step 2: Run type checking**

Run: `pnpm run lint`
Expected: No type errors

- [ ] **Step 3: Run build**

Run: `pnpm run build`
Expected: Build succeeds

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: integrate all capability boost changes"
```
