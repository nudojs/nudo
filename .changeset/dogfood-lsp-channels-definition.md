---
"@nudojs/lsp": minor
---

- dist 产物自包含（同 cli：@nudojs/* 源码进 bundle、splitting:false、banner 补齐）
- 自定义请求别名同时注册 `nudo/<tool>` 与 `nudo.<tool>` 两种拼写（后者与 executeCommand 命令名一致，供 MCP 桥接客户端复用）
- 跨文件 definition：本地声明与 import 绑定都未命中时，新增工作区导出回退扫描（同名导出定义，≤200 文件 + 会话已知文件），修复解构注入参数（`computeScorecard({…})` 形参）无法跳转的问题；rename 刻意不接此回退（重命名必须绑定真实绑定点）
- 附带回归测试：export 形式 refine、跨文件定义回退、早返回折叠
