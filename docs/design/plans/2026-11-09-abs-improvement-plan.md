# Abs 改进计划（16 项）

> **状态**：~~草案（2026-11-09）。16 项均未作为本计划立项；各项「现状」列出的底层能力可能已部分存在。~~
> **现行（2026-11-10）**：`ABS-01`…`ABS-11` 已交付（每项独立提交 + 测试 + changeset）；**`ABS-14` 已交付（`[x]`）并完成两轮续作**（两组基线红、三条通道、PR4b、零 FP 复核；2026-11-11 修复 `TypeParam.bounds` 变量空间），口径与残余见 §5；`ABS-16` 第①步（真实 monorepo 基准）已交付（`[~]`），②③仍待拍板；`ABS-12` / `ABS-13` / `ABS-15` 仍待拍板。
> **拍板（2026-11-10）**：立 `ABS-14`，但只准简单条件 + 单向依赖，先走三条保守通道；先建等价性门禁；摘要缓存只留一套。四条约束的落地口径见 §5「决策」。
> **删除线约定**：`~~…~~` = 已交付。§1 总表项名、§0 / §2 的历史排期、§3 / §4 各节标题已划掉；其下「现状 / 改动 / 验收」保留为**历史正文**（交付后不作现行口径），按 `docs/README.md` 后续删除，证据在测试 / changeset / git。§7 / §8 对已交付项的机制引用仍有效，不划掉。
> **性质**：排序与验收清单，不是架构契约；真源冲突时以真源为准。
> **真源**：架构 → [`../kernel-merge.md`](../kernel-merge.md)；限制 → [`../limitations.md`](../limitations.md)；
> 求值 → [`../evaluation.md`](../evaluation.md)；契约 → [`../refine-derivation.md`](../refine-derivation.md)；
> 缓存 → [`../persistent-cache.md`](../persistent-cache.md)。
> **纪律**：单轨 Abs；不新增第二 IR；不改变 C0 / L2 / `unknown` 语义；任何影响 `leqAbs` / check 的改动必须过金标与真实包零 FP。
> **术语**：全仓已统一用 **contract**；仅 TypeScript `interface` 关键字、Babel AST `TSInterface*`、历史发布记录保留旧词。
> **生命周期**：按 `docs/README.md`，计划交付后删除正文；证据留在测试、CHANGELOG 与 git。本轮按审阅要求先以删除线标记，删正文属后续动作。

---

## 0. 结论先行

- ~~**最先启动（可并行）**：`ABS-01`（约束/引理文法）、`ABS-02`（unknown/any 来源）、`ABS-05`（缓存键 conf 审计）。~~
- ~~**随后**：`ABS-04`（test 观测面）、`ABS-03`（dts 投影）、`ABS-06`（内建一致性门禁，长跑项可并行）。~~
- ~~**内核批次**：`ABS-07` → `ABS-08`，并与 `ABS-09` / `ABS-10` / `ABS-11` 分域推进。~~
- **战略项**：`ABS-14` 已交付并完成续作（2026-11-10，口径与残余见 §5）；`ABS-16` 第①步是**纯测量、零风险**，已先做（2026-11-11，见 §5）；`ABS-12` / `ABS-13` / `ABS-15` 与 `ABS-16` 的②③（分析结果落盘 / worker 并行）先拍板再开工。
- **本轮（2026-11-10）**：`ABS-14` 已交付、状态 `[x]`（PR0–PR4 共 5 个 commit）；**续作**再修两组基线红、启用另两条保守通道、落地 PR4b、单独复核金标零 FP（见 §5「交付与续作」）；剩余 4 项待拍板；另需归口已交付项在状态列备注中明确延后的子项（见 §1）。
- **续作二（2026-11-11）**：修掉上一轮如实留下的 `TypeParam.bounds` 恒空缺陷（Pred 变量空间对齐 + 集成验证），并订正 `attachHofSnapshot` 的误判；见 §5「交付与续作」末段。
- **多态分工**：手写契约面只用 `ABS-01` 的 binder / ref；引擎侧 α 与界归 `ABS-14`；两者都不引入用户可写的类型参数。
- **不做**：从 body AST 发明契约义务、把 `unknown` 当 `any`、追完整 TS 泛型/HM、无隔离宣称 sandbox、追求内建 100% 覆盖、无指标重写 Shape。

## 1. 总表

| # | ID | 项 | 优先级 | 规模 | 依赖 | 状态 |
|---:|---|---|---|---|---|---|
| 1 | `ABS-01` | ~~约束/引理文法补齐~~ | P0 | M–L | — | [x] |
| 2 | `ABS-02` | ~~`unknown` / `any` 来源可解释~~ | P0 | M | — | [x] |
| 3 | `ABS-03` | ~~dts / schema 投影补全~~ | P0 | S–M | — | [x]（重载 arm 投影已落地；声明级 overload 喂入仍待 harvester 侧立项） |
| 4 | `ABS-04` | ~~`test` 观测面改善~~ | P0 | S | — | [x]（`--both-paths` 保持 opt-in；自动合并以可发现性提示落地） |
| 5 | `ABS-05` | ~~`conf` 与缓存键审计~~ | P0 | S | — | [x] |
| 6 | `ABS-06` | ~~内建一致性门禁~~ | P0 | L（长跑） | — | [x]（首版矩阵 70 探针；扩矩阵是持续动作） |
| 7 | `ABS-07` | ~~Pred 蕴含判定升级~~ | P1 | L | `ABS-01` | [x]（sound 子集：序闭包 / 平方下界 / DNF / oracle 缓存） |
| 8 | `ABS-08` | ~~自动循环不变量推断~~ | P1 | L | `ABS-01`、`ABS-07` | [x]（阶段一：info-only 候选，不参与证明） |
| 9 | `ABS-09` | ~~递归类型 coinductive `leq`~~ | P1 | M | — | [x] |
| 10 | `ABS-10` | ~~摘要式模块化分析~~ | P1 | L | `ABS-05` | [x]（保守起点：纯上下文跨实例后置摘要） |
| 11 | `ABS-11` | ~~contract 合取与 union 精度~~ | P1 | M | `ABS-01` | [x]（判别式穷尽性 warning 延后：零误报优先） |
| 12 | `ABS-12` | 沙箱 / 隔离执行 | P2 | L | — | 待拍板 |
| 13 | `ABS-13` | 真挂起 / CPS | P2 | XL | — | 待拍板 |
| 14 | `ABS-14` | ~~有界参数化摘要~~ | P2 | L | `ABS-10`、`ABS-11` | [x]（2026-11-10 交付：PR0–PR4 共 5 个 commit；续作已完成两组基线红 / 三条通道 / PR4b / 零 FP；2026-11-11 补齐 `TypeParam.bounds`，见 §5） |
| 15 | `ABS-15` | Shape / facets 治理 | P2 | M–L | — | 待拍板 |
| 16 | `ABS-16` | 规模验证与签名缓存 | P2 | L | `ABS-05`、`ABS-10` | [~]（2026-11-11 第①步真实 monorepo 基准 + 命中率实测已交付；②分析结果落盘 / ③worker 并行仍待拍板，见 §5） |

规模为工程体量标签（S / M / L / XL），不是时间承诺。

## 2. 波次与依赖

### ~~Wave 1 — 低风险增强（P0）~~

~~顺序建议~~ — **已全部交付**（`ABS-05` → `ABS-02` → `ABS-04` → `ABS-01` → `ABS-03` → `ABS-06`；证据见 git `ABS-*` 提交）：

1. ~~`ABS-05`：先审计缓存键，给 `ABS-10` 留干净前提。~~
2. ~~`ABS-02`：来源可解释，后续所有内核项的调试基础设施。~~
3. ~~`ABS-04`：观测面先顺，验收其他项时更容易看清行为。~~
4. ~~`ABS-01`：用户可写约束补齐，释放已有 Pred/Term 能力。~~
5. ~~`ABS-03`：投影补全，依赖 A6 已闭环的重载承载位。~~
6. ~~`ABS-06`：与上述并行启动，按矩阵逐项收敛。~~

### ~~Wave 2 — 内核增强（P1）~~

- ~~`ABS-07` 先行：蕴含判定是 `ABS-08` 的基础。~~
- ~~`ABS-08` 与 `ABS-09` 可并行（循环域 / 递归 `leq` 互不共享表示）。~~
- ~~`ABS-10` 在 `ABS-05` 后开工；`ABS-11` 在 `ABS-01` 后开工。~~
- ~~`ABS-01` 的 binder / ref 与 `ABS-11` 的「契约 × 关系合取」是二者共存的前提；`ABS-14` 在此之前不开工。~~

> 仍有效的纪律：任何一项触及 `leqAbs` 的改动，独立分支 + 独立回归基线。

### Wave 3 — 战略项（P2）

