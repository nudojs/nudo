---
"@nudojs/core": patch
---

Member-surface wrong-exactness cluster (root-cause class C2) from the
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
