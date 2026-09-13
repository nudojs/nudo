# @nudojs/core

## 0.3.0

### Minor Changes

- 5786fa5: Promote the B-path (transpile + in-process Abs runtime) to the primary evaluation path for capable sources.

  - Module graph now supports relative imports, bare-package harvest, default/namespace imports, re-exports, `export *`, require, cycle/depth/missing guards, and env modules (`path` / `node:path` etc.).
  - Diagnostics, `@nudo:env` / mock injection, `call@` / `entry@` provenance, method-missing, unknown-recv, generators, classes, async/await, optional chaining, and destructuring run through B.
  - When B hosts a file, `evaluateProgram` is skipped so TypeValue no longer double-reports.
  - CLI `check` / `types` / `test` accept directories; check uses an Abs-only gate.
  - LSP hover / `getTypeAtPosition` on capable files read the Abs node table; `*.nudo.js` edits evict L0 and recheck open parents.
  - Public core surface now re-exports the algebra API (`Abs`, check, generalize, exec, bridge, `parseSource`, `stripTypes`).

- 5786fa5: Speed up repeated analysis with layered memos and tighter cache contracts.

  - Shared parse/AST LRU, `generalizeFromAst` L0–L3 (instantiate, α-equivalence, dep fingerprint + LRU), Abs module cache, and session-wide memos with an incremental after-edit path.
  - Host cache-eviction contract, AST/function-fingerprint memory caps, conservative call-scan depth cap, and fail-open truncated dependency fingerprints.
  - Fix session-memo staleness and identity holes so after-edit results stay correct.

## 0.2.0

### Minor Changes

- 6c38283: docs and ci
- 9f7f819: fix pkg info
- c175f71: version

## 0.1.0

### Minor Changes

- Conceptual design and basic implementation.
