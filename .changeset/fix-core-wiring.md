---
"@nudojs/core": patch
---

族 06 收口接线：补上分片被终止前未落地的两段，并把它们钉住。

- **965 的最后一段**：实参抽取只处理数字与字符串字面量 ⇒ `f(null)` 根本没有
  实参可判 ⇒ 调用点前置条件整条不查 ⇒ `lit(null)` / `lit(undefined)` 契约
  对 null 实参永远不报违例（假绿）。null 与 undefined 现在都进实参位，
  且分属两个域（`undefined` 是全局绑定，不是局部变量）。
- **348 的最后一段**：check 签名面的参数类型走的是自己的 widen 路径 ⇒
  `lit(1)` 被印成 `number`，而契约面印 `lit(1)`、dts 面印 `1` ⇒ 同一份契约
  三个面三种答案。签名面现在与契约面、dts 面对齐。
- 渲染面修了一个**会崩**的字面量拼法：bigint 走 `JSON.stringify` 直接抛
  `Do not know how to serialize a BigInt`（NaN / ±Infinity 印成 `null`、
  `-0` 抹成 `0`）——字面量展示现在按 JS 字面量拼法。
