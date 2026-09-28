---
slug: /guides/performance
description: Nudo 分析性能 —— 预算（fork / 调用 / 调用点）、截断诊断与修复、.nudo/cache 磁盘缓存，以及 CI 该（不该）restore 什么。
---

# 性能：预算与分析缓存

两个常被混淆的独立杠杆：

- **预算**管**精度**。Nudo 分析的是（可能无限的）执行的有限近似。预算用尽时，受影响的结果拓宽（`#widened`），并有诊断码说明 —— 绝不静默。
- **磁盘缓存**（`.nudo/cache`）管一部分冷路径的**重复运行延迟**。**默认关闭**，且绝不加速 `test` / `export` / `health` 背后的完整分析。

## 分析预算

求值器（transpile → `new Function`）在你的代码上执行真实的 Abs 代数。预算为这份工作量设界：

| 预算 | 默认 | 旋钮 | 触发时 |
|---|---|---|---|
| 调用总数（函数进入次数） | 20,000 | — | `nudo:recursion-truncated` |
| 调用深度 | 64 | — | `nudo:recursion-truncated` |
| 分支展开（`$fork` 总数） | 5,000 | `NUDO_MAX_FORKS` / `package.json#nudo.analysis.maxForks` | `nudo:fork-truncated` |
| 每函数合并的调用点数 | 3 | `package.json#nudo.analysis.callSiteBudget`（1–64） | 超限调用点符号折叠 → `#widened` |

只有 fork 预算可调（env `NUDO_MAX_FORKS` 优先于 `nudo.analysis.maxForks`；非法值回落默认）。调用总数与调用深度是硬上限 —— 请重构代码，而不是找旋钮。

### 何时触发截断 —— 该做什么

**`nudo:recursion-truncated`** —— 调用预算（深度 64 或总计 20,000 次）用尽；受影响结果拓宽。**`nudo:fork-truncated`** —— 分支展开预算用尽；受影响结果拓宽（**warning**）。两者都出现在 `nudo check` / `nudo test` 输出里 —— 截断绝不静默降级结果。

三个杠杆，按值得尝试的顺序：

1. **加约束。** 契约（`*.nudo.js` / `@nudo:contract`）与调用点证据让集合早收窄 —— 更小的 Abs、更少的重求值、更少的 fork。这也是唯一能同时**提升**精度的修法。
2. **拆函数 / 拍平分支。** 深调用链烧调用深度；长 `if`/`else` 链与分支内循环让 `$fork` 计数组合式膨胀。抽取 helper、提前 return、拆分关注点。
3. **调旋钮与 env。** 调高 fork 预算（`NUDO_MAX_FORKS=20000` 或 `package.json#nudo.analysis.maxForks`）；用 `@nudo:env` / mock 建模你触碰的 API，让分析留在已建模的精确路径上，而不是对 opaque 值反复 fork。

预算的存在是为了让分析在对抗性代码上可终止。如果你经常调 `maxForks`，真正的故事通常在代码（或缺的契约）上。

## `.nudo/cache` 项目磁盘缓存

默认关闭。通过 `package.json` 打开：

```json
{
  "nudo": {
    "cache": true
  }
}
```

`nudo.cache` 接受：

| 取值 | 含义 |
|---|---|
| `true` | 缓存在 `<projectRoot>/.nudo/cache` |
| `"some/dir"` | 自定义目录，相对项目根解析 |
| `false` / 省略 | 关闭（默认） |

env 覆盖（配置未设时）：`NUDO_CACHE_DIR` —— 绝对路径，或 `off` / `0` 关闭。

落到磁盘的内容（缓存根下按命名空间分子目录）：

| 命名空间 | 内容 | 服务的面 |
|---|---|---|
| `iface` | 整文件 effectiveInterface 表（导出 → 契约 JSON，或 implicit 负缓存） | `nudo contract` 打印 / 契约读取冷启动 |
| `check` | 整文件 `CheckJson` 报告 | 未变更文件在 `nudo check` 冷路径 —— 带 `--from` 时绝不读写（现场注入的证据不可作为整报告复用） |

**键是内容寻址的**：对源码 + 侧车 + 依赖内容 + 配置维度（如 `contract.autoBind`）取 sha256，并带分析 ABI 前缀（`nudo-check-cache-v…+<version>`，其中含 TypeScript 版本 —— 不是 `package.json#version`）。升级 `@nudojs/*` → 前缀变 → 整层干净 miss。改源码、侧车或任一依赖 → 键变 → 自然 miss。

**fail-open 语义。** 损坏的 JSON、ABI 不符、读不了的条目、被删的目录 —— 每种失败都是一次缓存 miss。分析重算；不抛任何东西；可观察行为完全一致。你随时可以 `rm -rf .nudo/cache`。被截断或 opaque 证据触及的条目绝不写入。

### 为什么默认关闭

