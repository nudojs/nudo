---
"nudojs": patch
---

族 16 修复 M6：Bug 566 568 569 582 589 593 —— `migrate verify` 与 `nudo check` 判定同源（文件筛选排除侧车/`.d.ts`、分析注入带模块图与 mock）、`--json` stdout 只放 JSON（人工报告走 stderr）、批量目标 per-file 隔离（语法错不再整批中止）、`--with-tsc` 基线真的加载 tsconfig 并按文件切分诊断、空目录判红（不再静默 exit 0）。
