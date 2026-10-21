---
"@nudojs/harvester": patch
---

族 27 修复 H8b：Bug 825 · 834 · 960 · 1003 · 1015 —— 草稿面（`nudo contract
--from-dts`）不再静默丢导出 / 说谎的汇总行 / 产出语法非法的草稿。

**Bug 825** — **重载集静默塌成第一个 overload** ⇒ 草稿少声明签名，且被丢掉的
overload **不计入 `skipped`** ⇒ 汇总行看不出任何丢失。现在重载**全部保留**
（返回位取全部 overload 的 union，与收割面同口径），每条 overload 的**签名写进
note**（审阅者看得见「这里本来有 N 条」），被合并掉的 overload **逐条计入
`stats.skipped`**。

**Bug 834** — 带引号 / 连字符的属性键产出**语法非法**的草稿 ⇒ 抄进 `*.nudo.js`
后 sidecar **加载失败** ⇒ `nudo check` 门禁由绿转红（exit 1）。属性键现在走
**合法转义**（JS 标识符 / 字符串字面量两种合法形态）；`__proto__` 走**计算属性名**
（对象字面量里的 `__proto__: v` 即便带引号也会触发 `[[SetPrototypeOf]]` ⇒ 成员从
字面量里消失）。

**Bug 960** — 5 类**运行时导出**（`export {x} from` / `export * from` / `enum` /
`namespace` / 匿名 `export default function`）整条丢弃，且汇总行报「0 skipped」⇒
丢失零信号；而同一 harvester 的**收割面看得见 `Color`（enum）** ⇒ 两个产物面自相
矛盾。现在 5 类导出全部进草稿（`enum` / `namespace` 投影成运行时 shape；再导出
逐个 push + note）；**投影不了的也要 `push({name, note, kind})`** ⇒ 进
`stats.skipped` ⇒ 汇总行说真话。

**Bug 1003** — **具名 default 导出**被写成本地名键 ⇒ 草稿键 `helper` ≠ 模块导出名
`default` ⇒ 照抄进侧车后该导出**永远零义务**（假绿），而汇总行报「0 skipped」。
现在 default 导出的草稿键**恒为 `default`** ⇒ 抄进侧车后绑定的是模块的 `default`
导出（实测 `impl(x: number) => string`；改前是 `impl(x: any) => string` +
`nudo:interface-entry-only`）。

**Bug 1015** — 目录模式**静默只投影前 16 个 `.d.ts`** ⇒ 第 17+ 个文件的导出整条
不存在，而汇总行报「16 d.ts · 0 skipped」。现在目录模式**投影全部** `.d.ts`；
遍历不到的地方（读失败 / 深度上限）**如实计数** ⇒ 汇总行说真话。
