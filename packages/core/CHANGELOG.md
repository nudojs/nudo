# @nudojs/core

## 1.13.0

### Minor Changes

- f5c0c6e: Guard-equality path facts and sum anchoring close the normalised-similarity derivation chain (#170) — `@nudo:assume d <= max` now proves `1 - d/max ∈ [0,1]` when `max` comes from `Math.max(a.length, b.length)` and the body guards `max === 0`, with no per-callee sidecar bounds.
  
  - `===` / `!==` on undecided operands now carry symbolic `eq`/`ne` predicates (previously folded to an unconstrained boolean), so `$fork` pushes the equality fact into branch Φ — the else arm of `max === 0 ? … : …` knows `ne(max, 0)`
  - `numericBounds` tightens an endpoint when a `ne(x, n)` fact matches its value: `x ≠ 0 ∧ x ≥ 0 ⇒ x > 0` (cross-source order-independent: the bound and the exclusion may live on the pred and Φ respectively); supplies the strict positive denominator that relational division folding requires
  - `cmp` no longer applies brand `ToPrimitive` unboxing for `eq`/`ne` — strict equality has no coercion (`new Number(5) === 5` stays false)
  - `@nudo:assume` local anchoring descends into fork-join sums: each member's term α-renames to the local's name (on that arm the member's value **is** the local), so a `d = cond ? 0 : Math.max(...)` callee result still matches the lemma; literal members keep their exact identity
  - `0 / x` with a provably non-zero, non-NaN denominator folds to literal `0` — the literal arm of such a sum no longer poisons the joined quotient bounds

## 1.12.0

### Minor Changes

- e4e491f: `@nudo:assume` name resolution extends from parameters only to parameters ∪ top-level `const`/`let`/`var` locals of the anchored function's body (#165).
  
  - names resolve against plain `Identifier` declarators among the body's direct statements — destructuring, nested blocks, and `for`-init declarations stay out; unknown names fail with `nudo:assume-invalid` (`name(s) not bound as parameters or top-level locals`)
  - locals follow SSA semantics — the lemma anchors the bound value at its definition point and applies to the end of the scope; after a reassignment the relevance conservatively lapses (no fold)
  - anchoring activates only in the target function's own frame — callee frames see an empty premise slot, so same-name locals there cannot mismatch
  - constant bounds still belong to sidecars; since a sidecar cannot reach a function's own locals, a local's constant contract goes on the producing callee's return (e.g. a levenshtein sidecar `return number().ge(0)`)

### Patch Changes

- 1881f97: Fix 38 differential bugs (wrong-definite values / false throws / missed throws) found by native-oracle differential testing, plus remove the differential harness's `concrete()` blind spot.
  
  Call-site semantics (Bug 46/55/70/47, F1/F4/F5):
  
  - receiver injection is call-site-correct via the `$call` thisVal channel — dynamically-assigned/re-assigned/computed-key methods bind `this` (no more false always-throw `TypeError`)
  - `super.x = v` (instance methods/ctors, incl. compound + computed) emits `$setSuper`/`$setSuperObj` with native setter-lookup semantics (was: invalid transpiled JS, hard `SyntaxError`)
  - object-literal `async m()` wraps in `$async` (returns a Promise, not the raw body value)
  - computed Symbol-key destructuring (`{[Symbol.iterator]: it} = arr`) binds; nested rest patterns (`...[b, c]`) and catch-param patterns (`catch ([a,b])` / `catch ({v})`) no longer drop bindings; un-lowerable rest LVals fail closed
  
  Object identity & prototype chains (Bug 56/57/58/63/64/65/67/68/71):
  
  - Proxy retains target + dispatches `get`/`has`/`set` traps (`set` returning `false` throws strict `TypeError`); `Array.isArray(proxy-of-array)` → true
  - `arguments` is branded (`Array.isArray(arguments)` → false); error subclasses joined `NAMESPACE_GLOBALS` (`X.prototype.constructor === X`, family `toString` dispatch); `$get(Ctor, "prototype")` returns a memoized proto brand instead of an anonymous obj
  - `instanceof` learns `Object.prototype` terminator (false for everything), class `static [Symbol.hasInstance]`, and `.prototype`-suffixed brand chains (`RangeError.prototype instanceof Error` → true); `Object.getPrototypeOf` handles class values (`B → A`), `extends null` (`A.prototype → null`), and `B.__proto__`
  - array `entries/keys/values` return real iterator objects (isArray false, `.next` callable, spread/for-of exact)
  
  Effects & control flow (Bug 49/51/52/53/54, F2/F3, fork-try join):
  
  - array mutators mutate in place at `$invoke` time — expression-order correct (`s.pop()+s.pop()`), call-receiver receivers persist (`m.get("a").push(1)`); deferred expression-position rebind machinery removed
  - generators: >8-yield sequences no longer truncate; spread/for-of continue from the current position; `.return()`/`.throw()` honor try-context (finally return-override → graded union, catch absorbs, no wrong-definite)
  - async bodies convert throws to definite-rejected promises (`.catch` absorbs; `await` chains reject; thenable adoption); setter bare early-`return;` keeps the receiver
  - `return`/`throw` inside try regions nested in if-arms join correctly (was: folded to fall-through value; also fixes latent callee-frame `loopExits` drops and `NudoReturn` leaks on raw-host call paths)
  
  Builtin throw domains (Bug 59/60/61/62/73, M1–M5):
  
  - `JSON.stringify`: callable replacers invoked per-entry (throwing replacer → definite throw; never silent no-throw); decidable cycles hard-throw `TypeError`; symbol-keyed slots never serialize (literal `"@@x"` string keys still do)
  - `Symbol.for` interns container keys via ToString (`Symbol.for([1]) === Symbol.for("1")`); non-concretizable keys degrade to unknown identity
  - `String.prototype.replace` passes the named-groups object to function replacers (`groups.d` works, no false `TypeError`)
  - `Function.length` stops at the first default/rest param (declarations, expressions, arrows, methods)
  - missed throws fixed: `'' + Object.create(null)`, free `arguments` (ReferenceError), `(5n).toFixed`, `sort` with throwing/impure comparators (effectFree facet; effect-free comparators execute with ES2019 stable-order exact fold), `Object.assign('ab', {0:'x'})`
  - error instances: `name` inherited, `message`/`stack` own non-enumerable (`hasOwnProperty`/`propertyIsEnumerable` native-correct); accessor-form `Symbol.toStringTag` getters invoked by `Object.prototype.toString`
  
  Test harness: differential `concrete()` no longer masks never-results and abstract placeholders — engine-proven throws compare against the native throw domain (FALSE-THROW), native-throw vs engine-value is a new MISSED-THROW category with a `knownMissedThrows` pin ledger (rationale-carrying, loud warnings); 638 stale masking pins removed from `skip-baseline.json`.
  
  Precision residuals (native-exact where native is definite):
  
  - generators: `.throw()` into a returning catch folds `done:true` (catch-facts bits: contains-yield/return/rethrow, yield\*-delegation poisoning — unclassifiable arms stay sound boolean); fresh-generator spread/`Array.from`/destructuring-rest/`yield*` consume the authoritative yield list (exact >8-element tuples, no >8 widening loss)
  - promise chains: definite-fulfilled `.catch` handler is dead code (exact passthrough); effect-free closed `.then`/`.catch`/`.finally` handlers execute synchronously with exact value adoption (`await Promise.resolve(21).then(x => x*2)` → 42); then second-arg joins the rejection arm on two-channel receivers (was dropped — unsound); unsettled state modeled as a first-class `unsettled` facet
  - identity: fresh instance ids (WeakMap side table) — distinct promise/generator/iterator/class-instance/literal objects fold `=== false`; aliases and adopted references stay `true`
  - `super.x += 5` on a closed parent chain folds exact `NaN` (missing proto slot reads `undefined`); static super writes land on the receiver class (native), not the parent
  - static methods model `this` as the class value (`B.m() === B`, arrows capture lexically, `this.y = 5` writes the class, static field initializers see the class); `@@hasInstance` adapter forwards the receiver
  - inherited static member reads walk the constructor's `[[Prototype]]` chain: `class B extends A { }` reads `B.x` / `B.m` / `B.g` (fields incl. computed keys, static blocks, and dynamic `A.y = …` writes; same Abs reference so `B.o === A.o`), multi-level chains, own-shadow first; builtin parents dispatch through the host static channel when `extends` targets a real host builtin (`class B extends Object {}` → `B.keys({a:1})` exact, `class E extends Error {}` → `typeof E.captureStackTrace` is `"function"` — was wrong-exact `"undefined"`); presence (`"m2" in A` / `"x" in B`) uses the static face (instance methods no longer fold `true` on class values, statics no longer fold `false`); instance receivers no longer dispatch statics (`a.staticM()` was folding the static result instead of the native `TypeError`); mock/holed parents degrade to sound unknown/boolean
  - promise executors collect settle calls path-sensitively via a fork-arm token tree: `new Promise((res, rej) => { if (c) res(1); else rej(2); })` folds the two-channel `{inner: 1, rejected: 2}` (the reject arm was silently dropped); same-path sequential settles keep native first-wins; resolving a promise inside a fork arm merges its rejected/unsettled channels into the join face; early executor exits no longer leak the executor scope; chained-then recovery results stay unsettled until the microtask join (was folding the first arm's value)
  - method default parameters bind like function defaults, with the receiver in scope: `m(a = this.v)`, object-method/setter/static/destructured forms, arrow-in-default lexical `this`, `arguments`-reading and rest defaults all fold exact (`$arrRest` now delegates the `Arguments` brand)
  - static field initializers resolve the class's own name: `class C { static n = 3; static x = this === C; }` folds `true` (thunks emit `let <Name> = __this;` mirroring the native class-body lexical binding — inner-class references, named class expressions, shadowing params, and `static name = "custom"` overrides all native-exact)
  - error introspection: `Object.getOwnPropertyDescriptor` on error brands builds exact data descriptors (flags-aware); `Object.hasOwn` folds own-vs-inherited exactly; gOPN returns the native install order (`stack, message[, cause][, errors]`); catch-param payloads gain the `stack` slot (was missing)
  - dev infra: every package gets a package-local vitest config delegating to a shared factory — `cd packages/<p> && ../../node_modules/.bin/vitest` resolves `@nudojs/*` to workspace src (no more stale-dist split-brain)
  
  Final precision wave:
  
  - executor settle-liveness is path-sensitive: a fork arm that ends without a settle call contributes the `unsettled` facet (`new Promise(res => { if (c) res(1); })` no longer folds bare `promise<1>`); exit arms (early return / uncaught throw / swallowed catch) are clocked so join-after-exit settles don't cover them; `await` of an unsettled promise degrades through `$async` (definite awaits stay exact)
  - static and instance method reads are identity-memoized per defining class entry — `B.m === A.m` folds `true` across inheritance, distinct/overridden fold `false`; class values expose `.length` (ctor arity before first default/rest — implicit derived ctors are `0`, matching the native rest-forwarding constructor)
  - extensible host parents beyond Object/Error (ArrayBuffer/URL/DataView/WeakRef/…) dispatch inherited statics through the host channel (`typeof AB.isView` → `"function"`, absent → `undefined`, whitelisted pure calls fold) and construct through `evalBuiltinNew` (`new AB(8).byteLength` → 8); function-expression parents get a stable synthesized identity — `B.prototype.constructor === B`, memoized fn `.prototype` (mutable, expando statics land), chain data-slot reads with own-over-inherited precedence, `new B() instanceof Base` → true
  - static-only members invoked on an instance receiver fold a definite `TypeError` (never result); rebinding the class's own name inside class bodies (methods, statics, accessors, static blocks, field initializers, arrow captures) folds a definite `TypeError` — while the outer class binding stays mutable exactly as native (verified: ESM class bindings are let-like); const names shadowed by params/catch params no longer false-throw
- 1881f97: Fix fork-arm × try-region early-return join: `return`/`throw` inside try/catch/finally nested in an if-arm folded to the fall-through value instead of the arm's early exit.
  
  - `stmtReturns` learned `TryStatement` (finalizer jump-outs cancel, handler/block both-terminal) so try-region returns trigger arm promotion / both-return rewriting
  - arm-thunk returns now signal via `$loopReturn` (`conditionalFlow`), delivered exactly once by `settleForkArms` (double-ret throws joined `NudoReturn`; single-ret enters the exits channel — no longer pre-pushed and double-counted)
  - transpiled function bodies are self-contained: `$catchReturn` absorber keeps raw host calls (`nudo export` .mjs imports, e2e) from leaking `NudoReturn` — also fixes the latent leak for loop-returns
  - `callAtFunctionBoundary` and the compiled-body `$call` path join frame `loopExits` (ret-arm values were silently dropped → wrong-definite, e.g. arrow functions with loop early-returns)
  - a lone ret-arm whose sibling arm throws no longer fabricates a fall-through `undefined` completion (`if (g) return "s"; throw E` was `undefined | "s"`, now `"s"` — the statement has no fall-through path, so the join yields `never`)
- 8466793: Class-surface diagnostics: static-on-instance calls and class-body self-name writes fold exact (P4).
  
  Static-only member on an instance receiver (`class C { static m() {} } new C().m()`):
  
  - native throws `TypeError` (`c.m` is `undefined` — statics live on the constructor, not `X.prototype`); the engine previously degraded to `unknown` (N2 sound stop-gap)
  - now exact: when the class registry proves the member static-only (registered `staticMethods`/`staticAccessors`/`statics`/class-value slots anywhere on the chain) and the instance face provably lacks it (no method/accessor/builtin-brand member on the chain, no same-name instance field, no own receiver slot, no chain hole, not an `Object.prototype` name), `$invoke` throws a definite `TypeError`
  - guards keep everything else unchanged: `c instanceof C` → true, instance-method calls, member reads (`typeof c.m` → `"undefined"`), optional calls (`c.m?.()` short-circuits to `undefined`), ctor-assigned own fn slots, same-name instance fields/getters, prototype-chain instance methods shadowing statics, class-value static dispatch
  
  Class-body self-name binding is immutable (native `CreateImmutableBinding`):
  
  - `C = v` / `C++` inside methods, accessors, static blocks, and field initializers now folds definite `TypeError` (was: silent rebind — N4's documented sound over-approximation); routed through the existing const-assignment channel (`constNames` on class-body member opts)
  - the outer binding stays mutable on purpose: native `class C {}; C = 5` is legal (ClassDeclaration `IsConstantDeclaration` is false — verified on Node 26: no-throw, `C` becomes a number); the engine's outer-`let` emission already matched native and is unchanged, as are `let D = class {}; D = 5` and function-scope classes
  - member writes on the class name (`C.q = v`, compound/update/logical-assign) still rebind through the internal root-rebind path — unaffected
  
  Binding-shadow fixes required by the above (wrong-definite throws, pre-existing for module `const` too):
  
  - function-boundary params are subtracted from inherited const bindings: `const K = 1; function f(K) { K = 5; }` no longer folds `TypeError` (writes the param binding — native no-throw); covers declarations, expressions, arrows (incl. expression bodies), and class methods
  - catch params likewise: `try { … } catch (K) { K = 5; }` with an outer `const K`/class-body name no longer falsely throws

## 1.11.3

### Patch Changes

- 08d7a55: Fix five exec-surface wrong-concrete bugs (80–84) found by differential testing:
  
  - **`#x in obj`** (private-field `in` operator): the left `PrivateName` operand fell through `isExpression` and compiled to `$lit(void 0)`, so the presence test always returned `false`. The `in` arm now emits the mangled `"#x"` key via the shared `privateNameKeySrc` helper (also deduped into member read/assign).
  - **`this.#x += 1`** (private-field compound assignment): the root-non-rebindable branch emitted a simple assignment using the RHS directly, dropping the operation (`+=1` assigned `1`). It now applies `compoundFn` to the current `$get` value, mirroring the member-path branch.
  - **`o + "x"` with a `Symbol.toPrimitive` hook**: `coerceToStringParts` folded hook-only objects to the default `"[object Object]"` tag (wrong concrete string). The fold guard now also checks for an own `"@@toPrimitive"` slot — hook presence blocks the fold and yields a sound abstract string domain.
  - **`Array.prototype.concat` ignores `Symbol.isConcatSpreadable`**: spreadable objects are now spread as array-likes (`ToLength(o.length)` elements), `lit false` suppresses spreading, abstract flags degrade to `arr` (sound).
  - **Private fields leak as enumerable own properties**: private slots are now flagged `internal` at instance-field registration (not by `#` name prefix — public string keys like `{"#x":1}` share the key space and stay visible). `for-in`, `Object.keys/values/entries`, `hasOwnProperty`, `getOwnPropertyNames/Descriptors`, spread, `Object.assign`, and `JSON.stringify` exclude internal slots; direct `this.#x` access and `#x in obj` slot-presence semantics are unchanged. Class-instance spread/assign now also includes public fields (previously dropped), and Error-family own slots (`name`/`message`/`stack`) are non-enumerable per native semantics.
  - **Class-instance precision follow-ups**: `Object.getOwnPropertyDescriptor(new A(), key)` now folds exact data/accessor descriptors for public fields (runtime `defineProperty` flags and dynamic getters included) instead of the conservative `descriptor|undefined` domain; `JSON.stringify` folds class instances with prototype getters exactly (`{"pub":2}` — prototype accessors are not own properties, native never invokes them during stringify; only `toJSON` methods keep the conservative fold).

## 1.11.2

### Patch Changes

- 82eaae8: Fix `nudo:recursion-truncated` misattributing call-cycle truncation to "depth/size budget", and make `nudo check --json` budget stats see the B-path (`$callNamed`) truncation (issue #158):
  
  - `enterCall` / `evalEnterCall` now attribute a truncation reason — `cycle` (same name+arg fingerprint already on the evaluation stack; data-dependent self/mutual recursion such as directory walkers or `grow`-style recursion) vs `depth` / `calls` (real budget exhaustion). The check diagnostic message, suggestion, structured action, and a new `reason` field on the issue (`cycle` | `depth` | `calls` | `budget`) split accordingly: cycle says *"budget cannot lift this"* and never points at `@nudo:budget`; depth/calls name the exact raisable dimension (`@nudo:budget depth=…` / `calls=…`).
  - The `check --json` / health budget block no longer reports `truncated:false` alongside a `nudo:recursion-truncated` info: B-path counters are latched across execution sessions within one host entry and surfaced as `evalCalls` / `maxEvalCalls` / `evalCallTruncated`, plus `cycleTruncated` and a sorted `reasons[]` set (single-file and multi-file envelopes, and the disk-cache round trip). Fork counters/truncation flags are latched per host entry too (the last-session snapshot could previously erase an already-reported `nudo:fork-truncated`).
  - The `@nudo:budget` quickfix (`nudo check --fix` / LSP code action) is no longer offered when the truncation reason is `cycle`; the `reason` is plumbed through `check --json`, the disk cache, LSP diagnostic data, and `materializeAction`.
  - Raising `@nudo:budget` on a same-args recursion could never lift the truncation — the old message misled real budget investigations into "directive ignored" hypotheses.
  - Loop-iteration truncation (`#loop-iterations`) no longer masquerades as recursion: it now emits its own `nudo:loop-truncated` info with an honest message and suggestion (the call-budget knobs cannot lift a loop budget — `@nudo:budget calls=/depth=` does not apply), gets a `loopTruncated` flag in the `check --json` / health budget block (single-file and multi-file envelopes), and no longer offers the misleading `@nudo:budget` quickfix it used to inherit from the recursion branch.

## 1.11.1

### Patch Changes

- 612d64f: Fix loop-mutated array bindings widening with fabricated `(unknown | undefined)[]` arms — `for…of` + `push` return values now prove against element contracts (issue #156):
  
  - `loop-widen.ts`: tuple length growth (push accumulation) is now detected as element-domain growth (`{el}`) instead of whole-value growth; widening goes through `arrify` — element domain = join of all observed element domains. No fabricated `unknown` element arm from the empty initial tuple, no baked out-of-bounds `undefined` (OOB is a read-site fact: `$idx` on an abstract index already joins the marker; concrete-index optimism matches the engine-wide `arr` invariant shared with `splice`/`sort` degradation).
  - Packed-container slot joins produce sums of objects (`joinValues` does not structurally merge object slots); `normalizeForWiden` structurally merges same-key-set object sums before the growth tree descends, so sequential states of `{ list: [...] }`-style accumulators union their element domains instead of widening the zero-element member alone into `arr(unknown)`.
  - `control.ts` `widenLoopJoin`: stops baking the OOB marker into collapsed element domains (hole reads still contribute, they are real element values).
  - `postcondition.ts`: `conf="widened"` structural arms (`arr`/`tuple`/`obj`) against `array(...)`/`shape(...)` contracts (union members traversed) now discharge through per-element/per-field reconciliation — widening loses length/key-openness/bound/path evidence, not the structural domain. Guards unchanged: bounded element contracts (`number().gt(0)`), mismatched prim domains, and unknown element domains stay `unprovable`; interrupted loops (abstract `break`) keep the honest `unknown[]` top.
  - No-growth loop exits now collapse array-family sums in packed binding slots (`collapseArrSums`): a parameter-position `arr` binding whose element domain is `unknown` absorbs `push` values (growth detection sees nothing), and the widener's accumulated `joinAbs` used to smear the sequential states into a two-arm sum (`unknown[] | (unknown | {v})[]`). Sequential states of one binding now union into a single `arr` (conf preserved — representation collapse, not widening; equal-length tuple-only joins and non-array sums untouched).

## 1.11.0

### Minor Changes

- 16cda31: Add `@nudo:assume <param> <= <param>` user lemmas: cross-variable bound premises participate in relational division folding, so return contracts like `1 - d/max ∈ [0,1]` become provable (#152).
  
  - `@nudo:assume a >= b` is normalized to `le(b, a)`; malformed lemmas or names outside the formal parameter list report `nudo:assume-invalid` (error).
  - Premises are seeded per target-function entry evaluation and never inherited across call boundaries (callee frames are cleared — same-name re-anchoring cannot produce false precision). Recursive calls are conservatively cleared.
  - Division folding derives the correlated bound `le(a,b) ∧ b > 0 ⇒ a/b ≤ 1` (plus mirrors), which plain interval propagation cannot express; downstream `+`/`-`/`*` folding consumes it as usual.
  - Proofs that rely on lemmas surface `nudo:assume-relied` (info) — user axioms stay audit-visible.
  - Constraint builders now throw on non-numeric bounds (`number().le("max")` previously built a silent string-literal predicate); use `@nudo:assume` for cross-variable references.

### Patch Changes

- cce5e58: Fix false `nudo:unproven-return` warnings when a return value was widened to a prim domain top by the loop-carried-binding widener (issue #151):
  
  - `postcondition.ts` now treats `conf="widened"` loop-widen products under the same policy as issue #115 partial arms: widening loses bound/path evidence but not the prim value domain, so domain membership against an unbounded bare prim contract is provable.
  - The whole-value `isValueSetUnknown` gate in `assertImplies` no longer swallows `conf="widened"` returns before arm distribution; the per-arm gates in `assertImpliesSingle` (new proved exit) and `assertSumArms` keep everything else conservative.
  - `isWidenedSumArm` also accepts arm-level `conf="widened"` (loop-widen sums carry widened on both parent and arm), enabling the existing `provesBarePrimDomain` discharge for union members such as `union(string(), lit(null))`.
  - Guards unchanged: widened arms with mismatched prim or bounded contracts (`number().gt(0)`), and any-derivation FP protection, stay `unprovable` (never `proved`, never `disproved`); non-widened exact-arm semantics are untouched.
- cce5e58: Fix array mutator spread arguments (`f.push(...xs)`) folding to `$unknown()` and polluting the container element domain (issue #153):
  
  - The array-mutator fast path in `transpile/stmt.ts` (statement position, identifier/member-path receivers) and the rebind lines of `emitArrMutatorRebinds` in `transpile/emit.ts` (expression position / nested mutators — the rebind line performs the *real* mutation, so the unknown argument landed in the container) now emit `...$elems(<expr>)`, the same flattening the ordinary call paths have used since DEC-006 K5. Generated code is a JS spread inside the args array literal, so `$elems`' returned `Abs[]` flattens element-wise into `$arrMutContainer`.
  - Element precision restored: `const findings = []; findings.push(...check(x)); return findings` keeps the precise per-element tuple from `check` instead of `[unknown]`; mixed arguments keep order (`f.push(a, ...xs, b)`); spreading an abstract array joins its known element domain via the single representative; spreading a string pushes per code point, matching native `push(..."ab")` semantics.

## 1.10.2

### Patch Changes

- 8806e93: Fix env-brand iteration false warnings and env-global slot writes poisoning whole-function evaluation (issues #147/#148):
  
  - `iterabilityKind`/`asyncIterabilityKind` now treat a `brand` shape as a nominal label delegating to its inner structural face: a brand wrapping an array/tuple/string/`@@iterator` object is **total** (no more `may throw TypeError — iteration over possibly non-iterable` on `for…of`/spread over env `Array<T>` brands such as `fs.readdirSync`). Non-total inner faces stay **may** and never degrade to **definite** (TypedArray/Buffer brands wrap an empty object whose prototype `@@iterator` is not modeled). Element domains delegate the same way (`elemsOf`/`$concat`): the `for…of` loop variable and spread elements now fold to the inner array element (`string | Dirent`) instead of `unknown`, and a brand wrapping a tuple keeps the precise tuple shape when spread (`[...t, ...brandT]` stays a tuple, not `T[]`).
  - Env-global injection in `runTranspiled` binds globals with `let` instead of `const`: a member write like `process.exitCode = 1` compiles to a root-rebinding write-back chain (`process = $set(process, …)`), which against a `const` binding threw a native TypeError and poisoned the whole eval (return folded to `unknown` + `nudo:unknown-inference` + `nudo:entry-may-throw`). Env globals are writable `globalThis` properties natively; writes now fold and a later read in the same program run observes the written value.

## 1.10.1

### Patch Changes

- 96090cd: Fix unsound getter loss on object joins: `joinAbs`/`joinObjects` built the merged object as a fresh Abs identity without migrating the accessor side table, so a getter arm joined with a data arm read as its `undefined` placeholder (`{ get q() { return 42; } }` joined with `{ q: 0 }` read `undefined | 0` instead of `42 | 0`). Mixed arms now fold the getter's read domain (evaluated with its original receiver, same as `$spread`) into the data slot; arms sharing the identical accessor definition (aliases, migrated immutable updates such as loop-widening frames) migrate the registration whole so reads keep dispatching through the side table. The accessor table moved to a leaf module `algebra/accessors.ts` so `objects.ts` can consume it without an import cycle; `annotateJoinPath`'s re-wrap now migrates registrations to the final identity.

## 1.10.0

### Minor Changes

- b8db17b: 参数契约折叠展示（inlay + hover + 签名）：
  
  - **inlay**：侧车 `fn()` 形参表达式原文（如 `where nullable(astNode)`）或 `@nudo:contract` 指令约束名替代谓词无损展开（lazy 判别联合展开可达数万字符），完整谓词经 LSP inlay tooltip 展示。侧车 ∧ 指令并存时展示 `expr ∧ name`（任一文本缺席则整体回落谓词全展）；整表达式别名（`import { astNode as N }` 的裸 `N`）规范化为导入名；派生形参（spread / computed）无静态文本，回落谓词全展。
  - **hover**：参数声明位 hover 折叠为声明形态（`node: nullable(astNode)`），函数名 hover 签名的契约参数同口径折叠；函数名 hover 的契约面 display 同步折叠。**体内引用位经求值器重放直读引擎求值态 Abs**（核心变更）：transpile `recordPositions` 插桩（`$nodoPos`——标识符值读 / 静态成员属性位 / 可选链成员跳属性位，计算成员记表达式起始位；记录并原样返回，语义恒等）+ `runTranspiled` 符号执行导出函数（入口 Φ 种子 + 契约参数 Abs），位置直读求值态 Abs——流敏感窄化为**引擎求值语义**（早退守卫 nullish 剥离 / 判别等值窄化 / `!==` 对偶 / typeof 守卫 / `&&` / `||` 链，Φ-native `$fork` 臂内 `withExecPhi` + `$narrowMemberEq` 剪影），非 LSP 层近似。显示阶梯：求值态与入口 Abs 等价（leqAbs 双向）或仅剥 nullish 的位置（声明位 / 检查点 / 成员访问对象 / 落回位）→ 折叠声明形态 + 类型值变量链接；窄化位（守卫 then 分支 / 成员读槽位 / 局部量）→ 求值态展示（`node: { type: lit("StringLiteral"), value: string } | { type: string }`——`showLits` 渲染 lit 判别值与侧车文法同形；开放尾臂按 may 态保守保留——其 `type: string()` 值域与 lit 判别重叠，成员读槽位在尾臂缺席 → `string | undefined` sound）。重放 fail-closed（求值失败 / 预算超限 / 无契约 / 非导出 / 解构形参）→ 回落声明形态面：`||` 组 then 分支（引擎 phi 合取不能表达析取事实）LSP 层按匹配臂联合源文本窄化（sound）；else 分支否定形态有界跳过。折叠面中的**类型值变量包为链接**（`[astNode](file://<依赖侧车>#L<定义行>)`——经侧车 import 表 / 本地顶层声明 / re-export 一级解析；渲染为 plain markdown——代码块内链接不渲染），替代原独立"契约原文"行；无引用变量的契约回落契约原文行。
  - **core API**：`formatShape(a, { maxDepth, showLits })`——`showLits` 把 `eq(self, lit(v))` pred（槽位为 `get(p, k)` 字段项、顶层为参数项）渲染为 `lit(v)`（默认 false——既有全部展示面口径不变）。
  - **修复**：exec 缓存命中（同内容侧车在不同路径——复制的契约）时不重跑 `execSidecar`，参数折叠文本注册表按路径键在命中路径补登记；此前第二个同内容侧车路径查不到折叠文本、回落谓词全展。

### Patch Changes

- 334b914: Discriminant narrowing visible in slot display; mid-token hover resolution
  
  - `$narrowMemberEq` keep-arm refinement: surviving union members with a compatible discriminant slot now carry the `eq(slotTerm, lit)` fact on that slot (conjoined with any existing pred). `formatShape(showLits)` renders it via `litPredValue`, so the open-tail arm displays `{ type: lit("TemplateLiteral") }` after `node.type === 'TemplateLiteral'` instead of the unrefined `{ type: string }`; `memberEqClass` upgrades those members to `only`, improving chained discriminant narrowing and complement-arm pruning. `any`/`unknown` slots stay untouched (fail-closed markers).
  - `litPredValue` now reads `eq(self, lit)` facts through `and`-conjunctions, not only top-level eq preds.
  - LSP A0 hover replay resolves mid-token cursor positions: record keys are Babel start positions (`$nodoPos` uses `loc.start`), so a cursor anywhere inside an identifier span now resolves to that identifier's record instead of falling back to the declared-form fold (previously only the first column hit).
- 94197eb: hover 弹窗可读性与 return 表达式推导：
  
  - **pretty 缩进展示**：`formatShape(a, { pretty: true })`（opts 挂 `ProjectionBudget.pretty`，与 `showLits` 同先例）——object 每槽一行 + 尾逗号 + 2 空格缩进递增；union 仅当至少一臂是复合 shape（object/array/map/set/fn 或渲染含 `{`）时按臂断行（` | ` 前缀换行），纯 prim/lit 联合保持单行（`string | null | undefined` 不断）；截断标记 `…`/`…cycle` 原样内联。默认（不传 pretty）输出字节不变——check 签名 / dts / inlay / 语义 token 面不受影响。应用点仅 hover 面：标识符 hover（identHover / A0 求值态）与 return 表达式 hover；`gSig` 签名、`paramDisplayOf` 声明形态折叠面保持单行。
  - **删除「契约原文」链接行**：hover 弹窗不再推送 `[契约原文](file://…#L<n>)` 链接（`linkedText` 变量链接面保留）；`HoverInfo.sidecarPath`/`sidecarLine` 字段随唯一消费方一并删除。
  - **return 表达式推导 hover**：transpile `ReturnStatement` 在 `recordPositions` 时把返回值包 `$nodoPos(src, line, column)` 记录到 **`return` 关键字起始位**（argument 起始位与内部根标识符读记录同键 first-wins 丢失；`emitRet` 单一 choke point 覆盖 asVar/try/loop/mutator 全路径；裸 `return;` 不记录）。LSP `absNodeAtPosition` 词中回落从 Identifier 泛化为任意带 loc 节点（候选仅当起始键已有记录，取最小 span——词中标识符行为不变）；新增无 ident 分支——hover `return` 关键字或表达式内非标识符位（`?.[`、`[0]`、`.`）直接显示推导类型（无 ident 前缀，pretty 渲染）。
- 5e275df: fix: review hardening — Map.groupBy empty-reduce crash, Bug 1 early-exit relational narrowing, fs-error graph-edge degradation, agent tool module graph, brand presence for URLSearchParams/TextDecoder/Intl, generator side-table $copy migration
  
  - `Map.groupBy` / `Object.groupBy`: shadow-domain join no longer bare-`reduce`s an empty unkeyed list (raw host `TypeError: Reduce of empty array with no initial value` escaped module evaluation → fail-closed unknown exports when the callback folds a literal key over arr/abstract-string-prim items); empty fold degrades to `unknown`.
  - Early-exit lift path (if-return followed by non-tail statements) now applies the same relational-arm narrowing as the regular IfStatement path (`narrowRelArmThunk`), fixing false positives like `if (x >= 0) return x; console.log(x); return 1;` under `@nudo:contract return nonNeg`.
  - `extractImportEdges` skips import edges whose target resolution throws `ModuleReadError` (EACCES/ESTALE, #135) instead of crashing module-graph construction (CLI watch start, incremental rebuild false-green rounds, LSP validation).
  - `new Function(...)` / `new Function("a", "b", ...)` validate every argument for the L2 may-throw gate, not just the first.
  - Brand presence tables: URLSearchParams (methods + `size`), TextDecoder (`decode` + accessors), Intl.NumberFormat/DateTimeFormat (`format`/`formatRange`/parts/`resolvedOptions`); URLSearchParams joins ITERABLE_BRANDS (@@iterator → function).
  - `$copy` snapshots migrate generator/match side tables (genDeferred throws, genIter/matchAll elements), so fork/switch-arm rebinding no longer silently drops deferred generator throws.
  - LSP agent tools (check/hover) build the module graph like the CLI and LSP validation do, fixing cross-module unknown collapse (E5 parity).

## 1.9.4

### Patch Changes

- 2af4016: fix(core): generalize display (hover intension) renders destructured params as `{ a, b }` via `formalParamSignatureNames` instead of the `_p0` evaluation placeholder, while entryReqs preds and promoted entryShapes/fnRels lookups keep using the placeholder keys (#138)
- 2af4016: fix(core): sidecar dot-path keys (`fn({ 'card.grade': string() })`) now bind nested destructured params — nestedPaths surface collection, fieldPath-aware projection in check/case scans, and nested obj-Abs synthesis in the refine block; flat binding names keep precedence (#137)

## 1.9.3

### Patch Changes

- b6495c6: fix(core): regex 捕获组接收者窄化 + exec 抽象匹配 per-index 槽（#136）与方法调用接收者守卫事实
  
  - 抽象 subject 的 `re.exec()` 结果从均质元素 arr（`m[0]`/`m[1]` 同值 `string|undefined`、无从窄化）改为与具体路径 `matchResultAbs` 同构的 per-index 槽 obj：`m[0]`=string、捕获组槽=string|undefined、`length`/`index`/`input`/具名 `groups` 全可读（修前 length/index/input 为 unknown）。
  - `if (m[1].trim().length > 0) out.push(m[1])`：方法调用求值到达 ⇒ 接收者非 nullish——该事实经既有臂 thunk 影子参数窄化应用到 if 两臂（短路方向 sound：`A && B` 的 B 位仅真值臂、`A || B` 的 B 位仅假值臂；`?.` 可选链不识别）。修复 1.3.15 数组元素诚实化引入的 `array(string())` 误报 constraint-violated（守卫后 push 的元素必为 string）。
  - `memberGuardTarget` 计算键认数值字面量：`if (m[1])` 显式真值守卫与 `if (o.p)` 同走 $removeMemberNullish 槽剪影（此前计算键一律不识别）。
  - 诚实化不回退：无守卫直推仍如实报 `string | undefined` 契约违例；`.trim()` 的 nullish 臂 throws 事实不丢（无契约时仍报 entry-may-throw）。
- 04a6d1d: fix(lsp): IDE 面（hover/inlay/check 诊断）接入模块图——跨模块 import 塌缩 unknown 的假空与假红
  
  - 根因：CLI `nudo check` 经 `buildCheckInjection` 把 `evalAbsModuleGraph` 模块图传给 `checkSource`/`generalizeFromAst`，而 LSP 侧同族调用（hover intension、`collectAbsInlays`、`checkToLspDiagnostics`）不带图——跨模块 import 不可解析，函数体求值 fail-closed。表现：函数名 hover 显示 `(_p0: A1) => unknown / conf: opaque`（参数无侧车种子 + 返回 unknown），Abs inlay 为空/unknown，且 `nudo:unproven-return` 假红（CLI 同文件全绿）。求值引擎本身精确（entry@/combinedAbs 无误），仅 host 装配缺口。
  - `validation.ts` 新增 `evalAnalysisModules(filePath, source)`：`evalAbsModuleGraph` 组装（abs-modules-graph 内容缓存，重复调用廉价；cycle 不注入，与 CLI hasCycle 分支同语义 fail-closed）。
  - `lsp-surface.ts` 函数名 hover 的 `generalizeFromAst` 补 `refine`（fromFile/loadModule/autoBind——此前连 refine 都没传，参数丢契约种子成 A1）与 `modules`（经 `SurfaceReuse.modules`）。
  - `core/algebra/inlay.ts` `CollectAbsInlaysOpts` 增加 `modules` 透传给 generalize；`server-ide.ts` hover/inlay 处理器组装并传入图。
  - 验证（npm-safe scanner decide.js，手写侧车 + 跨模块调用链）：修复后 hover = 契约 + `{confidence: 1|0.9|0.7|0.95, grade: "F"|string, …}`，inlay 三函数全精确，假红诊断 0；全套 vitest 1841 通过。
  
  feat(lsp): 观察选择器——contract 成为与各 case 并排的 ●/○ 选项 + 档线改名 `● contract / hw|gen|imp`
  
  - 档线改名：CodeLens / hover 首行 / inlay 档投影的 `● interface / handwritten|generated|implicit` 统一改为 `● contract / hw|gen|imp`（`formatInterfaceTierLine` 单源，新增 `INTERFACE_SOURCE_ABBR` 导出）。
  - **contract 是观察选择器的一项，与各 case 互斥**（IDE 内点 ●/○ 切换，非配置开关）：
    - 默认 `● contract / hw|gen|imp`、全部 case `○`——与分析器默认（无激活 case 不跑 case 种子）一致（此前 case 0 默认显示 ● 与实际观察态不符）；
    - 点击 case（`nudo.selectCase`，已有）→ 该 case `●`、契约转 `○`；点击契约选项（新增 `nudo.selectContract`，executeCommand + `nudo/selectContract` 请求别名，位置参数 `[uri, fn]`）→ 取消激活 case（幂等）；
    - inlay 档投影镜像激活态（`●/○ contract / …`）；persist/draft 动作与 `call@`/`entry@` 观察层不受选择影响。
  - hover 与 Abs inlay（参数约束/返回 term/pred）不参与选择器（推导面）。

## 1.9.2

### Patch Changes

- c8e0417: Propagate member truthy-guard facts into union containers (issue #129). `$removeMemberNullish` now classifies sum members per the guarded key: members whose read is definitely nullish — a closed shape without the key whose absent read yields `undefined` (no `open`/index signature, no `Object.prototype`/`constructor` key, no getter), or a getter-free all-nullish slot value — cannot survive the truthy arm and are pruned; members with `T | nullish` slot values or `optional` flags are rebuilt with the nullish members stripped and the flag dropped (same refinement the single-object branch has applied since #118, now also migrating the accessor/invariant/nullProto side tables to the rebuilt identity). `if (!node.property) return` followed by a chained re-read `node.property.type` on a discriminated union with a lenient catch-all arm no longer records a false `property 'type' on undefined` may-throw. Keys whose absent read is unjudgeable — `open`/index shapes, `Object.prototype` method names and `constructor` (proto-chain reads a function), and getter-backed keys (the read returns the getter result, not the placeholder slot) — stay conservatively, as do `any`/`unknown` slot values and non-object members; all-pruned sums pass through unchanged and single-member remainders collapse, matching `$narrowMemberEq` conventions.

## 1.9.1

### Patch Changes

- bf601e0: Fix class-C abstract-eval under-approximation bugs (4/6/19/21/47/48/53) — loop-carried accumulator widening and iteration element domains. `for`/`while`/`do-while` under abstract conditions and `for-of` over unbounded iterables no longer fold loop-carried counters into exact bounded sums (`0 | 1`, `0..8`): exit snapshots are growth-tracked per binding and widened to unbounded sound domains (`number`/`string`) when the budget is exhausted, while join-idempotent bindings and all-concrete loops (including definite `break`/`continue`) keep their exact behavior. Array-literal spread stops polluting element domains (`[...xs]` → `number[]` not `number | unknown[]`; empty-tuple join identity is `never`, abstract strings spread to `string[]`), `for (const c of s)` / `yield* s` over abstract strings yield `string` instead of `unknown`, no-initial-value `reduce`/`reduceRight` seed the accumulator from the element domain (killing the phantom string arm of `+`), array HOFs pass their `thisArg` to callbacks (native `GetThisBinding` — `[1,2].map(function(){return this.k},{k:7})` now evaluates to `[7,7]` instead of `never` + false may-throw), and `new Array(n)` for abstract number `n` gives a decidable `undefined[]` element domain (sparse holes) instead of `unknown[]`. The widened bare-prim arms this produces no longer trip return-contract discharge: a loop-widened `number` arm proves against nullable/union contracts with an unbounded same-prim member (issue #102 regression — `lev`-style DP tables under `nullable(number())` return contracts no longer emit a spurious `nudo:unproven-return` warning when the real arms and the OOB marker arm are all covered).
- bf601e0: Fix class-B brand-slot modeling bugs (10/15/22/23/28/29/39/45/46/58/59): Error family `toString`/`toLocaleString` now render `` `${name}: ${message}` `` and `Object.prototype.toString` tags the whole family `[object Error]` (`[[ErrorData]]`); Error brands carry a `stack: string` slot. `new ArrayBuffer`/`new SharedArrayBuffer`/`new DataView` store construction args as brand slots (`byteLength`/`byteOffset`/`maxByteLength`/`resizable`/`growable`; literal-folded, abstract → number). Boxed brands (`new String`/`new Number`/`new Boolean`, `Object(prim)`) store the wrapped primitive in an internal non-enumerable slot via a single `makeBoxedAbs` builder and dispatch instance methods through the unboxed primitive face (`valueOf` unwraps; `charAt`/`toFixed`/… fold). Map/Set `keys`/`values`/`entries` return iterator objects (stateful `next()` → `{value, done}` plus element side table) so spread/for-of/`Array.from`/`.next()` chains evaluate. RegExp brand construction converges on one declarative slot builder covering `source`/`flags`/`lastIndex` for abstract patterns too, plus the 7 flag getters (`global`/`ignoreCase`/`multiline`/`unicode`/`dotAll`/`sticky`/`hasIndices`) folded from the flags string. URL brands expose `hostname`/`pathname`/`search`/`hash`/`port`/`username`/`password` slots. `Date.prototype.getYear`/`setYear` dispatch as number getters/setters. `new BigInt()` and `new Math()`/`new JSON()`/`new Reflect()` now deterministically throw `TypeError` (previously a silent bogus brand, or an internal `specOf` crash swallowed into `unknown` + false may-throw).
- bf601e0: Fix class-A call-position dispatch bugs (1/2/5/7/8/11/12/24/26/38/50/51/55): namespace-static and method dispatch tables no longer shadow env declarations with `unknown`. `Number.isSafeInteger`, `Date.parse`/`Date.UTC` (literal args fold to exact timestamps), `String.raw` tagged templates (exact splice on all-literal quasis/subs), `Object.defineProperties` (returns target, reuses the defineProperty machinery via shared helpers) and `Object.getOwnPropertyDescriptors` (exact per-slot descriptors for closed objects/tuples) now evaluate. Host URI/escape globals (`encodeURIComponent`/`decodeURIComponent`/`encodeURI`/`decodeURI`/`btoa`/`atob`/`escape`/`unescape`) are registered in `GLOBAL_FNS` with exact literal folding, `string` result domain for abstract string args, and per-function may-throw faces (`URIError` for decode*, `InvalidCharacterError` for btoa/atob). ES2024 statics: `Array.fromAsync` (promise of `from`'s element projection with thenable unwrapping), `Promise.withResolvers` (three-slot object), `URL.canParse` (exact boolean on literals; `URL` added to the namespace routing/env-shadow tables in parity). String method table gains `trimLeft`/`trimRight` aliases, Annex B HTML methods (`bold`/`anchor`/`link`/… exact tag folding), and `search`/`match`/`matchAll` arms for abstract/template receivers (`number`, `null | match array`, iterator brand; non-global `matchAll` is a definite TypeError); string-literal patterns now fold through `RegExpCreate` semantics (`"abc123".search("c")` → `2`), and `s.at(n)` on abstract receivers includes the `undefined` arm. `Array.from(<obj>)` array-likes read index slots (`Array.from({0:"a",1:"b",length:2})` → `["a","b"]` exact tuple) and fold `length` via `ToLength` ("2"→2, missing→0, abstract → element domain). Host global function values are first-class: returning `parseInt` yields a function type, `[1,2,3].map(parseInt)` → `[1, NaN, NaN]`, and `.call`/`.apply`/object-slot/`then` positions dispatch through the called-position bridge (shared `callHostGlobalFn`) instead of feeding Abs objects to host functions.
- bf601e0: Fix class-D semantic-special-case bugs (13/14/17/18/20/25/30/33/34/36/37/40/42/44/60).
  
  False may-throws eliminated: `s.split(/re/)` no longer treats a RegExp separator as a ToString operand (`@@split` delegation never stringifies it); `JSON.stringify` on closed builtin brands (Date/RegExp/Map/Set/Error family/URL/ArrayBuffer family — folded exactly: `"{}"` / href / ISO string), closed objects with primitive slots, and abstract arrays with non-bigint elements no longer record the BigInt/circular/toJSON may-throw; `Reflect.apply(f, thisArg, argsList)` replays the call through the `$invoke` apply path (`Math.max` → `2` exact) and no longer flags fn targets as maybe-uncallable.
  
  Arithmetic on builtin brands (Bug 25): `-` `*` `/` `%` `**` unary `-` `<` `>` `Number()` now fold known-brand operands through ToPrimitive — Date → time value (`new Date(0) - 1` → `-1` exact, `+` → string per the Date default-hint rule), boxed `new Number(5)` → the wrapped primitive, RegExp/Map/Set/Error/URL → toString → numeric coercion (abstract-string operands coerce to `number`, was `unknown`).
  
  Promise rejection channel (Bugs 36+37): the promise eff shape carries a `rejected` reason — `Promise.reject(v)` and executor `reject(v)` produce `promise<never>` (definite rejection), `.catch`/two-arg `.then` receive the actual reason (`Promise.reject(1).catch(e => e)` → `promise<1>`, no phantom unknown arm), and nullish handlers are Identity (`p.then(null)` passes the settle value through, `p.catch(null)` passes rejection through).
  
  L1 return-contract element enforcement (Bug 30): array contracts now check elements — `return [-1]` against `array(number().gt(0))` reports `array element [0] ⊭ …` (precise index) instead of silently proving; abstract elements degrade to `unproven-return`, empty tuples stay vacuously proved.
  
  Expression-position `splice`/`copyWithin` fold exactly (`[1,2,3].splice(1,1,9)` → `[2]`); arr-of-union signatures render with parens (`(3 | 1 | 2)[]`, was the ambiguous `3 | 1 | 2[]`); `BigInt(x)` on abstract number/string operands records the native `RangeError`/`SyntaxError` may-throw; `new URL(...).toJSON()` folds href (was `unknown`); rest parameters in signature symbolic execution bind an open array (`sigLen(...r) => number`, was the fixed-1-tuple error `1`); `delete o?.a` short-circuits nullish receivers to `true` (was an engine throw — the differential knownFalseThrows canary is removed).
- bf601e0: Fix class-A value-read/reflection bugs (3/9/31/32/41/43/49/54/56/57).
  
  Value reads: abstract-string indexing `s[n]` now yields `string | undefined` (was `unknown`); function value properties `f.name`/`f.length`/`f.prototype` are decidable (declaration names and native arity plumbed through host-fn `asAbsVal` and closure `absFunction`; arrows fold `prototype → undefined`); `Symbol.<well-known>` constants fold to exact symbol literals with precise `.description`/`String(sym)`/`===`.
  
  Method value-read channel (Bugs 49+56, single mechanism): reading a prototype method as a value (`"ab".trim`, `(1).toFixed`, `Array.prototype.slice`, `Map.prototype.has`, …) yields a first-class callable fn whose apply hook forwards borrowed invocations (`v.call(recv, …)`/`v.apply`/`v.bind`) back into the existing method dispatch — `typeof X.prototype.m` folds `"function"` (was silent `undefined`/`unknown` + false may-throw), `Array.prototype.slice.call("abc")` folds `["a","b","c"]`, `Number.prototype.toString.call(255)` folds `"255"`.
  
  Reflection mutators: the five `Reflect.set`/`deleteProperty`/`defineProperty`/`setPrototypeOf`/`preventExtensions` now apply their state effect to the receiver (in-place slot write/delete, proto marking, ext-state) while keeping native boolean returns; `Object.create(proto, descriptors)` installs descriptors as own properties (open obj for object protos, null-proto preserved).
  
  Enumeration: `Object.create(<obj>)` no longer poisons the keys family with a false may-throw (keys/values/entries fold `[]`); `Object.keys/values/entries` classify non-string primitives (`[]`) and builtin brands (boxed String → `["0","1"]`, gOPN includes `length`); accessor properties are visible to `Object.entries`/`Object.values`/`Object.getOwnPropertyDescriptor` (accessor descriptors `{get,set,enumerable,configurable}`) and `JSON.stringify` through a single `readProperty` [[Get]] entry point — getter thunks are invoked, the defineProperty+enumerable stringify variant loses its false may-throw, and `for (k in new String(…))` no longer enumerates `length`.

## 1.9.0

### Minor Changes

- aeb6f7e: Add discriminated-union narrowing for `x.key === 'lit'` guards (issue #126). In the arm where the equality fact holds (`===` true arm / `!==` false arm), a union parameter is shadow-rebound via the new `$narrowMemberEq` runtime helper to the subset of members whose `key` domain may equal the literal: arms pinned to a different literal, closed shapes without the key, and nullish-literal members are pruned (three-state classification: `only` / `never` / `may` via shape assignability plus `implies` over the slot pred, with a local literal-disequality rule for strings/booleans the prover does not cover). Kind-specific field reads stop recording false `computed member on nullish (union arm)` may-throws. Recognizes strict equality only (`===`/`!==`, literal on either side, string/number/boolean literals, non-computed single-level member), composes across `&&`/`||` tests with the existing nullish/typeof guard channels, and applies to ternaries, `if` statements, the early-return promotion path, and optional-chain guards (`node?.type === 'lit'` also drops the null members). Dual polarity: `!==` early-returns prune the exactly-literal arm in the fall-through. Boundary (honest residual): a lenient catch-all arm like `shape({ type: string() })` admits the discriminant literal, so it is conservatively kept in the fact arm and undeclared index-read fields on it still report one L2 — the parameter domain genuinely admits such values (TypeScript keeps the overlapping arm too and flags the property as missing).

## 1.8.0

### Minor Changes

- 05c2c8c: Add `lazy(() => tpl)` self-referential constraint-template builder for recursive shapes (issue #120). A sidecar can now declare recursive structures in one line — `export const astNode = shape({ type: string(), object: lazy(() => astNode).optional() })` — instead of hand-nesting finite levels. Consumers expand lazy templates under a fixed depth budget (`LAZY_TEMPLATE_DEPTH = 3`): entry param Abs renders budget-exhausted lazy fields as absent slots (matching manual finite templates, so guarded recursion cuts cleanly at the boundary), `instantiateConstraint`/`instantiateOnTerm` degrade to trivially-true predicates, `constraintAdmitsNullish` / `throwConstraintToKinds` / `literalMeetsConstraint` terminate cycles via thunk-identity seen-sets, `assertImplies` uses a thunk-identity seen-set with per-path copy-on-branch copies (sibling sum/union arms each fully expand shared lazy members; genuine cycles truncate to `unprovable`, i.e. the conservative `nudo:unproven-return` warning rather than a false error), `formatConstraint` renders two expanded levels plus `…`, and `derefConstraint` memoizes one-level derefs by thunk identity. `partial`/`pick`/`omit`/`andC` now deref lazy wrappers before their structure checks. `lazy` is sidecar-injected via `CONSTRAINT_BUILDERS`; the directive grammar still rejects arrow functions, so `@nudo:case`-style use falls back to `unknown` (no security-surface change).
- 33239da: Adopt declared contract faces at the call boundary (issue #123 fix B): when a callee declares param/return contracts (`*.nudo.js` sidecar `fn(…)` binding or `@nudo:contract`), contracts stop being enforce-only and become a **type face** for callers — same-file and cross-module alike. At `$call`/`$callNamed`, params with no information (unconstrained `any` / non-lit `unknown` args) are bound to the declared faces (`constraintToEntryAbs`), so the callee body re-executes inside the contract domain instead of worst-case `any` — the issue's levenshtein callers (`levenshtein(a,b) <= 1` and const/literal/var variants) no longer inherit the DP body's `ToPrimitive of abstract relational operand (Symbol)` may-throw; call sites passing already-informative args keep their own face (L1 `nudo:constraint-violated` at the scan remains the enforcement domain, arity is never extended). The call result is presented through the declared return face — the #102 DP-OOB marker arm (`undefined`) and widened members no longer leak to callers (`probe(a, b) => number`, not the inferred union), while scalar literals that satisfy the return constraint keep literal precision and `never`/opaque (budget) results are never whitewashed. Return-constraint predicates flow to callers: a callee declared `number().ge(0)` makes caller-side bounds like `d + 1 ≥ 1` / `100 - d ≤ 100` (the issue's `1 - d/max ≤ 1` chain shape) provable. The callee's own check semantics are unchanged — its honest `nudo:unproven-return` warning and inferred signature (marker arm included) stay exactly as before. Faces are attached per `checkSource` run (bridge Abs fns for injected module tables via the dep's ambient sidecar; a scoped name resolver for same-file callees), so nothing is cached into long-lived session state.

### Patch Changes

- 3588ddd: Extend guard narrowing to four previously-unhandled forms (issue #118 v3 / #120): (1) assignment-in-test guards — `while ((m = re.exec(content)))` / `if ((m = f()))` now recognize the truthy test as proof that the assigned variable is non-nullish, so reads like `m[2].trim()` inside the loop body / cons arm no longer report false `entry-may-throw` (`computed member on nullish (union arm)`); the while body is narrowed per iteration via an IIFE inside the body factory, and do-while narrows only the inner `$whileSeq` copy (first run precedes any test evaluation). (2) member loose-equality guards — `o.p == null` / `o.p != null` falsy/truthy arms imply the slot is present and its value non-nullish (loose eq treats a missing slot's `undefined` as null), same facts as truthy-member guards; strict `o.p !== null` stays un-narrowed as a documented boundary (`undefined` remains possible). (3) multi-name composite guards — `obj == null || node.property == null` fall-through now applies both independent facts in one arm (`nullishGuardsOf` + multi-param shadow `((a, b) => …)(rm a, rm b)`); same-name facts merge grains, conflicting member keys keep the first (sound subset). Loop narrowing is skipped whenever the guard name is written inside the loop body (shadow params would swallow writes) or redeclared at body top level; test-side assignment is the canonical idiom and does not skip.
- c647af8: Preserve `term`/`pred` when `$copy` snapshots obj-shaped Abs values. `objOf` builds values without a term slot, so the obj branch of `$copy` (unlike tuple/arr/sum/eff/brand) silently dropped them; args crossing the export bridge lost their terms, every level of a recursive call collapsed to the same `callBudgetKey` fingerprint, and the cycle guard cut parent/child frames as a false cycle — the truncated `unknown#opaque` result then poisoned signatures and return-contract proofs (surfaced by issue #120's recursive `lazy` templates).

## 1.7.10

### Patch Changes

- 427da20: Fix false `entry-may-throw` reports under three guard forms over optional slots / nullable params (issue #118): (1) member truthy guards — `if (o.p)` truthy arm / `if (!o.p)` fall-through now rebind the base to `$removeMemberNullish($removeNullish(o), key)`, stripping nullish members of the slot value **and** the `optional` flag (the `$get` join with `undefined` was the FP source for `property 'grade' on undefined`); (2) composite mixed disjunction/conjunction — `!doc || typeof doc !== 'object'` fall-through now narrows `doc` (a single side that is itself a nullish guard suffices; both-sides-different-names stays conservatively un-narrowed); (3) optional-chain truthy guards — `if (!files?.length)` fall-through narrows `files` before `for (const f of files)` (no more `iteration over possibly non-iterable value`). Single-level member paths only (computed keys and nested `o.p.q` guards are not recognized); unguarded reads/iterations still report.
- 427da20: Fix false `entry-may-throw` ("ToString coercion of abstract operand (Symbol)") on template interpolation of `optional()`/`nullable()` slots (issue #119): `isMaybeBigintOperand` no longer treats `lit(null)`/`lit(undefined)` sum members (shape `unknown` + literal term) as maybe-bigint/Symbol — ToString/ToNumber of nullish literals is total. Value domains unchanged; unconstrained `any` operands and obj/fn/brand union arms still record may-throw.

## 1.7.9

### Patch Changes

- b14ac2d: fix(core): 无界 prim 契约的域隶属可证——裸 prim partial sum 臂不再误降 unproven-return（issue #115）：
  
  - 关系比较块（`x < y` on narrowed string 字段）保持返回 sum 不合并时，`Number(x) - Number(y)` 派生臂是 term-less partial prim number（parent sum conf=partial，`isWidenedSumArm` 按 any 派生污染臂口径整臂跳过）→ 诚实的 `return number()` 契约被误降 `nudo:unproven-return` warning（1.3.9 回归；1.3.6 该臂被 nullish 成员访问整臂丢弃故不可见）。
  - 修法：`provesBarePrimDomain`——契约是无界 prim（裸 `number()`/`string()`：prim + 无显式 pred + 无 int 义务 + 无结构面）时只问域隶属；裸 prim 臂的 partial conf 丢的是界/路径证据，不丢 prim 值域 → 臂 discharged，不降整体 unprovable。
  - 口径不动：带界义务（gt/le/int…）对 term-less 臂仍 unprovable；错配 prim 的 disproved FP 保护（gold `nonEmpty` 面）与 OOB marker / nullish 显式化分支不变。

## 1.7.8

### Patch Changes

- 58b7938: fix(core): class extends Error 的 super(message) 不再静默 no-op——基类构造槽落地（#110）
  
  `constructClass` 对无注册 spec 的基类（env/宿主内建构造器）此前原样返回 thisVal，`super(message)` 的 args 被丢弃：派生实例 `e.message` 折假精确 `undefined #exact`（原生为 message 字符串）、`e.name` 同为 `undefined #exact`（原生经原型链为 `"Error"`）。#106 恢复 `class extends Error` 定义期干净后暴露面增大。
  
  修复：`!spec` 分支对 Error 家族（isErrorCtorName）按 errorBrandAbs 落 name/message 槽——与 `new Error(...)` 完全同口径：
  
  - lit message 保精确、ToString 折叠（number → "5"、缺省 → ""）、AggregateError errors/message/cause 实参序、options.cause 透传；
  - any message 构造记录 message-ToString may-throw（`new Error(Symbol())` 原生抛 TypeError，L2 同 `new Error(anyMsg)`）；
  - brand 名保持被构造实例（B extends A extends Error 中间用户类链不换名、方法派发不断链）；name 槽是基类名（原生 Error.prototype.name 经原型链可见），子类自有 name 字段/赋值源序在 super 后照常覆盖；
  - 用户同名类优先（getEvalClass 命中即不走内建分支）；其余内建基类（Promise/Date/…）维持原样。

## 1.7.7

### Patch Changes

- d6fa067: fix(core): throws 域判定与值域计算粒度一致（Bug 2/3/23/25）—— L2 门（nudo:entry-may-throw）假阳性消除，守卫已证不抛的代码不再记 may-throw TypeError：
  
  - **Bug 2**：早退提升路径（transpileFnBodyStmts）补守卫剪影——`if (p === null) return -1;` 后接非终结尾句（中间绑定/副作用语句）时，尾句在 fork 假值臂内执行，`p` 以剪除 null 后的版本影子重绑，`p.major` 不再撞未剪 null 臂记假 may-throw（与 IfStatement 路径同源；issue #97 五变体不回归）。
  - **Bug 3**：nullish 守卫白名单扩展 + 剪除粒度——识别复合 `p === null || p === undefined`（否定臂剪 nullish）与 `typeof u === "undefined"`（假值臂只剪 undefined，`typeof null === "object"` 不误剪 null）；严格 `p === null`/`p === undefined` 按字面量粒度剪（`null === undefined` 为 false，严格等价只排除该字面量——同时修掉「假值臂连 undefined/null 一起剪」的既有假阴性）；`&&`/`||`/三元表达式面同享。
  - **Bug 23**：新增 typeof 类型守卫剪枝（typeGuardOf + $narrowTypeOf）——`typeof v === "string"` 真臂把 v 影子重绑为 union 中 typeof 匹配成员、假臂绑补集（不可判成员保守保留）；守卫臂内 `+`/关系/for-of/spread/解构/模板串拿到成员类型，七面（addStr/relStr/forOfStr/spreadStr/destrStr/tmplStr/addNum）零假 L2，`typeof v === "number"` 臂不再产不可能的 string 值臂。
  - **Bug 25**：isMaybeBigintOperand（arithmetic/surface 两处）对 sum 成员感知——纯 prim union（number|string）绝不可能是 Symbol/bigint，`v > "a"` 类关系运算不再记假 may-throw；obj/fn/brand/any 成员保持原子（对象经 @@toPrimitive 确可返 Symbol），unknown 豁免口径不变。
  
  回归红线：真实可抛路径不剪（严格守卫假值臂的 undefined/null 成员保留并照常报 L2；any 入口守卫后仍诚实 may-throw；unknown 令牌口径不变）；check-gold / check-recall-gold / check-real-packages 全绿。
- 92e6a5f: fix(core,env): L2 entry-may-throw 假阳性两处（issue #105 / #106）——1.3.5 的 builtin throws 语义对齐（2e5aeb35）引入的回归面：
  
  - **#105 typeof 守卫后的 any 不再记假 may-throw**：`$narrowTypeOf` 此前只剪 sum 成员，裸 `any`（无约束入口参数）在守卫事实臂原样保留 → `RegExp.exec/test(v)` 的 subject ToString 档位按 any 记 may-throw。修复：事实臂（keep=true）any 健全窄化为对应 prim（string/number/boolean/bigint/symbol，term/pred/conf 保留；补集臂与 object/function/undefined 不可表示、unknown fail-closed 令牌均保守保留）。npm-safe `parseVersion`（`typeof v !== 'string'` + `if (!m) return null` 双守卫 + 捕获组读）恢复干净。无守卫的 `exec(any)` 仍如实报（原生 `exec(Symbol())` 抛 TypeError，与 check-gold 的 scale(x) 口径一致）。
  - **#106 env 声明构造器不再报 constructibility 假抛**：env 的 Error 族声明为无名 envFn——`$new` 的按名派发（evalBuiltinNew → errorBrandAbs）拿不到名字，落到通用 fn 分支的 unknown-constructibility 门；`$class` 的 extends 门同样只见 ctor:undefined，`class ApiError extends Error` 定义期误报。修复：`envFn` 支持 `ctor` facet 并给 relationFn 路径补 `name` 盖章；Error 族 / Date / Promise / URL / AbortController / EventEmitter / stream 族声明 ctor:true（Symbol 声明 ctor:false——原生非构造器，`new Symbol()` / `extends Symbol` 仍定抛）；`$new` 的 ctor:true-无-impl 路径回落声明 returnType（保实例面精度，AbortController/EventEmitter 不丢方法槽）。`new Error('lit')` / `new TypeError('lit')` / `new ApiError(...)` / `class extends Error` 在 env 下恢复干净；`new Error(anyMsg)` 仍如实报 message ToString may-throw（node 实测 `new Error(Symbol())` 抛 TypeError，与无 env 宿主路径同口径）。

## 1.7.6

### Patch Changes

- 856d8bf: fix(core): SequenceExpression 发射统一括号包裹 —— 逗号序列裸发射 `a, b` 在任何嵌套位都会撕裂宿主结构：对象字面量属性值/类计算键里后续项被解析成新属性的键 → `new Function` SyntaxError → 整文件 eval-incapable；数组元素位一项静默变多项（长度翻倍）。TS 降级 `#private` 产物 `[(_A = new WeakMap(), …, "k")]` 计算键正是该形态：yargs 全量命中 → 模块图逐依赖求值失败重试（失败不缓存）→ OSS bench yargs hub-edit 4.4x / check-all 2x 回归，CI OSS baseline gate 5 连红。括号在语句位/实参位均合法，统一包裹后语义不变（序列值 = 末项）。

## 1.7.5

### Patch Changes

- 4c3fafd: fix(core): OOB marker 臂不再把返回契约判成 error（issue #102）—— 抽象下标读（循环建表后的 `d[m][n]`）并入的 `oobUndef` marker（conf=partial 合成 undefined）是引擎精度产物而非用户域 undefined；postcondition 对该臂降级 unprovable（`nudo:unproven-return` warning，gate 不再变红），与 widened 污染臂同口径；契约显式承认 nullish（`nullable(...)` / `union(..., lit(null))`）时 marker 臂 discharged（多臂与单臂 proved 口径对称）。真实 nullish 返回臂仍照常 `nudo:constraint-violated` error；其余真实臂证据充分时仍 disproved。DP / 编辑距离 / 备忘录类「循环建表 + 按构造在界内读取 + number() 返回契约」函数恢复绿门（1.3.4 语义）。已知召回权衡：真实无约束下标越界返回（`return a[i]`）从 error 降为 warning——与 #98 oobUndef 按类压制同族，理想收窄需循环上界×下标关系推理。

## 1.7.4

### Patch Changes

- 0fd8e1a: fix(core): entry-may-throw 双误报修复（issue #97 / #98）——null 守卫后的对象 union 成员读不再报 may-throw（`p === null` 早退 / 内联三元 / `!p` / `!== null` 正分支 / `?. ??` 五形态；转译层守卫臂影子重绑 `$removeNullish`，`?.` 续体同构剪枝）；循环构建二维数组的嵌套索引读（`d[i-1][j]`）不再折 may-throw / never（非字面量下标键修复、oobUndef 越界标记、widenLoopJoin 循环 widen、`.length` 非负 pred 使 `new Array(n)` 豁免 RangeError note、`fill()` 默认窗口元素整体替换、Math min/max sum 实参逐臂判定）。契约版 levenshtein/DP 全绿；无契约 any 实参保持诚实 may-throw 政策不变。

## 1.7.3

### Patch Changes

- 50e50f1: fix(core): analyze 模式顶层剥离（stripEffectfulTopLevel）改结构化——Babel 解析 transpile 产物、按顶层语句整条剥除，替代行级正则 + `endsWith(";")`/括号计数启发式。修复三类实证误剥：① 多行语句回调体内行以 `;`/`}` 结尾提前终止跳过 → 语句尾悬空 `new Function` SyntaxError（如顶层 `setTimeout(fn, 100)`，整模块 fail-closed）；② 字符串/模板字面量里的未配对 `(`（如 `"fetch("`）被计入 `$for`/`$fork` 括号平衡 → 连带误删后续顶层 `export function`（导出静默 unknown）；③ 列 0 的 `catch (` 头匹配「未知全局调用」正则 → 顶层 try/catch 一律被剥成悬空块。剥除口径零变更（`$callNamed` 未知全局、`$for`/`$fork`/`$while*` 与源形态 if/for/while 剥；本地调用、for-of、赋值、`$switch`/`$throw`、try/catch、`__nudo*` 簿记保留），35 例新旧差分语料 30 例字节级一致、5 例均为旧实现损坏样本；新增 run-strip-effectful.test.ts 差分护栏，eval-*（64 文件 657 用例）与 core algebra 全量（272 文件 3078 用例）绿。
- 50e50f1: fix(core): Math 原生折叠抛错不再静默拓宽为 number——min/max、round/floor/ceil/trunc、通用 impl 三处 catch 补 `noteAbsTruncation`（`#math-fold-error`，check 映射 info 级 `nudo:math-fold-error`，不再误报 recursion-truncated），宿主篡改/环境分叉的 `Math.*` 精度损失可观测。`leqAbs` pred 失败文案改用 `predToString` 渲染（`pred ⊭ x > 5` 替代裸 op 名），`nudo:assign-mismatch` suggestion 直接可读。内部：leq 比较辅助函数改精确 `CmpPred`/`Term` 类型（删除三处 `as never` 与弱结构签名，行为零变更）；checkSource 消除 sidecar 场景对同一 source 的二次完整 parse（`localNamedExports` 复用一次结果）。
- 50e50f1: fix(env+check+eval): env 表不再遮蔽宿主命名空间（Math/Number/JSON/Object/Array/String/Date/Promise/BigInt——issue #87，区间透传恢复）；check 与 test/LSP 同口径 preload path 型 env（issue #89）；rewriteBareImports 支持子路径 specifier + nudojs 依赖 `@nudojs/env` + path env 导入失败发 `nudo:env-unresolved` warning（issue #88）；`??` 左值 nullish 臂过滤（`$removeNullish`，issue #90）；循环 pack/unpack 名单剔除循环体内局部词法声明（issue #91，消除 ReferenceError 误报）
- 50e50f1: fix(core): filter 元组投影保真 + assign 拓宽补全数组 sum（OSS semver L1 FP）
  
  - `filter` 空元组结果从 `unknown[]`（无界长度）改为 `[]`；不确定谓词对 ≤3 元组
    枚举精确子序列和（长度有界——filter 不增元素），更大元组保持无界 arr（sound 旧口径）
  - `widenForAssign` 补全数组 sum 分支：全 tuple/arr 成员的 sum 按 tuple 分支同口径
    拓宽为单 arr（可变绑定持数组后赋任意数组是合法 JS）；混入 obj/prim 的 sum 仍精确对账
  - 复合效果：循环 push-join 绑定（`[] | [unknown]`）重赋 `map(...).filter(...)` 不再
    假报 `nudo:assign-mismatch`（benchmark/oss 语料 semver/bin/semver.js L109，#91
    循环 pack 健全化暴露的既有失真）；元素改型等真违例仍报
  - lsp：补全面放行 path-conf 元组（filter 子集和臂成员的 length 是诚实字面量），
    sum 臂 detail 渲染去重

## 1.7.2

### Patch Changes

- 446914f: fix(core): analyze 模式顶层剥离（stripEffectfulTopLevel）改结构化——Babel 解析 transpile 产物、按顶层语句整条剥除，替代行级正则 + `endsWith(";")`/括号计数启发式。修复三类实证误剥：① 多行语句回调体内行以 `;`/`}` 结尾提前终止跳过 → 语句尾悬空 `new Function` SyntaxError（如顶层 `setTimeout(fn, 100)`，整模块 fail-closed）；② 字符串/模板字面量里的未配对 `(`（如 `"fetch("`）被计入 `$for`/`$fork` 括号平衡 → 连带误删后续顶层 `export function`（导出静默 unknown）；③ 列 0 的 `catch (` 头匹配「未知全局调用」正则 → 顶层 try/catch 一律被剥成悬空块。剥除口径零变更（`$callNamed` 未知全局、`$for`/`$fork`/`$while*` 与源形态 if/for/while 剥；本地调用、for-of、赋值、`$switch`/`$throw`、try/catch、`__nudo*` 簿记保留），35 例新旧差分语料 30 例字节级一致、5 例均为旧实现损坏样本；新增 run-strip-effectful.test.ts 差分护栏，eval-*（64 文件 657 用例）与 core algebra 全量（272 文件 3078 用例）绿。
- 446914f: fix(core): Math 原生折叠抛错不再静默拓宽为 number——min/max、round/floor/ceil/trunc、通用 impl 三处 catch 补 `noteAbsTruncation`（`#math-fold-error`，check 映射 info 级 `nudo:math-fold-error`，不再误报 recursion-truncated），宿主篡改/环境分叉的 `Math.*` 精度损失可观测。`leqAbs` pred 失败文案改用 `predToString` 渲染（`pred ⊭ x > 5` 替代裸 op 名），`nudo:assign-mismatch` suggestion 直接可读。内部：leq 比较辅助函数改精确 `CmpPred`/`Term` 类型（删除三处 `as never` 与弱结构签名，行为零变更）；checkSource 消除 sidecar 场景对同一 source 的二次完整 parse（`localNamedExports` 复用一次结果）。
- a00bccc: fix(env+check+eval): env 表不再遮蔽宿主命名空间（Math/Number/JSON/Object/Array/String/Date/Promise/BigInt——issue #87，区间透传恢复）；check 与 test/LSP 同口径 preload path 型 env（issue #89）；rewriteBareImports 支持子路径 specifier + nudojs 依赖 `@nudojs/env` + path env 导入失败发 `nudo:env-unresolved` warning（issue #88）；`??` 左值 nullish 臂过滤（`$removeNullish`，issue #90）；循环 pack/unpack 名单剔除循环体内局部词法声明（issue #91，消除 ReferenceError 误报）
- 39332ca: fix(core): filter 元组投影保真 + assign 拓宽补全数组 sum（OSS semver L1 FP）
  
  - `filter` 空元组结果从 `unknown[]`（无界长度）改为 `[]`；不确定谓词对 ≤3 元组
    枚举精确子序列和（长度有界——filter 不增元素），更大元组保持无界 arr（sound 旧口径）
  - `widenForAssign` 补全数组 sum 分支：全 tuple/arr 成员的 sum 按 tuple 分支同口径
    拓宽为单 arr（可变绑定持数组后赋任意数组是合法 JS）；混入 obj/prim 的 sum 仍精确对账
  - 复合效果：循环 push-join 绑定（`[] | [unknown]`）重赋 `map(...).filter(...)` 不再
    假报 `nudo:assign-mismatch`（benchmark/oss 语料 semver/bin/semver.js L109，#91
    循环 pack 健全化暴露的既有失真）；元素改型等真违例仍报
  - lsp：补全面放行 path-conf 元组（filter 子集和臂成员的 length 是诚实字面量），
    sum 臂 detail 渲染去重
- 446914f: fix(core): simplifyTerm 的 x*1 恒等式不再把 bigint 字面量折成 lit(NaN)（5n*1 原生是混型 TypeError，保留原项交算术核 foldBigintBinOp 处理）

## 1.7.1

### Patch Changes

- ef514a8: fix(core): handle fork-joined sum args in arithmetic, bounds, and non-NaN

## 1.7.0

### Minor Changes

- f6ec0e8: fix #76 (quickfix self-defeating `any()` + false-positive call-site errors):
  
  - service/body-read-types: collect full member-read **paths** (`node.loc.start.line`), not just first-level keys. Dereferenced intermediate fields materialize as **nested shapes** (`loc: shape({ start: shape({ line: any() }) })`) instead of `any()` — an `any()` slot value keeps its member reads counted as may-throw, so the generated contract could not clear the L2 it targeted (issue: 1/7 warnings cleared; now the nested-read cases clear too). Method accesses (`.toLowerCase()`) still type the field directly and stop the chain. `BodyReadField` gains optional `fields?: BodyReadField[]`; `shapeDslFromFields` recurses.
  - core/scan: `any` actuals against a shape precondition are no longer `nudo:constraint-violated` errors — no info, don't guess, matching the scalar-pred channel ("any ≤ 任意目标") and the same function's `unknown` handling. Determined non-object and missing-field actuals still violate (controls pinned).

## 1.6.0

### Minor Changes

- 2f9717b: repo-wide correctness batch (fix-10: 19 fixes + 3 design-defect fixes)

  Security & correctness:
  - type-expression AST whitelist blocks @nudo:case/@nudo:as RCE (P0)
  - unified export/binding-name sanitization (reserved words / collisions)
  - slot & export tables read via own-property, blocking Object.prototype members

  Type system:
  - tuple rest slot effective across leq / widen / runtime / schema / dts
  - x++/x-- propagate term/pred/Φ constraints from the same source as +=/-=
  - key-channel literals distinguish -0/0 (litKeyString)
  - projection/format exits unified under ProjectionBudget: cycle & depth truncation observable

  CLI gates & contracts:
  - health --from path errors fold into pathErrors; ok↔exit single source
  - migrate verify/health pass skips, judged same as nudo check
  - malformed JSDoc directives no longer silently dropped / line-swallowed / host-throwing
  - case-arg recursion depth cap 32 (DoS protection)

  Service layer:
  - cache-limit precedence explicit > env > project; env params take effect per call
  - session LRUs aligned with BoundedLruMap (overwrite refreshes position; max=0 read miss)
  - module-cache entries carry subtree content fingerprints; transitive invalidation cohesive (DESIGN-002)
  - sidecar contract identity = export name, binding name aliasable; reserved-word / string exports emitted safely (DESIGN-003)
  - @nudo:import alias lookup uses the original export name; miss reports a diagnostic

  Parsing & diagnostics:
  - eval diagnostics cover rest / default-value / named-expression declarations and computed-key references
  - ambient sidecar lookup includes .nudo.mjs; suffix set single source of truth

  S2/S5/S6 tracking batch (BUG-017–028):
  - type inference: collectPredVars collects assumeFinite constraints; eqLit channel tagged (eq(x, lit(undefined)) projectable); non-finite bounds (NaN/±Infinity) not projected; fn rest non-array types promoted to (T)[]; optional param names keep `?`
  - gates & CLI: check --fix preserves gate semantics (residual errors exit 1; flag combos are usage errors); variadic flags swallowing positional args → targeted usage error + `--` terminator; export on the PathError face (nudo:path-* + nudo:path-io); findProjectConfig parse-failure diagnostic + stop
  - eval engine: injection-table collection exceptions fail-closed (never a half table); same-name class collision epoch detection + fallback observation; EvalCallRecord.threw required + bridge fail-closed (omitted threw → throwsAbs unknown); tryEvalCall explicit isAbsVal guard
  - LSP / error face: validateText document version gate (stale analysis never published); diagnostic / agent error message absolute-path redaction (home→~, root→.); injection setup failure surfaces and blocks exit
  - observation face: standard-schema missing-key vs explicit-undefined distinction; dts projection optional param names, fn rest TS validity

  PR #80 review batches (merge 7e6051ae):
  - own-property reads across sidecar import/export tables and the modules table; emit-identity dedup; quote-aware sidecar binding scan; check injection-failure gate (no fake-green --json exit, no degraded cache write); class-collision epoch scoped to the entry-call phase; LSP error redaction with real workspace roots; health --from requires explicit paths

## 1.5.0

### Minor Changes

- 64ca356: feat: clamp bounds + scalar-over-sum + action-map quickfixes (#68 #69)
  
  ## #68 inference
  
  - `Math.min` / `Math.max` / `Math.round` (and floor/ceil/trunc) propagate
    operand numeric bounds: `max(0, min(100, n))` derives `[0, 100]`.
  - NaN is explicit (option 1): a possibly-NaN operand yields `NaN | number@bounds`,
    so clamp contracts stay honest; `if (Number.isNaN(n)) return …` narrows the
    false arm (`ne(n, NaN)`) and the guarded clamp is provable.
  - Scalar return contracts now distribute over sum arms like shape/array
    (`nullable(c)` + multi-return `null | number` is provable). Gold-FP
    protection kept: any-widened bare-prim arms downgrade siblings to
    `unproven-return` warnings instead of errors.
  
  ## #69 DX
  
  - `actionsForIssue` kinds are materialized as LSP quickfixes with
    `[fix]` / `[silence]` / `[review]` / `[adjust]` / `[scaffold]` titles.
  - `nudo check --fix [--only <code>] [--write]` reuses the same edit layer
    (default dry-run prints unified diffs).
  - Body-read fields auto-fill types from usage (`node.type === "x"` →
    `string()`, arith → `number()`, no evidence → `any()`); never emit empty
    `shape({})`.
  - L2 `entry-may-throw` suggestions include a copyable sidecar clause.

## 1.4.0

### Minor Changes

- f10066d: fix: repository-scale bug hunt — algebra, CLI, IDE, cache, release hardening
  
  Correctness (core algebra / check):
  - `Symbol() < 1` now TypeError (cmp relational ops); `eq`/`ne` unchanged
  - bare prim contracts reject obj/arr/tuple/fn/brand/eff returns
  - `lit(undefined)` is a real literal (`LitValueResult {ok,value}` tagged path)
  - empty-sum reduce guards (DEC-006); explicit re-exports win over `export *`
  - projection fidelity: tuple holes, tuple-rest parens, schema eq-app anchoring
  
  Design refactors (additive public API):
  - `LitValueResult` + bigint in `LiteralValue`
  - `AbsApplyResult {abs,throws}` + `callTranspiledExportApply` (sole wrap point) + `$call` throws routing
  - `directive-scan` single-source extractors; directives bind AST nearest Function (nested/class/object methods)
  - `stablePathKey` / `stablePathKeyGraph` for L0/LSP/CLI/disk path identity
  
  Product / CLI / migrate:
  - `check --json` path errors enter the CheckJson envelope (`pathErrors`, `ok:false`); ok↔exit single source
  - migrate: missing paths error (no parent `package.json` fallthrough); retire is atomic with rollback; rewritten paths are single-quoted
  - malformed directives warn instead of silent drop; `@nudo:skip` requires explicit types
  
  Service / cache:
  - disk-cache atomic write + portable path keys (incl. maxForks in cache key)
  - pure memo replays may-throw; bounded memo maps; sidecar EACCES ≠ missing
  
  IDE / extension:
  - LSP path-key unify (Windows drive forms); directive diag watermark; hover follows G2 scope
  - VS Code client catches start/sendRequest; selectCase rollback
  
  Release / CI supply chain:
  - `gen-llms` confines slug writes under build root (path-escape fix)
  - gate-major: 2.x / major jumps / first 1.0.0 need `confirm_major`; 1.x train auto-publishes
  - release: quoted secrets, tag whitelist + semver precedence incl. prerelease, pinned website actions

## 1.3.1

### Patch Changes

- 8df9215: fix(contract): array return contracts distribute over sum arms
  
  `assertImplies` distributed **shape** contracts (`constraint.fields`) over the
  members of a `sum` return value, but the **array** branch was reached with the
  sum still intact and rejected it outright:
  
  ```
  return shape sum ⊭ array(...)
  ```
  
  Any function built from the idiomatic "start empty, push conditionally" shape
  therefore reported a false `nudo:constraint-violated`:
  
  ```js
  export function pick(n) {
    const out = [];
    if (n > 0) out.push(n);
    return out;          // [] | [n]  ⊭  array(number().gt(0))
  }
  ```
  
  Each arm is an array on its own (`[]` and `[n]` both satisfy the contract), so
  the sum is too. Array contracts are structural like shape contracts, so they
  now distribute over sum members the same way (`any`-derived members are still
  skipped, keeping the existing gold-FP protection). Non-array arms still report.
  
  Measured on a consumer project (npm-safe): `vetoFindings` / `decide` return
  contracts went from `nudo:constraint-violated` errors to clean, with no other
  diagnostic movement.

## 1.3.0

### Minor Changes

- c717017: fix(dx): sidecar load failure reported once (#64) + contract/DX improvements
  
  1. **Sidecar load failure dedup** (defect): a broken `*.nudo.js` no longer
     reports the same `nudo:interface-load` once per source export. Unrelated
     exports are filtered by the sidecar's export names before exec; module-level
     failures dedup by (path, reason) with one message and `(affects N bindings)`
     — wording no longer says `for 'X'` (reads like X itself is broken).
  
  2. **L2 entry-may-throw actions**: the most honest fix (sidecar `fn({ … })`
     param contract) is now the first suggested action, ahead of `@nudo:throws`.
  
  3. **Destructured param contracts render**: `decide({ grade, findings })` with
     a sidecar field contract shows `{ grade, findings }: { grade: string, … }`
     instead of `decide(_p0: any)`.
  
  4. **`@nudo:budget` function-level budget knob**:
     `@nudo:budget forks=20000` / `calls=… depth=…` raises the call/fork budget
     for that function's evaluation only (restored after). Truncation
     suggestions point at this knob instead of only global `maxForks`.

### Patch Changes

- 6bc08c7: fix(env): env globals no longer shadow the host `undefined` / `NaN` / `Infinity`
  
  `runTranspiled` injects every `@nudo:env` global as a module-scope
  `const <name> = __nudoEnv["<name>"]`, which shadows the host global for the
  whole transpiled body. `@nudojs/env/es` declares `undefined: undef()`, and
  `web` / `node` imply `es` — so any `nudo.env` declaration shadowed `undefined`:
  
  - the transpiler's own bare `undefined` text (`stmt` missing `else` arm,
    implicit return) and `$lit(undefined)` received an **Abs object**;
  - effect: a conditional `return` inside a loop joined to `unknown`, so
    `for (const s of list) { if (s === "high") return "l1"; } return "l0";`
    folded to `unknown` instead of `"l0" | "l1"`;
  - `NaN` bound as `prim.num()` degraded `0 === NaN` from the definite `false`
    of native semantics to `boolean`.
  
  Injection now skips `undefined` / `NaN` / `Infinity`: the transpiler already
  hardcodes those identifiers as `$lit(...)`, so the consts had no upside and
  only shadowed the host.
  
  Measured on a consumer project (npm-safe) with `nudo.env = ["es","node","web"]`:
  `nudo test` went 39/39 → 23 passed / 10 failed; with this fix it is 33 + 6
  planned cases green again, plus `opaque-result` 34 → 28, `unknown-inference`
  9 → 6, `host-effect-blocked` 1 → 0 (env-declared builtins now fold instead of
  failing closed).
- d925692: fix(core): transpile emissions no longer depend on host `undefined` / `NaN` / `Infinity` identifier identity
  
  Follow-up hardening after the env-injection skip fix:
  
  - emit `$lit(void 0)` / `$lit(0/0)` / `$lit(1/0)` instead of `$lit(undefined)` /
    `$lit(NaN)` / `$lit(Infinity)` so generated code never reads those identifiers;
  - omit `$fork`'s third argument when there is no `else` arm (previously emitted a
    bare `undefined` sentinel that broke if the name was shadowed);
  - share one `HOST_INTRINSIC_NAMES` table between transpile folding and the env
    inject skip set, so the two lists cannot drift;
  - free-assignment / fork-binding filters exclude all three intrinsics, not just
    `undefined`.

## 1.2.2

### Patch Changes

- 662aeb5: fix(env): env-declared `Number`/`Array`/`Promise`/`Date` no longer shadow away call/construct
  
  Declaring `nudo.env` (e.g. `"es"`) bound these globals as namespace-only
  `objAbs` objects. Once shadowed, `Number(x)` and `new Array(n)` found nothing
  callable/constructible and degraded to `unknown` — the opposite of the host
  identity path (no env), which folds via `GLOBAL_FNS` / `$new`'s `cls === Array`.
  
  Dual-facet globals now model both faces (issue #58 option 1):
  
  - Abs `fn` may carry static `slots` (`Number.isFinite`, `Array.isArray`, …).
    `$get` / `$in` read them; `typeof` stays `"function"`.
  - `$new` dispatches Abs constructors by name through `evalBuiltinNew`
    (Array/Date/Promise/Number/String/Boolean/Map/Set/Error), instead of only
    the Error/Promise special cases.
  - ES env declares `Number`/`Array`/`Promise`/`Date` as callable `envFn` with
    static slots and a ctor `name`, so call, construct, and statics all keep
    builtin semantics under env shadowing.
  
  `Number(s)` folds to `number`, `new Array(n)` to a holey tuple, and
  `Number.isInteger` / `Array.isArray` stay precise with `nudo.env` declared.

## 1.2.1

### Patch Changes

- 7b8df37: fix(core): JS semantics — UpdateExpression, optional chain, enumerable, ToPropertyKey, copyWithin, split limit, isPrototypeOf
  
  Seven evaluator/transpile correctness fixes (one commit per class):
  
  - `x++`/`x--` use ToNumeric ± 1 (bigint gets `1n`); postfix caches the old value (IEEE 2^53 safe). `"5"++` is `6`, not `"51"`.
  - Optional chains short-circuit the **remaining** chain (`a?.b.c` ≡ `a == null ? undefined : a.b.c`), including `o?.length` / `o?.[k]` / `g?.()` / `o.m?.()`. RegExp `test`/`exec` inside a chain still rebind `lastIndex`.
  - `for-in` / `Object.assign` honor `enumerable` (shared `enumOwnKeys` / `isEnumerableView` with `Object.keys`).
  - ToPropertyKey stringifies `null`/`undefined`/`boolean` computed keys (`o[null]` ≡ `o["null"]`) for get/set/in/delete.
  - `copyWithin` overlap direction uses the **resolved** window (negative indices no longer flip).
  - `split(undefined, limit)` uses ToUint32 (`0.5`/`±Infinity` → `[]`; `-1` → `2^32-1`).
  - `Object.prototype.isPrototypeOf(Object.prototype)` is `false`.
- af8cb68: fix(core): JS semantics soundness — JSON space, bigint throws, `__proto__` keys
  
  - `JSON.stringify` space goes through to the host (`min(10, ToIntegerOrInfinity)`); `Infinity` / `(0,1)` fractions no longer collapse to compact.
  - Mixed / invalid bigint ops hard-throw `TypeError`/`RangeError` when the other operand is **definitely** non-bigint (number/bool/null/undefined). Abstract operands (`any`/`obj`/string-prim for `+`) no longer fold to `never` — `1n + s` is string concat, `1n + x` (any) is `bigint | string` with soft may-throw.
  - `__proto__` own keys survive (`JSON.parse`, computed literal, method named `__proto__`, spread/assign copy) via `defineProperty`; non-computed `{__proto__: v}` is the ES prototype special form; `Object.setPrototypeOf` missing/`undefined` proto throws.
- ff37d91: fix(core): string-face typing — concat/template with an `any` operand, abstract `.length`
  
  Two gaps that made provably-string expressions come out as `unknown` (and
  raised `nudo:unknown-inference` on real projects):
  
  - `concatString` fell back to `unknown` whenever one side had no
    string-parts view — including `any`/`unknown`. But a string operand
    determines the result type: `"s" + x`, `x + "s"` and `` `${x}` `` are all
    `string` (the ToString-throws-on-Symbol path is not modelled here). This
    contradicted `docs/design/limitations.md`'s mixed-`+` narrowing discipline
    (`number ⊗ obj/unknown → number | string`) — `1 + x` narrowed, `"s" + x` did
    not. Now a definitely-string side yields `string` (`path` conf); all-other
    cases keep the previous `unknown`.
  
  - `$len` had no branch for an abstract string prim (template / concat result /
    abstract `string`), so `` `${x}`.length `` and `String(x).length` fell to the
    trailing `unknown`. String length is always `number`; literal strings still
    fold exactly.
  
  Verified on a real project: `tarballUrl`-shaped templates and
  `printScore` / `printPublishResult`-shaped helpers stop reporting
  `nudo:unknown-inference`.

## 1.2.0

### Minor Changes

- 5ff4202: refactor!: rename B-path / BPath engine identifiers to eval / evaluator
  
  The AST-walk interpreter is long gone, so the dual-engine campaign name
  "B-path" no longer means anything and forced a glossary entry just to
  explain itself. The single production evaluation engine is now simply
  the **evaluator** (mechanism: transpile → `new Function` on Abs).
  
  Breaking renames (no major bump — package has no external users yet):
  
  | Old | New |
  |---|---|
  | `tryBPathCall` / `tryBPathCallFull` | `tryEvalCall` / `tryEvalCallFull` |
  | `tryRunBPath` | `tryRunEval` |
  | `isBPathCapable` | `isEvalCapable` |
  | `clearBPathCache` / `trimBPathCache` / `getBPathCacheSize` | `clearEvalCache` / `trimEvalCache` / `getEvalCacheSize` |
  | `evictBPathCacheForFiles` | `evictEvalCacheForFiles` |
  | `collectBPathDiagnostics` / `collectBPathReplacements` | `collectEvalDiagnostics` / `collectEvalReplacements` |
  | `BPathRunResult` / `BPathDiagnostics` / `BPathFallback` / … | `EvalRunResult` / `EvalDiagnostics` / `EvalFallback` / … |
  | `BCallRecord` / `setBCallCollector` / `getBCallCollector` | `EvalCallRecord` / `setEvalCallCollector` / `getEvalCallCollector` |
  | `noteBPathFallback` / `setBPathFallbackCollector` | `noteEvalFallback` / `setEvalFallbackCollector` |
  | `MAX_B_CALL_DEPTH` / `MAX_B_TOTAL_CALLS` / `MAX_B_TOTAL_FORKS` | `MAX_EVAL_CALL_DEPTH` / `MAX_EVAL_TOTAL_CALLS` / `MAX_EVAL_TOTAL_FORKS` |
  | `maxBRuns` (sessionCache) | `maxEvalRuns` |
  | `NUDO_CACHE_MAX_BRUNS` | `NUDO_CACHE_MAX_EVALRUNS` |
  
  Source files `bpath-run.ts` / `bpath-diagnostics.ts` / `bpath-*.test.ts`
  are now `eval-run.ts` / `eval-diagnostics.ts` / `eval-*.test.ts`.
  Docs no longer introduce a "B-path" term or explain why the engine is
  called B. Historical CHANGELOG / releases-history keep the old name.

### Patch Changes

- 5ff4202: fix(core): more JS semantics soundness — Array.of / .at() / postfix ++-- / ToPrimitive
  
  - `Array.of` packs arguments into a tuple, not an array of the first element
  - `.at()` honors ToIntegerOrInfinity (string.at + array.at index)
  - postfix `++`/`--` writes back inside the expression
  - `+` honors ToPrimitive/ToString for arrays, objects, undefined
  - drop dead duplicate `case "promise"` in checkNode

## 1.1.4

### Patch Changes

- 634932f: fix(core): Array.prototype method reads no longer hijack `$invoke`
  
  `$get` returned `absFunction([], { body: noBody })` for Array.prototype
  methods (`concat`/`sort`/…). `$invoke` treated that hollow impl as an object
  method and `$call`ed it, folding `a.concat(b)` to exact `undefined` and
  `arr.sort()` to `never`/TypeError — false precision vs the previous
  conservative `unknown` (benchmark gate: `array-03` / `complex-01` regressed
  `unknown → mismatch`).
  
  First-class reads still expose a function-shaped Abs (`typeof a.push ===
  "function"`), but without a callable impl so method calls fall through to
  `invokeArrMethod` / conservative `unknown`.

## 1.1.3

### Patch Changes

- 3bf9997: fix(core): JS semantics soundness — ToString args, compare undefined, NaN identity, JSON.stringify
  
  B-path Abs folding corrections so concrete results match native JS:
  
  - string/parse methods (`startsWith`/`endsWith`/`includes`/`split`/`replace`/
    `indexOf`/`parseInt`/`parseFloat`) honor ToString and missing-arg defaults;
    `split` keeps the ES special case that an **undefined** separator returns
    `[ToString(O)]` without splitting
  - relational compare of `lit(undefined)` folds via ToNumber (all relations false)
  - same-var `===` is not exact `true` when the value may be NaN
  - `JSON.stringify` of top-level function/symbol returns the JS `undefined` value
  - NaN literal identity uses SameValue (assignment/`leq`), not `===`
  - drop unsound `x*0=0` / `x+0=x` algebra identities (NaN/`-0`/string domain)
  - `n % 0` folds to NaN; `x % k` bounds only for finite dividends
  - `0n` is falsy; `Number.is*` fold non-number lits to false; global `isNaN` coerces
  - string index methods (`charAt`/`slice`/…) honor ToNumber and default args
  - unary minus and `parseInt`/`parseFloat` honor ToNumber/ToInt32
  - Math.* folds ToNumber lits (own numeric methods only — no `constructor`/`toString`)
  - tuple index reads use canonical array index (`a["0"] === a[0]`)
  - call-spread placeholder is `unknown`, not `undefined` lit
  
  `fix(parser)`: directive scanners (`splitTopLevelArgs` / colon / arrow / balanced
  parens) respect string literals.
  
  Review follow-ups folded in: `split(undefined)` special case, `indexOf` returns
  number shape on abstract receivers, Math method allowlist.

## 1.1.2

### Patch Changes

- c1f3e93: fix(core): never-execute host side-effect guard also covers `new`
  
  `$new` was not identity-guarded against the host side-effect list
  (`WebSocket` / `XMLHttpRequest` / `EventSource`), so `new WebSocket(url)`
  only avoided real network I/O by falling through to an empty brand —
  a coincidence, not an explicit block. Both `$callNamed` and `$new` now
  share `blockHostSideEffect`: identity match fails closed to
  `unknown#opaque` and reports `nudo:host-effect-blocked`.

## 1.1.1

### Patch Changes

- 86d1f87: fix(core): never execute host side-effect globals in the B path
  
  `$callNamed` executed any host function it could not fold, so a module calling
  `fetch(url)` made the analyzer issue a **real** network request with Abs
  arguments (`[object Object]`): `nudo check` / `nudo test` died with
  `TypeError: Failed to parse URL from [object Object]` (ERR_INVALID_URL) via an
  unhandled rejection. `setTimeout` / `setInterval` scheduled real timers the
  same way.
  
  `fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` / timers /
  `queueMicrotask` / `requestAnimationFrame` / `requestIdleCallback` are now
  identity-guarded (aliases included) and fail closed to `unknown#opaque`,
  reported through a dedicated `nudo:host-effect-blocked` (info) diagnostic —
  not `nudo:recursion-truncated`. Other host functions still evaluate for real.
- 892899d: fix(core): RegExp.exec precision with non-literal subject + nullish return prefilter
  
  Two return-path defects that both show up in the classic "parse and return null
  on no-match" shape:
  
  1. `execRegexBrand` documented "exec → null|tuple 的保守并" for a subject that
     is not a string literal but returned `undefined` instead. The caller then fell
     through to the "method not found" path and the result became the Abs
     `undefined`: `typeof m` folded to the literal `"undefined"`, `m === null` folded
     to `false`, capture groups stayed unknown, and `Number(m[1])`-style returns
     collapsed. `exec` now returns the conservative `null | array(string|undefined)`.
  
  2. `checkReturnConstraint` reported a `null` return as violating a `shape({...})`
     contract. lit `null`/`undefined` cannot satisfy any constraint, so reporting
     it is a false positive (`return null` means "no value", not "wrong value").
     Nullish evidence is now prefiltered there too, matching the parameter-side
     prefilter (`scan-injected-domain`, T4 caveat).
  
  Real-world case: a `parseVersion(v)` that returns `null` for unparsable input
  and `{ major: Number(m[1]), … }` otherwise — with #40's sum distribution the
  remaining report was the nullish member alone.
- faccd76: fix(check): return-shape contract distributes over branch sums
  
  `checkReturnConstraint` only accepted `ret.shape.k === "obj"`, so a return value
  that is a **sum** (e.g. `if (flag) obj.extra = x; return obj;` — the two branch
  shapes join into a sum when their key sets differ) was reported as
  `nudo:constraint-violated` even when every member satisfied the declared
  `shape({...})` contract. Real-world hit: sidecar `fn({...}, shape({...}))`
  returns with a conditional field.
  
  Shape contracts now recurse into sum members (each member must satisfy the
  contract, issues deduped). Scalar contracts (prim / numeric bounds / domain)
  still do not distribute: sum members can be operator-derived unions from
  unconstrained operands (`any + any` → `number | string`) and reporting those
  is a false positive per the check-gold precision discipline.

## 3.0.0-beta.0

### Major Changes

- 22baf33: feat!: product CLI face only — remove deprecated verbs/aliases; L2 entry may-throw
  
  - **BREAKING — deleted with no compatibility layer:** verbs `infer` / `types` / `interface` / `refine` / `generate` / `emit` / `guard` / `doctor` / top-level `watch` / `harvest`; flags `--callsites`, `--output`, `--format zod`, `--dts`, `--emit-cases`; API `absToZodSchema`; `InferJson`/`serializeInferJson` → `CaseJson`/`serializeCaseJson`; LSP agent tools `nudo.infer` / `nudo.interface*` and aliases → `nudo.test` / `nudo.contract*`; config key `package.json#nudo.interface.*` → `package.json#nudo.contract.*`. Root scripts `infer`/`types`/`interface` removed.
  - Primary verbs: `check` / `test` / `contract` / `export` / `health` / `env harvest`. Observation is check signatures + test case reports + IDE hover. Thin shell `@nudojs/nudojs` follows `@nudojs/cli` majors.
  - L2: undigested may-throw on entry/export functions is `nudo:entry-may-throw` (default **error**). Configure with `--ignore-throws` / `--entry-throws` or `package.json#nudo.check.{ignoreThrows,entryThrows}`.
  - Nested try: soft may-throw from an inner try re-homes to the enclosing try frame. Catch rethrow does not digest soft effects.
  - `check` always prints signatures on success; unconstrained entry params display as **`any`** (true `unknown` = inference failure + `nudo:unknown-inference`).
  - `test` prints every case including synthetic `call@`/`entry@`; only declared `@nudo:case` expectations affect exit. `--freeze[=update]` solidifies witnesses.
  - Flags: `--from`, `export --format dts|guard|schema|standard|all` (`--dialect zod` for schema), `export --out`. `--json` cannot combine with `--abs`.
  - Design docs consolidated: truth sources `design-kernel-merge.md` + `design-cli-semantics.md`; domain designs compressed to status summaries.
  - Breaking for CI scripts that still call old verbs or read old config keys.
- 0e1432a: feat!: source contract directive is `@nudo:contract` only
  
  `@nudo:refine` and `@nudo:interface` are deleted with no alias layer. The product word is **contract** end to end (sidecar `*.nudo.js`, `@nudo:contract`, `nudo contract`, `package.json#nudo.contract.*`).
  
  - **BREAKING:** replace every `@nudo:refine` / `@nudo:interface` with `@nudo:contract` (including `@nudo:contract return <constraint>`). Grammar is unchanged: `@nudo:contract <param> <constraint>`.
  - Constraints still enter Abs as Preds and participate in algebra (`x>0` ⇒ `x+1>1`) — this is not a call-site validation gate.
  - Diagnostic codes `nudo:interface-*` are unchanged in this release.
  - Chinese product copy uses 契约, not 精化.
- 3c3f9d2: Reduce `@nudojs/core` public export surface (breaking).
  
  Engine machinery is no longer re-exported from `.` or `./exec`. Hosts that
  need leak/call-budget/hash/derivation/inlay/template/language/scan extras or
  may-throw · member-diag collectors import `@nudojs/core/internal` instead.
  
  - `@nudojs/core` (`.`) keeps the product face only (Abs, check, format,
    projections, contract builders, B-path `$op` runtime + transpile).
  - New subpath `@nudojs/core/internal` (minor-escape hatch; no SemVer promise).
  - `packages/core/PUBLIC_API.md` + `public-api.snapshot.json` updated; freeze
    test also asserts product face does not leak internal names.
  
  Product CLI faces (`check` / `test` / `contract` / `export` / `health`) are
  unchanged. `@nudojs/service` / `@nudojs/lsp` already retargeted.

### Minor Changes

- 279d73a: fix review gaps on the B-path migration (PR #34 follow-up):
  
  - **inject pipeline**: `CheckOptions.inject` is now threaded into generalize, L2 throws, the record channel, and drift recompute (previously CLI computed mocks/env/replacements but only `modules` reached core; `@nudo:mock`/`env`/`replace` sources were fail-closed `unknown#opaque` under `checkSource`). Memo keys use inject **content** fingerprint (stable across CLI's per-call object allocation). `mode: "analyze"` always wins; `modules` prefers `opts.modules` then `inject.modules`.
  - **L2 class / CJS methods**: explicit `throw` on class static methods and CJS object methods is no longer hard-coded as `throws: never` — NudoThrow/ReferenceError map to throws Abs (same as `callTranspiledExportFull`). `$call` records throw exits before returning `never`. L2 evaluation now seeds `phi` from `checkSource`.
  - **`freeIdentifiers`**: lexical scopes (nested params no longer pollute outer free set); non-computed `ObjectMethod`/`ClassMethod` keys are not free refs.
  - **`callBudgetKey`**: single defensive implementation for non-Abs args (B-run JS function args). `$call` compiled-body path now uses `enterCall`/`exitCall` (same budget as apply). Budget keys use fn object identity (`stableCallId`) instead of `anon#N` (false cycles across same-arity functions). `MAX_TOTAL_CALLS` unified at 20k.
  - **method early-return (correctness)**: `ObjectMethod` / `ClassMethod` / property `FunctionExpression` bodies now go through `transpileFnBodyStmts` (early-return lift) + implicit return — previously `if (c) return X; return Y` silently always returned `Y` (false precision vs native).
  - **collectors**: `setBCallCollector` / `setBAssignCollector` / `setMemberDiagCollector` / `setAbsTruncationCollector` return the previous collector; nested call sites save/restore instead of nulling.
  
  User-visible notes:
  
  - Sources with `@nudo:mock` / `@nudo:env` / `@nudo:replace` get real B evaluation under `nudo check` (CLI already built the inject pack).
  - Class static / CJS object methods with explicit throws now report `entry-may-throw` (L2 no longer misses them).
  - Object/class methods with early-return branches now fold the same values as native JS (differential batch19).
  - `interface-derivation` class-method roots stay fail-closed (no call-chain derivation) — intentional after ast-eval removal.

### Patch Changes

- P1–P3 engineering hardening (review follow-ups) — no product-face breaks
  
  - **@nudojs/parser**: export typed Babel AST narrowers (`ast-guards.ts`); service `analyzer-ast` / lsp `symbols` no longer use `as any` on nodes.
  - **@nudojs/cli**: extract pure decision modules (`check-gate-config`, `check-json-map`, `check-ci-flags`, `export-format`) and cover them with in-process unit tests; per-package coverage floors raised.
  - **@nudojs/service**: host cache-invalidation contract documented (`docs/design/cache-invalidation.md`) + C1–C8 regression tests; LSP targeted eviction now clears path-env and abs-module cache for changed deps.
  - **@nudojs/lsp**: `server.ts` split into watch/commands/navigation/code-actions/ide modules (public API unchanged); path-env clear on dependent eviction.
  - **@nudojs/service**: `interface-derivation` / `analyzer-orchestrate` split into cohesion modules with stable facades.
  - Docs: trust-boundary note in Quick Start, version narrative consistency, env mock-boundary checklist, CheckJson `actions[]` field table.
  - vite-plugin: named `logAnalysisSummary` helper (logging surface unchanged).

## 2.1.0

### Minor Changes

- 69ebbf6: Align product surface with interface-first design: `@nudo:case` is debug / `nudo test` only, and the `T.*` directive grammar is removed.

  - Directive type expressions accept constraint builders (`number()`, `lit()`, `shape()`, `union()`, `array()`, `any()`, …) and concrete literals only. Bare `T.*` parses as unknown; `parseTypeValueExpr` is no longer exported — use `parseCaseArgExpr`.
  - `serializeCaseArg` / `--emit-cases` emit builders (`number()`, `union(…)`) instead of `T.*`.
  - LSP `typeExprToDirective` emits builders (`number()`, `union(…)`, `any()`).
  - CLI `infer` reports call-site facts (`call@L…`) and `debug "name"` witnesses with `Observed:` joins — not `Case "…"` / `Combined:` as the type product. Contracts stay on `*.nudo.js` / `@nudo:refine`.
  - Constraint builders accept concrete nested literals so directive grammar round-trips.

## 2.0.1

### Patch Changes

- 9731238: **BREAKING (behavior)** `@nudojs/service`: handwritten `@nudojs/env` now **wins** over harvest / module-graph modules on overlapping module keys and export names (`mergeHarvestUnderEnv`). This is the documented B8 priority — harvest only fills missing slots — but analysis results on projects that relied on harvest overwriting a handwritten env export will change.

  Migration: remove or update the conflicting handwritten `@nudojs/env` slot if you needed harvest's version; otherwise no code change. Conflicts emit a `nudo:env-harvest-conflict` warning listing overwritten module/export names.

  Also in this service major (additive public surface, riding the required major for the priority change):

  - Public harvest helpers: `mergeHarvestUnderEnv` (optional per-call `onConflict`), `setEnvHarvestConflictCollector` (returns previous; save/restore for nested analysis), `getEnvHarvestConflictCollector`, `clearNodeHarvestCache`, `getNodeHarvestCacheSize`, `isHarvestNodeDisabled`, `HARVEST_NODE_DEFAULT_*`. Negative harvest outcomes (`not-found` / `no-dts` / `failed`) are cached in-process; `NUDO_HARVEST_NODE=off` stays explicit and uncached. `clearNodeHarvestCache()` also drops `not-found` misses so a later `@types/node` install is visible in-process. `nudo:env-harvest-conflict` warnings point at the conflicting import specifier when found (file-level `line 0` otherwise).
  - `@nudojs/env` (minor): `events` / `stream` / `querystring`; high-frequency `util` slots; **Promise APIs only under `fs.promises` / `node:fs/promises`** (callback-style `fs.readFile` etc. no longer pretend to return Promise). Optional Node params (`path.basename` ext, `url.URL` base) keep typed labels (`ext?: string`) but are **not** required slots — `requiredFnArity` skips `?` / `...`.
  - `@nudojs/core` (patch): `formatShape` renders fn rest labels (`...paths`) and optional labels (`options?`) as `...name: T` / `name?: T`. `leqAbs` fn arity uses **required** slots only (`requiredFnArity` skips `...rest` / `name?`): src is assignable to tgt iff `src.required ≤ tgt.required` (TS-like — rest src ⊑ required tgt; required src ⊭ rest tgt when src requires args). Pairwise `paramTypes` contravariance is unchanged.
  - `@nudojs/lsp` (patch): freeze inventory in `public-api.ts` (also exported as `@nudojs/lsp/public-api`); agent slash requests register from `NUDO_AGENT_TOOL_NAMES`; `selectCase` / `getActiveCases` are editor executeCommand + slash-only (not dot-form custom requests).

  Migration for env consumers who need bit-stable hover/format strings: pin `@nudojs/env` `~0.3.0` after the next release, and prefer **leaf-clean** coverage counts (empty `{  }` shapes are not leaf-clean) over raw resolved ratios.

## 2.0.0

### Major Changes

- aea83f6: **BREAKING** (fix-2: close TypeScript DX gaps):

  - **C0.1 contract model:** body-AST required-slot inference removed. `nudo:arg-structure` now means HOF argument not callable / arity mismatch only. Obligations come from explicit `*.nudo.js` / `@nudo:refine` contracts or call-site facts; no evidence → any. Migration: add a sidecar shape contract where you need structure checks.
  - **A1 analysis default:** `package.json#nudo.analysis.mode` shipped default is now `exports` (was `directives`). Files with `export` / sidecar / `@nudo:` directives are analyzed by IDE/build. Escape hatch: `"mode": "directives"` (previous silence) or `"all"` (every target path). Named-path CLI commands still analyze the named file regardless of mode.

  Release notes / policy: `docs/versioning.md`. Scope defaults: `docs/design/cli-semantics.md`.

  Feature highlights (after accepting the defaults above):

  - Core algebra: Map/Set literal tracking + fork join, loop early-return fold, catch param binding, `==`/`!=` fold, logical assignment, HOF relations, class-method sidecar keys (`Class.method` / `Class_method`, local declaration name for `export { Local as Public }`)
  - Interface product: `nudo interface --draft` (code-first contracts), enforcement tiers, CJS/default/class export forms
  - IDE: LSP buffer-aware sidecars, quickfix/code actions, validate cancel + debounce, diagnostics tiers, agent/LSP parity
  - Scale: disk CheckJson cache, analysis session memo, call-site budget, watch invalidation (sidecar/config/env)
  - dts projection quality (tsc-clean HOF/unions), vite-plugin aligned to `analysis.mode`

## 1.0.1

### Patch Changes

- 61b8a6c: Fix soundness issues in Abs evaluation:

  - `parseInt` honors hex/octal/binary prefixes and explicit radix (no forced radix 10)
  - `Array.isArray` returns unknown boolean for any/unknown/sum, and sees through brand
  - `Date.now()` is an unknown number, not a folded wall-clock timestamp
  - strict numeric bounds win over non-strict at equal value (order-independent)
  - `boundsSatisfiable` no longer downgrades strict bounds via redundant ge/le
  - structural `absShapeKey` stops join/dedup collapsing distinct arrays, overloads, brands
  - `denoteGuard` renders NaN/±Infinity correctly
  - `String.split` with non-literal separator returns `arr<string>`, not a 1-tuple

## 1.0.0

### Major Changes

- 0fd253f: **BREAKING**: `@nudojs/cli/evaluator` 子路径已移除。求值器 API 迁至 `@nudojs/service/evaluator`（消除 cli↔service 工作区环）。迁移：`import { … } from "@nudojs/cli/evaluator"` → `import { … } from "@nudojs/service/evaluator"`。

  架构与正确性批次：

  **正确性修复（core）**

  - `slots[key]` 原型链泄漏：`__proto__`/`toString`/`valueOf` 等键命中 Object.prototype 导致引擎崩溃或误报——新增 `getSlot` 守卫并接入 projectBrand / 静态与计算成员访问 / leq / check 五处读取点（eventemitter3 真实包上曾崩溃）
  - `Array.from` 语义修正：与 `Array.of` 混用导致 `Array.from(new Set(arr))` 误报 `Set[]`；现按元素分布（tuple→ 元素 join、string→string[]），未建模可迭代物诚实返回 unknown
  - 模板 `endsWith` 不健全判定修正：误报 false 的分支改为共享的健全 `decideEndsWith`
  - `nudo:assign-mismatch` 精度：分支/循环体内的可变绑定重赋值（特性检测模式）不再误报；无条件标量改型仍报（金标行为保持）
  - `nudo:arg-structure` 精度：`x && x.__esModule && x.default` 守卫后的成员访问不再计为必填 slot

  **结构拆分（无行为变化）**

  - check.ts 2024→748 行：源码级调用图侦察拆至 algebra/scan.ts；AstEnv 类型下沉 ast-env.ts（消 5 处巨石 type-import 环）
  - evaluator.ts 5164→4058 行：内置方法语义迁至 builtins/builtin-methods.ts；analyzer.ts LSP 表面拆至 service/lsp-surface.ts
  - 模板字符串语义归一：refinements/template.ts 七处重复实现改为委托 algebra/template.ts（单一真理源）
  - 容器策略单源：ast-eval 与 B 路径 runtime 共享 containers.ts（>8 元素字面量降级策略一致，B 路径 $concat 修正嵌套近似）
  - 求值器域从 @nudojs/cli 迁至 @nudojs/service/evaluator（消除 cli↔service 工作区环；`@nudojs/cli/evaluator` 子路径移除，改用 `@nudojs/service/evaluator`）
  - 真实包门禁加固：扫描失败/0 文件即红，不再静默 skip；fixture 包显式声明为 core devDependencies

### Minor Changes

- 0f0b7d5: **Feature**: Interface 分层推导 Phase 1（design-refine-derivation.md）

  - 侧车同名自动绑定：`foo.nudo.js` 导出绑定 `foo.js` 本地 named export；手写 > `@generated` > 隐式合并序
  - 约束代数：`lit` / `union` / `fn` / `shift` / `and` / `partial` / `pick` / `omit`
  - Abs→ 契约投影与字面量域隶属（domain-membership）
  - 新诊断：`nudo:interface-drift` / `interface-domain-exceeds` / `interface-conflict` / `interface-cycle` / `interface-load` / `interface-name-clash`
  - CLI：`nudo interface`（别名 `refine`）分层打印；`--emit` / `--fn` / `--all` / `--dry-run` / `--exit-on-diff` / `--callsites`；`nudo check --callsites`
  - 配置：`package.json#nudo.interface.autoBind`（默认 true；node_modules 永不 ambient 加载）
  - LSP：CodeLens interface 默认层 + persist/update；agent 工具 `nudo.interface` / `nudo.interface.emit`（emit 路径限制在项目根内）
  - 新薄壳包 `nudo`（`bin` 委托 `@nudojs/cli`）

### Patch Changes

- a2aac9e: Final review pass on feat/interface Phase 1:

  - **LSP emit bound live**: `handleInterfaceEmit` now passes `agentToolDeps` so `workspaceRoots` reach `assertEmitTargetAllowed` (was dead in production).
  - **Emit fail-closed**: empty `workspaceRoots` rejects; no ancestor-`package.json` authorization fallback; `realpath` blocks symlink escape; refuse writes under `node_modules`.
  - **autoBind kill-switch complete**: threaded through scan `generalizeFromAst` / same-file `eiOpts`; empty `fromFile` no longer ambient-binds `.nudo.js`.
  - **Conflict skip**: conflicted params no longer also emit call-site `constraint-violated`; detect eq/eq and eq/bound unsat.
  - **Return contracts**: string length bounds (`string().min/max`) enforced via domain membership.
  - **Perf/stability**: file-local `effectiveInterface` memo in check; `take*Since` on memo hit/miss (no LSP diag theft); `shift` rejects non-finite offsets; `@generated` marker requires adjacent comment block; add-mode empty targets no longer rewrite trailing whitespace; emit tmp name randomized.

- de47d84: Review fixes on feat/interface Phase 1:

  - **autoBind kill-switch**: analyzer's cross-file `nudo:interface-domain-exceeds` path now reads `package.json#nudo.interface.autoBind` (was silently ambient-loading sidecars when `autoBind: false`).
  - **`nudo check --callsites`**: inject usage-site call records so CI gate can surface `nudo:interface-domain-exceeds` (previously only reachable via analyze/interface paths).
  - **Sidecar auto-bind coverage**: `localNamedExports` accepts local `export { x }` / `export { local as exported }` list form (was declaration-only; silent miss for common style).
  - **Directory targets**: `isNudoTargetPath` excludes `*.nudo.js` / `*.nudo.ts` so check/infer/doctor no longer treat contract modules as source.
  - **VS Code client**: documentSelector includes TypeScript; file watcher covers `**/*.{js,mjs,ts}` (includes `.nudo.ts` sidecars).
  - **LSP emit**: failed `interfaceEmit` no longer claims "sidecar written" and skips the invalidation path.
  - **UX**: first `--emit` with empty default targets prints a `--fn`/`--all` tip; `--fn`/`--all` without `--emit` warn; CodeLens titles use "interface" not "refine"; domain-exceeds message is English (matches other diagnostics).

- 78f6752: Fix hover, case switching, and NaN folding in Zed-style clients.

  - `const n = double(21)` reports the init Abs (`42`) instead of the statement's `unknown` (record the declarator id in `evalVarDecl`).
  - `const s = double("a")` is `NaN` (JS `"a" * 2`), not `unknown` — concrete string/boolean lits coerce under ToNumber; `formatAbs` prints `NaN`/`Infinity` instead of `null`.
  - Relational compare folds mixed concrete lits (`"a" > 3` → false), so `if (x > 3)` does not join both branches for NaN inputs.
  - `joinValues` uses `Object.is` so `join(NaN, NaN)` stays `NaN` (`NaN === NaN` is false).
  - `workspace/executeCommand` accepts positional `nudo.selectCase` args from CodeLens (`[uri, fn, index, name]`).
  - Hover inside `@nudo:case` functions goes through TypeValue + `activeCases` instead of call-site B-path nodes.
  - Param inlay no longer invents `where x > 3` from `if (x > 3) return x` — only explicit `@nudo:refine` contracts show as preconditions.
  - Return inlay is a path summary with source param names: `x + 1`, `x | x * 2` (not the refined `number where x>3 | string | …` dump).
  - Number range narrowing uses exclusive bounds (`> 3`, not integer-style `>= 4`).
  - Concrete `if` tests no longer narrow the tested value into a range (`44 > 3` keeps `x` as `44`).
  - True branch of `x > k` on unknown refines to `number>… | string` (JS ToNumber space).
  - `flattenSum` keys prim members by term/pred so `number=A1>3` and `number=A1*2` stay distinct paths.

## 0.4.0

### Minor Changes

- 1d6bb01: 修复抽象执行器的多处精度与门禁缺陷（dogfooding 回归全绿）：

  - 结构门禁：`@nudo:refine` 在 `export function`/`export const`/`export default`/`async` 声明上被静默丢弃（refine.ts 的声明正则只匹配裸 `function`）——现在导出函数上的参数 refine 真实生效，`string()` 原语约束能拦截 `first(42)` 这类调用（退出码 1）
  - 转译执行（exec/transpile.ts 等）：解构形参绑定、`+=` 等复合赋值、`Math.*`/`Number.isNaN` 命名空间调用、正则字面量 `.exec` 捕获组、可选链真值判断、`i++`、成员/索引写回、三元表达式、`new Array().fill`、字符串下标/长度——此前均丢失精确值（case 求值为 unknown），现在 `@nudo:case ... => expected` 在这些体上可精确断言（含 OSA 编辑距离 DP 矩阵、semver 比较链）
  - 早返回折叠：`if (c) return X;` 语句级 `$fork` 的返回值被静默丢弃导致整函数回退到最后一条 return——改为位置感知提升（后续语句整体进 else 分支），`join` 语义与 JS 控制流一致
  - bridge：`null` 字面量可投影为 `T.literal(null)`，`=> null` 期望成立

### Patch Changes

- 1d233a7: Fix hover and CodeLens case switching in Zed-style clients, and fold JS ToNumber for `- * / %`.

  - `const n = double(21)` now reports the init Abs (`42`) instead of the statement's `unknown` (record the declarator id in `evalVarDecl`).
  - `const s = double("a")` is `NaN` (JS `"a" * 2`), not `unknown` — concrete string/boolean lits coerce under ToNumber; `formatAbs` prints `NaN`/`Infinity` instead of `null`.
  - `workspace/executeCommand` accepts positional `nudo.selectCase` args from CodeLens (`[uri, fn, index, name]`), not only the agent object form.
  - Hover inside `@nudo:case` functions goes through TypeValue + `activeCases` instead of call-site B-path nodes, so selecting a case actually changes the shown types.

## 0.3.1

### Patch Changes

- 21427eb: Fix directive-case args lost in early-return branches: fold `if (c) return X; …tail` into `return $fork` in B-path transpile, and join partial-return fall-through in AST `evalBlock`. `@nudo:case "A" (92)` on a graded if now yields `"A"`; `nudo test` expected cases pass; doctor-emitted `call@` solidifies correctly.
- df1726c: Make `@nudo:env` actually affect inference: declaration-only fnSigs (readFileSync) now become relationFns instead of unknown-on-call, B-path `$invoke` implements string methods and filters union members, and `collectAbsCallRecords` merges env modules so call@ cases no longer overwrite correct B-path results.
- bee69d4: Publish built dist instead of TypeScript source: packages now ship compiled ESM + .d.ts, CLI bin gets a shebang, `nudo --version` reads the real package version, and `nudo check` accepts multiple paths.
- 8d85d99: Fix refine template gate for array()/string() and stop body method calls from inventing object shapes: typeof preds are checked at call sites, refine contracts take priority over structural inference, method names (`p.some`/`p.replace`) are no longer required data fields, array() constraints produce arr entry Abs, and `{...base}` call-site args resolve file-level bindings.

## 0.3.0

### Minor Changes

- 5786fa5: Promote the B-path (transpile + in-process Abs runtime) to the primary evaluation path for capable sources.

  - Module graph now supports relative imports, bare-package harvest, default/namespace imports, re-exports, `export *`, require, cycle/depth/missing guards, and env modules (`path` / `node:path` etc.).
  - Diagnostics, `@nudo:env` / mock injection, `call@` / `entry@` provenance, method-missing, unknown-recv, generators, classes, async/await, optional chaining, and destructuring run through B.
  - When B hosts a file, `evaluateProgram` is skipped so TypeValue no longer double-reports.
  - CLI `check` / `types` / `test` accept directories; check uses an Abs-only gate.
  - LSP hover / `getTypeAtPosition` on capable files read the Abs node table; `*.nudo.js` edits evict L0 and recheck open parents.
  - Public core surface now re-exports the algebra API (`Abs`, check, generalize, exec, bridge, `parseSource`, `stripTypes`).

- 5786fa5: Speed up repeated analysis with layered memos and tighter cache contracts.

  - Shared parse/AST LRU, `generalizeFromAst` L0–L3 (instantiate, α-equivalence, dep fingerprint + LRU), Abs module cache, and session-wide memos with an incremental after-edit path.
  - Host cache-eviction contract, AST/function-fingerprint memory caps, conservative call-scan depth cap, and fail-open truncated dependency fingerprints.
  - Fix session-memo staleness and identity holes so after-edit results stay correct.

## 0.2.0

### Minor Changes

- 6c38283: docs and ci
- 9f7f819: fix pkg info
- c175f71: version

## 0.1.0

### Minor Changes

- Conceptual design and basic implementation.
