# packages/lsp/src/__tests__/lsp-navigation.test.ts

模块套件：LSP 导航面（definition / references / rename）。 别名、遮蔽、再导出、sidecar、简写与跨文件重命名的编辑结果与零附带修改 断言按场景归并；

审计：71 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
纯函数面：无关对象的同名成员访问不进改名集合；纯函数面：对象字面量的方法键是定义位，且同源成员访问进集合；纯函数面：同名但不同类不合并（显式归属时）；协议面（真 server）：归属歧义 ⇒ **拒绝改名**（不产出任何编辑，代码不被改坏）；纯函数面：归属歧义可被检出（歧义 ⇒ 拒绝；无歧义 ⇒ 可改）；协议面（真 server）：改对象字面量的方法 ⇒ key 与同源成员访问一起改；协议面（真 server）：对象字面量的函数值属性 `{ m: fn }` 的 key 也是	lsp-navigation 聚合矩阵	没测该层	keep	keep	—
rename @ importer 用点位 ⇒ 改导出名 + importer 的 imported 侧，**不动** hidden 的声明；rename @ 导出名位 ⇒ 同样改导出名 + importer 的 imported 侧（改前是 null）；rename @ 本地名位 ⇒ 改本地名（声明 + 导出说明符本地侧），**不连坐** importer；导出名位不再死位：definition / references / prepareRename 都有身份	lsp-navigation 聚合矩阵	没测该层	keep	keep	—
在别名用法处改名：只改 importer 的本地侧 + 用法处；在 import 说明符的 local 侧改名：同样零连坐（导出方与其它 importer 不动）；反向：从导出方改导出名 ⇒ 改导出方 + 各 importer 的 imported 侧，别名不动	lsp-navigation 聚合矩阵	没测该层	keep	keep	—
重命名形参声明位：编辑集只有形参声明 + 形参引用，顶层零编辑；重命名形参体内的引用位：同样不连坐顶层变量；反向：重命名顶层变量：只改顶层那处，形参零编辑（两个方向对称）；definition / references 走作用域：形参只认形参那一处绑定	lsp-navigation 聚合矩阵	没测该层	keep	keep	—
definition / references / rename 对同一符号同口径（含侧车契约绑定）；落盘后契约仍在生效（L1 违约诊断不因改名静默消失）；负控制：没有侧车时 references / rename 只碰源码文件	lsp-navigation 聚合矩阵	没测该层	keep	keep	—
从 re-export 位置发起 references 覆盖目标模块的定义与内部引用；从目标模块的定义处发起 references 覆盖 re-export 位点；从 re-export 位置发起 rename 同步改目标模块	lsp-navigation 聚合矩阵	没测该层	keep	keep	—
改导出名时：imported 侧被改、别名不被改；改本地别名时：只改本地，不得连坐改目标模块的导出	lsp-navigation 聚合矩阵	没测该层	keep	keep	—
非法标识符 ⇒ 不产出任何编辑；空名 ⇒ 不产出任何编辑；保留字 ⇒ 不产出任何编辑；合法新名 ⇒ 仍然正常改名（不得误伤）；合法但非常规的标识符（$ / _ / Unicode）⇒ 仍然放行	lsp-navigation 聚合矩阵	没测该层	keep	keep	—
collectBindingReferences：导出绑定的 referencePaths 只收标识符（语句节点不进）；buildRenameEdits：宽于单个标识符的编辑被挡掉（语句级目标）；buildRenameEdits：重叠的编辑只留窄的一条（协议合法性兜底）；协议面：rename 导出绑定只产出标识符编辑，且无重叠	lsp-navigation 聚合矩阵	没测该层	keep	keep	—
collectBindingReferences：简写属性的引用位带上 key 元数据；buildRenameEdits：简写属性的编辑文本是 `x: <新名>`；解构模式的简写属性同样保留 key（`function f({ x })` → `{ x: y }`）；协议面：rename 简写属性产出 `x: y`，key 不被改掉	lsp-navigation 聚合矩阵	没测该层	keep	keep	—
未被命名空间引用的导出，其 references 不含命名空间导入方；命名空间成员访问 `ns.beta` 是 beta 的引用位点	lsp-navigation 聚合矩阵	没测该层	keep	keep	—
纯函数面：方法面能收齐类方法键 + 同源成员访问；协议面（真 server）：references @ 类方法键 ⇒ 至少 1 条引用（k.m(1)）；协议面（真 server）：definition @ k.m(1) ⇒ 跳到类里的方法键；协议面（真 server）：references 的 includeDeclaration=false 只剩使用位；负控制：普通变量的 references 通道不受影响	lsp-navigation 聚合矩阵	没测该层	keep	keep	—
类方法形参：definition ⇒ 形参声明位（改前是 null）；对象方法形参：definition ⇒ 形参声明位（改前是 null）；catch 形参：definition ⇒ 形参声明位（改前是 null）；同一坐标：definition 与 references 的声明位**一致**（不再自相矛盾）；负控制：普通函数形参的 definition 不受影响	lsp-navigation 聚合矩阵	没测该层	keep	keep	—
同一坐标（侧车里的 getName）⇒ 六个导航请求结论一致（都不可见）；负控制：源码侧仍可见（门禁不得过度拦截）	lsp-navigation 聚合矩阵	没测该层	keep	keep	—
definition 不得放行侧车（逃生口已去掉）；workspace/symbol 不得放行侧车条目（门禁已补）	lsp-navigation 聚合矩阵	没测该层	keep	keep	—
侧车上的六个 IDE 请求结论一致（侧车不可见）；侧车上的四个统一门禁导航请求结论一致（侧车不可见）；负控制：源码侧的符号仍可见（门禁不得过度拦截）	lsp-navigation 聚合矩阵	没测该层	keep	keep	—
同作用域重复声明：`const a` + 改 f→a ⇒ 拒绝（无 WorkspaceEdit）；回归：同文件改 f→bb ⇒ 正常产出编辑；嵌套作用域·同层已有 b：改 x→b ⇒ 拒绝；嵌套作用域·纯遮蔽（不同层级）：改 x→b ⇒ 允许（合法且无语义变化的 JS）；外层捕获：外层 b 在目标作用域内被引用 ⇒ 改 x→b 拒绝；内层捕获：目标 x 的引用落在声明了 y 的内层作用域 ⇒ 改 x→y 拒绝；方法臂：同归属已有同名成员 run→stop ⇒ 拒绝；run→w	lsp-navigation 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
纯函数面：无关对象的同名成员访问不进改名集合	dup:lsp-navigation 聚合矩阵	commit:8fa85177
纯函数面：对象字面量的方法键是定义位，且同源成员访问进集合	dup:lsp-navigation 聚合矩阵	commit:8fa85177
纯函数面：同名但不同类不合并（显式归属时）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
协议面（真 server）：归属歧义 ⇒ **拒绝改名**（不产出任何编辑，代码不被改坏）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
纯函数面：归属歧义可被检出（歧义 ⇒ 拒绝；无歧义 ⇒ 可改）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
协议面（真 server）：改对象字面量的方法 ⇒ key 与同源成员访问一起改	dup:lsp-navigation 聚合矩阵	commit:8fa85177
协议面（真 server）：对象字面量的函数值属性 `{ m: fn }` 的 key 也是定义位	dup:lsp-navigation 聚合矩阵	commit:8fa85177
协议面（真 server）：同名但不同类不合并（Alpha.run 不碰 Beta.run）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
协议面（真 server）：跨文件的无关类不被改（Alpha.run ≠ Beta.run）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
prepareRename 面：类方法键 / 同源成员访问可改名，无关数据属性不可改名	dup:lsp-navigation 聚合矩阵	commit:8fa85177
rename @ importer 用点位 ⇒ 改导出名 + importer 的 imported 侧，**不动** hidden 的声明	dup:lsp-navigation 聚合矩阵	commit:8fa85177
rename @ 导出名位 ⇒ 同样改导出名 + importer 的 imported 侧（改前是 null）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
rename @ 本地名位 ⇒ 改本地名（声明 + 导出说明符本地侧），**不连坐** importer	dup:lsp-navigation 聚合矩阵	commit:8fa85177
导出名位不再死位：definition / references / prepareRename 都有身份	dup:lsp-navigation 聚合矩阵	commit:8fa85177
在别名用法处改名：只改 importer 的本地侧 + 用法处	dup:lsp-navigation 聚合矩阵	commit:8fa85177
在 import 说明符的 local 侧改名：同样零连坐（导出方与其它 importer 不动）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
反向：从导出方改导出名 ⇒ 改导出方 + 各 importer 的 imported 侧，别名不动	dup:lsp-navigation 聚合矩阵	commit:8fa85177
重命名形参声明位：编辑集只有形参声明 + 形参引用，顶层零编辑	dup:lsp-navigation 聚合矩阵	commit:8fa85177
重命名形参体内的引用位：同样不连坐顶层变量	dup:lsp-navigation 聚合矩阵	commit:8fa85177
反向：重命名顶层变量：只改顶层那处，形参零编辑（两个方向对称）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
definition / references 走作用域：形参只认形参那一处绑定	dup:lsp-navigation 聚合矩阵	commit:8fa85177
definition / references / rename 对同一符号同口径（含侧车契约绑定）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
落盘后契约仍在生效（L1 违约诊断不因改名静默消失）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
负控制：没有侧车时 references / rename 只碰源码文件	dup:lsp-navigation 聚合矩阵	commit:8fa85177
从 re-export 位置发起 references 覆盖目标模块的定义与内部引用	dup:lsp-navigation 聚合矩阵	commit:8fa85177
从目标模块的定义处发起 references 覆盖 re-export 位点	dup:lsp-navigation 聚合矩阵	commit:8fa85177
从 re-export 位置发起 rename 同步改目标模块	dup:lsp-navigation 聚合矩阵	commit:8fa85177
改导出名时：imported 侧被改、别名不被改	dup:lsp-navigation 聚合矩阵	commit:8fa85177
改本地别名时：只改本地，不得连坐改目标模块的导出	dup:lsp-navigation 聚合矩阵	commit:8fa85177
非法标识符 ⇒ 不产出任何编辑	dup:lsp-navigation 聚合矩阵	commit:8fa85177
空名 ⇒ 不产出任何编辑	dup:lsp-navigation 聚合矩阵	commit:8fa85177
保留字 ⇒ 不产出任何编辑	dup:lsp-navigation 聚合矩阵	commit:8fa85177
合法新名 ⇒ 仍然正常改名（不得误伤）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
合法但非常规的标识符（$ / _ / Unicode）⇒ 仍然放行	dup:lsp-navigation 聚合矩阵	commit:8fa85177
collectBindingReferences：导出绑定的 referencePaths 只收标识符（语句节点不进）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
buildRenameEdits：宽于单个标识符的编辑被挡掉（语句级目标）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
buildRenameEdits：重叠的编辑只留窄的一条（协议合法性兜底）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
协议面：rename 导出绑定只产出标识符编辑，且无重叠	dup:lsp-navigation 聚合矩阵	commit:8fa85177
collectBindingReferences：简写属性的引用位带上 key 元数据	dup:lsp-navigation 聚合矩阵	commit:8fa85177
buildRenameEdits：简写属性的编辑文本是 `x: <新名>`	dup:lsp-navigation 聚合矩阵	commit:8fa85177
解构模式的简写属性同样保留 key（`function f({ x })` → `{ x: y }`）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
协议面：rename 简写属性产出 `x: y`，key 不被改掉	dup:lsp-navigation 聚合矩阵	commit:8fa85177
未被命名空间引用的导出，其 references 不含命名空间导入方	dup:lsp-navigation 聚合矩阵	commit:8fa85177
命名空间成员访问 `ns.beta` 是 beta 的引用位点	dup:lsp-navigation 聚合矩阵	commit:8fa85177
纯函数面：方法面能收齐类方法键 + 同源成员访问	dup:lsp-navigation 聚合矩阵	commit:8fa85177
协议面（真 server）：references @ 类方法键 ⇒ 至少 1 条引用（k.m(1)）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
协议面（真 server）：definition @ k.m(1) ⇒ 跳到类里的方法键	dup:lsp-navigation 聚合矩阵	commit:8fa85177
协议面（真 server）：references 的 includeDeclaration=false 只剩使用位	dup:lsp-navigation 聚合矩阵	commit:8fa85177
负控制：普通变量的 references 通道不受影响	dup:lsp-navigation 聚合矩阵	commit:8fa85177
类方法形参：definition ⇒ 形参声明位（改前是 null）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
对象方法形参：definition ⇒ 形参声明位（改前是 null）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
catch 形参：definition ⇒ 形参声明位（改前是 null）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
同一坐标：definition 与 references 的声明位**一致**（不再自相矛盾）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
负控制：普通函数形参的 definition 不受影响	dup:lsp-navigation 聚合矩阵	commit:8fa85177
同一坐标（侧车里的 getName）⇒ 六个导航请求结论一致（都不可见）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
负控制：源码侧仍可见（门禁不得过度拦截）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
definition 不得放行侧车（逃生口已去掉）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
workspace/symbol 不得放行侧车条目（门禁已补）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
侧车上的六个 IDE 请求结论一致（侧车不可见）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
侧车上的四个统一门禁导航请求结论一致（侧车不可见）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
负控制：源码侧的符号仍可见（门禁不得过度拦截）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
同作用域重复声明：`const a` + 改 f→a ⇒ 拒绝（无 WorkspaceEdit）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
回归：同文件改 f→bb ⇒ 正常产出编辑	dup:lsp-navigation 聚合矩阵	commit:8fa85177
嵌套作用域·同层已有 b：改 x→b ⇒ 拒绝	dup:lsp-navigation 聚合矩阵	commit:8fa85177
嵌套作用域·纯遮蔽（不同层级）：改 x→b ⇒ 允许（合法且无语义变化的 JS）	dup:lsp-navigation 聚合矩阵	commit:8fa85177
外层捕获：外层 b 在目标作用域内被引用 ⇒ 改 x→b 拒绝	dup:lsp-navigation 聚合矩阵	commit:8fa85177
内层捕获：目标 x 的引用落在声明了 y 的内层作用域 ⇒ 改 x→y 拒绝	dup:lsp-navigation 聚合矩阵	commit:8fa85177
方法臂：同归属已有同名成员 run→stop ⇒ 拒绝；run→walk ⇒ 正常改名	dup:lsp-navigation 聚合矩阵	commit:8fa85177
跨文件：def 文件模块作用域已有 fresh ⇒ 从 importer 发起 old→fresh 拒绝	dup:lsp-navigation 聚合矩阵	commit:8fa85177
私有成员臂：同类已有 #other ⇒ 改 #total→other 拒绝	dup:lsp-navigation 聚合矩阵	commit:8fa85177
prepareRename：handler 已注册且返回标识符 range + placeholder	dup:lsp-navigation 聚合矩阵	commit:8fa85177
```
