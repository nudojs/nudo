# packages/lsp/src/__tests__/lsp-navigation.test.ts

模块套件：71 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"纯函数面：无关对象的同名成员访问不进改名集合"	"定义位：类 K 的方法键（1-based 行 2 / 列 2） 使用位：k.m(1) / k.m(3) 的接收者是**形参**（解析不出归属）⇒ 不计入 无关对象 other 的数据属性 m 与 o.m(2) 同样不进集合 同名但不同类：Alpha.run 与 Beta.run 不许合并"	夹具漏形态	keep	keep	—
"纯函数面：对象字面量的方法键是定义位，且同源成员访问进集合"	"同名但不同类：Alpha.run 与 Beta.run 不许合并"	夹具漏形态	keep	keep	—
"纯函数面：同名但不同类不合并（显式归属时）"	"同名但不同类：Alpha.run 与 Beta.run 不许合并"	夹具漏形态	keep	keep	—
"协议面（真 server）：归属歧义 ⇒ **拒绝改名**（不产出任何编辑，代码不被改坏）"	"改前：4 条编辑（类方法键 + k.m(1) + o.m(2) + k.m(3)） ⇒ `o.m(2)` 被改成 `o.renamed(2)`，运行时读到 undefined（静默坏代码） 改后：R21 夹具里 `k` / `o` 都是**无类型形参** ⇒ 接收者归属解析不出来， 而文件内 `other` 有同名成员 `m` ⇒ **归属歧义**。 歧义下只有两种自洽结果：全改（改到无关对象）或全不改（定义改了、 调用点没改 ⇒ 同样坏）——两者都坏 ⇒ 拒绝改名，**一条编辑都不产出**。 同名但不同类：Alp"	夹具漏形态	keep	keep	—
"纯函数面：归属歧义可被检出（歧义 ⇒ 拒绝；无歧义 ⇒ 可改）"	"R21：形参接收者 + 同名不同归属成员 ⇒ 歧义 OBJ_METHOD：接收者归属可解析（helper ⇒ 对象字面量）⇒ 无歧义 TWO_CLASSES：a / b 都能解析出归属 ⇒ 无歧义 同名但不同类：Alpha.run 与 Beta.run 不许合并"	夹具漏形态	keep	keep	—
"协议面（真 server）：改对象字面量的方法 ⇒ key 与同源成员访问一起改"	"同名但不同类：Alpha.run 与 Beta.run 不许合并"	夹具漏形态	keep	keep	—
"协议面（真 server）：对象字面量的函数值属性 `{ m: fn }` 的 key 也是定义位"	"改前：ObjectProperty 的 key 不在收集范围 ⇒ 只改调用点，key 留着 m（改出坏代码） 同名但不同类：Alpha.run 与 Beta.run 不许合并"	夹具漏形态	keep	keep	—
"协议面（真 server）：同名但不同类不合并（Alpha.run 不碰 Beta.run）"	"同名但不同类：Alpha.run 与 Beta.run 不许合并"	夹具漏形态	keep	keep	—
"协议面（真 server）：跨文件的无关类不被改（Alpha.run ≠ Beta.run）"	"改前：b.js 的 Beta.run 也被改（跨文件 name-based 扫描） 同名但不同类：Alpha.run 与 Beta.run 不许合并"	夹具漏形态	keep	keep	—
"prepareRename 面：类方法键 / 同源成员访问可改名，无关数据属性不可改名"	"other 的数据属性 m：不可改名 同名但不同类：Alpha.run 与 Beta.run 不许合并"	夹具漏形态	keep	keep	—
"rename @ importer 用点位 ⇒ 改导出名 + importer 的 imported 侧，**不动** hidden 的声明"	"真 import：模块图必须仍然自洽（改前会 SyntaxError： The requested module does not provide an export named 'visible2'） ① 编辑集：导出说明符的**导出侧** + 两个 importer 的 imported 侧 + 用法 ② ⚠ 本地名 `hidden` 的声明 / 导出说明符的本地侧 **不得**进编辑集 ③ 落盘后：导出名改了、本地名没改 落地后真 import（node ESM）⇒ 模块图必须自洽"	没测该层	keep	keep	—
"rename @ 导出名位 ⇒ 同样改导出名 + importer 的 imported 侧（改前是 null）"	"落地后真 import（node ESM）⇒ 模块图必须自洽"	没测该层	keep	keep	—
"rename @ 本地名位 ⇒ 改本地名（声明 + 导出说明符本地侧），**不连坐** importer"	"导出名没变 ⇒ importer 不受影响 ⇒ 模块图仍然自洽 导出说明符的**本地侧**跟着改 ⚠ importer 的 imported 侧是**导出名**的身份 ⇒ 不得连坐 落地后真 import（node ESM）⇒ 模块图必须自洽"	没测该层	keep	keep	—
"导出名位不再死位：definition / references / prepareRename 都有身份"	"落地后真 import（node ESM）⇒ 模块图必须自洽"	没测该层	keep	keep	—
"在别名用法处改名：只改 importer 的本地侧 + 用法处"	"报告说的症状（**假阳性 —— 不复现**）： 在 `xf-use.js`（导入方）把**本地别名** `alias` 改名 ⇒ 报告实测： `xf-def.js` 的导出符号 + `xf-use2.js` 的 import 与用法**被一起改掉**。 反向（从**定义方**改导出名）⇒ 正确改 `xf-def.js` 的导出名 + 各 importer 的 **imported** 侧，**别名 `alias` 不动**。"	没测该层	keep	keep	—
"在 import 说明符的 local 侧改名：同样零连坐（导出方与其它 importer 不动）"	"报告说的症状（**假阳性 —— 不复现**）： 在 `xf-use.js`（导入方）把**本地别名** `alias` 改名 ⇒ 报告实测： `xf-def.js` 的导出符号 + `xf-use2.js` 的 import 与用法**被一起改掉**。 反向（从**定义方**改导出名）⇒ 正确改 `xf-def.js` 的导出名 + 各 importer 的 **imported** 侧，**别名 `alias` 不动**。"	没测该层	keep	keep	—
"反向：从导出方改导出名 ⇒ 改导出方 + 各 importer 的 imported 侧，别名不动"	"别名 `alias`（local 侧）与其用法处都不该被改（本地名没变） 报告说的症状（**假阳性 —— 不复现**）： 在 `xf-use.js`（导入方）把**本地别名** `alias` 改名 ⇒ 报告实测： `xf-def.js` 的导出符号 + `xf-use2.js` 的 import 与用法**被一起改掉**。 反向（从**定义方**改导出名）⇒ 正确改 `xf-def.js` 的导出名 + 各 importer 的 **imported** 侧，**别名 `alias` 不动**。"	没测该层	keep	keep	—
"重命名形参声明位：编辑集只有形参声明 + 形参引用，顶层零编辑"	"夹具：顶层 `x`（0:6-0:7）与形参 `x`（1:18-1:19）+ 形参引用（1:30-1:31） —— 形参**遮蔽**顶层变量，两者同名但**不同的绑定**。"	夹具漏形态	keep	keep	—
"重命名形参体内的引用位：同样不连坐顶层变量"	"夹具：顶层 `x`（0:6-0:7）与形参 `x`（1:18-1:19）+ 形参引用（1:30-1:31） —— 形参**遮蔽**顶层变量，两者同名但**不同的绑定**。"	夹具漏形态	keep	keep	—
"反向：重命名顶层变量：只改顶层那处，形参零编辑（两个方向对称）"	"夹具：顶层 `x`（0:6-0:7）与形参 `x`（1:18-1:19）+ 形参引用（1:30-1:31） —— 形参**遮蔽**顶层变量，两者同名但**不同的绑定**。"	夹具漏形态	keep	keep	—
"definition / references 走作用域：形参只认形参那一处绑定"	"夹具：顶层 `x`（0:6-0:7）与形参 `x`（1:18-1:19）+ 形参引用（1:30-1:31） —— 形参**遮蔽**顶层变量，两者同名但**不同的绑定**。"	夹具漏形态	keep	keep	—
"definition / references / rename 对同一符号同口径（含侧车契约绑定）"	"侧车侧：契约绑定 rename 改**两个**文件：侧车不得成孤儿 侧车编辑 = 契约绑定标识符本身（line 2, char 13..16 → \"plus\"） definition 的定义位全集 ⊆ rename 的编辑集（同一符号不得两套答案） 落盘（内存）：两侧同时改名 ⇒ 契约跟随源码，不成孤儿 `textDocument/rename` / `textDocument/references` 漏掉**侧车契约绑定** （而 `textDocument/definition` 把它报成定义位） 现象：对带侧"	没测该层	keep	keep	—
"落盘后契约仍在生效（L1 违约诊断不因改名静默消失）"	"旧行为（对照）：只改源码 ⇒ 契约成孤儿 ⇒ 已报的 L1 违约诊断**消失** 修复后的 rename 编辑集（源码 + 侧车）⇒ 契约仍绑定 ⇒ 违约诊断仍在 `textDocument/rename` / `textDocument/references` 漏掉**侧车契约绑定** （而 `textDocument/definition` 把它报成定义位） 现象：对带侧车契约的导出函数改名 ⇒ 只改源码、侧车契约成孤儿 （仍绑定旧名）⇒ 契约档 `hw`→`imp`，**已报的 L1 `nudo:constr"	没测该层	keep	keep	—
"负控制：没有侧车时 references / rename 只碰源码文件"	"`textDocument/rename` / `textDocument/references` 漏掉**侧车契约绑定** （而 `textDocument/definition` 把它报成定义位） 现象：对带侧车契约的导出函数改名 ⇒ 只改源码、侧车契约成孤儿 （仍绑定旧名）⇒ 契约档 `hw`→`imp`，**已报的 L1 `nudo:constraint-violated` 诊断静默消失**（门禁结论被 LSP 自己的编辑改掉）。 钉（协议面，同一符号三面必须同口径）： 1. `definition` 报出"	没测该层	keep	keep	—
"从 re-export 位置发起 references 覆盖目标模块的定义与内部引用"	"re-export 边在 references / rename 面不可见。 症状：`export { a } from \"./m.js\"` 这条边在符号表里根本没被建立 ⇒ 引用面看不到 m.js ⇒ 改名只改本地 ⇒ 目标模块没同步 ⇒ 模块图断裂 （m.js 改了名、main.js 的 re-export 原样不动 ⇒ SyntaxError）。"	没测该层	keep	keep	—
"从目标模块的定义处发起 references 覆盖 re-export 位点"	"re-export 边在 references / rename 面不可见。 症状：`export { a } from \"./m.js\"` 这条边在符号表里根本没被建立 ⇒ 引用面看不到 m.js ⇒ 改名只改本地 ⇒ 目标模块没同步 ⇒ 模块图断裂 （m.js 改了名、main.js 的 re-export 原样不动 ⇒ SyntaxError）。"	没测该层	keep	keep	—
"从 re-export 位置发起 rename 同步改目标模块"	"re-export 边在 references / rename 面不可见。 症状：`export { a } from \"./m.js\"` 这条边在符号表里根本没被建立 ⇒ 引用面看不到 m.js ⇒ 改名只改本地 ⇒ 目标模块没同步 ⇒ 模块图断裂 （m.js 改了名、main.js 的 re-export 原样不动 ⇒ SyntaxError）。"	没测该层	keep	keep	—
"改导出名时：imported 侧被改、别名不被改"	"xf-use.js：import 说明符的 imported 侧 oldName → newName xf-use.js：别名 alias 不得被改 别名的调用点也不得被改（本地名没变） xf-use2.js（无别名对照）：import 与调用点两处都改 症状：`import { oldName as alias } from \"./xf-def.js\"` + 在 xf-def.js 改名 ⇒ 改出来是 `import { oldName as newName }`（imported 侧没动 ⇒ import 断链"	没测该层	keep	keep	—
"改本地别名时：只改本地，不得连坐改目标模块的导出"	"症状：`import { oldName as alias } from \"./xf-def.js\"` + 在 xf-def.js 改名 ⇒ 改出来是 `import { oldName as newName }`（imported 侧没动 ⇒ import 断链， 模块加载即 SyntaxError），而**不该改的别名**被改了。 期望：imported 侧（`oldName`）被改成新名，别名 `alias` 保持不变。"	没测该层	keep	keep	—
"非法标识符 ⇒ 不产出任何编辑"	"`textDocument/rename` **从不校验新名字** ⇒ 一次改名就能把源码 改成**非法 JavaScript**（重复声明 / 非法标识符 / 空名 / 保留字）， `node --check` 直接 `SyntaxError`。 根因：`onRenameRequest`（`server-navigation.ts`）拿到 `params.newName` 后 **直接**当替换文本用，全程无标识符合法性 / 保留字校验。"	没测该层	keep	keep	—
"空名 ⇒ 不产出任何编辑"	"`textDocument/rename` **从不校验新名字** ⇒ 一次改名就能把源码 改成**非法 JavaScript**（重复声明 / 非法标识符 / 空名 / 保留字）， `node --check` 直接 `SyntaxError`。 根因：`onRenameRequest`（`server-navigation.ts`）拿到 `params.newName` 后 **直接**当替换文本用，全程无标识符合法性 / 保留字校验。"	没测该层	keep	keep	—
"保留字 ⇒ 不产出任何编辑"	"`textDocument/rename` **从不校验新名字** ⇒ 一次改名就能把源码 改成**非法 JavaScript**（重复声明 / 非法标识符 / 空名 / 保留字）， `node --check` 直接 `SyntaxError`。 根因：`onRenameRequest`（`server-navigation.ts`）拿到 `params.newName` 后 **直接**当替换文本用，全程无标识符合法性 / 保留字校验。"	没测该层	keep	keep	—
"合法新名 ⇒ 仍然正常改名（不得误伤）"	"`textDocument/rename` **从不校验新名字** ⇒ 一次改名就能把源码 改成**非法 JavaScript**（重复声明 / 非法标识符 / 空名 / 保留字）， `node --check` 直接 `SyntaxError`。 根因：`onRenameRequest`（`server-navigation.ts`）拿到 `params.newName` 后 **直接**当替换文本用，全程无标识符合法性 / 保留字校验。"	没测该层	keep	keep	—
"合法但非常规的标识符（$ / _ / Unicode）⇒ 仍然放行"	"`textDocument/rename` **从不校验新名字** ⇒ 一次改名就能把源码 改成**非法 JavaScript**（重复声明 / 非法标识符 / 空名 / 保留字）， `node --check` 直接 `SyntaxError`。 根因：`onRenameRequest`（`server-navigation.ts`）拿到 `params.newName` 后 **直接**当替换文本用，全程无标识符合法性 / 保留字校验。"	没测该层	keep	keep	—
"collectBindingReferences：导出绑定的 referencePaths 只收标识符（语句节点不进）"	"语句级节点（ExportNamedDeclaration）不得出现 回归钉：LSP `textDocument/rename` 改一个**导出绑定**时，不得把 声明本身毁掉。 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）： rename `total` → `renamed`，返回两条编辑 [0:13-0:18] -> \"renamed\" （标识符） [0:0-0:24] -> \"renamed\" （**整条 `export const total = 42;"	没测该层	keep	keep	—
"buildRenameEdits：宽于单个标识符的编辑被挡掉（语句级目标）"	"回归钉：LSP `textDocument/rename` 改一个**导出绑定**时，不得把 声明本身毁掉。 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）： rename `total` → `renamed`，返回两条编辑 [0:13-0:18] -> \"renamed\" （标识符） [0:0-0:24] -> \"renamed\" （**整条 `export const total = 42;"	没测该层	keep	keep	—
"buildRenameEdits：重叠的编辑只留窄的一条（协议合法性兜底）"	"回归钉：LSP `textDocument/rename` 改一个**导出绑定**时，不得把 声明本身毁掉。 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）： rename `total` → `renamed`，返回两条编辑 [0:13-0:18] -> \"renamed\" （标识符） [0:0-0:24] -> \"renamed\" （**整条 `export const total = 42;"	没测该层	keep	keep	—
"协议面：rename 导出绑定只产出标识符编辑，且无重叠"	"只有标识符一处：声明不得被整段替换 负控制：不得出现宽于标识符 / 与上面重叠的编辑 回归钉：LSP `textDocument/rename` 改一个**导出绑定**时，不得把 声明本身毁掉。 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）： rename `total` → `renamed`，返回两条编辑 [0:13-0:18] -> \"renamed\" （标识符） [0:0-0:24] -> \"renamed\" （**整条 `export const total ="	没测该层	keep	keep	—
"collectBindingReferences：简写属性的引用位带上 key 元数据"	"回归钉：rename 遇到**对象字面量简写属性**（`{ x }`）时，编辑文本 必须是 `x: <新名>`（**保留 key、只换 value**），不得把整段替换成新名字 —— 否则对象的**形状被静默改掉**（`{ x }` → `{ y }`）。 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）： rename `x` → `y`，返回 [1:8-1:9] -> \"y\" （声明） [2:11-2:12] -> \"y\" （**简写属性** ⇒ 变成 `{ y }`，ke"	夹具漏形态	keep	keep	—
"buildRenameEdits：简写属性的编辑文本是 `x: <新名>`"	"回归钉：rename 遇到**对象字面量简写属性**（`{ x }`）时，编辑文本 必须是 `x: <新名>`（**保留 key、只换 value**），不得把整段替换成新名字 —— 否则对象的**形状被静默改掉**（`{ x }` → `{ y }`）。 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）： rename `x` → `y`，返回 [1:8-1:9] -> \"y\" （声明） [2:11-2:12] -> \"y\" （**简写属性** ⇒ 变成 `{ y }`，ke"	夹具漏形态	keep	keep	—
"解构模式的简写属性同样保留 key（`function f({ x })` → `{ x: y }`）"	"回归钉：rename 遇到**对象字面量简写属性**（`{ x }`）时，编辑文本 必须是 `x: <新名>`（**保留 key、只换 value**），不得把整段替换成新名字 —— 否则对象的**形状被静默改掉**（`{ x }` → `{ y }`）。 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）： rename `x` → `y`，返回 [1:8-1:9] -> \"y\" （声明） [2:11-2:12] -> \"y\" （**简写属性** ⇒ 变成 `{ y }`，ke"	夹具漏形态	keep	keep	—
"协议面：rename 简写属性产出 `x: y`，key 不被改掉"	"回归钉：rename 遇到**对象字面量简写属性**（`{ x }`）时，编辑文本 必须是 `x: <新名>`（**保留 key、只换 value**），不得把整段替换成新名字 —— 否则对象的**形状被静默改掉**（`{ x }` → `{ y }`）。 改前（协议面实测，见 tmp/probe/fix-r30/d1-before.txt）： rename `x` → `y`，返回 [1:8-1:9] -> \"y\" （声明） [2:11-2:12] -> \"y\" （**简写属性** ⇒ 变成 `{ y }`，ke"	夹具漏形态	keep	keep	—
"未被命名空间引用的导出，其 references 不含命名空间导入方"	"症状：`import * as ns from \"./def.js\"` 之后，def.js 里**从未被提及**的 导出 alpha 的 references 里出现了 ns-user.js 的 `ns` 出现处（假引用）； 真正用到的 `ns.beta` 反而不是 beta 的引用。"	没测该层	keep	keep	—
"命名空间成员访问 `ns.beta` 是 beta 的引用位点"	"成员属性 beta（不是裸 ns） 裸 ns 不是引用 症状：`import * as ns from \"./def.js\"` 之后，def.js 里**从未被提及**的 导出 alpha 的 references 里出现了 ns-user.js 的 `ns` 出现处（假引用）； 真正用到的 `ns.beta` 反而不是 beta 的引用。"	没测该层	keep	keep	—
"纯函数面：方法面能收齐类方法键 + 同源成员访问"	"改前：类方法键不是绑定标识符（`isBindingIdentifier` 对 ClassMethod 键返回 false） ⇒ 绑定面（`collectBindingReferences`）找不到绑定目标直接返回空； 已经写好的方法面（`collectMethodReferences`）**没有**被 references / definition 通道接入 ⇒ 两个请求都答「没有」。"	没测该层	keep	keep	—
"协议面（真 server）：references @ 类方法键 ⇒ 至少 1 条引用（k.m(1)）"	"改前：[] （一条都没有） 使用位落在 `m` 本身（不是整条表达式） 改前：类方法键不是绑定标识符（`isBindingIdentifier` 对 ClassMethod 键返回 false） ⇒ 绑定面（`collectBindingReferences`）找不到绑定目标直接返回空； 已经写好的方法面（`collectMethodReferences`）**没有**被 references / definition 通道接入 ⇒ 两个请求都答「没有」。"	没测该层	keep	keep	—
"协议面（真 server）：definition @ k.m(1) ⇒ 跳到类里的方法键"	"改前：[] （跳不过去） 改前：类方法键不是绑定标识符（`isBindingIdentifier` 对 ClassMethod 键返回 false） ⇒ 绑定面（`collectBindingReferences`）找不到绑定目标直接返回空； 已经写好的方法面（`collectMethodReferences`）**没有**被 references / definition 通道接入 ⇒ 两个请求都答「没有」。"	没测该层	keep	keep	—
"协议面（真 server）：references 的 includeDeclaration=false 只剩使用位"	"改前：类方法键不是绑定标识符（`isBindingIdentifier` 对 ClassMethod 键返回 false） ⇒ 绑定面（`collectBindingReferences`）找不到绑定目标直接返回空； 已经写好的方法面（`collectMethodReferences`）**没有**被 references / definition 通道接入 ⇒ 两个请求都答「没有」。"	没测该层	keep	keep	—
"负控制：普通变量的 references 通道不受影响"	"改前：类方法键不是绑定标识符（`isBindingIdentifier` 对 ClassMethod 键返回 false） ⇒ 绑定面（`collectBindingReferences`）找不到绑定目标直接返回空； 已经写好的方法面（`collectMethodReferences`）**没有**被 references / definition 通道接入 ⇒ 两个请求都答「没有」。"	没测该层	keep	keep	—
"类方法形参：definition ⇒ 形参声明位（改前是 null）"	"普通函数形参（对照组：改前就是好的）"	没测该层	keep	keep	—
"对象方法形参：definition ⇒ 形参声明位（改前是 null）"	"普通函数形参（对照组：改前就是好的）"	没测该层	keep	keep	—
"catch 形参：definition ⇒ 形参声明位（改前是 null）"	"普通函数形参（对照组：改前就是好的）"	没测该层	keep	keep	—
"同一坐标：definition 与 references 的声明位**一致**（不再自相矛盾）"	"普通函数形参（对照组：改前就是好的）"	没测该层	keep	keep	—
"负控制：普通函数形参的 definition 不受影响"	"普通函数形参（对照组：改前就是好的）"	没测该层	keep	keep	—
"同一坐标（侧车里的 getName）⇒ 六个导航请求结论一致（都不可见）"	"侧车契约文件（`*.nudo.js`）在导航面上的**门禁各写各的**： `definition` 单独挂了 `isSidecarPath` **逃生口**（放行侧车）， `workspace/symbol` 干脆**没有门禁**（反而放行侧车），其余四个请求一律 `isNudoFile` 一刀切 ⇒ **同一坐标六种请求三种结论**：definition 说 「这个符号存在」，documentSymbol 说「这个文件里没有任何符号」 ⇒ **LSP 内部自相矛盾**。 ⚠ **代价（已裁决：接受）**：丢掉「源"	没测该层	keep	keep	—
"负控制：源码侧仍可见（门禁不得过度拦截）"	"侧车契约文件（`*.nudo.js`）在导航面上的**门禁各写各的**： `definition` 单独挂了 `isSidecarPath` **逃生口**（放行侧车）， `workspace/symbol` 干脆**没有门禁**（反而放行侧车），其余四个请求一律 `isNudoFile` 一刀切 ⇒ **同一坐标六种请求三种结论**：definition 说 「这个符号存在」，documentSymbol 说「这个文件里没有任何符号」 ⇒ **LSP 内部自相矛盾**。 ⚠ **代价（已裁决：接受）**：丢掉「源"	没测该层	keep	keep	—
"definition 不得放行侧车（逃生口已去掉）"	"（**共担钉**）—— 族级不变量：侧车契约文件（`*.nudo.js`）在**全部** 导航请求上不可见。 ⇒ 本钉在 HEAD（未修）上**红**（反向闸证据）， 片 B 落地后**转绿**。"	没测该层	keep	keep	—
"workspace/symbol 不得放行侧车条目（门禁已补）"	"负控制：源码条目仍在（不得整片误杀） （**共担钉**）—— 族级不变量：侧车契约文件（`*.nudo.js`）在**全部** 导航请求上不可见。 ⇒ 本钉在 HEAD（未修）上**红**（反向闸证据）， 片 B 落地后**转绿**。"	没测该层	keep	keep	—
"侧车上的六个 IDE 请求结论一致（侧车不可见）"	"侧车契约文件（`*.nudo.js`）在导航请求族里的**门禁各写各的**： `definition` 单独挂了 `isSidecarPath` 逃生口（放行侧车），`workspace/symbol` 干脆**没有门禁**（反而放行侧车），其余四个导航请求与 6 个 IDE 请求一律 `isNudoFile` 一刀切 ⇒ **同一坐标六种请求三种结论**：definition 说「这个符号 存在」，documentSymbol 说「这个文件里没有任何符号」。 根因：门禁谓词**没有单一事实源**——`server"	没测该层	keep	keep	—
"侧车上的四个统一门禁导航请求结论一致（侧车不可见）"	"侧车契约文件（`*.nudo.js`）在导航请求族里的**门禁各写各的**： `definition` 单独挂了 `isSidecarPath` 逃生口（放行侧车），`workspace/symbol` 干脆**没有门禁**（反而放行侧车），其余四个导航请求与 6 个 IDE 请求一律 `isNudoFile` 一刀切 ⇒ **同一坐标六种请求三种结论**：definition 说「这个符号 存在」，documentSymbol 说「这个文件里没有任何符号」。 根因：门禁谓词**没有单一事实源**——`server"	没测该层	keep	keep	—
"负控制：源码侧的符号仍可见（门禁不得过度拦截）"	"侧车契约文件（`*.nudo.js`）在导航请求族里的**门禁各写各的**： `definition` 单独挂了 `isSidecarPath` 逃生口（放行侧车），`workspace/symbol` 干脆**没有门禁**（反而放行侧车），其余四个导航请求与 6 个 IDE 请求一律 `isNudoFile` 一刀切 ⇒ **同一坐标六种请求三种结论**：definition 说「这个符号 存在」，documentSymbol 说「这个文件里没有任何符号」。 根因：门禁谓词**没有单一事实源**——`server"	没测该层	keep	keep	—
"同作用域重复声明：`const a` + 改 f→a ⇒ 拒绝（无 WorkspaceEdit）"	"嵌套作用域（纯遮蔽，不同层级）：目标作用域内零 `b` 引用 ⇒ 允许"	没测该层	keep	keep	—
"回归：同文件改 f→bb ⇒ 正常产出编辑"	"嵌套作用域（纯遮蔽，不同层级）：目标作用域内零 `b` 引用 ⇒ 允许"	没测该层	keep	keep	—
"嵌套作用域·同层已有 b：改 x→b ⇒ 拒绝"	"嵌套作用域（纯遮蔽，不同层级）：目标作用域内零 `b` 引用 ⇒ 允许"	没测该层	keep	keep	—
"嵌套作用域·纯遮蔽（不同层级）：改 x→b ⇒ 允许（合法且无语义变化的 JS）"	"嵌套作用域（纯遮蔽，不同层级）：目标作用域内零 `b` 引用 ⇒ 允许"	没测该层	keep	keep	—
"外层捕获：外层 b 在目标作用域内被引用 ⇒ 改 x→b 拒绝"	"嵌套作用域（纯遮蔽，不同层级）：目标作用域内零 `b` 引用 ⇒ 允许"	没测该层	keep	keep	—
"内层捕获：目标 x 的引用落在声明了 y 的内层作用域 ⇒ 改 x→y 拒绝"	"嵌套作用域（纯遮蔽，不同层级）：目标作用域内零 `b` 引用 ⇒ 允许"	没测该层	keep	keep	—
"方法臂：同归属已有同名成员 run→stop ⇒ 拒绝；run→walk ⇒ 正常改名"	"嵌套作用域（纯遮蔽，不同层级）：目标作用域内零 `b` 引用 ⇒ 允许"	没测该层	keep	keep	—
"跨文件：def 文件模块作用域已有 fresh ⇒ 从 importer 发起 old→fresh 拒绝"	"嵌套作用域（纯遮蔽，不同层级）：目标作用域内零 `b` 引用 ⇒ 允许"	没测该层	keep	keep	—
"私有成员臂：同类已有 #other ⇒ 改 #total→other 拒绝"	"嵌套作用域（纯遮蔽，不同层级）：目标作用域内零 `b` 引用 ⇒ 允许"	没测该层	keep	keep	—
"prepareRename：handler 已注册且返回标识符 range + placeholder"	"嵌套作用域（纯遮蔽，不同层级）：目标作用域内零 `b` 引用 ⇒ 允许"	没测该层	keep	keep	—
```
