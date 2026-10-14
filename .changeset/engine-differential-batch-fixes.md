"@nudojs/core": patch
---

Fix 38 differential bugs (wrong-definite values / false throws / missed throws) found by native-oracle differential testing, plus remove the differential harness's `concrete()` blind spot.

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
