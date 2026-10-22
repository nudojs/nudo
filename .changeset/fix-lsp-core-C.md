---
"@nudojs/lsp": patch
---

Hover now agrees with `nudo check` on what a parameter's type is, and an
early-return guard no longer narrows away a `null` that is still reachable.

- **Bug 773** — The flow facts treated `if (!p) { return 0; } else { … }` as
  an early-return guard and stripped the `nullable(…)` wrapper from `p` for
  the rest of the function. The `else` branch falls through to the code
  below the `if`, so `p` can still be nullish there; the hover showed a
  type that does not hold. The guard now only narrows when there is no
  `else` branch, or when the `else` branch also ends in `return` / `throw`.
- **Bug 774** — A parameter of a function without a contract produced an
  empty hover, even though the signature block of the very same hover
  showed `x: any`. The parameter projection now falls back to the
  "unconstrained ⇒ `any`" rule (design §2); identifiers that are not
  parameters still report no information.
- **Bug 775** — For contract parameters the hover showed the sidecar
  expression text (`x: number().gt(0)`) while `nudo check` showed the
  inferred type (`x: number`), so one function had two different parameter
  types depending on the surface. Non-union contract parameters now use the
  same inferred shape as the check signature line. Union parameters keep
  their declared form: a discriminated union expands to tens of thousands
  of characters and its arms are identified only by the user's own type
  names.
- **Bug 786 (hover half)** — The hover surface never forwarded the
  `inject` bundle, so inline directives (`@nudo:mock` / `@nudo:as` /
  `@nudo:replace`, environment globals) were missing and the derivation
  collapsed to `unknown` ("inference failed") while the CLI gate showed the
  real type. `HoverInterfaceOpts` now carries `inject` and passes it to
  every `generalizeFromAst` call of the hover surface.
