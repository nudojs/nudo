# packages/core/src/__tests__/strip-types.test.ts

模块套件：TypeScript strip 面（enum/装饰器/类型导入/参数属性/注释携带）。

审计：51 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
派生类：赋值在 super(...) 之后（改前：super 在后 ⇒ ReferenceError）；派生类：`new Point(1)` 不抛 ReferenceError 且字段已赋值；派生类：super(...) 之后的其它语句仍在赋值之后（tsc emit 口径）；非派生类：行为不变（赋值仍在构造器体开头）；派生类构造器体顶层没有 super(...) ⇒ 保守不改相对顺序 + 回报事实	strip-types 聚合矩阵	没测该层	keep	keep	—
数值 enum：`B = A * 10` 的 A 变成 E["A"]（不再是未绑定全局）；同一 enum 的自动递增成员仍用 E["B"] + 1（两种口径一致）；混合 enum：`C = A + 5` 的 A 也改写成 E["A"]；字符串 enum：`B = A + 'b'` 的 A 改写成 E["A"]，且**不**建反向映射；const enum：`B = A * 3` 同样改写成 E["A"]；剥除事实回报：enumComputedMemberRewritten 只	strip-types 聚合矩阵	没测该层	keep	keep	—
绑定只在类型位置被用到 ⇒ 整条 import 消失（产物可加载）；绑定在值位置被用到 ⇒ import 保留；混用：type specifier 被剔除、值 specifier 保留；显式 import type 整条删除（既有行为）；裸 import（副作用）保留；typeof 类型查询是类型位置 ⇒ import 同样被消掉（tsc 同口径）；本地再导出（export { X }）判不准 ⇒ 保守保留 import；export { X } from "m" 的 X 是	strip-types 聚合矩阵	没测该层	keep	keep	—
export = X（TSExportAssignment）整条删除；export as namespace X（TSNamespaceExportDeclaration）整条删除；export = 的右值（值引用）不产生残留语句；纯 JS 源码不受影响（结构性 no-op）	strip-types 聚合矩阵	没测该层	keep	keep	—
x!: number 的 definite 被删；y?: string 的 optional 被删；m?(): void {} 的 optional 被删（ClassMethod 同块）；私有成员同理（#x! / #y?）；表达式节点的 optional（a?.b）不受影响；形参的 optional（a?: T）仍被删（既有行为）	strip-types 聚合矩阵	没测该层	keep	keep	—
function f(this: T, a) ⇒ 只剩 a；this 是唯一的形参 ⇒ 形参表为空；函数表达式同理；普通形参不受影响（this 之外的名字保留）；函数体里的 this 表达式保留（只有形参位删）	strip-types 聚合矩阵	没测该层	keep	keep	—
enum 声明不再被删除 ⇒ 变成一个 var 声明；成员引用可求值 ⇒ f() => 1（不再是 never / ReferenceError）；反向映射可求值（E[1] === "A"）；自动递增（A=1 ⇒ B=2 ⇒ C=3）；字符串枚举：值正确、无反向映射（E["a"] 不存在）；混合枚举：数值成员有反向映射、字符串成员没有；declare enum（环境声明）仍然整条删除；enum 声明上的文件级指令随合成节点一起活下来（Bug 968 联动）	strip-types 聚合矩阵	没测该层	keep	keep	—
指令挂在被删的 import type 上 ⇒ 转挂给下一个幸存语句；指令在幸存语句上（对照）⇒ 位置不变；剥除前后指令条数一致（兜底自检：directivesBefore === directivesAfter）；全部文件级指令形态都走同一条转挂路径（@nudo:env / @nudo:mock-module）；被删语句在末尾 ⇒ 指令挂到最后一个幸存节点的尾部（不丢）；无指令的源码 ⇒ 前后条数都是 0	strip-types 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
派生类：赋值在 super(...) 之后（改前：super 在后 ⇒ ReferenceError）	dup:strip-types 聚合矩阵	commit:a0b08363
派生类：`new Point(1)` 不抛 ReferenceError 且字段已赋值	dup:strip-types 聚合矩阵	commit:a0b08363
派生类：super(...) 之后的其它语句仍在赋值之后（tsc emit 口径）	dup:strip-types 聚合矩阵	commit:a0b08363
非派生类：行为不变（赋值仍在构造器体开头）	dup:strip-types 聚合矩阵	commit:a0b08363
派生类构造器体顶层没有 super(...) ⇒ 保守不改相对顺序 + 回报事实	dup:strip-types 聚合矩阵	commit:a0b08363
数值 enum：`B = A * 10` 的 A 变成 E["A"]（不再是未绑定全局）	dup:strip-types 聚合矩阵	commit:a0b08363
同一 enum 的自动递增成员仍用 E["B"] + 1（两种口径一致）	dup:strip-types 聚合矩阵	commit:a0b08363
混合 enum：`C = A + 5` 的 A 也改写成 E["A"]	dup:strip-types 聚合矩阵	commit:a0b08363
字符串 enum：`B = A + 'b'` 的 A 改写成 E["A"]，且**不**建反向映射	dup:strip-types 聚合矩阵	commit:a0b08363
const enum：`B = A * 3` 同样改写成 E["A"]	dup:strip-types 聚合矩阵	commit:a0b08363
剥除事实回报：enumComputedMemberRewritten 只在有计算成员时为真	dup:strip-types 聚合矩阵	commit:a0b08363
绑定只在类型位置被用到 ⇒ 整条 import 消失（产物可加载）	dup:strip-types 聚合矩阵	commit:a0b08363
绑定在值位置被用到 ⇒ import 保留	dup:strip-types 聚合矩阵	commit:a0b08363
混用：type specifier 被剔除、值 specifier 保留	dup:strip-types 聚合矩阵	commit:a0b08363
显式 import type 整条删除（既有行为）	dup:strip-types 聚合矩阵	commit:a0b08363
裸 import（副作用）保留	dup:strip-types 聚合矩阵	commit:a0b08363
typeof 类型查询是类型位置 ⇒ import 同样被消掉（tsc 同口径）	dup:strip-types 聚合矩阵	commit:a0b08363
本地再导出（export { X }）判不准 ⇒ 保守保留 import	dup:strip-types 聚合矩阵	commit:a0b08363
export { X } from "m" 的 X 是源模块的绑定 ⇒ 本地 import 判为「没被引用」⇒ 保守保留	dup:strip-types 聚合矩阵	commit:a0b08363
包说明符的 import 一律保留（nudo 不剥除包 ⇒ 不动）	dup:strip-types 聚合矩阵	commit:a0b08363
类 heritage 的基类是值引用 ⇒ import 保留	dup:strip-types 聚合矩阵	commit:a0b08363
接口的 extends 是类型位置 ⇒ import 被消掉（tsc 同口径）	dup:strip-types 聚合矩阵	commit:a0b08363
export = X（TSExportAssignment）整条删除	dup:strip-types 聚合矩阵	commit:a0b08363
export as namespace X（TSNamespaceExportDeclaration）整条删除	dup:strip-types 聚合矩阵	commit:a0b08363
export = 的右值（值引用）不产生残留语句	dup:strip-types 聚合矩阵	commit:a0b08363
纯 JS 源码不受影响（结构性 no-op）	dup:strip-types 聚合矩阵	commit:a0b08363
x!: number 的 definite 被删	dup:strip-types 聚合矩阵	commit:a0b08363
y?: string 的 optional 被删	dup:strip-types 聚合矩阵	commit:a0b08363
m?(): void {} 的 optional 被删（ClassMethod 同块）	dup:strip-types 聚合矩阵	commit:a0b08363
私有成员同理（#x! / #y?）	dup:strip-types 聚合矩阵	commit:a0b08363
表达式节点的 optional（a?.b）不受影响	dup:strip-types 聚合矩阵	commit:a0b08363
形参的 optional（a?: T）仍被删（既有行为）	dup:strip-types 聚合矩阵	commit:a0b08363
function f(this: T, a) ⇒ 只剩 a	dup:strip-types 聚合矩阵	commit:a0b08363
this 是唯一的形参 ⇒ 形参表为空	dup:strip-types 聚合矩阵	commit:a0b08363
函数表达式同理	dup:strip-types 聚合矩阵	commit:a0b08363
普通形参不受影响（this 之外的名字保留）	dup:strip-types 聚合矩阵	commit:a0b08363
函数体里的 this 表达式保留（只有形参位删）	dup:strip-types 聚合矩阵	commit:a0b08363
enum 声明不再被删除 ⇒ 变成一个 var 声明	dup:strip-types 聚合矩阵	commit:a0b08363
成员引用可求值 ⇒ f() => 1（不再是 never / ReferenceError）	dup:strip-types 聚合矩阵	commit:a0b08363
反向映射可求值（E[1] === "A"）	dup:strip-types 聚合矩阵	commit:a0b08363
自动递增（A=1 ⇒ B=2 ⇒ C=3）	dup:strip-types 聚合矩阵	commit:a0b08363
字符串枚举：值正确、无反向映射（E["a"] 不存在）	dup:strip-types 聚合矩阵	commit:a0b08363
混合枚举：数值成员有反向映射、字符串成员没有	dup:strip-types 聚合矩阵	commit:a0b08363
declare enum（环境声明）仍然整条删除	dup:strip-types 聚合矩阵	commit:a0b08363
enum 声明上的文件级指令随合成节点一起活下来（Bug 968 联动）	dup:strip-types 聚合矩阵	commit:a0b08363
指令挂在被删的 import type 上 ⇒ 转挂给下一个幸存语句	dup:strip-types 聚合矩阵	commit:a0b08363
指令在幸存语句上（对照）⇒ 位置不变	dup:strip-types 聚合矩阵	commit:a0b08363
剥除前后指令条数一致（兜底自检：directivesBefore === directivesAfter）	dup:strip-types 聚合矩阵	commit:a0b08363
全部文件级指令形态都走同一条转挂路径（@nudo:env / @nudo:mock-module）	dup:strip-types 聚合矩阵	commit:a0b08363
被删语句在末尾 ⇒ 指令挂到最后一个幸存节点的尾部（不丢）	dup:strip-types 聚合矩阵	commit:a0b08363
无指令的源码 ⇒ 前后条数都是 0	dup:strip-types 聚合矩阵	commit:a0b08363
```
