# packages/lsp/src/__tests__/lsp-semantic-tokens.test.ts

模块套件：18 个用例。根因底稿取自现有注释；动作与缺口待逐行复核。

```audit
title	rootCause	gap	action	status	evidence
"真 server 返回完整 token 列表（位置 + 档位）"	"语义 token 面漏标——类名 / 类方法 / 类字段 / 方法形参 / 解构绑定。 症状（真 server semanticTokens/full）： - `export class K { m(p) {…} }` 只有 `p` 上色，`K` / `m` 全丢；"	没测该层	keep	keep	—
"图例里有 class 档（只追加不重排 ⇒ 老索引不变）"	"语义 token 面漏标——类名 / 类方法 / 类字段 / 方法形参 / 解构绑定。 症状（真 server semanticTokens/full）： - `export class K { m(p) {…} }` 只有 `p` 上色，`K` / `m` 全丢；"	没测该层	keep	keep	—
"`\\u0061bc` 的 token 覆盖整个源码写法（8 个 UTF-16 code unit）"	"标识符 token 的长度按「名字」算 ⇒ 转义写法的源码跨度对不上。 症状：`const \\u0061bc = 1;"	没测该层	keep	keep	—
"普通标识符长度不变（名字 == 源码写法）"	"标识符 token 的长度按「名字」算 ⇒ 转义写法的源码跨度对不上。 症状：`const \\u0061bc = 1;"	没测该层	keep	keep	—
"非 BMP 字符之后的位置按 UTF-16 code unit 记（emoji 占 2）"	"标识符 token 的长度按「名字」算 ⇒ 转义写法的源码跨度对不上。 症状：`const \\u0061bc = 1;"	没测该层	keep	keep	—
"parse 失败的 buffer：字符串内部的文本不产生 token"	"具体到复现坐标：`fake`（char 16，len 4）不得被当成变量声明 字符串字面量的内部区间（第 2 行，0 基）：char 10..19（不含两侧引号）。"	夹具漏形态	keep	keep	—
"对照：字符串外面的声明位照常上色（遮罩没有把整行吃掉）"	"字符串字面量的内部区间（第 2 行，0 基）：char 10..19（不含两侧引号）。"	夹具漏形态	keep	keep	—
"对照：关键字后的字符串同样不被扫成代码（`typeof` 口径）"	"` ⇒ 字符串内容在 char 17..26 字符串字面量的内部区间（第 2 行，0 基）：char 10..19（不含两侧引号）。"	夹具漏形态	keep	keep	—
"对象解构绑定 → variable（declaration）"	"症状（真 server semanticTokens/full）： - `export const { a, b } = obj; ` 的 `x`（简写引用）→ property 档 **且带 declaration modifier**（它是对变量的引用，不是属性定义）。"	没测该层	keep	keep	—
"对象字面量简写 `{ x }` → variable 且不带 declaration modifier"	"症状（真 server semanticTokens/full）： - `export const { a, b } = obj; ` 的 `x`（简写引用）→ property 档 **且带 declaration modifier**（它是对变量的引用，不是属性定义）。"	没测该层	keep	keep	—
"handwritten export function declaration gets contract modifier"	"A7：semantic tokens 对齐 contract 档 - export 函数绑定带 contract / generated / derived modifier - 非导出只带 declaration（不假装进档） - 与 CodeLens / hover 共用 contractTierOf（同源）"	没测该层	keep	keep	—
"generated export gets generated modifier"	"A7：semantic tokens 对齐 contract 档 - export 函数绑定带 contract / generated / derived modifier - 非导出只带 declaration（不假装进档） - 与 CodeLens / hover 共用 contractTierOf（同源）"	没测该层	keep	keep	—
"implicit export gets derived modifier"	"A7：semantic tokens 对齐 contract 档 - export 函数绑定带 contract / generated / derived modifier - 非导出只带 declaration（不假装进档） - 与 CodeLens / hover 共用 contractTierOf（同源）"	没测该层	keep	keep	—
"non-export function keeps declaration-only modifier"	"A7：semantic tokens 对齐 contract 档 - export 函数绑定带 contract / generated / derived modifier - 非导出只带 declaration（不假装进档） - 与 CodeLens / hover 共用 contractTierOf（同源）"	没测该层	keep	keep	—
"nested same-name FunctionDeclaration does not inherit export contract tier"	"A7：semantic tokens 对齐 contract 档 - export 函数绑定带 contract / generated / derived modifier - 非导出只带 declaration（不假装进档） - 与 CodeLens / hover 共用 contractTierOf（同源）"	没测该层	keep	keep	—
"autoBind:false → derived even with handwritten sidecar"	"A7：semantic tokens 对齐 contract 档 - export 函数绑定带 contract / generated / derived modifier - 非导出只带 declaration（不假装进档） - 与 CodeLens / hover 共用 contractTierOf（同源）"	没测该层	keep	keep	—
"contractTierModifierBit maps three tiers"	"A7：semantic tokens 对齐 contract 档 - export 函数绑定带 contract / generated / derived modifier - 非导出只带 declaration（不假装进档） - 与 CodeLens / hover 共用 contractTierOf（同源）"	没测该层	keep	keep	—
"legend appends contract/generated/derived without reordering prior modifiers"	"A7：semantic tokens 对齐 contract 档 - export 函数绑定带 contract / generated / derived modifier - 非导出只带 declaration（不假装进档） - 与 CodeLens / hover 共用 contractTierOf（同源）"	没测该层	keep	keep	—
```
