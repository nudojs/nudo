# packages/lsp/src/__tests__/lsp-semantic-tokens.test.ts

模块套件：semanticTokens 面（层级 / 字符串掩码 / 简写 / 类解构 / 转义长度）。

审计：18 个用例；根因取自测试注释，缺口按四分类判定，动作复核后为 keep。

```audit
title	rootCause	gap	action	status	evidence
"真 server 返回完整 token 列表（位置 + 档位）"	"语义 token 面漏标——类名 / 类方法 / 类字段 / 方法形参 / 解构绑定。 症状（真 server semanticTokens/full）： - `export class K { m(p) {…} }` 只有 `p` 上色，`K` / `m` 全丢； 断言：expect(tokens).toEqual(["	没测该层	keep	keep	—
"图例里有 class 档（只追加不重排 ⇒ 老索引不变）"	"语义 token 面漏标——类名 / 类方法 / 类字段 / 方法形参 / 解构绑定。 症状（真 server semanticTokens/full）： - `export class K { m(p) {…} }` 只有 `p` 上色，`K` / `m` 全丢； 断言：expect(SEMANTIC_TOKEN_TYPES[0]).toBe(\"function\");；expect(SEMANTIC_TOKEN_TYPES[1]).toBe(\"variable\");"	没测该层	keep	keep	—
"`\\u0061bc` 的 token 覆盖整个源码写法（8 个 UTF-16 code unit）"	"标识符 token 的长度按「名字」算 ⇒ 转义写法的源码跨度对不上。 症状：`const \\u0061bc = 1; 断言：expect(tokens).toEqual(["	没测该层	keep	keep	—
"普通标识符长度不变（名字 == 源码写法）"	"标识符 token 的长度按「名字」算 ⇒ 转义写法的源码跨度对不上。 症状：`const \\u0061bc = 1; 断言：expect(tokens).toEqual(["	没测该层	keep	keep	—
"非 BMP 字符之后的位置按 UTF-16 code unit 记（emoji 占 2）"	"标识符 token 的长度按「名字」算 ⇒ 转义写法的源码跨度对不上。 症状：`const \\u0061bc = 1; 断言：expect(x).toBeDefined();；expect(x!.char).toBe(src.indexOf(\"x: 2\"));"	没测该层	keep	keep	—
"parse 失败的 buffer：字符串内部的文本不产生 token"	"同一 buffer，但字符串换成裸标识符 ⇒ 降级路径**应当**给 `a` 上色。 断言：expect(inside, JSON.stringify(tokens)).toEqual([]);；expect("	夹具漏形态	keep	keep	—
"对照：字符串外面的声明位照常上色（遮罩没有把整行吃掉）"	"断言：expect(tokens.some((t) => t.line === 0 && t.char === 9 && t.length === 6), JSON.stringify(tokens)).toBe(true);；expect(a, JSON.stringify(tokens)).toBeDefined();"	没测该层	keep	keep	—
"对照：关键字后的字符串同样不被扫成代码（`typeof` 口径）"	"LSP 语义 token 的**降级路径**（parse 失败 ⇒ 词法扫描）里，字符串 **遮罩判据反了** ⇒ 字符串字面量**内部**产生假 token。 根因（`semantic-tokens.ts` 的本地 `maskCommentsAndStrings`）： `isValuePos = prevSignificant === \"\" || !/[A-Za-z0-9_$)\\]]/.test(prevSignificant)` ⇒ **前一个有效字符是标识符字符时反而不遮罩**。 断言：expect(inside, JSON.stringify(tokens)).toEqual([]);"	夹具漏形态	keep	keep	—
"对象解构绑定 → variable（declaration）"	"症状（真 server semanticTokens/full）： - `export const { a, b } = obj; ` 的 `x`（简写引用）→ property 档 **且带 declaration modifier**（它是对变量的引用，不是属性定义）。 断言：expect(tokens).toEqual(["	没测该层	keep	keep	—
"对象字面量简写 `{ x }` → variable 且不带 declaration modifier"	"症状（真 server semanticTokens/full）： - `export const { a, b } = obj; ` 的 `x`（简写引用）→ property 档 **且带 declaration modifier**（它是对变量的引用，不是属性定义）。 断言：expect(shorthand).toBeDefined();；expect(shorthand!.typeIndex).toBe(TYPE_VARIABLE);"	没测该层	keep	keep	—
"handwritten export function declaration gets contract modifier"	"A7：semantic tokens 对齐 contract 档 - export 函数绑定带 contract / generated / derived modifier - 非导出只带 declaration（不假装进档） - 与 CodeLens / hover 共用 contractTierOf（同源） 断言：expect(fnTok).toBeDefined();；expect(fnTok!.modifiers).toBe(MOD_DECLARATION | MOD_CONTRACT);"	没测该层	keep	keep	—
"generated export gets generated modifier"	"A7：semantic tokens 对齐 contract 档 - export 函数绑定带 contract / generated / derived modifier - 非导出只带 declaration（不假装进档） - 与 CodeLens / hover 共用 contractTierOf（同源） 断言：expect(fnTok!.modifiers).toBe(MOD_DECLARATION | MOD_GENERATED);"	没测该层	keep	keep	—
"implicit export gets derived modifier"	"A7：semantic tokens 对齐 contract 档 - export 函数绑定带 contract / generated / derived modifier - 非导出只带 declaration（不假装进档） - 与 CodeLens / hover 共用 contractTierOf（同源） 断言：expect(fnTok!.modifiers).toBe(MOD_DECLARATION | MOD_DERIVED);"	没测该层	keep	keep	—
"non-export function keeps declaration-only modifier"	"A7：semantic tokens 对齐 contract 档 - export 函数绑定带 contract / generated / derived modifier - 非导出只带 declaration（不假装进档） - 与 CodeLens / hover 共用 contractTierOf（同源） 断言：expect(fnTok!.modifiers).toBe(MOD_DECLARATION);"	没测该层	keep	keep	—
"nested same-name FunctionDeclaration does not inherit export contract tier"	"A7：semantic tokens 对齐 contract 档 - export 函数绑定带 contract / generated / derived modifier - 非导出只带 declaration（不假装进档） - 与 CodeLens / hover 共用 contractTierOf（同源） 断言：expect(fnToks.length).toBe(2);；expect(top.modifiers).toBe(MOD_DECLARATION | MOD_CONTRACT);"	没测该层	keep	keep	—
"autoBind:false → derived even with handwritten sidecar"	"A7：semantic tokens 对齐 contract 档 - export 函数绑定带 contract / generated / derived modifier - 非导出只带 declaration（不假装进档） - 与 CodeLens / hover 共用 contractTierOf（同源） 断言：expect(fnTok!.modifiers).toBe(MOD_DECLARATION | MOD_DERIVED);"	没测该层	keep	keep	—
"contractTierModifierBit maps three tiers"	"断言：expect(contractTierModifierBit(\"handwritten\")).toBe(MOD_CONTRACT);；expect(contractTierModifierBit(\"generated\")).toBe(MOD_GENERATED);"	没测该层	keep	keep	—
"legend appends contract/generated/derived without reordering prior modifiers"	"A7：semantic tokens 对齐 contract 档 - export 函数绑定带 contract / generated / derived modifier - 非导出只带 declaration（不假装进档） - 与 CodeLens / hover 共用 contractTierOf（同源） 断言：expect(SEMANTIC_TOKEN_MODIFIERS.slice(0, 4)).toEqual([；expect(SEMANTIC_TOKEN_MODIFIERS.slice(4)).toEqual([\"contract\", \"generated\", \"derived\"]);"	没测该层	keep	keep	—
```
