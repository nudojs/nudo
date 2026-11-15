# ADR 0001 · SemanticIndex 与 Evidence（分析面事实一致性）

> **状态**：**已接受（Accepted）** · 2026-11-14 §10 五项决议已拍板；阶段 0 与阶段 1 切片 1–3 已落地（2026-11-15），实施记录与验收见 §13–§16。
> **真源**：架构 → [`kernel-merge.md`](./kernel-merge.md) 与 `CLAUDE.md`；命令面 → [`cli-semantics.md`](./cli-semantics.md)；契约单源 → [`refine-derivation.md`](./refine-derivation.md)；架构债 → [`architecture-debt.md`](./architecture-debt.md)；会话缓存 → [`cache-invalidation.md`](./cache-invalidation.md)。
> **触发**：`tmp/bug-report.md`（审计批次 2026-11-14，34 条 bug，夹具与逐字输出在 `/tmp/**`；其中前五批基于 HEAD `86bc56e1`，第六批基于 `f689d81b`，**实施前须重新定位行号**）。
> **接线点（阶段 0–1 已落地）**：`core/src/algebra/scan/semantic-index.ts`、`core/src/algebra/diagnostics/evidence.ts`；已接线 `core/src/algebra/check/check.ts`、`service/src/analyzer-ast.ts`；待迁移 `service/src/emit/dts-generator.ts`、`nudojs/src/commands/**`、`lsp/src/lsp-surface/**`。
> **纪律**：单轨 Abs，**不引入第二 IR**；不动 Abs 形状 / `leqAbs` / `formatShape`；不改变 C0 / L2 / `any` ≠ `unknown` 语义；不触公共 API 冻结；新模块一律进已有子域（`pnpm run check:subdomains`）。
> **交付物**：阶段 0 为文档 + 测试纯新增，无 changeset；阶段 1 起涉及发布包行为，已按 `CONTRIBUTING.md:126` 补 `.changeset/adr-0001-stage1-entry-face.md`（覆盖切片 1–3）。

> **Executive summary (EN).** A 2026-11-14 audit found 34 bugs; 15 are design defects and 19 are omission defects, but 15 of those 19 are symptoms of one architectural gap: multiple parallel AST scanners / emitters / diagnostic lines with no single source of truth. This ADR proposes two analysis-time-only abstractions — a `SemanticIndex` (one binding pass keyed by `SymbolId`, read-only across every product face) and `Evidence<T>` (a typed lattice of declared / observed / degraded sources, with no constructor for silently degrading to `any`). Neither is a value IR: Abs remains the single type system, and all projections stay one-way and lossy. Rollout is a four-stage strangler with a zero-behavior-change shadow-diff phase, gated by the existing gold / real-package / differential suites.

本仓库首次引入 ADR 格式：编号 `adr-NNNN-*.md`，**编号不复用**，状态迁移 `Proposed → Accepted → Superseded`。ADR 记录「为什么这样决定」；实施细节与证据落在测试、changeset 与 git，交付后按 `docs/README.md` 生命周期清算，不建 history 目录。

---

## 1. 背景

审计批次按根因去重得 34 条。按「修复方式」二分：

| 判定 | 条数 | 判据 |
|---|---:|---|
| **设计问题** | 15 | 引擎的数据模型 / 口径里没有这个位置，补分支只能盖住当前形态，必须改结构 |
| **实现遗漏** | 19 | 同族形态在同一代码库里已有正确路径，只是某个分支 / 接线没写 |

但 19 条遗漏中有 15 条是同一个架构缺口的症状：`core` 与 `service` 各一套扫描器、`namespace` / 类 / 访问器各有专用发射器、`check` / `test` / `export` / LSP 各一条诊断线。每加一种语法形态，要在 N 处手工同步，漏一格就是一个 bug。可复发的证据：

- 修了 hover 的注入包 ⇒ 漏 `signatureHelp`（BUG-028）；修了 `migrate retire` 多目标 ⇒ 漏 `--all` 分支（BUG-022）；
- `namespace` 内 instance 方法带 `<T>`、static 不带（BUG-027）；对象字面量 getter 有读域、类 getter 没有（BUG-033）；
- 同一份源码在 check / test / dts / LSP 结论相反（BUG-015/017/020/023/024/033）；
- 四处 fail-open：无信息跳过调用点义务（BUG-003）、裸 catch 静默降级 `any`（BUG-018）、按诊断码白名单放行发布（BUG-021）、白名单式「确定抛」证据（BUG-025）——而 `check.ts` 与 directives 文档都写明「无证据必须 fail-closed」。

`scan-top-functions.ts:7` 的注释是现状最精确的写照：「与 service 面 `collectTopLevelFunctions` 逐字对齐 ⇒ **改这里必须同步改 service 面**」——即靠注释提醒人工同步。

## 2. 已有的、可推广的成功范式

本决策**不引入新架构**，只把仓库里已验证的纪律从局部推广为全局约束：

| 范式 | 位置 |
|---|---|
| `effectiveContract(fn)` 单点读取口，`check / scan / generalize / LSP` 统一走它 | `refine-derivation.md:24` |
| `protoOwnKeysOf` 作为单一事实源 | `architecture-debt.md:238` |
| `satisfies Record<keyof AbsFacets, FacetSpec>` ⇒ 漏登记编译红 | `architecture-debt.md:190` |
| 「模块级状态全部收敛于本文件（防分裂后双份）」 | `core/src/algebra/exec/transpile/helper/scope-collect.ts` 文件头 |
| 可选槽位范式（`overloads?`、`facets.*`）不改旧形状逐字节语义 | `architecture-debt.md` A6 / A2 / A10 |

## 3. 硬约束（不可协商）

1. **单轨 Abs**：`CLAUDE.md:9` 与 `plans/2026-11-09-abs-improvement-plan.md:10` 明确规定「不新增第二 IR」；dts / LSP / 序列化是**单向、有损**的外延渲染，「Nothing reads a projection back」。因此 `SemanticIndex` 是**绑定与入口元数据**，`Evidence<T>` 是**分析期证据标签**；两者都不是值 IR，不参与求值、`leqAbs`、`formatShape`、Abs 缓存 ABI。Abs 仍是唯一类型表示。
2. **包环约束**：`core/src/algebra/parse-source.ts:3` 明写 core **刻意不依赖** `@nudojs/parser`；core 也**未**引入 `@babel/traverse`（仅 service 使用）。binder 必须落在 core 内部、只产出纯数据；service 的 traverse 降级为消费方。
3. **子域冻结**：`CLAUDE.md:73-78`——`algebra/` 顶层剩余文件由 `pnpm run check:subdomains` 冻结，新模块一律进已有子域。故落点为 `algebra/scan/`（索引）与 `algebra/diagnostics/`（证据），**不是** `algebra/semantic-index.ts` 这类顶层新文件（修正口头方案）。
4. **公共 API 冻结**：`core/src/index.ts` / `algebra/index.ts` / `internal.ts` 的导出快照不得擅自扩张；跨包暴露按 §10 决议 3 走 `@nudojs/core/internal`，不新增公开导出。
5. **动 Abs 形状的门槛**：`architecture-debt.md:159`——需全仓门禁 + 改前基线。本方案不动 Abs 形状，故**不触发**该门槛；这是可渐进落地的前提。
6. **既有语义不改**：`any` = 未约束入口，`unknown` = 推断失败（`cli-semantics.md`）；L1/L2、退出码、诊断码的产品口径不变。本方案只是把「`unknown` 只能由推断失败产生」编码进类型。
7. **真源先行**：按 `CONTRIBUTING.md:120-121` 与 `docs/README.md:75-77`，阶段 1 实施前须先在 `kernel-merge.md` 增补「绑定索引层与 Abs 单轨的关系」；阶段 2 收紧诊断前须先更新 `cli-semantics.md` 的 any/unknown 与诊断段。**本 ADR 不改真源**，避免未实施的决策污染真源。

