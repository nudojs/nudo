---
"nudojs": patch
---

族 21 修复 C3：Bug 671 684 685 686 689 1026 —— 目录扫描与 watch 路径面。

- **671**：目录目标的文件收集**跟随符号链接**判定（`statSync`），链接进来的
  文件 / 目录不再被静默丢弃 ⇒ `check <dir>` 不再对链接进来的坏文件假绿
  （exit 0），目录链接按 realpath 防环。
- **1026**：目录发现复用产品唯一的范围闸门（`shouldAnalyzeFile`）⇒
  **产品默认安全排除三条全生效**（node_modules / dist / coverage，此前 CLI
  只抄了 1/3）⇒ `dist/` 里的陈旧构建产物不再被当源码门禁（`nudo test <pkg>`
  不再假红），CLI 与 IDE / vite 对同一文件结论一致。
- **689**：**watch 扫描**走同一个 service 闸门 ⇒ 应用
  `nudo.analysis.include` / `exclude`（文档承诺「watch 扫描：应用」），
  不应用 mode ⇒ 与 IDE 对同一文件口径一致；CLI **非 watch** 的目标扫描仍
  忽略 include/exclude（「点名路径即意图」）。
- **684 / 685 / 686**：watch 的**监视根按每个路径各自解析**（目录→该目录，
  文件→其所在目录），事件路径按**所属监视根**换算 ⇒ 多路径且首个是文件时
  watch 不再彻底失效，同目录多文件时变更文件不再被误记成首个路径，跨目录
  路径时其余目录不再是盲区；关闭句柄一次关掉全部 watcher。
