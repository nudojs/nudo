---
"@nudojs/service": patch
"@nudojs/lsp": patch
---

fix(service): check 结果对瞬时/持久 fs 故障确定性化（#135 少集模式）

- `resolveModuleFile` 改单次 statSync（消灭 existsSync+statSync TOCTOU 双调用）：ENOENT/ENOTDIR/EISDIR 按候选 miss；其余 errno（EACCES/EIO/ESTALE/EMFILE…）抛 ModuleReadError，不再被 existsSync 吞成「无此文件」。
- 持久 fs 故障：侧车 ambient 绑定显式报 error 级 `nudo:interface-load`（带路径+errno）且 check exit 1——修复前同一故障静默丢整族契约诊断（constraint-violated/unproven-return 整体消失、无任何诊断、exit 0 假绿，且跨版本逐字节相同）。
- 瞬态故障自愈：checkSource per-call loadModule 缓存对「抛错」不缓存、下一探测重试——单次 stat 抖动不再钉死整场 miss。
- `LoadDepsFingerprint.readError`（`readerr:` 前缀，`trunc:` 优先）：读错误轮指纹键不可信，check 整文件 memo / generalize L0 / evaluator memo / analysisFileCacheKey / LSP 校验指纹一律 fail-closed 不读不写，杜绝错误轮与 miss 轮互为跨次陈旧命中。
- `findProjectConfig` stat 错误分类：非 ENOENT 的 package.json stat 故障 stderr 告警 + 子树 fail-closed（不静默继承/丢失 profile、env 名单），修复 severity 漂移（adoption 丢失导致 entry-may-throw error↔warning 摆动）。
