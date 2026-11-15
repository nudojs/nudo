# packages/nudojs/src/__tests__/migrate-strip.test.ts

migrate strip 面（原子写/拒绝覆盖/TS-only/TSX/产品覆盖）。

审计：16 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
"非 declare 的 namespace ⇒ 拒绝写盘 + exit 1"	"根因：命令层的 TS-only 构造清单（`tsOnlyConstructs`）**没有** `TSModuleDeclaration` / `TSImportEqualsDeclaration`，而 core 的剥除器刻意 保留这两个节点（运行时语义 / 「已知不处理」清单）⇒ 门禁永不命中 ⇒ 写盘 + exit 0。 期望（`commands/migrate.ts` 文件头的自述）：写盘**之前**检出「剥完仍有 TS-only 语法」的目标并**拒绝写盘** + 响亮报错（migrate 是一程闸门）。 断言：expect(r.status).toBe(1);；expect(`${r.stdout}${r.stderr}`)"	夹具漏形态	keep	keep	—
"`import x = require(…)` ⇒ 拒绝写盘 + exit 1（且提示里点名该构造）"	"根因：命令层的 TS-only 构造清单（`tsOnlyConstructs`）**没有** `TSModuleDeclaration` / `TSImportEqualsDeclaration`，而 core 的剥除器刻意 保留这两个节点（运行时语义 / 「已知不处理」清单）⇒ 门禁永不命中 ⇒ 写盘 + exit 0。 期望（`commands/migrate.ts` 文件头的自述）：写盘**之前**检出「剥完仍有 TS-only 语法」的目标并**拒绝写盘** + 响亮报错（migrate 是一程闸门）。 断言：expect(r.status).toBe(1);；expect(`${r.stdout}${r.stderr}`)"	夹具漏形态	keep	keep	—
"--json 面同样是合法失败信封（pathErrors 带文件名）"	"断言：expect(r.status).toBe(1);；expect(parsed.ok).toBe(false);"	没测该层	keep	keep	—
"反向闸：纯类型剥除照常写盘（门禁不得误伤）"	"根因：命令层的 TS-only 构造清单（`tsOnlyConstructs`）**没有** `TSModuleDeclaration` / `TSImportEqualsDeclaration`，而 core 的剥除器刻意 保留这两个节点（运行时语义 / 「已知不处理」清单）⇒ 门禁永不命中 ⇒ 写盘 + exit 0。 期望（`commands/migrate.ts` 文件头的自述）：写盘**之前**检出「剥完仍有 TS-only 语法」的目标并**拒绝写盘** + 响亮报错（migrate 是一程闸门）。 断言：expect(r.status, r.stderr).toBe(0);；expect(existsSync(join"	夹具漏形态	keep	keep	—
"① strip --write 后 check 覆盖同 stem 的产物 .js（报出产物里的问题）"	"普通项目（无同 stem 冲突）：`.ts` 与 `.js` **不同 stem** ⇒ 各自被分析。 断言：expect(strip.status, strip.stderr).toBe(0);；expect(existsSync(join(dir, \"src\", \"index.ts\"))).toBe(true);"	没测该层	keep	keep	—
"② 一致性：migrate verify 与 nudo check 对同一包结论一致（都红）"	"`migrate strip --write` 之后**源 `.ts` 仍在** ⇒ `nudo check` （= `migrate retire` 装上的 CI 门禁）**跳过同 stem 的产物 `.js`** ⇒ 发布的产物零覆盖（**假绿**）； 根因：`collectNudoFiles`（`packages/nudojs/src/commands/shared.ts`）的 「同 stem 只取其一」规则把「取哪一份」**硬编码成 `.ts`**（迁移**前**的 事实源：带类型注解 ⇒ 推断更准）⇒ 迁移过渡期（strip → retire 之间， `.ts` 与 `.js` **并存**是常态）恰好取**错**的那一份"	没测该层	keep	keep	—
"③ 负控：普通项目（无同 stem 冲突）⇒ check 的目标集合不变"	"普通项目（无同 stem 冲突）：`.ts` 与 `.js` **不同 stem** ⇒ 各自被分析。 断言：expect(check.status, check.stdout).toBe(0);；expect(files.sort()).toEqual([\"a.ts\", \"b.js\"]);"	没测该层	keep	keep	—
"④ 负控：strip 不带 --write ⇒ .js 未生成 ⇒ check 行为不变（仍查源）"	"`migrate strip --write` 之后**源 `.ts` 仍在** ⇒ `nudo check` （= `migrate retire` 装上的 CI 门禁）**跳过同 stem 的产物 `.js`** ⇒ 发布的产物零覆盖（**假绿**）； 根因：`collectNudoFiles`（`packages/nudojs/src/commands/shared.ts`）的 「同 stem 只取其一」规则把「取哪一份」**硬编码成 `.ts`**（迁移**前**的 事实源：带类型注解 ⇒ 推断更准）⇒ 迁移过渡期（strip → retire 之间， `.ts` 与 `.js` **并存**是常态）恰好取**错**的那一份"	没测该层	keep	keep	—
"语法错文件 ⇒ 报错点名文件 + 一个字节都不落盘"	"`migrate strip --write` 遇语法错文件时留下半写状态，且错误信息不含文件名。 根因：逐文件 read → strip → write（无事务），前一个文件已落盘、后一个失败不回滚； 断言：expect(failed).toHaveLength(1);；expect(failed[0]!.error).toMatch(/z-bad\\.ts/);"	没测该层	keep	keep	—
"语法错文件 ⇒ 错误信息同时含文件名与解析位置"	"`migrate strip --write` 遇语法错文件时留下半写状态，且错误信息不含文件名。 根因：逐文件 read → strip → write（无事务），前一个文件已落盘、后一个失败不回滚； 断言：expect(failed).toHaveLength(1);；expect(failed[0]!.error).toMatch(/bad\\.ts/);"	没测该层	keep	keep	—
"既有 util.js ⇒ 拒绝写入并报错（exit 非 0），手写内容原样保留"	"`migrate strip --write` 静默覆盖同目录既有的同名 `.js`（手写 JS 丢失）。 根因：`foo.ts → foo.js` 是**不同文件** ⇒ 既有的存在性守卫完全失效； 断言：expect(migrateStrip([join(dir, \"util.ts\")], { write: true, draft: false })).rejects.toThrow(；expect(readFileSync(join(dir, \"util.js\"), \"utf-8\")).toBe(HANDWRITTEN);"	夹具漏形态	keep	keep	—
"--backup ⇒ 既有产物先备份再写（不丢数据）"	"`migrate strip --write` 静默覆盖同目录既有的同名 `.js`（手写 JS 丢失）。 根因：`foo.ts → foo.js` 是**不同文件** ⇒ 既有的存在性守卫完全失效； 断言：expect(readFileSync(join(dir, \"util.js\"), \"utf-8\")).toContain(\"function add(a, b)\");；expect(existsSync(join(dir, \"util.js.bak\"))).toBe(true);"	夹具漏形态	keep	keep	—
"幂等重跑（目标内容逐字相同）⇒ 不报错、不丢内容"	"断言：expect(；expect(readFileSync(join(dir, \"util.js\"), \"utf-8\")).toBe(first);"	没测该层	keep	keep	—
".tsx ⇒ 明确报错（不静默 exit 0），且不落任何产物"	"`migrate strip` 把 `.tsx` 映射成 `.jsx`：Node 加载不了，且不被任何门禁分析。 根因：扩展名映射断言了「产物是 JSX」，但 strip 的产品约束是「只剥类型」 （TS 剥除 ≠ 编译变换）——JSX 需要 JSX 变换才能变成可加载的 JS。 断言：expect(migrateStrip([join(dir, \"Comp.tsx\")], { write: true, draft: false })).rejects.toThrow(；expect(existsSync(join(dir, \"Comp.jsx\"))).toBe(false);"	没测该层	keep	keep	—
"目录里有 .tsx ⇒ 整批不落盘（不留半写状态）"	"`migrate strip` 把 `.tsx` 映射成 `.jsx`：Node 加载不了，且不被任何门禁分析。 根因：扩展名映射断言了「产物是 JSX」，但 strip 的产品约束是「只剥类型」 （TS 剥除 ≠ 编译变换）——JSX 需要 JSX 变换才能变成可加载的 JS。 断言：expect(migrateStrip([dir], { write: true, draft: false })).rejects.toThrow(/JSX/);；expect(existsSync(join(dir, \"a.js\"))).toBe(false);"	没测该层	keep	keep	—
"报错信息说明 strip 不做 JSX 变换（可操作）"	"`migrate strip` 把 `.tsx` 映射成 `.jsx`：Node 加载不了，且不被任何门禁分析。 根因：扩展名映射断言了「产物是 JSX」，但 strip 的产品约束是「只剥类型」 （TS 剥除 ≠ 编译变换）——JSX 需要 JSX 变换才能变成可加载的 JS。 断言：expect((err as Error).message).toMatch(/Comp\\.tsx/);；expect((err as Error).message).toMatch(/no JSX transform/);"	没测该层	keep	keep	—
```
