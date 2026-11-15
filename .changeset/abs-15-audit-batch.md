---
"@nudojs/core": patch
"@nudojs/service": patch
"nudojs": patch
"@nudojs/lsp": patch
---

Close the 34 bugs from the ABS-15 audit, grouped by root cause rather than patched one at a time.

**`check`** — one judgment per decision, so the faces cannot disagree:

- a `.ts` constructor annotation (including parameter properties) is now the instance field's domain, so `constructor(private size: number)` + `area() { return this.size * this.size }` reports `number` instead of an `any`-arithmetic `nudo:entry-may-throw` error while the dts face already said `number`;
- definite throws during module initialization are detected: BigInt/Number mixing, division by a BigInt zero, `in` on a primitive right-hand side, and calling a member an object literal does not have;
- the call-site local binding table records every declaration shape (parameters, `catch`, `for-of`/`in`, `let`/`var`, destructuring) as an explicit "no information" entry, so shadowing no longer reads the module-level `const` (false red) and destructured declarations reach the obligation check (false green);
- a classic `for (const i = 0; …; i++)` head is a `const` again, so the always-throwing step is reported instead of staying green;
- `nudo:capability-denied` joins the check-face diagnostic whitelist, so `nudo check` can report the cause of `unknown` like `nudo test` — gated on the report actually showing an inference failure (`nudo:unknown-inference`), so a plain `module.exports = …` file does not grow a warning about the `module` global while the same exports written as `exports.x` report nothing.
- cross-file evidence from `--from` now resolves the default export name on both sides, so a renamed default import, `import { default as g }` and `ns.default(...)` are no longer silently dropped.

**`nudo export`** — the publish gate is a semantic judgment (`degraded evidence on the published surface AND a declared contract`) instead of a three-code whitelist, with declaration truth taken from `effectiveContract`'s own resolution. Contract-face diagnostics always block; general degradation (`nudo:internal` / `nudo:unknown-inference`) blocks only when it is attributed to an entry that declared a contract (or carries no function, i.e. is module-level). Compatibility: a module whose contract fails to parse (`nudo:contract-syntax`) now blocks the export (exit 1, no artifacts, diagnostics surfaced) instead of publishing an "accepts everything" validator with exit 0; unannotated modules — and unannotated sibling entries — keep publishing and only see the degradation surfaced.

**dts projection** — one resolvability predicate for type names (TS tokens, runtime globals, local classes, mirrored `interface`/`type`, imported names) plus the missing branches it exposed: `export =` for single-value CJS modules, member-wise types for `export default {…}` and arrays, real re-export statements for imported bindings, `extends`/type-parameter clauses on namespace members, and destructured parameters that render as a pattern the source can actually write. Compatibility: `<fn>Input` keys a destructured parameter by its field names rather than the internal `_p0` placeholder, which is not a public name and made the published validator reject the only legal call shape. Two boundaries are pinned: a module that exports a type (`export interface` / `export type`) alongside `module.exports = value` keeps the named-export projection (TS forbids `export =` next to any other exported element, which would make the artifact uncompilable), and an unannotated class getter whose body has more than one `return` projects `unknown` instead of the first return's type (a single-return pick would be narrower than the runtime value).

**LSP** — completion decides the lexical context with a per-character scanner (line and block comments, quotes, templates with `${}` nesting, regex bodies and character classes), so a continuation line inside a multi-line template or comment no longer offers rewrites of the literal; member completion merges the instance/static class member table from core's single class-body scan.

The `check` entry census behind these runs on the semantic binding index (ADR 0001 stage 1), and stage 1 slice 4.3 replaces the publish gate's shadow comparison with the semantic verdict it was measuring. The public `.` export surface is unchanged.
