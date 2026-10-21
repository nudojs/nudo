---
"@nudojs/core": patch
---

Symbol-keyed properties stay symbol-keyed, and prototypes no longer leak
their `constructor` into enumeration.

- A property defined with a symbol key is no longer reported as the
  string `"@@X"`. `for…in`, `Object.keys`, `Object.getOwnPropertyNames`
  and `Object.getOwnPropertyDescriptors` only list string keys, and
  `Reflect.ownKeys` returns the symbol itself (so `typeof` is
  `"symbol"`, as in the language).
- `Object.assign` copies a symbol key as a symbol key instead of
  downgrading it to a string property.
- `"@@toStringTag" in obj` is now `false`: the string `"@@toStringTag"`
  is not the same key as `Symbol.toStringTag`.
- `Object.getOwnPropertyDescriptor(proxy, key)` dispatches the proxy's
  `getOwnPropertyDescriptor` trap. It used to never run and always
  reported a broken descriptor.
- `Object.freeze` / `Object.seal` / `Object.preventExtensions` record
  key-level flags, so `Object.isFrozen` / `Object.isSealed` report the
  right answer, and a frozen property stays frozen.
- A function's `constructor` property is not enumerable any more:
  `for (const k in A.prototype)` is empty, as it is in the language.
- A regular expression exposes its own `lastIndex` property, and
  `Object.getOwnPropertyNames(/x/)` lists it.