## 4. 决策

### D1 · `SemanticIndex`：一次 binding，处处按身份消费

第一类的 9 条（001/003/011/012/013/019/020/025/034）病因相同：**按字符串名字建模，而非按符号身份建模**，名字一遮蔽、一改名、一换 AST 形态就断链。

```ts
// core/src/algebra/scan/semantic-index.ts —— 纯数据，不依赖 traverse / parser 包
// 稳定键 = scopeUid + declarationStart（§10 决议 1）
export type SymbolId = string & { readonly __brand: "SymbolId" };
export interface SemanticIndex {
  symbols: ReadonlyMap<SymbolId, SymbolInfo>;       // const/let/param/catch/import/reexport/class…
  refs: ReadonlyMap<NodeId, SymbolId>;              // 每个 Identifier 引用 → 绑定
  exportSlots: ReadonlyMap<ExportSlot, SymbolId>;  // default / named / module.exports / exports.x
  entries: ReadonlyArray<EntryId>;                 // 函数·类·方法·构造器，唯一入口表
  members: ReadonlyMap<SymbolId, MemberTable>;     // own 字段 + 原型方法 + static + 访问器
  spans: IntervalIndex;                            // 字面量 / 注释区间，按 offset 不按行
}
```

- **唯一生产者**：`buildSemanticIndex(file)` 一次遍历（复用 `scope-collect.ts` 的 `collectPatternNames`），索引与 `File` 同条目挂进 `parseSource` 的 LRU（容量 16、source key ≤ 1 MB），避免索引比 AST 活得久。
- **身份替代名字**：遮蔽 / 解构 / 重命名 default 导入 / 导入绑定再导出都归为同一条 `refs` 查询；`constNames: Set<string>` 换成 `symbols.get(id).kind === "const"`，写入检查统一走 `$assign(id)`；原型方法进 `members`。
- **事实单点传播**：`refine(env, cond)` 是 typeof / nullish / relational / binder-ref 的唯一入口，if 臂、`&&` 右式、循环体、catch、可选链共用；词法上下文查 `spans` 的 offset 区间；module-throw 由「执行初始化 + 返回 effect」判定，不再靠语法白名单。
- **导出槽适配器**：唯一允许枚举语法形态的地方（CJS 成员赋值、`export default {…}`、namespace、`.ts` 参数属性、类表达式说明符导出），一处注册，所有面生效。

### D2 · `Evidence<T>`：精度与失败都成为有类型的值

第二类 6 条（007/008/014/018/021/030）与 4 条 fail-open 的病因：**类型来源优先级与失败策略散在各产品面**，靠约定维持。

```ts
// core/src/algebra/diagnostics/evidence.ts —— 分析期包装类型，不是 Abs 槽位
export type Evidence<T> =
  | { kind: "declared";  value: T; from: "annotation" | "contract" }
  | { kind: "observed";  value: T; paths: number }
  | { kind: "degraded";  reason: DiagnosticCode };  // 没有「→ any」的构造子

export type PublicName = string & { readonly __brand: "PublicName" };
export type ModuleForm = { kind: "esm" } | { kind: "cjs"; exportEquals: SymbolId | null };
```

- **唯一优先级格** `resolvePublicType(sources)`：`declared > join(observed) > degraded(unknown)`。内部 `new C()` 只是 observed 的一条路径（007），注解压过初始化器（014），getter 无注解也能用读域（033）。`unknown` 只能由 `degraded` 产生。
- **降级不可丢**：018 的裸 `catch` 必须返回 `degraded("nudo:contract-load")`；003 的「无信息跳过义务」、025 的「白名单没命中就判绿」同样落 `degraded`，check 一律 fail-closed。文档承诺由类型保证，不再依赖 review。
- **发布门按语义**：删除 `EXPORT_BLOCKING_CODES` 按码白名单，判据改为「公开面存在 `degraded` 且用户申报过契约 ⇒ 阻断并上屏」（021）。诊断成为值的一部分，不会被 `diagnostics.ts:76` 的丢弃分支吞掉。
- **编译期边界**：`_p0` 是 `InternalName`，dts / zod / standard 的键集合只接 `PublicName`（030），渲染名取 index 绑定表（029）；`export =` 是 `ModuleForm` 的一等分支（008）。

### D3 · 产品面只读（把 D1/D2 强制化的执行约束）

`check` 普查面、`service/analyzer-ast`、`dts-generator` 的 `surface`、LSP 三个 handler、`export` 入口表一律改为只读 index + Evidence 决议结果；禁止再各自遍历 AST 或各自拼字符串声明。dts 的 namespace / 类 / 访问器 / default 槽统一走模块级那条已正确的投影路径。孪生实现按阶段逐个删除。

> D3 不是第三个抽象，而是 D1/D2 的必要条件：只要还有一个面自己造表，「补一处」就退化为「补 N 处」。

## 5. 备选方案与否决理由

| 备选 | 否决理由 |
|---|---|
| **A · 逐条补分支**（34 条逐个修） | 形态 × 面矩阵是 N×M；报告已记录同一修法反复复发（hover/signatureHelp、`--all`、instance/static、对象/类 getter）。止血可以，不解决再发。 |
| **B · 直接用 `@babel/traverse` 的 `Scope.getBinding()` 替代** | 违反 §3.2 包环约束（core 不依赖 traverse / parser）；且 Babel 标准绑定表不认 CJS `exports.x`、`export namespace`、`.ts` 参数属性的**导出槽**，仍需一层适配器。可作适配器内部实现参考，不能作跨包真源。 |
| **C · 把 `SymbolId` / `Evidence` 塞进 `Abs.facets`** | 动 Abs 形状 ⇒ 触发 `architecture-debt.md:159` 全仓基线；且把绑定元数据混入值语义会污染 `leqAbs` / `formatShape` / 磁盘缓存 ABI（`HARVEST_DISK_ABI`），与单轨 Abs 口径冲突。 |
| **D · 新建 `packages/semantics` 包** | 新增包依赖与发布面，收益不抵；纯数据索引留在 `core/scan`，由已允许依赖方向的 `service → core` 消费即可。 |
| **E · 只统一 dts 投影层** | 是 D3 的真子集，可先做但不能解决 check / LSP 面的假绿假红；保留为阶段 1 的一个迁移切片，不单独立项。 |
| **F · 引入第二个 IR（typed AST / HIR）** | 直接违反 `CLAUDE.md:9` 与 plans 纪律「单轨 Abs；不新增第二 IR」。 |

## 6. 覆盖矩阵

