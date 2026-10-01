# 宿主缓存失效契约（session cache invalidation）

> **状态**：**设计契约 + 回归钉扎**——不是产品 API。
> **真源**：架构 → [`kernel-merge.md`](./kernel-merge.md)；命令面 → [`cli-semantics.md`](./cli-semantics.md)；
> 磁盘冷路径 → [`persistent-cache.md`](./persistent-cache.md)（本文只管**进程内会话缓存**）。
> 修订：DESIGN-002——absModuleCache 条目自带子树内容指纹，传递依赖变更成为
> 自然 miss；宿主契约简化为「只报脏入口」（§1.4 / §2.1）。
>
> 接线点：`packages/service/src/session-cache.ts`（`evictAnalysisCachesForFiles` /
> `clearAnalysisSessionCaches` / `resetAllAnalysisCaches`）。
> 测试锚：`packages/service/src/__tests__/cache-invalidation-contract.test.ts`、
> `session-cache-evict.test.ts`、`analysis-file-cache-key.test.ts`。

> **Executive summary (EN).** Session analysis caches (file / fn / evaluator / abs-module / path-env) are process-global. Every content-bearing layer now embeds a **dep content fingerprint**: file / fn / evaluator keys hash the reachable dep closure (`loadModuleDepsFingerprint`), and — since DESIGN-002 — each `absModuleCache` entry carries a **subtree fingerprint** (per-dep `path → contentHash`, composed at insert from already-tracked metadata, re-verified on every hit), so a transitive dep edit flips the middle module's entry even when its own stat is unchanged. Correctness for module staleness therefore lives in the cache itself; hosts keep their simple contract — report dirty **entry** files (dependents) for revalidation and memory reclamation. Host eviction is still mandatory for what fingerprints cannot see: process-global path-env factories (poisoning) and a same-size same-mtime edit of a cached dep's own file (residual gap, pinned by C3). Matrix: LSP's dirty loop does targeted eviction of eval/file/fn caches per dependent + clears path-env + evicts the changed file's abs-module entry; CLI watch calls `session.evictForDependents`; vite-plugin full-clears on `buildStart`/`watchChange`; one-shot CLI starts cold. This is **not** a product API. Tests: `cache-invalidation-contract.test.ts`.

---

## 1. 为什么键里曾经不含 dep 内容（以及今天的现实）

### 1.1 性能动机

分析热路径（LSP hover / 重复 validate / watch 增量）会反复对**同一入口 source** 跑
`analyzeFile` / `tryRunEval` / per-fn generalize。若每次键都递归哈希整棵依赖树，
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
| evaluator `evalRunCache` | **是** | `evalDepKey`（内容哈希；截断 → 禁 memo） | 内容变 → miss |
| Abs 模块图 `absModuleCache` | **是**（DESIGN-002 子树指纹） | 自身 `mtimeMs + size` 严格相等 **且** 传递依赖闭包逐条 `path → 内容hash` 复核 | 自身或任一传递 dep 内容变 → miss；仅「同 size + 同 mtime」的自身编辑 → 陈旧命中 |
| path-env factory | **否** | `path:mtime` + `lookupPathEnv` mtime 复核 | 文件 mtime 变 → 失效；进程全局残留 |
| core generalize / checkSource / nudo-module exec | 按调用参数 | 本轮内 memo | 宿主 `clear`/`reset` 负责 |

**指纹截断 / 异常 = fail-closed**（`noCache` / `depKey = null` / 子树不可追踪不入缓存）：禁用共享命中，宁可重算。

因此：

- **常规编辑**（含传递依赖编辑；mtime/size/内容任一变）：内容指纹层自然 miss，宿主不逐出也能看到新 dep。
- **宿主逐出仍是义务**——见 §2 残余缺口与 path-env 投毒。

### 1.4 `absModuleCache` 子树内容指纹（DESIGN-002 单一失效源）

历史缺口（S3-001）：条目只带自身 stat，`exports` 却来自整棵子树——传递依赖
变更后中间模块 stat 未动 → 陈旧命中，watch/LSP 长会话错 Abs。DESIGN-002 起
**缓存条目自带子树指纹**，正确性由缓存自己保证（宿主免于计算传递闭包）：

- **条目数据模型**（`AbsModuleCacheEntry`）：`contentHash`（自身求值源码的
  `hashSource`，仅供父模块组合复用）+ `depFingerprints`（传递**本地**依赖闭包
  的 `path → 内容hash` 数组，自身除外）+ 原有 stat / exports / issues。