- `ABS-12` 与 `ABS-13` 是产品级决策，不默认开工。
- ~~`ABS-14` 在 `ABS-10` 有稳定摘要、`ABS-11` 的契约 × 关系合取定稿后再评估~~ —— **2026-11-10：前置齐备、已拍板并已交付**（简单条件 + 单向依赖 / 三条保守通道 / 等价门禁前置 / 单套摘要缓存，口径见 §5）。
- `ABS-15` 可增量做治理，不做大重写 —— **2026-11-10 订正：属内部工程质量，建议不卡「产品级拍板」，转常规 backlog**。
- `ABS-16` 依赖 `ABS-10` 的摘要命中数据与 `ABS-05` 的键口径 —— **2026-11-10 订正：`fnSummaryStats()` 已提供命中数据；L1 条目签名已落地（见 §5 订正）**。**2026-11-11：第①步真实仓基准已落地并把命中率做成实测口径**（见 §5 / §7）。

## 3. P0：低风险增强

> **本节与 §4 的 `ABS-01`…`ABS-11` 各节均已交付**（标题划掉）。其下「现状 / 改动 / 验收」是立项时的历史正文，多处描述已与现行引擎不符，不作口径依据；现行行为以测试 / changeset 与真源为准。

### ~~ABS-01 约束/引理文法补齐~~

**现状**（2026-11-10 核查）：

- `Pred` 已支持 `eq` / `ne` / `lt` / `le` / `gt` / `ge` / `and` / `or` / `not` / `typeof`；`Term` 已支持 `get` / `length` / 算术等 `app` 节点；多变量 `Pred` 已在生产参与证明（`@nudo:assume d <= max`）。
- 用户面明显更窄：`@nudo:assume` 只接受 `<name> <= <name>` / `>=`；`@nudo:invariant` 只接受 `<name><path> <rel> <number>`；侧车构建器以单参数为主。
- 结果：`i <= n`、`i + 1 <= n`、`return > x` 这类关系无法写进契约/引理，循环证明只能靠数值界或手写 `@nudo:assume`。
- **依赖返回写不出来，但引擎已经算得出来**（2026-11-10 实测）：`f(x) = x + 1` + 侧车 `fn({ x: number().ge(0) }, number().ge(2))` 报 `return ⊭ number().ge(2)`，同一行的 `actual` 却已给出 `number = (x + 1) where (x + 1) ≥ 1 #path` —— 关系在 Abs 里，契约语法没有位置写它。`@nudo:assume return >= x` 被 `nudo:assume-invalid` 拒绝（只收 `<param> <=|>= <param>`）。
- `.shift(n)` **不是关系**：只平移常数界（`shiftBoundPreds` 仅接受 `gt/ge/lt/le` 的数值字面量，`constraint.ts:304-315`）；`nudo contract --emit` 用它把关系折算成常数界写回侧车（`docs/examples/contract-derivation/add.nudo.js` 的 `x.shift(2)` = 「返回 ≥ 3」）。
- 约束树是**纯数据**（`NudoConstraint` 在公共面 `packages/core/PUBLIC_API.md:73`）；唯一闭包槽是 `lazy`（`constraint.ts:455`，仅递归模板 + depth 预算 + 显示 `…`，不参与推导）。`instantiateConstraint` 只支持单槽（`constraint.ts:983`），`instantiateOnTerm` 已能把 `self` 换成任意 `Term`（`:1049`），`constraintOnTermAbs` 是 `constraint → Abs` 单向（`:1241`）。
- 今天的临时写法：`any()` 是「无义务」槽，`array(any())` / `fn({ x: any() }, any())` 是当前唯一能表达「元素域无关」的契约形态；代价是契约覆盖关系后 dts 退化为 `unknown[]`（见 `ABS-11`）。同文件只写 `@nudo:throws` 时关系保留：`nudo contract --draft` 的符号摘要给出 `(items: arr(A1), transform: (T1) => B:transform, filter: (A1) => boolean) => arr(B:transform)`，dts 投 `<A1, …, B_transform>`。

**改动**：

1. 扩展 `AssumeSeg` / `InvariantSpec` 的文法与实例化，允许参数/顶层局部变量、常量、简单算术表达式。
2. 允许 `@nudo:contract return` 引用参数名，形成 dependent return（`return > x`）。证明通道无需改：`checkReturnConstraint` 已走 `assertImplies(ret, constraint, { phi })`（`check/check-return.ts:97-116`），返回 Abs 的 term 就是 `x + 1`。
3. **契约内 binder + ref**（与第 2 条同一机制，一次设计，不开两套）：
   - `bind(name, constraint)` 给槽位一个契约内别名；`ref(name)` 复用它；`ref("i").at("id")` 表达路径投影（`Term` 的 `get` 已在 shape 字段实例化里使用，`constraint.ts:1254`）。
   - `instantiateConstraint(c, paramName)` → 携带 env（`Map<name, Term>`）：首次 `bind` 绑定，其余 `ref` 一律 `leq` 到绑定 Abs。
   - 作用域 = 单条约束树（一个侧车导出），跨导出不复用；同名二次 `bind` 追加 `leq` 义务；`ref` 找不到 `bind` ⇒ fail-closed 诊断，**不得退化成 `any`**。
   - 目标形态（等价于 `<A, B>(items: A[], transform: (x: A) => B) => B[]`）：

     ```js
     export const processItems = fn(
       { items: array(bind("a", any())), transform: fn({ x: ref("a") }, bind("b", any())) },
       array(ref("b")),
     );
     ```
4. 保持 `nudo:assume-invalid` / `nudo:invariant-invalid` / `nudo:contract-param-mismatch` 的 fail-closed 诊断口径。

**验收**：

- 新夹具覆盖 `i <= n`、`i + 1 <= n`、`return > x`、多变量 invariant，以及畸形文法负例。
- 跨位绑定夹具：合法实参通过；回调返回域与返回数组元素域不一致 ⇒ 违约；entry-only（无调用点）只投影不检查。
- 数组域行为必须钉住，不得因 binder 落地而悄悄变红/变绿：`[1, "x"]` 对 `array(number())` 违约、对 `array(union(number(), string()))` 通过、对 `array(bind("i", any()))` 不引入同质门。
- `nudo contract --emit` 产物可写回 `bind` / `ref`（数据形态）；`--draft` 不生成 binder（C0）。
- 公共 API 变更为 additive：`NudoConstraint` 新节点字段 + `PUBLIC_API.md` 与快照同步。
- `docs/examples/constraints/similarity.js`、`levenshtein.js` 不回归；必要时新增示例并同步命令矩阵。
- 影响输出时跑 `pnpm run verify:examples`。

**风险**：文法歧义、用户误以为「写了就成立」；所有解析失败保持诊断，不静默忽略。binder 另有两类风险：作用域/冲突规则不写死会出现「同名不同义」的静默合并；第二参数一旦允许 JS 闭包，会同时破坏 `--emit` 推导、公共 API 快照、dts/schema 投影与 `conjoinOrConflict`（见 §8）。

### ~~ABS-02 `unknown` / `any` 来源可解释~~

**现状**：

- `unknown` 与 `anyAbs` 是单例，签名只显示一个词。
- 已有分散的观测面：`call-budget.ts` 的 `AbsTruncationReason`、`exec/run.ts` 的 `setEvalFallbackCollector`、`member-diag.ts`、`derivation.ts`，但没有统一的“为什么”。
- 用户无法区分：缺 env / 预算截断 / 不支持的构造 / 转译失败 / 无契约入口。

**改动**：

1. 为 Abs 增加可选 `origin` 元数据（纪律同 `pathNote`：**不进 `leqAbs` / `absKey` / 指纹**），或建按对象身份的 trace 旁路；`clone` / `snapshot` / `subst` 明确搬运策略。
2. 汇总现有 collector 为统一 `AnalysisExplanation`：函数、行号、原因、建议。
3. `nudo check --explain-unknown`、LSP hover、`nudo health` 计数（any / unknown 比例、原因分布）。
4. 区分 `any` 来源：无契约入口 / 显式 `any()` / 推断失败。

**验收**：

- 默认输出逐字节不变；`--explain-unknown` 有稳定快照。
- `absKey` / `leqAbs` 不读 `origin`；缓存冷暖结果一致。
- 至少覆盖：预算截断、缺 env、unsupported 构造、转译失败、`any` 入口。

**风险**：元数据搬运遗漏会造成“解释丢失”；用与 `facets` 相同的整包搬运测试纪律。

### ~~ABS-03 dts / schema 投影补全~~

**现状**：

