# packages/lsp/src/__tests__/lsp-refactor.test.ts

模块套件：refactor 面（extract / inline / applyEdits / whatIf / placeholder）。 编辑结果、零附带修改与占位 range 断言逐字保留；

审计：66 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
插入点落在替换范围内部：插入文本紧贴替换文本之前（改前是垃圾源码）；合成结果与 edit 数组的顺序无关；插入点在替换范围**之后**（不相交）：位置不受影响；插入点与替换范围同起点：插入文本在替换文本之前；两个不相交的替换（既有金标口径）：逐字不变；替换范围真的重叠（部分重叠 / 交叉）：fail-closed，不产出垃圾源码	lsp-refactor 聚合矩阵	没测该层	keep	keep	—
表达式提取路径：对象字面量方法宿主 ⇒ 产物可解析、结构完整；语句序列路径：函数体内的选区 ⇒ 产物可解析、调用点接回；语句序列路径：顶层选区（插入点 == 替换起点）⇒ 产物可解析；协议面：codeAction 下发的整文件替换文本可解析	lsp-refactor 聚合矩阵	没测该层	keep	keep	—
插入点在 hashbang 之后（不是文件第 0 字节）；产物里 hashbang 仍是第 1 行（可解析、可执行）；协议面：codeAction 下发的文本第 1 行仍是 shebang	lsp-refactor 聚合矩阵	没测该层	keep	keep	—
调用点是赋值表达式，不是 const 声明；产物不再有重复声明（可解析）；协议面：codeAction 下发的文本里没有重复 const 声明；对照：原本就是声明时，调用点仍是同种声明（const）	lsp-refactor 聚合矩阵	没测该层	keep	keep	—
选区含 break：拒绝抽取（不再产出非法 JS）；协议面：含 break 的选区不再给出 refactor.extract；选区末条是 return：返回值接回调用点（外层返回值不再被丢）；对照：单条 return 的抽取仍然接回返回值（既有行为不变）	lsp-refactor 聚合矩阵	没测该层	keep	keep	—
箭头初始化式：插在整条声明之前，产物可解析；对象字面量方法：插在宿主声明之前，产物可解析；class 方法：插在宿主声明之前，产物可解析；协议面：codeAction 给箭头宿主下发的文本可解析	lsp-refactor 聚合矩阵	没测该层	keep	keep	—
插入点是语句起点（export 的列），不是 function 关键字的列；产物里 export 仍属原函数（模块公开 API 不变）；协议面：codeAction 下发的整文件替换保留 export	lsp-refactor 聚合矩阵	没测该层	keep	keep	—
名字被占用时自动改名（extracted → extracted1）；产物里不再有两个同名声明（可解析）；同一文件连续抽取两次：第二次不会撞名；协议面：action 标题带改后的名字；对照：名字没被占用时仍是 `extracted`	lsp-refactor 聚合矩阵	没测该层	keep	keep	—
@nudo:as：agent nudo/check 判绿且签名与 CLI 同款（string，非 unknown）；@nudo:replace：agent nudo/check 判绿且签名与 CLI 同款	lsp-refactor 聚合矩阵	没测该层	keep	keep	—
`export const X = …` ⇒ 不提供 Inline 动作；`export { X }` ⇒ 不提供 Inline 动作；协议面：导出绑定上 codeAction 不含 refactor.inline；对照：非导出绑定仍可内联，且 edit 集合互不重叠；语义面：改前两条 edit 重叠 ⇒ 应用后源码被毁（钉住根因形态）	lsp-refactor 聚合矩阵	没测该层	keep	keep	—
自由变量有写入 ⇒ 不提供 Inline 动作；协议面：codeAction 不含 refactor.inline；对照：自由变量**不可变**时仍可内联（门禁不误伤）；语义面：改前会把 f() 从 1 变成 2（钉住根因形态）	lsp-refactor 聚合矩阵	没测该层	keep	keep	—
删除范围只覆盖声明语句本身（不扩到整行）；edit 集合互不重叠（LSP WorkspaceEdit 合法性）；应用后：兄弟语句保留并被内联展开，副作用不再丢失；协议面：codeAction 提供的 Inline action 不含整行删除	lsp-refactor 聚合矩阵	没测该层	keep	keep	—
成员读 ⇒ 不提供 Inline 动作；协议面：codeAction 不含 refactor.inline；语义面：改前会把 getter 求值次数从 1 变成 2（钉住根因形态）；对照：非成员读的纯表达式仍可内联（门禁不误伤）	lsp-refactor 聚合矩阵	没测该层	keep	keep	—
跨行声明：改写整条声明，保留兄弟；同行声明：改写整条声明，保留兄弟；应用后：兄弟声明仍在，语法合法，运行时不再 ReferenceError；协议面：codeAction 的 inline edit 不删掉兄弟声明；语义面：改前删掉整条声明 ⇒ 语法合法但运行即 ReferenceError（钉住根因形态）	lsp-refactor 聚合矩阵	没测该层	keep	keep	—
插入文本不是 undefined（占位不是值）；应用后源码可编译，且该违规仍被报出（门禁不被 quickfix 变绿）	lsp-refactor 聚合矩阵	没测该层	keep	keep	—
toLspDiagnostic：占位 range（line 0）→ line 0（改前：-1）；toLspDiagnostic：真实 1 基行号仍按 1 基 → 0 基换算（负控制）；发布面：nudo:module-missing 落合法位置（改前：line -1）；发布面：所有诊断的 range 位置都合法（负控制：不得有 line < 0）	lsp-refactor 聚合矩阵	没测该层	keep	keep	—
"顶层 const 的类型随 binding 改变（注入后的 source 被真正分析）"	"**报告结论不成立（假阳性）**：反向钉，钉住「当前行为正确」。 报告称 `nudo.whatIf` 注入假设后类型不变（自称「Bindings applied」却类型 没变）。 断言：expect(base.content[0].text).toContain('Type of \"total\": 1');；expect(assumed.content[0].text).toContain('Type of \"total\": string');"	没测该层	keep	keep	—
target 缺失 / bindings 非数组 / binding 缺 name ⇒ isError:true；service 侧 injectBindings 也做形状校验（非数组 ⇒ 可诊断错误）	lsp-refactor 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
插入点落在替换范围内部：插入文本紧贴替换文本之前（改前是垃圾源码）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
合成结果与 edit 数组的顺序无关	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
插入点在替换范围**之后**（不相交）：位置不受影响	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
插入点与替换范围同起点：插入文本在替换文本之前	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
两个不相交的替换（既有金标口径）：逐字不变	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
替换范围真的重叠（部分重叠 / 交叉）：fail-closed，不产出垃圾源码	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
表达式提取路径：对象字面量方法宿主 ⇒ 产物可解析、结构完整	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
语句序列路径：函数体内的选区 ⇒ 产物可解析、调用点接回	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
语句序列路径：顶层选区（插入点 == 替换起点）⇒ 产物可解析	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
协议面：codeAction 下发的整文件替换文本可解析	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
插入点在 hashbang 之后（不是文件第 0 字节）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
产物里 hashbang 仍是第 1 行（可解析、可执行）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
协议面：codeAction 下发的文本第 1 行仍是 shebang	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
调用点是赋值表达式，不是 const 声明	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
产物不再有重复声明（可解析）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
协议面：codeAction 下发的文本里没有重复 const 声明	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
对照：原本就是声明时，调用点仍是同种声明（const）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
选区含 break：拒绝抽取（不再产出非法 JS）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
协议面：含 break 的选区不再给出 refactor.extract	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
选区末条是 return：返回值接回调用点（外层返回值不再被丢）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
对照：单条 return 的抽取仍然接回返回值（既有行为不变）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
箭头初始化式：插在整条声明之前，产物可解析	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
对象字面量方法：插在宿主声明之前，产物可解析	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
class 方法：插在宿主声明之前，产物可解析	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
协议面：codeAction 给箭头宿主下发的文本可解析	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
插入点是语句起点（export 的列），不是 function 关键字的列	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
产物里 export 仍属原函数（模块公开 API 不变）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
协议面：codeAction 下发的整文件替换保留 export	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
名字被占用时自动改名（extracted → extracted1）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
产物里不再有两个同名声明（可解析）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
同一文件连续抽取两次：第二次不会撞名	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
协议面：action 标题带改后的名字	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
对照：名字没被占用时仍是 `extracted`	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
@nudo:as：agent nudo/check 判绿且签名与 CLI 同款（string，非 unknown）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
@nudo:replace：agent nudo/check 判绿且签名与 CLI 同款	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
`export const X = …` ⇒ 不提供 Inline 动作	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
`export { X }` ⇒ 不提供 Inline 动作	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
协议面：导出绑定上 codeAction 不含 refactor.inline	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
对照：非导出绑定仍可内联，且 edit 集合互不重叠	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
语义面：改前两条 edit 重叠 ⇒ 应用后源码被毁（钉住根因形态）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
自由变量有写入 ⇒ 不提供 Inline 动作	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
协议面：codeAction 不含 refactor.inline	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
对照：自由变量**不可变**时仍可内联（门禁不误伤）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
语义面：改前会把 f() 从 1 变成 2（钉住根因形态）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
删除范围只覆盖声明语句本身（不扩到整行）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
edit 集合互不重叠（LSP WorkspaceEdit 合法性）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
应用后：兄弟语句保留并被内联展开，副作用不再丢失	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
协议面：codeAction 提供的 Inline action 不含整行删除	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
成员读 ⇒ 不提供 Inline 动作	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
语义面：改前会把 getter 求值次数从 1 变成 2（钉住根因形态）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
对照：非成员读的纯表达式仍可内联（门禁不误伤）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
跨行声明：改写整条声明，保留兄弟	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
同行声明：改写整条声明，保留兄弟	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
应用后：兄弟声明仍在，语法合法，运行时不再 ReferenceError	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
协议面：codeAction 的 inline edit 不删掉兄弟声明	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
语义面：改前删掉整条声明 ⇒ 语法合法但运行即 ReferenceError（钉住根因形态）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
插入文本不是 undefined（占位不是值）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
应用后源码可编译，且该违规仍被报出（门禁不被 quickfix 变绿）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
toLspDiagnostic：占位 range（line 0）→ line 0（改前：-1）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
toLspDiagnostic：真实 1 基行号仍按 1 基 → 0 基换算（负控制）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
发布面：nudo:module-missing 落合法位置（改前：line -1）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
发布面：所有诊断的 range 位置都合法（负控制：不得有 line < 0）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
target 缺失 / bindings 非数组 / binding 缺 name ⇒ isError:true	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
service 侧 injectBindings 也做形状校验（非数组 ⇒ 可诊断错误）	dup:lsp-refactor 聚合矩阵	commit:d25e91ca
```
