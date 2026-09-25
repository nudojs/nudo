# 持久化分析缓存（`.nudo/cache`）

> **状态**：**已落地**——L1 磁盘基建 + L2 harvest HarvestJson 磁盘层（`harvest-json.ts` / `harvest-disk.ts`，`~/.cache/nudo/deps` / `NUDO_DEPS_CACHE_DIR`）。CheckJson 默认关（投毒面）。
> **真源**：架构 → kernel-merge.md；命令面/any/unknown/check → cli-semantics.md
>
> 产品动词：`check` / `test` / `contract` / `export` / `health`。
> 相关配置：`package.json#nudo.cache.*`、`package.json#nudo.contract.*`、`package.json#nudo.check.*`；env `NUDO_CACHE*`。
> 使用现场观察用 **`--from`**；`test --freeze` 与接口固化无关。

---

## 现状（已落地）

### L1 磁盘层（`packages/service/src/disk-cache.ts`）

| 能力 | 行为 |
|---|---|
| `DiskCache` | sha256 内容键 + 分析 ABI 前缀；读失败 / 版本不符 / 校验失败 → **fail-open 当 miss** |
| CheckJson 缓存 | `nudo check` 在**无 `--from`** 时可读写整文件报告；**默认关闭**（投毒面） |
| effectiveInterface 整文件表 | `iface` 命名空间：导出名 → 契约 JSON 或 implicit 负缓存 `null` |
| 启用 | `package.json#nudo.cache: true`（→ `.nudo/cache`）/ 自定义目录字符串 / `NUDO_CACHE_DIR`；`false`/`off` 关闭 |
| callSiteBudget | `package.json#nudo.analysis.callSiteBudget`（默认 3）；超限 symbolic `#widened` |

加速边界（诚实声明）：

- 服务的是：`contract` **打印/契约读取**冷启动、opt-in 的 `check` 冷路径、以及 harvest 依赖层（L2 已落地）。
- **不**加速：`test` / `contract --emit` / `health` 的完整 B-path 分析；`export` 整条投影链。
- Abs 本体、AST、PolyFn、AnalysisResult、截断/opaque/mock 改道的**分析**结果——**不进磁盘**。

### 与 check / 契约配置的关系

| 配置 | 键 | 与缓存的关系 |
|---|---|---|
| 契约自动绑定 | `package.json#nudo.contract.autoBind` | 进 **L1 iface/check 键**；白名单变更不导致 iface 无谓 miss |
| emit 白名单 | `package.json#nudo.contract.emit` | **不得**被磁盘命中绕过；白名单决策每次现场判定 |
| check 行为 | `package.json#nudo.check.*`（如 `ignoreThrows`） | 与 L2 entry-may-throw 执法相关；**不是**缓存键的替代品 |
| 现场调用点 | `--from` | 注入跨文件调用证据（domain 检查）；**跳过 L1 CheckJson 读写**——整报告不可复用 |

约定：现场路径用 **`--from`**，不存在另一条 deprecated 注入 flag。

---

## 目标与非目标

### 目标

1. **依赖包层收益最大（L2，已落地）**：`node_modules` / `@types` 的 harvest 投影跨项目复用。
2. **check 冷路径可复用（L1，opt-in）**：未变更文件走磁盘 `CheckJson`。
3. **契约读取可复用（L1）**：整文件 interface 表服务打印 / surface。
4. **绝不陈旧命中**：键漏维度 = 错诊断；宁可 miss 重算。
5. **可丢可重建**：损坏 / ABI 变 / 用户删目录均 fail-open。
6. **与内存 memo 同源语义**，磁盘键用 sha256 + 相对路径化。

### 非目标

- 不缓存 Abs 本体 / AST / B-path / AnalysisResult。
- 不缓存证据不稳的分析结果。
- 不做远程/共享缓存。
- 不替代进程内 L0 / check memo——磁盘是冷路径。
- 不为 `--from` 注入路径做整报告复用。
- 不序列化求值 IR、不做 emit 模块回放。

---

## 三层架构要点

```text
L0 内存（现有）  generalize / check memo / fn analysis   ← 热路径
L1 项目磁盘      .nudo/cache/   本仓库投影结果            ← 冷启动（部分落地）
L2 依赖磁盘      ~/.cache/nudo/deps/   node_modules 投影  ← 跨项目（已落地）
```

| 层 | 缓存什么（值形态） | 默认 |
|---|---|---|
| L1 iface | 整文件 `fns` 表 + implicit 负缓存（plain JSON） | 随 `nudo.cache` 开启 |
| L1 derive | 导出约束投影（无 Abs） | 设计已列，随 L1 基建 |
| L1 check | `CheckJson`（`serializeCheckJson`） | **`false`**，需显式开 |
| L2 harvest | **HarvestJson**（纯 JSON 签名投影；读回 materialize 为 mock Abs 导出表） | **已落地**（harvest 路径默认走盘） |

L2 harvest 落地形态（与实现对齐）：