- `docs/design/architecture-debt.md` A6 残余：dts 导出面仍投影 union 签名，**不逐条发射 overload**。
- dts 基本只消费 shape；`term` / `pred` 不进入投影；schema / guard 对数值界的表达有限。
- HOF 泛型投影只做到「形似」（2026-11-10 实测，entry-only `processItems`）：`<A1, A2, A3, B_transform, T1>` 中 `A2` / `A3` 从未被任何形参或返回位引用；`transform` 的 `T1` 与其入参域 `A1` 未统一；除 typeParams 外没有任何 `extends`（`dts-generator.ts:2135-2136`）。有 case 时走 case-widen，写契约时整段退化为 `unknown[]`（`dts-generator.ts:2117` 的「手写契约参数面优先于 HOF 泛型快照」，与 `ABS-11` 相关）。

**改动**：

1. dts 逐条发射 overload arm（声明序 = TS 解析序）。
2. 在 JSDoc 中写入可读约束（`x > 0`、`return > x`），保持“Case:”行为调试注记，不冒充契约。
3. schema / guard 对可表达的下界/上界生成检查；不可表达的关系保持诚实省略。
4. 投影保持单向：分析不读回 dts / schema / guard。
5. 泛型变元的**可达性与统一性**：只发射被形参/返回位引用的变元；回调入参的 α 必须与元素域统一；可表达的界投 `extends`，不可表达时诚实省略。该项**不依赖 `ABS-14`**（修的是投影层，不是摘要层），可先单独落地。

**验收**：

- 对生成的 dts 跑 `tsc --noEmit`；overload 顺序与 TS 解析一致。
- HOF entry-only 夹具的 dts 不再出现未引用变元，元素域与回调入参统一（同一夹具供 `ABS-14` 复用）。
- `emit-*` 夹具与 `tscNoEmit` 端到端测试。
- 投影新增内容不改变 Abs 分析结果。

**风险**：dts 体积与可读性；避免把投影变成第二套类型语言。

### ~~ABS-04 `test` 观测面改善~~

**现状**（`docs/design/limitations.md` §3.2）：

- `@nudo:case` 与 `call@` 默认同轮互斥，`--both-paths` 才同报。
- 递归超过 `callSiteBudget`（默认 3）时，顶层精确见证会被内部记录挤出。
- `reason` 字段已有截断归因，但默认输出不够显眼。

**改动**：

1. 评估把 `--both-paths` 设为默认，或在两路都存在时自动合并并标注来源。
2. 递归场景始终保留最外层精确见证；内部预算只截断内部记录。
3. 输出截断原因与下一步动作（提高 `callSiteBudget` / 用 `@nudo:case` 固化 / 接受 symbolic）。
4. 保持 `--freeze` 与 `--both-paths` 的互斥约束。

**验收**：

- `test` 输出快照；`sumTo(3)` 等递归夹具顶层见证存在。
- `--json` 的 `source: "directive" | "callsite"` 保持可分辨。
- 现有 CLI 测试不回归。

**风险**：教学口径与报告噪声；默认行为变更需 changeset。

### ~~ABS-05 `conf` 与缓存键审计~~

**现状**：

- `key/abs-key.ts` 明确 `absKey = shape + term + pred`，**不含 `conf` / `pathNote`**；需要精确相等的调用方自行比较 conf。
- 缓存层已有 L0 内存、L1/L2 磁盘；`persistent-cache.md` 明确 Abs / AST / evaluator / AnalysisResult 不落盘。

**改动**：

1. 审计所有 memo / fingerprint / 缓存消费方，标注是否依赖 `conf`。
2. 为精度敏感路径增加 `absKeyWithConf`（不替换默认 `absKey`）。
3. 加冷/暖缓存等价测试：同源码、同配置，冷跑与热跑签名/诊断逐字节一致。
4. 若发现依赖 conf 的共享，修消费方而不是扩大默认键。

**验收**：

- 审计表（文件 / 消费方 / 是否依赖 conf / 处理）。
- 冷/暖等价测试；缓存 miss 率不显著恶化。
- 不改变现有 `absKey` 输出（默认键逐字节不变）。

**风险**：键变严格会增加 miss；只对确认依赖 conf 的路径启用。

### ~~ABS-06 内建一致性门禁~~

**现状**：长尾仍有未建模或假精确面，例如：

- 带 callable reviver 的 `JSON.parse` 值域仍保守 `unknown`（`builtins/json.ts`）。
- TypedArray 元素域/长度仍有诚实 unknown（`builtins/error/dispatch.ts`）。
- 模板标签对象的 `Array.isArray` / 数组方法派发在 `iterate.ts` 头注中仍标未建模。
- Intl / Proxy / accessor / descriptor 等面分散在多个 builtin。

**改动**：

1. 建 host-oracle 一致性矩阵：枚举宿主原型方法，原生跑一遍、引擎跑一遍，分类 `modeled` / `unknown` / `wrong-exact`。
2. 接入现有 differential harness 与 host-global drift 探针。
3. **先修 wrong-exact，再补 unknown**；unknown 保持诚实，不为覆盖率造假精确。
4. 产出 `docs/reports/` 覆盖率报告（生成物，不手工改数字）。

**验收**：

- 矩阵报告与基线；covered 集合内 wrong-exact 为 0。
- 新增/修复项有 differential 测试。
- Node 版本漂移只告警/失败可区分。

**风险**：Node 版本差异、矩阵维护成本；以“防假精确”为第一目标，不以 100% 覆盖为目标。

## 4. P1：内核增强

### ~~ABS-07 Pred 蕴含判定升级~~

**现状**（`docs/design/limitations.md` §1.4）：

- 已支持线性形、跨项区间合成、等式类、`ne` 严格界、合取目标分解、and/or 交换律。
- **非线性 / 量词仍故意不完整**；`setImplicationOracle` 只是可选外接 SMT，默认无依赖。

**改动**：

1. 内置 difference logic / octagon 域，覆盖 `x - y <= c` 一类关系。
2. 合取/析取范式化（DNF），减少等价形式漏判。
3. 简单非线性：`x*x >= 0`、单调函数边界；不追完整非线性算术。
4. 可选 SMT 适配器：配置、缓存、反例回传；默认仍 fail-closed。

**验收**：

- 金标 recall = precision = 1.0；真实包零 FP。
- 新增 implication 单元夹具（含反例）。
- 对 `check` 输出做前后对比，确认只减少假红/证不出，不新增假绿。

**风险**：蕴含是门禁本体；任何扩展都需要独立回归基线，不允许“顺手加”。

### ~~ABS-08 自动循环不变量推断~~

**现状**：

- 循环携带界依赖用户写 `@nudo:invariant`，且当前文法只到数值界（见 `ABS-01`）。
- 没有自动 interval/octagon 不动点推断。

**改动**：

1. 在循环 join/widen 位做 interval/octagon 不动点，自动产出 `#path` 前提。
2. 使用 widening thresholds 保证终止；推断结果可被用户 `@nudo:invariant` 覆盖。
3. 复用 `assume-ledger` / `invariant-relied` 的审计口径，标明“自动推断”来源。
4. 与 `ABS-07` 的判定器共享关系表示。

**验收**：

- 循环夹具：累加、字符串拼接、`levenshtein`、嵌套循环；与手写 invariant 结果对比。
- 终止性测试：大循环/振荡不超预算。
- 不新增假绿；新增 `#path` 需有 sound 依据。

**风险**：widening 不 sound 会直接造成假绿；先只开 info/warning，稳定后再参与门禁。

### ~~ABS-09 递归类型 coinductive `leq`~~

**现状**：

- `packages/core/src/algebra/leq.ts` 在 `depth > 32` 时直接 `fail("leq depth exceeded")`。
- `format` 与 `absKey` 已能处理环；表示层支持递归，判定层不支持。

**改动**：

1. `leqAbs` 用 `(src, tgt)` 对 memo 做 coinductive 判定；深度上限只作兜底。
2. 处理递归对象、递归数组/元组、递归 brand 内层。
3. 增加“同构但不同对象身份”的递归夹具。

**验收**：

- 递归树/链表夹具不再深度失败。
- 真实不匹配仍能报出最短反例路径。
- 无限递归保护测试。

**风险**：coinduction 可能把“假设成立”当证明；用正反夹具与金标约束。

### ~~ABS-10 摘要式模块化分析~~

**现状**：

- 多态主要靠逐调用点用实参集合重跑 callee body。
- `docs/design/hof-relations.md` 明确没有跨文件自动归纳，也没有普通函数的 pre/post 摘要缓存；`P3` 调用点经验泛化明确不做。

**改动**：

1. 为函数生成可缓存的 pre/post 摘要（键用 `absKey`，必要时 `absKeyWithConf`）。
2. 调用点优先实例化摘要；摘要不足（例如依赖未建模 body 行为）再跑 body。
3. 跨文件复用摘要；递归用不动点求摘要。
4. 与 `pureMemo` / `checkMemo` / `PolyFn` 的既有缓存分层，避免重复存储。

**验收**：

- 同一文件多调用点、跨文件调用、递归函数的精度与 body 路径等价。
- `benchmark:s1` 冷/暖与 edit 场景不回归；大型夹具调用次数下降。
- 摘要缓存冷暖一致；键漏维度即 miss，不陈旧命中。

