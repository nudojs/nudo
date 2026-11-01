---
"@nudojs/core": minor
"@nudojs/parser": patch
"@nudojs/service": patch
"nudojs": patch
"@nudojs/lsp": patch
---

Dedup batch 2 (jscpd + hand-sync-comment audit): single-source the remaining
cross-file / cross-package copies that were pinned together by comments or
mirror tests instead of code.

- **String-aware scanners** (`splitTopLevelArgs` / `findTopLevelColon` /
  `stripJsdocContinuation` → new `core/algebra/text-scan.ts`, exported via
  `@nudojs/core/internal`): the check face (case-arg split) and the parser
  directive face each kept verbatim copies — Bug 1009 was exactly this pair
  drifting (check face treated `\` as an escape ⇒ one arg fewer ⇒ L2 witness
  silently skipped). `scanWithStrings` was dead after the move and is gone.
- **bigint operand predicates** (`isNullishLitOperand` /
  `isKnownNonBigintNumeric` / `isMaybeBigintOperand`): `surface.ts` carried a
  forked copy of `arithmetic/coerce.ts` — its `isMaybeBigintOperand` lacked
  the Bug 946 `arr`/`tuple` arms and only stayed sound by accident of the
  catch-all throw. Single source in coerce; `foldNumericBinOp` now mirrors
  foldBigintBinOp's explicit arr/tuple hard-throw so `1n & []` still throws
  deterministically.
- **Bug 946 member-level fix** (behavior): `isMaybeCoercionThrowOperand` now
  recurses into `sum` members and skips `arr`/`tuple` members — `x & 1` /
  `1 - x` with `x: number | []` no longer records a false TypeError
  may-throw (native never throws; the old member scan dragged arr members
  into the may-throw channel ⇒ potential L2 false red). Regression-pinned in
  the Bug 946 suite, including the sound positive control (`1n + x` on the
  same union still records may-throw: the number member genuinely throws).
- **`collectNestedBodyRanges` wiring completed**: core exported it via
  `@nudojs/core/internal` and its comment claimed parser reuse, but parser
  still ran a full local copy. `file-directives.ts` now consumes the single
  source.
- **`parseIgnoreThrows`/`configIgnoreThrows`**: service is the declared
  single implementation (CLI / LSP / vite-plugin); the CLI kept its own
  verbatim copy and the LSP test suite used that copy as a mirror oracle.
  nudojs now re-exports from `@nudojs/service`; the tautological mirror
  assertion is replaced by direct-value assertions.
- **`absShapeForTsTypeText` via `@nudojs/core/internal`**: service's
  `tsAnnotationShape` was a hand-synced table replica ("勿单边扩表") with a
  drift-gate test holding the two copies together; both the replica body and
  the drift-gate file are gone.
- **emit section extraction**: `interface-derivation-emit.ts` and
  `interface-emitter.ts` duplicated the export-statement →
  `{names, bindings}` extraction (31 lines) and `stripSections` (14 lines);
  both now share `service/emit/export-section-scan.ts`.
- **`ScanLiteralCallsOptions`**: the thin shell's inline opts literal type
  was a documented structural mirror of the named interface; the shell now
  consumes the interface directly.
