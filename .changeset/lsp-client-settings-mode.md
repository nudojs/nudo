---
"@nudojs/lsp": minor
---

feat(lsp): server 端接收宿主 analysis.mode 默认值——initialize 的 `initializationOptions.analysis.mode` 与 `workspace/didChangeConfiguration` 的 `settings.nudo.analysis.mode` 在项目 package.json#nudo.analysis.mode 未显式设置时作为默认 gate 档（项目显式值优先），变更时重检打开文档（新纳入出诊断、新排除清诊断）。VS Code 扩展侧此前声明的 `nudo.analysis.mode` 设置由此真正生效。