**风险**：摘要过粗会丢精度；先以“只在 body 不可用或预算截断时使用摘要”为保守起点。

### ~~ABS-11 contract 合取与 union 精度~~

**现状**：

- `sum` 已有 flatten / dedupe / 16 成员折叠、判别式窄化。
- `contract.ts` 的 `and()` 对 shape / array / union / fn 合取仍 Phase 1 不支持（用户构建器口径）；内部 `conjoinOrConflict` 已做 shape∧shape 字段级、array∧array 元素级合并，其余形态组合「保 prev + `onUndecidable`」而非静默丢弃（`contract/contract.ts:876-984`）。
- 没有 exhaustiveness 诊断；union 字段合并策略分散。
- **契约与关系是互斥而非合取**（2026-11-10 实测）：同一 `processItems` 不写契约时 dts 投 `<A1, …, B_transform>`；写逐参 `array(any())` / `fn(…)` 契约后整段退化为 `unknown[]`。
- 数组元素检查是逐元素独立 ∀（`check/check-case-scan.ts:418-428`）；`arr` 只有一个元素 Abs ⇒ 「所有项同质」类契约在抽象数组上恒真，只有 tuple / 字面量实参才有区分度。
- 「项间相同」口径必须二选一并写死：**join 相等**（`[1, 2]` ✅、`[1, "x"]` ✅，等价于 `array(union(number(), string()))`）或**两两 `leq` 互推**（`[1, 2]` ❌，才叫同质，但与 `T[]` 直觉冲突）。现状默认是前者；本计划不开后者的门（见 §8）。

**改动**：

1. 扩展 `and()` 到非标量形态，保持“矛盾才标 conflict，不矛盾继续执法”。
2. 增加判别式穷尽性 warning（不直接升 error）。
3. 统一 union 字段合并/缺失策略，减少 contract 推导的静默丢字段。
4. 与 `ABS-01` 的契约文法和 `ABS-07` 的判定器共享表示。
5. 契约面与推导关系按**合取**处理（用户申报面 ∧ 引擎关系），冲突才 conflict；写契约不得静默丢掉 HOF 的 β 链接（当前 `dts-generator.ts:2117` 的覆盖策略是要消除的现状）。绑定变元与 `ABS-01` 的 binder 共享表示。
6. binder 合取规则：同名同 binder 合并，异名 / 异形态 conflict；`union` 与绑定元素的合并策略同源（与 `ABS-01` 第 3 条一起设计）。

**验收**：

- contract 推导夹具：shape / array / union / fn 合取。
- 「写契约 / 不写契约」的 dts 关系位不得静默退化（保留，或给出显式诊断说明取舍）。
- `[1, "x"]` 对 `array(number())` / `array(union(…))` / `array(bind(…))` 的行为有回归钉。
- 穷尽性 warning 的正反例；零误报优先。
- 现有 contract / sidecar 测试不回归。

**风险**：warning 噪声；先 info/warning，稳定后评估是否升 error。

## 5. P2：战略项（先拍板）

> **2026-11-10 review**：5 项现状已逐项复核；`ABS-14` 前置解锁、`ABS-16` 签名面已落地（订正见对应现状段）、`ABS-15` 建议转常规治理。评审意见不写回正文（按 §9 纪律）。
> **2026-11-10 决策**：`ABS-14` 已拍板，四条约束落在 §5「决策」段；其余 4 项状态不变。

### ABS-12 沙箱 / 隔离执行

**现状**：`docs/design/kernel-merge.md`「执行模型与信任边界」明确：分析即执行，没有隔离进程；预算不是安全边界。

**改动候选**：

1. 子进程 + Node permission model（限制 fs / net / child_process）。
2. worker + capability allowlist；只读宿主、禁网络。
3. `--no-exec` 声明式模式：只解析 + env/harvest，不做执行式求值。
4. 明确信任级别：`trusted` / `sandboxed` / `static`，报告标注。

**验收**：不可信夹具无法读文件/发网络；性能可接受；默认行为不变。

**风险**：高工程成本与平台差异；**没有真正隔离不得宣称 sandbox**。

### ABS-13 真挂起 / CPS

**现状**：生成器体仍一次跑完；绑定回放已精确，但宿主调用、may-throw 收集等副作用时序未建模；`generator-laziness.md` 明确需要 CPS 级改造。

**改动候选**：continuation-based evaluator 或显式 suspension 协议；先做 effect 时序夹具，再决定是否投入。

**验收**：生成器/async 的副作用顺序与原生一致；现有值域精度不降。

**风险**：XL；只有当日志/IO 顺序成为真实需求时才启动。

### ABS-14 有界参数化摘要

> **状态**：`[x]` 已交付（2026-11-10，5 个 commit，分支 `abs-14`）；两轮续作已完成，等价性门禁两半 + 降级通道独立验证 + 界变量空间对齐集成验证均已接入。残余见本节末「交付与续作」。

**决策（2026-11-10，用户拍板）**：立 `ABS-14`，范围按以下四条收窄；与下方「改动候选 / 验收」冲突时以本节为准。

1. **只准简单条件 + 单向依赖**：`bounds` 只用现有 `Pred` 判得动的词汇（`typeof` / 数值界 / 长度等关系式），秩 1；α–α 只允许按声明序单向依赖；**禁止** β 的界依赖 α 的实例化结果、条件类型 / 映射类型 / `infer` / 高阶多态。必须配负例夹具（改动候选第 2 条按此收窄）。
2. **先走三条保守通道**：快路径只在 ① body 不可用 ② 预算截断 ③ 跨模块复用 时启用；主路径仍以 body 为准，不得默认替换（改动候选第 4 条按此收窄）。命中率与收益仍由 `ABS-16` 度量。**2026-11-10 续作**：三条已全部默认启用（首版只开 `crossModule`，另两条经独立验证后补齐，见「交付与续作」）。
3. **等价性门禁是开工前置**：`快路径 ≡ body 路径` 的返回值 Abs 逐字节一致夹具**先于快路径合入**；没有可跑的对照不得写快路径代码。落地顺序：先固化 body 路径基线（`abs10-fn-summary.test.ts` 已有「清空摘要后重跑 body 逐字节一致」的写法，可在其上扩展，不必从零建）→ 快路径同批接入同一夹具 → diff 为空才允许启用任一保守通道。§7 该指标来源在快路径接入前记为「body 半已建 / 快路径 diff 待接」。**2026-11-10 进度**：body 基线半已建 —— `packages/core/src/algebra/__tests__/abs14-equivalence-baseline.ts`（共享夹具：7 个样本 + `runBodyPath` + `diffAgainstBodyBaseline`）与 `abs14-equivalence-baseline.test.ts`（11 用例全过，`lint` / `lint:tests` / `lint:hygiene` 通过）；快路径执行器尚未存在，接入点已预留。**2026-11-10 交付订正**：快路径已在 PR3 落地（`key/summary-fastpath.ts`），`abs14-fastpath.test.ts` 调用 `diffAgainstBodyBaseline` 逐条 `equal`，门禁两半均已接入。
4. **摘要缓存只留一套**：`key/fn-summary.ts`（`ABS-10` 的「每实例一份 post」Map）与新摘要层**不得并存两个跨实例摘要缓存**。落地方式二选一并在实现 PR 写明：① 把 `fn-summary` 演进为本项摘要的唯一存储（条目扩展为 `⟨formals, bounds, pre, post, eff⟩`，保留其键 / 4096 上限 / `fnSummaryStats` / `resetFnSummaryCache` 失效钩子）；② 以新层替换并删除旧 Map。**倾向 ①**（少一次迁移、失效口径不分裂），但实现时可改选，唯一硬要求是单套。`instMemo` / `pureMemo` / `checkMemo` 属既有分层，不算「第二套摘要」，但不得重复存储 post。

**降级通道门禁口径（2026-11-10 续作细化）**：`crossModule` 仍是「快路径 ≡ **当前** body 路径」（`diffAgainstBodyBaseline`）；降级通道的当前 body 路径本就没有结论，等价对象改为「≡ **同函数 body 可用时的真实结论**」，两者都不得一侧更宽。独立验证 = `abs14-degraded-channels.test.ts`。

**开工条件（2026-11-10 已满足）**：第 3 条门禁两半已接入；第 4 条选型（原地扩展 `fn-summary` 为唯一存储）写在 PR1/PR3 提交说明；`TypeParam.bounds` 的 additive 口径已同步 `PUBLIC_API.md`（快照只记导出符号，无需改 JSON）。

**现状**（2026-11-10 核查）：

