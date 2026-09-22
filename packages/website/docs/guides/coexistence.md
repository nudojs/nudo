---
slug: /guides/coexistence
description: Run Nudo on JS while TypeScript stays on TS packages — monorepo recipes that do not fight.
---

# Coexistence with TypeScript

Nudo and `tsc` can share a repo. Nudo targets **JavaScript** (and stripped `.ts` sources); it does not replace the TS compiler for `.ts`-first packages.

## Recipe 1: JS packages use Nudo, TS packages use tsc

```
apps/
  web/          # TypeScript → tsc / ts-node
packages/
  legacy-js/    # plain .js → nudo check + Nudo LSP
```

`packages/legacy-js/package.json`:

```json
{
  "nudo": {
    "contract": { "autoBind": true },
    "analysis": { "mode": "exports", "diagnostics": "default" }
  }
}
```

CI for that package:

```bash
npx nudojs check packages/legacy-js/src
```

Do **not** run `nudo check` over `apps/web/**/*.ts` unless you intentionally strip types.

## Recipe 2: Only `src/**/*.js` under Nudo

Recommended `package.json#nudo.analysis` for mixed JS/TS monorepos — this is the **default coexistence recipe** (same table as [LSP Client Matrix](./lsp-clients.md)):

```json
{
  "nudo": {
    "analysis": {
      "include": ["src/**/*.js"],
      "exclude": [
        "**/node_modules/**",
        "**/dist/**",
        "**/coverage/**",
        "**/*.ts",
        "**/*.tsx",
        "**/*.d.ts"
      ],
      "mode": "exports",
      "diagnostics": "default"
    }
  }
}
```

Why these keys:

| Key | Role in a mixed repo |
|-----|----------------------|
| `include` | Path whitelist relative to the project root. Empty (default) = every target path is eligible; in mixed repos **always scope** so tsserver owns `.ts` alone. |
| `exclude` | Always keep `node_modules` / `dist` / `coverage`. Add `**/*.ts` / `**/*.tsx` / `**/*.d.ts` so opening a TS buffer does not schedule Nudo analysis. |
| `mode` | `exports` (shipped default) analyzes export-bearing / sidecar / directive JS. See “When to use directives vs exports” below. |
| `diagnostics` | Display tier for the IDE: `default` = error + warning minus noisy codes; `errors` = errors only; `off` silences the IDE display path (CLI `nudo check` still gates). |

`.ts` files stay with tsc. Nudo LSP provides hover/inlays for opened `.js` files that match `include` **only when** `analysis.mode` is `exports` or `all`.

> **Default note:** `nudo.analysis.mode` defaults to `"exports"` — files with `export`/sidecar/directives are analyzed by the IDE. Set `"all"` for every target path, or `"directives"` for the conservative gate. Named-path CLI commands (`nudo check src/lib.js`) still analyze that file regardless of mode.

### When to use `mode=directives` vs `mode=exports`

| Situation | Recommended mode | Why |
|-----------|------------------|-----|
| Day-to-day monorepo IDE; JS packages are Nudo-owned | `"exports"` (default) | Export-bearing modules enter analysis; plain helper scripts without exports stay quiet. |
| First week onboarding a large JS tree; you only want files that already speak Nudo | `"directives"` | Only files with `@nudo:*` (or a sidecar via autoBind path in check) produce IDE diagnostics; lowest noise while inventory grows. |
| CI / scripts that must cover every JS target path | `"all"` (CLI/watch more than IDE) | Every `.js`/`.mjs`/`.ts` target path is analyzed; pair with tight `include`. |
| You need hover on non-export internals but zero diagnostics | keep `"exports"` + `diagnostics: "off"` for a subtree, or use named-path CLI | Display `off` does not disable `nudo check`. |

## Recipe 3: Gradual contracts

1. Observe first — `nudo check` / `nudo test`; no directives required.
2. When a function needs a CI gate, add a `<file>.nudo.js` sidecar next to it.
3. `nudo check` enforces only **handwritten** sidecars; `@generated` segments are facts + drift, not new obligations.

## Recipe: mixed JS/TS monorepo (no double error storm) {#recipe-mixed-js-ts-no-double-error-storm}

Step-by-step for “I opened my monorepo and now **both** tsserver and Nudo shout”:

1. **Confirm ownership split.** TypeScript owns `.ts`/`.tsx`; Nudo owns Nudo-target JS (`.js`/`.mjs`, and stripped `.ts` only if you intentionally analyze it).
2. **Scope the JS package** with Recipe 2 `include`/`exclude` in the **package** that contains the JS you care about (nearest `package.json` with a `nudo` key wins when the engine walks up).
3. **Start conservative if the tree is large.** Temporarily set `"mode": "directives"` so only annotated files light up; switch back to `"exports"` once include/exclude look right.
4. **Reload the window** (VS Code: *Developer: Reload Window*) so the language server re-reads `package.json#nudo.analysis`. File-watchers also pick up `package.json` changes, but a reload is the reliable step.
5. **Open one known-good JS file** (has `export` under `exports` mode, or a `@nudo:*` directive). You should see **only** Nudo diagnostics for that file, not a second copy of every tsserver error on `.ts` siblings.
6. **Open a `.ts` file next to it.** tsserver reports; Nudo should stay silent if exclude covers `**/*.ts` (or the file simply is not an include match). If Nudo still analyzes TS, your `exclude`/`include` did not land — re-check the package that actually holds a `nudo` key.
7. **If you still see duplicate messages on the same JS line**, they are usually *different tools* (tsserver `checkJs` vs Nudo). Either turn off `checkJs` for that package or keep Nudo on `mode=directives` / `diagnostics=errors` so Nudo stays the narrow contract channel rather than a second checker.
8. **Optional mute:** `"diagnostics": "errors"` or `"off"` on noisy packages; re-enable per package when contracts are ready.

Client matrix Known gaps row that points here: [lsp-clients.md](./lsp-clients.md) — “Secondary-server diagnostics may compete with tsserver noise”.

## What not to do

- Do not expect Nudo to understand TypeScript type syntax (conditional types, `infer`, etc.).
- Do not point both tools at the same `.ts` sources with conflicting severity without splitting paths.
- Do not treat `.d.ts` projection (`nudo export --format dts`) as the source of truth — Abs is; `.d.ts` is a one-way compatibility channel.
- Do not run the IDE on `mode: "all"` across a whole mixed monorepo without `include` — that is how double storms start.

## IDE

Install the Nudo VS Code extension alongside the built-in TS server. They coexist: TS handles `.ts`, Nudo analyzes `.js` according to `nudo.analysis.mode`. **Shipped default is `"exports"`** — files with `export` / sidecar / directives are analyzed in the IDE; set `"all"` for every target path, or `"directives"` to restore the conservative gate.

Maintainer packaging / release notes checklist: [`packages/vscode/RELEASE_CHECKLIST.md`](https://github.com/nudojs/nudo/blob/main/packages/vscode/RELEASE_CHECKLIST.md). Public LSP surface: [`packages/lsp/PUBLIC_API.md`](https://github.com/nudojs/nudo/blob/main/packages/lsp/PUBLIC_API.md).

## See also

- [LSP Client Matrix](./lsp-clients.md) — non-VS Code recipes + Known gaps tracking
- [VS Code Extension](./vscode.md)
- [Versioning & Releases](./versioning.md) — default flips that invent diagnostics are major on 1.x
