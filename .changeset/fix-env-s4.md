---
"@nudojs/env": patch
---

The node environment now models the host's real throw and value behaviour for
its `url`, `crypto`, `child_process`, `util` and `assert` modules.

- `node:url`'s `URL` and `URLSearchParams` and `node:util`'s `TextEncoder`
  and `TextDecoder` are constructors now. They are declared as plain
  functions, so `new URL("https://x.dev/a")` was reported as a call that may
  throw a `TypeError` ("new on function value of unknown constructibility")
  even though the host never throws there. The declarations now carry the
  constructor flag, and the instance faces are unchanged.
- `node:assert` no longer claims that an assertion never fails. `ok(false)`,
  `strictEqual(1, 2)`, `deepStrictEqual({a:1},{a:2})`, `notStrictEqual(1, 1)`,
  `match("abc", /z/)` and `fail()` throw an `AssertionError` in the host, and
  the declarations now say so: an assertion that is known to fail throws an
  `AssertionError`, an assertion that is known to hold throws nothing, and an
  argument the engine cannot pin down may throw. A missing argument to
  `strictEqual` throws a `TypeError`, the way the host does.
- `node:url`'s `fileURLToPath` no longer swallows the exception the host
  throws for an invalid URL or a non-`file:` scheme. The call is now reported
  as a call that may throw a `TypeError` instead of quietly returning a
  string.
- `node:crypto`'s `createHash`, `randomBytes`, `randomInt`, `pbkdf2Sync` and
  `timingSafeEqual` now carry the throw the host throws for an out-of-range
  argument: an unsupported digest name throws an `Error`, an out-of-range
  size, iteration count or key length throws a `RangeError`, and two buffers
  of different lengths throw a `RangeError`.
- `node:util`'s `promisify`, `callbackify`, `inherits` and
  `isDeepStrictEqual` take their function arguments through the apply path,
  so the argument is no longer bound as a type variable. The signatures are
  unchanged.
- `url.pathToFileURL` returns the full URL face (eleven components plus
  `toString` and `toJSON`) instead of a one-slot `{ href }` object, so
  reading `.pathname` or `.protocol` no longer yields `undefined`, and
  reading a member of one of them no longer looks like a guaranteed
  `TypeError`.
- `child_process.spawnSync` returns the full face of the host's result:
  `pid`, `output`, `signal`, `status`, `stdout`, `stderr` and `error`.
  Reading `.pid` no longer yields `undefined`, and reading `.output[0]` no
  longer looks like a guaranteed `TypeError`.
