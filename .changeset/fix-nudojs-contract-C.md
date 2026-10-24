---
"nudojs": minor
---

**BREAKING**: `nudo contract --from-dts --write` 的**草稿落盘位置**变了
（Bug 944）—— 此前写在**当前工作目录**，现在写在**源 `.d.ts` 旁边**。

谁会坏：跑 `nudo contract --from-dts --write` 后在**当前目录**读草稿的脚本
（例如 `cat createUser.nudo.draft.ts`）⇒ 文件现在在源 `.d.ts` 所在目录
（`types/index.d.ts` ⇒ `types/index.d.nudo.draft.ts`）⇒ 旧路径读不到；
从 `node_modules` 收割来的包类型**不再**写草稿（此前会写）。

怎么迁移：按源 `.d.ts` 的目录定位草稿（`<dir-of-dts>/<stem>.nudo.draft.ts`），
别再假设草稿落在 CWD；`node_modules` 里的包类型先把 `.d.ts` 复制进工程再跑。

`nudo contract --emit` / `--from-dts`: unmatched `--fn` names no longer widen
the write scope, the dry-run preview names the sidecar it would change,
`--json --emit` now emits a machine payload, and `--from-dts --write` lands its
draft next to the source `.d.ts` instead of in the current directory.

- **Bug 657 — `--fn <misspelled>` silently dropped the filter.** When none of
  the requested names matched an export of the target file, the filtered list
  was downgraded to "no filter at all", so the emitter refreshed *every*
  existing `@generated` segment (or, with `--all`, created segments for every
  export) and wrote the sidecar — exit 0, no warning. Now a name that matches
  nothing is a usage error: the local export names are listed, the exit code
  is 1, and **nothing is written**. When only *some* names match, the
  unmatched ones are passed through unchanged and surface through the
  emitter's existing `skipped <fn> (not-an-export)` channel — the same wording
  the LSP / agent face already uses.
- **Bug 662 — the `--emit --dry-run` preview named the source file.** The
  preview said `would update lib.js` while the diff it printed was against
  `lib.nudo.js`. The label now names the sidecar, matching the diff header
  and the other two branches of the same command.
- **Bug 667 — `--json --emit` ignored `--json`.** stdout was human text and
  the exit code was 0, so a machine consumer got unparseable output with no
  failure signal. `--json --emit` now prints one valid JSON document: the
  per-file machine record (`file`, `sidecar`, `changed`, `written`, `skipped`,
  `issues`, `diff`), shaped like the `--json` / `--draft --json` records and
  collected into the same aggregated array.
- **Bug 944 — `--from-dts --write` wrote into the current directory and
  overwrote unconditionally** (a draft belonging to a *different* file with
  the same base name was silently replaced; exit 0, no warning). The draft now
  lands next to the source `.d.ts` (same `sidecarDraftPath` convention as
  `--draft --write`), an existing draft with different content is **not**
  overwritten (the write is refused with an explanation and exit 1; override
  with `NUDO_DRAFT_FORCE=1`), the write goes through the same guarded writer
  as `--draft --write` (never the formal sidecar, never `node_modules`, never
  outside the project root, unchanged content is not rewritten, an empty draft
  is not written), and the closing hint names the sidecar to copy the accepted
  exports into.

  **Behaviour change:** the draft produced by `--from-dts --write` moves from
  the current working directory to the directory of the source `.d.ts`
  (for example `types/index.d.ts` now yields `types/index.d.nudo.draft.ts`).
  Scripts that read the draft from the working directory have to follow the
  new path. Drafts for package types harvested from `node_modules` are no
  longer written at all — copy the `.d.ts` into the project first.
