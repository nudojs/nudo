# 持久化分析缓存（`.nudo/cache`）

> **状态**：L1 CheckJson 骨架已落地（2026-05）；L2 harvest / effectiveInterface
> 表缓存仍为设计稿。与 [`design-refine-derivation.md`](./design-refine-derivation.md)
> §7.4 的「可选 `.nudo/cache`」衔接：契约文件（`*.nudo.js`）仍是用户表面，
> 缓存是引擎私有、可丢、可重建。
>
> **已实现（B3 最小闭环）**：`packages/service/src/disk-cache.ts`
> - `DiskCache`：sha256 内容键 + `ANALYSIS_ABI` 前缀，fail-open
> - `nudo check` 在无 `--callsites` 时读写 CheckJson（默认关）
> - 启用：`package.json#nudo.cache: true`（→ `.nudo/cache`）、
>   字符串自定义根，或 `NUDO_CACHE_DIR`；`off`/`false` 关闭
> - B4：`nudo.analysis.callSiteBudget`（默认 3）；超限 symbolic `#widened`
>
> **一句话**：把「不变依赖 + 已分析源码」的**可再执行投影**落到磁盘，冷启动
> 复用；键必须 content-addressable 且相对路径化，失效宁可过杀、不可陈旧命中。
> L1 check 报告默认关闭（投毒面），L2 harvest 是第一优先级。
>
> **与 TypeValue 的关系**：本文不再设计 TypeValue 编解码 / `emitEnvModule`
> 回放。L2 落盘的是 **HarvestJson**（纯 JSON 的导出签名投影），读回后
> materialize 为 `AbsModuleExports`。Abs 本体仍不序列化。

---

## 0. 问题

当前所有分析缓存都是进程内 `Map`：

| 缓存 | 模块 | cap | 冷启动是否本设计覆盖 |
|---|---|---|---|
| generalize L0 | `core/generalize.ts` | 1024 | 否（Abs 本体） |
| check 整文件 memo | `core/check.ts` | 256 | Phase C（可选，默认关） |
| parse AST LRU | `core/parse-source.ts` | 16 | 否（快，重算便宜） |
| 侧车 exec | `core/refine.ts` | 64 | 否（含闭包） |
| AnalysisResult | `service/analysis-file-cache.ts` | 64 | 否（B-path） |
| per-fn FunctionAnalysis | `service/fn-analysis-cache.ts` | — | 否 |
| Abs 模块图 / B-path | `service/abs-modules-graph.ts` / `bpath-run.ts` | — | 否 |
| harvest 进程内 | `service/harvest-auto.ts` | Map | **是（L2 主战场）** |

LSP 长驻会话 after-edit 靠这些 memo；**CLI 每次冷启动全部重算**。

真正的冷启动大头是：

1. **harvest**：每个裸包走 `collectDtsFromEntry` / `collectDtsFiles` + dts
   解析 → Abs 导出表——跨项目几乎不变，磁盘收益最大。
2. **`checkSource` 整文件**（CLI 默认路径，Abs 代数）——可投影为 `CheckJson`。
3. **`effectiveInterface` / interface surface 打印**——按文件整表缓存契约读取结果。

**L2 实际省掉什么**：TS 解析 / harvest 物化。为算 content hash 仍需**读入**
选中的 `.d.ts`；可用 mtime+size 预检避免无谓读盘（见 §3 L2）。
**不省**：`collectDts*` 的目录遍历与 resolve。

**不在磁盘层覆盖**：B-path transpile、Abs 对象图、完整 analyze 结果。
因此 `nudo interface` / `infer` / `doctor` 的**完整分析**不会因本设计变快；
加速的是 harvest、check 门禁、以及契约读取/打印路径。

---

## 1. 目标与非目标

### 前提（实施门槛）

1. **TypeValue 已从主路径删除**；harvest 不再产出 TypeValue / 不再依赖
   `emitEnvModule`、`setEnvModules`、`typeValueToAbs` 桥。
2. harvest 出口是可 JSON 化的 **HarvestJson**（§5.3），或等价的纯数据签名表；
   load 时 materialize 为 `AbsModuleExports`（`conf=mock`，fn 为 dummy-apply）。
3. 在此前提满足前，**不开工 L2**；L1 / cache-store 基建可先行。

