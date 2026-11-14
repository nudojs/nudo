# Abs 改进计划（ABS-01…18 · 现行 backlog）

> **状态**：现行（2026-11-14 按 `docs/README.md`「交付后删除正文」完成第一次生命周期清算）。
> 本文件只保留**现行项、决策锚与触发条件**；已交付项的立项正文已删除，证据在
> 测试、changeset 与 git（`git log --grep 'ABS-'`）。
> **编号保留**：`§5` 与各 `ABS-*` 编号不复用 —— `benchmark/s1/README.md` 与
> `core/src/algebra/__tests__/abs14-equivalence-baseline.test.ts` 直接引用 `§5`。
> **真源**：架构 → [`../kernel-merge.md`](../kernel-merge.md)；限制 → [`../limitations.md`](../limitations.md)；
> 求值 → [`../evaluation.md`](../evaluation.md)；缓存 → [`../persistent-cache.md`](../persistent-cache.md)。
> **纪律**：单轨 Abs；不新增第二 IR；不改变 C0 / L2 / `unknown` 语义；任何影响 `leqAbs` / check 的改动
> 必须过金标与真实包零 FP。

---

## 0. 现状

- **已交付**：`ABS-01`…`ABS-12`、`ABS-14`、`ABS-16` 第①步、`ABS-18`。正文删除，状态见 §1。
- **仍开放**：`ABS-13`（finalizer 含 `yield`/`return` 的 abrupt completion）、`ABS-15`
  （facet 提升规则 / 键版本化）、`ABS-16`③（worker 并行，parked）、`ABS-17`（写时复制，暂缓）。
- **性能线判定**：通用冷路径到此可停 —— 用户口径 `dist` time-to-green 374ms（2s 目标 5.3× 余量，
  `docs/reports/dx-metrics.md`）；watch 典型编辑 total 667–929ms 达标；语义编辑 hub ≈2.2s
  （CPU-bound），属单文件成本（`ABS-17`）或 worker 并行（`ABS-16`③），不在通用优化面。
- **不做**：从 body AST 发明契约义务；把 `unknown` 当 `any`；追完整 TS 泛型/HM；
  无隔离宣称 sandbox；追求内建 100% 覆盖；无指标重写 Shape。

## 1. 总表

