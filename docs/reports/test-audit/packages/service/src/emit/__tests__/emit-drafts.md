# packages/service/src/emit/__tests__/emit-drafts.test.ts

模块套件：emit draft/contract/case/freeze 面。

审计：55 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
点观测见证（实参全是字面量、无断言）不生成任何契约；带断言的 case 是域声明 ⇒ 仍可作域来源与返回义务来源；域形状实参（约束构建器）是域来源 ⇒ `not-projectable` 口径不变；有调用点证据时，指令见证不得污染返回义务；域声明与见证共存时：域声明生效，见证不污染	emit-drafts 聚合矩阵	没测该层	keep	keep	—
实参全是字面量且无断言 ⇒ 见证（不进契约）；实参全是字面量但带断言 ⇒ 域声明；实参是约束构建器（域形状）⇒ 域声明；实参混合（字面量 + 约束构建器）⇒ 域声明	emit-drafts 聚合矩阵	没测该层	keep	keep	—
契约条目透出 conflict（此前被静默跳过 ⇒ 印成有效契约）；人读行带 `[unsatisfiable: n]` 标记（不再印成「有效契约」）；`nudo contract` 与 check 同诊断：stderr 报同码 error + 只读命令 exit 0；`--json` 机器面：同名字段 + 只读命令 exit 0（stdout 仍是合法 JSON）；负控制：普通契约不带标记且 exit 0	emit-drafts 聚合矩阵	没测该层	keep	keep	—
未申报但门禁判「可能抛」⇒ 草稿头给出可照抄的 throws 补救（DSL 不擅自加义务）；按提示补 throws 槽后入口抛错诊断真的消失（建议可执行）；源码显式 `@nudo:throws` 原样进草稿（不再凭空消失）；多个错误种类 ⇒ `union(lit(…), lit(…))`（throws 槽要求具名错误）；负控制：不抛错的函数草稿里没有 throws 槽	emit-drafts 聚合矩阵	没测该层	keep	keep	—
观测集是真实返回域的真子集 ⇒ 不投影返回义务（改前：number() ⇒ 假红）；负控制：观测域覆盖推断域 ⇒ 返回义务照旧投影（不误伤）；负控制：无观测 ⇒ 不发明返回义务（symbolic 只作注释）	emit-drafts 聚合矩阵	没测该层	keep	keep	—
函数体首行是普通块注释：产物仍可解析（改前失败）；声明行尾带普通块注释：产物仍可解析（改前失败）；多行 JSDoc 后的普通块注释：tag 落在 JSDoc 内（不落进注释外）；负控制：已有 JSDoc 的函数仍把 tag 插进 JSDoc（既有行为不变）；负控制：单行 JSDoc 仍展开成块（既有行为不变）；负控制：已有 @nudo:throws 时不重复插（既有行为不变）	emit-drafts 聚合矩阵	没测该层	keep	keep	—
手写契约的 lit(42) 返回渲染成 42（不是 number）；字面量在 pred 里（不在 term 里）也能取到；契约返回是 number() 时仍是 number（不回归）；观测返回位（无契约）仍按调用面 widen：42 → number（负控制）	emit-drafts 聚合矩阵	没测该层	keep	keep	—
rest 函数 not-projectable 跳过（改前：写出 ...rest: number()）；草稿产物真能过 node --check（改前：SyntaxError: Unexpected token ':'）；负控制：非 rest 导出照旧出绑定行（不误跳过）	emit-drafts 聚合矩阵	没测该层	keep	keep	—
导出名撞 builder import ⇒ 走别名形态（改前：export const number）；草稿产物真能过 node --check（改前：Identifier 'number' has already been declared）；负控制：普通导出名仍是 export const <name>（不误改别名形态）	emit-drafts 聚合矩阵	没测该层	keep	keep	—
既有草稿被手改过 ⇒ 拒绝覆盖且原样保留（改前：静默覆盖）；负控制：机器原稿（指纹一致）仍可被覆盖（源变化后重生成）；负控制：同内容重跑 ⇒ 幂等（unchanged，不写盘）	emit-drafts 聚合矩阵	没测该层	keep	keep	—
项目根下的合法目录 `..data/` 不再被误判为越出项目根 ⇒ 草稿写盘成功；真正越出项目根的路径**仍被拒**（判据不许放宽成「一律放行」）；项目根下**文件名**以 `..` 开头（`..data.js`）同样不再被误判为逃逸	emit-drafts 聚合矩阵	没测该层	keep	keep	—
侧车键 = 导出身份 default（改前：_default ⇒ 绑不上）；草稿产物真能过 node --check；照抄草稿进侧车 ⇒ 契约真的绑上（改前：键 _default ⇒ 绑不上 ⇒ 假绿）	emit-drafts 聚合矩阵	没测该层	keep	keep	—
违约见证（-1 ⊭ x > 0）不写入；合规见证照写；skip 记 contract-violation；不可判 ⇒ 放行（非字面量实参不猜；不写 = 丢证据）；无宿主接线（不给 filePath/loadModule）⇒ 契约不可读 ⇒ 契约闸不生效（行为与改前一致）	emit-drafts 聚合矩阵	没测该层	keep	keep	—
① strip 不剥离「含手写 case 的块」里的生成态见证（往返闭合）；① 对照：块内**没有**手写 case ⇒ 照常剥离（update 仍能重同步）；② rebuildGenerated：手写 case 只挡同名，不挡 call@ 见证的重建；② 对照：add 模式（默认）仍是「手写 ⇒ 整函数跳过」（不动用户手写块）；② 手写 case 的载荷与新调用点相同不得顶掉该见证（载荷等价只判生成态之间）	emit-drafts 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
点观测见证（实参全是字面量、无断言）不生成任何契约	dup:emit-drafts 聚合矩阵	commit:a0b08363
带断言的 case 是域声明 ⇒ 仍可作域来源与返回义务来源	dup:emit-drafts 聚合矩阵	commit:a0b08363
域形状实参（约束构建器）是域来源 ⇒ `not-projectable` 口径不变	dup:emit-drafts 聚合矩阵	commit:a0b08363
有调用点证据时，指令见证不得污染返回义务	dup:emit-drafts 聚合矩阵	commit:a0b08363
域声明与见证共存时：域声明生效，见证不污染	dup:emit-drafts 聚合矩阵	commit:a0b08363
实参全是字面量且无断言 ⇒ 见证（不进契约）	dup:emit-drafts 聚合矩阵	commit:a0b08363
实参全是字面量但带断言 ⇒ 域声明	dup:emit-drafts 聚合矩阵	commit:a0b08363
实参是约束构建器（域形状）⇒ 域声明	dup:emit-drafts 聚合矩阵	commit:a0b08363
实参混合（字面量 + 约束构建器）⇒ 域声明	dup:emit-drafts 聚合矩阵	commit:a0b08363
契约条目透出 conflict（此前被静默跳过 ⇒ 印成有效契约）	dup:emit-drafts 聚合矩阵	commit:a0b08363
人读行带 `[unsatisfiable: n]` 标记（不再印成「有效契约」）	dup:emit-drafts 聚合矩阵	commit:a0b08363
`nudo contract` 与 check 同诊断：stderr 报同码 error + 只读命令 exit 0	dup:emit-drafts 聚合矩阵	commit:a0b08363
`--json` 机器面：同名字段 + 只读命令 exit 0（stdout 仍是合法 JSON）	dup:emit-drafts 聚合矩阵	commit:a0b08363
负控制：普通契约不带标记且 exit 0	dup:emit-drafts 聚合矩阵	commit:a0b08363
未申报但门禁判「可能抛」⇒ 草稿头给出可照抄的 throws 补救（DSL 不擅自加义务）	dup:emit-drafts 聚合矩阵	commit:a0b08363
按提示补 throws 槽后入口抛错诊断真的消失（建议可执行）	dup:emit-drafts 聚合矩阵	commit:a0b08363
源码显式 `@nudo:throws` 原样进草稿（不再凭空消失）	dup:emit-drafts 聚合矩阵	commit:a0b08363
多个错误种类 ⇒ `union(lit(…), lit(…))`（throws 槽要求具名错误）	dup:emit-drafts 聚合矩阵	commit:a0b08363
负控制：不抛错的函数草稿里没有 throws 槽	dup:emit-drafts 聚合矩阵	commit:a0b08363
观测集是真实返回域的真子集 ⇒ 不投影返回义务（改前：number() ⇒ 假红）	dup:emit-drafts 聚合矩阵	commit:a0b08363
负控制：观测域覆盖推断域 ⇒ 返回义务照旧投影（不误伤）	dup:emit-drafts 聚合矩阵	commit:a0b08363
负控制：无观测 ⇒ 不发明返回义务（symbolic 只作注释）	dup:emit-drafts 聚合矩阵	commit:a0b08363
函数体首行是普通块注释：产物仍可解析（改前失败）	dup:emit-drafts 聚合矩阵	commit:a0b08363
声明行尾带普通块注释：产物仍可解析（改前失败）	dup:emit-drafts 聚合矩阵	commit:a0b08363
多行 JSDoc 后的普通块注释：tag 落在 JSDoc 内（不落进注释外）	dup:emit-drafts 聚合矩阵	commit:a0b08363
负控制：已有 JSDoc 的函数仍把 tag 插进 JSDoc（既有行为不变）	dup:emit-drafts 聚合矩阵	commit:a0b08363
负控制：单行 JSDoc 仍展开成块（既有行为不变）	dup:emit-drafts 聚合矩阵	commit:a0b08363
负控制：已有 @nudo:throws 时不重复插（既有行为不变）	dup:emit-drafts 聚合矩阵	commit:a0b08363
手写契约的 lit(42) 返回渲染成 42（不是 number）	dup:emit-drafts 聚合矩阵	commit:a0b08363
字面量在 pred 里（不在 term 里）也能取到	dup:emit-drafts 聚合矩阵	commit:a0b08363
契约返回是 number() 时仍是 number（不回归）	dup:emit-drafts 聚合矩阵	commit:a0b08363
观测返回位（无契约）仍按调用面 widen：42 → number（负控制）	dup:emit-drafts 聚合矩阵	commit:a0b08363
rest 函数 not-projectable 跳过（改前：写出 ...rest: number()）	dup:emit-drafts 聚合矩阵	commit:a0b08363
草稿产物真能过 node --check（改前：SyntaxError: Unexpected token ':'）	dup:emit-drafts 聚合矩阵	commit:a0b08363
负控制：非 rest 导出照旧出绑定行（不误跳过）	dup:emit-drafts 聚合矩阵	commit:a0b08363
导出名撞 builder import ⇒ 走别名形态（改前：export const number）	dup:emit-drafts 聚合矩阵	commit:a0b08363
草稿产物真能过 node --check（改前：Identifier 'number' has already been declared）	dup:emit-drafts 聚合矩阵	commit:a0b08363
负控制：普通导出名仍是 export const <name>（不误改别名形态）	dup:emit-drafts 聚合矩阵	commit:a0b08363
既有草稿被手改过 ⇒ 拒绝覆盖且原样保留（改前：静默覆盖）	dup:emit-drafts 聚合矩阵	commit:a0b08363
负控制：机器原稿（指纹一致）仍可被覆盖（源变化后重生成）	dup:emit-drafts 聚合矩阵	commit:a0b08363
负控制：同内容重跑 ⇒ 幂等（unchanged，不写盘）	dup:emit-drafts 聚合矩阵	commit:a0b08363
项目根下的合法目录 `..data/` 不再被误判为越出项目根 ⇒ 草稿写盘成功	dup:emit-drafts 聚合矩阵	commit:a0b08363
真正越出项目根的路径**仍被拒**（判据不许放宽成「一律放行」）	dup:emit-drafts 聚合矩阵	commit:a0b08363
项目根下**文件名**以 `..` 开头（`..data.js`）同样不再被误判为逃逸	dup:emit-drafts 聚合矩阵	commit:a0b08363
侧车键 = 导出身份 default（改前：_default ⇒ 绑不上）	dup:emit-drafts 聚合矩阵	commit:a0b08363
草稿产物真能过 node --check	dup:emit-drafts 聚合矩阵	commit:a0b08363
照抄草稿进侧车 ⇒ 契约真的绑上（改前：键 _default ⇒ 绑不上 ⇒ 假绿）	dup:emit-drafts 聚合矩阵	commit:a0b08363
违约见证（-1 ⊭ x > 0）不写入；合规见证照写；skip 记 contract-violation	dup:emit-drafts 聚合矩阵	commit:a0b08363
不可判 ⇒ 放行（非字面量实参不猜；不写 = 丢证据）	dup:emit-drafts 聚合矩阵	commit:a0b08363
无宿主接线（不给 filePath/loadModule）⇒ 契约不可读 ⇒ 契约闸不生效（行为与改前一致）	dup:emit-drafts 聚合矩阵	commit:a0b08363
① strip 不剥离「含手写 case 的块」里的生成态见证（往返闭合）	dup:emit-drafts 聚合矩阵	commit:a0b08363
① 对照：块内**没有**手写 case ⇒ 照常剥离（update 仍能重同步）	dup:emit-drafts 聚合矩阵	commit:a0b08363
② rebuildGenerated：手写 case 只挡同名，不挡 call@ 见证的重建	dup:emit-drafts 聚合矩阵	commit:a0b08363
② 对照：add 模式（默认）仍是「手写 ⇒ 整函数跳过」（不动用户手写块）	dup:emit-drafts 聚合矩阵	commit:a0b08363
② 手写 case 的载荷与新调用点相同不得顶掉该见证（载荷等价只判生成态之间）	dup:emit-drafts 聚合矩阵	commit:a0b08363
```