### 目标

1. **依赖包层收益最大（L2）**：`node_modules` / `@types` 的 harvest 投影
   跨项目、跨会话长期复用；第二次分析同一包跳过 dts 解析与物化。
2. **check 冷路径可复用（L1，opt-in）**：`nudo check`（无 `--callsites`）对
   未变更文件走磁盘 `CheckJson`，不重跑 Abs 求值。
3. **契约读取可复用（L1）**：`effectiveInterface` 整文件导出表 + implicit
   负缓存，服务 `nudo interface` 打印 / surface，不服务完整 B-path 分析。
4. **绝不陈旧命中**：键漏维度 = 错诊断；宁可 miss 重算。
5. **可丢可重建**：损坏/版本不匹配/用户 `rm -rf .nudo/cache` 均 fail-open。
6. **与现有 memo 同源**：键复用内容语义；磁盘键**原料用 sha256**（不用
   内存 FNV），并做**相对路径化**。

### 非目标

- 不缓存 Abs 本体 / AST / PolyFn / B-path 产物 / AnalysisResult。
- 不缓存截断 / opaque / mock 改道的**分析**结果（证据不稳）。
- harvest 投影本身按 mock 签名消费，不承载可执行 impl（见 §5.3）。
- 不做远程/共享缓存（Bazel remote cache 那类）。
- 不替代进程内 L0 / check memo——磁盘是冷路径，内存是热路径。
- 不承诺 `nudo interface` / `infer` 整条分析链路加速（见 §0）。
- 不为 `--callsites` 注入路径做整报告磁盘复用（见 §8）。
- **不做 TypeValue 序列化、emit 模块回放**（前提已删除该 IR）。

---

## 2. 成熟方案对照

| 工具 | 键 | 失效 | 对 Nudo 的启发 |
|---|---|---|---|
| **TypeScript incremental**（`.tsbuildinfo`） | file version + compilerOptions + 依赖文件 version | options 变 / 文件变 | 存「指纹 → 结果」而非 AST；options 进键 |
| **webpack 5 filesystem cache** | snapshot：file hash + meta；loader chain 进键 | snapshot 不等即 miss | content hash 优先于 mtime；依赖快照可组合 |
| **cargo** | package + features + rustc 版本 + deps fingerprint 递归 | 任一输入变 | 工具**语义分析版本**进全局前缀 |
| **jest transform cache** | file content + transformer config + jest version | content/config 变 | 不要用 mtime 当唯一键 |
| **ESLint cache** | mtime + config hash（偏粗） | mtime 误判已知坑 | **不采用 mtime-only** |
| **Bazel action cache** | action digest（全部输入） | digest 变 | 输入完备性 > 局部优化 |
| **Vite optimizeDeps** | lockfile + config hash | lockfile 变 | 依赖层可与项目层分离 |

**裁决**：

1. **content-addressable**（hash），不用 mtime 当主键（NFS/CI 上 mtime 不可靠；
   ESLint 踩过）。mtime+size 可作**廉价预检**（未变则免读文件算 hash），但
   命中后仍要比对 content hash（预检相等时可直接信任该文件 hash 缓存）。
2. **schema 版本 + 分析 ABI 版本**进全局前缀（见 §5.4）；不用每个 patch
   的 npm 版本字符串一刀切清空。**`typescript` 包版本必须进 `analysisAbi`**
   （dts 解析语义随 TS 变）。
3. **分层**：不变依赖 vs 项目源码（Vite optimizeDeps / Bazel 的 action 层次）。
4. **fail-open**：读失败 / 版本不符 / 截断 / 校验失败 → 当 miss，绝不 throw。
5. **磁盘键相对路径化**：内存指纹里的绝对路径不得原样进磁盘键（CI/容器
   换 root 会永久 miss；安全但无收益，也妨碍 monorepo 共享 L2）。
6. **磁盘键原料用密码学 hash**：文件内容进键一律 `sha256`；不把
   `hashSource`（FNV，仅适合进程内 LRU）拼进磁盘键。

---

## 3. 三层架构

