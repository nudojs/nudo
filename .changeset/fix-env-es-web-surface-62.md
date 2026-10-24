---
"@nudojs/env": patch
---

族 62（片 W12）：env 的 **ES / Web 内建构造器声明面**精度 —— 5 条台账里 **1 条 env 侧真修**、**3 条由同批 core 收口**、**1 条复核后为非缺陷**。

**真修 · 第 5 条（Bug 890 精度）：env promise 的拒绝 reason 逐声明可见。**
`promiseOf(inner)` 加**可选**拒绝 reason（缺省仍是 `unknown` ⇒ 其余声明逐字不变），
逐声明给出**规范规定**的 reason：

- `fetch` ⇒ `TypeError`（网络错 / 非法 URL）∪ `AbortError`（信号 abort 的默认 reason）；
- `Request` / `Response` 的 body 读取族（`json` / `text` / `arrayBuffer` / `blob` / `formData`）⇒ `TypeError`（WHATWG Fetch「consume body」：流出错 / JSON 解析失败）；
- `crypto.subtle.*`（`digest` / `encrypt` / `decrypt` / `sign` / `verify` / `generateKey` / `deriveKey` / `deriveBits` / `wrapKey` / `unwrapKey` / `exportKey`）⇒ `OperationError` DOMException（WebCrypto 规范）；
- `navigator.clipboard.readText` / `writeText` ⇒ `NotAllowedError` DOMException（Clipboard 规范）；
- `Promise.reject(reason)`（**声明面**）⇒ 拒绝 reason 就是实参（ES 规范）。

效果：`catch (e)` 的形参不再恒为 `unknown` ⇒ `e.name` / `e.message` **可解**
（此前 `e.message` 折出 unknown ⇒ 拿不到）。

**声明面 · 第 1 条（Bug 332）：Intl 子构造器的实例方法面。**
`Intl.Collator` / `Intl.NumberFormat` / `Intl.DateTimeFormat` 的**实例面**
补上原生原型成员（`compare` / `format` / `formatToParts` / `formatRange` /
`formatRangeToParts` / `resolvedOptions`），方法值 + 参数/返回面齐备。

**其余 3 条已由同批 core 收口**（`fix-core-remaining-65`）：第 1 条的**运行时**面
（`typeof new Intl.Collator().compare` 现折精确 `"function"`）、第 3 条
（继承的 `cause` 不再折「确定不存在」，现为 `unknown` —— 原生是 `1`，
引擎取**不假精确**的口径）、第 4 条（`new Int8Array(["3"])[0]` 折 `3`，
类型化数组元素值面已建模）。第 2 条不是缺陷：原生 `new AggregateError()`
**抛 TypeError**，引擎同判（该入口报 `nudo:entry-may-throw` TypeError），
台账「`errors = []`」的前提与原生不符。

**env 包的 `exports` map 未动**（无新增导出面）；`promiseOf` 只加了**可选**形参。
