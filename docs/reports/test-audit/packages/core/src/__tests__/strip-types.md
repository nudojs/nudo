# packages/core/src/__tests__/strip-types.test.ts

模块套件：51 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"派生类：赋值在 super(...) 之后（改前：super 在后 ⇒ ReferenceError）"	"遇到未知形态**直接抛** ⇒ 不会把「印不出来」静默当成「印对了」。"	夹具漏形态	keep	keep	—
"派生类：`new Point(1)` 不抛 ReferenceError 且字段已赋值"	"遇到未知形态**直接抛** ⇒ 不会把「印不出来」静默当成「印对了」。"	夹具漏形态	keep	keep	—
"派生类：super(...) 之后的其它语句仍在赋值之后（tsc emit 口径）"	"遇到未知形态**直接抛** ⇒ 不会把「印不出来」静默当成「印对了」。"	夹具漏形态	keep	keep	—
"非派生类：行为不变（赋值仍在构造器体开头）"	"遇到未知形态**直接抛** ⇒ 不会把「印不出来」静默当成「印对了」。"	夹具漏形态	keep	keep	—
"派生类构造器体顶层没有 super(...) ⇒ 保守不改相对顺序 + 回报事实"	"遇到未知形态**直接抛** ⇒ 不会把「印不出来」静默当成「印对了」。"	夹具漏形态	keep	keep	—
"数值 enum：`B = A * 10` 的 A 变成 E[\"A\"]（不再是未绑定全局）"	"反向闸：产物里不得再有裸 `A`（正是运行期 ReferenceError 的来源） 字符串成员取右侧"	夹具漏形态	keep	keep	—
"同一 enum 的自动递增成员仍用 E[\"B\"] + 1（两种口径一致）"	"字符串成员取右侧"	夹具漏形态	keep	keep	—
"混合 enum：`C = A + 5` 的 A 也改写成 E[\"A\"]"	"字符串成员取右侧"	夹具漏形态	keep	keep	—
"字符串 enum：`B = A + 'b'` 的 A 改写成 E[\"A\"]，且**不**建反向映射"	"字符串成员：`E[\"B\"] = …`（left 是 MemberExpression，property 不是赋值） 右侧的 A 已改写成 E[\"A\"] 字符串成员取右侧"	夹具漏形态	keep	keep	—
"const enum：`B = A * 3` 同样改写成 E[\"A\"]"	"字符串成员取右侧"	夹具漏形态	keep	keep	—
"剥除事实回报：enumComputedMemberRewritten 只在有计算成员时为真"	"字符串成员取右侧"	夹具漏形态	keep	keep	—
"绑定只在类型位置被用到 ⇒ 整条 import 消失（产物可加载）"	"值位置的「类型专用导入」未消除 ⇒ 产物 Node 加载不了。 根因：strip-types.ts 的 import 判定只看**语法标记**（importKind === \"type\"）， 不看「绑定是否只在类型位置被使用」。"	没测该层	keep	keep	—
"绑定在值位置被用到 ⇒ import 保留"	"值位置的「类型专用导入」未消除 ⇒ 产物 Node 加载不了。 根因：strip-types.ts 的 import 判定只看**语法标记**（importKind === \"type\"）， 不看「绑定是否只在类型位置被使用」。"	没测该层	keep	keep	—
"混用：type specifier 被剔除、值 specifier 保留"	"值位置的「类型专用导入」未消除 ⇒ 产物 Node 加载不了。 根因：strip-types.ts 的 import 判定只看**语法标记**（importKind === \"type\"）， 不看「绑定是否只在类型位置被使用」。"	没测该层	keep	keep	—
"显式 import type 整条删除（既有行为）"	"值位置的「类型专用导入」未消除 ⇒ 产物 Node 加载不了。 根因：strip-types.ts 的 import 判定只看**语法标记**（importKind === \"type\"）， 不看「绑定是否只在类型位置被使用」。"	没测该层	keep	keep	—
"裸 import（副作用）保留"	"值位置的「类型专用导入」未消除 ⇒ 产物 Node 加载不了。 根因：strip-types.ts 的 import 判定只看**语法标记**（importKind === \"type\"）， 不看「绑定是否只在类型位置被使用」。"	没测该层	keep	keep	—
"typeof 类型查询是类型位置 ⇒ import 同样被消掉（tsc 同口径）"	"值位置的「类型专用导入」未消除 ⇒ 产物 Node 加载不了。 根因：strip-types.ts 的 import 判定只看**语法标记**（importKind === \"type\"）， 不看「绑定是否只在类型位置被使用」。"	没测该层	keep	keep	—
"本地再导出（export { X }）判不准 ⇒ 保守保留 import"	"值位置的「类型专用导入」未消除 ⇒ 产物 Node 加载不了。 根因：strip-types.ts 的 import 判定只看**语法标记**（importKind === \"type\"）， 不看「绑定是否只在类型位置被使用」。"	没测该层	keep	keep	—
"export { X } from \"m\" 的 X 是源模块的绑定 ⇒ 本地 import 判为「没被引用」⇒ 保守保留"	"保守口径：绑定**根本没被引用**（既不在值位置也不在类型位置）的本地 import **保留**（tsc 会消掉它，但那是「产物更干净」而不是「产物可用」）。 值位置的「类型专用导入」未消除 ⇒ 产物 Node 加载不了。 根因：strip-types.ts 的 import 判定只看**语法标记**（importKind === \"type\"）， 不看「绑定是否只在类型位置被使用」。"	没测该层	keep	keep	—
"包说明符的 import 一律保留（nudo 不剥除包 ⇒ 不动）"	"值位置的「类型专用导入」未消除 ⇒ 产物 Node 加载不了。 根因：strip-types.ts 的 import 判定只看**语法标记**（importKind === \"type\"）， 不看「绑定是否只在类型位置被使用」。"	没测该层	keep	keep	—
"类 heritage 的基类是值引用 ⇒ import 保留"	"值位置的「类型专用导入」未消除 ⇒ 产物 Node 加载不了。 根因：strip-types.ts 的 import 判定只看**语法标记**（importKind === \"type\"）， 不看「绑定是否只在类型位置被使用」。"	没测该层	keep	keep	—
"接口的 extends 是类型位置 ⇒ import 被消掉（tsc 同口径）"	"值位置的「类型专用导入」未消除 ⇒ 产物 Node 加载不了。 根因：strip-types.ts 的 import 判定只看**语法标记**（importKind === \"type\"）， 不看「绑定是否只在类型位置被使用」。"	没测该层	keep	keep	—
"export = X（TSExportAssignment）整条删除"	"TS-only 的 `export =` / `export as namespace` 未剥 ⇒ 产物不是合法 JS。 根因：strip-types.ts 的 `isTypeOnlyStatement` 语句级 switch 缺 `TSExportAssignment` / `TSNamespaceExportDeclaration` 两个 case ⇒ 这两条 TS-only 语句被原样打印进 `.js` ⇒ `node --check` ⇒ SyntaxError。"	没测该层	keep	keep	—
"export as namespace X（TSNamespaceExportDeclaration）整条删除"	"TS-only 的 `export =` / `export as namespace` 未剥 ⇒ 产物不是合法 JS。 根因：strip-types.ts 的 `isTypeOnlyStatement` 语句级 switch 缺 `TSExportAssignment` / `TSNamespaceExportDeclaration` 两个 case ⇒ 这两条 TS-only 语句被原样打印进 `.js` ⇒ `node --check` ⇒ SyntaxError。"	没测该层	keep	keep	—
"export = 的右值（值引用）不产生残留语句"	"TS-only 的 `export =` / `export as namespace` 未剥 ⇒ 产物不是合法 JS。 根因：strip-types.ts 的 `isTypeOnlyStatement` 语句级 switch 缺 `TSExportAssignment` / `TSNamespaceExportDeclaration` 两个 case ⇒ 这两条 TS-only 语句被原样打印进 `.js` ⇒ `node --check` ⇒ SyntaxError。"	没测该层	keep	keep	—
"纯 JS 源码不受影响（结构性 no-op）"	"TS-only 的 `export =` / `export as namespace` 未剥 ⇒ 产物不是合法 JS。 根因：strip-types.ts 的 `isTypeOnlyStatement` 语句级 switch 缺 `TSExportAssignment` / `TSNamespaceExportDeclaration` 两个 case ⇒ 这两条 TS-only 语句被原样打印进 `.js` ⇒ `node --check` ⇒ SyntaxError。"	没测该层	keep	keep	—
"x!: number 的 definite 被删"	"类成员的 `x!`（确定赋值断言）/ `y?`（可选属性）/ `m?()`（可选方法） 未剥 ⇒ 产物不是合法 JS（`node --check` ⇒ SyntaxError: Unexpected token '!' / '?'）。 根因：strip-types.ts 的 `deleteTypeSyntaxFields` 里 - `definite`（Babel 的 ClassProperty.definite）**根本没有**删除逻辑；"	没测该层	keep	keep	—
"y?: string 的 optional 被删"	"类成员的 `x!`（确定赋值断言）/ `y?`（可选属性）/ `m?()`（可选方法） 未剥 ⇒ 产物不是合法 JS（`node --check` ⇒ SyntaxError: Unexpected token '!' / '?'）。 根因：strip-types.ts 的 `deleteTypeSyntaxFields` 里 - `definite`（Babel 的 ClassProperty.definite）**根本没有**删除逻辑；"	没测该层	keep	keep	—
"m?(): void {} 的 optional 被删（ClassMethod 同块）"	"类成员的 `x!`（确定赋值断言）/ `y?`（可选属性）/ `m?()`（可选方法） 未剥 ⇒ 产物不是合法 JS（`node --check` ⇒ SyntaxError: Unexpected token '!' / '?'）。 根因：strip-types.ts 的 `deleteTypeSyntaxFields` 里 - `definite`（Babel 的 ClassProperty.definite）**根本没有**删除逻辑；"	没测该层	keep	keep	—
"私有成员同理（#x! / #y?）"	"类成员的 `x!`（确定赋值断言）/ `y?`（可选属性）/ `m?()`（可选方法） 未剥 ⇒ 产物不是合法 JS（`node --check` ⇒ SyntaxError: Unexpected token '!' / '?'）。 根因：strip-types.ts 的 `deleteTypeSyntaxFields` 里 - `definite`（Babel 的 ClassProperty.definite）**根本没有**删除逻辑；"	没测该层	keep	keep	—
"表达式节点的 optional（a?.b）不受影响"	"类成员的 `x!`（确定赋值断言）/ `y?`（可选属性）/ `m?()`（可选方法） 未剥 ⇒ 产物不是合法 JS（`node --check` ⇒ SyntaxError: Unexpected token '!' / '?'）。 根因：strip-types.ts 的 `deleteTypeSyntaxFields` 里 - `definite`（Babel 的 ClassProperty.definite）**根本没有**删除逻辑；"	没测该层	keep	keep	—
"形参的 optional（a?: T）仍被删（既有行为）"	"类成员的 `x!`（确定赋值断言）/ `y?`（可选属性）/ `m?()`（可选方法） 未剥 ⇒ 产物不是合法 JS（`node --check` ⇒ SyntaxError: Unexpected token '!' / '?'）。 根因：strip-types.ts 的 `deleteTypeSyntaxFields` 里 - `definite`（Babel 的 ClassProperty.definite）**根本没有**删除逻辑；"	没测该层	keep	keep	—
"function f(this: T, a) ⇒ 只剩 a"	"TS 的 `this` 形参未剥 ⇒ 产物 `function f(this, a)` Node 加载不了。 根因：Babel 把 TS 的 `this` 形参表示成**一个名叫 `this` 的 `Identifier`**， 而 strip-types.ts 的 `deleteTypeSyntaxFields` 只删它的 `typeAnnotation` ⇒ 打印出来是 `function f(this, a)`；"	没测该层	keep	keep	—
"this 是唯一的形参 ⇒ 形参表为空"	"TS 的 `this` 形参未剥 ⇒ 产物 `function f(this, a)` Node 加载不了。 根因：Babel 把 TS 的 `this` 形参表示成**一个名叫 `this` 的 `Identifier`**， 而 strip-types.ts 的 `deleteTypeSyntaxFields` 只删它的 `typeAnnotation` ⇒ 打印出来是 `function f(this, a)`；"	没测该层	keep	keep	—
"函数表达式同理"	"TS 的 `this` 形参未剥 ⇒ 产物 `function f(this, a)` Node 加载不了。 根因：Babel 把 TS 的 `this` 形参表示成**一个名叫 `this` 的 `Identifier`**， 而 strip-types.ts 的 `deleteTypeSyntaxFields` 只删它的 `typeAnnotation` ⇒ 打印出来是 `function f(this, a)`；"	没测该层	keep	keep	—
"普通形参不受影响（this 之外的名字保留）"	"TS 的 `this` 形参未剥 ⇒ 产物 `function f(this, a)` Node 加载不了。 根因：Babel 把 TS 的 `this` 形参表示成**一个名叫 `this` 的 `Identifier`**， 而 strip-types.ts 的 `deleteTypeSyntaxFields` 只删它的 `typeAnnotation` ⇒ 打印出来是 `function f(this, a)`；"	没测该层	keep	keep	—
"函数体里的 this 表达式保留（只有形参位删）"	"TS 的 `this` 形参未剥 ⇒ 产物 `function f(this, a)` Node 加载不了。 根因：Babel 把 TS 的 `this` 形参表示成**一个名叫 `this` 的 `Identifier`**， 而 strip-types.ts 的 `deleteTypeSyntaxFields` 只删它的 `typeAnnotation` ⇒ 打印出来是 `function f(this, a)`；"	没测该层	keep	keep	—
"enum 声明不再被删除 ⇒ 变成一个 var 声明"	"TS 的 `enum` 被整段删除 ⇒ 成员引用退化成未绑定全局读取 ⇒ 门禁 error 级 `nudo:entry-may-throw`（假红）+ dts / zod / standard / guard 四个产物面把返回类型落成 `never`。 根因：strip-types.ts 的 `isTypeOnlyStatement` 把 `TSEnumDeclaration` 整条 删除 ⇒ 模块里不再有 `E` 这个绑定。"	没测该层	keep	keep	—
"成员引用可求值 ⇒ f() => 1（不再是 never / ReferenceError）"	"TS 的 `enum` 被整段删除 ⇒ 成员引用退化成未绑定全局读取 ⇒ 门禁 error 级 `nudo:entry-may-throw`（假红）+ dts / zod / standard / guard 四个产物面把返回类型落成 `never`。 根因：strip-types.ts 的 `isTypeOnlyStatement` 把 `TSEnumDeclaration` 整条 删除 ⇒ 模块里不再有 `E` 这个绑定。"	没测该层	keep	keep	—
"反向映射可求值（E[1] === \"A\"）"	"TS 的 `enum` 被整段删除 ⇒ 成员引用退化成未绑定全局读取 ⇒ 门禁 error 级 `nudo:entry-may-throw`（假红）+ dts / zod / standard / guard 四个产物面把返回类型落成 `never`。 根因：strip-types.ts 的 `isTypeOnlyStatement` 把 `TSEnumDeclaration` 整条 删除 ⇒ 模块里不再有 `E` 这个绑定。"	没测该层	keep	keep	—
"自动递增（A=1 ⇒ B=2 ⇒ C=3）"	"TS 的 `enum` 被整段删除 ⇒ 成员引用退化成未绑定全局读取 ⇒ 门禁 error 级 `nudo:entry-may-throw`（假红）+ dts / zod / standard / guard 四个产物面把返回类型落成 `never`。 根因：strip-types.ts 的 `isTypeOnlyStatement` 把 `TSEnumDeclaration` 整条 删除 ⇒ 模块里不再有 `E` 这个绑定。"	没测该层	keep	keep	—
"字符串枚举：值正确、无反向映射（E[\"a\"] 不存在）"	"TS 的 `enum` 被整段删除 ⇒ 成员引用退化成未绑定全局读取 ⇒ 门禁 error 级 `nudo:entry-may-throw`（假红）+ dts / zod / standard / guard 四个产物面把返回类型落成 `never`。 根因：strip-types.ts 的 `isTypeOnlyStatement` 把 `TSEnumDeclaration` 整条 删除 ⇒ 模块里不再有 `E` 这个绑定。"	没测该层	keep	keep	—
"混合枚举：数值成员有反向映射、字符串成员没有"	"TS 的 `enum` 被整段删除 ⇒ 成员引用退化成未绑定全局读取 ⇒ 门禁 error 级 `nudo:entry-may-throw`（假红）+ dts / zod / standard / guard 四个产物面把返回类型落成 `never`。 根因：strip-types.ts 的 `isTypeOnlyStatement` 把 `TSEnumDeclaration` 整条 删除 ⇒ 模块里不再有 `E` 这个绑定。"	没测该层	keep	keep	—
"declare enum（环境声明）仍然整条删除"	"TS 的 `enum` 被整段删除 ⇒ 成员引用退化成未绑定全局读取 ⇒ 门禁 error 级 `nudo:entry-may-throw`（假红）+ dts / zod / standard / guard 四个产物面把返回类型落成 `never`。 根因：strip-types.ts 的 `isTypeOnlyStatement` 把 `TSEnumDeclaration` 整条 删除 ⇒ 模块里不再有 `E` 这个绑定。"	没测该层	keep	keep	—
"enum 声明上的文件级指令随合成节点一起活下来（Bug 968 联动）"	"TS 的 `enum` 被整段删除 ⇒ 成员引用退化成未绑定全局读取 ⇒ 门禁 error 级 `nudo:entry-may-throw`（假红）+ dts / zod / standard / guard 四个产物面把返回类型落成 `never`。 根因：strip-types.ts 的 `isTypeOnlyStatement` 把 `TSEnumDeclaration` 整条 删除 ⇒ 模块里不再有 `E` 这个绑定。"	没测该层	keep	keep	—
"指令挂在被删的 import type 上 ⇒ 转挂给下一个幸存语句"	"挂在「将被删除的语句」上的文件级指令被静默丢掉 ⇒ 门禁红 → 绿 （假绿）。 根因：Babel 把文件级 `///` 指令挂成**下一条语句**的 `leadingComments`；"	没测该层	keep	keep	—
"指令在幸存语句上（对照）⇒ 位置不变"	"挂在「将被删除的语句」上的文件级指令被静默丢掉 ⇒ 门禁红 → 绿 （假绿）。 根因：Babel 把文件级 `///` 指令挂成**下一条语句**的 `leadingComments`；"	没测该层	keep	keep	—
"剥除前后指令条数一致（兜底自检：directivesBefore === directivesAfter）"	"挂在「将被删除的语句」上的文件级指令被静默丢掉 ⇒ 门禁红 → 绿 （假绿）。 根因：Babel 把文件级 `///` 指令挂成**下一条语句**的 `leadingComments`；"	没测该层	keep	keep	—
"全部文件级指令形态都走同一条转挂路径（@nudo:env / @nudo:mock-module）"	"挂在「将被删除的语句」上的文件级指令被静默丢掉 ⇒ 门禁红 → 绿 （假绿）。 根因：Babel 把文件级 `///` 指令挂成**下一条语句**的 `leadingComments`；"	没测该层	keep	keep	—
"被删语句在末尾 ⇒ 指令挂到最后一个幸存节点的尾部（不丢）"	"挂在「将被删除的语句」上的文件级指令被静默丢掉 ⇒ 门禁红 → 绿 （假绿）。 根因：Babel 把文件级 `///` 指令挂成**下一条语句**的 `leadingComments`；"	没测该层	keep	keep	—
"无指令的源码 ⇒ 前后条数都是 0"	"挂在「将被删除的语句」上的文件级指令被静默丢掉 ⇒ 门禁红 → 绿 （假绿）。 根因：Babel 把文件级 `///` 指令挂成**下一条语句**的 `leadingComments`；"	没测该层	keep	keep	—
```
