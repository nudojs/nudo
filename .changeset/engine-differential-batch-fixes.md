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