```
┌─────────────────────────────────────────────────────────┐
│  L0 内存（现有）  generalize / check memo / fn analysis  │  ← 热路径
├─────────────────────────────────────────────────────────┤
│  L1 项目磁盘  .nudo/cache/  本仓库投影结果               │  ← 冷启动
├─────────────────────────────────────────────────────────┤
│  L2 依赖磁盘  ~/.cache/nudo/deps/  node_modules 投影     │  ← 跨项目
└─────────────────────────────────────────────────────────┘
```

### L2 依赖层（收益最大）

**缓存什么**

| 条目 | 源 | 值形态 |
|---|---|---|
| harvest env 投影 | harvest（dts → 导出表） | **`HarvestJson`**（§5.3：纯 JSON，可 materialize 为 `AbsModuleExports`） |
| Abs 模块导出 | `evalAbsModuleGraph` 对 bare 包 | **不落盘**；由 HarvestJson 每次 materialize，或进程内 memo |

**不进 L2**：本机绝对路径（`root` / `dtsFiles`）、项目侧 mock/env 注入后的
导出表、Abs 对象图、任何可执行闭包。

**键**

```
depKey = sha256(
  "nudo-dep-cache-v1" +
  analysisAbi +               # 见 §5.4，含 typescript 版本；非 package.json 版本
  pkgName + "\0" + pkgVersion +
  harvestKnobs +              # maxFiles 等选文件策略（若可配置则显式进键）
  dtsClosureHash              # collectDts 实际读到的 .d.ts 内容 sha256 排序拼接
)
```

`dtsClosureHash` 必须覆盖 `collectDtsFromEntry` / `collectDtsFiles` 实际
读到的**每个文件的内容**——包内多文件时只 hash 入口不够。file:/patch 依赖
同版本不同内容会 miss（正确）。

**mtime+size 预检**：L2 目录可附带 per-file snapshot
`{ pathHash: { mtimeMs, size, sha256 } }`（或嵌在条目元数据里）。下次
walk 时：mtime+size 全等 → 复用 sha256，免读内容；任一变 → 重读重算。
预检**不能**单独当命中依据，只加速算 hash。

**位置**：`$XDG_CACHE_HOME/nudo/deps/` 或 `~/.cache/nudo/deps/`  
（跨项目共享；Windows: `%LOCALAPPDATA%/nudo/deps`）

**为何 L2 可以存 harvest**：输入是 `.d.ts` 文本，输出是结构化导出签名；
同一包同一版本 + 相同 dts 闭包在不同项目结果应相同（不依赖项目上下文）。

**进程内 Map 不替换**：`harvestPackageCached` 继续用 `fromDir::pkg` 做
resolve 短路；磁盘 L2 挂在 content 键下。不把进程内键改成「先 resolve
再 hash」——那是无谓 I/O。

### L1 项目层

**缓存什么**（只存可 JSON 化 / 可再执行的投影）

| 条目 | 值形态 | 粒度 | 默认 |
|---|---|---|---|
| effectiveInterface 表 | `{ fns: Record<fnName, EffectiveInterface \| null>, diags?: [...] }`，约束为 plain JSON | **整文件导出表** | Phase B 开 |
| derive 投影 | `DerivedExport[]`（约束 + dsl 字符串，不含 Abs） | 整文件 | Phase B 开 |
| check 报告 | **`CheckJson`**（复用 `serializeCheckJson`） | 整文件 | **Phase C，默认 `false`** |

`null` = implicit 负缓存（`effectiveInterface` 返回 `undefined`）。
`diags` = 文件级 interface 侧信道诊断的可选快照（见 §11）。

**不进 L1**

- Abs / term / pred 对象图、AST、PolyFn、B-path transpile、AnalysisResult
- 截断 / opaque / mock 相关的**分析**结果
- 带 `loadModuleId` 的内存键维度（CLI 与 LSP 的 loadModule 身份不同）
- 任何含本机绝对路径的指纹**原文**（见 §3.1）
- FNV `hashSource` 原文（见 §2 裁决 6）

**键**（见附录 A；内容语义对齐内存 memo，路径已相对化，内容段用 sha256）

#### 3.1 磁盘键相对路径化

内存 `loadModuleDepsFingerprint` / `sidecarClosureFingerprint` 产出条目形如
`${absPath}=${hashSource(src)}`。磁盘键组装前做变换：

