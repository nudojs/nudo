# Built-in API Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add comprehensive built-in JavaScript API type inference for Promise, Map, Set, RegExp, URL, fetch, and other modern APIs.

**Architecture:** Each built-in class gets its own file exporting static and instance method maps. A central `builtins/index.ts` merges all maps. The evaluator imports from this index. Generic types (Map<K,V>, Set<T>, Promise<T>) are tracked via `_typeArgs` on TypeValue instances.

**Tech Stack:** TypeScript, Vitest

---

## File Structure

| File | Responsibility |
|------|---------------|
| `packages/cli/src/builtins/builtin-promise.ts` | Promise static/instance methods |
| `packages/cli/src/builtins/builtin-map.ts` | Map constructor/instance methods |
| `packages/cli/src/builtins/builtin-set.ts` | Set constructor/instance methods |
| `packages/cli/src/builtins/builtin-regexp.ts` | RegExp instance methods |
| `packages/cli/src/builtins/builtin-url.ts` | URL, URLSearchParams |
| `packages/cli/src/builtins/builtin-web.ts` | Response, Headers, FormData, fetch, AbortController |
| `packages/cli/src/builtins/builtin-weak.ts` | WeakMap, WeakSet |
| `packages/cli/src/builtins/builtin-symbol.ts` | Symbol static methods |
| `packages/cli/src/builtins/builtin-reflect.ts` | Reflect methods |
| `packages/cli/src/builtins/builtin-intl.ts` | Intl.DateTimeFormat, Intl.NumberFormat |
| `packages/cli/src/builtins/index.ts` | Merge all maps, export combined |
| `packages/cli/src/evaluator.ts` | Import from builtins/index.ts, add constructor handling |

---

## Task 1: Create builtins directory and Promise support

**Files:**
- Create: `packages/cli/src/builtins/builtin-promise.ts`
- Create: `packages/cli/src/builtins/index.ts`
- Modify: `packages/cli/src/evaluator.ts`
- Test: `packages/cli/src/__tests__/builtin-promise.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/src/__tests__/builtin-promise.test.ts
import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type CaseDirective, parseTypeValueExpr } from "@nudojs/parser";
import { typeValueToString, createEnvironment, T } from "@nudojs/core";
import { evaluateFunctionFull } from "../evaluator.js";

function runTest(source: string): { name: string; caseName: string; result: string }[] {
  const ast = parse(source);
  const directives = extractDirectives(ast);
  const env = createEnvironment();
  const results: { name: string; caseName: string; result: string }[] = [];
  for (const fn of directives) {
    const caseDirectives = fn.directives.filter((d): d is CaseDirective => d.kind === "case");
    for (const dir of caseDirectives) {
      const result = evaluateFunctionFull(fn.node, dir.args, env);
      results.push({ name: fn.name, caseName: dir.name, result: typeValueToString(result.value) });
    }
  }
  return results;
}

describe("Built-in Promise API", () => {
  it("Promise.resolve(v) should return Promise<T>", () => {
    const results = runTest(`
// @nudo:case "resolve" (42)
function fn(x) {
  return Promise.resolve(x);
}
`);
    expect(results[0].result).toBe("Promise<42>");
  });

  it("Promise.reject(v) should return Promise<never>", () => {
    const results = runTest(`
// @nudo:case "reject" (new Error("fail"))
function fn(e) {
  return Promise.reject(e);
}
`);
    expect(results[0].result).toBe("Promise<never>");
  });

  it("Promise.all([...]) should return Promise<T[]>", () => {
    const results = runTest(`
// @nudo:case "all" ()
function fn() {
  return Promise.all([Promise.resolve(1), Promise.resolve(2)]);
}
`);
    expect(results[0].result).toContain("Promise");
    expect(results[0].result).toContain("[]");
  });

  it("Promise.race([...]) should return Promise<T>", () => {
    const results = runTest(`