- **插入时组合**：每轮 `evalAbsModuleGraph` 维护 `depMeta`（路径 →
  `{contentHash, depFingerprints}`）；中间模块的闭包 = 直接本地依赖（相对
  import/require/re-export + 裸包入口 JS 解析路径）的 `contentHash` ∪ 各依赖
  已记录闭包——**全部来自已追踪元数据，组合零额外 I/O，无第二套 hash**
  （`hashSource` 与 `loadModuleDepsFingerprint` 同源）。
- **命中时复核**：自身 stat 严格相等 **且** `depFingerprints` 逐条
  `readFileSync + hashSource` 比对；任一翻转或读失败（依赖被删）→ 删条目、
  重求值并回写。成本与已追踪闭包成正比（每文件一次 read+hash，无重解析 /
  无重求值 / 无图遍历）——这就是性能护栏，不存在「每次命中全图重读」的路径。
- **fail-closed 边界**：子树不可追踪（环进行中 / depth 截断 / 依赖缺失早退）
  → `depMeta = null` 向上传播，该模块**不入会话缓存**（宁冷勿陈旧，顺带修掉
  「depth 截断的父模块缓存空导出」同族缺口）。自定义 loader 的虚拟内容与
  磁盘不一致 → 永久 miss（安全方向，只是不暖）。
- **指纹不含**：裸包 harvest stub（node_modules 会话内不可变；env 重载由
  `clearPathEnvCaches` 盖）与「曾经 missing 的文件后来出现」（missing 未进
  指纹；消失方向已盖——读失败即 miss）。

C2/C7 从 1 层图升级为 2 层图（e→m→z，编辑 z、只逐出/只报 e）正是钉住这条
契约：改前中间模块 m 陈旧命中，改后子树指纹翻转重求值。

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
  内容指纹层自然 miss；**中间模块的传递依赖变更由条目子树指纹复核兜住
  （§1.4），宿主无需计算传递闭包、无需逐出中间模块**。逐出扫的正确性角色
  是「内存回收 + 残余缺口安全网」，不再承担传递失效。
- **残余缺口**（§3.1）：`absModuleCache` 条目**自身**仍按 `mtimeMs+size` 键控。
  「同 size + 同 mtime」的 dep 自身编辑（粗时间戳文件系统 / `utimes` 回写 /
  同秒双写）不会被内容指纹看见 **也不会**被 dependents-only 逐出清掉。宿主若
  不能保证 mtime/size 必变，必须额外 `evictAbsModuleCacheFiles([depPath])`，
  或直接 `clearAnalysisSessionCaches()`。

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

| 宿主 | 依赖变更时 | 全量重置 | path-env | abs-module | 备注 |
|---|---|---|---|---|---|
| **LSP**（`lsp/src/validation.ts` 脏传播循环） | 每个 dependent：`evictEvalCacheForFiles` + `evictAnalysisFileCacheForFiles` + `evictFnAnalysisCacheForFiles([dirty])` + `clearPathEnvCaches()`，再 force 重验；变更文件自身另 `evictAbsModuleCacheFiles([filePath])`（内存回收 + 残余缺口） | `clearValidationState` → `clearAnalysisSessionCaches` | 已清（循环内尾调） | 中间模块靠子树指纹（C9 钉住）；删除事件经 `evictModuleGraphCacheEntries` 同步逐出 | 脏传播算 dependents；本地 `analysisCache` 另清 |
| **CLI watch**（`nudojs/src/commands/shared.ts`） | `computeDirtySet` 并集 + topo 序，`getAnalysisSession().evictForDependents(ordered)` | 文件删除时 `session.clear()` | 经 `evictAnalysisCachesForFiles` **已清** | 传递闭包顺带逐出；未逐出的中间模块靠子树指纹 | 200ms debounce；topo 序重跑 |
| **vite-plugin** | `watchChange` → `clearAnalysisSessionCaches()` | `buildStart` → `clearAnalysisSessionCaches()` | **已清** | 全清，无缺口 | 最重但最安全 |
| **一次性 CLI**（`check` / `test` / …） | 无增量（冷进程） | 进程退出即丢 | 不适用 | 不适用 | 不需要逐出 API |
| **测试隔离** | — | `clearAnalysisSessionCaches()` / `resetAllAnalysisCaches()` | 随 clear | 随 clear | 每用例 afterEach |

### 3.1 已知缺口（诚实边界，不假装没有）

1. **LSP 定向路径不调 `clearPathEnvCaches` 的历史缺口已闭合**（循环内尾调）；
   残余投毒面只剩「同 mtime 的 path-env 模板编辑」——与 2 同族的 stat 盲区。