```
relPath = normPath(path.relative(projectDir, absPath))   # 出 projectDir 则 "ext:" + sha256(path)
content = sha256(fileSource)                             # 不用 FNV
diskFp  = 排序拼接(`${relPath}=${content}`)
```

`projectDir` 来自 `findProjectConfig` / CLI 解析的项目根。相对化失败
（符号链接逃逸等）→ 该键作废，当 miss（fail-open）。

**monorepo**：不同 `projectDir`（仓库根 vs 子包）相对化结果不同 → 键不同
→ 安全但可能双份。`nudo.cache` 配置与 `interface` 同一 package.json
可见性规则（向上找第一个带 `nudo` 键的包）；子包要独立 cache 配置须在
自己的 package.json 上带 `nudo` 键。

L2 键不包含路径，无需此步。

---

## 4. 磁盘布局

```
.nudo/cache/
  meta.json                 # { schema, analysisAbi, createdAt, typescript }
  iface/
    <keyHash[0:2]>/<keyHash>.json
  derive/
    <keyHash[0:2]>/<keyHash>.json
  check/                    # 仅 cache.check.enabled 时写入
    <keyHash[0:2]>/<keyHash>.json

~/.cache/nudo/deps/
  meta.json
  harvest/
    <keyHash[0:2]>/<keyHash>.json
  harvest-snapshots/        # 可选：per-package mtime+size→sha256 预检
    <pkgKeyHash[0:2]>/<pkgKeyHash>.json
```

- **两级目录**（`ab/abcdef….json`）避免单目录文件爆炸（参照 git object）。
- **原子写**：与 `interface-emitter.ts` 同策略——**目标同目录** tmp +
  `rename`；tmp 名含 `pid` + 随机后缀（防可预测路径 / 跨设备 rename 失败）。
  rename 失败 unlink tmp。
- **keyHash** = 附录 A 各键的 sha256 hex（完整 64 字符，不用 FNV——磁盘
  碰撞代价是错结果；内存 LRU 继续用 `hashSource` FNV）。
- **权限**：L2 目录 user-only（`0o700` / 文件 `0o600`），降低共享可写目录
  的投毒面。

---

## 5. 序列化

### 5.1 NudoConstraint

`toPlainConstraint`（`core/algebra/constraint.ts`，当前**未导出**）归一化
后剥掉 builder 方法。实施时：

1. 导出 `toPlainConstraint`，或新增 `serializeConstraint` /
   `deserializeConstraint`（推荐后者：读回 + `isNudoConstraint` +
   递归校验 `fields`/`element`/`members`/`fn`）。
2. 非法 → 丢弃当 miss，不 throw。

```json
{
  "__nudoConstraint": true,
  "prim": "number",
  "preds": [{ "op": "gt", "a": { "op": "var", "id": "__nudo_self__" }, "b": { "op": "lit", "value": 0 } }]
}
```

### 5.2 Check 报告

**直接复用 `CheckJson`**（`core/algebra/check-report.ts` 的
`serializeCheckJson`），不另发明子集格式。Abs 已降为 `formatAbs` 字符串。

读回后当作只含展示面的报告：**没有 `NudoSig.abs`**。消费方仅限：

- `formatCheckReport` / `serializeCheckJson` 重输出（CLI 打印与 `--json`）；
  建议新增 `formatCheckJson(j)` 或 `checkJsonToReport(j)`（`abs` 用 dummy，
  **禁止**再进入 leq / generalize）；
- CI 门禁读 `ok` / `issues`。

任何还要 Abs 的路径 → miss 重算。LSP **不** 接此磁盘层。

### 5.3 HarvestJson（L2 值形态；TypeValue 已删除）

TypeValue 移除后，harvest 不再产出可执行闭包 / symbol id / refinement
方法表。L2 落盘的是**签名与形状投影**，读回 materialize 为
`AbsModuleExports`（与今日 `harvestedValueToAbs` 同语义：`conf=mock`，
fn 为 dummy body + `apply` 返回声明返回类型）。

