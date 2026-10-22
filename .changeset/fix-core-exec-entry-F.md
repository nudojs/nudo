---
"@nudojs/service": patch
---

Family 04 (core execution / entry), shard F — the service-side remainder of
bug 274.

- **Bug 274 (service)**: `@nudo:mock Math` / `JSON` / `Date` / `Number` … were
  silently ignored on the **call-value** channel (`nudo test` case values,
  `nudo export` dts, the LSP hover surface). The core side already separates
  the two injection tables — the "do not shadow host intrinsics" skip list
  (`ENV_SHADOW_SKIP`) applies to **env globals only**, because a mock value is
  an `Abs` with no host object identity to preserve (shadowing the host global
  is exactly what a mock is for). But two service call sites merged the mock
  table into `envGlobals` before handing it to the engine, so the engine could
  no longer tell mocks from env globals and the skip list swallowed the mocks
  on that list — the user believed the mock was in effect while the host
  intrinsic answered. Both call sites now pass the two tables separately
  (`mocks` through its own parameter, `envGlobals` carrying env globals only):
  - `eval-run.ts` (`tryRunEval`) — the call-value / case-evaluation channel,
  - `abs-modules-graph.ts` (`collectAbsBindingsFromGraph`) — the module-graph
    binding surface.

  The precedence is unchanged: the engine reads the merged table as
  `{ ...envGlobals, ...mocks }`, so a mock still **overrides** an env global of
  the same name, exactly as before when the mock was merged in last.
