---
slug: attribution-gate
title: "The 22-file smear: how call-site attribution almost shipped fake precision"
authors: [default]
tags: [engineering, callsite-discovery]
---

Call-site discovery (`nudo test lib/ --from test/`) harvests real argument shapes from usage sites and synthesizes `call@L…` cases from them. The promise is precision for free: no directives, no annotations, just the arguments your code is *actually* called with.

Precision for free has a dark side: precision that is **attributed to the wrong function** looks exactly like success. This is the story of the attribution gate — the bug that turned one test helper into 51 fake "precise" results across 22 files, and the three invariants that closed it.

<!-- truncate -->

## The symptom

During the first trial run against real packages, coverage numbers jumped — `@hapi/hoek` went from 54.8% to 98.6% of functions with precise cases. Suspiciously good. Digging into the synthesized cases showed why: a helper defined inside a test file happened to share a name with functions in 22 library files. Its call record — one record — was matched against every file that declared a function with the same name. 22 files, 51 records, all fake: every one of those "precise" results was the helper's record wearing another function's name.

The trial numbers were real measurements of a lie.

## The invariant: attribution, not name matching

The fix is an **attribution gate**: a call record only participates in matching for a file if the module the record was resolved from actually points at that file — via the call's function module, or the bound export's target module. Name matching alone is an accident waiting for a same-named helper; the gate makes the *module identity* the source of truth.

Two more invariants close the remaining holes:

- **Usage-site leak marking.** Records captured while executing usage-site code are marked as such. They are trusted as *argument evidence* — the shapes callers pass are real — but the evaluator never mistakes a test-local evaluation environment for the library's own.
- **`never` / `never` filtering.** A record whose result type is `never` *and* whose throw type is `never` did not really return — evaluation was interrupted mid-call (an `await` inside a `new Promise(async ...)` executor). Those records are filtered out before injection instead of being treated as "returns never".

## The result that counts

After the gate, the honest trial numbers were 98.6% coverage **with 0 false attributions** (down from 291 fake records) for `@hapi/hoek`, and 91.8% with 0 false records for `@discoveryjs/json-ext`. The headline number barely moved — but only the zero column makes it mean anything.

Precision claims without an attribution story are marketing. Every number Nudo publishes about call-site discovery is gated by these three invariants; the full design (safety boundaries, merge policy, `--from` ceilings) lives in the [call-site discovery guide](/docs/guides/callsite-discovery) and the honest boundaries in [Limits](/docs/concepts/limits).

## Why this matters for the product

Nudo's contract is "observe faithfully". A false precise result is worse than `unknown`: `unknown` tells you the engine has no information; fake precision tells you the wrong information with confidence. The attribution gate is not a performance optimization — it is the difference between inference and fabrication.

If you run `nudo test --from`, you inherit this safety design. The merge policy and `--from` boundaries that keep your CI honest are documented in the [guide](/docs/guides/callsite-discovery); the `entry@` fallback for uncovered functions is the honest floor.
