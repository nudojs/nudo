---
"@nudojs/core": patch
---

fix(core): `String.prototype` 的 ES2017 别名 `trimLeft` / `trimRight` 方法值读不再折成 `undefined`（族 41 · Bug 1055）

宿主 `String.prototype` 上真实存在两个 ES2017 别名 `trimLeft` / `trimRight`
（≡ `trimStart` / `trimEnd`，原生同一内置）。引擎有**两套**字符串方法名集合：

- **方法派发面**（`packages/core/src/algebra/methods.ts`）—— `case "trimLeft":`
  / `case "trimRight":` ⇒ **调用**路径认识这两个别名；
- **方法值读投影面**（`packages/core/src/algebra/exec/member-diag.ts` 的
  `STRING_METHODS` 白名单）—— 只列了 `trimStart` / `trimEnd`，**漏列**这两个
  别名 ⇒ **读**路径把它们当成「原型上不存在的成员」。

⇒ 同一引擎两套集合自相矛盾：`s.trimLeft()` 正常返回 `string`，但 `s.trimLeft`
读出 **exact `undefined`**（原生是 `function`）⇒ `String.prototype.trimLeft`
走同一张表 ⇒ 同样落 `undefined` ⇒ `String.prototype.trimLeft.call(s)` ⇒
「property 'call' on undefined」⇒ 硬 `TypeError` ⇒ **L2 门禁假红**
（`nudo:entry-may-throw`）。

**修法**：`STRING_METHODS` 补 `"trimLeft"` / `"trimRight"` 两个表项（只加表项，
不动任何导出面）。修后：

- `typeof s.trimLeft` / `typeof s.trimRight` ⇒ `function`（原生同）；
- `String.prototype.trimLeft.call(s)` / `String.prototype.trimRight.call(s)`
  ⇒ `string`，不再记 `TypeError`（L2 假红消失）；
- 调用面 `s.trimLeft()` / `s.trimRight()` 不变（≡ `trimStart` / `trimEnd`）；
- **负控**：表外名字（如 `notARealMethod`）仍折 exact `undefined`，仍记
  `TypeError` ⇒ 没有把整张表改成全放行。

顺带把「表与宿主同名集同源」这条不变量钉住：新回归钉逐名对拍
`Object.getOwnPropertyNames(String.prototype)`（node v26.10.0 实测：自有方法
50 个 = 本表 50 个，无漏列 / 无多列），防止「派发面认识、读面不认识」的分裂
再次发生。
