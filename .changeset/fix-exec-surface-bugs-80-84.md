---
"@nudojs/core": patch
---

Fix five exec-surface wrong-concrete bugs (80–84) found by differential testing:

- **`#x in obj`** (private-field `in` operator): the left `PrivateName` operand fell through `isExpression` and compiled to `$lit(void 0)`, so the presence test always returned `false`. The `in` arm now emits the mangled `"#x"` key via the shared `privateNameKeySrc` helper (also deduped into member read/assign).
- **`this.#x += 1`** (private-field compound assignment): the root-non-rebindable branch emitted a simple assignment using the RHS directly, dropping the operation (`+=1` assigned `1`). It now applies `compoundFn` to the current `$get` value, mirroring the member-path branch.
- **`o + "x"` with a `Symbol.toPrimitive` hook**: `coerceToStringParts` folded hook-only objects to the default `"[object Object]"` tag (wrong concrete string). The fold guard now also checks for an own `"@@toPrimitive"` slot — hook presence blocks the fold and yields a sound abstract string domain.
- **`Array.prototype.concat` ignores `Symbol.isConcatSpreadable`**: spreadable objects are now spread as array-likes (`ToLength(o.length)` elements), `lit false` suppresses spreading, abstract flags degrade to `arr` (sound).
- **Private fields leak as enumerable own properties**: private slots are now flagged `internal` at instance-field registration (not by `#` name prefix — public string keys like `{"#x":1}` share the key space and stay visible). `for-in`, `Object.keys/values/entries`, `hasOwnProperty`, `getOwnPropertyNames/Descriptors`, spread, `Object.assign`, and `JSON.stringify` exclude internal slots; direct `this.#x` access and `#x in obj` slot-presence semantics are unchanged. Class-instance spread/assign now also includes public fields (previously dropped), and Error-family own slots (`name`/`message`/`stack`) are non-enumerable per native semantics.
