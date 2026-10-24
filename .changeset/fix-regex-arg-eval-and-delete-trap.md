---
"@nudojs/core": patch
---

RegExp state calls evaluate their arguments once, and `delete` dispatches
the Proxy `deleteProperty` trap exactly once.

- `re.test(x)` / `re.exec(x)` / `re.compile(x)` inlined the very same
  argument source text into two runtime calls (`$invoke`, which performs
  the call, and `$reStateCall`, which reads back `lastIndex`). Every
  argument expression therefore ran twice — a counter incremented by the
  argument ended up at `2` instead of `1`. The arguments are now
  materialized into an array that both channels share. The same fix
  applies to the optional-chain receiver (`re?.test(x)`, `re.exec(x)?.[0]`).
- `delete o[k]` was emitted twice: once as the expression value
  (`$delRes`) and once as the statement-level write-back (`o = $del(o, k)`).
  On a plain object the second call is idempotent, but on a `Proxy` each
  call dispatched the `deleteProperty` trap, so the trap ran twice while
  the specification allows exactly one call. The trap is now dispatched
  only by the expression channel; the write-back channel merely probes
  whether a trap is present and leaves the target untouched.
