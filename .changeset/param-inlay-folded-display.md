---
"@nudojs/core": minor
"@nudojs/lsp": minor
---

参数契约折叠展示（inlay + hover + 签名）：

- **inlay**：侧车 `fn()` 形参表达式原文（如 `where nullable(astNode)`）或 `@nudo:contract` 指令约束名替代谓词无损展开（lazy 判别联合展开可达数万字符），完整谓词经 LSP inlay tooltip 展示。侧车 ∧ 指令并存时展示 `expr ∧ name`（任一文本缺席则整体回落谓词全展）；整表达式别名（`import { astNode as N }` 的裸 `N`）规范化为导入名；派生形参（spread / computed）无静态文本，回落谓词全展。
- **hover**：参数声明位 hover 折叠为声明形态（`node: nullable(astNode)`），函数名 hover 签名的契约参数同口径折叠；函数名 hover 的契约面 display 同步折叠。折叠面经 `[契约原文](file://<侧车路径>#L<声明行>)` markdown 链接跳转侧车绑定声明行（VS Code / Zed hover 链接均支持 `#L<n>` fragment）；指令契约（无侧车）不链接。inlay tooltip / hover 弹窗为展开通道。体内参数引用保持计算类型（formatShape）不折叠——该程序点的流窄化信息不可丢。
- **修复**：exec 缓存命中（同内容侧车在不同路径——复制的契约）时不重跑 `execSidecar`，参数折叠文本注册表按路径键在命中路径补登记；此前第二个同内容侧车路径查不到折叠文本、回落谓词全展。
