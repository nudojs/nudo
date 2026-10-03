---
"@nudojs/parser": patch
---

fix(parser): `@nudo:mock <name> from './x.js'` 单引号路径此前静默不识别（MOCK_FROM_REGEX 只认双引号），现单/双引号均可解析；from 路径单引号未闭合也发 nudo:directive-syntax 诊断（此前只查双引号）
