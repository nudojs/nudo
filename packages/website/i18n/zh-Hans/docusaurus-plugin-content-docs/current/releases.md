---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.9.1 |
| `@nudojs/service` | 1.6.13 |
| `nudojs (CLI)` | 1.3.14 |
| `@nudojs/parser` | 1.4.10 |
| `@nudojs/lsp` | 1.4.11 |
| `@nudojs/env` | 0.4.28 |
| `@nudojs/harvester` | 0.3.14 |
| `vite-plugin-nudo` | 0.4.29 |
| `nudo-vscode` | 0.3.33 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.9.1 {#pkg-core}

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

更早版本（36）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.6.13 {#pkg-service}

## 1.6.13

### Patch Changes

- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
  - @nudojs/core@1.9.1
  - @nudojs/env@0.4.28
  - @nudojs/harvester@0.3.14
  - @nudojs/parser@1.4.10

更早版本（38）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.3.14 {#pkg-nudojs}

## 1.3.14

### Patch Changes

- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
  - @nudojs/core@1.9.1
  - @nudojs/env@0.4.28
  - @nudojs/harvester@0.3.14
  - @nudojs/parser@1.4.10
  - @nudojs/service@1.6.13

更早版本（35）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.4.10 {#pkg-parser}

## 1.4.10

### Patch Changes

- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
  - @nudojs/core@1.9.1

更早版本（35）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.4.11 {#pkg-lsp}

## 1.4.11

### Patch Changes

- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
  - @nudojs/core@1.9.1
  - @nudojs/parser@1.4.10
  - @nudojs/service@1.6.13

更早版本（39）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.28 {#pkg-env}

## 0.4.28

### Patch Changes

- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
  - @nudojs/core@1.9.1

更早版本（35）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.3.14 {#pkg-harvester}

## 0.3.14

### Patch Changes

- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
  - @nudojs/core@1.9.1
  - @nudojs/env@0.4.28
  - @nudojs/parser@1.4.10

更早版本（35）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.29 {#pkg-vite-plugin}

## 0.4.29

### Patch Changes

- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
  - @nudojs/core@1.9.1
  - @nudojs/service@1.6.13

更早版本（38）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
