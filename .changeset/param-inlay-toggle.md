---
"@nudojs/lsp": minor
"@nudojs/service": patch
"nudo-vscode": minor
---

参数契约 inlay hints（形参后 `where …`）默认关闭：显式契约（递归 AST 节点联合等）行内展开可达数万字符。新增 `nudo.inlayHints.parameters`（boolean，默认 `false`）三级配置——项目 `package.json#nudo.inlayHints.parameters` 显式值赢，宿主设置（VS Code `nudo.inlayHints.parameters` / Zed `language-servers.nudo.initialization_options.inlayHints.parameters`）只在项目未设置时作默认；`workspace/didChangeConfiguration` 实时生效并触发 `inlayHint/refresh`。返回类型 inlay（`: …`）、case hints 与 interface 档 inlay 不受影响；hover 仍展示完整契约。
