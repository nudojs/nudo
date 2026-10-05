---
"@nudojs/core": patch
---

fix(core): OOB marker 臂不再把返回契约判成 error（issue #102）—— 抽象下标读（循环建表后的 `d[m][n]`）并入的 `oobUndef` marker（conf=partial 合成 undefined）是引擎精度产物而非用户域 undefined；postcondition 对该臂降级 unprovable（`nudo:unproven-return` warning，gate 不再变红），与 widened 污染臂同口径；契约显式承认 nullish（`nullable(...)` / `union(..., lit(null))`）时 marker 臂 discharged（多臂与单臂 proved 口径对称）。真实 nullish 返回臂仍照常 `nudo:constraint-violated` error；其余真实臂证据充分时仍 disproved。DP / 编辑距离 / 备忘录类「循环建表 + 按构造在界内读取 + number() 返回契约」函数恢复绿门（1.3.4 语义）。已知召回权衡：真实无约束下标越界返回（`return a[i]`）从 error 降为 warning——与 #98 oobUndef 按类压制同族，理想收窄需循环上界×下标关系推理。