| # | ID | 项 | 优先级 | 规模 | 依赖 | 状态 |
|---:|---|---|---|---|---|---|
| 1 | `ABS-01` | 约束/引理文法补齐 | P0 | M–L | — | `[x]` |
| 2 | `ABS-02` | `unknown` / `any` 来源可解释 | P0 | M | — | `[x]` |
| 3 | `ABS-03` | dts / schema 投影补全 | P0 | S–M | — | `[x]`（声明级 overload 喂入仍待 harvester 侧立项） |
| 4 | `ABS-04` | `test` 观测面改善 | P0 | S | — | `[x]`（`--both-paths` 保持 opt-in） |
| 5 | `ABS-05` | `conf` 与缓存键审计 | P0 | S | — | `[x]` |
| 6 | `ABS-06` | 内建一致性门禁 | P0 | L（长跑） | — | `[x]`（矩阵 70 探针；扩矩阵是持续动作） |
| 7 | `ABS-07` | Pred 蕴含判定升级 | P1 | L | `ABS-01` | `[x]`（sound 子集：序闭包 / 平方下界 / DNF / oracle 缓存） |
| 8 | `ABS-08` | 自动循环不变量推断 | P1 | L | `ABS-01`、`ABS-07` | `[x]`（阶段一：info-only 候选，不参与证明） |
| 9 | `ABS-09` | 递归类型 coinductive `leq` | P1 | M | — | `[x]` |
| 10 | `ABS-10` | 摘要式模块化分析 | P1 | L | `ABS-05` | `[x]`（保守起点：纯上下文跨实例后置摘要） |
| 11 | `ABS-11` | contract 合取与 union 精度 | P1 | M | `ABS-01` | `[x]`（判别式穷尽性 warning 延后：零误报优先） |
| 12 | `ABS-12` | 能力面裁剪（capability surface） | P2 | M–L | — | `[x]` 2026-11-13：能力清单（188 全局 + 67 builtin，default-deny + 漂移门禁）、运行期身份拦截、`nudo:capability-denied`、`--capabilities strict\|trusted` / `NUDO_CAPABILITIES`、canary e2e；**不宣称 sandbox**；denied 集合维护是持续动作 |
| 13 | `ABS-13` | 生成器 abrupt completion / 真挂起 | P2 | M（C）+ L（A） | — | `[~]`：C 护栏 + A-narrow 已交付；**残余 = finalizer 含 `yield`/`return` 的形态**（需真挂起/续体） |
| 14 | `ABS-14` | 有界参数化摘要 | P2 | L | `ABS-10`、`ABS-11` | `[x]`（决策锚见 §5；`TypeParam.bounds` 目前 write-only，不宣称被快路径消费） |
| 15 | `ABS-15` | Shape / facets 治理 | P2 | M–L | — | `[~]`：登记表 + 漂移门禁已落地；**剩余候选 2（提升规则）/ 3（键版本化）** |
| 16 | `ABS-16` | 规模验证与签名缓存 | P2 | L | `ABS-05`、`ABS-10` | `[x]`：①真实仓基准交付；②分析结果落盘**结案不做**；③worker 并行**暂不立项**（触发条件见 §5） |
| 17 | `ABS-17` | 大对象图 `$copy` 病态输入（性能） | P3 | M | `ABS-16` 度量 | `[ ]` **结案暂缓**（触发条件见 §5；已交付夹具与两条快路径，剩余 31.6% 需写时复制） |
| 18 | `ABS-18` | watch 增量重算整条依赖链 | P2 | M | — | `[x]` 2026-11-13：吞改动竞态 + inert 编辑（hub total 929ms / leaf 555ms）；剩余可选 = `checkSource` gating 语义键 |

规模为工程体量标签（S / M / L / XL），不是时间承诺。

## 2. 已交付项（正文已删）

`§3`–`§4` 原为 `ABS-01`…`ABS-11` 的立项正文；`ABS-14` / `ABS-16`① / `ABS-18` 的立项正文
也已压缩为 §5 的决策锚与残余。全部按 `docs/README.md` 生命周期删除；`§5` 编号保留（外部引用）。
需要历史口径时：
`git log --grep 'ABS-<n>'`、`.changeset/`、对应测试文件与
[`../architecture-debt.md`](../architecture-debt.md) 的槽位接线明细。

## 5. P2：战略项与残余（编号保留）

### ABS-12 能力面裁剪（`[x]` 2026-11-13）

- 已交付：能力清单（188 全局 + 67 builtin）+ default-deny + 漂移门禁；运行期身份拦截；
  `nudo:capability-denied`；`--capabilities strict|trusted` / `NUDO_CAPABILITIES`；canary e2e（零宿主副作用）。
- **不宣称 sandbox**（准入控制不是隔离）；denied 集合维护是持续动作。

### ABS-13 生成器 abrupt completion / 真挂起（`[~]`）

**已交付**：方案 C（abrupt completion 时挂起点快照与终态格逐绑定 `join`，sound 过近似）
+ 方案 A-narrow（可安全抽取的 finalizer thunk 在 `.return()` / 无 catch 的 `.throw()` 时
按内→外重放）。实测：`.return()` / `.throw()` 穿 side-effect finally 精确 `true`、嵌套
`[true, true]`；`for-of` break 穿 `finally` / `yield*` 委托精确 `true`；async 走 rejected promise；
finalizer 条件抛错精确传播。夹具 `abs13-abrupt-completion.test.ts`（15 例）。

**残余（唯一未覆盖形态）**：finalizer 含 **`yield` / `return` 语句** —— 需要真挂起/续体
（XL 边界）；当前保持 C 的 `false | true`。不做全量 CPS：已发现的错误类集中在 abrupt
completion 的 `finally` 语义，不等于需要 continuation 化整个求值器。

