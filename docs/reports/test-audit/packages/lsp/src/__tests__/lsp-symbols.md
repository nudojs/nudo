# packages/lsp/src/__tests__/lsp-symbols.test.ts

模块套件：28 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"lists top-level functions with kind Function"	"documentSymbol + 跨文件 definition / references / rename 的纯函数测试 （不启 live LSP connection）。"	没测该层	keep	keep	—
"lists exported const"	"documentSymbol + 跨文件 definition / references / rename 的纯函数测试 （不启 live LSP connection）。"	没测该层	keep	keep	—
"resolves import binding to target file export"	"documentSymbol + 跨文件 definition / references / rename 的纯函数测试 （不启 live LSP connection）。"	没测该层	keep	keep	—
"local definition stays in file"	"documentSymbol + 跨文件 definition / references / rename 的纯函数测试 （不启 live LSP connection）。"	没测该层	keep	keep	—
"DI-param usage resolves to the local param binding (rename-safe)"	"documentSymbol + 跨文件 definition / references / rename 的纯函数测试 （不启 live LSP connection）。"	没测该层	keep	keep	—
"without fallback DI-param still resolves to local param (not workspace)"	"documentSymbol + 跨文件 definition / references / rename 的纯函数测试 （不启 live LSP connection）。"	没测该层	keep	keep	—
"import binding wins over fallback"	"documentSymbol + 跨文件 definition / references / rename 的纯函数测试 （不启 live LSP connection）。"	没测该层	keep	keep	—
"unknown name still resolves to null"	"documentSymbol + 跨文件 definition / references / rename 的纯函数测试 （不启 live LSP connection）。"	没测该层	keep	keep	—
"finds importer call sites for exported function"	"documentSymbol + 跨文件 definition / references / rename 的纯函数测试 （不启 live LSP connection）。"	没测该层	keep	keep	—
"from importer side, references include definition file + importer sites"	"documentSymbol + 跨文件 definition / references / rename 的纯函数测试 （不启 live LSP connection）。"	没测该层	keep	keep	—
"collects named imports"	"documentSymbol + 跨文件 definition / references / rename 的纯函数测试 （不启 live LSP connection）。"	没测该层	keep	keep	—
"finds export definition by name"	"documentSymbol + 跨文件 definition / references / rename 的纯函数测试 （不启 live LSP connection）。"	没测该层	keep	keep	—
"缺省（客户端没发能力段）⇒ 层级式 + 全量 SymbolKind（不得退化）"	"客户端声明：不要层级式 + 只接受 [Function(12), Variable(13)]。"	没测该层	keep	keep	—
"hierarchicalDocumentSymbolSupport=false ⇒ 回 SymbolInformation[]（location 形态）"	"客户端声明：不要层级式 + 只接受 [Function(12), Variable(13)]。"	没测该层	keep	keep	—
"symbolKind.valueSet ⇒ 不在集合内的 kind 被夹到集合内（并留 detail 降级提示）"	"Class(5) 不在 [12,13] ⇒ 夹到 Variable(13)（客户端声明的集合内） 客户端声明：不要层级式 + 只接受 [Function(12), Variable(13)]。"	没测该层	keep	keep	—
"valueSet 缺省 ⇒ 不夹取（全量 kind）"	"客户端声明：不要层级式 + 只接受 [Function(12), Variable(13)]。"	没测该层	keep	keep	—
"纯函数面：4 个解构绑定各出一个符号"	"range / selectionRange 落在该绑定标识符上（不是整条声明） 改前：变量分支对每个 declarator 取 `getDeclaratorId(d)`，而它只在 `decl.id.type === \"Identifier\"` 时返回 id ⇒ 解构声明（ObjectPattern / ArrayPattern）整条 `continue` ⇒ 4 个绑定一个都不出。"	没测该层	keep	keep	—
"协议面（真 server）：解构出的 4 个绑定都能在大纲里搜到"	"改前：只有 plain / f 两项（count=2） 改前：变量分支对每个 declarator 取 `getDeclaratorId(d)`，而它只在 `decl.id.type === \"Identifier\"` 时返回 id ⇒ 解构声明（ObjectPattern / ArrayPattern）整条 `continue` ⇒ 4 个绑定一个都不出。"	没测该层	keep	keep	—
"嵌套 / 默认值 / rest 的绑定也展开"	"改前：变量分支对每个 declarator 取 `getDeclaratorId(d)`，而它只在 `decl.id.type === \"Identifier\"` 时返回 id ⇒ 解构声明（ObjectPattern / ArrayPattern）整条 `continue` ⇒ 4 个绑定一个都不出。"	没测该层	keep	keep	—
"负控制：普通变量绑定不受影响"	"改前：变量分支对每个 declarator 取 `getDeclaratorId(d)`，而它只在 `decl.id.type === \"Identifier\"` 时返回 id ⇒ 解构声明（ObjectPattern / ArrayPattern）整条 `continue` ⇒ 4 个绑定一个都不出。"	没测该层	keep	keep	—
"纯函数面：let / var / const / export 前缀各自正确"	"LSP documentSymbol 把 `let` / `var` 绑定标成 `const`（大纲文案错值）。 改前：`documentSymbols` 的变量分支写死 `detail: exported ? \"export const\" : \"const\"`， 与 `decl.kind`（const / let / var）无关 ⇒ 所有变量绑定都显示成 `const`。"	旧断言钉错	keep	keep	—
"协议面（真 server）：documentSymbol 响应里的 detail 不是 const"	"改前：6 个变量绑定的 detail 全是 \"const\" / \"export const\" LSP documentSymbol 把 `let` / `var` 绑定标成 `const`（大纲文案错值）。 改前：`documentSymbols` 的变量分支写死 `detail: exported ? \"export const\" : \"const\"`， 与 `decl.kind`（const / let / var）无关 ⇒ 所有变量绑定都显示成 `const`。"	旧断言钉错	keep	keep	—
"负控制：kind 仍是 Variable(13)，不被文案改动牵连"	"LSP documentSymbol 把 `let` / `var` 绑定标成 `const`（大纲文案错值）。 改前：`documentSymbols` 的变量分支写死 `detail: exported ? \"export const\" : \"const\"`， 与 `decl.kind`（const / let / var）无关 ⇒ 所有变量绑定都显示成 `const`。"	旧断言钉错	keep	keep	—
"负控制：普通具名导出不受影响"	"LSP `documentSymbol` 漏掉 `export default <arrow>` 与**匿名** `export default function () {}`。 改前：顶层语句循环只处理 FunctionDeclaration / ClassDeclaration / VariableDeclaration ⇒ `export default` 的声明整条从大纲里消失；"	夹具漏形态	keep	keep	—
"类方法进搜索结果（带 containerName）"	"夹具：类 + 类方法 + 类属性 + 顶层函数（顶层名互不含查询串 ⇒ 断言精确）。"	夹具漏形态	keep	keep	—
"类属性进搜索结果（带 containerName）"	"夹具：类 + 类方法 + 类属性 + 顶层函数（顶层名互不含查询串 ⇒ 断言精确）。"	夹具漏形态	keep	keep	—
"顶层符号仍在（不得因下钻而丢顶层）"	"夹具：类 + 类方法 + 类属性 + 顶层函数（顶层名互不含查询串 ⇒ 断言精确）。"	夹具漏形态	keep	keep	—
"对照：同一份 AST 的 documentSymbol 层级式结果含 children（证明同一 AST 两种结果）"	"夹具：类 + 类方法 + 类属性 + 顶层函数（顶层名互不含查询串 ⇒ 断言精确）。"	夹具漏形态	keep	keep	—
```