2. **条目自身的 stat 盲区**：`absModuleCache[dep]` 的自身键仍是 `mtimeMs+size`
   ——「同 size + 同 mtime」编辑自身（C3 钉住）仍陈旧；传递依赖的内容盲区
   已被子树指纹消掉。缓解：宿主同时逐出 dep 路径，或全量 `clearAnalysisSessionCaches`。
3. **`evictAnalysisCachesForFiles` 语义是「入口」**——不要把变更的 dep 路径当
   entry 传；dep 的 abs-module 条目要显式 `evictAbsModuleCacheFiles([dep])`。
4. **fail-closed 变冷**（非陈旧）：环 / depth 截断 / 依赖缺失的子树不入会话
   缓存（§1.4），每次重求值——正确但慢；「曾经 missing 的 dep 后来出现」
   不触发指纹翻转（missing 不在指纹里），与旧行为一致。

---

## 4. 非目标（Non-goals）

- **不是产品 API / CLI 动词**——用户面仍是 `check` / `test` / `contract` / `export` / `health`。
- **不是持久化缓存**——`.nudo/cache` / harvest 磁盘层见 [`persistent-cache.md`](./persistent-cache.md)。
- **不保证跨进程**——会话缓存只活在当前进程；冷启动无陈旧问题。
- **不自动侦听文件系统**——失效触发时机归宿主（LSP watched-files / chokidar / vite watch）。
- **不做依赖图自动反查**——dirty dependents 的计算归宿主（LSP `buildModuleGraph`、CLI watch graph）。
- **指纹不是免死金牌**——abs-module 子树指纹承载「模块陈旧」的正确性，但
  path-env 投毒与条目自身的 stat 盲区仍要宿主逐出兜底（§2 / §3.1）。

---

## 5. 测试锚（钉住契约的用例名）

回归文件：`packages/service/src/__tests__/cache-invalidation-contract.test.ts`

| 锚 | 钉什么 |
|---|---|
| **C1** size-changing dep edit is a natural miss without host eviction | 内容指纹层（file/eval/fn）常规编辑自然 miss |
| **C2** evictAnalysisCachesForFiles refreshes after transitive dep change (**2-layer**) | 宿主契约主路径（dependents-only）：中间模块条目靠子树指纹翻转，重求值后入口见新 dep（DESIGN-002 升级；1 层形状盖不住该缺口） |
| **C3** same-size pinned-mtime dep edit is stale under dependents-only eviction | 残余缺口被**显式钉住**（防止有人「修」掉断言后静默回归）——条目**自身**的 stat 盲区 |
| **C4** evictAbsModuleCacheFiles(dep) + evictAnalysisCachesForFiles(entry) recovers | 缺口的安全补法 |
| **C5** clearAnalysisSessionCaches is a full reset including residual gap | 全量重置盖住缺口 |
| **C6** evictAnalysisCachesForFiles clears path-env caches | `clearPathEnvCaches` 接线（防投毒） |
| **C7** AnalysisSession.evictForDependents is the same host contract (**2-layer**) | session 面与底层 API 同语义（同 C2 的 2 层形状） |
| **C8** clearAnalysisSessionCaches refreshes after dep change | 全量重置主路径 |
| **C9** LSP-style dirty loop (changed-file abs-module eviction only) is fresh on 2-layer graphs | 镜像 `lsp/src/validation.ts` 脏传播循环的最小逐出形状：只逐出变更文件条目也新鲜 |

旁证（非本文件，但同契约）：

- `session-cache-evict.test.ts`——dep-change host eviction contract（含 default-loader 自然 miss）
- `analysis-file-cache-key.test.ts`——指纹维度（dep / project env / autoBind）
- `eval-cache-key.test.ts` / `eval-trunc-no-cache.test.ts`——evaluator 键与 fail-closed
- `abs-module-cache.test.ts`——stat 失效、evict/clear、子树指纹翻转（传递编辑 /
  依赖删除重求值）与 fail-closed（环子树不入缓存）

---

## 6. 宿主接线清单（新宿主照抄）

1. 依赖/侧车/env 模板变更 → 计算 dirty **dependents**（重验调度用；正确性
   不依赖你把中间模块也算全——abs-module 子树指纹自己兜）。
2. 调 `evictAnalysisCachesForFiles(dependents)`（或 `session.evictForDependents`）。
   - 若编辑可能 **同 size + 同 mtime**：再 `evictAbsModuleCacheFiles(changedDeps)`。
3. 批处理前 / 构建开始 / 测试夹具：`clearAnalysisSessionCaches()`。
4. 进程复用且要丢 AST：`resetAllAnalysisCaches()`。
5. 不要旁路第二套 memo——统一 `getAnalysisSession().analyze` / `analyzeFile`。