| 场景 | native | 现状 |
|---|---|---|
| `.return()` + finally `return 42` | `{value:42,done:true}` | 未覆盖（需真挂起） |
| `.return()` + finally `yield 2` | 先 `{value:2,done:false}`，再 `.next()` → `{value:0,done:true}` | 未覆盖（需真挂起） |
| 非绑定类副作用（宿主调用 / may-throw）时序 | 按挂起点发生 | 体仍一次跑完（既有边界，见 `limitations.md`） |

### ABS-14 有界参数化摘要（`[x]`）

**决策锚（2026-11-10，测试直接引用本节）**：

1. **只准简单条件 + 单向依赖**：`bounds` 只用现有 `Pred` 词汇（`typeof` / 数值界 / 长度），
   秩 1；α–α 只允许按声明序单向依赖；禁止条件类型 / 映射类型 / `infer` / 高阶多态。
2. **先走三条保守通道**：`bodyUnavailable` / `budgetTruncated` / `crossModule`；主路径仍以 body 为准。
3. **等价性门禁是开工前置**：快路径 ≡ body 路径的返回值 Abs 逐字节一致
   （`abs14-equivalence-baseline.ts` / `abs14-fastpath.test.ts`，用见证 Φ 绕开 memo 层）；
   降级通道另见 `abs14-degraded-channels.test.ts`。
4. **摘要缓存只留一套**：`key/fn-summary.ts` 是唯一跨实例摘要存储。

**边界**：`TypeParam.bounds` 是 `PolyFn` 元数据且目前 **write-only**（全仓无读者）；
`opts.refine` 下 `summaryScope` 返回 `undefined` ⇒ 带契约的函数不写函数级摘要；
强行接通会把契约语义塞进跨实例缓存，打开陈旧命中口子 —— 不打通。

### ABS-15 Shape / facets 治理（`[~]`）

**已落地**：`key/facet-specs.ts::FACET_SPECS` 是 `AbsFacets` 槽位唯一登记表
（`satisfies Record<keyof AbsFacets, FacetSpec>`，新增槽位不登记即编译红）；
`kind` 同时决定 `facetKey` 编码与 `cloneAbsFacets` 搬运策略；改前后
`facetKey` / `absKey` / `cloneAbsFacets` 逐字节 diff 为空；门禁 `abs15-facet-registry.test.ts`（14 例）。

**剩余候选**：

1. ~~capability registry~~ ✅（登记表即最小面）。
2. **提升规则**：值语义进 Shape、派生/观察能力进 facets；成熟后再评估逐槽提升。
3. **facet 键版本化**：避免未来语义变化导致旧缓存串台。

**验收**：每个 facet 有搬运/键/join 覆盖；公共 API 快照只做 additive 变更。
**风险**：重构成本 —— 只增量治理新增 facet，不做无指标的全量 Shape 重写。

### ABS-16 规模验证与签名缓存（① `[x]`，② 结案，③ parked）

**① 真实仓基准（已交付）**：`benchmark/s1/bench-monorepo.mts --corpus` +
`benchmark:s1:real` / `:real:quick`；报告 `docs/reports/s1-perf-baseline-real.{md,json}`，
干净口径 `s1-perf-baseline-real-clean.{md,json}`（`run-clean.mts` 清 `NODE_OPTIONS`、
`--clean-corpus` 跳生成物）；含主机信息与两层摘要命中遥测（只报 `fnSummaryStats` /
`fnSummaryFnLevelStats`，不冒充全引擎命中率）。

**关键结论（决定 ②③）**：

- 干净语料（286 文件 / 0.26 MB / 630 边，`--quick`）：cold **12977.95ms**、warm 4316.36ms、
  check all warm **376.95ms**、live 1.63 / 4.00ms。
