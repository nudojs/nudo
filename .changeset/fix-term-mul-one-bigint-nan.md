---
"@nudojs/core": patch
---

fix(core): simplifyTerm 的 x*1 恒等式不再把 bigint 字面量折成 lit(NaN)（5n*1 原生是混型 TypeError，保留原项交算术核 foldBigintBinOp 处理）
