---
"@nudojs/harvester": patch
---

族 27 修复 H7：Bug 833 835 1014 —— 包根解析改为「包自带 types 优先、`@types` 最后回落」；包名键只由该包自己的顶层导出占（模块记录不再占包名键），子路径说明符不再回落到包名键；ambient 声明（`declare global` / script 模式 `.d.ts`）不再被提升成包名键的具名导出。
