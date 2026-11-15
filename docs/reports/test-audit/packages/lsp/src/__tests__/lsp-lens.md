# packages/lsp/src/__tests__/lsp-lens.test.ts

模块套件：16 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"codeLens 出现 Counter.inc 的 contract 档（契约键 Class.method）"	"导出类的实例方法（`Counter.inc`）在 LSP CodeLens / inlayHint 面 完全不存在。 症状（真 server 协议面）： - `textDocument/codeLens` 里 `Counter.inc` 只有 entry@ 观察层， **没有** `● contract / imp` / `⚡ persist contract` / `⚡ draft contract`；"	没测该层	keep	keep	—
"inlayHint 出现 Counter.inc 的 contract 档 + 返回 inlay"	"contract 档投影（CodeLens 不可见客户端） Abs 返回 inlay（core inlay 面也必须认类方法） 插在方法体 `{` 前（1-based 行 2 ⇒ 0-based 行 1） 导出类的实例方法（`Counter.inc`）在 LSP CodeLens / inlayHint 面 完全不存在。 症状（真 server 协议面）： - `textDocument/codeLens` 里 `Counter.inc` 只有 entry@ 观察层， **没有** `● contract / im"	没测该层	keep	keep	—
"回归护栏：同文件的顶层导出函数不受影响"	"导出类的实例方法（`Counter.inc`）在 LSP CodeLens / inlayHint 面 完全不存在。 症状（真 server 协议面）： - `textDocument/codeLens` 里 `Counter.inc` 只有 entry@ 观察层， **没有** `● contract / imp` / `⚡ persist contract` / `⚡ draft contract`；"	没测该层	keep	keep	—
"export default class 的实例方法同样进 contract 档"	"导出类的实例方法（`Counter.inc`）在 LSP CodeLens / inlayHint 面 完全不存在。 症状（真 server 协议面）： - `textDocument/codeLens` 里 `Counter.inc` 只有 entry@ 观察层， **没有** `● contract / imp` / `⚡ persist contract` / `⚡ draft contract`；"	没测该层	keep	keep	—
"调用方文件的 codeLens 出现跨模块 call@ lens"	"症状（真 server 协议面）： - `lib.js` 导出 `add`，`main.js` 里 `import { add } from \"./lib.js\"` 后调用 `add(x, 2)` —— `main.js` 的 `textDocument/codeLens` **没有** `call@L4` 观察层； - 而 CLI `nudo test main.js` **已经**打印 `--- …/lib.js (imported) ---` / `=== add ===` / `call@L4 …` ——"	没测该层	keep	keep	—
"外部函数的 entry@ 不在调用方文件落镜（属被导入模块）"	"main.js 里只应有 run 的 entry@，不得出现 add 的 entry@ 症状（真 server 协议面）： - `lib.js` 导出 `add`，`main.js` 里 `import { add } from \"./lib.js\"` 后调用 `add(x, 2)` —— `main.js` 的 `textDocument/codeLens` **没有** `call@L4` 观察层； - 而 CLI `nudo test main.js` **已经**打印 `--- …/lib.js (impo"	没测该层	keep	keep	—
"回归护栏：同文件调用点的 call@ lens 形状不变"	"症状（真 server 协议面）： - `lib.js` 导出 `add`，`main.js` 里 `import { add } from \"./lib.js\"` 后调用 `add(x, 2)` —— `main.js` 的 `textDocument/codeLens` **没有** `call@L4` 观察层； - 而 CLI `nudo test main.js` **已经**打印 `--- …/lib.js (imported) ---` / `=== add ===` / `call@L4 …` ——"	没测该层	keep	keep	—
"codeLens 出现默认导出的 contract 档（● contract / imp + 固化动作）"	"症状（真 server 协议面）： - `textDocument/codeLens` 只有 entry@ 观察层，**没有** `● contract / imp` / `⚡ persist contract` / `⚡ draft contract` 三条 contract 档 lens； - `textDocument/inlayHint` 没有 `● contract / imp` 投影 （CodeLens 不可见的客户端靠它看到契约档）；"	没测该层	keep	keep	—
"inlayHint 出现默认导出的 contract 档投影（CodeLens 不可见客户端）"	"症状（真 server 协议面）： - `textDocument/codeLens` 只有 entry@ 观察层，**没有** `● contract / imp` / `⚡ persist contract` / `⚡ draft contract` 三条 contract 档 lens； - `textDocument/inlayHint` 没有 `● contract / imp` 投影 （CodeLens 不可见的客户端靠它看到契约档）；"	没测该层	keep	keep	—
"回归护栏：具名导出不受影响（同一 lens 形状）"	"症状（真 server 协议面）： - `textDocument/codeLens` 只有 entry@ 观察层，**没有** `● contract / imp` / `⚡ persist contract` / `⚡ draft contract` 三条 contract 档 lens； - `textDocument/inlayHint` 没有 `● contract / imp` 投影 （CodeLens 不可见的客户端靠它看到契约档）；"	没测该层	keep	keep	—
"nudo.selectCase 之后 inlayHint refresh 与 codeLens refresh 成对出现"	"选择器变更只广播 `workspace/codeLens/refresh`，从不广播 `workspace/inlayHint/refresh`。 只发 codeLens ⇒ 两个镜像互相矛盾（inlay 仍显示旧档）。"	没测该层	keep	keep	—
"nudo.selectContract 之后 inlayHint refresh 与 codeLens refresh 成对出现"	"选择器变更只广播 `workspace/codeLens/refresh`，从不广播 `workspace/inlayHint/refresh`。 只发 codeLens ⇒ 两个镜像互相矛盾（inlay 仍显示旧档）。"	没测该层	keep	keep	—
"pins call@ at the call-site line with (args) => result title"	"选择器变更只广播 `workspace/codeLens/refresh`，从不广播 `workspace/inlayHint/refresh`。 只发 codeLens ⇒ 两个镜像互相矛盾（inlay 仍显示旧档）。"	没测该层	keep	keep	—
"pins entry@ on the function declaration line"	"选择器变更只广播 `workspace/codeLens/refresh`，从不广播 `workspace/inlayHint/refresh`。 只发 codeLens ⇒ 两个镜像互相矛盾（inlay 仍显示旧档）。"	没测该层	keep	keep	—
"skips directive cases (those stay on case lens layer)"	"选择器变更只广播 `workspace/codeLens/refresh`，从不广播 `workspace/inlayHint/refresh`。 只发 codeLens ⇒ 两个镜像互相矛盾（inlay 仍显示旧档）。"	没测该层	keep	keep	—
"sorts by line and stays empty on unparseable noise without throwing"	"选择器变更只广播 `workspace/codeLens/refresh`，从不广播 `workspace/inlayHint/refresh`。 只发 codeLens ⇒ 两个镜像互相矛盾（inlay 仍显示旧档）。"	没测该层	keep	keep	—
```
