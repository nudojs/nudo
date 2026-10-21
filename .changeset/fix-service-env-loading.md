---
"@nudojs/service": patch
---

Runtime environments that cannot be applied now say so, instead of leaving
the affected code to be judged as always throwing.

- `@nudo:env bogus` — an env name that is neither a built-in (`es`, `web`,
  `node`) nor a path — was ignored silently: no diagnostic, and the env never
  applied. It is now reported as `nudo:env-unresolved`.
- A path env file that does not export a `defineEnv()` function, exports a
  non-function, throws while being evaluated, or returns something other than
  `{ globals }` also went unnoticed, with the same effect. These contract
  failures are reported now, too. A file with a syntax error was already
  reported — the two cases now use the same channel.
- A relative path env was resolved against a process-wide registry, so the
  first `./env.ts` loaded won every later same-spelled path. Each directory
  now resolves its own.
- A `package.json#nudo.env` array holding a non-string element crashed the
  loader with `name.includes is not a function`. The element is now rejected
  with a diagnostic.
