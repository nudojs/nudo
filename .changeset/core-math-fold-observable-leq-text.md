---
"@nudojs/core": patch
---

fix(core): Math 原生折叠抛错不再静默拓宽为 number——min/max、round/floor/ceil/trunc、通用 impl 三处 catch 补 `noteAbsTruncation`（`#math-fold-error`，check 映射 info 级 `nudo:math-fold-error`，不再误报 recursion-truncated），宿主篡改/环境分叉的 `Math.*` 精度损失可观测。`leqAbs` pred 失败文案改用 `predToString` 渲染（`pred ⊭ x > 5` 替代裸 op 名），`nudo:assign-mismatch` suggestion 直接可读。内部：leq 比较辅助函数改精确 `CmpPred`/`Term` 类型（删除三处 `as never` 与弱结构签名，行为零变更）；checkSource 消除 sidecar 场景对同一 source 的二次完整 parse（`localNamedExports` 复用一次结果）。
