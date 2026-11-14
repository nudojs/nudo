---
"@nudojs/core": patch
"@nudojs/service": patch
---

Switch the `check` entry census to the semantic binding index by default (ADR 0001 stage 1, slice 3). This closes the audit's false-green export shapes: destructured exports, default object literals, anonymous default classes, CJS / ESM class expressions are now real entries. Two index-precision fixes land with it: getters / setters are no longer treated as callable entries, and nested function declarations are no longer mistaken for module-level entries (previously produced false `nudo:opaque-result`). The legacy census remains reachable via an internal fallback switch, and the index-face state is part of the check memo and service file/function cache keys so flipping it cannot replay stale results. The public `.` export surface is unchanged. Stage 1 slice 4.1 adds an internal, off-by-default publish-gate shadow comparison between the existing diagnostic-code whitelist and the typed `Evidence` verdict; it only records divergences and does not change any export decision.
