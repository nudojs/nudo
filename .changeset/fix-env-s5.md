---
"@nudojs/env": patch
"@nudojs/service": patch
---

族 29 修复 S5：Bug 861 · 864 · 865 —— es env 的 console 成员表补全（`timeStamp` / `dirxml` / `profile` / `profileEnd` 等缺槽读出 exact undefined ⇒ `console.timeStamp()` 假红「may throw TypeError」）、URI 族改走 core 的 `evalGlobalFn` 建模（`decodeURI("%")` 的 `URIError` 不再被吞 ⇒ L2 假绿修复，抽象实参回落声明域 + may-throw URIError）、es env 补齐 ES 规范全局声明 + service 的「已被覆盖」判定改为按 core 真实建模能力推导（`BigInt` / TypedArray 全家 / `ArrayBuffer` / `DataView` / `AggregateError` / `Function` / `escape` 等不再被报「未被 Nudo 覆盖」，与同一份报告里的精确签名自洽）。
