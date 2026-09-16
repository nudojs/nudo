# 持久化分析缓存（`.nudo/cache`）

> **状态**：设计稿（未实施）。与 [`design-refine-derivation.md`](./design-refine-derivation.md)
> §7.4 的「可选 `.nudo/cache`」衔接：契约文件（`*.nudo.js`）仍是用户表面，
> 缓存是引擎私有、可丢、可重建。
>
> **一句话**：把「不变依赖 + 已分析源码」的投影结果落到磁盘，冷启动
> 复用；键必须 content-addressable，失效宁可过杀、不可陈旧命中。

---

## 0. 问题

当前所有分析缓存都是进程内 `Map`：

| 缓存 | 模块 | cap |
|---|---|---|
| generalize L0 | `core/generalize.ts` | 1024 |
| check 整文件 memo | `core/check.ts` | 256 |
| parse AST LRU | `core/parse-source.ts` | 16 |
| 侧车 exec | `core/refine.ts` | 64 |
| AnalysisResult | `service/analysis-file-cache.ts` | 64 |
| per-fn FunctionAnalysis | `service/fn-analysis-cache.ts` | — |
| Abs 模块图 / B-path | `service/abs-modules-graph.ts` / `bpath-run.ts` | — |

LSP 长驻会话 after-edit 靠这些 memo；**CLI 每次冷启动全部重算**。
JS 项目里 `node_modules` 大量不变——harvest / Abs 模块导出表 / 侧车闭包
每次重跑是纯浪费。

---

## 1. 目标与非目标

### 目标

1. **冷启动复用**：第二次 `nudo check` / `nudo interface` 对未变更文件
   走磁盘命中，不重跑 Abs 求值。
2. **依赖包层收益最大**：`node_modules` / `@types` 的 harvest 结果与
   Abs 导出表可跨项目、跨会话长期复用。
3. **绝不陈旧命中**：键漏维度 = 错诊断；宁可 miss 重算。
4. **可丢可重建**：损坏/版本不匹配/用户 `rm -rf .nudo/cache` 均 fail-open。
5. **与现有 memo 同源**：键组成复用 `hashSource` / `loadModuleDepsFingerprint`
   / `sidecarClosureFingerprint`，不另起一套指纹语义。

### 非目标

- 不缓存 Abs 本体的完整对象图（序列化贵、版本脆）；只缓存**投影结果**
  （NudoConstraint JSON、CheckReport 可序列化子集、harvest 元数据）。
- 不做远程/共享缓存（Bazel remote cache 那类）；本地磁盘即可。
- 不替代进程内 L0 / check memo——磁盘是冷路径，内存是热路径。
- 不缓存截断 / opaque / mock 改道的结果（证据不稳）。

---

## 2. 成熟方案对照

| 工具 | 键 | 失效 | 对 Nudo 的启发 |
|---|---|---|---|
| **TypeScript incremental**（`.tsbuildinfo`） | file version + compilerOptions + 依赖文件 version | options 变 / 文件变 | 存「指纹 → 结果」而非 AST；options 进键 |
| **webpack 5 filesystem cache** | snapshot：file hash + meta；loader chain 进键 | snapshot 不等即 miss | content hash 优先于 mtime；依赖快照可组合 |
| **cargo** | package + features + rustc 版本 + deps fingerprint 递归 | 任一输入变 | 工具版本必须进全局前缀 |
| **jest transform cache** | file content + transformer config + jest version | content/config 变 | 不要用 mtime 当唯一键 |
| **ESLint cache** | mtime + config hash（偏粗） | mtime 误判已知坑 | **不采用 mtime-only** |
| **Bazel action cache** | action digest（全部输入） | digest 变 | 输入完备性 > 局部优化 |
| **Vite optimizeDeps** | lockfile + config hash | lockfile 变 | 依赖层可与项目层分离 |

**裁决**：

1. **content-addressable**（hash），不用 mtime 当主键（NFS/CI 上 mtime 不可靠；
   ESLint 踩过）。mtime 可作**廉价预检**（未变则免读文件算 hash），但
   命中后仍要比对 content hash。
2. **工具版本 + 缓存 schema 版本**进全局前缀（cargo / jest）。
3. **分层**：不变依赖 vs 项目源码（Vite optimizeDeps / Bazel 的 action 层次）。
4. **fail-open**：读失败 / 版本不符 / 截断 → 当 miss，绝不 throw。