| 决策 | 直接闭合 | 迁移后闭合（需阶段 1） |
|---|---|---|
| **D1** | 001 003 011 012 013 019 020 025 034（9） | 002 004 015 016 017 023 024 026 028 032（10） |
| **D2** | 007 008 014 018 021 030（6） | 003 018 021 025 的 fail-open 半边（与上表去重后不另计） |
| **D3** | — | 005 006 009 027 029 031 033（7） |
| **合计** | 15 | 19 |

> 迁移后才能闭合的 19 条**不是自动修复**：D1/D2 只提供唯一事实来源，各面切换为只读时才会消掉对应缺口。阶段 0 的影子对拍清单即为这 19 条的验收底稿。

## 7. 落地阶段、验收与回滚

| 阶段 | 动作 | 验收 | 回滚 |
|---|---|---|---|
| **0 · 影子对拍**（零语义变更） | 新增两个子域模块 + 类型 + 差分测试；用报告 34 条「一变量对照」夹具断言 `index.entries` / `exportSlots` 与旧扫描器的分歧并**输出清单**，不修行为。**证据固化**：`tmp/bug-report.md` 与 `/tmp/**` 夹具均被 `.gitignore` 忽略、不入版本库，故本阶段须把最低限度的一变量夹具与逐字输出转成仓库内测试，否则评审与后续回归无据可依；**范围**按 §10 决议 5，仅 ESM / CJS 主路径 | `pnpm run build` → `pnpm run lint` → `pnpm run test`（按 `CLAUDE.md:32` 先 build）；`pnpm run check:subdomains` | 纯新增文件 + 测试，直接 revert |
| **1 · 逐面双读迁移** | `check` → `service` → `dts` → `LSP` → `export`，每切一面删一份孪生实现，旧路径留开关式 fallback | 每面：金标 `check-recall-gold` / `check-gold`、真实包零 FP、差分语料、`verify:examples`、`test:fs-input`；`cache-invalidation.md` 的键纪律须把 Evidence 纳入 `analysisFileCacheKey` / `fnDepSeg`，否则 watch / LSP 命中陈旧结论 | 双读开关关回旧路径；每面一个 PR |
| **2 · 收紧不变量** | 三条 CI 断言：① 产物 `tsc --strict` 必可编译；② 同一文件 check/test/dts/LSP 结论一致；③ 任何 `degraded` 不得无诊断消失 | 断言先以 warning 观察一轮，全绿后升 error | 断言降级为 warning |
| **3 · 删旧** | `constNames` 外挂集、`EXPORT_BLOCKING_CODES`、`definiteModuleThrowOf` 语法证据表、`resolveExportSlotCall` 形态枚举、双读 fallback | 阶段 1/2 全绿 + 公共 API 快照无新增导出 | git revert |

阶段 1 起按 `CONTRIBUTING.md:126` 补 changeset；文档-only 的阶段 0 不需要。

## 8. 后果

**正面**：新语法形态只需在 binder 注册一次；静默失败在类型里写不出来；跨面矛盾从「靠 review 发现」变成「编译期 / CI 不可能」；AST 遍历次数从每面一次降为一次（索引复用 `parseSource` LRU）。

**负面 / 成本**：多一层 binder 构建（一次遍历 + 一张索引表）；迁移期双读会短暂增加内存与分支；19 条形态必须在导出槽适配器显式注册（集中在一处，但不是零）；`Evidence` 进分析结论后需纳入缓存键，增加缓存键维度。

**中性**：不改 Abs 形状、不改求值引擎、不改产品语义；A 类架构债与求值模型层问题不受影响。

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 索引与 AST 缓存生命周期错位（LRU 淘汰后悬空引用） | 索引与 `File` 同条目存储，`NodeId` 用稳定 offset 而非对象引用；阶段 0 加缓存淘汰回归 |
| Babel 标准绑定表不覆盖 CJS / namespace / `.ts` 参数属性 | 导出槽适配器一层显式注册；阶段 0 用报告夹具做覆盖清单，未覆盖形态 fail-closed 报 `degraded`，不猜 |
| 增量 CI（`vitest --changed`）漏跑跨包影子对拍 | 阶段 0 起把 `semantic-index-shadow.test.ts` 列入 `vitest.config.ts` 的 `forceRerunTriggers`，或阶段 1 每面走全量门禁 |
| 迁移期新旧结论分歧被当成回归 | 分歧一律以旧路径为准（零回归），只进清单不修行为；按 §10 决议 4 **不设白名单**，真正的产品口径差异在阶段 1 登记 `limitations.md` |
| 公共 API 快照漂移 | 按 §10 决议 3 走 `@nudojs/core/internal`，参照 `architecture-debt.md` A3「只钉导出名、不新增公开导出」；阶段 0 先用包内相对导入，跨包登记留阶段 1 |

## 10. 决议（2026-11-14 已拍板）

| # | 项 | 决议 | 要点 |
|---:|---|---|---|
| 1 | `SymbolId` 稳定键 | **`scopeUid + declarationStart`** | 跨 parse 稳定，`parseSource` LRU 重建与 LSP 增量不漂移；`NodeId` 用 offset 而非对象引用。单调递增 id 因依赖遍历顺序被否 |
| 2 | `degraded` 诊断码 | **复用现有码**，按来源分派；不新增用户可见码 | `nudo:contract-load` / `nudo:internal` / `nudo:unknown-inference`；发布门按「公开面有 `degraded` 且申报过契约」阻断。新增码会延续 BUG-021 的「按码白名单」模式，且牵动网站文档 / i18n / 诊断快照 |
| 3 | 跨包暴露面 | **`@nudojs/core/internal`** | 复用 `kernel-merge.md:122` 的 `absLit` 单源先例；`service → core` 方向已允许；不扩张公开 API 快照；`SymbolId` / `PublicName` 的 branded 约束不在边界退化 |
| 4 | 影子对拍分歧 | **不设白名单** | 阶段 0 只输出待修清单、不修行为、不设 CI 失败门槛；真正的产品口径差异在阶段 1 登记 `limitations.md`（有真源与关闭条件） |
| 5 | 阶段 0 适配器范围 | **仅 ESM / CJS 主路径** | 覆盖 BUG-002/015/016/017/023/024/032；namespace（027/031）与 `.ts` 参数属性属 D3 投影面，留阶段 1；保持阶段 0 可独立 revert |

**实施时须核实（不改变上述决议）**：

- 决议 2：`nudo:internal` 当前是否覆盖 `definiteModuleThrowOf` 那条回落通道（BUG-025 指出它只属 internal 回落）；若否，阶段 1 给该通道接一个**既有**码，仍不新增。
- 决议 3：`@nudojs/core/internal` 登记是否触发公共 API 快照检查；参照 `architecture-debt.md` A3 的做法处理。
- 决议 5：阶段 0 的差分清单不含 namespace 形态，评审时不得据此认为「D3 已覆盖」；覆盖矩阵（§6）仍以迁移后闭合为准。

**状态**：决议已定；实施按 §13–§16 逐切片推进，每片开工前另行确认（本 ADR 不自动授权后续切片）。

## 11. 非目标

- `architecture-debt.md` A 类真架构债（A1 生成器时间轴等求值模型层）；
- 改动 Abs 形状、`leqAbs`、`formatShape`、单轨 IR、`HARVEST_DISK_ABI`；
- 产品语义变更：CLI verbs、退出码、`any` / `unknown` 显示、L1/L2 口径；
- 重写 transpile / 求值引擎；引入 `@babel/traverse` 到 core；新增 workspace 包；
- 本 ADR **不在阶段 0 改动真源**：阶段 1 起按 §3.7 已先行更新 `kernel-merge.md`（绑定索引层）；`cli-semantics.md` 留阶段 2 收紧不变量前更新。

