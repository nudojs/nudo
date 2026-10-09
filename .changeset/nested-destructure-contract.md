---
"@nudojs/core": patch
---

fix(core): sidecar dot-path keys (`fn({ 'card.grade': string() })`) now bind nested destructured params — nestedPaths surface collection, fieldPath-aware projection in check/case scans, and nested obj-Abs synthesis in the refine block; flat binding names keep precedence (#137)