```ts
type HarvestPrim = "number" | "string" | "boolean" | "bigint" | "symbol";

type HarvestJson =
  | { k: "lit"; value: string | number | boolean | null | undefined }
  | { k: "prim"; type: HarvestPrim }
  | { k: "unknown" }
  | { k: "never" }
  | { k: "arr"; element: HarvestJson }
  | { k: "tup"; elements: HarvestJson[] }
  | { k: "obj"; properties: Record<string, HarvestJson> }
  | { k: "inst"; className: string; properties?: Record<string, HarvestJson> }
  | { k: "prom"; value: HarvestJson }
  | { k: "sum"; members: HarvestJson[] }
  | {
      k: "fn";
      params: string[];
      returns: HarvestJson;
      throws?: HarvestJson;
    };

type HarvestEnvJson = {
  version: 1;
  globals: Record<string, HarvestJson>;
  modules: Record<string, Record<string, HarvestJson>>;
  stats: { files: number; symbols: number; skipped: number };
};
```

**红线**

1. 投影**不含**可执行 impl / body / closure / refinement 方法；materialize
   后的 fn 一律 mock-apply。这与今日 B-path 消费 harvest 的方式一致，不是
   新损失。
2. 未知 `k` / 结构非法 → 整条 env **当 miss**，不部分消费。
3. round-trip 验收：materialize 后导出名集合一致；
   `formatAbs` / 关键签名 display 与现场 harvest 一致（允许 conf 标签
   差异若有约定，须在测试中钉死）。
4. **不**走 emit 模块文本回放、不 `eval`、不动态 import 缓存 JS。

`HarvestJson → AbsModuleExports` 的 materialize 纯函数放在 service（或
core 邻接模块），无 fs、无 TS 依赖，可单测。

### 5.4 版本前缀

```
globalPrefix = "nudo-" + kind + "-v" + schema + "@" + analysisAbi
```

| 字段 | 含义 | 何时 bump |
|---|---|---|
| `schema` | 磁盘文件 JSON 形状 | 字段增删/语义变 |
| `analysisAbi` | **分析语义版本**（手写常量，**拼入 typescript 版本**） | 诊断/求值/dts 解析语义变；升级 `typescript` |

`analysisAbi` **不是** `package.json#version`。修 CLI 文案、文档、LSP
 UX 不应清空 L2。

建议形态：`analysisAbi = "<手写语义版本>+ts<typescript 版本>"`，
例如 `1+ts5.7.2`。`meta.json` 同步记录，便于诊断「为何全 miss」。

`meta.json` 的 `schema` 不匹配 → 整目录忽略或清空。不写迁移器。

---

## 6. 失效

| 事件 | 行为 |
|---|---|
| 源码 / 侧车 / dep 内容变 | 键变 → 自然 miss（content hash） |
| `autoBind` / emit 白名单变 | **iface 键不含 allowlist**（见附录 A）；emit 路径不靠 L1 绕过白名单 |
| `analysisAbi` / `schema` / typescript 升 | 全局前缀变 → 全 miss |
| 依赖文件删除 / 内容与键不符 | 读时校验失败 → miss |
| 用户删 `.nudo/cache` / depsDir | 全 miss，行为不变 |
| 截断指纹（`trunc:` / `truncated`） | 不读不写 |
| 损坏 JSON / 未知 HarvestJson `k` | miss，不 throw |
| harvest 选文件策略参数变 | 文件集变 → dtsClosureHash 变 → miss |

**不做**主动逐出图（不像内存 memo 的 `nudoDepParents`）：磁盘层靠键完备性。

**GC**：

- L1：超过 `maxMb` 时按 mtime 删最旧。
- L2：独立上限（默认更大，如 `depsMaxMb`）；**命中时 touch mtime**
  （`utimes`），避免热门条目仅因写入早被踢。
- Phase 1 可只做「目录超过 N MB 时按 mtime 删最旧」。

---

## 7. 配置

沿用 `package.json#nudo`（与 `interface` 同一可见性：向上第一个带 `nudo`
键的 package.json）：

