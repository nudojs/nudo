---
"@nudojs/core": patch
---

fix(core): 字符串 / 正则方法族的 4 处语义偏差（族 03 Bug 249 / 251 / 252 / 1042）

- **249** `String.prototype.matchAll` 的结果补上**迭代器协议面**（原生 RegExp String
  Iterator）：`next`（按游标推进，耗尽 → `{value: undefined, done: true}`）、
  `@@iterator`（返回自身）、`@@toStringTag`（`"[object RegExp String Iterator]"`）。
  此前只挂 brand 名 + 元素侧表 ⇒ `typeof it.next` 折 exact `"undefined"`
  （wrong-exact）、`it.next()` 折 unknown。协议槽按原型语义建模（internal 槽：
  `Object.keys` 空 / `hasOwnProperty` 假 / `in` 真）。
- **251** `toLocaleString` / `toLocale*` 家族的**值**与**locales 实参校验**：
  number 臂此前把 `toLocaleString` 重定向成宿主 `toString` ⇒ 丢千分位 / `-0` /
  指数形态（`(1234567.5).toLocaleString()` → `"1234567.5"`，原生
  `"1,234,567.5"`）；三臂（number / bigint / 字符串 `toLocaleUpperCase|
  toLocaleLowerCase`）均不校验 locales 实参 ⇒ `null`（原生 TypeError）、非法
  language tag（原生 RangeError）全不抛 ⇒ throws 域折 never（假 no-throw）。
  现改走宿主 ICU 路径 + `CanonicalizeLocaleList` 同款校验。
- **252** `String.prototype.search` / `match` / `matchAll` 的**无效字符串模式**：
  模式编译失败此前被 `catch { return undefined }` 吞成「本臂不接管」哨兵 ⇒ 回落
  抽象臂 ⇒ **throws 域折 never**（假 no-throw，L2 门禁假绿）。现按 RegExpCreate
  步 2 定抛 **SyntaxError**（字面量模式 ⇒ 编译结果运行时同款），抽象接收者路径
  同步补判定。
- **1042** `charAt` / `charCodeAt` / `codePointAt` / `at` **没有第二实参**（元数 1）：
  此前与 `slice` / `substring` / `substr` 同 case 分支且无条件校验 `args[1]` ⇒
  `"abc".charAt(0, 1n)` 凭空判「必抛 TypeError」（原生正常返回 `"a"`）⇒ L2 门禁
  假红。现按各方法**真实元数**分流校验。
