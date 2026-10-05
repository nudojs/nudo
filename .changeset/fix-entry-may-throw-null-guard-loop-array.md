---
"@nudojs/core": patch
---

fix(core): entry-may-throw 双误报修复（issue #97 / #98）——null 守卫后的对象 union 成员读不再报 may-throw（`p === null` 早退 / 内联三元 / `!p` / `!== null` 正分支 / `?. ??` 五形态；转译层守卫臂影子重绑 `$removeNullish`，`?.` 续体同构剪枝）；循环构建二维数组的嵌套索引读（`d[i-1][j]`）不再折 may-throw / never（非字面量下标键修复、oobUndef 越界标记、widenLoopJoin 循环 widen、`.length` 非负 pred 使 `new Array(n)` 豁免 RangeError note、`fill()` 默认窗口元素整体替换、Math min/max sum 实参逐臂判定）。契约版 levenshtein/DP 全绿；无契约 any 实参保持诚实 may-throw 政策不变。
