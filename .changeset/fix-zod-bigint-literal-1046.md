---
"@nudojs/service": patch
---

fix(service): 契约申报的 bigint 字面量在 zod 面不再被静默放宽（族 37 · Bug 1046）

**病灶**：契约里申报 bigint 字面量（如侧车 `fn({}, lit(10n))`）时，zod 面的产物
写的是 `z.unknown()` —— 比门禁**宽**（门禁按 `lit(10n)` 判红、zod 放行 `10` / `42` /
`"x"` / `null`）⇒ **假绿**；而且**零台账**（产物里没有任何痕迹）。

零台账的根因是**两层都失声**：契约路径的 Abs 把字面量放在 **pred** 里
（`eq(self, lit(10n))`）⇒ 节点层（`absToSchemaNode`）认为「投影成功」（节点 =
`{k:"lit", value:10n}`）⇒ 不进 `dropped`；而 zod 渲染臂 `case "lit"` **没有 bigint
分支** ⇒ 落到兜底 `z.unknown()` ⇒ 与 standard 面（`{"k":"lit","value":10n}` 保真）
的**接受集自相矛盾**。

**修法**（`packages/service/src/emit/schema-generator.ts`）：

- zod 方言的 `lit` 臂补 bigint 分支 ⇒ `z.literal(10n)`。zod 的 `z.literal`
  **原生支持 bigint**（zod v3/v4 皆可；真 zod v4.6.7 实测 `safeParse(10n)=true`、
  `safeParse(10|42|"x"|null|undefined)=false`）⇒ zod 面的接受集现在**等于**
  standard 面 ⇒ 跨面自相矛盾消失。
- **方言保真**升为渲染层的**局部不变量**：zod 渲染器改为同时返回**源码 + 自己
  的降级台账**，凡是把可表达的形态降级成 `z.unknown()`（类型外的字面量值、没有
  运行期构造器的 brand）**必须留痕** ⇒ 台账并进**既有** `dropped` 通道 ⇒ 出现在
  产物的 `// dropped preds (not projected into zod):` 块里（用户可见）。
  「静默放宽」从此在渲染层不再可能发生（改前 bigint 契约字面量就是靠这条路漏出去的）。

**已知偏差（core 层，族外，未修）**：guard 面渲染
`(typeof data === "number") && (data === 10n)` ⇒ `guard(10n) === false`
（**假红**：拒收契约申报的唯一合法值）。根因在 core：`litC(bigint)` 不给 prim
（`PrimName` 有 `"bigint"` 但 `litC` 不用）⇒ `constraintOnTermAbs` 落到
「有界但无 prim ⇒ 按 number 处理」的兜底 ⇒ Abs 的 shape 说 number、pred 说 bigint。
core 不在本族范围 ⇒ 以 `it.fails` 旗标钉住（core 修好后旗标会翻红，提醒摘掉）。