- `hof-relations.md` 明确不做用户可写 `<T,U>`、条件类型、`infer`、完整 HM；`A1` 只是展示层，多态靠调用点实例化（`hof-relations.md:24`、`:98`、`:99`）。
- 已有半成品：`PolyFn.symbolic`（一次符号跑的结果）、`fnRels` / `entryShapes` / `hofSites`（`generalize.ts` 的 `PolyFn` 字段）；同一 `PolyFn` 上按「α 规范化实参 + Φ」缓存实例化（`instMemo`）。
- 但 `TypeParam = { id, value }` **没有界字段**（`generalize.ts` 的 `TypeParam`）；`instantiate: (args, phi) => run(args, phi)` 每次实例化**重跑 body**（`instantiate` → `run` → `runCore`）；摘要不是可跨模块复用的一等对象。**行号锚点 2026-11-10 改为符号名**，避免开工时按旧行号找错位置。
- dts 只投裸泛型、无 `extends`（`dts-generator.ts:2135-2136`），且存在变元可达性 / 统一性缺陷（已在 `ABS-03` 第 5 条立项，不阻塞也不依赖本项）。**2026-11-10 订正**：契约面已修（`abs03-dts-projection.test.ts` 的 `<a, b>` 与 ghost 剔除），但纯 HOF entry-only 仍投出未被使用的 `A2`（重新 `pnpm run build` 后 `export --format dts` 实测 `<A1, A2, B_transform>`）⇒ 本项验收第 2 条的 dts 前置只完成一半。
- **2026-11-10 订正**：`ABS-10` 已交付 `key/fn-summary.ts` —— 跨 `PolyFn` 实例的「后置 Abs + α 顺序」缓存（键含 `absKeyWithConf`，仅纯上下文；`fnSummaryStats()` 提供命中数据）。它是「每个抽象实参集合一份 post」，**不是**本项定义的 ∀α 带界闭包。**2026-11-10 已拍板**：本项与 `fn-summary` 不得并存两套摘要，选型口径见本节「决策」第 4 条。

**定义**（本项落地时的口径，不是对外契约）：把摘要从「每个抽象实参集合的实例」提升为「每个函数一份的 ∀α 带界闭包」——
`summary = ⟨formals(α), bounds(α), pre, post, eff⟩`，调用点做 `unify → 界检查 → substAbs(post)`，界满足时**不重跑 body**。

> 以下为立项时的完整设想；第 2、4 条已由 2026-11-10 决策收窄，落地以本节「决策」段为准。

**改动候选**：

1. 摘要成为一等对象：`{ formals(α), bounds, pre, post, eff, provenance }`；键 = 函数身份 + 依赖指纹（`ABS-05` 口径），实例键 = α 规范化实参 + Φ（复用 `instantiateMemoKey`）。
2. 有界参数化，秩 1：界只用现有 `Pred` 词汇（`ABS-01` 补齐后含关系式）；α–α 只允许按声明序单向依赖；不引入条件类型 / 映射类型 / `infer` / 高阶多态。
3. 实例化有界：单次实例化 = 一次 `substAbs` 遍历 + 界检查，深度 / 宽度 / 展开次数有固定预算；界不成立只允许三种结局 —— widen 摘要 / 回退 body / `unknown`，**不得静默放宽**（与 `hof-relations.md:101` 的「无信息仍 unknown」同口径）。
4. 与 `ABS-10` 分层：摘要只作为 body 不可用 / 预算截断 / 跨模块时的通道（保守起点），命中率与收益由 `ABS-16` 度量；不重复存储 `pureMemo` / `checkMemo` / `PolyFn` 已有内容。
5. 契约侧不新增类型参数语法：手写面只有 `ABS-01` 的 binder / ref，引擎侧 α 由使用观测 + 契约槽位推出（两者共享变量表示与 `subst` 纪律；判定时机不同：契约在调用点，摘要在 callee 一次跑）。
6. dts 投影：变元可达且统一后投 `<A, B>`；可表达的界投 `extends`，不可表达时诚实省略（`ABS-03` 纪律）。

**验收**：

- **代换快路径 ≡ body 路径**：同一函数、同一实参抽象，两条路径的返回值 Abs 逐字节一致（同源⇒同产物式 diff），不得一侧更宽或更窄。**本条为开工前置（2026-11-10 决策），不是完成后的补测**。
- HOF 夹具：`processItems` entry-only 的 dts 变元可达、元素域与回调入参统一（与 `ABS-03` 第 5 条同一夹具）。
- 界不成立时的三种结局各有可观测用例（回退 / widen / `unknown`），冷热缓存一致。
- 单轨 Abs 不破：无新用户语法、Abs 仍 `shape × term × pred × conf`、`leqAbs` 与金标零 FP 不放松。

**风险**：

- 最容易滑向「重造 TS」的形态是 α–α 双向依赖（`β` 的界依赖 `α` 的实例化结果）⇒ 退化为约束求解 / HM；范围必须写死并配负例。
- 摘要成为假绿来源：没有「快路径 ≡ body 路径」门禁不得开工；摘要单方面更宽即等于放松门禁。
- 缓存键漏 `conf` / 依赖 ⇒ 陈旧命中（`ABS-05` 为前置）；摘要跨进程复用另有 `ABS-16` 的信任模型约束。

**实现拆分（PR 分批，2026-11-10）**：

> 原则：每批独立提交、可单独回滚；PR0–PR2 与 PR4a **默认输出逐字节不变**；PR3 是唯一可能改变行为的批次，且必须过等价门禁。串行链 `PR1 → PR2 → PR3`，PR4a 可并行。**实际提交（分支 `abs-14`，未建 PR）**：`6b5b8d05`(PR0) → `2ef6211a`(PR1) → `531c7f2d`(PR2) → `37c89135`(PR3) → PR4。

1. **PR0 · 门禁 body 基线（已建）**
   - 范围：`__tests__/abs14-equivalence-baseline.ts` + `.test.ts`（7 样本 / 11 用例），不碰引擎。
   - 验收：11/11 通过；`lint` / `lint:tests` / `lint:hygiene` 全绿。
2. **PR1 · 缓存单套化 + 摘要数据结构（纯内部）**
   - 范围：`key/fn-summary.ts` 条目从 `{ post, varOrder }` 扩为 `{ formals, bounds, pre, post, eff, varOrder }`，保留键 / 4096 上限 / `fnSummaryStats` / `resetFnSummaryCache`；`generalize.ts` 的 `fnSummaryGet` / `fnSummarySet` 两处调用适配。决策第 4 条的选型（倾向原地扩展为唯一存储）写进 PR 描述。
   - 不做：不新增第二个跨实例 Map；`run()` 仍只读写 `post`；不改 `leqAbs` / `absKey` / conf 口径；不启用快路径。
   - 验收：`abs10-fn-summary.test.ts` 与 `abs14-equivalence-baseline.test.ts` 全绿；`fnSummaryStats()` 口径与失效钩子行为不变；默认输出逐字节不变。
3. **PR2 · 界表示与检查（additive，仍不启用快路径）**
   - 范围：`generalize.ts` 的 `TypeParam` 加可选 `bounds`（只用现有 `Pred` 词汇、秩 1、按声明序单向依赖）；界检查复用 `assertImplies` / `conjoinOrConflict`，不新造求解器；`formatPoly` 按需展示。
   - 负例：β 的界依赖 α 实例化结果、α–α 双向依赖、条件类型 / `infer` / 高阶多态一律拒绝并给诊断。
   - 公共导出 additive 变更 → 同步 `PUBLIC_API.md` / `public-api.snapshot.json`（`packages/core/src/index.ts` 已导出 `TypeParam`）。
   - 验收：负例夹具全绿；界不成立三结局（widen / 回退 / `unknown`）在**界检查函数**层各有可观测用例；默认输出逐字节不变；公共 API 快照只做 additive 变更。
4. **PR3 · 快路径接入三条保守通道（核心批次）**
   - 前置：PR1 + PR2 + 等价门禁快路径半（`diffAgainstBodyBaseline(fastPathPost)`）同批或紧邻落地。
   - 范围：`generalize.ts` 的 `run()`，在 `instMemo` miss 之后、`runCore` 之前插入「摘要命中 → unify → 界检查 → `substAbs(post)`」；复用 `summaryScope` 纯上下文判据与 `instantiateMemoKey`（`key/generalize-key.ts`），键不扩默认 `absKey`。三条通道（body 不可用 / 预算截断 / 跨模块复用）用显式开关，主路径仍以 body 为准。
   - 同批夹具：`diffAgainstBodyBaseline` 接入 7 样本逐条 `equal`；新增跨实例 / HOF / 递归样本；界不成立三结局端到端用例；冷/暖缓存一致。
   - 验收：等价 diff 全空；`runBodyPath` 的 `summaryHits === 0` 仍成立（body 基线不被快路径污染）；金标 recall = precision = 1.0、真实包零 FP；默认输出逐字节不变；`benchmark:s1` 冷/暖/edit 不回归；`fnSummaryStats()` 命中率可观测；changeset + `verify:examples`。
   - **停止条件（硬）**：任一等价 diff 非空、快路径单方面更宽、金标下降、真实包出现 FP、默认输出变化 ⇒ 整批回滚，不合并。
