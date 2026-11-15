# packages/vscode/src/__tests__/vscode-extension.test.ts

模块套件：13 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"CRLF 与 LF 的 span 几何完全一致（只有 EOL 不同）"	"行可见长度 = 行终止符不属于该行 ⇒ 切行后该行的字符数。"	没测该层	keep	keep	—
"行号不受行尾影响（切行口径与 Babel 的 loc 行号仍对齐）"	"行可见长度 = 行终止符不属于该行 ⇒ 切行后该行的字符数。"	没测该层	keep	keep	—
"打包脚本成功产出 server artifact"	"发布的 VSIX 里 **LSP server 不是自包含的** ⇒ 扩展的语言服务器 **启动即崩** `ERR_MODULE_NOT_FOUND`； 而 CI 的 smoke 门禁在 monorepo 布局里 跑 ⇒ **假绿放行**。"	没测该层	keep	keep	—
"产物里没有任何裸包 import（自包含 ⇒ 0 条外部依赖）"	"发布的 VSIX 里 **LSP server 不是自包含的** ⇒ 扩展的语言服务器 **启动即崩** `ERR_MODULE_NOT_FOUND`； 而 CI 的 smoke 门禁在 monorepo 布局里 跑 ⇒ **假绿放行**。"	没测该层	keep	keep	—
"产物在**没有 node_modules 的目录**（VSIX 布局）里能启动"	"发布的 VSIX 里 **LSP server 不是自包含的** ⇒ 扩展的语言服务器 **启动即崩** `ERR_MODULE_NOT_FOUND`； 而 CI 的 smoke 门禁在 monorepo 布局里 跑 ⇒ **假绿放行**。"	没测该层	keep	keep	—
"打包脚本是**再打一次 bundle**（不再只是 cp）"	"发布的 VSIX 里 **LSP server 不是自包含的** ⇒ 扩展的语言服务器 **启动即崩** `ERR_MODULE_NOT_FOUND`； 而 CI 的 smoke 门禁在 monorepo 布局里 跑 ⇒ **假绿放行**。"	没测该层	keep	keep	—
"自检面：打包脚本自己在隔离布局里验过产物（构建期即失败）"	"发布的 VSIX 里 **LSP server 不是自包含的** ⇒ 扩展的语言服务器 **启动即崩** `ERR_MODULE_NOT_FOUND`； 而 CI 的 smoke 门禁在 monorepo 布局里 跑 ⇒ **假绿放行**。"	没测该层	keep	keep	—
"打包脚本成功产出 server artifact"	"发布的 VSIX 里 **LSP server 是 ESM，但 `packages/vscode/package.json` 没有 `\"type\": \"module\"`** ⇒ Node < 22.18（**无模块语法检测**）的扩展宿主上 语言服务器起不来：`SyntaxError: Cannot use import statement outside a module` ⇒ 整个 IDE 侧产品零功能； 而 CI **从不测 VSIX** ⇒ **恒绿**。"	没测该层	keep	keep	—
"产物旁有 {\"type\":\"module\"} 的清单（Node 只看最近的 package.json）"	"发布的 VSIX 里 **LSP server 是 ESM，但 `packages/vscode/package.json` 没有 `\"type\": \"module\"`** ⇒ Node < 22.18（**无模块语法检测**）的扩展宿主上 语言服务器起不来：`SyntaxError: Cannot use import statement outside a module` ⇒ 整个 IDE 侧产品零功能； 而 CI **从不测 VSIX** ⇒ **恒绿**。"	没测该层	keep	keep	—
"根清单**没有**把整个包翻成 ESM（CJS 扩展包 out/extension.js 不受影响）"	"发布的 VSIX 里 **LSP server 是 ESM，但 `packages/vscode/package.json` 没有 `\"type\": \"module\"`** ⇒ Node < 22.18（**无模块语法检测**）的扩展宿主上 语言服务器起不来：`SyntaxError: Cannot use import statement outside a module` ⇒ 整个 IDE 侧产品零功能； 而 CI **从不测 VSIX** ⇒ **恒绿**。"	没测该层	keep	keep	—
"node --no-experimental-detect-module 下产物仍能启动（ESM 身份是显式的）"	"发布的 VSIX 里 **LSP server 是 ESM，但 `packages/vscode/package.json` 没有 `\"type\": \"module\"`** ⇒ Node < 22.18（**无模块语法检测**）的扩展宿主上 语言服务器起不来：`SyntaxError: Cannot use import statement outside a module` ⇒ 整个 IDE 侧产品零功能； 而 CI **从不测 VSIX** ⇒ **恒绿**。"	没测该层	keep	keep	—
"没有 ESM 清单时，同一份产物在同样的 Node 语义下**起不来**（钉住因果）"	"把清单拿走 ⇒ Node 只剩「模块语法检测」这条兜底 ⇒ 在关闭检测的语义下必须失败（否则本钉的第一条断言就没有约束力）。 发布的 VSIX 里 **LSP server 是 ESM，但 `packages/vscode/package.json` 没有 `\"type\": \"module\"`** ⇒ Node < 22.18（**无模块语法检测**）的扩展宿主上 语言服务器起不来：`SyntaxError: Cannot use import statement outside a module` ⇒ 整个 ID"	没测该层	keep	keep	—
"打包脚本负责写 ESM 清单（不是靠根清单）"	"发布的 VSIX 里 **LSP server 是 ESM，但 `packages/vscode/package.json` 没有 `\"type\": \"module\"`** ⇒ Node < 22.18（**无模块语法检测**）的扩展宿主上 语言服务器起不来：`SyntaxError: Cannot use import statement outside a module` ⇒ 整个 IDE 侧产品零功能； 而 CI **从不测 VSIX** ⇒ **恒绿**。"	没测该层	keep	keep	—
```
