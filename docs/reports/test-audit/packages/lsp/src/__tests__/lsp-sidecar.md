# packages/lsp/src/__tests__/lsp-sidecar.test.ts

模块套件：25 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"非法非布尔 autoBind ⇒ 指纹与「不写」相同（行为相同 ⇒ 不得 miss 缓存）"	"回归（LSP 面）：项目配置指纹用了**未归一**的 `autoBind` （`cfg.contract?.autoBind ?? true`），而分析面读的是 **service 侧归一后** 的值（`contractConfig`）⇒ 两者口径分裂。 后果：把 `autoBind` 写成非布尔（非法形状，如 `\"false\"`）时，归一回落 `true` ⇒ 有效行为与「不写」**完全相同**，但原始指纹不同 ⇒ 用户只改了这 处无效写法也会 miss analysisCache ⇒ 全量重算（性能）＋ 行为漂"	夹具漏形态	keep	keep	—
"非法非布尔 autoBind ⇒ 指纹与「省略整个 contract」相同"	"回归（LSP 面）：项目配置指纹用了**未归一**的 `autoBind` （`cfg.contract?.autoBind ?? true`），而分析面读的是 **service 侧归一后** 的值（`contractConfig`）⇒ 两者口径分裂。 后果：把 `autoBind` 写成非布尔（非法形状，如 `\"false\"`）时，归一回落 `true` ⇒ 有效行为与「不写」**完全相同**，但原始指纹不同 ⇒ 用户只改了这 处无效写法也会 miss analysisCache ⇒ 全量重算（性能）＋ 行为漂"	夹具漏形态	keep	keep	—
"合法 autoBind:false ⇒ 指纹与 true 不同（行为确实变了 ⇒ 必须 miss）"	"回归（LSP 面）：项目配置指纹用了**未归一**的 `autoBind` （`cfg.contract?.autoBind ?? true`），而分析面读的是 **service 侧归一后** 的值（`contractConfig`）⇒ 两者口径分裂。 后果：把 `autoBind` 写成非布尔（非法形状，如 `\"false\"`）时，归一回落 `true` ⇒ 有效行为与「不写」**完全相同**，但原始指纹不同 ⇒ 用户只改了这 处无效写法也会 miss analysisCache ⇒ 全量重算（性能）＋ 行为漂"	夹具漏形态	keep	keep	—
"侧车已有该 fn 的契约 ⇒ 不下发会写坏侧车的计划"	"侧车里**没有** alpha 契约 ⇒ 追加是合法的"	没测该层	keep	keep	—
"侧车缺该 fn 的契约 ⇒ edit 覆盖既有侧车全文，既有导出仍在且可加载"	"覆盖既有侧车全文（不是 0:0 → 0:0 的头插） 既有导出仍在（追加语义） 没有重复 export ⇒ 语法合法（可加载） 语义面：侧车装载失败会报 nudo:contract-load ⇒ 这里不得出现 侧车里**没有** alpha 契约 ⇒ 追加是合法的"	没测该层	keep	keep	—
"值模板绑定不得被当成契约定义"	"值模板：引擎不消费（not fn() form）"	没测该层	keep	keep	—
"fn() 形态的导出绑定仍是契约定义（不得误伤）"	"值模板：引擎不消费（not fn() form）"	没测该层	keep	keep	—
"源文件 buffer 与磁盘不一致 ⇒ 拒写盘并给出可诊断的错误"	"没有侧车落盘 磁盘上的源码没被动过 编辑器里未保存的 buffer：多一个形参 + 一条 case 指令。"	没测该层	keep	keep	—
"buffer 与磁盘一致 ⇒ 正常写盘（守卫不误伤）"	"编辑器里未保存的 buffer：多一个形参 + 一条 case 指令。"	没测该层	keep	keep	—
"源文件根本没有落盘（新建未保存）⇒ 同样拒写盘"	"编辑器里未保存的 buffer：多一个形参 + 一条 case 指令。"	没测该层	keep	keep	—
"inserts into same-line fn({ … }) after the target param's shape brace"	"插入点前是 **shape 的 `{`**（不是形参表的 `{`） `findFnContractInsertPos` 的契约（族 23 片 A / 收口后）： 插入点落进**目标形参对应的 `shape({ … })` 内部**（不再落进 `fn(…)` 的 **形参表**顶层 —— 那是「往形参表里多加一个形参」⇒ 契约被写坏）。 定位不到（形参不存在 / 契约类型不是内联 shape / 字段已在契约里）⇒ `null`。"	没测该层	keep	keep	—
"inserts into multiline fn(\\n { … }"	"`findFnContractInsertPos` 的契约（族 23 片 A / 收口后）： 插入点落进**目标形参对应的 `shape({ … })` 内部**（不再落进 `fn(…)` 的 **形参表**顶层 —— 那是「往形参表里多加一个形参」⇒ 契约被写坏）。 定位不到（形参不存在 / 契约类型不是内联 shape / 字段已在契约里）⇒ `null`。"	没测该层	keep	keep	—
"returns null for shared shape identifier (does not walk into next export)"	"b 的 y 是标量契约 ⇒ 没有 shape 可补 ⇒ null（不猜位置） `findFnContractInsertPos` 的契约（族 23 片 A / 收口后）： 插入点落进**目标形参对应的 `shape({ … })` 内部**（不再落进 `fn(…)` 的 **形参表**顶层 —— 那是「往形参表里多加一个形参」⇒ 契约被写坏）。 定位不到（形参不存在 / 契约类型不是内联 shape / 字段已在契约里）⇒ `null`。"	没测该层	keep	keep	—
"returns null when export has no fn( before next export"	"`findFnContractInsertPos` 的契约（族 23 片 A / 收口后）： 插入点落进**目标形参对应的 `shape({ … })` 内部**（不再落进 `fn(…)` 的 **形参表**顶层 —— 那是「往形参表里多加一个形参」⇒ 契约被写坏）。 定位不到（形参不存在 / 契约类型不是内联 shape / 字段已在契约里）⇒ `null`。"	没测该层	keep	keep	—
"fnName with regex special chars still resolves (identifier equality)"	"`findFnContractInsertPos` 的契约（族 23 片 A / 收口后）： 插入点落进**目标形参对应的 `shape({ … })` 内部**（不再落进 `fn(…)` 的 **形参表**顶层 —— 那是「往形参表里多加一个形参」⇒ 契约被写坏）。 定位不到（形参不存在 / 契约类型不是内联 shape / 字段已在契约里）⇒ `null`。"	没测该层	keep	keep	—
"returns null when contract shape is missing"	"`findFnContractInsertPos` 的契约（族 23 片 A / 收口后）： 插入点落进**目标形参对应的 `shape({ … })` 内部**（不再落进 `fn(…)` 的 **形参表**顶层 —— 那是「往形参表里多加一个形参」⇒ 契约被写坏）。 定位不到（形参不存在 / 契约类型不是内联 shape / 字段已在契约里）⇒ `null`。"	没测该层	keep	keep	—
"returns null when the field is already declared in the target shape"	"`findFnContractInsertPos` 的契约（族 23 片 A / 收口后）： 插入点落进**目标形参对应的 `shape({ … })` 内部**（不再落进 `fn(…)` 的 **形参表**顶层 —— 那是「往形参表里多加一个形参」⇒ 契约被写坏）。 定位不到（形参不存在 / 契约类型不是内联 shape / 字段已在契约里）⇒ `null`。"	没测该层	keep	keep	—
"string containing // does not truncate the line (URL case)"	"`findFnContractInsertPos` 的契约（族 23 片 A / 收口后）： 插入点落进**目标形参对应的 `shape({ … })` 内部**（不再落进 `fn(…)` 的 **形参表**顶层 —— 那是「往形参表里多加一个形参」⇒ 契约被写坏）。 定位不到（形参不存在 / 契约类型不是内联 shape / 字段已在契约里）⇒ `null`。"	没测该层	keep	keep	—
"brace inside a string does not close the contract object"	"`findFnContractInsertPos` 的契约（族 23 片 A / 收口后）： 插入点落进**目标形参对应的 `shape({ … })` 内部**（不再落进 `fn(…)` 的 **形参表**顶层 —— 那是「往形参表里多加一个形参」⇒ 契约被写坏）。 定位不到（形参不存在 / 契约类型不是内联 shape / 字段已在契约里）⇒ `null`。"	没测该层	keep	keep	—
"fn( inside a comment is not the call site"	"`findFnContractInsertPos` 的契约（族 23 片 A / 收口后）： 插入点落进**目标形参对应的 `shape({ … })` 内部**（不再落进 `fn(…)` 的 **形参表**顶层 —— 那是「往形参表里多加一个形参」⇒ 契约被写坏）。 定位不到（形参不存在 / 契约类型不是内联 shape / 字段已在契约里）⇒ `null`。"	没测该层	keep	keep	—
"fn( inside a string is not the call site"	"`findFnContractInsertPos` 的契约（族 23 片 A / 收口后）： 插入点落进**目标形参对应的 `shape({ … })` 内部**（不再落进 `fn(…)` 的 **形参表**顶层 —— 那是「往形参表里多加一个形参」⇒ 契约被写坏）。 定位不到（形参不存在 / 契约类型不是内联 shape / 字段已在契约里）⇒ `null`。"	没测该层	keep	keep	—
"export name inside a string is not the target binding"	"`findFnContractInsertPos` 的契约（族 23 片 A / 收口后）： 插入点落进**目标形参对应的 `shape({ … })` 内部**（不再落进 `fn(…)` 的 **形参表**顶层 —— 那是「往形参表里多加一个形参」⇒ 契约被写坏）。 定位不到（形参不存在 / 契约类型不是内联 shape / 字段已在契约里）⇒ `null`。"	没测该层	keep	keep	—
"prefers open buffer text over disk for relative sidecar"	"`findFnContractInsertPos` 的契约（族 23 片 A / 收口后）： 插入点落进**目标形参对应的 `shape({ … })` 内部**（不再落进 `fn(…)` 的 **形参表**顶层 —— 那是「往形参表里多加一个形参」⇒ 契约被写坏）。 定位不到（形参不存在 / 契约类型不是内联 shape / 字段已在契约里）⇒ `null`。"	没测该层	keep	keep	—
"falls back to disk when buffer is closed"	"`findFnContractInsertPos` 的契约（族 23 片 A / 收口后）： 插入点落进**目标形参对应的 `shape({ … })` 内部**（不再落进 `fn(…)` 的 **形参表**顶层 —— 那是「往形参表里多加一个形参」⇒ 契约被写坏）。 定位不到（形参不存在 / 契约类型不是内联 shape / 字段已在契约里）⇒ `null`。"	没测该层	keep	keep	—
"includes sidecar export among definition locations"	"侧车必须是**引擎真正消费**的形态：`fn({ … }, …)` 的导出绑定。 值模板（`number().int()`）不是契约（见 ），不应出现在 definition 结果里。 `findFnContractInsertPos` 的契约（族 23 片 A / 收口后）： 插入点落进**目标形参对应的 `shape({ … })` 内部**（不再落进 `fn(…)` 的 **形参表**顶层 —— 那是「往形参表里多加一个形参」⇒ 契约被写坏）。 定位不到（形参不存在 / 契约类型不是内联 shape / 字段"	夹具漏形态	keep	keep	—
```
