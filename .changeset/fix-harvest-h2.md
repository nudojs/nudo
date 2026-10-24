---
"@nudojs/harvester": patch
---

族 27 修复 H2：Bug 791 · 805 · 806 · 812 · 813 —— 泛型实例化按**实参身份**分桶、
接口成员**重载集全部保留**、递归类型别名改**按引用建模**（不再指数展开）、
递归 interface 的自引用不再铸成**闭合空 brand**、类型形参**默认值生效**。

**Bug 791** — 泛型实例化缓存键只编码**实参个数** ⇒ 同一接口的不同类型实参命中
同一条缓存 ⇒ `Box<number>` 被折成 `Box<string>`（`Box<number>.value` 收割成
`string`）。缓存键改成编码类型实参的**身份**（Abs 结构 + α term 身份）⇒ 不同
实参 ⇒ 不同实例；同一实参 ⇒ 仍然命中缓存（同一个 Abs 实例对象）。

**Bug 805** — 接口成员的**重载集只保留第一个 overload** ⇒ 其余 overload 的返回
类型被**整体抹除**（`m(a: number): string; m(a: string): number` 收割成
`(number) => string` ⇒ 假红 + 假绿，与 TS 完全倒置）。重载集现在**全部保留**：
参数位逐位 union（复用顶层函数路径的 `mergeOverloadParams`，Bug 827 同族），
返回位取 union（带 α 的返回优先）⇒ 与 materialize 的 fn 分支**同口径**，
同一实体两条收割路径不再分叉。

**Bug 806** — 递归**类型别名**按 depth 硬展开 ⇒ 展开 8 层且**指数级**（6 个
自引用成员 ⇒ 54,083,943 字节的 env 模块）⇒ 末层折成 `unknown`。递归别名改成
**惰性/引用式建模**：别名登记成合成 interface（成员面照搬类型字面量），自引用点
经实例化路径落到「按名引用 + 形状待定」的 brand ⇒ 不再内联展开。同一夹具现在
5,176 字节（≈ 10,000× 更小），且互引别名（`type A = { b: B }; type B = { a: A }`）
同样被识别为递归。

**Bug 812** — 递归 interface 的自引用被铸成**空 brand**（`absBrand(name, {})`）
⇒ 那是**闭合空对象** = 「该对象确定没有这个成员」⇒ 成员读走「槽位缺失 ⇒
exact undefined」⇒ 合法代码被判「定抛 TypeError」（L2 门禁假红）。自引用改成
「按名引用 + 形状待定」（`shape: unknown`）—— 与落盘面（`emitAbs` 早已如此）
同口径 ⇒ **收割面 / 磁盘往返面 / 落盘发射面**给出同一个类型。

**Bug 813** — 泛型**类型形参默认值**从不读取 ⇒ 无参引用（`Box` 对
`interface Box<T extends string = string>`）留下**未绑定 α** ⇒ 引擎侧「未绑定
α」= 无约束值 ⇒ 其上的方法调用被建模为定抛 TypeError（假红）。现在按 TS 语义取
值：显式实参 > **默认值** > **约束** > 推断 `unknown`（不再留未绑定 α）。

⚠️ 已知残留（core 侧，本次不改）：Bug 805 的重载在**调用点**仍无法按实参类型选
arm —— Abs 的 fn 形状没有 overload 集合的承载位，收割面只能给 union 返回 ⇒
`union` 方法分派的保守性（string 分支也参与 `toFixed` 分派）仍会让
`iov.m("hello").toFixed(0)` 报 may-throw（与顶层函数路径的 Bug 827 同款残留，
core 冻结，本次不消）。
