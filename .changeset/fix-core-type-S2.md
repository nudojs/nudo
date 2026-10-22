---
"@nudojs/core": patch
---

fix(core): `+` 的 bigint 臂不再短路数组臂；`0 / x` 折叠保留分母符号

- Bug 946：`add()` 的数组臂（ToPrimitive → `join(",")` ⇒ string）**前移**到 bigint
  臂之前 —— `+` 的第一步是 ToPrimitive，原生 `1n + []` 得字符串 `"1"`、**从不抛**，
  此前 bigint 臂先命中 ⇒ 硬抛 `TypeError` ⇒ 返回值折 `never` ⇒ L2
  `nudo:entry-may-throw` **假红**（exit 1）。现在 `1n + []` / `[] + 1n` / `[1] + 1n`
  / `1n + [1,2]` 分别折 `"1"` / `"1"` / `"11"` / `"11,2"`，`catch` 语义同步纠正
  （原生不抛 ⇒ `try` 块正常走完，不再误进 `catch`）。
- Bug 946（算术面）：`isMaybeBigintOperand` 的 kind 清单补 `arr` / `tuple`，
  `foldBigintBinOp` 给数组/元组一条**显式硬抛**分支 —— 数组的 ToPrimitive 恒为
  字符串 ⇒ `ToNumber` ⇒ number ⇒ 与 bigint 混型 `TypeError` **确定**（原生
  `1n - []` 恒抛）⇒ 硬抛且可被 `catch` 吸收（不得走软 may-throw 通道：软通道让
  求值继续 ⇒ `catch` 分支变死代码）。`isMaybeCoercionThrowOperand` 把数组/元组
  **排除**（其 ToPrimitive 恒 string ⇒ 既不会成 bigint 也不会成 Symbol ⇒
  `1 + []` / `[] < 1` 原生从不抛，不得记假 may-throw）。
- Bug 959：`div()` 的 `0 / x` 字面量折叠（issue #170）此前在判「分母可证非零」后
  直接折 `+0`，把 IEEE「`0 / x` 取 x 的符号」丢在门外 ⇒ 负分母的 `-0` 被折成
  `+0`（下游 `1 / (0 / x)` 再折成 `+Infinity`）。现在**分母符号参与折叠**：
  分母恒正 ⇒ `+0`，分母恒负 ⇒ `-0`（`lit` 保真负零），下游相应为 `-Infinity`。
  符号不可证（可能正 / 可能为 0）时仍不折（保守）。