```json
{
  "nudo": {
    "cache": {
      "enabled": true,
      "dir": ".nudo/cache",
      "depsDir": "~/.cache/nudo/deps",
      "maxMb": 128,
      "depsMaxMb": 512,
      "check": false
    }
  }
}
```

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true`（实施后） | 总开关；false = 完全不读不写盘 |
| `dir` | `.nudo/cache` | 项目层；相对 projectDir |
| `depsDir` | 平台 cache 目录 | 依赖层；可指到 monorepo 共享位置 |
| `maxMb` | `128` | L1 超出按 mtime GC |
| `depsMaxMb` | `512` | L2 独立配额 |
| `check` | **`false`** | L1 CheckJson 缓存；见 §9 投毒红线 |

**`~` 展开**：`depsDir` / `dir` 中的 `~` 由 host 显式展开为 `os.homedir()`，
不依赖 shell。

环境变量覆盖：

| 变量 | 作用 |
|---|---|
| `NUDO_CACHE=0` | 禁用全部磁盘缓存（CI 可关） |
| `NUDO_CACHE_CHECK=1` | 强制打开 L1 check 缓存（覆盖 `check: false`） |
| `NUDO_CACHE_DIR` | 覆盖 L1 路径 |
| `NUDO_CACHE_DEPS_DIR` | 覆盖 L2 路径 |

**CI 建议**：默认只恢复/保存 L2（depsDir）；L1 check 除非 runner 可信
且 cache 来自 main，否则保持 `NUDO_CACHE=0` 或 `check: false`。

---

## 8. 接入点

```
harvestPackage / harvestPackageCached
  └─ 进程内 fromDir::pkg（现有，保留）
       └─ miss → resolve + collectDts + 解析
            └─ L2 lookup(depKey) → hit 反序列化 HarvestJson → materialize Abs
                 └─ miss → 现场 harvest → HarvestJson → 写盘 → materialize

effectiveInterface（host 每文件一次）
  └─ L1 lookup(ifaceKey) → hit 取整表[fns（+可选 diags）]
       └─ miss → 逐 fn 算 effectiveInterface（含 implicit→null）→ 写盘

deriveFromRoot / emitDerivedFromRoot
  └─ L1 derive 投影（不含 Abs）

checkSource（仅 CLI 默认路径）
  └─ 内存 memo（现有）
       └─ miss → L1 check（仅 cache.check.enabled）
            └─ hit 反序列化 CheckJson
                 └─ miss → 算完 → serializeCheckJson → 写盘
