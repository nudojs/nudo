---
description: Mock external dependencies during evaluation — five @nudo:mock forms (arrow functions, stub helpers, builders, from-module), the single-line rule, and B-path caveats.
---

# Mocking External Dependencies

`@nudo:mock` replaces external dependencies with mocks during evaluation. Use it for `fetch`, file system APIs, or other code Nudo cannot execute directly. (Module-level replacement lives in [@nudo:mock-module](./directives.md#nudo--module-level-mock).)

## Syntax

Five forms are supported. **Every inline expression must fit on a single line** — see the warnings below.

**1. Single-line arrow function.** The body is plain JavaScript; the parameters receive Abs values:

```text
@nudo:mock name = (arg) => body
```

**2. Mock helpers** — `stub()`, `spy()`, `mock()`, chainable with `.returns(...)`, `.resolves(...)`, `.rejects(...)`, `.withArgs(...)`, `.callsFake(...)`:

```text
@nudo:mock name = stub().returns(value)
```

**3. Sinon-style equivalents** — `sinon.stub()` / `sinon.spy()` with the same chains:

```text
@nudo:mock name = sinon.stub().returns(value)
```

**4. Constraint-builder expression** (or a concrete value):

```text
@nudo:mock name = number()
@nudo:mock retries = 3
```

**5. From module** — the module must define a binding with the same name as the mock:

```text
@nudo:mock name from "path"
```

- **name** — The identifier to mock (e.g. `fetch`, `fs`).
- **path** — Path to a module that provides the mock.

**Warning: the expression must be a single line.** The parser only reads up to the end of the line, so a multi-line expression is truncated at its first line and reported as `nudo:mock-invalid`. The following does **not** work:

```text
@nudo:mock fetch = (url) => ({ ok: true,
  json: () => ({ id: 1 })
})
```

The real diagnostics for the truncated line:

```text
[warning] example.js:0:0 Mock expression "(url) => ({ ok: true," could not be parsed as a known pattern (nudo:mock-invalid)
[warning] example.js:10:9 Cannot resolve 'json' on unknown value (nudo:unknown-recv)
```

**Warning: no builder calls inside an arrow-function mock body.** Constraint builders exist only in directive type expressions (case args, `@nudo:skip`, `@nudo:as`, …). Inside a mock body write plain JavaScript — plain objects and closures — or use `stub().returns(...)` / `stub().resolves(...)` helpers instead.

**Warning: an unmocked global is executed for real on the B path.** For B-hosted files (the default for sources without top-level `this.`), the transpiled code calls the actual Node runtime global when no mock binds the name. A built-in like `fetch` therefore receives an abstract value as its URL and crashes the run (`ERR_INVALID_URL`, exit `1`) instead of evaluating to `unknown`. Mock any global your analyzed code calls: `@nudo:mock fetch = (url) => ({ ok: true, json: () => ({ ... }) })`.

## Examples

Mock `fetch` with an arrow function. The body is plain JavaScript on one line:

```javascript verify
/**
 * @nudo:mock fetch = (url) => ({ ok: true, json: () => ({ id: 1, name: "Alice" }) })
 * @nudo:case "user" (1)
 */
async function fetchUser(id) {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
}
```

**Inferred output:**

```text
=== fetchUser ===

  debug "user"  (1) => promise<{ id: 1, name: "Alice" }>
```

A mock helper for resolved promises — `stub().resolves(value)` makes every call return `promise<value>`:

```javascript
/**
 * @nudo:mock fetch = stub().resolves({ ok: true, json: () => ({ id: 1, name: "Alice" }) })
 * @nudo:case "user" (1)
 */
async function fetchUser(id) {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
}
```

**Same result as the arrow mock:** `stub().resolves(value)` wraps `value` in a promise and the object's closure slots are bridged, so this example infers `promise<{ id: 1, name: "Alice" }>` — including the callable `json` slot. Use whichever form reads better. A synchronous helper:

```javascript
/**
 * @nudo:mock getPort = stub().returns(8080)
 * @nudo:case "default" ()
 */
function readPort() {
  return getPort();
}
```

**Inferred output:**

```text
=== readPort ===

  debug "default"  () => 8080
```

A constraint-builder expression binds the name to an abstract domain directly:

```javascript
/**
 * @nudo:mock retries = number()
 * @nudo:case "plan" ()
 */
function plan() {
  return retries + 1;
}
```

**Inferred output:**

```text
=== plan ===

  debug "plan"  () => number
```

From a module — the module must define a binding with the mocked name:

```javascript
/**
 * @nudo:mock fs from "./mocks/fs.js"
 * @nudo:case "read" (string())
 */
function readConfig(path) {
  return fs.readFileSync(path, "utf-8");
}
```

```javascript
// mocks/fs.js
const fs = { readFileSync: (path, encoding) => "{ \"port\": 3000 }" };
```

**Inferred output:**

```text
=== readConfig ===

  debug "read"  (string) => unknown

[warning] read-config.js:6:9 Built-in API "fs" is not covered by Nudo's type inference (nudo:builtin-unknown)
```

**Current limitation:** `from` mocks are not seeded into the B path — and since production analysis is Abs-native (there is no second evaluation IR), the mock is currently dropped everywhere: the name evaluates as an unknown global (`nudo:builtin-unknown`) or, for real Node globals, the bare call is reached directly. The single-line arrow-function form above works; prefer it until `from` is seeded into the B path.
