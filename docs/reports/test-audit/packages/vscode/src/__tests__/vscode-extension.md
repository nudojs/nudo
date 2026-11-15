# packages/vscode/src/__tests__/vscode-extension.test.ts

模块套件：VS Code 扩展面（palette/highlight/CRLF/VSIX/server ESM）。

审计：13 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
"CRLF 与 LF 的 span 几何完全一致（只有 EOL 不同）"	"根因（`packages/vscode/src/case-decorations.ts` 的 `computeCaseDecorationSpans`）： 行切分用 `source.split(\"\\n\")` ⇒ 每行末尾的 `\\r` 留在行内容里 ⇒ 行长被多算 1； 而 VS Code / LSP 的 `Position.character` 语义是**行可见长度**（行终止符 不属于该行）⇒ `endChar` 越界 1 列（函数档与 case-comment 档**同时**中招）。 断言：expect(crlf).toEqual(lf);"	没测该层	keep	keep	—
"行号不受行尾影响（切行口径与 Babel 的 loc 行号仍对齐）"	"断言：expect(crlf.map((s) => [s.startLine, s.endLine])).toEqual("	没测该层	keep	keep	—
"打包脚本成功产出 server artifact"	"发布的 VSIX 里 **LSP server 不是自包含的** ⇒ 扩展的语言服务器 **启动即崩** `ERR_MODULE_NOT_FOUND`； 而 CI 的 smoke 门禁在 monorepo 布局里 跑 ⇒ **假绿放行**。 断言：expect(run.status, run.stderr).toBe(0);；expect(existsSync(run.artifact)).toBe(true);"	没测该层	keep	keep	—
"产物里没有任何裸包 import（自包含 ⇒ 0 条外部依赖）"	"发布的 VSIX 里 **LSP server 不是自包含的** ⇒ 扩展的语言服务器 **启动即崩** `ERR_MODULE_NOT_FOUND`； 而 CI 的 smoke 门禁在 monorepo 布局里 跑 ⇒ **假绿放行**。 断言：expect(externalPackageImports(run.artifact)).toEqual([]);"	没测该层	keep	keep	—
"产物在**没有 node_modules 的目录**（VSIX 布局）里能启动"	"发布的 VSIX 里 **LSP server 不是自包含的** ⇒ 扩展的语言服务器 **启动即崩** `ERR_MODULE_NOT_FOUND`； 而 CI 的 smoke 门禁在 monorepo 布局里 跑 ⇒ **假绿放行**。 断言：expect(isolated.stderr).not.toMatch(/Cannot find package|ERR_MODULE_NOT_FOUND/);；expect(isolated.stdout).toContain(\"NUDO_FAKE_LSP_SERVER\");"	没测该层	keep	keep	—
"打包脚本是**再打一次 bundle**（不再只是 cp）"	"发布的 VSIX 里 **LSP server 不是自包含的** ⇒ 扩展的语言服务器 **启动即崩** `ERR_MODULE_NOT_FOUND`； 而 CI 的 smoke 门禁在 monorepo 布局里 跑 ⇒ **假绿放行**。 断言：expect(src).toMatch(/bundle:\\s*true/);；expect(src).toMatch(/esbuild/);"	没测该层	keep	keep	—
"自检面：打包脚本自己在隔离布局里验过产物（构建期即失败）"	"断言：expect(src).toMatch(/assertSelfContained/);；expect(src).toMatch(/mkdtemp/);"	没测该层	keep	keep	—
"打包脚本成功产出 server artifact"	"发布的 VSIX 里 **LSP server 是 ESM，但 `packages/vscode/package.json` 没有 `\"type\": \"module\"`** ⇒ Node < 22.18（**无模块语法检测**）的扩展宿主上 语言服务器起不来：`SyntaxError: Cannot use import statement outside a module` ⇒ 整个 IDE 侧产品零功能； 而 CI **从不测 VSIX** ⇒ **恒绿**。 断言：expect(run.status, run.stderr).toBe(0);；expect(existsSync(run.artifact)).toBe(true"	没测该层	keep	keep	—
"产物旁有 {\"type\":\"module\"} 的清单（Node 只看最近的 package.json）"	"发布的 VSIX 里 **LSP server 是 ESM，但 `packages/vscode/package.json` 没有 `\"type\": \"module\"`** ⇒ Node < 22.18（**无模块语法检测**）的扩展宿主上 语言服务器起不来：`SyntaxError: Cannot use import statement outside a module` ⇒ 整个 IDE 侧产品零功能； 而 CI **从不测 VSIX** ⇒ **恒绿**。 断言：expect(existsSync(run.manifest)).toBe(true);；expect(manifest.type).toBe(\"module\");"	没测该层	keep	keep	—
"根清单**没有**把整个包翻成 ESM（CJS 扩展包 out/extension.js 不受影响）"	"发布的 VSIX 里 **LSP server 是 ESM，但 `packages/vscode/package.json` 没有 `\"type\": \"module\"`** ⇒ Node < 22.18（**无模块语法检测**）的扩展宿主上 语言服务器起不来：`SyntaxError: Cannot use import statement outside a module` ⇒ 整个 IDE 侧产品零功能； 而 CI **从不测 VSIX** ⇒ **恒绿**。 断言：expect(manifest.type).toBeUndefined();；expect(manifest.main).toBe(\"./out/extension"	没测该层	keep	keep	—
"node --no-experimental-detect-module 下产物仍能启动（ESM 身份是显式的）"	"发布的 VSIX 里 **LSP server 是 ESM，但 `packages/vscode/package.json` 没有 `\"type\": \"module\"`** ⇒ Node < 22.18（**无模块语法检测**）的扩展宿主上 语言服务器起不来：`SyntaxError: Cannot use import statement outside a module` ⇒ 整个 IDE 侧产品零功能； 而 CI **从不测 VSIX** ⇒ **恒绿**。 断言：expect(isolated.stderr).not.toMatch(；expect(isolated.stdout).toContain(\"NUDO_FAKE_"	没测该层	keep	keep	—
"没有 ESM 清单时，同一份产物在同样的 Node 语义下**起不来**（钉住因果）"	"发布的 VSIX 里 **LSP server 是 ESM，但 `packages/vscode/package.json` 没有 `\"type\": \"module\"`** ⇒ Node < 22.18（**无模块语法检测**）的扩展宿主上 语言服务器起不来：`SyntaxError: Cannot use import statement outside a module` ⇒ 整个 IDE 侧产品零功能； 而 CI **从不测 VSIX** ⇒ **恒绿**。 断言：expect(isolated.stdout).not.toContain(\"NUDO_FAKE_LSP_SERVER\");"	没测该层	keep	keep	—
"打包脚本负责写 ESM 清单（不是靠根清单）"	"发布的 VSIX 里 **LSP server 是 ESM，但 `packages/vscode/package.json` 没有 `\"type\": \"module\"`** ⇒ Node < 22.18（**无模块语法检测**）的扩展宿主上 语言服务器起不来：`SyntaxError: Cannot use import statement outside a module` ⇒ 整个 IDE 侧产品零功能； 而 CI **从不测 VSIX** ⇒ **恒绿**。 断言：expect(src).toMatch(/type:\\s*\"module\"/);"	没测该层	keep	keep	—
```
