---
description: "Index of the repository design notes — architecture truth sources (Abs, CLI semantics, evaluation, interface derivation, caches, limitations) behind the product pages."
---

# Design notes (repo)

Architecture truth lives in the repository, not on this site: [`docs/design/`](https://github.com/nudojs/nudo/tree/main/docs/design). The [Design Document](./design-doc.md) is the public narrative; when it and a truth source disagree, the truth source wins. This page is the index — every design doc is listed here so new ones cannot go missing.

**Product-facing summaries** live on the site: [Abs](../concepts/abs.md), [Language semantics](../concepts/semantics.md), [HOF relations](../concepts/hof-relations.md), [Limits](../concepts/limits.md), [CLI reference](../api/cli-reference.md).

## Truth sources

| Design note | Covers | Status |
|---|---|---|
| [`kernel-merge.md`](https://github.com/nudojs/nudo/blob/main/docs/design/kernel-merge.md) | The type system: `Abs = shape × term × pred × conf` as the single track (`@nudojs/core/src/algebra`) | Truth source |
| [`cli-semantics.md`](https://github.com/nudojs/nudo/blob/main/docs/design/cli-semantics.md) | CLI product face, L1/L2 gates, `any` vs `unknown`, `test` case reports, check JSON | Truth source |
| [`evaluation.md`](https://github.com/nudojs/nudo/blob/main/docs/design/evaluation.md) | Single evaluation engine (transpile → exec), set semantics, fail-closed behavior | Landed |
| [`refine-derivation.md`](https://github.com/nudojs/nudo/blob/main/docs/design/refine-derivation.md) | Three-tier effective interface: handwritten → generated → implicit; sidecar binding; drift codes | Landed |
| [`hof-relations.md`](https://github.com/nudojs/nudo/blob/main/docs/design/hof-relations.md) | HOF relations (`fnRels` / `entryShapes`) instead of a generic language | Implemented (P3 deferred) |
| [`persistent-cache.md`](https://github.com/nudojs/nudo/blob/main/docs/design/persistent-cache.md) | `.nudo/cache` disk layer + `~/.cache/nudo/deps` harvest; fail-open rules | Landed |
| [`cache-invalidation.md`](https://github.com/nudojs/nudo/blob/main/docs/design/cache-invalidation.md) | In-process session-cache invalidation contract | Contract + regression pins |
| [`lsp-client-gaps.md`](https://github.com/nudojs/nudo/blob/main/docs/design/lsp-client-gaps.md) | LSP client UI gaps — the tracked list behind [LSP clients](../guides/lsp-clients.md) | Current |
| [`limitations.md`](https://github.com/nudojs/nudo/blob/main/docs/design/limitations.md) | Limitations that still constrain decisions; unresolved items | Living |

## Process notes

| Note | Covers |
|---|---|
| [`plans/`](https://github.com/nudojs/nudo/tree/main/docs/design/plans) | Dated working plans (e.g. [removing the second engine](https://github.com/nudojs/nudo/blob/main/docs/design/plans/2026-09-22-remove-ast-eval.md)) — history, not contracts |
| [`docs/reports/`](https://github.com/nudojs/nudo/tree/main/docs/reports) | Measured baselines (env coverage, OSS/agent performance) quoted by [Performance](../guides/performance.md) and [AI-native DX](../guides/ai-native-dx.md) |
| [`docs/examples/`](https://github.com/nudojs/nudo/blob/main/docs/examples/README.md) | The CI-pinned example matrix (`pnpm run verify:examples`) |

## How these notes are kept honest

- The docs site consumes them one-way: rendering rules and gates are described in [Contributing — Docs maintenance](../contributing.md#docs-maintenance).
- Each note carries a `Status` line; `landed` notes describe shipped behavior, `contract` notes describe invariants with tests.
- This index is gated: adding a file under `docs/design/` without listing it here fails `packages/website/tests/docs-coverage.test.ts`.