- 8.3× cold 退化**不是单点回归**：`git bisect` 定位到 `d74c0ed3`（9/29 缺导出诊断）
  与 `7fea13a1`（10/21 运行时语义批量收口）两次正确性收口；机制是 **Term 递归字符串序列化**
  （`abs-key.ts::termKey`，一轮 6709 万次调用 / 75% 重复）随 Abs 复杂度上升。已交付
  `termKey` 字符串累加（输出逐字节不变，cold −25%）；WeakMap 缓存路线实测更慢，**已否定**。
- `check all warm` 44s 的根因：整文件 `CheckReport` memo 容量 256 < 工作集 286 ⇒ 顺序重扫
  命中率为 0。修复 `MAX_CHECK_MEMO` 256 → 1024，warm 回到 376.95ms；
  `check-may-throw.ts` 的按轮 memo 保持 256 不放大。

**② 分析结果落盘：结案不做**（2026-11-13）。负证据：函数级摘要冷/暖命中 0、
真实 OSS `check` 冷路径 1.89s（96 文件）；重复调用成本在键计算 / GC，不在磁盘或跨进程缺失。
**③ worker 并行：暂不立项**（2026-11-13 spike）。语义编辑脏集 17 文件串行 analyze 1908ms，
逐文件 69–378ms，CPU/wall 1.10–1.28；冷态单价是 warm 的 2.5–4.7×（依赖共享热缓存）；
LPT 上限 warm W=4 ≈487ms / W=8 ≈378ms，cold×3 时 W=4 ≈1461ms。
**触发条件**：真实用户仓库语义编辑轮 >3s，或出现第二个并行分析消费者。

### ABS-17 大对象图 `$copy`（`[ ]` 结案暂缓）

**触发条件**：真实用户输入单文件 `analyze` >5s，或再次出现 `$copy` 占比 >30% 的报告。
当前只剩合成病态负载（产物路径可解析时 47–59s，依赖不可解析时 0.2s —— 机制是
依赖解析上下文构造出的巨大抽象对象图，不是打包器形态）。

**已交付**：`benchmark/s1/generate-bundle-fixtures.mts`（5 形态梯度 + gitignored `.bundles`）、
单文件最小复现（N 个对象导出）、`setSlot` 去 `defineProperty`、`copyWithMemo` 叶子快路径与
免分配遍历 ⇒ 夹具 **8427 → 3297ms（−61%）**，剩余 **31.6% 是真实副本分配**。
`absKey` 身份缓存**评估后否决**：Abs 按引用可变（`delete o.shape.slots[...]` / 就地 `setSlot` /
`o.conf =`）⇒ 需要每个变更点失效，漏一处即 soundness bug。下一步是写时复制（架构级，另立项）。

### ABS-18 watch 增量重算（`[x]` 2026-11-13）

**已交付**：① 吞改动竞态（`recordVersions` 前移 + 确定性 e2e `abs18-watch-write-race.test.ts`）；
② inert 编辑（`load-deps-fp` 指纹对齐 `stableAnalyzeKeySource` + 只逐出 `changedFiles`）；
③ 注入对象复用（`check-injection-cache.ts`，LRU 256，仅 watch 传入）+ 轮内依赖指纹 memo
（`beginDepFingerprintEpoch`）+ gating 同值复用（`loaderIdentity`）。
实测（dist / 干净 env / semver 48 文件，收尾批次）：hub analyze 3313 → **456–473ms**、
total **667–684ms**；leaf analyze 210ms / total **421ms**（早期批次为 hub total 929ms / leaf 555ms）。

**唯一残余（可选）**：`checkSource` gating 的语义键；候选 2「按签名跳过重算」不 sound
（dependent 的 `call@` 内联 callee 求值行为）、候选 3 图增量化收益 <0.5% —— 均已否决。

## 6. 共用验收门禁

每项完成时必须满足（按影响面裁剪）：

