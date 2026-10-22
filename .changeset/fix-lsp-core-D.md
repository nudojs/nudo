---
"@nudojs/lsp": patch
---

fix(lsp): server 骨架 8 条——重复诊断推送 / 配置深合并 / trace 位置参数桥 / 工作区根 / 畸形 URI / inlay 开关同口径 / pull 诊断 env 通道（Bug 776 / 777 / 780 / 783 / 784 / 790 / 781 / 992）

- **Bug 776**（重复推送）：`vscode-languageserver` 的 `TextDocuments.listen()`
  在 `didOpen` 时**同时** fire `onDidOpen` 与 `onDidChangeContent` ⇒ 打开即
  验证路径与编辑防抖路径对**同一内容**各跑一遍完整校验、各 publish 一次
  （同 version 同内容发两次）。`server.ts` 记文档指纹（version + 内容），
  防抖路径遇到同一指纹即认定 didOpen 回声并跳过；publish 面再加**内容去重**
  （同 uri + 同 version + 同诊断内容只发一次，同版本但内容变了仍照发）。
- **Bug 777**（配置深合并）：`workspace/didChangeConfiguration` 的载荷只带
  **变更部分**（或与 nudo 无关的整棵树），server 却把它当整棵子树读 ⇒
  未提及的键被抹成 `undefined` ⇒ 一次无关的设置变更就把宿主的
  `nudo.analysis.mode` 默认值清掉（分析范围静默收缩、hover 变 null）。
  宿主设置改为**累积合并树**：出现的键覆盖、未出现的键保留、`null` = 显式
  重置；扁平键（`"nudo.analysis.mode"`）按点号展开成嵌套路径，与嵌套形态
  等价。
- **Bug 780**（命令桥 · server 侧）：`nudo.trace` **没有**位置参数桥
  （`nudo.contract*` 有）⇒ IDE 观察透镜的 `[uri, fn]` 落到兜底分支、把 uri
  字符串当参数对象传下去 ⇒ 工具 100% 失败。补上与 `nudo.contract*` 同款的
  位置参数桥（复用 agent 侧 `tracePositionalArgs`），并把兜底分支改成
  「参数不是对象 ⇒ 协议层 `InvalidParams`」，不再把字符串当对象传下去。
- **Bug 783**（工作区根）：`workspaceRoots` 的写入点**全在** `onInitialize`
  里 ⇒ 之后永不更新；server 也从不订阅
  `workspace/didChangeWorkspaceFolders`，且 capabilities 未声明
  `workspace.workspaceFolders.changeNotifications` ⇒ 客户端根本不会发这条
  通知。现在声明该能力 + 订阅通知（增删根、realpath 归一）+ 根集合变化后
  清 `nudoFileCache`、重检已打开文档、广播 `workspace/diagnostic/refresh`
  （新纳入的目录不再被写盘边界误拒，已移出的目录不再保留过期授权）。
- **Bug 784**（畸形 URI）：`onInitialize` 对每个 workspace folder 的
  `uriToFilePath` 没有兜底 ⇒ 一个百分号转义非法的 URI 抛 `URIError` ⇒
  initialize 整个失败 ⇒ 客户端拿不到 capabilities ⇒ 整个语言服务器会话
  起不来。改为逐个 folder 兜底：跳过畸形项 + 记可读告警，其余照常。
- **Bug 790**（inlay 开关同口径）：项目侧 `nudo.inlayHints.parameters`
  **原样返回**原始值，宿主侧走 `parseInlayParams` ⇒ 同一个键两套规则
  （项目写字符串 `"false"` 反而**开启**参数 inlay，宿主同一个值**关闭**）。
  项目侧改用**同一个归一化函数**：非 boolean 一律回落默认（关）+ 一条
  可读告警。
- **Bug 781 / 992**（诊断面同形）：push 面（`validateText`）会发
  `nudo:env-unresolved`，pull 面（`textDocument/diagnostic`）**完全没有**
  env 通道 ⇒ 同一文件两个诊断面互相打脸（IDE 与 CI 结论不一致）。pull 通道
  补上 env 通道——与 push **同源同档**（`envUnresolvedDiags` +
  `filterCheckLspByLevel` + 同一 level + 同一去重键空间）。

冻结面：`packages/lsp/src/public-api.ts` 四张表本族**零变更**。`workspace`
 能力键已由 server 声明，但**未**写进 `NUDO_INITIALIZE_CAPABILITIES`
（属于「stable 键集变更」，待 owner 拍板后统一补表 + 补 `PUBLIC_API.md`）。
