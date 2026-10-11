---
"@nudojs/core": minor
"@nudojs/lsp": minor
---

参数契约折叠展示（inlay + hover + 签名）：

- **inlay**：侧车 `fn()` 形参表达式原文（如 `where nullable(astNode)`）或 `@nudo:contract` 指令约束名替代谓词无损展开（lazy 判别联合展开可达数万字符），完整谓词经 LSP inlay tooltip 展示。侧车 ∧ 指令并存时展示 `expr ∧ name`（任一文本缺席则整体回落谓词全展）；整表达式别名（`import { astNode as N }` 的裸 `N`）规范化为导入名；派生形参（spread / computed）无静态文本，回落谓词全展。
- **hover**：参数声明位 hover 折叠为声明形态（`node: nullable(astNode)`），函数名 hover 签名的契约参数同口径折叠；函数名 hover 的契约面 display 同步折叠。**体内引用位经求值器重放直读引擎求值态 Abs**（核心变更）：transpile `recordPositions` 插桩（`$nodoPos`——标识符值读 / 静态成员属性位 / 可选链成员跳属性位，计算成员记表达式起始位；记录并原样返回，语义恒等）+ `runTranspiled` 符号执行导出函数（入口 Φ 种子 + 契约参数 Abs），位置直读求值态 Abs——流敏感窄化为**引擎求值语义**（早退守卫 nullish 剥离 / 判别等值窄化 / `!==` 对偶 / typeof 守卫 / `&&` / `||` 链，Φ-native `$fork` 臂内 `withExecPhi` + `$narrowMemberEq` 剪影），非 LSP 层近似。显示阶梯：求值态与入口 Abs 等价（leqAbs 双向）或仅剥 nullish 的位置（声明位 / 检查点 / 成员访问对象 / 落回位）→ 折叠声明形态 + 类型值变量链接；窄化位（守卫 then 分支 / 成员读槽位 / 局部量）→ 求值态展示（`node: { type: lit("StringLiteral"), value: string } | { type: string }`——`showLits` 渲染 lit 判别值与侧车文法同形；开放尾臂按 may 态保守保留——其 `type: string()` 值域与 lit 判别重叠，成员读槽位在尾臂缺席 → `string | undefined` sound）。重放 fail-closed（求值失败 / 预算超限 / 无契约 / 非导出 / 解构形参）→ 回落声明形态面：`||` 组 then 分支（引擎 phi 合取不能表达析取事实）LSP 层按匹配臂联合源文本窄化（sound）；else 分支否定形态有界跳过。折叠面中的**类型值变量包为链接**（`[astNode](file://<依赖侧车>#L<定义行>)`——经侧车 import 表 / 本地顶层声明 / re-export 一级解析；渲染为 plain markdown——代码块内链接不渲染），替代原独立"契约原文"行；无引用变量的契约回落契约原文行。
- **core API**：`formatShape(a, { maxDepth, showLits })`——`showLits` 把 `eq(self, lit(v))` pred（槽位为 `get(p, k)` 字段项、顶层为参数项）渲染为 `lit(v)`（默认 false——既有全部展示面口径不变）。
- **修复**：exec 缓存命中（同内容侧车在不同路径——复制的契约）时不重跑 `execSidecar`，参数折叠文本注册表按路径键在命中路径补登记；此前第二个同内容侧车路径查不到折叠文本、回落谓词全展。