- `pnpm run build`，再跑定向 `vitest`。
- `pnpm run lint` + `pnpm run lint:tests`。
- 全量 vitest 仅在必要时跑，且 `--maxWorkers=4`（仓库约束）。
- 金标：recall = precision = 1.0；真实包零 FP；L2 拆分口径不放松。
- 行为/输出变化 → `pnpm run verify:examples`。
- 公共导出变化 → 公共 API 快照 + `packages/*/PUBLIC_API.md`。
- 用户可见变化 → changeset。
- 文档同步：`kernel-merge.md` / `limitations.md` / `cli-semantics.md` / 对应领域文档。
- 手工核查（先 `pnpm run build`）：`node packages/nudojs/dist/index.js check <file>` 与
  `node packages/nudojs/dist/index.js export --format dts <file>`；本文件引用的实测输出均由这两条产生。

## 7. 度量

| 指标 | 用途 | 来源 |
|---|---|---|
| any / unknown 比例与原因分布 | `ABS-02` 的效果 | `nudo health` / check JSON |
| wrong-exact 数量 | `ABS-06` 的正确性 | 一致性矩阵 |
| 金标 recall / precision | `ABS-07` / `ABS-08` / `ABS-09` | core gold suites |
| time-to-green | DX 回归 | `pnpm run dx-metrics`（双口径） |
| cold / warm / edit | 规模与摘要收益 | `benchmark:s1`（合成 120 文件）/ `benchmark:s1:real:clean`（真实仓，干净 env） |
| 逐文件耗时 / 依赖装载 / CPU 栈 | `ABS-16` 口径核查、`ABS-17` 复现 | `benchmark/s1/profile-cold.mts`（`--corpus . --rounds 1 --top 30`；CPU 栈加 `--only` + `node --cpu-prof`） |
| 打包器导出形态 / 规模梯度 | `ABS-17` 阴性对照 | `benchmark/s1/generate-bundle-fixtures.mts --count N` + `profile-cold.mts --corpus benchmark/s1/.bundles` |
| 快路径 / body 路径逐字节 diff | `ABS-14` 等价门禁 | `abs14-equivalence-baseline.test.ts` + `abs14-fastpath.test.ts`（`applied` 必须增长）；降级通道 `abs14-degraded-channels.test.ts` |
| 缓存命中率 | `ABS-05` / `ABS-10` / `ABS-16` | `s1-perf-baseline-real.json#cacheTelemetry`（实例级 + 函数级分列；服务层无计数 API） |
| watch 增量轮分相 | `ABS-18` | `NUDO_WATCH_PROFILE=1` + `scripts/edit-loop-metrics.mjs --profile` |

## 8. 不做 / 边界

- 不从 body AST 发明契约义务（C0）。
- 不把 `unknown` 当 `any`。
- 不追完整 TS 泛型 / 条件类型 / HM。
- 不做 `arraySameItem(base, i => project(i))` 这类闭包式约束：约束树必须保持可推导（`--emit`）、
  可投影（dts / schema / guard）、可合取（`ABS-11`）、可快照的数据形态；`lazy` 是唯一闭包槽例外。
- 不做「从元素 / 实参 Abs 反推约束」（`Abs → NudoConstraint`）：属 C0；只能作 `nudo contract --draft` 证据。
- 不做「项间同质」（homogeneity）契约：跨位共享用 `ABS-01` 的 binder，不用 `same`。
- 不在契约层引入用户可写类型参数 / 显式实例化（`<T>`、`f<number>(…)`）。
- 没有真正隔离不宣称 sandbox。
- 不以内建 API 100% 覆盖为目标；优先消灭 wrong-exact。
- 无指标不重写 Shape 联合。
- 不为 `--from` 注入路径做整报告复用（`persistent-cache.md` 既有边界）。

## 9. 更新约定

- 开工：状态改 `[~]`，锚点写进测试或 changeset。
- 完成：状态改 `[x]`，正文按 `docs/README.md` 删除，证据留在测试 / CHANGELOG / git。
- 取消：移入 §8 或删除并留一行原因。
- 与真源冲突：以 `kernel-merge.md` / `limitations.md` / `cli-semantics.md` 为准，并在发现当次订正本文件。
