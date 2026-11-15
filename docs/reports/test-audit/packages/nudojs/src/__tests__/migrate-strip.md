# packages/nudojs/src/__tests__/migrate-strip.test.ts

模块套件：16 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"非 declare 的 namespace ⇒ 拒绝写盘 + exit 1"	"一程闸门：产物**不得**落盘 根因：命令层的 TS-only 构造清单（`tsOnlyConstructs`）**没有** `TSModuleDeclaration` / `TSImportEqualsDeclaration`，而 core 的剥除器刻意 保留这两个节点（运行时语义 / 「已知不处理」清单）⇒ 门禁永不命中 ⇒ 写盘 + exit 0。 期望（`commands/migrate.ts` 文件头的自述）：写盘**之前**检出「剥完仍有 TS-only 语法」的目标并**拒绝写盘** + 响亮报错（m"	夹具漏形态	keep	keep	—
"`import x = require(…)` ⇒ 拒绝写盘 + exit 1（且提示里点名该构造）"	"根因：命令层的 TS-only 构造清单（`tsOnlyConstructs`）**没有** `TSModuleDeclaration` / `TSImportEqualsDeclaration`，而 core 的剥除器刻意 保留这两个节点（运行时语义 / 「已知不处理」清单）⇒ 门禁永不命中 ⇒ 写盘 + exit 0。 期望（`commands/migrate.ts` 文件头的自述）：写盘**之前**检出「剥完仍有 TS-only 语法」的目标并**拒绝写盘** + 响亮报错（migrate 是一程闸门）。"	夹具漏形态	keep	keep	—
"--json 面同样是合法失败信封（pathErrors 带文件名）"	"根因：命令层的 TS-only 构造清单（`tsOnlyConstructs`）**没有** `TSModuleDeclaration` / `TSImportEqualsDeclaration`，而 core 的剥除器刻意 保留这两个节点（运行时语义 / 「已知不处理」清单）⇒ 门禁永不命中 ⇒ 写盘 + exit 0。 期望（`commands/migrate.ts` 文件头的自述）：写盘**之前**检出「剥完仍有 TS-only 语法」的目标并**拒绝写盘** + 响亮报错（migrate 是一程闸门）。"	夹具漏形态	keep	keep	—
"反向闸：纯类型剥除照常写盘（门禁不得误伤）"	"根因：命令层的 TS-only 构造清单（`tsOnlyConstructs`）**没有** `TSModuleDeclaration` / `TSImportEqualsDeclaration`，而 core 的剥除器刻意 保留这两个节点（运行时语义 / 「已知不处理」清单）⇒ 门禁永不命中 ⇒ 写盘 + exit 0。 期望（`commands/migrate.ts` 文件头的自述）：写盘**之前**检出「剥完仍有 TS-only 语法」的目标并**拒绝写盘** + 响亮报错（migrate 是一程闸门）。"	夹具漏形态	keep	keep	—
"① strip --write 后 check 覆盖同 stem 的产物 .js（报出产物里的问题）"	"strip 默认**保留源** ⇒ `.ts` 与 `.js` 并存（迁移过渡期的常态） 产物里的问题（`ms` 无标注 ⇒ may throw）必须被报出 ⇒ 产物**被检查了** 被分析的文件是**产物** `.js`（不是源 `.ts`） 一个模块 ⇒ 一次分析（的计数不变式不翻倍） 普通项目（无同 stem 冲突）：`.ts` 与 `.js` **不同 stem** ⇒ 各自被分析。"	没测该层	keep	keep	—
"② 一致性：migrate verify 与 nudo check 对同一包结论一致（都红）"	"改前：verify 红（产物红）/ check 绿（只查源）⇒ 相反结论 ⇒ 假绿 人类面也要看得见「查的是产物」 普通项目（无同 stem 冲突）：`.ts` 与 `.js` **不同 stem** ⇒ 各自被分析。"	门禁未跑	keep	keep	—
"③ 负控：普通项目（无同 stem 冲突）⇒ check 的目标集合不变"	"普通项目（无同 stem 冲突）：`.ts` 与 `.js` **不同 stem** ⇒ 各自被分析。"	没测该层	keep	keep	—
"④ 负控：strip 不带 --write ⇒ .js 未生成 ⇒ check 行为不变（仍查源）"	"无产物 ⇒ 源照旧被分析（行为不变） 普通项目（无同 stem 冲突）：`.ts` 与 `.js` **不同 stem** ⇒ 各自被分析。"	没测该层	keep	keep	—
"语法错文件 ⇒ 报错点名文件 + 一个字节都不落盘"	"错误信息必须点名文件（改前只有 \"Unexpected token (2:12)\"） 族 56b：失败以**一行错误**返回（不再整批 throw）⇒ 断言改到失败行上。 半写状态：改前 a-good.js 已落盘 ⇒ 现在必须没有任何产物 `migrate strip --write` 遇语法错文件时留下半写状态，且错误信息不含文件名。 根因：逐文件 read → strip → write（无事务），前一个文件已落盘、后一个失败不回滚；"	没测该层	keep	keep	—
"语法错文件 ⇒ 错误信息同时含文件名与解析位置"	"族 56b：失败以**一行错误**返回（`code` + `error`）—— 断言要点不变。 `migrate strip --write` 遇语法错文件时留下半写状态，且错误信息不含文件名。 根因：逐文件 read → strip → write（无事务），前一个文件已落盘、后一个失败不回滚；"	没测该层	keep	keep	—
"既有 util.js ⇒ 拒绝写入并报错（exit 非 0），手写内容原样保留"	"手写 JS 必须原样保留（改前：整段被覆盖，legacy() 消失） `migrate strip --write` 静默覆盖同目录既有的同名 `.js`（手写 JS 丢失）。 根因：`foo.ts → foo.js` 是**不同文件** ⇒ 既有的存在性守卫完全失效；"	夹具漏形态	keep	keep	—
"--backup ⇒ 既有产物先备份再写（不丢数据）"	"产物被写出 既有内容进了备份（不丢数据） 备份动作在输出里可观测 `migrate strip --write` 静默覆盖同目录既有的同名 `.js`（手写 JS 丢失）。 根因：`foo.ts → foo.js` 是**不同文件** ⇒ 既有的存在性守卫完全失效；"	夹具漏形态	keep	keep	—
"幂等重跑（目标内容逐字相同）⇒ 不报错、不丢内容"	"`migrate strip --write` 静默覆盖同目录既有的同名 `.js`（手写 JS 丢失）。 根因：`foo.ts → foo.js` 是**不同文件** ⇒ 既有的存在性守卫完全失效；"	夹具漏形态	keep	keep	—
".tsx ⇒ 明确报错（不静默 exit 0），且不落任何产物"	"改前：Comp.jsx 落盘（Node: ERR_UNKNOWN_FILE_EXTENSION） `migrate strip` 把 `.tsx` 映射成 `.jsx`：Node 加载不了，且不被任何门禁分析。 根因：扩展名映射断言了「产物是 JSX」，但 strip 的产品约束是「只剥类型」 （TS 剥除 ≠ 编译变换）——JSX 需要 JSX 变换才能变成可加载的 JS。"	没测该层	keep	keep	—
"目录里有 .tsx ⇒ 整批不落盘（不留半写状态）"	"`migrate strip` 把 `.tsx` 映射成 `.jsx`：Node 加载不了，且不被任何门禁分析。 根因：扩展名映射断言了「产物是 JSX」，但 strip 的产品约束是「只剥类型」 （TS 剥除 ≠ 编译变换）——JSX 需要 JSX 变换才能变成可加载的 JS。"	没测该层	keep	keep	—
"报错信息说明 strip 不做 JSX 变换（可操作）"	"`migrate strip` 把 `.tsx` 映射成 `.jsx`：Node 加载不了，且不被任何门禁分析。 根因：扩展名映射断言了「产物是 JSX」，但 strip 的产品约束是「只剥类型」 （TS 剥除 ≠ 编译变换）——JSX 需要 JSX 变换才能变成可加载的 JS。"	没测该层	keep	keep	—
```
