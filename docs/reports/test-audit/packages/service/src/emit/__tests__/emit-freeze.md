# packages/service/src/emit/__tests__/emit-freeze.test.ts

模块套件：emit 产物保真面（缩进/CRLF/BOM/EOF/section 幂等/可重现）。

审计：52 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
export function：块落在列 0（不是 function 关键字的列 7）；export default function：块落在列 0（不是 function 关键字的列 15）；负控制：嵌套函数仍按声明行的行首缩进（修复不把所有块拍平到列 0）；负控制：已有 JSDoc 块时指令行沿用块自身的缩进（不按函数节点列）	emit-freeze 聚合矩阵	没测该层	keep	keep	—
CRLF 文件：固化后仍是纯 CRLF（新块不带裸 LF）；CRLF 文件：原行的行尾逐行保留（不被改写成 LF）；CRLF 文件：真实分析器驱动的固化同样不混排行尾；负控制：LF 文件写回后仍是 LF（不引入 CR）；负控制：二次固化幂等（CRLF 文件第二次不再写盘）	emit-freeze 聚合矩阵	没测该层	keep	keep	—
第二次固化（重新分析改写后的源码）不再写重复指令；第三、四次固化同样 no-op（源码不再增长）；同实参、不同名字的见证不重复写（两个调用点传同样的值）；不同实参的见证仍然各自落地（不误合并）；`serializeCaseArgs` 是载荷口径的唯一真源（buildCaseDirective 复用它）	emit-freeze 聚合矩阵	没测该层	keep	keep	—
末行没有换行时输出 `\ No newline at end of file` 标记（native diff 同口径）；末行有换行时不输出标记（负控制）；末尾换行的有无本身是内容差异（与 native diff 同口径）；行数不多算一格：末尾有换行的文件不产生 phantom 末行	emit-freeze 聚合矩阵	没测该层	keep	keep	—
keeps the section order (no reorder diff) when refreshing one target；rewrites the target section in place (content change still lands)；is idempotent: a second emit reports no change and does not write	emit-freeze 聚合矩阵	没测该层	keep	keep	—
见证契约段在证据消失后被删（+ 台账 removed + info 诊断）；手写段逐字存活（生成/手写的分界 = @generated 标记行）；删段后再跑：逐字节相同（幂等，不产生二次改动）；新鲜发射（有证据）逐字节相同：同状态两次发射结果一致；宽域段（跨文件记录来源）留存：证据缺失 ≠ 证据没了（不误删用户契约）；证据还在 ⇒ 刷新（改写）而不是删除；@nudo:skip（用户显式关掉分析）⇒ 段保留：关分析不是「行为没了」；证据在但投影不出 ⇒ 段保留：投影失败 ≠ 证	emit-freeze 聚合矩阵	没测该层	keep	keep	—
行注释里原样保留块注释闭合序列（不转义）；换行 / 控制字符仍必须中和成空格（`//` 注释被顶出代码的防线）；块注释侧口径不变（core 的 sanitizeCommentText 仍转义闭合序列）	emit-freeze 聚合矩阵	没测该层	keep	keep	—
"行注释里的闭合序列原样保留（旧实现写成 `*\\/`）"	"断言：expect(draft).toContain(\"// a: /* no evidence — tighten */\");；expect(draft).toContain(\"// b: /* no evidence — tighten */\");"	没测该层	keep	keep	—
zod: `// ` 注记行保留闭合序列；standard-schema: `// ` 注记行保留闭合序列	emit-freeze 聚合矩阵	没测该层	keep	keep	—
"dts JSDoc 注释体里的闭合序列仍被转义（未被本片改动波及）"	"行注释（`//`）上下文被**块注释**的转义口径污染 根因：core 的 `sanitizeCommentText`（`core/src/algebra/codegen-escape.ts`） 只有**一种**行为——无条件把块注释闭合序列（星号 + 斜杠）转义成 `*\\/`。 但**行注释**到行尾 结束，闭合序列在 `//` 上下文**没有语法含义** ⇒ 转义纯属污染： `nudo contract --draft` 的契约草案注释被写成 `*\\/`，而用户要把这段文字 **原样抄进侧车**。 断言：expect(jsdoc).toContain(\"*\\\\/\");；expect(withoutClose).not.toCon"	没测该层	keep	keep	—
keeps a CRLF sidecar pure CRLF (no mixed line terminators)；keeps a UTF-8 BOM sidecar's BOM and reports no change on a no-op emit；handles a sidecar without a trailing newline (idempotent, still loadable)；negative control: an LF sidecar keeps	emit-freeze 聚合矩阵	没测该层	keep	keep	—
BOM 仍在文件最前（不被挪到文件中段），全文只有一枚；BOM 不被当成缩进抄进新插入的 JSDoc 块（\s 含 U+FEFF）；剥离已生成指令时 BOM 不丢（首行整块被删也不丢）；负控制：手写 case（无 call@ 命名）不动，BOM 也不动	emit-freeze 聚合矩阵	没测该层	keep	keep	—
两侧都带 BOM ⇒ 首行是公共行（无内容差异）；只有一侧带 BOM ⇒ 首行如实呈现为内容差异（不谎报「无改动」）；diff 的首行保留 BOM（native git 同形：上下文行含 BOM，补丁才贴得上）	emit-freeze 聚合矩阵	没测该层	keep	keep	—
调用点 1 次 vs 2 次：派生行（参数位 + 返回位）完全一致；落盘侧车的契约行一致（组合式精确，不是 1 ULP 展开式）；两种形态的**接受集合相同**（生效契约：x > 1，返回 > 3）；负控制：两个调用点实参不同 ⇒ 不可投影（不得产出非法侧车）；负控制：单调用点的既有组合式形态不变	emit-freeze 聚合矩阵	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
export function：块落在列 0（不是 function 关键字的列 7）	dup:emit-freeze 聚合矩阵	commit:a0b08363
export default function：块落在列 0（不是 function 关键字的列 15）	dup:emit-freeze 聚合矩阵	commit:a0b08363
负控制：嵌套函数仍按声明行的行首缩进（修复不把所有块拍平到列 0）	dup:emit-freeze 聚合矩阵	commit:a0b08363
负控制：已有 JSDoc 块时指令行沿用块自身的缩进（不按函数节点列）	dup:emit-freeze 聚合矩阵	commit:a0b08363
CRLF 文件：固化后仍是纯 CRLF（新块不带裸 LF）	dup:emit-freeze 聚合矩阵	commit:a0b08363
CRLF 文件：原行的行尾逐行保留（不被改写成 LF）	dup:emit-freeze 聚合矩阵	commit:a0b08363
CRLF 文件：真实分析器驱动的固化同样不混排行尾	dup:emit-freeze 聚合矩阵	commit:a0b08363
负控制：LF 文件写回后仍是 LF（不引入 CR）	dup:emit-freeze 聚合矩阵	commit:a0b08363
负控制：二次固化幂等（CRLF 文件第二次不再写盘）	dup:emit-freeze 聚合矩阵	commit:a0b08363
第二次固化（重新分析改写后的源码）不再写重复指令	dup:emit-freeze 聚合矩阵	commit:a0b08363
第三、四次固化同样 no-op（源码不再增长）	dup:emit-freeze 聚合矩阵	commit:a0b08363
同实参、不同名字的见证不重复写（两个调用点传同样的值）	dup:emit-freeze 聚合矩阵	commit:a0b08363
不同实参的见证仍然各自落地（不误合并）	dup:emit-freeze 聚合矩阵	commit:a0b08363
`serializeCaseArgs` 是载荷口径的唯一真源（buildCaseDirective 复用它）	dup:emit-freeze 聚合矩阵	commit:a0b08363
末行没有换行时输出 `\ No newline at end of file` 标记（native diff 同口径）	dup:emit-freeze 聚合矩阵	commit:a0b08363
末行有换行时不输出标记（负控制）	dup:emit-freeze 聚合矩阵	commit:a0b08363
末尾换行的有无本身是内容差异（与 native diff 同口径）	dup:emit-freeze 聚合矩阵	commit:a0b08363
行数不多算一格：末尾有换行的文件不产生 phantom 末行	dup:emit-freeze 聚合矩阵	commit:a0b08363
keeps the section order (no reorder diff) when refreshing one target	dup:emit-freeze 聚合矩阵	commit:a0b08363
rewrites the target section in place (content change still lands)	dup:emit-freeze 聚合矩阵	commit:a0b08363
is idempotent: a second emit reports no change and does not write	dup:emit-freeze 聚合矩阵	commit:a0b08363
见证契约段在证据消失后被删（+ 台账 removed + info 诊断）	dup:emit-freeze 聚合矩阵	commit:a0b08363
手写段逐字存活（生成/手写的分界 = @generated 标记行）	dup:emit-freeze 聚合矩阵	commit:a0b08363
删段后再跑：逐字节相同（幂等，不产生二次改动）	dup:emit-freeze 聚合矩阵	commit:a0b08363
新鲜发射（有证据）逐字节相同：同状态两次发射结果一致	dup:emit-freeze 聚合矩阵	commit:a0b08363
宽域段（跨文件记录来源）留存：证据缺失 ≠ 证据没了（不误删用户契约）	dup:emit-freeze 聚合矩阵	commit:a0b08363
证据还在 ⇒ 刷新（改写）而不是删除	dup:emit-freeze 聚合矩阵	commit:a0b08363
@nudo:skip（用户显式关掉分析）⇒ 段保留：关分析不是「行为没了」	dup:emit-freeze 聚合矩阵	commit:a0b08363
证据在但投影不出 ⇒ 段保留：投影失败 ≠ 证据消失	dup:emit-freeze 聚合矩阵	commit:a0b08363
行注释里原样保留块注释闭合序列（不转义）	dup:emit-freeze 聚合矩阵	commit:a0b08363
换行 / 控制字符仍必须中和成空格（`//` 注释被顶出代码的防线）	dup:emit-freeze 聚合矩阵	commit:a0b08363
块注释侧口径不变（core 的 sanitizeCommentText 仍转义闭合序列）	dup:emit-freeze 聚合矩阵	commit:a0b08363
zod: `// ` 注记行保留闭合序列	dup:emit-freeze 聚合矩阵	commit:a0b08363
standard-schema: `// ` 注记行保留闭合序列	dup:emit-freeze 聚合矩阵	commit:a0b08363
keeps a CRLF sidecar pure CRLF (no mixed line terminators)	dup:emit-freeze 聚合矩阵	commit:a0b08363
keeps a UTF-8 BOM sidecar's BOM and reports no change on a no-op emit	dup:emit-freeze 聚合矩阵	commit:a0b08363
handles a sidecar without a trailing newline (idempotent, still loadable)	dup:emit-freeze 聚合矩阵	commit:a0b08363
negative control: an LF sidecar keeps LF (no CRLF introduced)	dup:emit-freeze 聚合矩阵	commit:a0b08363
BOM 仍在文件最前（不被挪到文件中段），全文只有一枚	dup:emit-freeze 聚合矩阵	commit:a0b08363
BOM 不被当成缩进抄进新插入的 JSDoc 块（\s 含 U+FEFF）	dup:emit-freeze 聚合矩阵	commit:a0b08363
剥离已生成指令时 BOM 不丢（首行整块被删也不丢）	dup:emit-freeze 聚合矩阵	commit:a0b08363
负控制：手写 case（无 call@ 命名）不动，BOM 也不动	dup:emit-freeze 聚合矩阵	commit:a0b08363
两侧都带 BOM ⇒ 首行是公共行（无内容差异）	dup:emit-freeze 聚合矩阵	commit:a0b08363
只有一侧带 BOM ⇒ 首行如实呈现为内容差异（不谎报「无改动」）	dup:emit-freeze 聚合矩阵	commit:a0b08363
diff 的首行保留 BOM（native git 同形：上下文行含 BOM，补丁才贴得上）	dup:emit-freeze 聚合矩阵	commit:a0b08363
调用点 1 次 vs 2 次：派生行（参数位 + 返回位）完全一致	dup:emit-freeze 聚合矩阵	commit:a0b08363
落盘侧车的契约行一致（组合式精确，不是 1 ULP 展开式）	dup:emit-freeze 聚合矩阵	commit:a0b08363
两种形态的**接受集合相同**（生效契约：x > 1，返回 > 3）	dup:emit-freeze 聚合矩阵	commit:a0b08363
负控制：两个调用点实参不同 ⇒ 不可投影（不得产出非法侧车）	dup:emit-freeze 聚合矩阵	commit:a0b08363
负控制：单调用点的既有组合式形态不变	dup:emit-freeze 聚合矩阵	commit:a0b08363
```
