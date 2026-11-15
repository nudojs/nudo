# packages/vscode/src/__tests__/vscode-highlight-recompute.test.ts

vscode 扩展的 **active-case 高亮从不随文档编辑重算**： 装饰是**基于文本快照算出的绝对行号区间**，而刷新只挂在 `window.onDidChangeActiveTextEditor` 上 ⇒ `workspace.onDidChangeTextDocument` **未订阅** ⇒ 任何**不切换编辑器**的编辑（打字 / 粘贴 / 格式化）都会让 高亮整体漂移到别的代码上（函数体高亮落在别的函数上、case 注释行落在别的行）。 修法：在 `activate()` 里补 `workspace.onDidChangeTextDocument` 订阅 （推进 `context.subscriptions`）⇒ 编辑后按**新文本**重算装饰。

审计：3 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
"activate() 订阅了 workspace.onDidChangeTextDocument"	"vscode 扩展的 **active-case 高亮从不随文档编辑重算**： 装饰是**基于文本快照算出的绝对行号区间**，而刷新只挂在 `window.onDidChangeActiveTextEditor` 上 ⇒ `workspace.onDidChangeTextDocument` **未订阅** ⇒ 任何**不切换编辑器**的编辑（打字 / 粘贴 / 格式化）都会让 高亮整体漂移到别的代码上（函数体高亮落在别的函数上、case 注释行落在别的行）。 （纯函数侧 `computeCaseDecorationSpans` 本来就按传入文本算 ⇒ 不用改。 断言：expect(host.state.docListeners.l"	没测该层	keep	keep	—
"编辑后高亮按新文本重算（不再冻结在旧行号）"	"断言：expect(before.length).toBeGreaterThan(0);；expect(after.length).toBeGreaterThan(0);"	没测该层	keep	keep	—
"编辑其它文档不影响当前编辑器的装饰"	"断言：expect(after).toEqual(before);"	没测该层	keep	keep	—
```
