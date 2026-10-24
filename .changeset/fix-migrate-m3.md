---
"nudojs": patch
---

族 16 修复 M3：Bug 581 / 584 / 597 —— `nudo migrate` 的 workspace 包枚举改为真 glob：对象式 `workspaces`（`{ packages: [...] }`）不再被静默丢弃（子包在 status 与 `retire --all` 里可见并被真正退役）；pnpm 负向模式 `!packages/legacy` 真的排除该包（不再被 `retire --all` 改写 / 删依赖 / 写 marker）；`packages/**` 与多段 pattern（`packages` 目录下两层 `*`）能发现嵌套成员（不再「nothing to retire」假绿）。被排除 / 未匹配的包通过 stderr 显式说明。