## 12. 参考

`CLAUDE.md`（架构 / 子域冻结 / CI）、`docs/README.md`（文档生命周期）、`CONTRIBUTING.md:120-127`、
`docs/design/kernel-merge.md`、`cli-semantics.md`、`refine-derivation.md`、`architecture-debt.md`、
`cache-invalidation.md`、`evaluation.md`、`plans/2026-11-09-abs-improvement-plan.md`、
`tmp/bug-report.md`（34 条根因与逐字输出；**本地审计材料，`tmp/` 与 `/tmp/**` 夹具不入 git，故 §7 阶段 0 要求固化**）、
`core/src/algebra/parse-source.ts`、`core/src/algebra/scan/scan-top-functions.ts`、
`core/src/algebra/exec/transpile/helper/scope-collect.ts`、
`core/src/algebra/contract/export-slot.ts`、`service/src/analyzer-ast.ts`、
`service/src/emit/dts-generator.ts`、`nudojs/src/commands/export/diagnostics.ts`、
`lsp/src/server-ide.ts`、`lsp/src/lsp-surface/completions.ts`。

---

## 13. 阶段 0 实施记录（2026-11-14）

**范围**：纯新增 4 个源码 / 测试文件，**未修改任何生产代码路径**；不接 `check` / `service` / dts / LSP 任何一面 ⇒ 零行为变更、可独立 revert。

| 文件 | 行数 | 内容 |
|---|---:|---|
| `packages/core/src/algebra/scan/semantic-index.ts` | 699 | `SemanticIndex` 类型 + `buildSemanticIndex(file)`；core 无 `@babel/traverse` ⇒ 手写 AST walker；稳定键 `scopeUid@start#name`；`refs` / `exportSlots` / `entries` / `members` / `spans` / `calls`；`resolveBindingAt` / `lexicalKindAt` 查询 |
| `packages/core/src/algebra/diagnostics/evidence.ts` | 96 | `Evidence<T>` 判别联合 + `resolvePublicType` 优先级格 + `PublicName` / `ModuleForm` / `publishBlockedBy` |
| `packages/core/src/algebra/__tests__/semantic-index-shadow.test.ts` | 189 | 10 组主路径夹具（源码逐字固化自审计报告）+ 影子对拍清单 |
| `packages/core/src/algebra/__tests__/evidence-lattice.test.ts` | 93 | 优先级格 / fail-closed / 公开名 / 模块形态单测 |

**与 ADR 的实施细化**（不改变 §10 决议）：

1. 索引缓存用 `WeakMap<File, SemanticIndex>` 而非修改 `parseSource` 的 LRU：同样保证「索引与 AST 同生命周期」，但阶段 0 保持纯新增文件；阶段 1 接线时并入 LRU。
2. 解构模式收集与 `scope-collect.ts::collectPatternNames` 同形实现，未直接 import：避免 `algebra/scan → exec/transpile` 反向依赖与该模块的加载副作用；阶段 1 可评估提取为共享叶模块。
3. `spans` 用 `readonly LexicalSpan[]` + `lexicalKindAt()` 而非 `IntervalIndex` 对象；`calls`（BUG-032 / 004 证据）与 `refByOffset`（`refs` 的 offset 便利索引，非第二份事实）是接口实现细化。
4. BUG-032 的旧调用点面对拍留阶段 1（`scanLiteralCalls` 需要 `Phi` 等分析上下文）；阶段 0 只做索引侧登记与正向断言。

**影子对拍清单**（`+` = 索引有、旧扫描面无；不设白名单、不设失败门槛）：

```text
BUG-002     old=[boom] indexed=[boom] slots=[exports.greet] +[]
BUG-015a    old=[] indexed=[a] slots=[a] +[a]
BUG-015b    old=[] indexed=[a] slots=[a] +[a]
BUG-016     old=[] indexed=[m] slots=[default] +[m]
BUG-017     old=[] indexed=[default,default.m] slots=[default] +[default,default.m]
BUG-023a    old=[] indexed=[C,C.m] slots=[module.exports] +[C,C.m]
BUG-023b    old=[] indexed=[C,C.m] slots=[exports.C] +[C,C.m]
BUG-024a    old=[] indexed=[C,C.m] slots=[C] +[C,C.m]
BUG-024b    old=[] indexed=[C] slots=[default] +[C]
BUG-004/032 old=[K.m,tplKey,optMember,optCall,K] indexed=[K,tplKey,optMember,optCall,K.m] +[]
```

- `BUG-002` 的分歧在**导出槽**而非入口表：`slots=[exports.greet]` 已把槽映射到本地 `boom`，正是 `resolveExportSlotCall` 缺的成员赋值形态。
- `BUG-004/032` 的入口面一致，差异在 `calls`：两条可选链登记为 `optional`，模板字面量成员键登记为静态键 `m`。

**验收**：

| 项 | 结果 |
|---|---|
| `pnpm run build` | ✓ 全包构建成功 |
| `pnpm run lint` | ✓ `tsc --noEmit` 无错 |
| `node scripts/check-core-subdomains.mjs` | ✓ 顶层 43/43、子域合规 |
| 相关 vitest（2 文件） | ✓ 24/24 |
| 全量 `pnpm run test` | 18033 passed / **1 failed** / 1 expected fail / 7 todo；唯一失败 = `docs-coverage.test.ts` rule 17（新增 ADR 未登记到网站索引页） |
| 修复后 `docs-coverage.test.ts` | ✓ 46/46（en + zh 索引页均已登记）；修复面仅文档索引，故未重跑全量，其余 1766 文件结果不受影响 |
| `packages/core/dist` 产物检查 | ✓ 无 `SemanticIndex` / `buildSemanticIndex` / `resolvePublicType` 字符串 ⇒ 新模块未进任何 barrel / 生产入口，运行时零影响 |
| `packages/website/tests/` | 13/14 文件通过；`dx-metrics-publication.test.ts` 的 time-to-green sanity（< 10 s）在连续重负载后测得 13.4 s / 20.7 s，但其硬主张 `fix-rate === 1` 仍通过、全量首轮该用例通过。文件头注释明写「spawn 子进程链约 10 s，勿与其他 heavy job 并发跑」⇒ 机器噪声，与本次改动无关 |

**阶段 1 入口**：把 `buildSemanticIndex` 经 `@nudojs/core/internal` 暴露给 service；`check` 普查面先双读；`Evidence` 纳入 `analysisFileCacheKey` / `fnDepSeg`（`cache-invalidation.md`）；按 §3.7 先改 `kernel-merge.md` 真源。

---

## 14. 阶段 1 · 切片 1 实施记录（2026-11-14）

**范围**：`check` 面的第一个切片。按 §7「每面一个 PR、旧路径为准、零回归」，本切片**不切换任何产品面**，只把双读接进管线并钉住零行为变更。