5. **PR4 · 投影收尾与度量文档**
   - 4a（可与 PR1 / PR2 并行，独立文件）：`dts-generator.ts` 的 HOF 签名构造把 `free` 全量 `typeParams.push`，导致 entry-only 仍投未被使用的 `A2`；改用同文件已有的 `reachableTypeParams` 按 `paramsText + returnType` 过滤，夹具钉住过滤后的变元集。投影单向，不改 Abs 分析结果。
   - 4b：可表达的界投 `extends`，不可表达诚实省略（`ABS-03` 纪律），依赖 PR2。**2026-11-10 续作已落地**：`dts-generator.ts` 从契约参数位 `abs.pred` 逐叶翻译（不经 `AnalysisResult`），夹具 `abs14-dts-extends.test.ts`。
   - 4c：`fnSummaryStats()` 接 `ABS-16` 命中率口径；§7 该行来源改为实测；同步 `kernel-merge.md` / `limitations.md` / `hof-relations.md` / `PUBLIC_API.md` / website API 页。
   - 验收：生成 dts 跑 `tsc --noEmit`；`emit-*` 夹具；`verify:examples`（若 dts 输出变化）；投影不改变 Abs 分析结果。

**共用门禁（每批）**：`pnpm run build` → 定向 `vitest`（`--maxWorkers=4`）→ `pnpm run lint` + `lint:tests`；PR3 / PR4b 另跑金标与真实包零 FP；输出变化跑 `verify:examples`；公共导出变化跑快照；用户可见变化补 changeset。

**全局红线**：单轨 Abs；不新增第二 IR；无用户可写类型参数 / 显式实例化；`unknown` 不当 `any`；`absKey` 默认键逐字节不变；`leqAbs` 与金标零 FP 不放松；界不成立不得静默放宽；摘要缓存只留一套；不做跨进程摘要复用（`ABS-16` 信任模型另议）；更新基线 `expectedPost` 必须独立 PR 说明。

**交付与续作（2026-11-10，不隐去）**：

- **三条保守通道已全部默认启用**。`bodyUnavailable` / `budgetTruncated` 抽出为纯函数 `key/summary-fastpath.ts#tryDegradedChannel`，独立验证 `abs14-degraded-channels.test.ts`（9 用例）：替换结论 ≡ 同函数 body 可用时的真实结论；无摘要 / 形状不符 / 界不成立 / formal 数不符 / 变元未映射一律保持 `unknown #opaque`；预算截断样本仍是 `unknown #opaque` 且不写摘要（无假绿）。等价门禁口径据此细化（见本节「降级通道门禁口径」）。两类降级在引擎里都归一成 `unknown #opaque`，故两开关共用同一触发点，待 body 失败原因可观测后再按原因细分。
- **PR4b「界投 `extends`」已落地**。`service/src/emit/dts-generator.ts` 新增 `predBoundLeaves` / `contractTypeParamConstraints` / `typeParamDecls`，从契约参数位 `abs.pred` 逐叶翻译可表达的简单界（`typeof` 基元标签、`eq(var,lit)` 字面量、`or` 全可表达时的联合）；数值界 / 长度 / 否定 / `typeof object|function` 诚实省略，输出与无界基线逐字节一致。夹具 `abs14-dts-extends.test.ts`（7 用例，含 `tsc --noEmit`）。**实现路径**：dts 直接读契约 Pred（与 `TypeParam.bounds` 同源的 `instantiateConstraint` 产物），没有把投影信息塞进 `AnalysisResult`，因此不动 analyzer 参数链与缓存克隆；`reachableTypeParams` 仍只看纯名字。
- **遗留缺陷已修复（2026-11-11）**：`TypeParam.bounds` 此前恒空，根因是两套变量空间未对齐 —— `entryReqs[].pred` 由 `instantiateConstraint(c, paramName)` 生成，self var 是**实参名**（`x`），而界登记处拿 `typeParams[].id`（α 名 `A1`）当 formals 校验，每个 var 都被判 unbound 丢弃。修法：`key/summary-bounds.ts` 新增 `alignSimpleBounds`，先按 `params[i] → ids[i]` 用 `renamePred` 重锚到 α 空间，再由 `collectSimpleBounds` 做「简单条件 + 按声明序单向依赖」校验；binder 名 / 未声明变元 / `app` term 保持原样并 fail-closed 丢弃。`entryReqs` 与 Φ **不改原貌**（展示层 `x > 0` 与 body 单调性传播依赖它），因此默认输出逐字节不变。实测：`fn({x: number().gt(0)})` 的 `typeParams[0].bounds` 从 `undefined` 变为 `[typeof A1 = number, A1 > 0]`，双形参各归 `A1` / `A2`。集成夹具 `abs14-bounds-integration.test.ts`（11 用例：端到端 / 纯函数负例 / `implies` 与快路径界检查的可消费性），反向验证去掉重锚会 8 用例失败。
- **订正一处误判**：上条曾把「`attachHofSnapshot` 不传 `refine`、`entryReqs` 常为 undefined」也列为缺陷，复核后确认是**正确设计**：`service/src/analyzer-abs-eval.ts#attachHofSnapshot` / `tryAttachIntension` 只取 `fnRels` / `entryShapes` / `symbolic` 供 dts 投影与内涵摘要，注入契约会改变 body 语义并破坏 L0 键；无契约时 `entryReqs` 为 undefined、不发明界，符合决策口径。
- **设计边界（不打通，也不该打通）**：`opts.refine` 会让 `summaryScope` 返回 `undefined`（ABS-10：refine 改变 body 语义、闭包身份不可哈希），故带契约的函数不写函数级摘要 —— `TypeParam.bounds` 是 `PolyFn` 的一等元数据，快路径的界另来自调用点 `phi`（`fnLevelFields`），两者不同源、不合并。强行接通会把契约语义塞进跨实例缓存，打开陈旧命中 / 假绿的口子。修出的界已验证可被 `implies` 与 `tryFnLevelFastPath` 的界检查消费，不是死数据。
- **两组基线红已修复（续作）**：
  - ① `Float16Array` / `Intl.DurationFormat` / `URLPattern` 等 Node 22 vs v26 宿主漂移：core `builtin-coverage-floor` 按 `VERSION_SKEW` 跳过已登记缺席 brand；3 个 eval 夹具用 `hostAvailableNames` / `hostNameAvailable` 按 `globalThis` 能力生成用例；env 侧 4 处 oracle（`env-bug-61` / `863` / `865` / `893`）同样按宿主能力过滤或给版本理由；工具链注入的 `__CODEBUDDY_*_SHIM_LOADED__` / `__vitest_*` 按既有纪律登记理由与豁免。**只豁免已登记漂移，未登记的缺席仍硬失败**，支持的宿主上覆盖不缩水。
  - ② `retire-debug/after/src/logger.js` 的 `module evaluation failed: Assignment to constant variable`：根因不是依赖解析，而是转译器把 rest 形参发成 `const args = $restBind(...)`，fork 臂恢复与成员写回却发 `args = ...`（V8 原生 TypeError，真实 CJS 包 `debug/src/common.js` 的 `function debug(...args)` 触发）。`transpile/stmt/statement.ts` 与 `transpile/expr/function.ts` 改发 `let`（原生 rest 本就是可变绑定），回归夹具 `eval-rest-param-rebind.test.ts`（9 用例，已反向验证改回 `const` 会 9/9 全红）。示例 pin / README / 头注释同步：返回面随宿主能否解析到真实 `debug` 包而不同，只钉 `OK` / `0 error` / 导出名，不钉死 `nudo:opaque-result`。
- **PR4a** 已修 dts HOF 签名的悬空 `A2`（`abs14-dts-reachable.test.ts`）；投影单向，不改 Abs 分析结果。
- **门禁复核（续作）**：金标 + 真实包零 FP 单独重跑 3 文件 / 196 用例通过；`lint` / `lint:tests` / `lint:hygiene` / `build` 全绿；`verify:examples` 与全仓 vitest 的最终数字见本节末「最终门禁」。全仓剩余失败里 6 个 LSP/CLI 文件（沙箱临时路径相对化 + watch 时序）已在 `c8aac63d` 干净基线复跑确认是**既有红**，非本轮引入；1 个 env `fsp.stat(throwIfNoEntry:false)` 宿主行为差已适配。**2026-11-12 续作：这两组既有红已全部修复并清零**（见本节末「既有红清零」）。

**最终门禁（2026-11-10 续作，实测）**：

