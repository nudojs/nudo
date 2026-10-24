---
"@nudojs/env": patch
---

The node environment now covers the globals Node actually has, and stops
shadowing the host built-ins it does not need to model.

- The node environment used to declare 41 globals. The remaining host
  globals were unmodelled, so `new BroadcastChannel("x").name` and
  friends were cast into an empty brand: reading a member gave
  `undefined`, and reading it twice gave a definite `TypeError`. The
  environment now declares the host constructors — with their instance
  faces, and with `ctor: true` for the ones Node can actually construct
  and `ctor: false` for the ones it cannot (`AbortSignal`,
  `MessagePort`) — together with the global objects `crypto`,
  `performance` and `navigator`. Reading `crypto.randomUUID()` now gives
  a `string` instead of `unknown` plus a misleading
  `nudo:unknown-inference` diagnostic that blamed the user's code.
  Built-ins that core already models exactly (`URL`, `URLSearchParams`,
  `TextDecoder`, `Proxy`, the error and typed-array families) are still
  not declared, so their precise behaviour is not shadowed.
- `Buffer` is a constructor now. It was declared as a plain object, so
  `new Buffer(1)` was a definite `TypeError` although Node returns a
  buffer. The static side (`from`, `alloc`, `of`, …) hangs off the
  constructor and points at the same buffer shape as the instance side.
- The `Buffer` instance face gained `byteLength`, `buffer` and
  `byteOffset`. They used to read as `undefined` where Node reports `4`,
  an `ArrayBuffer` and `0`.
- The three process streams (`stdin`, `stdout`, `stderr`) share one
  socket face. `process.stdout` only had `write` and `process.stdin`
  only had `on`, so `process.stdout.on("data", …)` and
  `process.stdin.setEncoding("utf8")` were definite `TypeError`s.
- The `process` face gained twelve real members: `emitWarning`, `abort`,
  `kill`, `release`, `features`, `umask`, `getActiveResourcesInfo`,
  `resourceUsage`, `availableMemory`, `loadEnvFile`, `getBuiltinModule`
  and `constrainedMemory`. `process.features` is an open map over
  `boolean | string | undefined` values, so reading a flag no longer
  degrades to `unknown`.
- `process.hrtime` is callable again. It was declared as an object, so
  `process.hrtime()` became `unknown` and produced a misleading
  `nudo:unknown-inference` diagnostic; it now returns a
  `[seconds, nanoseconds]` array, with `hrtime.bigint()` as a static
  member.
- The node environment no longer declares `structuredClone` or
  `queueMicrotask`. Declaring them shadowed the host built-ins and made
  their throws face disappear, so the engine claimed calls that do throw
  never do. Both names now fall back to the host path, which keeps the
  throws face.
