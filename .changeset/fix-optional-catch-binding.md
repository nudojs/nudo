---
"@nudojs/core": patch
---

An optional catch binding (`catch { … }`) no longer introduces a binding.

The optional catch binding of ES2019 binds nothing, but the transpiler
fell back to the hard-coded name `"e"` for the carrier. That binding then

- shadowed an outer binding of the same name, so `catch { return e }`
  returned the caught exception instead of the outer value (`"outer"`
  became an `Error`);
- swallowed the `ReferenceError` of an undeclared name, so the signature
  claimed the function never throws;
- collided with the user's own `let e`, which is a duplicate declaration in
  the same block: the module then failed to transpile and degraded to
  `unknown`, while the diagnostic blamed the user's code.

An optional catch binding no longer emits a user-visible binding, so the
catch body resolves outer names as it normally would.
