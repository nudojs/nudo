# packages/lsp/src/__tests__/lsp-inlay.test.ts

模块：LSP `inlayHint` 面。根因集中在四类：CRLF 行长与位置换算、`params.range` 过滤缺失、项目侧 `nudo.inlayHints.parameters` 与宿主侧未共用归一化、以及 `any`（开发者责任）与真 `unknown`（引擎债）在 label/tooltip 上未区分。原覆盖多为 LF 夹具或只测宿主侧，因此本文件补的是夹具形态与缺失层。

```audit
title	rootCause	gap	action	status	evidence
LF 整文件：end-of-line hint 落在可见行长内	位置/区间契约（CRLF、range、缺省 range）	没测该层	keep	keep	—
CRLF 与 LF 位置逐条相同，行尾字符 == 可见行长（不含 \r）	位置/区间契约（CRLF、range、缺省 range）	没测该层	keep	keep	—
区间只返回区间内 hint；LF/CRLF 同口径；窄区间为空	位置/区间契约（CRLF、range、缺省 range）	没测该层	keep	keep	—
缺省 range（不合规客户端）⇒ 整文件集（fail-open）	位置/区间契约（CRLF、range、缺省 range）	没测该层	keep	keep	—
项目侧字符串 "false" ⇒ 参数 inlay 关（非法值回落默认）	项目侧原样返回原始值，字符串 "false" 为真值反而开启；宿主侧早已归一化。旧测试只测宿主设置。	没测该层	keep	keep	—
项目侧布尔 true ⇒ 参数 inlay 开	项目侧归一化后的正向路径未测；旧覆盖只有宿主侧 true。	没测该层	keep	keep	—
宿主侧字符串 "false" ⇒ 参数 inlay 关（既有行为不回归）	宿主侧归一化是既有行为，本行是项目侧改造的负控制；旧测试未在同一文件里对拍两套规则。	没测该层	keep	keep	—
真 unknown 返回位：label 含 ⚠，tooltip 写明 inference failure（引擎债）	any/unknown 责任区分是新契约；旧 inlay 测试只断言 label 文本，没有 ⚠/tooltip 语义。	没测该层	keep	keep	—
无约束参数（parameters 开）：不显示 unknown、不挂 ⚠（any = 开发者责任）	同一契约的反向：无约束入口显示 any 而非 unknown；旧测试可能把两者混为 unknown。	没测该层	keep	keep	—
显式无约束 `where any()`：不加 ⚠，tooltip 追加 any 责任说明（不丢既有 pred 展开）	显式 any 的 tooltip 文案与不丢既有 pred 展开未覆盖；旧测试只测默认无约束参数。	夹具漏形态	keep	keep	—
```

```audit-deleted
title	reason	evidence
CRLF 与 LF 给出同一组位置（改前：CRLF 的行尾 hint 越界 1 列）	dup:inlayHint：位置与 range 契约	commit:PENDING
CRLF 下 end-of-line 的 contract 档 hint 落在可见行长上（不是 +1）	dup:inlayHint：位置与 range 契约	commit:PENDING
区间请求只返回区间内的 hint（改前：整文件集逐字节相同）	dup:inlayHint：位置与 range 契约	commit:PENDING
窄区间（不含任何 hint 位）返回空集，且不与整文件集相同	dup:inlayHint：位置与 range 契约	commit:PENDING
区间缺省（不合规客户端）⇒ 整文件集（fail-open，不丢内容）	dup:inlayHint：位置与 range 契约	commit:PENDING
```
