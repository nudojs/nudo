# packages/lsp/src/__tests__/lsp-symbols.test.ts

模块套件：documentSymbol / workspaceSymbol 面（跨文件/解构/let-var/default/类成员）。

审计：28 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
"lists top-level functions with kind Function"	"断言：expect(fn).toBeDefined();；expect(fn!.kind).toBe(12); // SymbolKind.Function"	没测该层	keep	keep	—
"lists exported const"	"断言：expect(lim).toBeDefined();；expect(lim!.detail).toContain(\"export\");"	没测该层	keep	keep	—
"resolves import binding to target file export"	"断言：expect(ident).toBe(\"computeScorecard\");；expect(def).not.toBeNull();"	没测该层	keep	keep	—
"local definition stays in file"	"documentSymbol + 跨文件 definition / references / rename 的纯函数测试 （不启 live LSP connection）。 断言：expect(ident).toBe(\"decide\");；expect(def!.filePath).toBe(decidePath);"	没测该层	keep	keep	—
"DI-param usage resolves to the local param binding (rename-safe)"	"documentSymbol + 跨文件 definition / references / rename 的纯函数测试 （不启 live LSP connection）。 断言：expect(ident).toBe(\"computeScorecard\");；expect(def).not.toBeNull();"	没测该层	keep	keep	—
"without fallback DI-param still resolves to local param (not workspace)"	"断言：expect(def).not.toBeNull();；expect(def!.filePath).toBe(scanPath);"	没测该层	keep	keep	—
"import binding wins over fallback"	"断言：expect(def!.filePath).toBe(scorecardPath);；expect(def!.loc.start.line).toBe(1);"	没测该层	keep	keep	—
"unknown name still resolves to null"	"documentSymbol + 跨文件 definition / references / rename 的纯函数测试 （不启 live LSP connection）。 断言：expect(def).toBeNull();"	没测该层	keep	keep	—
"finds importer call sites for exported function"	"断言：expect(ident).toBe(\"computeScorecard\");；expect(inDecide.length).toBeGreaterThan(0);"	没测该层	keep	keep	—
"from importer side, references include definition file + importer sites"	"documentSymbol + 跨文件 definition / references / rename 的纯函数测试 （不启 live LSP connection）。 断言：expect(inScorecard.length).toBeGreaterThan(0);；expect(inScorecard[0]!.loc.start.line).toBe(1);"	没测该层	keep	keep	—
"collects named imports"	"断言：expect(bindings.get(\"computeScorecard\")?.importedName).toBe(\"computeScorecard\");；expect(bindings.get(\"LIMIT\")?.resolvedPath).toBe(scorecardPath);"	没测该层	keep	keep	—
"finds export definition by name"	"documentSymbol + 跨文件 definition / references / rename 的纯函数测试 （不启 live LSP connection）。 断言：expect(def).not.toBeNull();；expect(def!.loc.start.line).toBe(4);"	没测该层	keep	keep	—
"缺省（客户端没发能力段）⇒ 层级式 + 全量 SymbolKind（不得退化）"	"客户端声明：不要层级式 + 只接受 [Function(12), Variable(13)]。 断言：expect(syms.length).toBeGreaterThan(0);；expect(cls, \"缺省时没有 Kls\").toBeTruthy();"	没测该层	keep	keep	—
"hierarchicalDocumentSymbolSupport=false ⇒ 回 SymbolInformation[]（location 形态）"	"`textDocument/documentSymbol` **完全无视客户端 capabilities** ⇒ 客户端声明「不支持层级式」却收到 `DocumentSymbol[]`（**形状违规**）， 且返回的 `SymbolKind` 超出客户端声明的 `valueSet`（**取值违规**）。 根因：`onInitialize` 只回**自己**的能力声明、**从不保存** `params.capabilities` ⇒ `onDocumentSymbol` 永远按「层级式 + 全量 SymbolKind」输出。 断言：expect(syms.length).toBeGreaterThan(0);；expect(s.loc"	夹具漏形态	keep	keep	—
"symbolKind.valueSet ⇒ 不在集合内的 kind 被夹到集合内（并留 detail 降级提示）"	"夹具：类（含方法）+ 顶层函数 + 顶层变量（kind 各不相同 ⇒ 可验夹取）。 断言：expect([12, 13], `kind ${s.kind} 超出客户端 valueSet [12,13]`).toContain(s.kind);；expect(cls!.kind, \"Class(5) 应被夹到集合内的安全值\").toBe(13);"	夹具漏形态	keep	keep	—
"valueSet 缺省 ⇒ 不夹取（全量 kind）"	"夹具：类（含方法）+ 顶层函数 + 顶层变量（kind 各不相同 ⇒ 可验夹取）。 断言：expect(cls!.kind, \"valueSet 缺省时不应夹取\").toBe(5);；expect(cls!.detail ?? \"\").not.toContain(\"kind clamped\");"	夹具漏形态	keep	keep	—
"纯函数面：4 个解构绑定各出一个符号"	"断言：expect(syms.map((s) => s.name)).toEqual([\"p\", \"q\", \"first\", \"second\", \"plain\", \"f\"]);；expect(hit.kind).toBe(13); // Variable"	没测该层	keep	keep	—
"协议面（真 server）：解构出的 4 个绑定都能在大纲里搜到"	"改前：变量分支对每个 declarator 取 `getDeclaratorId(d)`，而它只在 `decl.id.type === \"Identifier\"` 时返回 id ⇒ 解构声明（ObjectPattern / ArrayPattern）整条 `continue` ⇒ 4 个绑定一个都不出。 断言：expect(syms.map((s) => s.name)).toEqual([\"p\", \"q\", \"first\", \"second\", \"plain\", \"f\"]);；expect(names).toContain(\"p\");"	没测该层	keep	keep	—
"嵌套 / 默认值 / rest 的绑定也展开"	"断言：expect(names).toEqual([\"b\", \"c\", \"rest\", \"x\", \"tail\", \"used\"]);"	没测该层	keep	keep	—
"负控制：普通变量绑定不受影响"	"断言：expect(syms.map((s) => s.name)).toEqual([\"plain\", \"mut\"]);"	没测该层	keep	keep	—
"纯函数面：let / var / const / export 前缀各自正确"	"LSP documentSymbol 把 `let` / `var` 绑定标成 `const`（大纲文案错值）。 改前：`documentSymbols` 的变量分支写死 `detail: exported ? \"export const\" : \"const\"`， 与 `decl.kind`（const / let / var）无关 ⇒ 所有变量绑定都显示成 `const`。 断言：expect(detailOf(\"mutable\")).toBe(\"let\");；expect(detailOf(\"legacy\")).toBe(\"var\");"	旧断言钉错	keep	keep	—
"协议面（真 server）：documentSymbol 响应里的 detail 不是 const"	"LSP documentSymbol 把 `let` / `var` 绑定标成 `const`（大纲文案错值）。 改前：`documentSymbols` 的变量分支写死 `detail: exported ? \"export const\" : \"const\"`， 与 `decl.kind`（const / let / var）无关 ⇒ 所有变量绑定都显示成 `const`。 断言：expect(syms.map((s) => s.name)).toEqual([；expect(detailOf(\"mutable\")).toBe(\"let\");"	旧断言钉错	keep	keep	—
"负控制：kind 仍是 Variable(13)，不被文案改动牵连"	"LSP documentSymbol 把 `let` / `var` 绑定标成 `const`（大纲文案错值）。 改前：`documentSymbols` 的变量分支写死 `detail: exported ? \"export const\" : \"const\"`， 与 `decl.kind`（const / let / var）无关 ⇒ 所有变量绑定都显示成 `const`。 断言：expect(s.kind).toBe(13);"	旧断言钉错	keep	keep	—
"负控制：普通具名导出不受影响"	"断言：expect(syms.map((s) => s.name)).toEqual([\"f\", \"g\"]);"	没测该层	keep	keep	—
"类方法进搜索结果（带 containerName）"	"`workspace/symbol` **从不返回类方法 / 类属性**（只返回类本身）。 根因：`onWorkspaceSymbol`（`server-navigation.ts`）只遍历 `documentSymbols(ast)` 的**顶层**结果，**不下钻 `sym.children`**； 断言：expect(syms.map((s) => s.name), \"类方法没进 workspace/symbol\").toEqual([\"alphaMethod\"]);；expect(syms[0].kind, \"类方法的 kind 应是 Method(6)\").toBe(6);"	没测该层	keep	keep	—
"类属性进搜索结果（带 containerName）"	"`workspace/symbol` **从不返回类方法 / 类属性**（只返回类本身）。 根因：`onWorkspaceSymbol`（`server-navigation.ts`）只遍历 `documentSymbols(ast)` 的**顶层**结果，**不下钻 `sym.children`**； 断言：expect(syms.map((s) => s.name), \"类属性没进 workspace/symbol\").toEqual([\"betaProp\"]);；expect(syms[0].kind, \"类属性的 kind 应是 Property(7)\").toBe(7);"	没测该层	keep	keep	—
"顶层符号仍在（不得因下钻而丢顶层）"	"断言：expect(cls.map((s) => s.name)).toEqual([\"Kls\"]);；expect(cls[0].kind, \"类的 kind 应是 Class(5)\").toBe(5);"	没测该层	keep	keep	—
"对照：同一份 AST 的 documentSymbol 层级式结果含 children（证明同一 AST 两种结果）"	"`workspace/symbol` **从不返回类方法 / 类属性**（只返回类本身）。 根因：`onWorkspaceSymbol`（`server-navigation.ts`）只遍历 `documentSymbols(ast)` 的**顶层**结果，**不下钻 `sym.children`**； 断言：expect(cls, \"documentSymbol 里没有 Kls\").toBeTruthy();；expect((cls!.children ?? []).map((c) => c.name)).toEqual([\"alphaMethod\", \"betaProp\"]);"	没测该层	keep	keep	—
```