- `pnpm run verify:examples` **250 项全过 / 0 失败**（exit 0）；此前 248/3 → 修 rest 根因并同步 pin / 文档后归零。
- 全仓 `vitest run --maxWorkers=4` **1739 / 1746 文件通过、17829 用例通过**；剩 9 个失败全在 LSP / CLI：8 个已在 `c8aac63d` 干净基线复跑确认同样失败（沙箱把 `/var/folders/...` 临时目录相对化成 `../../../../`、`/private/var` 前缀不一致触发 allowed-roots 拒绝，以及 watch 事件时序），第 9 个是同族 watch 时序 flaky。均非本轮引入，不通过改 pins / 断言掩盖。**2026-11-12 续作已把这 9 个清零**（见本节末「既有红清零」）。
- 金标 + 真实包零 FP 单独重跑 **3 文件 / 196 用例通过**（`check-recall-gold` 186、`check-real-packages` 10、`check-real-commander` 1）。
- `lint` / `lint:tests` / `lint:hygiene` / `build` 全绿；定向夹具：ABS-14 全套 31 + 9 + 7、rest 9、env 317、四个 Float16Array 夹具 130 用例均通过。

**既有红清零（2026-11-12）**：

- **根因统一**：macOS `os.tmpdir()` 返回 `/var/folders/...`，是 `/private/var/folders/...` 的符号链接；内核给 `process.cwd()` / `realpathSync()` 的是 **realpath 形态**，而用户参数与测试夹具拼出的是 `/var/...` 字面值。三类失败都是「两个路径空间混用」。
- **LSP emit 边界**：`assertEmitTargetAllowed` / `resolvedWorkspaceRoots` / `derivedSidecarAllowed` 只对**存在**的路径 realpath，尚未落盘的源文件 / 下游侧车退回 `/var/...` 字面值，与 `/private/...` 的 root 相减被误判「逃出工作区」。三处统一改用 service 的 `normalizeRealPath`（不存在的目标回落「父目录 realpath + basename」）。Bug 766 的 symlink 逃逸夹具仍为红，防护未放松；762 / 765 三个用例转绿。
- **CLI 相对展示**：`relative(process.cwd(), resolve(userArg))` 产出 `../../../../../../../var/.../syn.js`，污染 JSON `file` 字段与人类面文案。新增 `shared.ts#relFromCwd`（先归一目标再相减），contract 的 print / draft / emit / from-dts 四族与 watch 错误行统一走它。`displayPathOf` / `diffPathOf` **故意不动**（承诺「逃出 cwd 回落用户给的绝对路径」），63b 的 check / test / contract 基线逐字不变；661 / 663 / 664 / 63b 四个用例转绿。
- **watch FSEvents 噪声**：macOS 目录级 watcher 会顺带报告同批次**未被触碰**的文件，改 `a.js` 时 `sub/b.js` 也进 `pendingChanged` ⇒ 增量轮重跑两个文件，684 / 685 的「只重跑被改的那个」断言约 1/3 概率失败。去抖窗口按 `(size, mtimeMs)` 指纹过滤（抽为可测的 `watchPathVersion` / `filterUnchangedWatchPaths`）；删除、新建、非 tracked（配置 / 侧车 / env 模板）一律放行。新夹具 `cli-watch-noise-filter.test.ts`（7 用例）；反向验证去掉过滤后 8 次里复现 1 次失败，带过滤 8/8 稳定，全部 12 个 watch 测试文件 / 33 用例通过。
- **诚实边界**：`export/io.ts` 的 `writtenPathLines` / `removed stale` 与 `migrate.ts` 的 workflow 扫描列表仍用裸 `relative(process.cwd(), ...)`；它们不在失败清单，改动会牵动 export pins，本轮**未动**，列为同类待办。指纹过滤的极小概率局限（同毫秒同尺寸二次写入）已写在代码注释里，如实不隐去。
- **最终门禁（串行、无并行构建竞态）**：全仓 `vitest run --maxWorkers=4` **1748 / 1748 文件通过、17856 用例通过（exit 0，1 expected fail / 7 todo 照旧）**；`verify:examples` **250 / 0**；`lint` / `lint:tests` / `lint:hygiene` / `build` 全绿。changeset `.changeset/macos-symlink-path-boundaries.md`（`@nudojs/lsp` / `nudojs` patch）。

**续作二门禁（2026-11-11，界变量空间对齐，实测）**：

- 新夹具 `abs14-bounds-integration.test.ts` **11 / 11 通过**；反向验证（去掉 `renamePred` 重锚还原旧行为）8 用例失败 ⇒ 夹具确实钉住缺陷。
- 定向回归 **12 文件 / 95 用例全过**（ABS-14 全套 + `generalize` / `load-deps-fp-sidecar` / `core-bug-082` / `hof-review-fixes` + dts `extends` / `reachable`）。
- 全仓 `vitest run --maxWorkers=4` **1740 / 1747 文件、17840 用例通过**（比上一轮多 1 个文件 / 11 个用例，即新夹具）；剩余 9 个失败与上一轮**逐条一致**，全是已在 `c8aac63d` 干净基线复跑确认的 LSP / CLI 沙箱路径 / watch 时序既有红，**零新增**。
- `pnpm run verify:examples` **250 / 0**（exit 0）；`lint` / `lint:tests` / `lint:hygiene` / `build` 全绿。
- 输出面未变：`entryReqs` / `display` / `symbolic` 仍是实参名空间，契约路径的 `check` / `export` 输出逐字节不变（定向回归 + 示例验证双重覆盖）。

### ABS-15 Shape / facets 治理

**现状**：`AbsFacets` 是扩展槽，A2 / A8 / A10 / A11 都走它；新能力要么改 Shape 联合，要么加 facet，缺少统一登记。历史上有 `substAbs` 丢 fn impl 的 A7 事故。

**改动候选**：

1. 建 capability registry：每个 facet 声明 `clone` / `snapshot` / `subst` / `absKey` / `join` / `format` 钩子与覆盖测试。
2. 明确提升规则：值语义进 Shape，派生/观察能力进 facets；成熟后再评估提升。
3. facet 键版本化，避免未来语义变化导致旧缓存串台。
4. **不做**无指标的全量 Shape 重写。

**验收**：每个 facet 有搬运/键/join 覆盖测试；公共 API 快照只做 additive 变更。

**风险**：重构成本；可增量做，先治理新增 facet。

### ABS-16 规模验证与签名缓存

**现状**：

- S1 基线是 120 文件合成仓（`docs/reports/s1-perf-baseline.md`），不是真实 monorepo。**2026-11-11 订正**：真实 monorepo 基准已补，见下方「第①步」。
- `persistent-cache.md` 明确 Abs / AST / evaluator / AnalysisResult 不落盘；CheckJson 默认关（投毒面）。
- **2026-11-10 订正**：L1 **条目签名已落地** —— `package.json#nudo.cache.sign: true` + `NUDO_CACHE_KEY` 逐条 HMAC-SHA256，验签失败当 miss、signed/unsigned 键空间分离、密钥轮换 = 全 miss、`sign` 开而密钥缺席拒绝运行（`persistent-cache.md` §启用 / §投毒红线）。⇒ 改动候选第 2、4 条的「签名 / 轮换 / 不可信 runner」已有实现；真正待拍板的是「分析结果（Abs / AnalysisResult）落盘」是否放宽「不落盘」纪律，另缺 worker 并行与真实 monorepo 基准。

**第①步已交付（2026-11-11，纯测量 / 零语义改动）**：

- 复用 `benchmark/s1/bench-monorepo.mts` 既有的 `--corpus <path>` 真实语料分支（edit 相纯内存、绝不写用户文件），新增 `benchmark:s1:real` / `benchmark:s1:real:quick` 两个复现命令；报告落 `docs/reports/s1-perf-baseline-real.{md,json}`，**不覆盖**合成基线。
- 语料 = 本仓真实 pnpm monorepo 检出；> 256 KiB 的打包产物（如 `packages/vscode/server/server.js` 11.9 MB）按「构建输出非源码」跳过并**如实计数**；edit 目标由模块图动态挑 hub / mid / leaf。
- 新增**主机信息**（node / 平台 / CPU / 核数 / 内存 / 峰值 RSS）与**缓存命中率遥测**：`fnSummaryStats()`（ABS-10 实例级）+ `fnSummaryFnLevelStats()`（ABS-14 函数级）按测量窗口取计数 delta，**中途不 reset 缓存**（避免污染 warm 语义）；只在测量前清一次，让 cold#1 真冷；采样 ≥2 次时后续 cold 轮展示摘要层跨 cold 复用（首测用 `--quick` 只采 1 轮，报告会注明未测跨 cold 复用）。
- 服务层文件 / AST / evaluator 缓存**没有计数 API**，只能通过 cold→warm 耗时比观察，报告如实标注；不把两层摘要命中率冒充「全引擎命中率」。
- 新增 `--quick` 低采样档：当前宿主 Node v22 上同一 harness 单次全量 analyze 已达数十秒（v24 基线 1.2s），默认 3/5/3/8/10 次采样要跑 20 分钟以上。默认档采样次数**逐字不变**，quick 只减次数且报告写明各相 `n`。合成语料模式已复跑验证：输出结构（键集合 / 标题 / 段落）零增量。
- **诚实边界**：本仓 `.js` 子集偏向 benchmark fixtures 与 docs 示例，不是典型企业 monorepo 的生产源码；绝对耗时与 Node v24/v26 的 S1 / OSS 基线**不可比**，只与同一语料同一宿主的重复运行比较。本报告只回答「这个检出在这个宿主上花多久、两层摘要缓存命中多少」，不作产品性能宣称。
- 数字见 `docs/reports/s1-perf-baseline-real.md`；§7「缓存命中率」来源已从「缓存层日志」改为该实测报告。

