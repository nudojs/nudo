---
"@nudojs/core": patch
"@nudojs/service": patch
"nudojs": patch
"@nudojs/harvester": patch
"vite-plugin-nudo": patch
---

Close the BUG-174..238 audit batch: one judgment per fact across the evaluator, projection faces, migration tools, and reporting surfaces.

**Evaluation and domains** — rest tuples keep their fixed prefix instead of collapsing to a single array element type; TS `null` / `undefined` / `void` annotations map to terms instead of degrading the whole annotation to `any`; optional parameters (`x?: T`) enter the entry domain with `undefined`; arrow parameters inherit contextual function types; `Object.prototype.toString` covers union / any / unknown receivers; computed array keys consult `Array.prototype`; `Object.assign` propagates the open-key-set marker; Proxy `ownKeys` honours trap-only and non-enumerable keys; `Map` / `Set` `forEach` forwards `thisArg`; `URLSearchParams.forEach` runs its callback; reflector symbol keys stay symbols; sparse-array descriptors skip holes and honour `enumerable`; typed arrays expose `@@iterator`.

**Classes and effects** — `X.prototype` identity is keyed by class binding, so same-named classes in different scopes/modules no longer share prototype writes; `class X extends Array` keeps the subclass instance face; generator `.throw()` into a `try/catch` records may-throw only when the transpile-time catch facts allow a rethrow (`YIELD_CATCH_THROWS`); `JSON.parse(<abstract text>)` records `SyntaxError`; union receivers record the nullish arm only for declared entry domains, keeping guard-derived slot reads quiet.

**Dts / export** — overload sets are emitted without implementation signatures (free functions) and with full overload sets (methods); inline-object method names, same-module enum type refs, and string/template literal types survive resolvability checks; default parameter values are type evidence; contract `any()` slots no longer mint generic parameters; namespace constants and annotated `const f: T = …` keep their declared types; inherited members substitute base type arguments and preserve `private` / `protected`; constructor overloads and parameter-property optionality, symbol members, and type-only export aliases are emitted; observed return values / guard-zod domains are widened to base types (including a single call-site sample), while asserted `@nudo:case` literals stay exact.

**Migrate / strip** — folded YAML scalars preserve more-indented command lines; `migrate verify --with-tsc` rejects files outside the tsconfig project instead of reporting `ok`; strip keeps imports referenced from destructuring defaults, elides proven type-only re-exports, and surfaces package-specifier retain notes.

**Reporting / tooling** — the per-function analysis cache no longer replays pre-synthesis snapshots or stale diagnostics across case modes; `health` prints the drift line alongside file errors and no longer labels a rewrite as `+1 new`; directive witnesses render as `debug "call@…"` instead of masquerading as call sites; `contract --from-dts --write` writes alias-shaped drafts; `contract --emit --json --dry-run` carries `dryRun: true` with an empty `written` list; `.d.mts` / `.d.cts` resolve `.mjs` / `.cjs` runtime siblings; vite `include` literals use the same path-shaped matcher as the service watcher.

Compatibility notes: `@nudojs/core/internal` gains `absTypeForTsTypeText`; `@nudojs/service/emit` gains the observation-widening helpers used by guard/zod/standard. Observed return types in generated `.d.ts` and runtime validators are now wider by design (a call-site sample is not a function domain); asserted cases keep exact literals. These are additive or stricter-correctness changes, not API removals.
