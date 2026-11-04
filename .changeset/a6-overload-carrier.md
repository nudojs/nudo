---
"@nudojs/core": minor
"@nudojs/harvester": patch
---

Feat: architecture debt A6 — fn shapes carry an optional overload set, and calls dispatch by argument shape (closes the Bug 827 / A5 false red).

- `Shape` fn branch gains optional `overloads?: FnOverload[]` (`{ paramTypes, returnType }[]`, declaration order = TS resolution order). Absent ⇒ every existing shape, key, and projection is byte-identical.
- `instantiateReturn` dispatches on overloads: first arm in declaration order whose arity matches and whose params accept the arguments (per-param `leqAbs`, α bound/substituted per arm) supplies the return face; zero hits fall back to the union return face (no invented may-throw). Union face (`paramTypes`/`returnType`) stays the authoritative extensional face — `leqAbs`, `formatShape`, dts/schema/guard read only it; overloads are a dispatch refinement, not assignability.
- Harvester: top-level function overloads and interface/class method overloads both snapshot arms **before** the union-face merge (shared `collectOverloadArms`; Bug 807 two-path parity preserved). `HarvestSig` gains `overloads` so disk-cache round-trips keep the dispatch face; `HARVEST_DISK_ABI` v13 → v14 (old entries miss cleanly instead of silently losing overloads).
- `absKey` includes overloads (distinct overload sets no longer share memo/fingerprint); `substShape` substitutes arm Abs data; `snapshotAbs` deep-copies overloads and now carries the fn impl side table (A7 mirror — snapshots no longer degrade to shape-only).
- Evidence: types-only package with `convert(x: string): string; convert(x: number): number;` — `nudo check` goes from 2 L2 `entry-may-throw` false reds (`method 'toFixed' missing on string receiver` / symmetric) to OK, matching `tsc --strict` exit 0; `useNum() => string` / `useStr() => string` exact. Gold/recall/real-package gates 223 green; harvest + emit + differential 1434 green.