| 改动 | 文件 |
|---|---|
| 真源先行（§3.7 / `CONTRIBUTING.md:121`） | `docs/design/kernel-merge.md` 新增「绑定索引层（ADR 0001 · 不是第二 IR）」：索引/证据不是值 IR、Abs 仍是唯一类型表示、`@nudojs/core/internal` 是唯一跨包出口、`algebra/scan` 不得 import `exec/transpile` |
| 跨包出口（决议 3） | `core/src/internal.ts` 最小导出面：`buildSemanticIndex` / `compareEntryFaces` / `setSemanticIndexShadow` / `takeSemanticIndexShadow` + `SemanticIndex` / `SymbolId` / `EntryFaceDiff` 三个类型；`.`（`src/index.ts`）**零改动** |
| 快照门禁 | `core/public-api.snapshot.json` 同步 7 个名字。§10 决议 3 的「实施时须核实」已坐实：internal 面同样被 `public-api-freeze.test.ts` 冻结，必须同 PR 更新快照 |
| 影子双读 | 新增 `core/src/algebra/scan/entry-face-shadow.ts`；`check.ts` 名表拼装后一行 `recordSemanticIndexShadow(file, names)` |
| 验收测试 | `core/src/algebra/__tests__/entry-face-shadow.test.ts`（4 例） |

**关键决策**：

- 双读**默认关闭**（模块级开关 `setSemanticIndexShadow(true)` 开启）；关闭时只做一次布尔判断、不构建索引 ⇒ CLI 热路径零开销。`names` 仍取 `listTopFunctions ∪ listClassEntryNames`，**门禁结论完全不变**；测试用同一源码开关前后比对 `signatures` 与 issue codes 钉住这一点。
- **推迟**「`Evidence` 纳入 `analysisFileCacheKey` / `fnDepSeg`」（§7 阶段 1 清单）：D2 目前未进入任何分析结论，此时塞进缓存键既无语义作用、又徒增缓存漂移风险。改在 D2 首次接入产品面的那个切片同步做；该纪律已写入 `kernel-merge.md`。
- 开启双读后解构导出的分歧（`added: ["a"]`）可见，但 `l2Count(report) === 0` ⇒ BUG-015 仍未修；修复需要显式切换普查面，留切片 2。

**验收**：

| 项 | 结果 |
|---|---|
| `pnpm run build` | ✓ 全包构建成功（internal 导出进 dist） |
| `pnpm run lint` | ✓ `tsc --noEmit` 无错 |
| `node scripts/check-core-subdomains.mjs` | ✓ 43/43、子域合规 |
| 相关 vitest（4 文件，含 `public-api-freeze`） | ✓ 37/37 |
| 全量 `pnpm run test` | ✓ **1768 文件 / 18038 passed / 0 failed**（1 expected fail、7 todo） |

**切片 2 入口**：service `analyzer-ast` 消费 internal 索引 → `check` 普查面切换为可读新表（保留 fallback 开关）→ 金标 `check-recall-gold` / `check-gold` / 真实包零 FP / 差分语料回归 → 之后才是 dts / LSP / export 各面。

---

## 15. 阶段 1 · 切片 2 实施记录（2026-11-14）

**范围**：service 普查面**只读消费**索引 + `check` 普查面**可切换**（默认仍关闭）。按 §7「每面一个 PR、旧面为准、零回归」，本切片不把任何面默认切到新表，也不删孪生扫描器；`check` 结论与切片 1 完全一致。

| 改动 | 文件 |
|---|---|
| 两层开关 | `core/src/algebra/scan/entry-face-shadow.ts`：`shadowEnabled`（切片 1 记录分歧）与 `entryFaceEnabled`（切片 2 切换名表）均默认关闭；`resolveEntryFace` 关闭时**原样返回同一数组引用**（不构建索引、零分配），开启时返回 `entries ∪ missing`、索引为空则 fail-closed 回退旧面 |
| `check` 接线 | `core/src/algebra/check/check.ts`：先 `recordSemanticIndexShadow(file, oldNames)` 再 `resolveEntryFace(file, oldNames)`；两开关关闭时门禁结论零变更 |
| 跨包出口 | `core/src/internal.ts` 增 4 个值导出（`recordSemanticIndexShadow` / `resolveEntryFace` / `semanticIndexFaceEnabled` / `setSemanticIndexEntryFace`）；`core/public-api.snapshot.json` 同步 205 → 209（决议 3 的「实施时须核实」再次生效：internal 面被冻结） |
| service 只读适配 | `service/src/analyzer-ast.ts` 经 `@nudojs/core/internal` 读 `buildSemanticIndex`，新增 `recordServiceEntryFace` / `takeServiceEntryFace` / `ServiceEntryFaceSnapshot`；`analyzer-orchestrate-uncached.ts` 普查后一行接线 |
| 真源先行 | `docs/design/kernel-merge.md`「绑定索引层」补 2 条：单一开关、切换口径与 fallback、开关不进缓存键且不得运行期热切换 |
| changeset | `.changeset/adr-0001-stage1-entry-face.md`（阶段 1 起按 `CONTRIBUTING.md:126` 补；切片 1 漏补，本切片一并补齐） |
| 验收测试 | `core/.../entry-face-shadow.test.ts` 增 4 例（共 8）、新增 `service/src/__tests__/semantic-index-face.test.ts` 6 例 |

**关键决策**：

1. **单一开关**：`semanticIndexFaceEnabled() = shadow || entryFace`，service 不自建第二份开关（否则又回到「各面手工同步」）。关闭时 `recordServiceEntryFace` 只做一次布尔判断，连名字数组都不复制。
2. **切换不丢旧入口**：`entries ∪ missing` 是迁移期安全网；阶段 3 删旧前，切换不得让任何旧入口消失。实测开启后 `checkSource` 对 BUG-015 夹具的 `signatures` 由 `[]` 变为 `["a"]`，issue codes 不变 ⇒ 入口面确实被补上且不是靠多报诊断换来的。
3. **service 侧只做只读对照**：`collectTopLevelFunctions` 同时提供节点（形参 / 定位 / `noDeclaration`），索引只有名字，**不能替换它**；删孪生实现留后续切片。
4. **开关不进缓存键**：默认关闭且只读，不改变分析结论；因此同一进程内不得热切换（memo / 函数级缓存不感知开关状态）。默认切换须与 `analysisFileCacheKey` / `fnDepSeg` 纪律一起落地。

**service 影子对拍清单**（默认关闭、只输出、不设白名单 / 不设失败门槛）：

```text
BUG-015 解构导出       census=[a]              indexed=[a]              +[]        -[]
BUG-016 default 对象   census=[]               indexed=[m]              +[m]       -[]
BUG-017 匿名 default 类 census=[default.m]      indexed=[default,default.m] +[default] -[]
BUG-023 CJS 类         census=[]               indexed=[C,C.m]          +[C,C.m]   -[]
BUG-024 ESM 类表达式    census=[C.m]            indexed=[C,C.m]          +[C]       -[]
```

> 对阶段 0 清单的一处**修正**：BUG-015 在 service 面其实已被 Bug 90 的对象字面量分支覆盖（`census=[a]`），与 core 旧面（`old=[]`）不同 ⇒ 该条「跨面矛盾」的缺口在 **core 侧普查面**，不是 service 侧。阶段 1 逐面迁移须按面归因，不能拿 core 的清单直接套 service。

