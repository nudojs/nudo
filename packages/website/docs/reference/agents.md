---
slug: /reference/agents
description: Nudo for AI coding agents — product rules, Day0 commands, machine-readable diagnostics, MCP/LSP pointers.
---

# Agents

Nudo is designed to be **agent-actionable**: stable verbs, stable diagnostic IDs, and a published machine entrypoint.

- Machine entrypoint: [agents.md](https://nudojs.github.io/nudo/agents.md)
- Curated index: [llms.txt](https://nudojs.github.io/nudo/llms.txt)
- Source markdown: monorepo `packages/website/docs/**` via raw GitHub URLs listed in llms.txt

## Paste-into-agent block

```text
Read https://nudojs.github.io/nudo/agents.md and set up Nudo in this project.
Primary gate: npx nudojs check <path>.
Contracts are *.nudo.js / @nudo:contract.
Do not invent body-AST obligations. @nudo:case is debug-only.
Entry params print as any; unknown = inference failed.
Leaving tsc: npx nudojs migrate status|strip|verify|retire (exit is retire).
```


## Product rules (must not violate)

| Rule | Detail |
|------|--------|
| Verbs | `check` \| `test` \| `contract` \| `export` \| `health` \| `migrate` only |
| No `infer` verb | Observation = check signatures + IDE |
| Contracts | Sidecar / `@nudo:contract`; `@nudo:contract` is alias |
| `@nudo:case` | Debug / `nudo test` / LSP only |
| any vs unknown | Entry `any`; `unknown` = inference failed |
| check vs export | check validates; export projects (lossy) |
| L1 / L2 | L1 contracts; L2 entry may-throw; ignoreThrows ≠ L1 |
| No body-AST slot invention | Obligations come from contracts or call-site facts |
| HOF promote ≠ check error | Body-usage promotion is a warning suggestion |
| migrate is one-way | `status` → `strip` → `verify` → `retire` tsc; coexistence is not the end state |

## Day 0 / Day 1 commands

```bash
npx nudojs check <path>
npx nudojs check <path> --what-if raw=string --target size   # AI3: assume → observe
npx nudojs contract <path>
npx nudojs contract --draft <path> [--write] [--json]        # AI4: draftSource + unified diff
npx nudojs export <path> --format dts --out dist/types
npx nudojs health <path>
npx nudojs migrate status <pkg>
npx nudojs migrate retire <pkg> --dry-run
```

`nudo test` is optional debug case reporting — not the primary product narrative.

## Config (package.json)

```json
{
  "nudo": {
    "analysis": { "mode": "exports" },
    "check": { "ignoreThrows": ["TypeError"], "entryThrows": "error" },
    "contract": { "autoBind": true }
  }
}
```

Default analysis mode is `"exports"` (export / sidecar / directives); named-path CLI `check` still analyzes that file. Full config surface: [CLI Reference](/docs/api/cli-reference).

## Machine-readable diagnostics

```bash
npx nudojs check file.js --json
```

Human face uses `actual ⊭ expected` on Abs. Stable codes: [Diagnostics glossary](/docs/reference/diagnostics).

Each `issues[]` entry may carry **`actions[]`** (AI1) — prefer these over parsing `suggestion` prose:

```json
{
  "code": "nudo:constraint-violated",
  "actual": "0  #exact",
  "expected": "ms > 0",
  "actions": [
    { "kind": "callsite", "label": "use a value satisfying the constraint", "hint": "ms > 0" },
    { "kind": "relax", "label": "relax the precondition (edit *.nudo.js / @nudo:contract)" },
    { "kind": "draft", "command": "nudo contract --draft", "label": "emit a sidecar draft you can edit" }
  ]
}
```

## Few-shot fix pairs (do this, not that)

Minimal diffs. Prefer `actions[]` on the issue, then apply the matching pair.

### `nudo:constraint-violated` — fix the call site

```js
// bad — actual: 0  #exact  ⊭  expected: ms > 0
setDelay(0);

// good — same contract, value satisfies Pred
setDelay(250);
```

Or **relax** only if `0` is legal product input (edit `*.nudo.js`):

```js
// bad
export const setDelay = fn({ ms: number().gt(0) }, number());
// good
export const setDelay = fn({ ms: number().ge(0) }, number());
```

### `nudo:entry-may-throw` — refine / guard / migrate switch

```js
// bad — L2: property 'name' on any (unconstrained value)
export function getName(user) {
  return user.name;
}

// good — declare the entry shape (sidecar / refine)
// file.nudo.js
export const getName = fn({ user: shape({ name: string() }) }, string());
```

Migration-only escape (not a type fix): `npx nudojs check --ignore-throws TypeError`.

### `nudo:unknown-inference` / `nudo:opaque-result` — make the face computable, never invent

```js
// bad — call into an unmodeled native; return face is true unknown
export function fmt(v) {
  return __nudoMissingNative(v);
}

// good — computable body (or add call-site evidence)
export function fmt(v) {
  return String(v);
}
```

Do **not** annotate `@returns string` to silence `unknown`. That is the TypeScript lie Nudo refuses.  
`@nudo:mock` is for **imported module** faces (and is still uneven on free globals — prefer a computable body or real evidence).

### `nudo:assign-missing` / `assign-mismatch` — keep the shape

```js
// bad — drops port
export let config = { host: "localhost", port: 8080 };
config = { host: "y" };

// good
config = { host: "y", port: 8080 };
```

### Draft-accept loop (new obligations)

```bash
npx nudojs contract --draft src/app.js   # review only
# copy selected exports into app.nudo.js  ← that accept is when L1 goes live
npx nudojs check src/app.js
```

Never invent body-AST slots. Never rewrite JS → TS “for types”.

## Tooling

| Surface | Docs |
|---------|------|
| LSP package | [`@nudojs/lsp`](/docs/api/lsp) |
| Agent executeCommand | [API · agent](/docs/api/agent) |
| MCP | [Agent integration guide](/docs/guides/agent-integration) |

Do not send server-injected fields (`loadModule`, effective `autoBind`) as JSON-RPC parameters.

## Non-goals for agents

- Do not treat `@nudo:case` as a contract generator
- Do not rewrite JS into TS “for types”
- Do not invent required object slots from body AST
- Do not narrate unconstrained entry params as `unknown`
- Do not present dual `tsc` + `nudo check` as a permanent end state — exit is `migrate retire`

See [Limits](/docs/concepts/limits) · [Glossary](/docs/reference/glossary) · [Recipes](/docs/guides/recipes) · [Migrate from TypeScript](/docs/guides/migrating-from-typescript).

