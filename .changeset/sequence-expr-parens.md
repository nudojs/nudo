---
"@nudojs/core": patch
---

fix(core): SequenceExpression 发射统一括号包裹 —— 逗号序列裸发射 `a, b` 在任何嵌套位都会撕裂宿主结构：对象字面量属性值/类计算键里后续项被解析成新属性的键 → `new Function` SyntaxError → 整文件 eval-incapable；数组元素位一项静默变多项（长度翻倍）。TS 降级 `#private` 产物 `[(_A = new WeakMap(), …, "k")]` 计算键正是该形态：yargs 全量命中 → 模块图逐依赖求值失败重试（失败不缓存）→ OSS bench yargs hub-edit 4.4x / check-all 2x 回归，CI OSS baseline gate 5 连红。括号在语句位/实参位均合法，统一包裹后语义不变（序列值 = 末项）。