**默认切换前的风险实测**（临时把 `entryFaceEnabled` 默认置 `true` 跑全量，随后**立即恢复 `false`**；该状态不是交付状态，也未进入任何测试快照）：

- 1769 文件 / 18056 用例：**6 失败 / 5 文件**。其中 2 条是我们自己「默认关闭」的自指断言（`entry-face-shadow.test.ts`、`semantic-index-face.test.ts`），**4 条是真实回归**：
  - `core-bug-996-cjs-getter-setter-not-entry.test.ts`（getter / setter 各 1 条）：`objectPropertyKeys` 只看 `isFunctionValue(p)`，未看 `kind` ⇒ 访问器被当成可调用入口，报假 `entry may-throw` / `opaque-result`（§16 实测 `indexed=[f]`）。
  - `core-bug-1149-tmp-name-shadowing-rest.test.ts`、`core-bug-1159-hardcoded-temp-names.test.ts` 各 1 条：**`FunctionDeclaration` 无条件 `addEntry`** 且 walker 遍历整棵 AST ⇒ 函数体内嵌套声明被当成模块顶层入口（§16 实测 `SRC_D2` 的 `function g(){}`：`old=[f] indexed=[f,g]`）⇒ 名字解析不到、假 `nudo:opaque-result`。此处「内部临时名」是当时的错误推测，§16 已按实测更正。
- 三份金标（`check-gold` / `check-recall-gold` / `check-shape-gold`）在**开启**状态下仍 233/233 全绿 ⇒ 缺口集中在 **`entries` 精度**，不是优先级格或整体架构。

⇒ **切片 3 的前置条件**：先在 binder Pass 2 排除访问器与内部临时名，再考虑默认切换；不得用白名单压掉这 4 条（§10 决议 4）。

**验收**（串行执行，避免重负载相互干扰）：

| 项 | 结果 |
|---|---|
| `pnpm run build` | ✓ 全包构建成功（internal 导出进 dist） |
| `pnpm run lint` | ✓ `tsc --noEmit` 无错 |
| `node scripts/check-core-subdomains.mjs` | ✓ 顶层 43/43、子域合规 |
| 相关 vitest（5 文件，含 `public-api-freeze`） | ✓ 47/47 |
| 金标 `check-gold` / `check-recall-gold` / `check-shape-gold` | ✓ 233 passed + 1 expected fail |
| 全量 `pnpm run test` | ✓ **1769 文件 / 18048 passed / 0 failed**（1 expected fail、7 todo） |
| `pnpm run verify:examples` | ✓ 254 checks / 0 failed |
| `pnpm run test:fs-input` | 15/16 文件、224/225 用例通过；唯一失败是 `dx-metrics-publication` 的 tsx `time-to-green` sanity（21.9 s ≥ 10 s）。**同一用例在全量 `pnpm run test` 中通过**；单独复跑两次为 13.99 s / 13.99 s，但 `dist` 口径仅 693 ms、两口径 `fixRate === 1`（硬主张全绿），`uptime` load average 5.8 / 6.5 / 7.2 ⇒ tsx 冷启动子进程链受机器负载影响，非回归（与 §13 阶段 0 记录同类噪声） |

**切片 3 入口**：修 `entries` 精度 → 默认切换 + `analysisFileCacheKey` / `fnDepSeg` 键纪律 → 删 core 侧孪生扫描器 → 之后才是 dts / LSP / export 各面。

---

## 16. 阶段 1 · 切片 3 实施记录（2026-11-15）

**范围**：修 `entries` 精度 → `check` 索引普查面**默认开启** → 缓存键纪律。**不删孪生扫描器**：`listTopFunctions` / `listClassEntryNames` 仍作为 fallback 与 `missing` 补齐源存在，删除归阶段 3；service 的 `collectTopLevelFunctions` 也仍是「名称 + 节点」面（§15 决策 3 不变）。

| 改动 | 文件 |
|---|---|
| 精度修复 ① | `core/src/algebra/scan/semantic-index.ts::objectPropertyKeys`：`ObjectMethod` 恒被 `isFunctionValue` 认作函数值 ⇒ 增加 `kind === "get" / "set"` 排除，与 `memberTableOf` 及 service `analyzer-ast.ts` 的 `prop.kind !== "method"` 同口径（BUG-996） |
| 精度修复 ② | 同文件 `visit()` 引入 `topLevel = frame.uid === root.uid` 门控，套在 `FunctionDeclaration` / `AssignmentExpression` / `ExportNamedDeclaration` / `ExportDefaultDeclaration` / `VariableDeclarator` / `ClassDeclaration|ClassExpression` 六处入口登记上。绑定表（`symbols` / `refs` / `spans` / `calls`）仍遍历整棵 AST，不受影响（BUG-1149 / 1159） |
| 默认切换 | `entry-face-shadow.ts` 的 `entryFaceEnabled` 由 `false` → `true`；`setSemanticIndexEntryFace(false)` 保留为开关式 fallback（§7，阶段 3 删） |
| 开关职责分离 | 原 `semanticIndexFaceEnabled()`（shadow ∥ entryFace）改名为 `semanticIndexShadowActive()`（**只** shadow）：索引面默认开启后，service 只读快照不得随之开启，否则每次 `analyzeFile` 都多建一次索引。新增 `semanticIndexEntryFaceSegment()`（`idx1` / `idx0`） |
| 缓存键纪律 | `semanticIndexEntryFaceSegment()` 进入 core `checkMemoKey`、service `analysisFileCacheKey` 的 `auxKey` 与 `analyzer-orchestrate-uncached.ts` 的函数级 `fnCacheKey` ⇒ 两档结论互不回放，切片 2 的「不得热切换」限制解除 |
| 出口 / 快照 | `core/src/internal.ts` 换名 + 新增 2 个值导出；`core/public-api.snapshot.json` 209 → 210（决议 3 的快照门禁第三次生效） |
| 真源 | `docs/design/kernel-merge.md`「绑定索引层」改写切片 2/3 条文：默认开启、开关职责分离、缓存键纪律、`entries` 只收顶层可调用形态 |
| 发布 | `.changeset/adr-0001-stage1-entry-face.md` 文案改述默认切换与两个精度修复（行为变化必须进 changeset） |
| 测试 | 新增 `core/.../entry-face-precision.test.ts`（5 例）；重写 `entry-face-shadow.test.ts`（12 例，含 `checkMemoKey` 两档不互串）与 `semantic-index-face.test.ts`（8 例，含 `analysisFileCacheKey` 两档不互串） |

**根因修正（对 §15 实验记录的更正）**：逐夹具实跑后确认，4 条真实回归是**两个**精度缺口，不是「Pass 2 全量 keys」也不是「内部临时名」：

```text
BUG-996  GETTER/SETTER  old=[]  indexed=[f]   ON codes=[nudo:entry-may-throw,nudo:opaque-result]
BUG-1149 SRC_D2         old=[f] indexed=[f,g] ON codes=[nudo:opaque-result]   ← 嵌套 function g(){}
控制     SRC_A1/C1      old=[f] indexed=[f]   ON codes=[]
```

**关键决策**：