```

**明确不接磁盘旁路**：

| 路径 | 原因 |
|---|---|
| `analyzeFile` / B-path 完整结果 / Abs 对象图 | 非目标 |
| `check --callsites` | 额外跑调用点采集合并 `domain-exceeds`；整报告不可复用 check 磁盘条目。callsites 模式 **跳过 L1 check 读写** |
| 非 `pTrue` 的 `checkSource` | 与内存 `useMemo` 同口径：不落盘 |
| LSP validate | 只走内存；长驻进程启动可读一次，之后以内存为准 / 只写（可选） |
| emit 白名单决策 | 磁盘命中不得绕过 `matchesEmitAllowlist` |

**watch / LSP**：磁盘层在会话内 **启动读一次，之后只写不读**——避免双源
纠缠。

**vite-plugin**：冷启动可读；CI 用 `actions/cache` 时键用 lockfile hash +
`analysisAbi`（含 ts 版本）；**不要**恢复 PR 不可信 cache 进 check 门禁。

---

## 9. 安全与正确性红线

1. **键完备性 > 命中率**。新增影响结果的输入必须进键；不确定就进键。
2. **不信任磁盘**。读入校验 schema + 结构；失败当 miss，不 throw。
3. **不缓存证据不稳的分析结果**：`truncated` / `conf=opaque` / mock 注入 /
   截断求值 → 不写。harvest 投影按 mock 消费是**既定语义**，不是不稳证据。
4. **手写契约优先语义不因缓存改变**：缓存的是读取结果快照，不是新真理源。
5. **路径规范化**：键内路径一律 `projectDir` 相对 + `normPath`；
   相对化失败 → 键作废。
6. **并发**：同目录 tmp+rename 幂等；读到半截 JSON → catch 当 miss。
7. **投毒（check 门禁）**：结构合法的假 `CheckJson`（`ok: true, issues: []`）
   可在 key 命中时制造假阴性。因此：
   - L1 check 缓存 **默认关闭**；
   - 开启后仅用于本地/可信 CI；
   - PR cache、共享 runner、用户可写 `.nudo/cache` 进仓库 → 视为不可信；
   - `.gitignore` 必须包含 `.nudo/cache`；文档警告勿提交；
   - L2 目录权限 user-only；键原料 sha256（不用 FNV）。
8. **HarvestJson 非法 / 未知节点 → 整条 miss**：宁可重 walk dts，不消费半份 env。
9. **磁盘键原料禁用 FNV**：`hashSource` 只留在进程内 memo。

---

## 10. 分阶段实施

> **前置门**：TypeValue 删除完成，harvest 出口已能稳定产出 HarvestJson
> （或先实现 HarvestJson 与 materialize，再切换 harvest 调用方）。
> 在此前只允许 Phase A′。

### Phase A′ — 基建（不依赖 TypeValue 删除）

1. `service/cache-store.ts`：`get/set` + 同目录原子写 + meta + GC 骨架 + 权限  
2. 键工具：`cacheKey(parts: string[]): string`（sha256）+ `relativizeFp()`
   + `sha256(content)`（磁盘原料）  
3. 导出/新增 constraint 序列化（§5.1）  
4. 测试：损坏 JSON miss；版本变 miss；tmp+rename 原子性；FNV 不进键  

### Phase A — L2 harvest（依赖 §5.3 + harvest 出口切换完成）

1. 冻结并实现 `HarvestEnvJson` schema + `materializeHarvestEnv`  
2. `harvestPackage` 接 L2：进程内 `fromDir::pkg` 保留；磁盘 content 键  
3. mtime+size 预检 snapshot（可选同 phase，可后置）  
4. 测试：命中跳过 dts **解析**（计数器/日志断言）；改 dts 内容后 miss；
   round-trip 导出名集合一致；未知 `k` → miss；file: 同版本不同内容 miss  
5. `.gitignore` 建议 + 文档  

**验收**：同一包第二次分析不再跑 dts 解析/物化（仍可能读文件算 hash，
除非预检命中）；patch 过的 file: 依赖 miss；升级 typescript 后全 miss。

### Phase B — L1 effectiveInterface + derive

1. `effectiveInterface` **整文件 fns 表** + implicit 负缓存（+ 可选 diags）  
2. `deriveFromRoot` 投影缓存  
3. autoBind / sidecarFp / 相对化 depsFp / **sha256 内容段** 进键  
4. iface 键**不含** emit allowlist  
5. 测试：侧车变更后不命中；truncated 不读写；多 fn 表完整；allowlist
   变更不导致无谓 miss  

**验收**：`nudo interface`（打印路径）冷启动对未变文件跳过侧车 exec/
契约合并；**不**宣称 B-path 分析加速。

### Phase C — L1 check（默认关）

1. `CheckJson` 序列化/反序列化 round-trip 测试  
2. 与内存 memo 串联（内存 hit 优先）；`cache.check` / `NUDO_CACHE_CHECK`  
3. `--callsites` 明确跳过  
4. `formatCheckJson` / dummy 报告 API，禁止回流 leq  
5. CI 文档：只 cache depsDir；check 缓存信任模型  

**验收**：`cache.check=true` 时连续两次 `nudo check` 第二次 wall-clock
明显下降；默认关闭时行为与今日一致；`NUDO_CACHE=0` 行为与今日一致。

### 不做 / 后置

- Abs 本体序列化、B-path / AnalysisResult 磁盘化  
- TypeValue / emitEnvModule 回放（IR 已删除）  
- 远程缓存  
- 跨 `analysisAbi` 的格式迁移  
- 精确依赖反向逐出  
- L2 上的「带项目 mock/env 注入的」模块导出表  
- `--callsites` 整报告缓存  

---

## 11. 风险

| 风险 | 缓解 |
|---|---|
| 键漏维度 → 错诊断 | 红线 #1；新输入默认进键；zero-FP 套件在无缓存/有缓存下各跑一遍 |
| HarvestJson 丢语义 → 静默错误 | §5.3 红线；读回结构校验；未知 `k` miss；round-trip 导出名/display |
| **check 缓存投毒 → 假阴性门禁** | 默认 `check: false`；§9.7；CI 不恢复不可信 L1；sha256 键原料 |
| 磁盘键含绝对路径 → CI 永久 miss | §3.1 相对路径化 |
| 磁盘键用 FNV → 碰撞错命中 | §2 裁决 6 / 红线 #9 |
| typescript 升级改变 dts 解析 | `analysisAbi` 拼入 ts 版本 |
| 磁盘膨胀 | L1/L2 分配额 + GC + 命中 touch |
| CI 缓存污染 | 键含 schema + analysisAbi；lockfile 变则 deps 层自然 miss |
| 与内存 memo 双源 | 磁盘只在内存 miss 时用；watch/LSP 只写不读 |
| monorepo projectDir 不一致 → 双份缓存 | 文档约定；安全方向（miss 重算） |
| L2 命中丢 interface 侧信道诊断 | Phase B 将文件级 diags 纳入可选缓存值；或文档声明不保证 |
| TypeValue 删除未完成就做 L2 | **前置门**：未完成不开工 Phase A |

---

## 12. 与现有设计的衔接

| 文档 | 关系 |
|---|---|
| `design-refine-derivation.md` §7.4 | 本文细化 `.nudo/cache`；契约文件仍进 git，缓存不进；本文**收窄**了「Abs/约束序列化」为投影 + 明确不序列化 Abs 本体 |
| `design-kernel-merge.md` | 不改 Abs 本体；缓存只碰投影层 |
| TypeValue 移除（产品决策） | 本文**假设已完成**；不再提供 TypeValue 编解码路径；L2 改为 HarvestJson |
| §4.5 隐式依赖边 | 内存逐出图；磁盘层靠指纹，职责不重叠 |

---

## 附录 A. 键组成速查

```
globalPrefix = "nudo-" + kind + "-v" + schema + "@" + analysisAbi
# analysisAbi 含 typescript 版本，例如 "1+ts5.7.2"

