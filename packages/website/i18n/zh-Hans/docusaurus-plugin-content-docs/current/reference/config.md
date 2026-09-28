---
slug: /reference/config
description: 全部 package.json#nudo 配置键与 NUDO_* 环境变量 —— 取值、默认值、优先级与生效位置。
---

# 配置参考

Nudo 从 `package.json` 的 `nudo` 键读取项目配置 —— 没有 `nudo.json`、`.nudorc` 或 `nudo.config.js`。进程级开关是 `NUDO_*` 环境变量。

**配置从哪里找：** 对每个被分析的文件，Nudo 从该文件所在目录向上查找，使用**最近一个带 `nudo` 键的 `package.json`**。不带 `nudo` 键的 `package.json` 不会终止查找 —— monorepo 里，仓库根部的配置对自有 `package.json` 但无 `nudo` 键的子包仍然可见。

键的归一化是宽松的：非法值回落默认（`nudo.check.entryThrows` 额外在 stderr 打印警告），不会导致运行失败。

## 最小示例

```json
{
  "name": "my-app",
  "nudo": {
    "check": {
      "profile": "adoption",
      "ignoreThrows": ["TypeError"]
    },
    "analysis": {
      "mode": "exports",
      "exclude": ["**/node_modules/**", "**/dist/**", "**/coverage/**"]
    },
    "sessionCache": {
      "maxEvalRuns": 64
    }
  }
}
```

## `nudo.check` —— CI 门禁

| 键 | 取值 | 默认 | 含义 |
|---|---|---|---|
| `check.profile` | `"adoption"` \| `"strict"` | `"strict"` | 门禁命名档。`adoption` 把 L2 入口 may-throw 降为 **warning**；`strict` 保持 error。两个档位都**不吞 L1** —— 显式契约违例始终是 error。 |
| `check.entryThrows` | `"error"` \| `"warning"` \| `"off"` | `"error"` | L2 `nudo:entry-may-throw` 诊断的严重级。同层的显式值压过 `profile`。非法值在 stderr 告警并使用 `"error"`。 |
| `check.ignoreThrows` | string[]（throw 类型名） | `[]` | 仅作用 L2 的 throw 类型名过滤（如 `["TypeError", "RangeError"]`）。CLI 旗标 `--ignore-throws` 与该列表**加法合并**（并集），项目配置可按次调用收紧或扩展。从不过滤 L1 违例。 |

对应的 CLI 旗标见 [CLI 参考 —— `nudo check`](../api/cli-reference.md)，门禁的诊断码见 [诊断](./diagnostics.md)。

### L2 `entryThrows` 解析顺序

生效的 L2 严重级取以下第一个已设置的来源：

1. CLI `--entry-throws`（显式 —— 压过任何 profile）
2. CLI `--profile` 预设（`adoption` → `warning`，`strict` → `error`）
3. `package.json#nudo.check.entryThrows`
4. `package.json#nudo.check.profile`
5. 默认 `strict`（`error`）

「显式值压过预设」的规则同样适用于 `package.json` 内部（第 3 条先于第 4 条），因此只读配置的 IDE/LSP 门禁与 CLI 同口径。每一步都不影响 L1 契约违例。

## `nudo.contract` —— 侧车

| 键 | 取值 | 默认 | 含义 |
|---|---|---|---|
| `contract.autoBind` | boolean | `true` | `*.nudo.js` 侧车的 ambient 绑定，供 `check`、LSP 执法与 `contract` 打印共用。`false` 时侧车不再被 ambient 加载。 |
| `contract.emit` | string \| string[]（glob，相对项目根） | `[]` | 契约 emit（`nudo contract --emit` 与 LSP persist lens）的白名单。空 = 不按路径过滤。模式匹配的是**源文件**路径（不是侧车路径）；白名单外的 emit 目标被拒绝并给出 `emit-denied` warning。 |

## `nudo.env` —— 运行时环境

| 键 | 取值 | 默认 | 含义 |
|---|---|---|---|
| `env` | string[]（env 名） | `[]` | 项目级运行时 env 预设：内置 `"es"`、`"web"`、`"node"`（`web` 与 `node` 隐含 `"es"`），或路径型 env 模块。与文件级 `/// @nudo:env` 指令求并集去重 —— 两层始终同时生效。 |

路径型 env 文件与内置 env 见 [`@nudo:env`](../concepts/directives.md)。

## `nudo.analysis` —— 范围与噪声档（IDE / watch）

| 键 | 取值 | 默认 | 含义 |
|---|---|---|---|
| `analysis.include` | string[]（glob） | `[]`（不过滤） | IDE / vite-plugin / watch 扫描分析的路径过滤。 |
| `analysis.exclude` | string[]（glob） | `["**/node_modules/**", "**/dist/**", "**/coverage/**"]` | IDE 分析排除的路径。显式空数组回落到该默认安全列表 —— `node_modules` 保护不会被误关。 |
| `analysis.mode` | `"directives"` \| `"exports"` \| `"all"` | `"exports"` | IDE / 构建分析哪些文件：`exports` = 含 `export` / 侧车 / `@nudo:` 指令的文件；`directives` = 仅注解文件；`all` = 所有目标路径。点名路径的 CLI 命令（`nudo check src/lib.js`）不受 mode 影响，始终分析该文件。 |
| `analysis.diagnostics` | `"off"` \| `"errors"` \| `"default"` \| `"verbose"` | `mode` 为 `"directives"` 时 `"errors"`，否则 `"default"` | IDE 诊断噪声档。 |
| `analysis.evalMissingSlot` | `"off"` \| `"warning"` | `"off"` | C0.5：求值真实命中已知形状缺字段时发 `nudo:missing-slot` **warning**。是观察不是义务 —— 见[限制](../concepts/limits.md)。 |
| `analysis.callSiteBudget` | 整数 1–64 | `3` | 每个函数保留的精确调用点 case 数（多态展开）。超预算的调用点符号化折叠为 `#widened` 结果。 |
| `analysis.maxForks` | 整数 ≥ 1 | `5000` | 分支展开（`$fork`）总预算。命中时：`nudo:fork-truncated` warning 且结果 widen。`NUDO_MAX_FORKS` 压过该键；非法值回落默认。 |

