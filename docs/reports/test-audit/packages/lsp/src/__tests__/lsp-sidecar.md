# packages/lsp/src/__tests__/lsp-sidecar.test.ts

模块套件：LSP sidecar 面（autobind/编辑 range/非法绑定/未保存缓冲/插入）。 single-writer 因模块级 vi.mock 保留独立入口。

审计：25 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
"非法非布尔 autoBind ⇒ 指纹与「不写」相同（行为相同 ⇒ 不得 miss 缓存）"	"回归（LSP 面）：项目配置指纹用了**未归一**的 `autoBind` （`cfg.contract?.autoBind ?? true`），而分析面读的是 **service 侧归一后** 的值（`contractConfig`）⇒ 两者口径分裂。 后果：把 `autoBind` 写成非布尔（非法形状，如 `\"false\"`）时，归一回落 `true` ⇒ 有效行为与「不写」**完全相同**，但原始指纹不同 ⇒ 用户只改了这 处无效写法也会 miss analysisCache ⇒ 全量重算（性能）＋ 行为漂移风险。 断言：expect(fingerprintOf(bogusAutoBind)).toBe(fingerprin"	夹具漏形态	keep	keep	—
"非法非布尔 autoBind ⇒ 指纹与「省略整个 contract」相同"	"回归（LSP 面）：项目配置指纹用了**未归一**的 `autoBind` （`cfg.contract?.autoBind ?? true`），而分析面读的是 **service 侧归一后** 的值（`contractConfig`）⇒ 两者口径分裂。 后果：把 `autoBind` 写成非布尔（非法形状，如 `\"false\"`）时，归一回落 `true` ⇒ 有效行为与「不写」**完全相同**，但原始指纹不同 ⇒ 用户只改了这 处无效写法也会 miss analysisCache ⇒ 全量重算（性能）＋ 行为漂移风险。 断言：expect(fingerprintOf(bogus)).toBe(fingerprintOf(bare"	夹具漏形态	keep	keep	—
"合法 autoBind:false ⇒ 指纹与 true 不同（行为确实变了 ⇒ 必须 miss）"	"回归（LSP 面）：项目配置指纹用了**未归一**的 `autoBind` （`cfg.contract?.autoBind ?? true`），而分析面读的是 **service 侧归一后** 的值（`contractConfig`）⇒ 两者口径分裂。 后果：把 `autoBind` 写成非布尔（非法形状，如 `\"false\"`）时，归一回落 `true` ⇒ 有效行为与「不写」**完全相同**，但原始指纹不同 ⇒ 用户只改了这 处无效写法也会 miss analysisCache ⇒ 全量重算（性能）＋ 行为漂移风险。 断言：expect(fingerprintOf(off)).not.toBe(fingerprintOf(on"	夹具漏形态	keep	keep	—
"侧车已有该 fn 的契约 ⇒ 不下发会写坏侧车的计划"	"断言：expect(sidecarEdits(actions, uri)).toHaveLength(0);"	没测该层	keep	keep	—
"侧车缺该 fn 的契约 ⇒ edit 覆盖既有侧车全文，既有导出仍在且可加载"	"侧车 quickfix 的 edit **退化成头插**（`0:0 → 0:0`）⇒ 落盘后侧车 出现重复 `export const <fn>` ⇒ 侧车整体 SyntaxError ⇒ 侧车里**所有**契约 一起失效（`nudo:contract-load`）⇒ 门禁从「有诊断」变成「装载失败」。 根因与 同源：`agentToolDeps` 被提前捕获（挂载期还是 `undefined`） ⇒ 侧车文本读不到 ⇒ `scSource` 退化成 `\"\"` ⇒ edit 范围只剩头插一行。 断言：expect(edits.length).toBe(1);；expect(e.range.start).toEqual({ line:"	没测该层	keep	keep	—
"值模板绑定不得被当成契约定义"	"断言：expect(defs.filter((d) => d.file === \"lib.nudo.js\")).toEqual([]);；expect(defs[0]?.file).toBe(\"lib.js\");"	没测该层	keep	keep	—
"fn() 形态的导出绑定仍是契约定义（不得误伤）"	"断言：expect(defs).toContainEqual({"	没测该层	keep	keep	—
"源文件 buffer 与磁盘不一致 ⇒ 拒写盘并给出可诊断的错误"	"编辑器里未保存的 buffer：多一个形参 + 一条 case 指令。 断言：expect(r.isError).toBe(true);；expect(r.content[0].text).toContain(\"unsaved buffer changes\");"	没测该层	keep	keep	—
"buffer 与磁盘一致 ⇒ 正常写盘（守卫不误伤）"	"编辑器里未保存的 buffer：多一个形参 + 一条 case 指令。 断言：expect(r.isError).toBeFalsy();；expect(existsSync(join(dir, \"lib.nudo.js\"))).toBe(true);"	没测该层	keep	keep	—
"源文件根本没有落盘（新建未保存）⇒ 同样拒写盘"	"断言：expect(r.isError).toBe(true);；expect(r.content[0].text).toContain(\"unsaved buffer changes\");"	没测该层	keep	keep	—
"inserts into same-line fn({ … }) after the target param's shape brace"	"`findFnContractInsertPos` 的契约（族 23 片 A / 收口后）： 插入点落进**目标形参对应的 `shape({ … })` 内部**（不再落进 `fn(…)` 的 **形参表**顶层 —— 那是「往形参表里多加一个形参」⇒ 契约被写坏）。 定位不到（形参不存在 / 契约类型不是内联 shape / 字段已在契约里）⇒ `null`。 断言：expect(pos.line).toBe(0);；expect(line[pos.character - 1]).toBe(\"{\");"	没测该层	keep	keep	—
"inserts into multiline fn(\\n { … }"	"断言：expect(pos).toEqual({ line: 2, character: lines[2]!.indexOf(\"{\") + 1 });"	没测该层	keep	keep	—
"returns null for shared shape identifier (does not walk into next export)"	"`findFnContractInsertPos` 的契约（族 23 片 A / 收口后）： 插入点落进**目标形参对应的 `shape({ … })` 内部**（不再落进 `fn(…)` 的 **形参表**顶层 —— 那是「往形参表里多加一个形参」⇒ 契约被写坏）。 定位不到（形参不存在 / 契约类型不是内联 shape / 字段已在契约里）⇒ `null`。 断言：expect(findFnContractInsertPos(lines, \"a\", X_Z)).toBeNull();；expect(findFnContractInsertPos(lines, \"b\", { param: \"y\", path: [\"z\"] }))."	没测该层	keep	keep	—
"returns null when export has no fn( before next export"	"`findFnContractInsertPos` 的契约（族 23 片 A / 收口后）： 插入点落进**目标形参对应的 `shape({ … })` 内部**（不再落进 `fn(…)` 的 **形参表**顶层 —— 那是「往形参表里多加一个形参」⇒ 契约被写坏）。 定位不到（形参不存在 / 契约类型不是内联 shape / 字段已在契约里）⇒ `null`。 断言：expect(findFnContractInsertPos(lines, \"a\", X_Z)).toBeNull();"	没测该层	keep	keep	—
"fnName with regex special chars still resolves (identifier equality)"	"断言：expect(line.slice(0, pos.character - 1)).toContain(\"shape(\");"	没测该层	keep	keep	—
"returns null when contract shape is missing"	"`findFnContractInsertPos` 的契约（族 23 片 A / 收口后）： 插入点落进**目标形参对应的 `shape({ … })` 内部**（不再落进 `fn(…)` 的 **形参表**顶层 —— 那是「往形参表里多加一个形参」⇒ 契约被写坏）。 定位不到（形参不存在 / 契约类型不是内联 shape / 字段已在契约里）⇒ `null`。 断言：expect(findFnContractInsertPos(lines, \"foo\", X_Z)).toBeNull();"	没测该层	keep	keep	—
"returns null when the field is already declared in the target shape"	"`findFnContractInsertPos` 的契约（族 23 片 A / 收口后）： 插入点落进**目标形参对应的 `shape({ … })` 内部**（不再落进 `fn(…)` 的 **形参表**顶层 —— 那是「往形参表里多加一个形参」⇒ 契约被写坏）。 定位不到（形参不存在 / 契约类型不是内联 shape / 字段已在契约里）⇒ `null`。 断言：expect(findFnContractInsertPos([line], \"foo\", X_Z)).toBeNull();"	没测该层	keep	keep	—
"string containing // does not truncate the line (URL case)"	"编辑器里未保存的 buffer：多一个形参 + 一条 case 指令。 断言：expect(pos.line).toBe(0);；expect(line.slice(0, pos.character - 1)).toContain(\"shape(\");"	没测该层	keep	keep	—
"brace inside a string does not close the contract object"	"「⚡ persist contract」不得按**未保存的 buffer** 写侧车。 症状（改前）：侧车守卫只挡了**侧车自己**的脏 buffer； 断言：expect(lines[0]!.slice(0, pos.character - 1)).toContain(\"shape(\");"	没测该层	keep	keep	—
"fn( inside a comment is not the call site"	"值模板：引擎不消费（not fn() form） 断言：expect(findFnContractInsertPos(lines, \"foo\", X_Z)).toBeNull();；expect(pos.line).toBe(1);"	没测该层	keep	keep	—
"fn( inside a string is not the call site"	"值模板：引擎不消费（not fn() form） 断言：expect(findFnContractInsertPos(lines, \"foo\", X_Z)).toBeNull();；expect(lines[1]!.slice(0, pos.character - 1)).toContain(\"shape(\");"	没测该层	keep	keep	—
"export name inside a string is not the target binding"	"值模板：引擎不消费（not fn() form） 断言：expect(findFnContractInsertPos(lines, \"foo\", X_Z)).toBeNull();"	没测该层	keep	keep	—
"prefers open buffer text over disk for relative sidecar"	"编辑器里未保存的 buffer：多一个形参 + 一条 case 指令。 断言：expect(load(\"./a.nudo.js\", srcPath)).toBe(open);；expect(load(sidecarPath, srcPath)).toBe(open);"	没测该层	keep	keep	—
"falls back to disk when buffer is closed"	"编辑器里未保存的 buffer：多一个形参 + 一条 case 指令。 断言：expect(out).toContain(\"number()\");"	没测该层	keep	keep	—
"includes sidecar export among definition locations"	"症状：`lib.nudo.js` 里 `export const positive = number().gt(0)`（值模板） 不是引擎消费的契约形态（引擎只消费 `fn({ … }, …)` 形态的导出绑定， 见 packages/core/src/algebra/contract.ts），但 F12 仍跳到它 ⇒ 用户 改多少都不会生效（与 hover / codeLens 的 imp、CLI 的 [implicit] 矛盾）。 断言：expect(ident).toBe(\"add2\");；expect(files).toContain(srcPath);"	夹具漏形态	keep	keep	—
```