---

## 3. 三层架构

```
┌─────────────────────────────────────────────────────────┐
│  L0 内存（现有）  generalize / check memo / fn analysis  │  ← 热路径
├─────────────────────────────────────────────────────────┤
│  L1 项目磁盘  .nudo/cache/  本仓库源码投影结果            │  ← 冷启动
├─────────────────────────────────────────────────────────┤
│  L2 依赖磁盘  ~/.cache/nudo/deps/  node_modules 投影      │  ← 跨项目
└─────────────────────────────────────────────────────────┘
```

### L2 依赖层（收益最大）

**缓存什么**

| 条目 | 源 | 说明 |
|---|---|---|
| harvest 结果 | `harvestDts` / `harvestPackageCached` | 包名+版本+dts hash → HarvestedEnv JSON |
| Abs 模块导出 | `evalAbsModuleGraph` 对 bare 包 | **不存 Abs 本体**；存可再执行的 dts 路径 + harvest 快照，或存投影后的 TypeValue/schema |
| 侧车模板 | 项目外共享 `*.nudo.js`（少见） | 一般不进 L2 |

**键**

```
depKey = sha256(
  "nudo-dep-cache-v1" +          # schema 版本
  nudoVersion +                  # 工具版本
  pkgName + pkgVersion +         # package.json
  dtsClosureHash                 # 收集到的 .d.ts 内容 hash 排序拼接
)
```

`dtsClosureHash` 必须覆盖 `collectDtsFiles` 实际读到的文件内容——
包内多文件时只 hash 入口不够。

**位置**：`$XDG_CACHE_HOME/nudo/deps/` 或 `~/.cache/nudo/deps/`  
（跨项目共享；Windows: `%LOCALAPPDATA%/nudo/deps`）

**为何 L2 可以存 harvest**：harvest 输入是 `.d.ts` 文本，输出是结构化
环境定义；同一包同一版本在不同项目里结果应相同（不依赖项目上下文）。
Abs 导出表若含项目侧 mock/env 注入则**不能**进 L2——只缓存「纯包」部分。

### L1 项目层

**缓存什么**（只存可 JSON 化的投影，不存 Abs/AST/PolyFn）

| 条目 | 源 | 值形态 |
|---|---|---|
| effectiveInterface | `effectiveInterface()` | `{ params, returns, source, conflict? }`（NudoConstraint JSON） |
| deriveFromRoot 投影 | `deriveFromRoot()` | `DerivedExport[]`（约束 + dsl 字符串，不含 Abs） |
| check 报告 | `checkSource()` | issues + signatures 的**可序列化子集**（无 env/无函数对象） |
| interfaceSurface | 打印用 | entries 数组（低优先级） |

**不进 L1**

- Abs / term / pred 对象图
- AST（`parseSource`）
- PolyFn / generalize 符号结果（含闭包）
- B-path transpile 产物
- 截断 / opaque / mock 相关结果
- 含 `loadModule` 身份依赖的 memo（CLI 与 LSP 的 loadModule 不同——
  跨进程不能复用带 loadModuleId 的键）

**键**（复用现有指纹，不新造语义）

```
ifaceKey = sha256(
  "nudo-iface-v1" + nudoVersion +
  filePath +
  hashSource(source) +
  sidecarClosureFingerprint(...) +
  loadModuleDepsFingerprint(...).fp +
  String(autoBind) +
  emitAllowlistHash          # 若结果受白名单过滤
)

checkKey = sha256(
  "nudo-check-v1" + nudoVersion +
  filePath +
  hashSource(stableAnalyzeKeySource(source)) +
  depsFp.fp +
  sidecarFp +
  String(autoBind) +
  phiKey                     # 默认 pTrue 才落盘
)
```

`truncated === true` 的指纹 → **不写不读**（与现有 fail-open 一致）。

**位置**：项目根 `.nudo/cache/`（应 gitignore；文档建议写入 `.gitignore`）

---

## 4. 磁盘布局

```
.nudo/cache/
  meta.json                 # { schema: 1, nudo: "1.0.0", createdAt }
  iface/
    <keyHash[0:2]>/<keyHash>.json
  check/
    <keyHash[0:2]>/<keyHash>.json

~/.cache/nudo/deps/
  meta.json
  harvest/
    <keyHash[0:2]>/<keyHash>.json
```

