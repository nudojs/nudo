---
"@nudojs/cli": patch
---

fix(cli): 弃用转发 stub 的 stderr 提示不再污染自动化探测——argv 含 `--version` / `-V` / `-v` / `--help` / `-h` 时跳过弃用提示（包管理器 resolve bin 跑 `--version` 得到干净 stderr），另支持 `NUDO_SUPPRESS_DEPRECATION=1` 完全静音（脚本化迁移窗口）；其余调用照旧提示。同时把 `import "nudojs"` 改为 dynamic import：静态 import 被 ESM 提升到模块体之前，真实 CLI 的 --version/usage 路径在求值期同步 exit，导致提示在这些路径上从不打印、在异步命令路径上时序不定——现在提示稳定先于真实 CLI 输出。argv/exit-code 透传不变。