# L2
harvest : prefix + pkg + "\0" + ver + "\0" + harvestKnobs + "\0" + dtsClosureHash
# dtsClosureHash = 排序后的 (相对包内路径, sha256(content)) 列表再 sha254 一次
# harvestKnobs：默认常量可写死为 ""；一旦可配置必须进键

# L1（fp 均已相对路径化；内容段 sha256；见 §3.1）
iface   : prefix + relFile + srcSha256 + sidecarFp + diskDepsFp + autoBind
derive  : prefix + relFile + srcSha256 + sidecarFp + diskDepsFp + autoBind + allowlistHash
check   : prefix + relFile + stableSrcSha256 + diskDepsFp + sidecarFp + autoBind
          # phi 固定 pTrue；autoBind 编码 "1"/"0"；trunc → 整键作废
          # iface 刻意不含 allowlistHash（白名单不影响 effectiveInterface）
```

任一段 `truncated` / `trunc:` 前缀 → 整键作废（不读不写）。

`diskDepsFp` = `loadModuleDepsFingerprint(...).fp` 做相对路径化、且把
`hashSource` 段替换为 `sha256(content)` 后的拼接，**不是**内存 memo 里的
FNV/绝对路径原文。

实现上不要「先生成内存 fp 字符串再字符串替换」，应在组装磁盘键时用同一
依赖遍历重新产出 sha256 条目（或让 fingerprint 函数接受 hash 函数注入）。

## 附录 B. 参考

- TypeScript `tsbuildinfo`：增量诊断/emit 的指纹模型  
- webpack 5 `filesystem` cache：snapshot + content hash  
- cargo fingerprint：工具链版本 + 依赖递归指纹  
- jest transform cache：content + config，不用 mtime-only  
- Bazel action cache：输入 digest 完备性  
- Vite `optimizeDeps`：依赖层与源码层分离  
- 现有实现：`checkMemoKey` / `sidecarClosureFingerprint` /
  `loadModuleDepsFingerprint` / `serializeCheckJson` /
  `harvest-to-abs`（mock 签名语义） / `interface-emitter` 原子写  

## 附录 C. 实施前检查清单（TypeValue 删除完成后）

- [ ] harvest 不再 import / 产出 TypeValue；无 `emitEnvModule` 回放依赖  
- [ ] 存在稳定 `HarvestJson`（或等价）schema + materialize 单测  
- [ ] `bareSpecToAbsModules` / Abs 模块图走 materialize，不经 TypeValue 桥  
- [ ] `typescript` 版本可读并进入 `analysisAbi`  
- [ ] Phase A′ cache-store 已合入（或与 A 同 PR）  
- [ ] 文档：`.nudo/cache` 与 depsDir 的 `.gitignore` / CI 恢复策略  
