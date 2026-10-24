---
"@nudojs/core": patch
---

族 06 修复 S3：Bug 342 / 348 / 355 / 922 / 965 —— 约束 → Abs 投影不再蒸发
用户写下的那部分约束，产物面与门禁面给出同一个裁决。

- **922**：`array(number()).min(3)` 这类**数组自身**的长度界在 Abs 投影里整条
  丢弃（数组分支提前返回、pred 槽写死 undefined）⇒ 契约面 / zod 面 /
  standard 面 / 门禁面全都看不见它 ⇒ 完全静默的假绿。数组分支现在承载顶层
  长度界，执法面也按**数组元素个数**求值（此前只处理字符串）。
- **355**：`array(string().max(1))` 的**元素**长度界在 Abs 投影里无处承载 ⇒
  同一份代码，CI 门禁判绿而 zod 产物面判红（跨产物面自相矛盾）。元素的长度
  界现在进 Abs 投影，执法面按元素位（`length(a[0]) ≤ 1`）求值。
- **965**：`lit(null)` / `lit(undefined)` 的整条约束在 Abs 里消失（pred 被丢弃
  + shape 退成 unknown）⇒ 形参退化成 unknown、调用点前置条件不再执法 ⇒
  门禁 OK / exit 0（假绿），而同一份契约在 dts 面印 `x: null`、在契约面印
  `x: lit(null)` ⇒ 三个面三种答案。nullish 域现在保留在 pred 槽里，null 与
  undefined 分成**两个域**（`lit(null)` 契约不收 undefined，反之亦然）。
  实参抽取此前只处理数字与字符串字面量 ⇒ `f(null)` 根本没有实参可判 ⇒
  null / undefined 现在也进实参位。
- **342**：`.int()` 是**数据标志**不产生 pred ⇒ 约束 → Abs 投影把整性整条
  蒸发 ⇒ zod / standard 产物面静默放行 `3.5`，而门禁（读约束）仍判红 ⇒ 两道
  门对同一事实给出相反裁决。整性现在投影成 pred。
- **348**：`lit()` 的字面量只活在 pred 里（shape 无字面量位）⇒ 只看
  term / shape 的 widen 路径永远看不见它 ⇒ 同一份契约四个面四种答案。check
  签名面与 dts 面的**参数位**现在按 pred 里的字面量域保形
  （`x: lit(1)` / `x: 1`），与契约面、zod 面对齐。

渲染面顺带修了一个会崩的字面量拼法：bigint 走 `JSON.stringify` 直接抛
`Do not know how to serialize a BigInt`（NaN / ±Infinity 会被印成 `null`、
`-0` 被抹成 `0`）——现在按 JS 字面量拼法展示。