1. 修精度**不靠白名单**（§10 决议 4）：getter/setter 按 `kind` 判据排除，嵌套声明按作用域身份排除，都是结构性判据，不是「把这几个测试名加进豁免表」。
2. 默认切换后 `check` 的 `signatures` 对 BUG-015 夹具由 `[]` 变 `["a"]`、issue codes 不变 ⇒ 假绿变真入口，不靠多报诊断。三份金标与差分语料见验收表。
3. 缓存键按**语义状态**而非开关名入键：`idx1` / `idx0` 是分析输入维度，与 `autoBind` / `caseMode` 同纪律；`Evidence` 仍未进分析结论，故 D2 的键维度继续推迟到它首次接产品面时。
4. `resolveEntryFace` 不再写 `lastDiff`：影子观察（`shadowEnabled`）与入口口径（`entryFaceEnabled`）彻底解耦，默认路径不产生任何观察副作用。

**验收**（串行执行，避免重负载相互干扰）：

| 项 | 结果 |
|---|---|
| `pnpm run build` | ✓ 全包构建成功 |
| `pnpm run lint` | ✓ `tsc --noEmit` 无错 |
| `node scripts/check-core-subdomains.mjs` | ✓ 顶层 43/43、子域合规 |
| 相关 vitest（9 文件：精度回归、影子、Evidence、service 接线、`public-api-freeze`、三条 §15 原失败夹具） | ✓ **108/108** |
| 金标 `check-gold` / `check-recall-gold` / `check-shape-gold` | ✓ 233 passed + 1 expected fail |
| 全量 `pnpm run test` | ✓ **1770 文件 / 18057 passed / 0 failed**（1 expected fail、7 todo）——索引面**默认开启**下的首次全绿，§15 实验的 4 条真实回归全部闭合，且未用豁免 |
| `pnpm run verify:examples` | ✓ 254 checks / 0 failed |
| `docs-coverage.test.ts` | ✓ 46/46（ADR 与 en/zh 索引页状态同步） |
| `pnpm run test:fs-input` | 15/16 文件、224/225 用例通过；唯一失败仍是 `dx-metrics-publication` 的 tsx `time-to-green` sanity（22.9 s ≥ 10 s）。**同一用例在全量 `pnpm run test` 中通过**；直跑 `dx-metrics.mjs` 显示 `dist` 口径 732 ms、两口径 `fixRate === 1`（硬主张全绿）、`uptime` load average 6.2 / 7.0 / 6.9 ⇒ tsx 冷启动子进程链受机器负载影响，与 §13 / §15 同类噪声，非回归 |

**切片 4 入口**：dts 面接单一投影层 → LSP → export；每面切换后删对应孪生实现；阶段 2 三条不变量断言、阶段 3 删旧（含本切片的 fallback 开关与 `idx0` 档）。

---

## 17. 下一步路线决议（2026-11-15）

**决议**：阶段 1 切片 4 **不按 §7 原顺序先做 dts 投影层**，改为先让 `Evidence<T>` 首次接入产品面（D2）。

**理由（核对结果）**：

- `evidence.ts` 至今只有类型骨架 + 单测，**没有任何生产代码 import**：34 条里第二类 6 条（007 / 008 / 014 / 018 / 021 / 030）与 4 条 fail-open 半边全部未闭合；`EXPORT_BLOCKING_CODES`（`nudojs/src/commands/export/diagnostics.ts:63`）、`definiteModuleThrowOf`、`constNames`、`resolveExportSlotCall` 四处白名单仍在原位。
- §6 明确 dts 那 7 条（005 / 006 / 009 / 027 / 029 / 031 / 033）由「单一投影层 + **优先级格**」顺带闭合，而优先级格就是 D2 ⇒ 先做 dts 会临时写一遍类型优先级，D2 接入时再改第二次。

**切片 4 范围（待开工）**：

| 动作 | 目标 |
|---|---|
| 发布门 `EXPORT_BLOCKING_CODES` → `publishBlockedBy` 语义判据 | 021（按码白名单 → 按「公开面有 degraded 且申报过契约」阻断） |
| `resolvePublicType` 成为类型来源唯一优先级格 `declared > join(observed) > degraded` | 007 / 014 / 033 |
| `ModuleForm` 一等容纳 CJS `export =`；`PublicName` 挡住 `_p0` | 008 / 030 |
| binder 裸 catch 降级 → `degraded(nudo:contract-load)`，禁止静默 `any` | 018 + 003 / 025 的 fail-open 半边 |
| **键纪律还债**：Evidence 纳入 `analysisFileCacheKey` / `fnDepSeg` | 切片 1 推迟项；D2 首次进入分析结论时同步做 |
| 诊断码按 §10 决议 2 复用现有码 | 不新增用户可见码，不动 website / i18n / 诊断快照 |

验收：金标 `check-recall-gold` / `check-gold`、真实包零 FP、差分语料、`verify:examples`、全量 `pnpm run test`、缓存键回归（两档不互串）。D2 首次进入分析结论会改变缓存命中与部分诊断 ⇒ 留基线、逐面切；`cli-semantics.md` 仅在动到 `any` / `unknown` 显示时同 PR 更新（阶段 2 前必改）。

**欠账处理**：

- `docs/design/limitations.md` §1.4 已登记「索引面 ↔ service 普查面」的迁移期口径差异（BUG-016 / 017 / 023 / 024），带关闭条件、不设白名单，履行 §10 决议 4。
- 切片 1–3 目前仍在同一个工作树，未按 §7「每面一个 PR」拆成独立提交边界；git 提交 / 拆分需用户另行决定，本轮不擅自 commit。

**之后**：D3 的 dts → LSP → export 逐面切换（每面切完删对应孪生实现）→ 阶段 2 三条不变量断言（先 warning）→ 阶段 3 删旧（含 fallback 开关与 `idx0` 档）。

---

## 18. 阶段 1 · 切片 4.1 实施记录（2026-11-15）

**范围**：按 §17 决议让 D2 首次靠近产品面，但**只做影子双读 + 留基线**：不切换发布门判据、不改任何诊断 / 退出码 / 产物、不把 Evidence 放进缓存键。这是「先影子、留基线、逐点切」的第一步，可独立 revert。

| 改动 | 文件 |
|---|---|
| Evidence 跨包只读面 | `core/src/internal.ts` 暴露 `declaredOf` / `observedOf` / `degradedOf` / `resolvePublicType` / `publishBlockedBy` + `Evidence` / `PublicName` / `ModuleForm` 类型；`.` 产品面零改动。`core/public-api.snapshot.json` 的 internal 面 values 210 → 219、types 36 → 41（决议 3 快照门禁第四次生效） |
| 影子判据 | 新增 `core/src/algebra/diagnostics/evidence-shadow.ts`：`comparePublishGates` 把「按码白名单」与 `publishBlockedBy` 对照，产出 `byCode` / `degraded` / `lostByCodeFilter` / `semanticIfDeclared`；`setPublishGateShadow` 默认关闭、`takePublishGateShadow` 消费式读取 |
| 产品面接线 | `nudojs/src/commands/export/diagnostics.ts`：`checkFaceIssues` 额外返回**过滤前**的原始诊断（同一数组引用、零拷贝），`collectExportDiagnostics` 末尾一行 `recordPublishGateShadow([rawCheck, result.diagnostics], EXPORT_BLOCKING_CODES)`。开关关闭时只做一次布尔判断 ⇒ 发布门热路径零分配 |
| 真源 / 发布 | `kernel-merge.md`「绑定索引层」补「证据层（切片 4.1）」一条：影子阶段 Evidence 未进分析结论 ⇒ 不纳入 `analysisFileCacheKey` / `fnDepSeg`；changeset 追加说明；`docs/README.md` 与 en/zh notes 状态改「阶段 1 切片 4.1」 |
| 测试 | 新增 `core/.../evidence-shadow.test.ts`（4 例，纯函数与开关）、`nudojs/src/__tests__/export-publish-gate-shadow.test.ts`（4 例，逐字钉住现行发布门行为） |

