---
"@nudojs/env": patch
---

fix(env): node env 面的 4 处假绿 / 口径不一致收尾（族 64）

env 的 node 声明面是**手写**的 ⇒ 宿主**必抛**的路径被判「恒不抛」⇒
**L2 门禁假绿**。本批按**宿主实测**（node v26.10.0）逐条收口。

**第 1 条 · 全局 `TextEncoder` 是 class，裸调必抛 TypeError（真修）。**
宿主实测：`TextEncoder()` ⇒ TypeError（"Class constructor TextEncoder cannot be
invoked without 'new'"）；旧声明是**普通 fn 面** ⇒ 裸调落「返回声明类型、
**永不抛**」⇒ 假绿。现在**在 env 侧声明成类值**（core 的 Bug 272 判据：
`ctor: true` + 单一 rest 形参 `"_rest"` ⇒ 裸调定抛 TypeError，**与原生同形**），
`apply` 返回**声明实例面** ⇒ `new TextEncoder()` 的实例面
（`encoding` / `encode` / `encodeInto`）**不丢**——不像「删声明回落宿主」那样
退成 `undefined`（那是**确定的错值**，宿主真值是 `"utf-8"`）。
副作用（诚实记录）：签名显示从 `() => TextEncoder` 变为 `(_rest) => TextEncoder`
——与 core 自己对**类表达式**的显示口径（`(_rest) => ?`）同款。

**第 2 条 · `node:url` 的 `URL` 不再吞掉原生异常（真修，调用面）。**
apply 的 catch 分支此前 `return undefined` ⇒ 非法 URL 被静默吞掉（恒不抛）；
现在套 **Bug 881**（`fileURLToPath`）同款范式：非法 URL ⇒ 记 **TypeError**
throws 面；抽象实参 ⇒ 原生可能抛 ⇒ 同样记 may-throw TypeError；合法 URL ⇒
零抛 + 字面量 `href`（字面量精度不回归）。
*已知偏差（core 侧 A 类债）*：core 的 `$new` 只取 `AbsApplyResult` 的 `abs`
（**throws 面被丢**）⇒ env 层无法表达「构造期必抛」⇒
`new URL("not a url")` 仍恒不抛；已在钉里记录现状，待 core 修复后改写。

**第 3 条 · `util` / `querystring` 的 `escape` / `unescape`（无需改动，已钉）。**
宿主实测：`require("node:util").escape === undefined`（util **没有**这两个
成员）、`require("node:querystring").escape` 是函数（querystring **有**）⇒
env 的 querystring 面与宿主一致，util 面也**没有**多声明 ⇒ 任务书前提里的
「util 多声明」实为**误归因**（声明在 querystring 面，宿主同样有）⇒ 不改，
只钉住与宿主一致。

**第 4 条 · `crypto.subtle` 的拒绝 reason（不改，保持 `unknown`，已钉）。**
宿主实测：node 的 WebCrypto 与浏览器**不同**——拒绝 reason ∈
{NotSupportedError, TypeError, OperationError, DataError}（**从不是**
OperationError 唯一值）⇒ 按 `promiseOf` 的契约（reason 必须是**全部**拒绝
路径的公共上界，否则是 wrong-exact）node env 的 reason 必须保持 `unknown`；
web env 的 `OperationError` 是**浏览器口径**（WebCrypto 规范）⇒ 跨 env
不同源是**宿主事实**，不是缺陷 ⇒ 不改，只钉住。

**负控**：族 61 的既有声明**逐字不变**——node env 仍是 **130** 个全局、
`node:crypto` / `node:fs` / `node:fs/promises` 的成员名单与 formatShape 不变。
**env 包的 `exports` map 未动**（无新增导出面）。
