---
"@nudojs/core": patch
---

Fix env-brand iteration false warnings and env-global slot writes poisoning whole-function evaluation (issues #147/#148):

- `iterabilityKind`/`asyncIterabilityKind` now treat a `brand` shape as a nominal label delegating to its inner structural face: a brand wrapping an array/tuple/string/`@@iterator` object is **total** (no more `may throw TypeError — iteration over possibly non-iterable` on `for…of`/spread over env `Array<T>` brands such as `fs.readdirSync`). Non-total inner faces stay **may** and never degrade to **definite** (TypedArray/Buffer brands wrap an empty object whose prototype `@@iterator` is not modeled). Element domains delegate the same way (`elemsOf`/`$concat`): the `for…of` loop variable and spread elements now fold to the inner array element (`string | Dirent`) instead of `unknown`, and a brand wrapping a tuple keeps the precise tuple shape when spread (`[...t, ...brandT]` stays a tuple, not `T[]`).
- Env-global injection in `runTranspiled` binds globals with `let` instead of `const`: a member write like `process.exitCode = 1` compiles to a root-rebinding write-back chain (`process = $set(process, …)`), which against a `const` binding threw a native TypeError and poisoned the whole eval (return folded to `unknown` + `nudo:unknown-inference` + `nudo:entry-may-throw`). Env globals are writable `globalThis` properties natively; writes now fold and a later read in the same program run observes the written value.
