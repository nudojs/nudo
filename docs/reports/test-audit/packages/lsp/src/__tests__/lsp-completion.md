# packages/lsp/src/__tests__/lsp-completion.test.ts

模块：LSP completion 面。根因分三组：指令补全用子串匹配而不是词法上下文（乘号后/字符串里误出指令）、函数绑定 detail/kind 与 hover 签名不同源、以及词法门（字符串/模板/注释）与尾随点号中间态的候选面缺失。原夹具集中在代码位与单一前缀，缺口多为夹具形态。

```audit
title	rootCause	gap	action	status	evidence
乘号之后：不出指令项（出的是变量补全）	指令补全用“前面出现过 * 或 nudo”的子串判据，乘号后误判为注释；旧夹具没有操作符上下文。	夹具漏形态	keep	keep	—
字符串字面量里的 @nudo: 不是注释 ⇒ 不出指令项	词法判据未区分字符串与注释；旧测试只在 JSDoc 注释里验证正向。	夹具漏形态	keep	keep	—
注释里：仍然出指令项（不误伤）	词法门修复的负控制：真注释仍须出指令；旧测试没有代码位/字符串位对照。	夹具漏形态	keep	keep	—
JSDoc 多行注释里：仍然出指令项（跨行块注释词法上下文）	跨行块注释的光标上下文未覆盖；旧夹具只测单行 `//`。	夹具漏形态	keep	keep	—
fn 绑定 detail = `ident(x: any) => any`（不是 `(x) => ?`），且与 hover.signature 一致	补全 detail 与 hover 各自取签名，旧实现退化成 `(x) => ?`；旧断言没有跨面逐字对拍。	没测该层	keep	keep	—
顶层 fn 绑定 → Function(3)，非函数绑定 → Variable(6)	补全 kind 一律按 Variable 处理；旧测试只断言 label/detail。	没测该层	keep	keep	—
成员函数补全仍是 Method(2)（不能被一起改掉）	顶层 kind 修复的负控制：成员函数必须保持 Method(2)；旧覆盖没有同文件对照。	夹具漏形态	keep	keep	—
字符串字面量内部 ⇒ 零候选（改前给成员表）	词法门缺失时字符串内部会走成员补全；旧测试没有字符串内部位置。	夹具漏形态	keep	keep	—
模板字面量内部 ⇒ 零候选（改前给成员表）	模板字符串与普通字符串的词法上下文不同；旧夹具只测 `"`。	夹具漏形态	keep	keep	—
注释内部 ⇒ 零成员 / 变量候选（改前给成员表）	注释里应只出指令、不出成员/变量；旧测试只验证指令正向。	夹具漏形态	keep	keep	—
代码位 ⇒ 成员候选照旧（不得过度拦截）	词法门修复的负控制：代码位成员补全不得被误杀；旧测试无同文件对照。	夹具漏形态	keep	keep	—
注释里的指令面照旧（不得误伤指令补全）	反向护栏：注释里指令补全不得因词法门被关掉；旧断言只测代码位。	夹具漏形态	keep	keep	—
detail 说明是 reserved / no-op	`@nudo:sample` 是保留指令，接受后必须无副作用；旧补全没有采样项。	没测该层	keep	keep	—
insertText 带 count 占位（接受后不产生诊断）	采样指令的插入文本需要 count 占位；旧测试只断言 label。	没测该层	keep	keep	—
textEdit 区间 = [前缀起点, 光标]（接受后源码恰是 `@nudo:sample 1`）	指令补全此前只给 insertText，没有精确 textEdit 区间；旧测试未验证接受后的源码。	没测该层	keep	keep	—
尾随点号：给出 obj 的成员，且不报 console 错	尾点中间态可能走错分支并触发 console 报错；旧夹具只测完整表达式。	夹具漏形态	keep	keep	—
已敲出部分成员名：行为不变（同样给出成员）	部分成员名是既有路径，本行是尾点改造的负控制；旧测试没有同文件对照。	夹具漏形态	keep	keep	—
尾随点号与部分成员名的结果一致（补全面不因编辑中间态塌掉）	两种编辑中间态必须收敛到同一候选面；旧断言只分别看单态。	门禁未跑	keep	keep	—
```
