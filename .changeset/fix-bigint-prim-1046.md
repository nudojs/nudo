---
"@nudojs/core": patch
---

fix(core): bigint 字面量契约带 `prim: "bigint"`（族 48 · Bug 1046 core 面）

**病灶**：`litC(v)` 只给 number / string / boolean 标 `prim`，**bigint 字面量不带
prim** ⇒ `constraintOnTermAbs` 落到「有界但无 prim ⇒ 按 number 处理」的兜底 ⇒
契约 Abs 的 **shape 说 number、pred 说 bigint**（`x = 1n`）⇒ 各面互相矛盾：

- **guard 面**：渲染成 `(typeof data === "number") && (data === 1n)` ⇒ 契约申报的
  **唯一合法值 `1n` 被守卫拒收**（**假红**：`guard(1n) === false`）；
- **dts 面**：bigint 契约的返回类型被写成 `number`；
- **union 成员面**更糟：`samePrimLiteralUnionAbs` 按 `typeof v` 归类，bigint 落到
  兜底分支 ⇒ `union(lit(1n))` 的 shape 说 **boolean** ⇒ 守卫恒假。

**修法**（`packages/core/src/algebra/constraint.ts` 的 `litC`）：补 bigint 分支 ⇒
`prim: "bigint"`，与 number / string / boolean 字面量契约**同款口径**
（`constraint-builders.test.ts` 钉的 `typeof x = "number" ∧ x = 42` 就是这条口径）。

**跨面效果**：

- guard 面 ⇒ `(typeof data === "bigint") && (data === 1n)` ⇒ `guard(1n) === true`
  （假红消除）；union 成员同样落到 prim bigint（不再说 boolean）。
- dts 面 ⇒ bigint 契约的返回类型写成 `bigint`（此前是错的 `number`）。
- zod / standard 面**不变**：bigint prim 无解码器 ⇒ 仍走「eq 主导」投影 ⇒ 节点仍是
  `{k:"lit", value:1n}`（与 service 侧 Bug 1046 的 zod 面修复同口径）。
- **门禁的接受集不变**：`lit(1n)` 仍只接受 `1n`。但契约谓词现在与其它 prim 同款
  带 typeof 义务（`typeof x = "bigint" ∧ x = 1n`）⇒ 实参**类型**不符时，除 literal
  义务（`x = 1n`）外还会多报一条**类型**义务（`typeof x = "bigint"`）——与
  `lit(1)` / `lit("a")` / `lit(true)` 契约的既有行为同款（此前只有 bigint 字面量
  契约缺这条类型义务）。
