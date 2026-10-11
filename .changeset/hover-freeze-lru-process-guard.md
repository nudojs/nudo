---
"@nudojs/lsp": patch
---

Hover 无响应排查修复：A0 重放缓存 LRU 化 + 进程级异常兜底

- `absNodeReplayCache`（64 条上限）从「超限全清」改为 LRU 滚动淘汰（命中刷新新端、超限删最旧）。此前多文件浏览填满缓存后一次清空，后续 hover 全部触发冷重放（大文件同步重放数百 ms），与编辑防抖/诊断/inlay 同一事件循环排队，客户端感知 hover 卡死且无日志；LRU 后热条目（当前文件/最近浏览）在缓存压力下持续命中（实测雪崩 70 key 后原条目 12ms）。
- server bin 入口注册 `unhandledRejection` / `uncaughtException` 兜底：默认行为下未捕获异步异常会静默终止进程（客户端只见 "server shut down"、无 stderr 留痕），现在记录后继续运行，把静默死亡变成可排查的日志事件。
