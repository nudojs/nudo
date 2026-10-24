---
"@nudojs/env": patch
---

Env declarations can now report that a host call throws, and can police
the types of the arguments they are given.

- `envFn` used to swallow whatever the host function threw: the `apply`
  wrapper caught every exception and returned the declared return type, so
  a declaration such as `atob("!!!")` looked like a call that never
  throws. The wrapper now returns through core's existing throws channel
  (`makeAbsApplyResult`), so a native exception is recorded as a
  may-throw at the call site, the same way a user-written `throw` is. An
  apply that returns a bare value still means "does not throw", and an
  apply that returns its own throws face keeps it.
- The error brand of a native exception is taken from `error.name`, with
  `"Error"` as the fallback for a non-`Error` throw. Declarations whose
  host throws a brand that is not a standard error name — `atob` and
  `btoa` throw a `DOMException` named `InvalidCharacterError` — pass the
  brand explicitly through the new declaration-side `throws` option.
- The new declaration-side `enforceArgs` option checks each argument
  against the declared parameter type before the host call happens. An
  argument that definitely does not fit makes the call throw a
  `TypeError`; an argument the engine cannot pin down (an `unknown`, an
  `any`, or a value that is not exact) makes the call possibly throw a
  `TypeError`. The check is opt-in, per declaration.
- `envFnVariadic` accepts the same `throws` and `enforceArgs` options and
  passes them on; for a variadic declaration only the required
  parameters are checked.
- The declaration helpers involved — `envFn`, `envFnVariadic`,
  `errBrand(name)` (builds an error-brand value) and the `EnvApplyImpl`
  apply signature — are internal to the package (`src/abs-helpers.ts`)
  and are not part of its `exports` surface: `@nudojs/env/es`, `/web` and
  `/node` export only `defineEnv` and the `EnvDefinition` type.
