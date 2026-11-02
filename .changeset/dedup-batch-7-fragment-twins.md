---
"@nudojs/core": patch
"@nudojs/env": patch
"@nudojs/harvester": patch
"@nudojs/lsp": patch
"@nudojs/service": patch
---

Dedup batch 7 (jscpd `--min-tokens 70` re-audit after batch 6: residual
same-file fragment twins + one drifted manual-sync pair). Pure refactor —
defineEnv deep structural dump (sorted + insertion-order preserving)
byte-identical vs HEAD, verify:examples 251 checks green, lint +
lint:tests clean.

- env `node.ts`: Storage slot table ×3 (ctor brand + localStorage +
  sessionStorage) → single `storageObj` const (messagePortSlots pattern);
  exec-family options obj (execSync / execFileSync / spawnSync) → shared
  `execSyncOptions`; Request / Response body-mixin slots
  (clone/arrayBuffer/blob/formData/json/text, clone returns the respective
  brand) → `bodyMixinSlots(self)` factory; EventEmitter core
  on/once/off/emit → `emitterCoreSlots` shared by the EventEmitter brand
  and the `process` global object.
- env `node.ts` path family — the drifted manual-sync pair: the top-level
  `pathModule` inlined the whole member table next to the
  `platformPathMethods(posix/win32)` factory and had already drifted
  (`join.required` only on the top-level copy). `pathModule` now consumes
  the factory; member order canonicalized to the top-level key order;
  `join`'s required-arity enforcement is now identical across
  path/posix/win32 (Bug 877 case 6's claimed parity now real).
- env `web.ts`: URL `.searchParams` slot table and the global
  URLSearchParams constructor share `searchParamsCoreSlots` (toString /
  iterator face / size stay per-site; insertion order preserved).
- core `builtins/error/binary.ts`: DataView ctor and
  `makeTypedArrayFromBuffer` share `bufferByteLengthLiteral` (brand→inner
  obj→byteLength slot fold); `TypedArray.of`'s inlined copy of the
  number-domain item enforcement now calls `enforceTaItem` (the `.of`
  cause variant is unified into the shared text — no pins).
- core `builtins/object/methods.ts`: `getOwnPropertySymbols` obj arm and
  brand-inner arm share the `ownSymbolsTuple` tail (open/index →
  undefined, closed → counted tuple).
- core `exec/transpile/helpers.ts`: the MemberExpression root-identifier
  walk (assignment / update / stateful-call faces, ×3) →
  `markFreeMemberRoot`.
- core `scan-call-graph.ts`: dynamic-import and require ObjectPattern
  destructure binding loops → `bindPatternImports`; top-level class scans
  (`findClassDecl` + module-frame class bindings) share
  `unwrapExportDecl`.
- harvester `harvest-dts.ts`: `resolveIfaceDecls` inner-first relative
  namespace resolution loop (qualified arm + short-name arm) →
  `addRelativeNsHit`; `absExtends`' two `es.k === "sum"` member folds →
  `foldSumFlags` (the `cs.k === "sum"` fold is intentionally different and
  untouched).
- service `analyzer-orchestrate-uncached-cases.ts`: the two expected-slot
  enforcers (literal face / predicate face) share `actualSlotTable`
  (obj direct / brand inner-obj unwrap).
- lsp `server-navigation.ts`: `onDefinition` now uses the shared
  `navigationIdentAt` preamble (documents.get → isNudoFile → parse →
  ident-at-position) like onReferences / onPrepareRename; Bug 751 gate
  comment kept.
- lsp `agent-tools.ts`: `suggestCase` / `trace` share the
  `analyzeToolFile` preamble (resolveToolFile → readSource →
  analyzeFileAsync "all", Bug 993 async preload).
