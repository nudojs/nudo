---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.15.1 |
| `@nudojs/service` | 1.9.1 |
| `nudojs (CLI)` | 1.6.1 |
| `@nudojs/parser` | 1.5.1 |
| `@nudojs/lsp` | 1.7.1 |
| `@nudojs/env` | 0.5.1 |
| `@nudojs/harvester` | 0.4.1 |
| `vite-plugin-nudo` | 0.5.1 |
| `nudo-vscode` | 0.3.49 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.15.1 {#pkg-core}

## 1.15.1

### Patch Changes

- 76dee40: Category-decision & Proxy-model cluster (root-cause class C7) from the
  differential bug report: `Object.prototype.toString` tags abstract
  bigint prims as `"[object BigInt]"` via an explicit prim-tag map, and
  bigint `.toString` routes through `BigInt.prototype.toString` with
  literal-radix domain checks (Bug 105); abstract bigint prims are
  recognized by arithmetic/bitwise coercion — mixed `bigint ⊗ number`
  folds the native TypeError (or records may-throw for abstract sides)
  instead of the impossible `number | string`, and `b / 0n` / `b % 0n` /
  `b ** -1n` throw RangeError (Bug 106); borrowed builtin-prototype
  methods brand-check the receiver (`Number.prototype.valueOf.call("5")`
  throws instead of folding `"5"`), with `Object.prototype` /
  `Array.prototype` staying generic and Array mutators on primitives now
  throwing (Bug 108); `new <proxy>` routes to the proxy's target
  [[Construct]] (or `construct` trap with result validation) instead of
  re-entering the `Proxy` constructor (Bug 122); `typeof`/`instanceof` on
  a proxy see through to the target (`typeof new Proxy(fn, {})` folds
  `"function"`, `p instanceof Function` folds true) (Bug 123); the
  object-level proxy traps `deleteProperty` / `defineProperty` /
  `setPrototypeOf` / `preventExtensions` / `getPrototypeOf` are dispatched
  with strict/Reflect throw-vs-boolean semantics (falsy trap results
  throw in Object paths) (Bug 124).
- 3f3b080: Follow-up to the member-surface and throws-domain clusters: the fn face
  of `Function.prototype` (host `fn.prototype` member read, Bug 92) and the
  proto projection used by `Object.getPrototypeOf` (`protoBrandAbs`) were
  two distinct Abs values for the same native object, so
  `Object.getPrototypeOf(g) === Function.prototype` folded wrong-exact
  `false`. `functionProtoAbs()` is now the single resident value used by
  both the fn-shape and base-class-value arms of `protoOfRecv` and the
  host-function `.prototype` read (Bug 58/85 suite restored; native
  `extends null` class values still resolve to `Function.prototype`).
  `@nudo:invariant` levenshtein main-target case now splits its L2
  expectation (`ignoreThrows: ["RangeError"]`) for the legitimate
  `Array.from` array-like-length may-throw added with Bug 129, and the
  #136 regex-capture signatures are re-pinned to their sound domains —
  the zero-iteration arm of `while ((m = re.exec(s))) … return null` now
  joins (Bug 99), so `parts`/`named`/`orAlt` keep their native `null`
  arm instead of the previously pinned unsound exact.
- a3a5dee: Host-record prototype-chain pollution cluster (root-cause class C6) from the
  differential bug report: class-spec records (`methods`/`staticMethods`/
  `statics`/…) are registered as null-prototype objects and every dispatch
  site reads them with own-property semantics, so `Object.prototype` names
  (`toString`, `hasOwnProperty`, `constructor`, `__proto__`, …) are no longer
  misread as class members — `c.toString()` stops folding `"[object
  Undefined]"`, `c.hasOwnProperty(k)`/`c.valueOf()` stop throwing phantom
  host TypeErrors, and `c.constructor === C` folds true (Bug 90).
  `DataView.prototype` dispatch consults `DATAVIEW_ACCESS_BITS` with
  `Object.hasOwn`, so unmodeled methods (`toString`, `valueOf`,
  `hasOwnProperty`, …) no longer fold the `number` domain or phantom
  RangeErrors (Bug 91). `D.hasOwnProperty("m")` recognizes own static
  methods/accessors as non-enumerable own class-value properties
  (own-only — ancestor statics answer false).
- 3338ae5: Computed-key member calls keep their receiver: `obj[key]()` where the key
  is a non-literal expression (a variable, `Symbol.iterator`, any runtime
  value) used to fall through transpile to `$call($idx(obj, key), …)`,
  which has no receiver channel — the method body's `this` read failed and
  builtin brand checks assumed a throw, folding exact `never` (native: the
  real result). New `$invokeKey` / `$optionalInvokeKey` runtime helpers
  fold the key (ToPropertyKey literal + well-known symbol → `@@name` slot)
  and re-enter the full `$invoke` dispatch with the receiver bound;
  optional chains (`obj?.[key]()`, `obj[key]?.()`, mid-chain hops) route
  through a new `invokeKey` chain hop instead of the receiver-less `call`
  hop. Bonus precision: static `"ab"[Symbol.iterator]().next().value`
  folds `"a"` (iterator face reuses the `values` single source of truth),
  and generator `it[Symbol.iterator]() === it` folds `true`.
- 471ddb3: Loop-return join soundness (root-cause class C9) from the differential bug
  report: a `return` inside a `while`/`for` body with an abstract test no
  longer drops the zero-iteration path — the body's return value is
  collected as one arm and the post-loop statements as the sibling arm
  (`whileGuard(x)` with `any` folds `any | 0` instead of the unsound exact
  `0`); `NudoThrow` still propagates and definite-true loops keep bubbling
  (Bug 99). Generator/async thunk bodies are the target boundary of
  `$loopReturn` — absorbed arms merge into the generator terminal value
  domain / the promise inner domain (`async f(x){ while(x<0) return 5;
  return 9; }` folds `promise<5 | 9>` with no phantom number arm), which
  also fixes the pre-existing fork/switch-in-generator phantom-arm family.
  Bug 1 (guarded plain-variable return contracts) was already fixed by a
  prior commit (verified against the report's repro matrix).
- 2ab2f46: `JSON.stringify` renders regex match results as arrays: a
  `String.prototype.match` / `RegExp.prototype.exec` result is a native
  Array (only index elements enumerate into JSON), but the engine modeled
  it as a plain object shape whose `length`/`index`/`input` slots all
  serialized — `JSON.stringify("abc".match(/b/))` folded
  `{"0":"b","length":1,"index":1,"input":"abc"}` instead of `["b"]`.
  Match/exec/matchAll-element results now register an array view
  (`matchArrayViews`) that the three JSON consumers honor by serializing
  the 0..n-1 slots as an array, with the `length` slot explicitly
  non-enumerable (the only non-enumerable own prop on the native result);
  `Object.keys({...m})` enumeration matches native. MatchAll elements are
  remodeled as `matchResultAbs` itself, so `[...ms][0].index` /
  `.input` fold exactly. The `#136` member-read surface (`m[0]`,
  `m.length`, `m.index`, `m.input`, named groups) is unchanged.
- babee2b: Member-surface wrong-exactness cluster (root-cause class C2) from the
  differential bug report: non-constructible namespaces (`Math`/`JSON`/
  `Reflect`/`Intl`) no longer fabricate a `.prototype` brand — the read folds
  exact `undefined` and `Function.prototype` types as `"function"` (Bug 92);
  generator functions keep a distinguishable `.prototype` object (declaration
  + expression forms) while async/arrow controls stay `undefined` (Bug 93);
  string-form TypedArray indexes (`v["1"]`) fold the element domain instead
  of exact `undefined` (Bug 102); writes to getter-only builtin accessors
  (`v.length = 5`) throw the strict `TypeError` (Bug 103); `new
  <function declaration>()` instances resolve `f.prototype` members and
  `"k" in new f()` walks the registered chain (Bug 113); every well-known
  symbol class member (`Symbol.iterator`/`Symbol.species`/…) survives
  definition via the `"@@X"` projection and builtin constructors expose
  `@@species` (Bug 114). Residual: `Object.prototype` legacy accessors
  (`__defineGetter__` family) now answer `in` exact true (Bug 15 family).
  Bug 6/10/14/15/16/17 were already fixed at HEAD (verified, no change).
- 4c6666b: Mutation/state/write-back cluster (root-cause class C3) from the differential
  bug report: statement-position write-back now covers member targets
  (`Object.defineProperty(o.p, …)`, `C.prototype`) and optional-chain
  `delete o?.a` (Bug 87/111); `String.prototype.match/matchAll` honor the
  pattern brand's tracked `lastIndex` with the spec `matchAll` flag rewrite
  (Bug 94); argument-position global `match/replace/replaceAll` reset the
  regex binding's `lastIndex` (Bug 96); `RegExp.prototype.compile` recompiles
  the receiver — source/flags/flag getters/lastIndex fold fresh values and
  invalid patterns throw `SyntaxError` (Bug 126); `String.prototype.replace/
  replaceAll` dispatch through a `@@replace` slot installed on the pattern
  (Bug 81); accessor→data descriptor redefinition drops the stale getter and
  merges flags (Bug 84); `Object.defineProperty/defineProperties` on
  tuple/array receivers install/truncate/extend indexes and length instead of
  silently dropping (Bug 86); descriptor keys coerce via `ToPropertyKey` —
  symbol/boolean/null/undefined keys install (well-known symbols behind the
  `@@X` projection) (Bug 117); non-primitive descriptor `value`s (fn/obj/
  tuple/bigint/symbol) keep their Abs instead of folding `undefined`
  (Bug 118); `Object.assign` uses `[[Set]]` semantics — the `__proto__`
  accessor fires and inherited non-writable data properties throw (the
  `proto-slot-key` assign pin is re-anchored to native) (Bug 128);
  Set/Map deduplicate non-literal keys by reference identity with exact
  size/get/has/delete folding and soundness guards (Bug 88);
  `new RegExp(undefined)` folds the empty pattern `(?:)` (Bug 95).
- 1fed4a4: Placeholder-callable cluster (root-cause class C5) from the differential
  bug report: the generator `@@iterator` slot is now a self-returning
  method (`it[Symbol.iterator]() === it` folds true; re-entering through
  the slot — `.next()` / spread — no longer proves a phantom TypeError)
  (Bug 83); user-class instance/static method first-class values carry an
  `apply` hook that re-enters ordinary dispatch with the caller-supplied
  receiver, so borrowed `m.call(c)` / `m.apply(c, [])` / `m.bind(c)()` and
  HOF-passed method values fold the real result instead of exact
  `undefined` (Bug 89). Bug 12 (WeakMap/WeakSet method calls) was already
  fixed by a prior wave (verified, no change).
- 70631ed: Protocol single-source cluster (root-cause class C8) from the differential
  bug report: array destructuring of `Set`/`Map` consumes the same element
  side tables as spread/`for..of`/`Array.from` (`[a, b] = new Set([1,2])`
  binds real elements; `Map` destructuring yields `[k, v]` tuples) instead
  of folding `undefined` and false TypeErrors (Bug 82); `for..in`
  re-checks key presence per iteration over the live binding, so keys
  deleted before being visited are skipped (Bug 98); TypedArray HOF
  callbacks run once per element for known lengths (≤1024 unroll cap),
  making side-effect counts exact (Bug 100); `Array.from` consults the
  object's `@@iterator` before the array-like half — a non-callable
  iterator throws, a callable/abstract one yields the iterator path instead
  of an exact empty array (Bug 110).
- 367ef5a: Throws-domain cluster (root-cause class C1) from the differential bug
  report: `Object.setPrototypeOf` on frozen/sealed/non-extensible targets
  throws `TypeError` (shared `protoChangeAllowed` with `Reflect`) (Bug 120);
  `Object.keys/values/entries/getOwnPropertyNames`, `for..in`, `Object.assign`
  and object spread project TypedArray index keys `"0".."n-1"` from the
  length slot instead of folding an exact empty view (Bug 125 + residual);
  `Object.freeze/seal` on a non-empty TypedArray throws / records may-throw
  (Bug 129); `String.raw` misuse throws / records `TypeError` (Bug 97);
  `new <TA>(buffer, byteOffset, byteLength)` validates bounds and alignment
  (Bug 101); `Array.from({length: 2**32})` hits the `RangeError` ceiling
  (Bug 104); literal digits/radix domain checks hoist above the receiver
  guard (`Math.random().toFixed(500)` throws) and `toLocaleString` no longer
  passes args to the redirected host `toString` (Bug 107); spread/rest copy
  enumerable own properties only (Bug 109); private-name access on a closed
  plain object throws (Bug 115); module bodies run strict — `new Function`
  seam prefixed with `"use strict"` and `arguments.callee` read/write/delete
  throw (Bug 116); TypedArray construction and `.from` convert items
  (bigint/symbol mismatches throw) (Bug 131). Bugs 5/7/11 were already fixed
  at HEAD (verified, no change).
- 8dd2b50: Transpiler special-case cluster (root-cause class C4) from the differential
  bug report: `this.#x++` / `#x--` / `#x ||= v` on private fields transpile
  instead of raising `nudo:unsupported` and fail-closing the whole module
  (Bug 80); function-declaration bindings passed to `Object.*`/`Reflect.*`/
  `in`/`JSON.stringify`/coercing globals are normalized to Abs at the
  `$invoke` argument choke point, so `Object.keys(declaredFn)` no longer
  crashes the builtin dispatch with an internal TypeError (Bug 85); computed
  accessor keys in object literals are evaluated exactly once (Bug 112);
  `super.x` in a static field initializer resolves through the parent
  constructor's statics instead of the instance prototype chain (Bug 119).
- 725c8e4: `Reflect.construct` argument-slot fix (root-cause class C10): the shared
  `enforceArgsList` call indexed `args[2]` for both `apply` and `construct`,
  so the valid two-argument `Reflect.construct(A, [])` was analyzed as an
  unconditional TypeError while genuinely invalid forms (non-object
  argsList, non-constructor newTarget) passed silently. argsList is now
  validated at `args[1]` for `construct`, and a present `newTarget` is
  checked for constructability (Bug 121).

更早版本（52）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.9.1 {#pkg-service}

## 1.9.1

### Patch Changes

- Updated dependencies [76dee40]
- Updated dependencies [3f3b080]
- Updated dependencies [a3a5dee]
- Updated dependencies [3338ae5]
- Updated dependencies [471ddb3]
- Updated dependencies [2ab2f46]
- Updated dependencies [babee2b]
- Updated dependencies [4c6666b]
- Updated dependencies [1fed4a4]
- Updated dependencies [70631ed]
- Updated dependencies [367ef5a]
- Updated dependencies [8dd2b50]
- Updated dependencies [725c8e4]
  - @nudojs/core@1.15.1
  - @nudojs/env@0.5.1
  - @nudojs/harvester@0.4.1
  - @nudojs/parser@1.5.1

更早版本（54）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.6.1 {#pkg-nudojs}

## 1.6.1

### Patch Changes

- Updated dependencies [76dee40]
- Updated dependencies [3f3b080]
- Updated dependencies [a3a5dee]
- Updated dependencies [3338ae5]
- Updated dependencies [471ddb3]
- Updated dependencies [2ab2f46]
- Updated dependencies [babee2b]
- Updated dependencies [4c6666b]
- Updated dependencies [1fed4a4]
- Updated dependencies [70631ed]
- Updated dependencies [367ef5a]
- Updated dependencies [8dd2b50]
- Updated dependencies [725c8e4]
  - @nudojs/core@1.15.1
  - @nudojs/env@0.5.1
  - @nudojs/harvester@0.4.1
  - @nudojs/parser@1.5.1
  - @nudojs/service@1.9.1

更早版本（51）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.5.1 {#pkg-parser}

## 1.5.1

### Patch Changes

- Updated dependencies [76dee40]
- Updated dependencies [3f3b080]
- Updated dependencies [a3a5dee]
- Updated dependencies [3338ae5]
- Updated dependencies [471ddb3]
- Updated dependencies [2ab2f46]
- Updated dependencies [babee2b]
- Updated dependencies [4c6666b]
- Updated dependencies [1fed4a4]
- Updated dependencies [70631ed]
- Updated dependencies [367ef5a]
- Updated dependencies [8dd2b50]
- Updated dependencies [725c8e4]
  - @nudojs/core@1.15.1

更早版本（51）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.7.1 {#pkg-lsp}

## 1.7.1

### Patch Changes

- Updated dependencies [76dee40]
- Updated dependencies [3f3b080]
- Updated dependencies [a3a5dee]
- Updated dependencies [3338ae5]
- Updated dependencies [471ddb3]
- Updated dependencies [2ab2f46]
- Updated dependencies [babee2b]
- Updated dependencies [4c6666b]
- Updated dependencies [1fed4a4]
- Updated dependencies [70631ed]
- Updated dependencies [367ef5a]
- Updated dependencies [8dd2b50]
- Updated dependencies [725c8e4]
  - @nudojs/core@1.15.1
  - @nudojs/parser@1.5.1
  - @nudojs/service@1.9.1

更早版本（55）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.5.1 {#pkg-env}

## 0.5.1

### Patch Changes

- Updated dependencies [76dee40]
- Updated dependencies [3f3b080]
- Updated dependencies [a3a5dee]
- Updated dependencies [3338ae5]
- Updated dependencies [471ddb3]
- Updated dependencies [2ab2f46]
- Updated dependencies [babee2b]
- Updated dependencies [4c6666b]
- Updated dependencies [1fed4a4]
- Updated dependencies [70631ed]
- Updated dependencies [367ef5a]
- Updated dependencies [8dd2b50]
- Updated dependencies [725c8e4]
  - @nudojs/core@1.15.1

更早版本（51）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.4.1 {#pkg-harvester}

## 0.4.1

### Patch Changes

- Updated dependencies [76dee40]
- Updated dependencies [3f3b080]
- Updated dependencies [a3a5dee]
- Updated dependencies [3338ae5]
- Updated dependencies [471ddb3]
- Updated dependencies [2ab2f46]
- Updated dependencies [babee2b]
- Updated dependencies [4c6666b]
- Updated dependencies [1fed4a4]
- Updated dependencies [70631ed]
- Updated dependencies [367ef5a]
- Updated dependencies [8dd2b50]
- Updated dependencies [725c8e4]
  - @nudojs/core@1.15.1
  - @nudojs/env@0.5.1
  - @nudojs/parser@1.5.1

更早版本（51）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.5.1 {#pkg-vite-plugin}

## 0.5.1

### Patch Changes

- Updated dependencies [76dee40]
- Updated dependencies [3f3b080]
- Updated dependencies [a3a5dee]
- Updated dependencies [3338ae5]
- Updated dependencies [471ddb3]
- Updated dependencies [2ab2f46]
- Updated dependencies [babee2b]
- Updated dependencies [4c6666b]
- Updated dependencies [1fed4a4]
- Updated dependencies [70631ed]
- Updated dependencies [367ef5a]
- Updated dependencies [8dd2b50]
- Updated dependencies [725c8e4]
  - @nudojs/core@1.15.1
  - @nudojs/service@1.9.1

更早版本（54）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