一份结构合法的**伪造** `CheckJson` 能制造假阴性 —— 被投毒的缓存可能藏掉真实违例。因此：只在可信机器 / CI 上开启；`.nudo/cache` **必须 gitignore**；不可信 runner 上保持 `nudo.cache` 未设/`false`，或设 `NUDO_CACHE_DIR=off`。

### 依赖层（默认开启）

另一个跨项目缓存在 `~/.cache/nudo/deps`（覆盖：`NUDO_DEPS_CACHE_DIR`；`off` / `0` 关闭），存 `@types` harvest 的**签名投影** —— 纯 JSON，绝不是 Abs 本体。默认开启、fail-open、跨项目共享 —— 重复分析的最大收益在这里。

## 缓存不加速什么

诚实边界：

- **服务的面**：`contract` 打印 / 契约读取冷启动；opt-in 的 `check` 冷路径（未变更文件）；harvest 依赖层。
- **不服务的面**：`test` / `contract --emit` / `health` 的完整求值器分析；`export` 的整条投影链。
- **绝不进盘**：Abs 本体、AST、`PolyFn`、`AnalysisResult`，以及截断 / opaque / mock 改道的分析结果。
- `--from`（现场调用点证据）完全跳过 `CheckJson` 读写。

缓存让未变更文件的重复 check 在代数面上更便宜。它不是「让 Nudo 变快」的通用开关 —— 先看预算和契约。

## CI：缓存目录要不要 restore？

- **默认配置：什么都不用 restore。** 项目缓存关闭；`nudo check` 每次诚实重算。
- **若开启了 check 缓存**（仅可信 runner）：在多次运行之间 restore `.nudo/cache` 是安全的 —— 键内容寻址，miss 就重算。始终 gitignore；绝不入库。契约文件（`*.nudo.js`）进 git；缓存不进。
- **不可信 runner：** 保持关闭 —— `nudo.cache: false`（或不设）且 `NUDO_CACHE_DIR=off`。
- **依赖层**（`~/.cache/nudo/deps`）才是 CI 值得弄的那层：默认开启、跨项目、纯签名投影。把 `NUDO_DEPS_CACHE_DIR` 指到 restore 出来的目录即可跨 job 复用 harvest 成果；陈旧或损坏的副本只会 miss。

## 会话缓存上限（进程内 LRU）

与上面的磁盘缓存是两个不同的杠杆：每个 Nudo 进程内部都维护内存 LRU 缓存，服务热路径重分析 —— 整文件分析结果、逐函数分析、求值器 run。它们的**条目数**通过 `package.json#nudo.sessionCache` 封顶。这只是内存与 warm 命中之间的取舍，绝不是精度旋钮 —— 逐出只是诚实重算，结果与诊断完全不变。

| 键（`nudo.sessionCache.*`） | 环境变量 | 封什么 | 默认 |
|---|---|---|---|
| `maxFiles` | `NUDO_CACHE_MAX_FILES` | 整文件分析结果 LRU 条目 | `64` |
| `maxFns` | `NUDO_CACHE_MAX_FNS` | 逐函数分析 LRU 条目 | `1024` |
| `maxEvalRuns` | `NUDO_CACHE_MAX_EVALRUNS` | 求值器 run LRU 条目 | `32` |

- 优先级：环境变量 > `package.json#nudo.sessionCache` > 默认。`0` / `off` 关闭该层；数值钳制到 `65,536`。
- 多项目共用一个 IDE/LSP 进程时调低；大单仓可调高换 warm 命中。
- 与持久化磁盘缓存（上面的 `nudo.cache` / `NUDO_CACHE_DIR`）正交：会话上限随进程消失，绝不落盘。

## 配置速查

| 想要 | 设置 |
|---|---|
| 调高分支预算 | `NUDO_MAX_FORKS=20000` 或 `package.json#nudo.analysis.maxForks` |
| 每函数合并更多调用点 | `package.json#nudo.analysis.callSiteBudget`（1–64，默认 3） |
| 打开项目磁盘缓存 | `package.json#nudo.cache: true`（→ `.nudo/cache`） |
| 自定义缓存目录 | `nudo.cache: ".nudo-cache"` 或 `NUDO_CACHE_DIR=/abs/path` |
| 关闭依赖缓存 | `NUDO_DEPS_CACHE_DIR=off` |
| 封顶进程内会话缓存 | `package.json#nudo.sessionCache.*` / `NUDO_CACHE_MAX_FILES` · `NUDO_CACHE_MAX_FNS` · `NUDO_CACHE_MAX_EVALRUNS` |

完整配置表 —— 全部 `package.json#nudo` 键与 `NUDO_*` 变量 —— 见[配置参考](../reference/config.md)。

## 下一步

- [诊断](../reference/diagnostics.md) —— `nudo:recursion-truncated` / `nudo:fork-truncated`
- [边界与非目标](../concepts/limits.md)
- [nudo check](./check.md)
- [CLI 参考](../api/cli-reference.md)
