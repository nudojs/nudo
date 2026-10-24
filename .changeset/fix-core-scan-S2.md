---
"@nudojs/core": patch
---

fix(core): 调用点扫描 / 契约执法五处缺陷（族 11 片 S2）

- **433** `union(...)` 含 shape / array 成员时**成员结构义务整体丢失**（假绿）：
  契约侧把成员摊成顶层 `or(...)`（结构义务实例化即丢），执法侧也没有 union
  成员分支 ⇒ 两侧都缺。消费侧补 union 成员分支：与实参形态匹配的成员**全部**
  不满足才报违例（union 是析取）；谓词通道能自己裁决时让位（不双报）。
- **436** 同一条「缺字段」违例被 `checkShapeReqs` + `checkReqs` 两条并行通道
  **各报一次**（错误计数翻倍）⇒ 报告收敛到 `checkReqs` 一处，诊断文本不变。
- **439** `lazy(() => shape(...))` / `lazy(() => array(...))` 的结构义务被闸门
  `continue` 掉（假绿）⇒ 判闸门前先 deref lazy 包装（按 `LAZY_TEMPLATE_DEPTH`
  预算递归解包）。
- **914** 字段位 / 数组元素位的 `null` / `undefined` 实参完全不被执法 ⇒ prim 门
  与数值界门显式判 nullish 违例（与顶层标量面同口径）。
- **1021** 顶层「结构约束」位对 `null` / `undefined` 实参零诊断（假绿）⇒ 排除
  条件改成「**无 term 的** unknown / any / never 才跳过」。
