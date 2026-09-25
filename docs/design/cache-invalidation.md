# 宿主缓存失效契约（session cache invalidation）

> **状态**：**设计契约 + 回归钉扎**——不是产品 API。
> **真源**：架构 → [`kernel-merge.md`](./kernel-merge.md)；命令面 → [`cli-semantics.md`](./cli-semantics.md)；
> 磁盘冷路径 → [`persistent-cache.md`](./persistent-cache.md)（本文只管**进程内会话缓存**）。
>
> 接线点：`packages/service/src/session-cache.ts`（`evictAnalysisCachesForFiles` /
> `clearAnalysisSessionCaches` / `resetAllAnalysisCaches`）。
> 测试锚：`packages/service/src/__tests__/cache-invalidation-contract.test.ts`、
> `session-cache-evict.test.ts`、`analysis-file-cache-key.test.ts`。

> **Executive summary (EN).** Session analysis caches (file / fn / B-path / abs-module / path-env) are process-global. Most keys now embed a **dep content fingerprint**, so a usual dep edit naturally misses without host help. That is a perf layer, not the correctness contract: hosts MUST still evict on dependency change. Why: path-env factories are process-global; abs-module cache is keyed by `mtimeMs+size` and can miss a same-size same-mtime edit; custom loaders / truncated fingerprints need a safety net. Matrix: LSP does targeted parent eviction (gap: no `clearPathEnvCaches`); CLI watch calls `session.evictForDependents`; vite-plugin full-clears on `buildStart`/`watchChange`; one-shot CLI starts cold. This is **not** a product API. Tests: `cache-invalidation-contract.test.ts`.

---

## 1. 为什么键里曾经不含 dep 内容（以及今天的现实）

### 1.1 性能动机

分析热路径（LSP hover / 重复 validate / watch 增量）会反复对**同一入口 source** 跑
`analyzeFile` / `tryRunBPath` / per-fn generalize。若每次键都递归哈希整棵依赖树，
大仓下 fingerprint 成本会盖过缓存收益。因此早期 L0 键只吃入口 source + 配置维。

### 1.2 正确性义务（由此产生）

**入口 source 未变、依赖模块内容变了**时，只读入口 source 的键会命中陈旧结果。
这不是可接受的失败模式——错诊断比慢更糟。

### 1.3 现行分层（与实现对齐）

今天的实现是**两道防线**，不是「键完全不含 dep」：

| 层 | 键是否含 dep 内容 | 机制 | 自然 miss？ |
|---|---|---|---|
| 整文件 `AnalysisResult`（`analysisFileCacheKey`） | **是** | `loadModuleDepsFingerprint` → `depSeg` | 内容变 → miss |
| per-fn `FunctionAnalysis` | **是** | `fnDepSeg`（同口径指纹） | 内容变 → miss |
| B-path `bRunCache` | **是** | `bPathDepKey`（内容哈希；截断 → 禁 memo） | 内容变 → miss |
| Abs 模块图 `absModuleCache` | **否** | `mtimeMs + size` 严格相等 | 同 size + 同 mtime → **陈旧命中** |
| path-env factory | **否** | `path:mtime` + `lookupPathEnv` mtime 复核 | 文件 mtime 变 → 失效；进程全局残留 |
| core generalize / checkSource / nudo-module exec | 按调用参数 | 本轮内 memo | 宿主 `clear`/`reset` 负责 |

**指纹截断 / 异常 = fail-closed**（`noCache` / `depKey = null`）：禁用共享命中，宁可重算。

因此：

- **常规编辑**（mtime 或 size 变了）：内容指纹层自然 miss，宿主不逐出也能看到新 dep。
- **宿主逐出仍是义务**——见 §2 残余缺口与 path-env 投毒。

---

## 2. 宿主契约（必须调用什么）

### 2.1 唯一接线点

| API | 语义 | 何时用 |
|---|---|---|
| `evictAnalysisCachesForFiles(entryPaths)` | 按**入口**（dependents）定向逐出 service 层缓存，并 **`clearPathEnvCaches()`** | 依赖内容变更，脏集=以这些文件为入口的 dependents |
| `clearAnalysisSessionCaches()` | 清空 service + core 会话 memo（不含 AST LRU） | watch 批前 / vite buildStart / 测试隔离 |
| `resetAllAnalysisCaches()` | 再丢 AST LRU | 进程复用 / 彻底重置 |
| `getAnalysisSession().evictForDependents(files)` | 同 `evictAnalysisCachesForFiles` | CLI watch 等 session 宿主 |
| `getAnalysisSession().clear()` / `.reset()` | 同上两级 | 同上 |

调用约定：

- 传 **dependents（入口）**，不是变更的 dep 文件本身——dep 自己 source 变更时，
  内容指纹层自然 miss。
- **残余缺口**（§3）：`absModuleCache` 按 dep 路径键控且指纹是 `mtimeMs+size`。
  「同 size + 同 mtime」的 dep 编辑（粗时间戳文件系统 / `utimes` 回写 / 同秒双写）
  不会被内容指纹看见 **也不会**被 dependents-only 逐出清掉。宿主若不能保证
  mtime/size 必变，必须额外 `evictAbsModuleCacheFiles([depPath])`，或直接
  `clearAnalysisSessionCaches()`。

### 2.2 `clearPathEnvCaches` 要求（为什么强制）

path-based `@nudo:env`（`/// @nudo:env ./custom.env.ts`）经 async preload 导入
`defineEnv` 工厂后驻留**进程全局** LRU：

- sync `analyzeFile` **不**在每次求值时重 import；
- `lookupPathEnv` 虽复核 mtime，但同 mtime 场景盖不住；
- 定向逐出若不清它，**新 dep-hash 键会被旧 `defineEnv` 投毒**（结果算完存进新键，
  后续命中的是脏值）。

