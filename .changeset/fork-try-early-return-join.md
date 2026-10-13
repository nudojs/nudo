---
"@nudojs/core": patch
---

Fix fork-arm × try-region early-return join: `return`/`throw` inside try/catch/finally nested in an if-arm folded to the fall-through value instead of the arm's early exit.

- `stmtReturns` learned `TryStatement` (finalizer jump-outs cancel, handler/block both-terminal) so try-region returns trigger arm promotion / both-return rewriting
- arm-thunk returns now signal via `$loopReturn` (`conditionalFlow`), delivered exactly once by `settleForkArms` (double-ret throws joined `NudoReturn`; single-ret enters the exits channel — no longer pre-pushed and double-counted)
- transpiled function bodies are self-contained: `$catchReturn` absorber keeps raw host calls (`nudo export` .mjs imports, e2e) from leaking `NudoReturn` — also fixes the latent leak for loop-returns
- `callAtFunctionBoundary` and the compiled-body `$call` path join frame `loopExits` (ret-arm values were silently dropped → wrong-definite, e.g. arrow functions with loop early-returns)
