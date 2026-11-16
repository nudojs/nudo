# packages/lsp/src/__tests__/lsp-inlay.test.ts

模块：LSP `inlayHint` 面。根因集中在四类：CRLF 行长与位置换算、`params.range` 过滤缺失、项目侧 `nudo.inlayHints.parameters` 与宿主侧未共用归一化、以及 `any`（开发者责任）与真 `unknown`（引擎债）在 label/tooltip 上未区分。原覆盖多为 LF 夹具或只测宿主侧，因此本文件补的是夹具形态与缺失层。

```audit
title	rootCause	gap	action	status	evidence
LF/CRLF 行内且 CRLF 与 LF 逐条一致；区间过滤；缺省 range fail-open	位置/配置归一/责任区分表	没测该层	keep	keep	—
项目字符串 false 关；项目布尔 true 开；宿主字符串 false 关	位置/配置归一/责任区分表	没测该层	keep	keep	—
真 unknown 挂 ⚠ + 引擎债 tooltip；无约束参数与显式 any() 不加警示	位置/配置归一/责任区分表	没测该层	keep	keep	—
```

```audit-deleted
title	reason	evidence
LF 整文件：end-of-line hint 落在可见行长内	dup:位置/配置/责任表	commit:0ffec907
CRLF 与 LF 位置逐条相同，行尾字符 == 可见行长（不含 \r）	dup:位置/配置/责任表	commit:0ffec907
区间只返回区间内 hint；LF/CRLF 同口径；窄区间为空	dup:位置/配置/责任表	commit:0ffec907
缺省 range（不合规客户端）⇒ 整文件集（fail-open）	dup:位置/配置/责任表	commit:0ffec907
项目侧字符串 "false" ⇒ 参数 inlay 关（非法值回落默认）	dup:位置/配置/责任表	commit:0ffec907
项目侧布尔 true ⇒ 参数 inlay 开	dup:位置/配置/责任表	commit:0ffec907
宿主侧字符串 "false" ⇒ 参数 inlay 关（既有行为不回归）	dup:位置/配置/责任表	commit:0ffec907
真 unknown 返回位：label 含 ⚠，tooltip 写明 inference failure（引擎债）	dup:位置/配置/责任表	commit:0ffec907
无约束参数（parameters 开）：不显示 unknown、不挂 ⚠（any = 开发者责任）	dup:位置/配置/责任表	commit:0ffec907
显式无约束 `where any()`：不加 ⚠，tooltip 追加 any 责任说明（不丢既有 pred 展开）	dup:位置/配置/责任表	commit:0ffec907
CRLF 与 LF 给出同一组位置（改前：CRLF 的行尾 hint 越界 1 列）	dup:inlayHint：位置与 range 契约	commit:f0321de8
CRLF 下 end-of-line 的 contract 档 hint 落在可见行长上（不是 +1）	dup:inlayHint：位置与 range 契约	commit:f0321de8
区间请求只返回区间内的 hint（改前：整文件集逐字节相同）	dup:inlayHint：位置与 range 契约	commit:f0321de8
窄区间（不含任何 hint 位）返回空集，且不与整文件集相同	dup:inlayHint：位置与 range 契约	commit:f0321de8
区间缺省（不合规客户端）⇒ 整文件集（fail-open，不丢内容）	dup:inlayHint：位置与 range 契约	commit:f0321de8
```