- **两级目录**（`ab/abcdef….json`）避免单目录文件爆炸（参照 git object）。
- **原子写**：tmp + rename（与 interface-emitter 同策略）。
- **keyHash** = 上述 sha256 的 hex（完整 64 字符，不用 FNV——磁盘碰撞
  代价是错结果，必须用加密 hash；内存 LRU 继续用 `hashSource` FNV）。

---

## 5. 序列化

### NudoConstraint

已有纯数据形态（`toPlainConstraint` 剥 builder）。直接 JSON：

```json
{
  "__nudoConstraint": true,
  "prim": "number",
  "preds": [{ "op": "gt", "a": { "op": "var", "id": "__nudo_self__" }, "b": { "op": "lit", "value": 0 } }]
}
```

读回后需过 `isNudoConstraint` + 结构校验；非法 → 丢弃当 miss。

### CheckReport 子集

```json
{
  "ok": true,
  "issues": [ { "severity", "code", "message", "fn?", "line?", "suggestion?", "actual?", "expected?" } ],
  "signatures": [ { "name", "display", "detail", "conf" } ]
}
```

**丢弃**：含 Abs 对象引用的字段、`env`、函数值。读回后与内存报告
同构性由测试保证；字段不全 → 当 miss（宁可重算）。

### Harvest

`HarvestedEnv` 若含函数实现 / TypeValue 闭包，只序列化**声明面**
（可再 bind 的形状）；实现仍走运行时注入。

### 版本迁移

`meta.json.schema` 不匹配 → 整目录清空或忽略（cargo 大版本行为）。
不写迁移器——缓存可重建。

---

## 6. 失效

| 事件 | 行为 |
|---|---|
| 源码 / 侧车 / dep 内容变 | 键变 → 自然 miss（content hash） |
| `autoBind` / emit 白名单变 | 键含配置 → miss |
| nudo 版本升 | 全局前缀变 → 全 miss（可保留旧目录供回滚，或直接删） |
| schema 升 | `meta.json` 不识别 → 清空 |
| 依赖文件删除 | 读时发现 hash 与键不符 → miss |
| 用户删 `.nudo/cache` | 全 miss，行为不变 |
| 截断指纹 | 不读不写 |

**不做**主动逐出图（不像内存 memo 的 `nudoDepParents`）：磁盘层靠
键完备性，不需要反向索引。这是与内存层的关键差异——内存要 O(1)
定向逐出，磁盘只要「键变了就 miss」。

**GC**：启动时可选扫 mtime > 30 天且未命中的条目删除；或 cap
条目数 LRU。Phase 1 可只做「目录超过 N MB 时按 mtime 删最旧」。

---

## 7. 配置

沿用 `package.json#nudo`：

```json
{
  "nudo": {
    "cache": {
      "enabled": true,
      "dir": ".nudo/cache",
      "depsDir": "~/.cache/nudo/deps",
      "maxMb": 256
    }
  }
}
```

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true`（实施后） | false = 完全走内存，不读不写盘 |
| `dir` | `.nudo/cache` | 项目层；相对 projectDir |
| `depsDir` | 平台 cache 目录 | 依赖层；可指到 monorepo 共享位置 |
| `maxMb` | `256` | 超出按 mtime GC |

环境变量覆盖：`NUDO_CACHE=0` 禁用（CI 可关）；`NUDO_CACHE_DIR` 覆盖路径。

---

## 8. 接入点

```
checkSource
  ├─ 内存 memo（现有）
  └─ miss → disk lookup（checkKey）→ hit 反序列化报告
       └─ miss → 算完 → 写盘（truncated 则不写）

effectiveInterface
  └─ 供 generalize / interfaceSurface / derive 共用；
     磁盘层缓存「纯契约读取」结果（侧车 exec 已有内存 LRU，
     磁盘层缓存的是 effectiveInterface 整结果）

deriveFromRoot / emitDerivedFromRoot
  └─ 缓存 DerivedExport 投影（不含 Abs）

evalAbsModuleGraph（bare 包）
  └─ L2：harvest 命中则跳过 dts 解析

harvestPackageCached
  └─ L2 主战场