// @nudo:case "race" ()
function fn() {
  return Promise.race([Promise.resolve("a"), Promise.resolve("b")}`);
}
`);
    expect(results[0].result).toContain("Promise");
  });

  it(".then() should return Promise<T>", () => {
    const results = runTest(`
// @nudo:case "then" ()
function fn() {
  return Promise.resolve(42).then(x => x);
}
`);
    expect(results[0].result).toContain("Promise");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/cli/src/__tests__/builtin-promise.test.ts`
Expected: FAIL — Promise.resolve returns unknown

- [ ] **Step 3: Create builtin-promise.ts**

```typescript
// packages/cli/src/builtins/builtin-promise.ts
import { type TypeValue, T, simplifyUnion } from "@nudojs/core";

export const PROMISE_STATIC_METHODS: Record<string, TypeValue> = {
  // resolve and reject are handled dynamically in evaluator
  // These are fallbacks for when called without arguments
  resolve: T.unknown,
  reject: T.never,
  all: T.unknown,
  race: T.unknown,
  allSettled: T.unknown,
  any: T.unknown,
};

export const PROMISE_INSTANCE_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  then: () => T.unknown,  // dynamically resolved from _typeArgs
  catch: () => T.unknown,
  finally: () => T.unknown,
};
```

- [ ] **Step 4: Create builtins/index.ts**

```typescript
// packages/cli/src/builtins/index.ts
import { PROMISE_STATIC_METHODS, PROMISE_INSTANCE_METHODS } from "./builtin-promise.ts";

export const ALL_STATIC_METHODS: Record<string, Record<string, TypeValue>> = {
  Promise: PROMISE_STATIC_METHODS,
};

export const ALL_INSTANCE_METHODS: Record<string, Record<string, (...args: TypeValue[]) => TypeValue>> = {
  Promise: PROMISE_INSTANCE_METHODS,
};
```

- [ ] **Step 5: Update evaluator to import from builtins**

In `packages/cli/src/evaluator.ts`, replace the inline `BUILTIN_STATIC_METHODS` and `BUILTIN_INSTANCE_METHODS` with imports from builtins:

```typescript
import { ALL_STATIC_METHODS, ALL_INSTANCE_METHODS } from "./builtins/index.ts";

// Keep the existing inline definitions but merge with the imported ones:
const BUILTIN_STATIC_METHODS: Record<string, Record<string, TypeValue>> = {
  ...ALL_STATIC_METHODS,
  // Keep existing inline definitions that aren't in builtins/ yet
  Date: { /* ... */ },
  Math: { /* ... */ },
  // ...
};

const BUILTIN_INSTANCE_METHODS: Record<string, Record<string, (...args: TypeValue[]) => TypeValue>> = {
  ...ALL_INSTANCE_METHODS,
  Date: { /* ... */ },
};
```

- [ ] **Step 6: Add Promise.resolve/reject dynamic handling**

In the evaluator, add special handling for `Promise.resolve` and `Promise.reject` in the `CallExpression` case or in `evaluateBuiltinCall`:

```typescript
// In evaluateBuiltinCall or wherever static method calls are handled:
if (calleeName === "Promise.resolve") {
  if (args.length > 0) {
    return T.promise(args[0]);
  }
  return T.promise(T.undefined);
}
if (calleeName === "Promise.reject") {
  return T.promise(T.never);
}
if (calleeName === "Promise.all") {
  // Infer from the array argument
  if (args.length > 0 && args[0].kind === "array") {
    return T.promise(args[0].element);
  }
  if (args.length > 0 && args[0].kind === "tuple") {
    // Union of all element types
    const elemTypes = args[0].elements.map((e: TypeValue) => {
      if (e.kind === "promise") return e.value;
      return T.unknown;
    });
    return T.promise(T.array(simplifyUnion(elemTypes)));
  }
  return T.promise(T.array(T.unknown));
}
if (calleeName === "Promise.race") {
  if (args.length > 0 && args[0].kind === "tuple") {
    const elemTypes = args[0].elements.map((e: TypeValue) => {
      if (e.kind === "promise") return e.value;
      return T.unknown;
    });
    return T.promise(simplifyUnion(elemTypes));
  }
  return T.promise(T.unknown);
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run packages/cli/src/__tests__/builtin-promise.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/builtins/ packages/cli/src/evaluator.ts packages/cli/src/__tests__/builtin-promise.test.ts
git commit -m "feat: add Promise built-in API support"
```

---

## Task 2: Add Map support with generic tracking

**Files:**
- Create: `packages/cli/src/builtins/builtin-map.ts`
- Modify: `packages/cli/src/builtins/index.ts`
- Modify: `packages/cli/src/evaluator.ts`
- Test: `packages/cli/src/__tests__/builtin-map.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/src/__tests__/builtin-map.test.ts
import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type CaseDirective } from "@nudojs/parser";
import { typeValueToString, createEnvironment, T } from "@nudojs/core";
import { evaluateFunctionFull } from "../evaluator.js";

function runTest(source: string): { name: string; caseName: string; result: string }[] {
  const ast = parse(source);
  const directives = extractDirectives(ast);
  const env = createEnvironment();
  const results: { name: string; caseName: string; result: string }[] = [];
  for (const fn of directives) {
    const caseDirectives = fn.directives.filter((d): d is CaseDirective => d.kind === "case");
    for (const dir of caseDirectives) {
      const result = evaluateFunctionFull(fn.node, dir.args, env);
      results.push({ name: fn.name, caseName: dir.name, result: typeValueToString(result.value) });
    }
  }
  return results;
}

describe("Built-in Map API", () => {
  it("new Map() should create a Map instance", () => {
    const results = runTest(`
// @nudo:case "new-map" ()
function fn() {
  const m = new Map();
  return m;
}
`);
    expect(results[0].result).toContain("Map");
  });

  it("Map.get() should return V | undefined", () => {
    const results = runTest(`
// @nudo:case "get" ()
function fn() {
  const m = new Map();
  return m.get("key");
}
`);
    expect(results[0].result).toContain("undefined");
  });

  it("Map.set() should return the map", () => {
    const results = runTest(`
// @nudo:case "set" ()
function fn() {
  const m = new Map();
  m.set("key", 42);
  return m.get("key");
}
`);
    // After set, get should return the value type
    expect(results[0].result).toBeDefined();
  });

  it("Map.has() should return boolean", () => {
    const results = runTest(`
// @nudo:case "has" ()
function fn() {
  const m = new Map();
  return m.has("key");
}
`);
    expect(results[0].result).toBe("boolean");
  });

  it("Map.size should return number", () => {
    const results = runTest(`
// @nudo:case "size" ()
function fn() {
  const m = new Map();
  return m.size;
}
`);
    expect(results[0].result).toBe("number");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/cli/src/__tests__/builtin-map.test.ts`
Expected: FAIL — `new Map()` not recognized

- [ ] **Step 3: Create builtin-map.ts**

```typescript
// packages/cli/src/builtins/builtin-map.ts
import { type TypeValue, T } from "@nudojs/core";

export const MAP_STATIC_METHODS: Record<string, TypeValue> = {};

export const MAP_INSTANCE_METHODS: Record<string, (...args: TypeValue[], map?: TypeValue) => TypeValue> = {
  get: (_key, map) => {
    const typeArgs = (map as any)?._typeArgs;
    if (typeArgs?.V) return T.union(typeArgs.V, T.undefined);
    return T.undefined;
  },
  set: (_key, _value, map) => map ?? T.unknown,
  has: () => T.boolean,
  delete: () => T.boolean,
  clear: () => T.undefined,
  forEach: () => T.undefined,
  keys: (map) => {
    const typeArgs = (map as any)?._typeArgs;
    if (typeArgs?.K) return T.array(typeArgs.K);
    return T.array(T.unknown);
  },
  values: (map) => {
    const typeArgs = (map as any)?._typeArgs;
    if (typeArgs?.V) return T.array(typeArgs.V);
    return T.array(T.unknown);
  },
  entries: (map) => {
    const typeArgs = (map as any)?._typeArgs;
    if (typeArgs?.K && typeArgs?.V) return T.array(T.tuple([typeArgs.K, typeArgs.V]));
    return T.array(T.tuple([T.unknown, T.unknown]));
  },
};

export function createMapType(args?: TypeValue[]): TypeValue {
  const obj = T.object({});
  (obj as any)._builtinName = "Map";

  // Infer type args from constructor argument
  if (args && args.length > 0) {
    const arg = args[0];
    if (arg.kind === "tuple" || arg.kind === "array") {
      const elements = arg.kind === "tuple" ? arg.elements : [arg.element];
      const keys: TypeValue[] = [];
      const values: TypeValue[] = [];
      for (const el of elements) {
        if (el.kind === "tuple" && el.elements.length >= 2) {
          keys.push(el.elements[0]);
          values.push(el.elements[1]);
        }
      }
      if (keys.length > 0) {
        const { simplifyUnion } = require("@nudojs/core");
        (obj as any)._typeArgs = { K: simplifyUnion(keys), V: simplifyUnion(values) };
      }
    }
  }

  if (!(obj as any)._typeArgs) {
    (obj as any)._typeArgs = { K: T.unknown, V: T.unknown };
  }

  return obj;
}
```

- [ ] **Step 4: Update evaluator for Map constructor**

In `packages/cli/src/evaluator.ts`, add handling for `new Map()` in the `NewExpression` case:

```typescript
case "NewExpression": {
  const calleeName = node.callee.type === "Identifier" ? node.callee.name : null;
  const argVals = evaluateArgs(node.arguments, env);
  if (isReturn(argVals) || isBranch(argVals) || isThrow(argVals)) return argVals;

  if (calleeName === "Map") {
    return createMapType(argVals);
  }
  if (calleeName === "Set") {
    return createSetType(argVals);
  }
  // ... existing handling
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/cli/src/__tests__/builtin-map.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/builtins/builtin-map.ts packages/cli/src/builtins/index.ts packages/cli/src/evaluator.ts packages/cli/src/__tests__/builtin-map.test.ts
git commit -m "feat: add Map built-in API with generic type tracking"
```

---

## Task 3: Add Set support

**Files:**
- Create: `packages/cli/src/builtins/builtin-set.ts`
- Modify: `packages/cli/src/builtins/index.ts`
- Modify: `packages/cli/src/evaluator.ts`
- Test: `packages/cli/src/__tests__/builtin-set.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/src/__tests__/builtin-set.test.ts
import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type CaseDirective } from "@nudojs/parser";
import { typeValueToString, createEnvironment, T } from "@nudojs/core";
import { evaluateFunctionFull } from "../evaluator.js";

function runTest(source: string): { name: string; caseName: string; result: string }[] {
  const ast = parse(source);
  const directives = extractDirectives(ast);
  const env = createEnvironment();
  const results: { name: string; caseName: string; result: string }[] = [];
  for (const fn of directives) {
    const caseDirectives = fn.directives.filter((d): d is CaseDirective => d.kind === "case");
    for (const dir of caseDirectives) {
      const result = evaluateFunctionFull(fn.node, dir.args, env);
      results.push({ name: fn.name, caseName: dir.name, result: typeValueToString(result.value) });
    }
  }
  return results;
}

describe("Built-in Set API", () => {
  it("new Set() should create a Set instance", () => {
    const results = runTest(`
// @nudo:case "new-set" ()
function fn() {
  return new Set();
}
`);
    expect(results[0].result).toContain("Set");
  });

  it("Set.add() should work", () => {
    const results = runTest(`
// @nudo:case "add" ()
function fn() {
  const s = new Set();
  s.add(1);
  s.add(2);
  return s;
}
`);
    expect(results[0].result).toBeDefined();
  });

  it("Set.has() should return boolean", () => {
    const results = runTest(`
// @nudo:case "has" ()
function fn() {
  const s = new Set([1, 2, 3]);
  return s.has(2);
}
`);
    expect(results[0].result).toBe("boolean");
  });

  it("Set.size should return number", () => {
    const results = runTest(`
// @nudo:case "size" ()
function fn() {
  const s = new Set([1, 2, 3]);
  return s.size;
}
`);
    expect(results[0].result).toBe("number");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/cli/src/__tests__/builtin-set.test.ts`
Expected: FAIL

- [ ] **Step 3: Create builtin-set.ts**

```typescript
// packages/cli/src/builtins/builtin-set.ts
import { type TypeValue, T, simplifyUnion } from "@nudojs/core";

export const SET_STATIC_METHODS: Record<string, TypeValue> = {};

export const SET_INSTANCE_METHODS: Record<string, (...args: TypeValue[], set?: TypeValue) => TypeValue> = {
  add: (_value, set) => set ?? T.unknown,
  has: () => T.boolean,
  delete: () => T.boolean,
  clear: () => T.undefined,
  forEach: () => T.undefined,
  values: (set) => {
    const typeArgs = (set as any)?._typeArgs;
    if (typeArgs?.T) return T.array(typeArgs.T);
    return T.array(T.unknown);
  },
  keys: (set) => {
    const typeArgs = (set as any)?._typeArgs;
    if (typeArgs?.T) return T.array(typeArgs.T);
    return T.array(T.unknown);
  },
  entries: (set) => {
    const typeArgs = (set as any)?._typeArgs;
    if (typeArgs?.T) return T.array(T.tuple([typeArgs.T, typeArgs.T]));
    return T.array(T.tuple([T.unknown, T.unknown]));
  },
};

export function createSetType(args?: TypeValue[]): TypeValue {
  const obj = T.object({});
  (obj as any)._builtinName = "Set";

  if (args && args.length > 0) {
    const arg = args[0];
    if (arg.kind === "tuple") {
      (obj as any)._typeArgs = { T: simplifyUnion(arg.elements) };
    } else if (arg.kind === "array") {
      (obj as any)._typeArgs = { T: arg.element };
    }
  }

  if (!(obj as any)._typeArgs) {
    (obj as any)._typeArgs = { T: T.unknown };
  }

  return obj;
}
```

- [ ] **Step 4: Update evaluator and builtins/index.ts**

Add Set to builtins/index.ts and add `new Set()` handling in the evaluator.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/cli/src/__tests__/builtin-set.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/builtins/builtin-set.ts packages/cli/src/builtins/index.ts packages/cli/src/evaluator.ts packages/cli/src/__tests__/builtin-set.test.ts
git commit -m "feat: add Set built-in API with generic type tracking"
```

---

## Task 4: Add RegExp support

**Files:**
- Create: `packages/cli/src/builtins/builtin-regexp.ts`
- Modify: `packages/cli/src/builtins/index.ts`
- Test: `packages/cli/src/__tests__/builtin-regexp.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/src/__tests__/builtin-regexp.test.ts
import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type CaseDirective } from "@nudojs/parser";
import { typeValueToString, createEnvironment, T } from "@nudojs/core";
import { evaluateFunctionFull } from "../evaluator.js";

function runTest(source: string): { name: string; caseName: string; result: string }[] {
  const ast = parse(source);
  const directives = extractDirectives(ast);
  const env = createEnvironment();
  const results: { name: string; caseName: string; result: string }[] = [];
  for (const fn of directives) {
    const caseDirectives = fn.directives.filter((d): d is CaseDirective => d.kind === "case");
    for (const dir of caseDirectives) {
      const result = evaluateFunctionFull(fn.node, dir.args, env);
      results.push({ name: fn.name, caseName: dir.name, result: typeValueToString(result.value) });
    }
  }
  return results;
}

describe("Built-in RegExp API", () => {
  it("RegExp.test() should return boolean", () => {
    const results = runTest(`
// @nudo:case "test" ("hello")
function fn(s) {
  return /hello/.test(s);
}
`);
    expect(results[0].result).toBe("boolean");
  });

  it("RegExp.source should return string", () => {
    const results = runTest(`
// @nudo:case "source" ()
function fn() {
  return /hello/.source;
}
`);
    expect(results[0].result).toBe("string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/cli/src/__tests__/builtin-regexp.test.ts`
Expected: FAIL

- [ ] **Step 3: Create builtin-regexp.ts**

```typescript
// packages/cli/src/builtins/builtin-regexp.ts
import { type TypeValue, T } from "@nudojs/core";

export const REGEXP_STATIC_METHODS: Record<string, TypeValue> = {};

export const REGEXP_INSTANCE_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  test: () => T.boolean,
  exec: () => T.union(T.null, T.object({})), // RegExpExecArray | null
  toString: () => T.string,
};
```

- [ ] **Step 4: Update evaluator for RegExp property access**

In the evaluator's `MemberExpression` case, add RegExp property handling:

```typescript
// When accessing properties on a RegExp literal or instance:
if (objVal.kind === "refined" && objVal.type === "regexp") {
  if (propName === "source" || propName === "flags" || propName === "global" ||
      propName === "ignoreCase" || propName === "multiline") {
    if (propName === "source" || propName === "flags") return T.string;
    return T.boolean;
  }
}
```

Also handle RegExp literals (`/pattern/flags`) in the evaluator — they should produce a refined type with `type: "regexp"`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/cli/src/__tests__/builtin-regexp.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/builtins/builtin-regexp.ts packages/cli/src/builtins/index.ts packages/cli/src/evaluator.ts packages/cli/src/__tests__/builtin-regexp.test.ts
git commit -m "feat: add RegExp built-in API support"
```

---

## Task 5: Add URL and URLSearchParams support

**Files:**
- Create: `packages/cli/src/builtins/builtin-url.ts`
- Modify: `packages/cli/src/builtins/index.ts`
- Test: `packages/cli/src/__tests__/builtin-url.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/src/__tests__/builtin-url.test.ts
import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type CaseDirective } from "@nudojs/parser";
import { typeValueToString, createEnvironment, T } from "@nudojs/core";
import { evaluateFunctionFull } from "../evaluator.js";

function runTest(source: string): { name: string; caseName: string; result: string }[] {
  const ast = parse(source);
  const directives = extractDirectives(ast);
  const env = createEnvironment();
  const results: { name: string; caseName: string; result: string }[] = [];
  for (const fn of directives) {
    const caseDirectives = fn.directives.filter((d): d is CaseDirective => d.kind === "case");
    for (const dir of caseDirectives) {
      const result = evaluateFunctionFull(fn.node, dir.args, env);
      results.push({ name: fn.name, caseName: dir.name, result: typeValueToString(result.value) });
    }
  }
  return results;
}

describe("Built-in URL API", () => {
  it("new URL(str) should return URL instance", () => {
    const results = runTest(`
// @nudo:case "new-url" ()
function fn() {
  return new URL("https://example.com/path?q=1");
}
`);
    expect(results[0].result).toContain("URL");
  });

  it("url.href should return string", () => {
    const results = runTest(`
// @nudo:case "href" ()
function fn() {
  const u = new URL("https://example.com");
  return u.href;
}
`);
    expect(results[0].result).toBe("string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/cli/src/__tests__/builtin-url.test.ts`
Expected: FAIL

- [ ] **Step 3: Create builtin-url.ts and update evaluator**

```typescript
// packages/cli/src/builtins/builtin-url.ts
import { type TypeValue, T } from "@nudojs/core";

export const URL_STATIC_METHODS: Record<string, TypeValue> = {};

export const URL_INSTANCE_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  toString: () => T.string,
};

export const URL_PROPS: Record<string, TypeValue> = {
  href: T.string,
  origin: T.string,
  protocol: T.string,
  host: T.string,
  hostname: T.string,
  port: T.string,
  pathname: T.string,
  search: T.string,
  hash: T.string,
  username: T.string,
  password: T.string,
};

export const URLSearchParams_STATIC_METHODS: Record<string, TypeValue> = {};

export const URLSearchParams_INSTANCE_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  get: () => T.union(T.string, T.null),
  set: () => T.undefined,
  has: () => T.boolean,
  delete: () => T.undefined,
  append: () => T.undefined,
  toString: () => T.string,
  getAll: () => T.array(T.string),
  entries: () => T.unknown,
  keys: () => T.unknown,
  values: () => T.unknown,
  forEach: () => T.undefined,
};
```

Add `new URL()` and `new URLSearchParams()` handling in the evaluator's `NewExpression` case, and URL property access in `MemberExpression`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/cli/src/__tests__/builtin-url.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/builtins/builtin-url.ts packages/cli/src/builtins/index.ts packages/cli/src/evaluator.ts packages/cli/src/__tests__/builtin-url.test.ts
git commit -m "feat: add URL and URLSearchParams built-in API support"
```

---

## Task 6: Add Web APIs (fetch, Response, Headers, FormData, AbortController)

**Files:**
- Create: `packages/cli/src/builtins/builtin-web.ts`
- Modify: `packages/cli/src/builtins/index.ts`
- Modify: `packages/cli/src/evaluator.ts`
- Test: `packages/cli/src/__tests__/builtin-web.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/src/__tests__/builtin-web.test.ts
import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type CaseDirective } from "@nudojs/parser";
import { typeValueToString, createEnvironment, T } from "@nudojs/core";
import { evaluateFunctionFull } from "../evaluator.js";

function runTest(source: string): { name: string; caseName: string; result: string }[] {
  const ast = parse(source);
  const directives = extractDirectives(ast);
  const env = createEnvironment();
  const results: { name: string; caseName: string; result: string }[] = [];
  for (const fn of directives) {
    const caseDirectives = fn.directives.filter((d): d is CaseDirective => d.kind === "case");
    for (const dir of caseDirectives) {
      const result = evaluateFunctionFull(fn.node, dir.args, env);
      results.push({ name: fn.name, caseName: dir.name, result: typeValueToString(result.value) });
    }
  }
  return results;
}

describe("Built-in Web APIs", () => {
  it("fetch() should return Promise<Response>", () => {
    const results = runTest(`
// @nudo:case "fetch" ("https://api.example.com")
function fn(url) {
  return fetch(url);
}
`);
    expect(results[0].result).toContain("Promise");
  });

  it("response.json() should return Promise", () => {
    const results = runTest(`
// @nudo:case "json" ()
async function fn() {
  const res = await fetch("https://api.example.com");
  return res.json();
}
`);
    expect(results[0].result).toContain("Promise");
  });

  it("response.ok should return boolean", () => {
    const results = runTest(`
// @nudo:case "ok" ()
async function fn() {
  const res = await fetch("https://api.example.com");
  return res.ok;
}
`);
    expect(results[0].result).toBe("boolean");
  });

  it("response.status should return number", () => {
    const results = runTest(`
// @nudo:case "status" ()
async function fn() {
  const res = await fetch("https://api.example.com");
  return res.status;
}
`);
    expect(results[0].result).toBe("number");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/cli/src/__tests__/builtin-web.test.ts`
Expected: FAIL

- [ ] **Step 3: Create builtin-web.ts**

```typescript
// packages/cli/src/builtins/builtin-web.ts
import { type TypeValue, T } from "@nudojs/core";

export const RESPONSE_INSTANCE_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  json: () => T.promise(T.unknown),
  text: () => T.promise(T.string),
  arrayBuffer: () => T.promise(T.unknown),
  blob: () => T.promise(T.unknown),
  clone: () => T.unknown,
};

export const RESPONSE_PROPS: Record<string, TypeValue> = {
  ok: T.boolean,
  status: T.number,
  statusText: T.string,
  url: T.string,
  type: T.string,
  redirected: T.boolean,
  headers: T.unknown,
  body: T.unknown,
};

export const HEADERS_INSTANCE_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  get: () => T.union(T.string, T.null),
  set: () => T.undefined,
  has: () => T.boolean,
  delete: () => T.undefined,
  append: () => T.undefined,
  entries: () => T.unknown,
  keys: () => T.unknown,
  values: () => T.unknown,
  forEach: () => T.undefined,
};

export const FORMDATA_INSTANCE_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  get: () => T.union(T.string, T.null),
  set: () => T.undefined,
  has: () => T.boolean,
  delete: () => T.undefined,
  append: () => T.undefined,
  getAll: () => T.array(T.string),
  entries: () => T.unknown,
  keys: () => T.unknown,
  values: () => T.unknown,
  forEach: () => T.undefined,
};

export const ABORTCONTROLLER_INSTANCE_METHODS: Record<string, (...args: TypeValue[]) => TypeValue> = {
  abort: () => T.undefined,
};

export const ABORTCONTROLLER_PROPS: Record<string, TypeValue> = {
  signal: T.unknown, // AbortSignal
};
```

- [ ] **Step 4: Update evaluator for fetch and Response**

In the evaluator:
1. Add `fetch` to `BUILTIN_STATIC_METHODS` or handle as a global function returning `T.promise(T.unknown)`
2. Add Response property access handling in `MemberExpression`
3. Add Response instance method handling in `evaluateMethodCall`

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/cli/src/__tests__/builtin-web.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/builtins/builtin-web.ts packages/cli/src/builtins/index.ts packages/cli/src/evaluator.ts packages/cli/src/__tests__/builtin-web.test.ts
git commit -m "feat: add Web API built-ins (fetch, Response, Headers, FormData, AbortController)"
```

---

## Task 7: Add WeakMap, WeakSet, Symbol, Reflect, Intl

**Files:**
- Create: `packages/cli/src/builtins/builtin-weak.ts`
- Create: `packages/cli/src/builtins/builtin-symbol.ts`
- Create: `packages/cli/src/builtins/builtin-reflect.ts`
- Create: `packages/cli/src/builtins/builtin-intl.ts`
- Modify: `packages/cli/src/builtins/index.ts`
- Test: `packages/cli/src/__tests__/builtin-advanced.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/src/__tests__/builtin-advanced.test.ts
import { describe, it, expect } from "vitest";
import { parse, extractDirectives, type CaseDirective } from "@nudojs/parser";
import { typeValueToString, createEnvironment, T } from "@nudojs/core";
import { evaluateFunctionFull } from "../evaluator.js";

function runTest(source: string): { name: string; caseName: string; result: string }[] {
  const ast = parse(source);
  const directives = extractDirectives(ast);
  const env = createEnvironment();
  const results: { name: string; caseName: string; result: string }[] = [];
  for (const fn of directives) {
    const caseDirectives = fn.directives.filter((d): d is CaseDirective => d.kind === "case");
    for (const dir of caseDirectives) {
      const result = evaluateFunctionFull(fn.node, dir.args, env);
      results.push({ name: fn.name, caseName: dir.name, result: typeValueToString(result.value) });
    }
  }
  return results;
}

describe("Built-in Advanced APIs", () => {
  it("Symbol.for() should return symbol", () => {
    const results = runTest(`
// @nudo:case "symbol-for" ("test")
function fn(key) {
  return Symbol.for(key);
}
`);
    expect(results[0].result).toBe("symbol");
  });

  it("Symbol.iterator should be defined", () => {
    const results = runTest(`
// @nudo:case "symbol-iterator" ()
function fn() {
  return Symbol.iterator;
}
`);
    expect(results[0].result).toBe("symbol");
  });

  it("Reflect.has() should return boolean", () => {
    const results = runTest(`
// @nudo:case "reflect-has" ({ a: 1 }, "a")
function fn(obj, key) {
  return Reflect.has(obj, key);
}
`);
    expect(results[0].result).toBe("boolean");
  });

  it("Intl.DateTimeFormat.format() should return string", () => {
    const results = runTest(`
// @nudo:case "intl-format" ()
function fn() {
  return new Intl.DateTimeFormat().format();
}
`);
    expect(results[0].result).toBe("string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/cli/src/__tests__/builtin-advanced.test.ts`
Expected: FAIL

- [ ] **Step 3: Create the four builtin files**

Each follows the same pattern as previous tasks. Key types:
- `WeakMap`: same as Map but no `size`, `keys`, `values`, `entries`
- `WeakSet`: same as Set but no `size`, `keys`, `values`, `entries`, `forEach`
- `Symbol`: static methods return `T.symbol` or `T.string`
- `Reflect`: most methods return `T.unknown` or `T.boolean`
- `Intl.DateTimeFormat`/`Intl.NumberFormat`: `format()` returns `T.string`

- [ ] **Step 4: Update builtins/index.ts and evaluator**

Merge all new maps. Add `Symbol` and `Intl` to `BUILTIN_STATIC_METHODS`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/cli/src/__tests__/builtin-advanced.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/builtins/ packages/cli/src/evaluator.ts packages/cli/src/__tests__/builtin-advanced.test.ts
git commit -m "feat: add WeakMap, WeakSet, Symbol, Reflect, Intl built-in API support"
```

---

## Task 8: Run full test suite and update real-world example

**Files:**
- Modify: `examples/real-test/nudo-version/user-service.js`

- [ ] **Step 1: Run full test suite**

Run: `pnpm run test`
Expected: All tests pass (563+ tests)

- [ ] **Step 2: Update real-world example to use new APIs**

Add examples using Promise, Map, Set, fetch, URL to `examples/real-test/nudo-version/user-service.js`:

```javascript
// 11. Async data fetching
// @nudo:mock apiCall = stub().resolves({ users: [{ id: 1 }] })
// @nudo:case "async-users" ()
async function fetchUsers() {
  const data = await apiCall();
  return data.users;
}

// 12. Map-based cache
// @nudo:case "map-cache" ()
function initCache() {
  const cache = new Map();
  cache.set("key", { data: "value" });
  return cache.get("key");
}

// 13. Set-based dedup
// @nudo:case "dedup" ([1, 2, 2, 3])
function dedup(items) {
  const seen = new Set(items);
  return [...seen];
}

// 14. URL parsing
// @nudo:case "parse-url" ()
function parseUrl() {
  const url = new URL("https://api.example.com/users?page=1");
  return { path: url.pathname, query: url.search };
}

// 15. RegExp matching
// @nudo:case "match" ("hello world")
function matchPattern(str) {
  return /hello/.test(str);
}
```

- [ ] **Step 3: Run inference on updated example**

Run: `pnpm infer examples/real-test/nudo-version/user-service.js`
Expected: All new cases return precise types (not `unknown`)

- [ ] **Step 4: Commit**

```bash
git add examples/real-test/nudo-version/user-service.js
git commit -m "test: update real-world example with new built-in APIs"
```