因此 `evictAnalysisCachesForFiles` **必须**尾调 `clearPathEnvCaches()`（已接线，
测试锚 C6）。只 follow `evictForDependents` 的宿主因此默认安全。

---

## 3. 宿主矩阵（今天各自怎么做）

| 宿主 | 依赖变更时 | 全量重置 | path-env | abs-module dep 缺口 | 备注 |
|---|---|---|---|---|---|
| **LSP**（`lsp/src/validation.ts`） | 定向：`evictBPathCacheForFiles` + `evictAnalysisFileCacheForFiles` + `evictFnAnalysisCacheForFiles(parentList)`，再 force 重验 parent | `clearValidationState` → `clearAnalysisSessionCaches` | **未接**（定向路径不清 path-env） | 删除事件才 `evictAbsModuleCacheFiles` | 脏传播算 dependents；本地 `analysisCache` 另清 |
| **CLI watch**（`cli/src/commands/shared.ts`） | `getAnalysisSession().evictForDependents(ordered)` | 文件删除时 `session.clear()` | 经 `evictAnalysisCachesForFiles` **已清** | 同 §2.1 残余 | 200ms debounce；topo 序重跑 |
| **vite-plugin** | `watchChange` → `clearAnalysisSessionCaches()` | `buildStart` → `clearAnalysisSessionCaches()` | **已清** | 全清，无缺口 | 最重但最安全 |
| **一次性 CLI**（`check` / `test` / …） | 无增量（冷进程） | 进程退出即丢 | 不适用 | 不适用 | 不需要逐出 API |
| **测试隔离** | — | `clearAnalysisSessionCaches()` / `resetAllAnalysisCaches()` | 随 clear | 随 clear | 每用例 afterEach |

### 3.1 已知缺口（诚实边界，不假装没有）

1. **LSP 定向路径不调 `clearPathEnvCaches`**——path-env 依赖变更后可能投毒
   （v2 候选：定向路径也尾调，或改走 `evictAnalysisCachesForFiles`）。
2. **dependents-only 逐出清不掉 `absModuleCache[dep]`**——同 size + 同 mtime 编辑
   仍陈旧。缓解：宿主同时逐出 dep 路径，或全量 `clearAnalysisSessionCaches`。
3. **`evictAnalysisCachesForFiles` 语义是「入口」**——不要把变更的 dep 路径当
   entry 传；dep 的 abs-module 条目要显式 `evictAbsModuleCacheFiles([dep])`。

---

## 4. 非目标（Non-goals）

- **不是产品 API / CLI 动词**——用户面仍是 `check` / `test` / `contract` / `export` / `health`。
- **不是持久化缓存**——`.nudo/cache` / harvest 磁盘层见 [`persistent-cache.md`](./persistent-cache.md)。
- **不保证跨进程**——会话缓存只活在当前进程；冷启动无陈旧问题。
- **不自动侦听文件系统**——失效触发时机归宿主（LSP watched-files / chokidar / vite watch）。
- **不做依赖图自动反查**——dirty dependents 的计算归宿主（LSP `buildModuleGraph`、CLI watch graph）。
- **不把「键含 dep 指纹」当免死金牌**——指纹是 perf 层；契约义务在宿主。

---

## 5. 测试锚（钉住契约的用例名）

回归文件：`packages/service/src/__tests__/cache-invalidation-contract.test.ts`

| 锚 | 钉什么 |
|---|---|
| **C1** size-changing dep edit is a natural miss without host eviction | 内容指纹层（file/bpath/fn）常规编辑自然 miss |
| **C2** evictAnalysisCachesForFiles refreshes after dep change | 宿主契约主路径：dependents 逐出后见到新 dep |
| **C3** same-size pinned-mtime dep edit is stale under dependents-only eviction | 残余缺口被**显式钉住**（防止有人「修」掉断言后静默回归） |
| **C4** evictAbsModuleCacheFiles(dep) + evictAnalysisCachesForFiles(entry) recovers | 缺口的安全补法 |
| **C5** clearAnalysisSessionCaches is a full reset including residual gap | 全量重置盖住缺口 |
| **C6** evictAnalysisCachesForFiles clears path-env caches | `clearPathEnvCaches` 接线（防投毒） |
| **C7** AnalysisSession.evictForDependents is the same host contract | session 面与底层 API 同语义 |
| **C8** clearAnalysisSessionCaches refreshes after dep change | 全量重置主路径 |

旁证（非本文件，但同契约）：

- `session-cache-evict.test.ts`——dep-change host eviction contract（含 default-loader 自然 miss）
- `analysis-file-cache-key.test.ts`——指纹维度（dep / project env / autoBind）
- `bpath-cache-key.test.ts` / `bpath-trunc-no-cache.test.ts`——B-path 键与 fail-closed
- `abs-module-cache.test.ts`——mtime+size 失效与 evict/clear

---

## 6. 宿主接线清单（新宿主照抄）

1. 依赖/侧车/env 模板变更 → 计算 dirty **dependents**。
2. 调 `evictAnalysisCachesForFiles(dependents)`（或 `session.evictForDependents`）。
   - 若编辑可能 **同 size + 同 mtime**：再 `evictAbsModuleCacheFiles(changedDeps)`。
3. 批处理前 / 构建开始 / 测试夹具：`clearAnalysisSessionCaches()`。
4. 进程复用且要丢 AST：`resetAllAnalysisCaches()`。
5. 不要旁路第二套 memo——统一 `getAnalysisSession().analyze` / `analyzeFile`。