**实测结果与结论（2026-11-11，`--quick`）**：

| 项 | 实测 |
|---|---|
| 语料 | **310 文件 / 0.46 MB / 637 import edges**；跳过 1 个 > 256 KiB 的 bundle |
| 主机 | node **v22.22.2** · darwin arm64 · Apple M4 Pro (14 cores) · 48 GiB · 峰值 RSS 3552 MiB |
| cold / warm / check（中位数） | analyze all cold **102802.63 ms** / warm **34941.39 ms**；check all warm **65936.01 ms** |
| edit dirty（leaf / mid / hub） | 1 / 3 / 106 文件 → **141.75 / 4095.52 / 10504.13 ms** |
| live（单文件 analyze / check） | 44.84 / 46.69 ms |
| 实例级摘要命中（ABS-10） | cold **0 / 1099（0.0%）**；warm #1 **13 / 63（17.1%）**；warm #2/#3 **无查询**；check **3 / 3（50%）** |
| 函数级摘要命中（ABS-14 快路径） | cold **0 / 188（0.0%）**；warm #1 **0 / 60（0.0%）**；其余相**无查询** —— **全程 0 次命中** |

- **对第③块的直接含义**：重复调用几乎全被 service 会话缓存（文件 / AST / evaluator）消化，core 两层摘要的边际命中很低，函数级快路径在本语料上**没有产生任何命中**。⇒ 目前**没有正向收益证据**支持放宽「Abs / AnalysisResult 不落盘」纪律去做跨进程摘要复用或 worker 并行；要评估落盘价值，需另做**跨进程冷启动 / LSP 会话重启**场景的专门基准，而不是沿用本报告。
- **诚实边界（不事后修饰语料）**：本仓 `.js` 子集是混合语料 —— 120 个 `benchmark/s1/.corpus` 合成 fixture、96 个 `benchmark/lsp-rounds/starters-oss-semver` 真实 OSS 源码副本、其余为 docs 示例 / `micro/out` / `.docusaurus` 等生成物；hub 目标恰好落在 `.corpus`。它**不是典型企业 monorepo 的生产源码**。为保持报告可复现，本轮**不修改过滤规则、不重跑改语料**，如实记录构成。
- 采样为 `--quick`（cold 1 / warm 3 / check 2 / edit 3 / live 5），绝对耗时与 Node v24/v26 的 S1 / OSS 基线**不可比**；只与同一语料同一宿主的重复运行比较。当前宿主上同 harness 单次全量 analyze 已达数十秒（v24 基线 1.2s），这是加 `--quick` 的原因，不是引擎回归。

**改动候选**：

1. ~~真实 monorepo cold / warm / edit 基准；记录 Node/CPU/内存。~~ **已完成（2026-11-11，见上方「第①步」）**
2. 在可信 runner 上扩展签名分析缓存；键覆盖源码、依赖、配置、分析 ABI。
3. worker 并行分析；与 LSP 增量缓存分层。
4. 缓存投毒红线：签名、密钥轮换、不可信 runner 默认关闭。

**验收**：~~真实仓库基准报告~~ ✅ 已满足（`s1-perf-baseline-real.md`）；~~缓存命中率~~ ✅ 已实测（同报告 `## Cache hit telemetry`）；**「正确性 / 不可信场景拒绝复用」仍待第②③块**（签名面已实现但缺独立拒绝复用夹具；分析结果落盘需先拍板是否放宽「不落盘」纪律）。

**风险**：缓存投毒与陈旧命中；没有签名/信任模型不做。

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
- 手工核查（先 `pnpm run build`）：`node packages/nudojs/dist/index.js check <file>` 与 `node packages/nudojs/dist/index.js export --format dts <file>`；本文件引用的实测输出均由这两条产生。

## 7. 度量

| 指标 | 用途 | 来源 |
|---|---|---|
| any / unknown 比例与原因分布 | `ABS-02` 的效果 | `nudo health` / check JSON |
| wrong-exact 数量 | `ABS-06` 的正确性 | 一致性矩阵 |
| 金标 recall / precision | `ABS-07` / `ABS-08` / `ABS-09` | core gold suites |
| time-to-green | DX 回归 | `pnpm run dx-metrics` |
| cold / warm / edit | 规模与摘要收益 | `benchmark:s1`（合成 120 文件）/ `benchmark:s1:real`（**真实 monorepo**，报告 `s1-perf-baseline-real.md`） |
| 快路径 / body 路径逐字节 diff | `ABS-14` 的等价性门禁（**开工前置**） | `abs14-equivalence-baseline.test.ts` + `abs14-fastpath.test.ts`（7 样本逐条 equal）；降级通道另见 `abs14-degraded-channels.test.ts`；命中计数 `fnSummaryFnLevelStats()` |
| 缓存命中率 | `ABS-05` / `ABS-10` / `ABS-16` | **已实测**：`s1-perf-baseline-real.json#cacheTelemetry` —— `fnSummaryStats()`（实例级）+ `fnSummaryFnLevelStats()`（函数级）按相取 delta；服务层文件/AST 缓存无计数 API，只见于 cold→warm 耗时比 |

## 8. 不做 / 边界

- 不从 body AST 发明契约义务（C0）。
- 不把 `unknown` 当 `any`。
- 不追完整 TS 泛型 / 条件类型 / HM。
- 不做 `arraySameItem(base, i => project(i))` 这类**闭包式约束**：约束树必须保持可推导（`--emit`）、可投影（dts / schema / guard）、可合取（`ABS-11`）、可快照（公共 API）的数据形态；`lazy` 是唯一闭包槽的既有例外（递归模板 + depth 预算 + 显示 `…`）。
- 不做「从元素 / 实参 Abs 反推约束」（`Abs → NudoConstraint`）：属 C0，且契约由被检查对象自身导出 ⇒ 恒真；只能作 `nudo contract --draft` 的评审证据。
- 不做「项间同质」（homogeneity）契约：`arr` 只有一个元素 Abs ⇒ 恒真；tuple 上要求字面量两两相等会拒掉 `[1, 2]`，与 `T[]` 直觉冲突。跨位共享用 `ABS-01` 的 binder 表达，不用 `same`。
- 不在契约层引入用户可写的类型参数 / 显式实例化（`<T>`、`f<number>(…)`）：`ABS-14` 的 α 由引擎推出，契约侧只有 binder。
- 没有真正隔离不宣称 sandbox。
- 不以内建 API 100% 覆盖为目标；优先消灭 wrong-exact。
- 无指标不重写 Shape 联合。
- 不为 `--from` 注入路径做整报告复用（`persistent-cache.md` 既有边界）。

## 9. 更新约定

- 开工：状态改 `[~]`，补一行锚点（PR / 测试名 / 文档）。
- 完成：状态改 `[x]`，证据写进测试或 CHANGELOG，不写回本表正文。
- 取消：移入「不做 / 边界」或删除并留一行原因。
- 与真源冲突：以 `kernel-merge.md` / `limitations.md` / `cli-semantics.md` 为准，并在发现当次订正本文件。
- **2026-11-11 锚点**：`ABS-16` 第①步交付 = `benchmark/s1/bench-monorepo.mts`（`--corpus` + `--quick` + 遥测）+ `docs/reports/s1-perf-baseline-real.{md,json}` + `benchmark/README.md` / `benchmark/s1/README.md`；②③待拍板。
- **2026-11-10 决策锚点**：`ABS-14` 状态 `[x]`，口径 = §5「决策」段，实现拆分 = §5「实现拆分」，续作 = §5「交付与续作」；提交 `6b5b8d05` / `2ef6211a` / `531c7f2d` / `37c89135` / `c8aac63d` + 续作 3 个 commit + 2026-11-11 界对齐 1 个 commit；门禁 = `abs14-equivalence-baseline.test.ts` + `abs14-fastpath.test.ts` + `abs14-degraded-channels.test.ts` + `abs14-dts-extends.test.ts` + `eval-rest-param-rebind.test.ts` + `abs14-bounds-integration.test.ts`。