**留基线实测**（`nudojs` 基线测试，注入 `contract-conflict` / `internal` / `unknown-inference` 三条诊断）：

```text
现行 entries = [nudo:contract-conflict]        blocking = true
影子 byCode = [nudo:contract-conflict]
影子 lostByCodeFilter = [nudo:internal, nudo:unknown-inference]   ← BUG-021 缺口
影子 semanticIfDeclared 含 nudo:internal / nudo:contract-conflict
开启影子后 entries / blocking / contractLoad / conflicts 逐字不变
```

**关键决策**：

1. **不设白名单**：`lostByCodeFilter` 如实列出被 `toExportDiagnostic` 丢掉的降级诊断，不做豁免、不设 CI 失败门槛（§10 决议 4）。这正是切片 4.2 要修的清单。
2. **复用现有诊断码**：降级证据族取 `contract-load` / `contract-param-mismatch` / `contract-conflict` / `internal` / `unknown-inference`，按来源分派，不新增用户可见码（§10 决议 2）；`EXPORT_BLOCKING_CODES` 本身仍是三族，影子不扩张它。
3. **键纪律继续推迟**：影子阶段 Evidence 只产生观察数据、不进入分析结论，此刻塞进缓存键无语义作用且增漂移风险；切片 4.2 首次切换判据时同步补 `analysisFileCacheKey` / `fnDepSeg`。
4. **「申报过契约」的真源未在本切片解决**：`semanticIfDeclared` 是 `publishBlockedBy(e, true)` 的对照档，不代表当前文件真的申报过契约。切片 4.2 必须从 `effectiveContract`（`refine-derivation.md:24` 的唯一读取口）取真值，不得用源码正则近似。

**验收**（串行执行，避免重负载相互干扰）：

| 项 | 结果 |
|---|---|
| `pnpm run build` | ✓ 全包构建成功（Evidence 只读面进 dist） |
| `pnpm run lint` | ✓ `tsc --noEmit` 无错 |
| `node scripts/check-core-subdomains.mjs` | ✓ 顶层 43/43、子域合规 |
| 相关 vitest（4 文件，含 `public-api-freeze` 全项） | ✓ **25/25** |
| 全量 `pnpm run test` | ✓ **1772 文件 / 18065 passed / 0 failed**（1 expected fail、7 todo） |
| `docs-coverage.test.ts` | ✓ 46/46（ADR 与 en/zh 索引页状态同步） |
| `pnpm run verify:examples` | ✓ 254 checks / 0 failed |
| `pnpm run test:fs-input` | 15/16 文件、224/225 通过；唯一失败仍是 `dx-metrics-publication` 的 tsx `time-to-green` sanity（28.1 s ≥ 10 s）。**同一用例在全量 `pnpm run test` 中通过**；直跑 `dx-metrics.mjs` 显示 `dist` 口径 979 ms、两口径 `fixRate === 1`、`uptime` load average 6.1 / 5.7 / 6.6 ⇒ 与 §13 / §15 / §16 同类的机器负载噪声，非回归 |

**切片 4.2 入口**：把发布门从按码白名单切到 `publishBlockedBy`（`hasDeclaredContract` 由 `effectiveContract` 取真值），同时补 Evidence 缓存键；基线测试中「零行为变更」断言按预期改为变更记录。之后才是 `resolvePublicType` 优先级格（007/014/033）、`ModuleForm` / `PublicName`（008/030）、裸 catch → `degraded`（018）。

---

## 19. 阶段 1 · 切片 4.2 / 4.3 实施记录（2026-11-15）

**范围**：把 export 发布门从「按诊断码白名单」切到**语义判据**（ADR §10 决议 2、§4 D3）。

判据（唯一一处）：

```text
公开面存在降级证据 ∧ 用户申报过契约 ⇒ 阻断
```

「申报过契约」的真值有两处，都来自契约解析本身，**不读源码字符串**：

1. **签名面 provenance**：`generalize` 解析 `effectiveContract` 时顺带把 `source`
   （`handwritten` / `generated`）带到 `PolyFn.contractSource` → `NudoSig.contract`。
   零二次解析、零额外遍历。
2. **契约面诊断**：`contract-load` / `contract-param-mismatch` / `contract-conflict` /
   `contract-syntax`。这些码**只可能**由「申报了契约」产生，因此也是申报证据。
   ② 是覆盖率的关键——契约**解析失败**时 ① 必然拿不到 provenance（BUG-021）。

| 改动 | 文件 |
|---|---|
| 申报真值随签名面走 | `core/.../generalize.ts`（`PolyFn.contractSource`）、`check/check-report.ts`（`NudoSig.contract`）、`check/check.ts`（两处 push 点） |
| 降级证据族补 `contract-syntax` | `core/.../diagnostics/evidence-shadow.ts`（`DEGRADED_CODES`） |
| 上屏面不再按码丢弃 | `nudojs/.../export/diagnostics.ts`：`toExportDiagnostic` 保留「阻断族 ∪ 降级族」 |
| 阻断改成语义门 | 同上：`blocking = declaredContract && degradedOnSurface.length > 0` |
| 迁移期开关删除 | `publishGateEnabled` / `setPublishGate` 一并移除——两档并存是漂移源，判据只留一处 |
| 出口 / 快照 | internal values 222 → 220（删两个开关） |

**有意的行为变更**（不是回归）：

- `nudo:contract-syntax` 从此阻断：`nudo export` 在这些文件上 exit 1、不写产物、
  诊断上屏（BUG-021 的复现命令已实测：`warning: [nudo:contract-syntax] …` + exit 1）；
- 申报过契约的入口出现 `nudo:internal` / `nudo:unknown-inference` 也阻断（此前只上屏）；
- **未申报契约**的纯推导文件不受影响：降级只上屏、不阻断——否则每个无注解文件
  都会因推断失败而无法发布。

**为什么不复用 `stripStringsKeepComments(source).includes("@nudo:contract")`**：它把
注释/文档里的字样当成申报，§18 决策 4 已明确禁止；本轮改为「解析结果即真值」。

**验收**：

| 项 | 结果 |
|---|---|
| `pnpm run build` | ✓ |
| `pnpm run lint` | ✓ |
| `public-api-freeze` | ✓（internal values 220，types 41） |
| `export-publish-gate-shadow` / `evidence-shadow` | ✓ 14/14（含 BUG-021 的 `contract-syntax` 阻断、申报×降级四象限） |
| `cli-bug-233` / `cli-bug-621` / `cli-bug-628` | ✓ 24/24 |
| BUG-021 端到端 | ✓ `export` exit 1、零产物、`contract-syntax` 上屏 |

**下一步**：`resolvePublicType` 优先级格（007/014/033）与 `ModuleForm`（008）——
两者都在 `dts-generator.ts`，一起改才不会在投影器里重复写一遍优先级。
