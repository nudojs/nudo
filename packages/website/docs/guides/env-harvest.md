---
slug: /guides/env-harvest
description: Where dependency types come from — fixed es/web/node envs, silent @types auto-fill, and when to mock.
---

# Dependency types

Nudo types Node/Web and third-party packages without a user-facing harvest command. Product env is a **fixed set** (`es` / `web` / `node` via `@nudojs/env`); everything else is either silent analysis fill-in or your own mock.

## How types arrive

| Import target | What happens |
|---|---|
| Built-in APIs (`path`, `fs`, DOM…) | Handwritten `@nudojs/env` (`es` / `web` / `node`) |
| JS source package ships usable `.js`/`.mjs` | Analysis **executes** the source (Abs evaluator) |
| `@types/*` or package-shipped `.d.ts` | Analysis **auto-harvests** declarations into env modules — no CLI step |
| Neither source nor types | Empty modules → use `@nudo:mock` or a path-based `/// @nudo:env` |

Harvest is **not** a product verb. Third-party `@types` fill in during `nudo check` / `nudo test` / LSP analysis; handwritten `@nudojs/env` wins on overlapping module keys and export names.

## Why @types → Abs env

Without types, a dependency import is an empty module: every call into it degrades toward `any` / `entry@` faces, and your own signatures lose the precision the dependency actually has. Harvesting declarations into Abs env modules lets analysis *use* those signatures — call results flow through algebra instead of collapsing. The page title's "harvest" is what analysis does for you; there is no `nudo harvest` command.

## Worked workflow

### 1. Declare the runtime (named env)

Built-in surfaces come from the fixed `es` / `web` / `node` set. File-level:

```javascript
/// @nudo:env node
import { join } from "node:path";

export function buildKey(dir, name) {
  const p = join(dir, name);
  return p + ".md";
}
```

Or once per project in `package.json` (file directives merge as a union):

```json
{
  "nudo": {
    "env": ["node"]
  }
}
```

`web` and `node` automatically include `es`.

### 2. Let @types fill in

Install the types package (or rely on one the dependency already ships):

```bash
npm install -D @types/express
```

No further step. The next analysis run harvests the declarations into env modules. Handwritten `@nudojs/env` still wins on overlapping module keys and export names.

### 3. Run check and read the signatures

```bash
npx nudojs check src/
```

Compare before/after: imports that used to collapse to `any` now show dependency-shaped returns. Call-site cases from `npx nudojs test src/ --from tests/` inherit the same precision.

### 4. Escalate to a path env only for custom surfaces

Named environments are fixed:

```javascript
/// @nudo:env node
```

For a custom surface (domain package, hand-tuned signatures), write or generate an env module and reference it by path:

```javascript
/// @nudo:env ./my-env.ts
```

Path envs export `defineEnv()` and use Abs constructors from `@nudojs/core`. `@nudojs/harvester` can generate that shape from `.d.ts` for **env package authors** — it is a library helper, not something end users run. Example from the harvester API: `harvestDts` + `emitEnvModule` produce a `defineEnv()` module you then reference by path.

## Common pitfalls

- **Resolution rate ≠ soundness.** A high share of resolved symbols says nothing about whether the remaining leaves are modeled — see the boundary below.
- **Handwritten wins on overlap.** If `@nudojs/env` and a harvested `@types` module both define a symbol, the handwritten face is used. That is intentional; do not assume the harvest "updated" a builtin.
- **Path envs load asynchronously.** `nudo check` / `nudo test` and the LSP preload them; the synchronous `analyzeFile` degrades when a file declares a path env.
- **Empty modules are honest, not a bug.** No source and no types means no invention — mock or extend env.

## Honest boundary

**Env / auto-harvest does not replace mocks.** Native runtime callbacks, dynamic `require`, and unmodeled natives can still surface as `unknown` / `entry@` results. Coverage baselines are **not** soundness claims. See [Limits](../concepts/limits.md) and [Language semantics](../concepts/semantics.md).

## When to mock instead of harvest

Mock instead when the API is process-local or heavily dynamic:

```javascript
// @nudo:mock fetch = (url) => ({ ok: true, json: () => ({ id: 1 }) })
```

| Situation | Prefer |
|---|---|
| Package ships `.js` source | Let the evaluator execute it — no mock |
| Package ships `@types` / `.d.ts` | Let auto-harvest fill env |
| Builtin Node/Web API | Named env (`es` / `web` / `node`) |
| Process-local / dynamic / native binding | `@nudo:mock` (or `@nudo:mock-module`) |
| Domain signature you want to pin | Path `/// @nudo:env` (or a sidecar contract on *your* function) |

Prefer call sites or a contract over a mock when the obligation is on *your* API — functions with no call-site usage fall back to `entry@` (honest `any`).

### Mock boundary checklist

Source: [env / Node coverage baseline](https://github.com/nudojs/nudo/blob/main/docs/reports/env-coverage-baseline.md) (resolution rate is **not** a soundness guarantee). These leaves stay thin or mock-required today — mock them when analysis quality matters:

| Category / probe | Why it is thin | What to do |
|---|---|---|
| `child_process.spawn*` / native process spawn | No side-effect simulation; `ChildProcess` is signature-level | `@nudo:mock` the call, or accept the declared shape |
| Stream machine callbacks (Transform internals) | `data` / `error` events are machine-driven ([limits](../concepts/limits.md)) | Mock the payloads you depend on |
| Dynamic `require` / computed module graphs | Module graph is not static | `@nudo:mock-module` or a path `/// @nudo:env` |
| Native addons / bindings | Not evaluated | Mock the binding surface |
| Dual-entry browser/node variants | Call-site records do not cross files | Mock the other entry, or analyze each side separately |
| Signature-level `any` leaves (`util.format`, `util.inspect`, `util.types.isDate`, `assert.*`) | Resolved, but the format still mentions `any` | Accept the leaf, or mock for a tighter face |

## Next

- [Directives — `@nudo:env`](../concepts/directives.md)
- [API · harvester](../api/harvester.md) (env-authoring library)
- [Limits](../concepts/limits.md) — where analysis stops being precise
- [Recipes](./recipes.md)