范围调优实操（TS/JS 混合仓、`directives` vs `exports`）见[与 TypeScript 共存](../guides/coexistence.md)；预算行为见[性能](../guides/performance.md)。

## `nudo.cache` —— 项目磁盘缓存

| 取值 | 含义 |
|---|---|
| `true` | 缓存于 `<项目根>/.nudo/cache`。 |
| `"some/dir"` | 自定义缓存根，相对项目根解析。 |
| `false` / 省略 | 关闭（默认）。 |

默认关闭 —— 伪造的缓存报告可能掩盖违例，只在可信机器上开启，并将 `.nudo/cache` 加入 gitignore。落盘内容、fail-open 语义与 CI 指引见[性能 —— `.nudo/cache` 磁盘缓存](../guides/performance.md)。

**优先级提示：** 与多数键不同，任何显式的 `nudo.cache` 值（包括 `false`）都压过 `NUDO_CACHE_DIR`；只有 `nudo.cache` 未设置时才读环境变量。

## `nudo.sessionCache` —— 进程内 LRU 上限

| 键 | 环境变量 | 默认 | 封顶对象 |
|---|---|---|---|
| `sessionCache.maxFiles` | `NUDO_CACHE_MAX_FILES` | `64` | 整文件分析结果 LRU 条数。 |
| `sessionCache.maxFns` | `NUDO_CACHE_MAX_FNS` | `1024` | 每函数分析 LRU 条数。 |
| `sessionCache.maxEvalRuns` | `NUDO_CACHE_MAX_EVALRUNS` | `32` | evaluator 运行 LRU 条数。 |

`0`（或环境变量 `"off"` / `"0"`）关闭该层；数值被钳制到硬上限 65,536。这只是内存与 warm 命中的权衡 —— 驱逐后诚实重算，结果与诊断完全一致。详见[性能 —— 会话缓存上限](../guides/performance.md)。

## 环境变量

| 变量 | 管什么 | 默认 | 取值 |
|---|---|---|---|
| `NUDO_MAX_FORKS` | 分支展开预算（与 `nudo.analysis.maxForks` 同一旋钮） | `5000` | 整数 ≥ 1；非法回落默认。压过配置键。 |
| `NUDO_CACHE_DIR` | 项目磁盘缓存根（与 `nudo.cache` 同一旋钮） | 未设置（关） | 绝对路径，或 `off` / `0` 关闭。仅在 `nudo.cache` 未设置时读取。 |
| `NUDO_CACHE_MAX_FILES` | 会话 LRU `maxFiles` | `64` | 整数；`0` / `off` 关闭该层；钳制到 65,536。 |
| `NUDO_CACHE_MAX_FNS` | 会话 LRU `maxFns` | `1024` | 规则同上。 |
| `NUDO_CACHE_MAX_EVALRUNS` | 会话 LRU `maxEvalRuns` | `32` | 规则同上。 |
| `NUDO_DEPS_CACHE_DIR` | 跨项目 `@types` harvest 缓存根 | `~/.cache/nudo/deps` | 路径，或 `off` / `0` 关闭 deps 层。fail-open；见[性能](../guides/performance.md)。 |
| `NUDO_HARVEST_NODE` | `@types/node` harvest | 开启 | `off` 关闭 Node API harvest（显式跳过，不是静默回退）。 |
| `NUDO_DRAFT_FORCE` | 契约草稿写盘守卫 | 未设置 | `1` 允许在找不到项目根时执行 `contract --draft --write`（及 agent 草稿写盘工具）。 |

## 优先级

一般顺序是 **CLI 旗标 > 环境变量 > `package.json#nudo` > 默认**，但若干键有偏差 —— 以下均为代码验证过的行为：

| 旋钮 | 实际优先级 |
|---|---|
| L2 `entryThrows` | 上文 5 步顺序：CLI 旗标 > CLI 预设 > 配置值 > 配置预设 > 默认。 |
| `ignoreThrows` | **加法合并**，不是覆盖：CLI `--ignore-throws` 与 `nudo.check.ignoreThrows` 求并集。 |
| `maxForks` | `NUDO_MAX_FORKS` > `nudo.analysis.maxForks` > 5000（无 CLI 旗标）。 |
| `sessionCache.*` | 显式宿主 API（`setSessionCacheLimits`）> `NUDO_CACHE_MAX_*` > `nudo.sessionCache.*` > 默认。 |
| 磁盘缓存 | `nudo.cache`（任何显式值，含 `false`）> `NUDO_CACHE_DIR`（仅键未设置时）> 关。 |
| `NUDO_DEPS_CACHE_DIR` / `NUDO_HARVEST_NODE` / `NUDO_DRAFT_FORCE` | 纯环境变量旋钮；没有 `package.json` 对应键。 |

配置查找本身（`findProjectConfig`）以被分析文件的位置为锚点，因此同一 monorepo 里给不同子包各自放带 `nudo` 键的 `package.json` 即可让它们使用不同配置。