| 面 | 现实 |
|---|---|
| 落地范围 | `@types/node`（`harvest-node.ts` B2）+ 通用包 harvest（`harvestPackageWithDisk`）；`harvest-json.ts` / `harvest-disk.ts` |
| 默认 | **开**——harvest 路径自动读写盘（区别于 L1 CheckJson 默认关） |
| 位置 | `~/.cache/nudo/deps`；`NUDO_DEPS_CACHE_DIR` 覆盖；`off`/`0` 关闭 |
| 键 | `HARVEST_DISK_ABI` + pkg + pkgVersion + knobs(`maxFiles`) + `dtsClosureHash`（每个实际读到的 `.d.ts` 内容 sha256）→ `sha256Hex` |
| 值 | `HarvestJson` 签名投影（modules/globals → `HarvestSig`）；读回 `materializeHarvestJson` → mock Abs 导出表（丢 pred/conf） |
| 降级链（B2） | 磁盘 miss / harvest 失败 / `@types/node` 缺失 → 手写 `@nudojs/env` node 面，结果标 **`degraded: true`**；重叠处手写 wins（`mergeHarvestUnderEnv`） |
| 进程内缓存 | 成功 + 终态失败（`not-found`/`no-dts`/`failed`）都进 L0 Map，防重试风暴；`disabled`（`NUDO_HARVEST_NODE=off`）**从不缓存** |
| 仍不进盘 | 降级/失败结果只在进程内（不写 HarvestJson）；Abs 本体 / AST / B-path / AnalysisResult；`test`/`export` 整条链 |

前提（L2 不变式，仍有效）：harvest 出口稳定为可 JSON 化签名表；磁盘层只缓存签名投影，不缓存 Abs 本体。

---

## 键组成（要点）

```text
globalPrefix = "nudo-" + kind + "-v" + schema + "@" + analysisAbi
# analysisAbi 含 typescript 版本（手写语义版本 + ts 版），不是 package.json#version

L2 harvest : prefix + pkg + version + harvestKnobs + dtsClosureHash
L1 iface   : prefix + relFile + srcSha256 + sidecarFp + diskDepsFp + autoBind
L1 check   : prefix + relFile + stableSrcSha256 + diskDepsFp + sidecarFp + autoBind
```

红线：

- **content-addressable**（sha256）；mtime+size 仅可作算 hash 前的廉价预检，不能单独当命中依据。
- **磁盘键相对路径化**；相对化失败 → 键作废。
- **原料禁用进程内 FNV**；`hashSource` 只留在内存 LRU。
- 任一段 `truncated` / `trunc:` → 整键作废（不读不写）。
- iface 键**不含** emit allowlist（白名单不影响 effectiveInterface 结果本身）。
- `dtsClosureHash` 必须覆盖实际读到的每个 `.d.ts` 内容，不只 hash 入口。

---

## 失效红线

| 事件 | 行为 |
|---|---|
| 源码 / 侧车 / dep 内容变 | 键变 → 自然 miss |
| `autoBind` 变 | 进 L1 键 → miss |
| emit 白名单变 | 不进 iface 键；**磁盘命中不得绕过白名单** |
| `analysisAbi` / schema / typescript 升 | 全局前缀变 → 全 miss |
| 损坏 JSON / 未知节点 | miss，不 throw |
| 截断 / opaque 证据 | 不读不写 |
| 用户删缓存目录 | 全 miss，行为不变 |

**不做**主动逐出图：磁盘层靠键完备性；内存层的 dep-parent 逐出与磁盘职责不重叠。

**投毒红线（check 门禁）**：结构合法的假 `CheckJson` 可制造假阴性。因此 L1 check **默认关**；开启后仅用于可信本地/CI；`.nudo/cache` 必须 `gitignore`；不可信 runner 上用 `NUDO_CACHE=0` 或保持 `check: false`。

---

## 未决 / 未实施

- ~~L2 harvest 磁盘层~~ **已落地**：HarvestJson 签名投影 + materialize mock Abs；键 = pkg+version+knobs+dtsClosureHash；`harvestPackageCached` 自动走 L2。
- L2 与 env 包生成路径（`@nudojs/harvester`）的 round-trip 验收、`typescript` 版本进 ABI 的完整 CI 策略。
- `.nudo/cache` 与契约侧「隐式 refine 跨会话缓存」的用户文档边界：契约文件进 git，缓存不进——已定原则。
- 精确依赖反向逐出、远程缓存、跨 ABI 迁移器：**明确不做**。

---

## 源码锚点

- packages/service/src/disk-cache.ts
- packages/service/src/__tests__/disk-cache.test.ts
- packages/service/src/harvest-json.ts
- packages/service/src/harvest-disk.ts
- packages/service/src/harvest-node.ts
- packages/service/src/__tests__/harvest-disk.test.ts
- packages/service/src/__tests__/harvest-node-b2.test.ts
- packages/service/src/interface-surface.ts
- packages/service/src/evaluator/config.ts
- packages/service/src/case-json.ts
- packages/core/src/algebra/check.ts
- packages/core/src/algebra/check-report.ts
- packages/core/src/algebra/generalize.ts
- packages/cli/src/index.ts
