---
"@nudojs/core": patch
---

Fix class-A value-read/reflection bugs (3/9/31/32/41/43/49/54/56/57).

Value reads: abstract-string indexing `s[n]` now yields `string | undefined` (was `unknown`); function value properties `f.name`/`f.length`/`f.prototype` are decidable (declaration names and native arity plumbed through host-fn `asAbsVal` and closure `absFunction`; arrows fold `prototype → undefined`); `Symbol.<well-known>` constants fold to exact symbol literals with precise `.description`/`String(sym)`/`===`.

Method value-read channel (Bugs 49+56, single mechanism): reading a prototype method as a value (`"ab".trim`, `(1).toFixed`, `Array.prototype.slice`, `Map.prototype.has`, …) yields a first-class callable fn whose apply hook forwards borrowed invocations (`v.call(recv, …)`/`v.apply`/`v.bind`) back into the existing method dispatch — `typeof X.prototype.m` folds `"function"` (was silent `undefined`/`unknown` + false may-throw), `Array.prototype.slice.call("abc")` folds `["a","b","c"]`, `Number.prototype.toString.call(255)` folds `"255"`.

Reflection mutators: the five `Reflect.set`/`deleteProperty`/`defineProperty`/`setPrototypeOf`/`preventExtensions` now apply their state effect to the receiver (in-place slot write/delete, proto marking, ext-state) while keeping native boolean returns; `Object.create(proto, descriptors)` installs descriptors as own properties (open obj for object protos, null-proto preserved).

Enumeration: `Object.create(<obj>)` no longer poisons the keys family with a false may-throw (keys/values/entries fold `[]`); `Object.keys/values/entries` classify non-string primitives (`[]`) and builtin brands (boxed String → `["0","1"]`, gOPN includes `length`); accessor properties are visible to `Object.entries`/`Object.values`/`Object.getOwnPropertyDescriptor` (accessor descriptors `{get,set,enumerable,configurable}`) and `JSON.stringify` through a single `readProperty` [[Get]] entry point — getter thunks are invoked, the defineProperty+enumerable stringify variant loses its false may-throw, and `for (k in new String(…))` no longer enumerates `length`.