```

**CLI watch / LSP**：内存层已有；磁盘层在 watch 会话内**只写不读**
（避免与内存一致性纠缠）——进程启动读一次，之后以内存为准。

**vite-plugin / CI**：冷启动读盘；CI 可用 actions/cache 缓存
`.nudo/cache` 与 depsDir（键用 lockfile hash）。

---

## 9. 安全与正确性红线

1. **键完备性 > 命中率**。新增影响结果的输入必须进键；不确定就进键。
2. **不信任磁盘**。读入校验 schema + 结构；失败当 miss，不 throw。
3. **不缓存证据不稳结果**：`truncated` / `conf=opaque` / mock 注入 /
   截断求值 → 不写。
4. **手写契约优先语义不因缓存改变**：缓存的是读取结果快照，不是新真理源。
5. **路径规范化**：键里的 filePath 用 `normPath`，避免 Windows/Unix 分叉
   导致重复条目（不是错误，只是浪费）。
6. **并发**：多进程同时写同一 key → tmp+rename 幂等；读到半截 JSON
   → catch 当 miss。

---

## 10. 分阶段实施

### Phase A — 基建 + L2 harvest（收益最大）

1. `service/cache-store.ts`：`get/set` + 原子写 + meta + GC 骨架  
2. 键工具：`cacheKey(parts: string[]): string`（sha256）  
3. `harvestPackageCached` 接 L2  
4. 测试：命中跳过 dts 解析；版本变 miss；损坏 JSON miss  
5. `.gitignore` 建议 + 文档

**验收**：同一包第二次分析不再读 `.d.ts`（可用计数器/日志断言）；
改 dts 内容后 miss。

### Phase B — L1 effectiveInterface + derive

1. `effectiveInterface` 磁盘旁路  
2. `deriveFromRoot` 投影缓存  
3. autoBind / sidecarFp 进键  
4. 测试：侧车变更后不命中；truncated 不读写

**验收**：`nudo interface` 冷启动对未变文件显著加速（fixture 计时）。

### Phase C — L1 check 报告

1. CheckReport 子集序列化  
2. 与内存 memo 串联（内存 hit 优先）  
3. CI 文档：`actions/cache` 用法

**验收**：连续两次 `nudo check` 第二次 wall-clock 明显下降；
`NUDO_CACHE=0` 行为与今日一致。

### 不做 / 后置

- Abs 本体序列化  
- 远程缓存  
- 跨工具版本的格式迁移  
- 精确依赖反向逐出（磁盘层不需要）

---

## 11. 风险

| 风险 | 缓解 |
|---|---|
| 键漏维度 → 错诊断 | 红线 #1；新输入默认进键；zero-FP 套件在无缓存/有缓存下各跑一遍 |
| 序列化丢字段 → 静默错误结果 | 读回结构校验；不全则 miss；测试 round-trip |
| 磁盘膨胀 | maxMb + GC；depsDir 可共享 |
| CI 缓存污染 | 键含 nudo 版本 + schema；lockfile 变则 deps 层自然 miss |
| 与内存 memo 双源 | 磁盘只在内存 miss 时用；watch/LSP 只写不读 |

---

## 12. 与现有设计的衔接

| 文档 | 关系 |
|---|---|
| `design-refine-derivation.md` §7.4 | 本文细化 `.nudo/cache`；契约文件仍进 git，缓存不进 |
| `design-kernel-merge.md` | 不改 Abs 本体；缓存只碰投影层 |
| §4.5 隐式依赖边 | 内存逐出图；磁盘层靠指纹，职责不重叠 |

---

## 附录 A. 键组成速查

```
全局前缀 = "nudo-" + kind + "-v" + schema + "@" + nudoVersion

iface  : prefix + file + srcHash + sidecarFp + depsFp + autoBind + allowlist
check  : prefix + file + stableSrcHash + depsFp + sidecarFp + autoBind + phi
harvest: prefix + pkg + ver + dtsClosureHash
```

任一段 `truncated` → 整键作废（不读不写）。

## 附录 B. 参考

- TypeScript `tsbuildinfo`：增量诊断/emit 的指纹模型  
- webpack 5 `filesystem` cache：snapshot + content hash  
- cargo fingerprint：工具链版本 + 依赖递归指纹  
- jest transform cache：content + config，不用 mtime-only  
- Bazel action cache：输入 digest 完备性  
- Vite `optimizeDeps`：依赖层与源码层分离  
