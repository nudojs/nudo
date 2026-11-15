# packages/vscode/src/__tests__/vscode-highlight-recompute.test.ts

模块套件：3 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"activate() 订阅了 workspace.onDidChangeTextDocument"	"vscode 扩展的 **active-case 高亮从不随文档编辑重算**： 装饰是**基于文本快照算出的绝对行号区间**，而刷新只挂在 `window.onDidChangeActiveTextEditor` 上 ⇒ `workspace.onDidChangeTextDocument` **未订阅** ⇒ 任何**不切换编辑器**的编辑（打字 / 粘贴 / 格式化）都会让 高亮整体漂移到别的代码上（函数体高亮落在别的函数上、case 注释行落在别的行）。 （纯函数侧 `computeCaseDecoratio"	没测该层	keep	keep	—
"编辑后高亮按新文本重算（不再冻结在旧行号）"	"vscode 扩展的 **active-case 高亮从不随文档编辑重算**： 装饰是**基于文本快照算出的绝对行号区间**，而刷新只挂在 `window.onDidChangeActiveTextEditor` 上 ⇒ `workspace.onDidChangeTextDocument` **未订阅** ⇒ 任何**不切换编辑器**的编辑（打字 / 粘贴 / 格式化）都会让 高亮整体漂移到别的代码上（函数体高亮落在别的函数上、case 注释行落在别的行）。 （纯函数侧 `computeCaseDecoratio"	没测该层	keep	keep	—
"编辑其它文档不影响当前编辑器的装饰"	"vscode 扩展的 **active-case 高亮从不随文档编辑重算**： 装饰是**基于文本快照算出的绝对行号区间**，而刷新只挂在 `window.onDidChangeActiveTextEditor` 上 ⇒ `workspace.onDidChangeTextDocument` **未订阅** ⇒ 任何**不切换编辑器**的编辑（打字 / 粘贴 / 格式化）都会让 高亮整体漂移到别的代码上（函数体高亮落在别的函数上、case 注释行落在别的行）。 （纯函数侧 `computeCaseDecoratio"	没测该层	keep	keep	—
```
