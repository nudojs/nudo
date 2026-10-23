---
"@nudojs/service": patch
---

`@nudo:mock-module` now fails closed when the mock file does not export a name
you listed, instead of silently falling back to the original module.

- The local (named) form of the directive lists the exports to replace. A name
  the mock file does not provide was skipped without a word, so the original
  module's export of the same name survived the overlay: the analysis ran on a
  **half-mocked program** (one export from the mock, the other from the real
  module), and the directive was still reported as applied. Signatures,
  contracts, `.d.ts` and schema products were then computed for a program that
  exists neither in the source nor in the mock.
- Such a name is now reported through the existing module-loading error channel
  as `nudo:module-missing` (error) — one diagnostic per missing name — and the
  directive is **not applied**: the original module is left untouched rather
  than half-overlaid. Exports the mock does provide keep working, and names you
  did not list still fall through to the original module as documented.
