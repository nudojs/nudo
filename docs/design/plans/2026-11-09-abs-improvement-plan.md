# Abs 改进计划（16 项）

> **状态**：草案（2026-11-09）。16 项均未作为本计划立项；各项「现状」列出的底层能力可能已部分存在。
> **性质**：排序与验收清单，不是架构契约；真源冲突时以真源为准。
> **真源**：架构 → [`../kernel-merge.md`](../kernel-merge.md)；限制 → [`../limitations.md`](../limitations.md)；
> 求值 → [`../evaluation.md`](../evaluation.md)；契约 → [`../refine-derivation.md`](../refine-derivation.md)；
> 缓存 → [`../persistent-cache.md`](../persistent-cache.md)。
> **纪律**：单轨 Abs；不新增第二 IR；不改变 C0 / L2 / `unknown` 语义；任何影响 `leqAbs` / check 的改动必须过金标与真实包零 FP。
> **术语**：全仓已统一用 **contract**；仅 TypeScript `interface` 关键字、Babel AST `TSInterface*`、历史发布记录保留旧词。
> **生命周期**：按 `docs/README.md`，计划交付后删除正文；证据留在测试、CHANGELOG 与 git。

---

## 0. 结论先行

- **最先启动（可并行）**：`ABS-01`（约束/引理文法）、`ABS-02`（unknown/any 来源）、`ABS-05`（缓存键 conf 审计）。
- **随后**：`ABS-04`（test 观测面）、`ABS-03`（dts 投影）、`ABS-06`（内建一致性门禁，长跑项可并行）。
- **内核批次**：`ABS-07` → `ABS-08`，并与 `ABS-09` / `ABS-10` / `ABS-11` 分域推进。
- **战略项**：`ABS-12`…`ABS-16` 先拍板再开工；未拍板不排期。
- **多态分工**：手写契约面只用 `ABS-01` 的 binder / ref；引擎侧 α 与界归 `ABS-14`；两者都不引入用户可写的类型参数。
- **不做**：从 body AST 发明契约义务、把 `unknown` 当 `any`、追完整 TS 泛型/HM、无隔离宣称 sandbox、追求内建 100% 覆盖、无指标重写 Shape。

## 1. 总表

| # | ID | 项 | 优先级 | 规模 | 依赖 | 状态 |
|---:|---|---|---|---|---|---|
| 1 | `ABS-01` | 约束/引理文法补齐 | P0 | M–L | — | 未开工 |
| 2 | `ABS-02` | `unknown` / `any` 来源可解释 | P0 | M | — | 未开工 |
| 3 | `ABS-03` | dts / schema 投影补全 | P0 | S–M | — | 未开工 |
| 4 | `ABS-04` | `test` 观测面改善 | P0 | S | — | 未开工 |
| 5 | `ABS-05` | `conf` 与缓存键审计 | P0 | S | — | 未开工 |
| 6 | `ABS-06` | 内建一致性门禁 | P0 | L（长跑） | — | 未开工 |
| 7 | `ABS-07` | Pred 蕴含判定升级 | P1 | L | `ABS-01` | 未开工 |
| 8 | `ABS-08` | 自动循环不变量推断 | P1 | L | `ABS-01`、`ABS-07` | 未开工 |
| 9 | `ABS-09` | 递归类型 coinductive `leq` | P1 | M | — | 未开工 |
| 10 | `ABS-10` | 摘要式模块化分析 | P1 | L | `ABS-05` | 未开工 |
| 11 | `ABS-11` | contract 合取与 union 精度 | P1 | M | `ABS-01` | 未开工 |
| 12 | `ABS-12` | 沙箱 / 隔离执行 | P2 | L | — | 待拍板 |
| 13 | `ABS-13` | 真挂起 / CPS | P2 | XL | — | 待拍板 |
| 14 | `ABS-14` | 有界参数化摘要 | P2 | L | `ABS-10`、`ABS-11` | 待拍板 |
| 15 | `ABS-15` | Shape / facets 治理 | P2 | M–L | — | 待拍板 |
| 16 | `ABS-16` | 规模验证与签名缓存 | P2 | L | `ABS-05`、`ABS-10` | 待拍板 |

规模为工程体量标签（S / M / L / XL），不是时间承诺。

## 2. 波次与依赖

### Wave 1 — 低风险增强（P0）

顺序建议：

1. `ABS-05`：先审计缓存键，给 `ABS-10` 留干净前提。
2. `ABS-02`：来源可解释，后续所有内核项的调试基础设施。
3. `ABS-04`：观测面先顺，验收其他项时更容易看清行为。
4. `ABS-01`：用户可写约束补齐，释放已有 Pred/Term 能力。
5. `ABS-03`：投影补全，依赖 A6 已闭环的重载承载位。
6. `ABS-06`：与上述并行启动，按矩阵逐项收敛。

### Wave 2 — 内核增强（P1）

- `ABS-07` 先行：蕴含判定是 `ABS-08` 的基础。
- `ABS-08` 与 `ABS-09` 可并行（循环域 / 递归 `leq` 互不共享表示）。
- `ABS-10` 在 `ABS-05` 后开工；`ABS-11` 在 `ABS-01` 后开工。
- `ABS-01` 的 binder / ref 与 `ABS-11` 的「契约 × 关系合取」是二者共存的前提；`ABS-14` 在此之前不开工。
- 任何一项触及 `leqAbs` 的改动，独立分支 + 独立回归基线。

### Wave 3 — 战略项（P2）

- `ABS-12` 与 `ABS-13` 是产品级决策，不默认开工。
- `ABS-14` 在 `ABS-10` 有稳定摘要、`ABS-11` 的契约 × 关系合取定稿后再评估。
- `ABS-15` 可增量做治理，不做大重写。
- `ABS-16` 依赖 `ABS-10` 的摘要命中数据与 `ABS-05` 的键口径。

## 3. P0：低风险增强

### ABS-01 约束/引理文法补齐

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

### ABS-02 `unknown` / `any` 来源可解释

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

### ABS-03 dts / schema 投影补全

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

### ABS-04 `test` 观测面改善

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

### ABS-05 `conf` 与缓存键审计

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

### ABS-06 内建一致性门禁

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

### ABS-07 Pred 蕴含判定升级

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

### ABS-08 自动循环不变量推断

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

### ABS-09 递归类型 coinductive `leq`

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

### ABS-10 摘要式模块化分析

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

### ABS-11 contract 合取与 union 精度

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

**现状**（2026-11-10 核查）：

- `hof-relations.md` 明确不做用户可写 `<T,U>`、条件类型、`infer`、完整 HM；`A1` 只是展示层，多态靠调用点实例化（`hof-relations.md:24`、`:98`、`:99`）。
- 已有半成品：`PolyFn.symbolic`（一次符号跑的结果）、`fnRels` / `entryShapes` / `hofSites`（`generalize.ts:690-712`）；同一 `PolyFn` 上按「α 规范化实参 + Φ」缓存实例化（`generalize.ts:1669`）。
- 但 `TypeParam = { id, value }` **没有界字段**（`generalize.ts:685-688`）；`instantiate: (args, phi) => run(args, phi)` 每次实例化**重跑 body**（`generalize.ts:1979` → `runCore` → `invoke`）；摘要不是可跨模块复用的一等对象。
- dts 只投裸泛型、无 `extends`（`dts-generator.ts:2135-2136`），且存在变元可达性 / 统一性缺陷（已在 `ABS-03` 第 5 条立项，不阻塞也不依赖本项）。

**定义**（本项落地时的口径，不是对外契约）：把摘要从「每个抽象实参集合的实例」提升为「每个函数一份的 ∀α 带界闭包」——
`summary = ⟨formals(α), bounds(α), pre, post, eff⟩`，调用点做 `unify → 界检查 → substAbs(post)`，界满足时**不重跑 body**。

**改动候选**：

1. 摘要成为一等对象：`{ formals(α), bounds, pre, post, eff, provenance }`；键 = 函数身份 + 依赖指纹（`ABS-05` 口径），实例键 = α 规范化实参 + Φ（复用 `instantiateMemoKey`）。
2. 有界参数化，秩 1：界只用现有 `Pred` 词汇（`ABS-01` 补齐后含关系式）；α–α 只允许按声明序单向依赖；不引入条件类型 / 映射类型 / `infer` / 高阶多态。
3. 实例化有界：单次实例化 = 一次 `substAbs` 遍历 + 界检查，深度 / 宽度 / 展开次数有固定预算；界不成立只允许三种结局 —— widen 摘要 / 回退 body / `unknown`，**不得静默放宽**（与 `hof-relations.md:101` 的「无信息仍 unknown」同口径）。
4. 与 `ABS-10` 分层：摘要只作为 body 不可用 / 预算截断 / 跨模块时的通道（保守起点），命中率与收益由 `ABS-16` 度量；不重复存储 `pureMemo` / `checkMemo` / `PolyFn` 已有内容。
5. 契约侧不新增类型参数语法：手写面只有 `ABS-01` 的 binder / ref，引擎侧 α 由使用观测 + 契约槽位推出（两者共享变量表示与 `subst` 纪律；判定时机不同：契约在调用点，摘要在 callee 一次跑）。
6. dts 投影：变元可达且统一后投 `<A, B>`；可表达的界投 `extends`，不可表达时诚实省略（`ABS-03` 纪律）。

**验收**：

- **代换快路径 ≡ body 路径**：同一函数、同一实参抽象，两条路径的返回值 Abs 逐字节一致（同源⇒同产物式 diff），不得一侧更宽或更窄。
- HOF 夹具：`processItems` entry-only 的 dts 变元可达、元素域与回调入参统一（与 `ABS-03` 第 5 条同一夹具）。
- 界不成立时的三种结局各有可观测用例（回退 / widen / `unknown`），冷热缓存一致。
- 单轨 Abs 不破：无新用户语法、Abs 仍 `shape × term × pred × conf`、`leqAbs` 与金标零 FP 不放松。

**风险**：

- 最容易滑向「重造 TS」的形态是 α–α 双向依赖（`β` 的界依赖 `α` 的实例化结果）⇒ 退化为约束求解 / HM；范围必须写死并配负例。
- 摘要成为假绿来源：没有「快路径 ≡ body 路径」门禁不得开工；摘要单方面更宽即等于放松门禁。
- 缓存键漏 `conf` / 依赖 ⇒ 陈旧命中（`ABS-05` 为前置）；摘要跨进程复用另有 `ABS-16` 的信任模型约束。

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

- S1 基线是 120 文件合成仓（`docs/reports/s1-perf-baseline.md`），不是真实 monorepo。
- `persistent-cache.md` 明确 Abs / AST / evaluator / AnalysisResult 不落盘；CheckJson 默认关（投毒面）。

**改动候选**：

1. 真实 monorepo cold / warm / edit 基准；记录 Node/CPU/内存。
2. 在可信 runner 上扩展签名分析缓存；键覆盖源码、依赖、配置、分析 ABI。
3. worker 并行分析；与 LSP 增量缓存分层。
4. 缓存投毒红线：签名、密钥轮换、不可信 runner 默认关闭。

**验收**：真实仓库基准报告；缓存命中率与正确性；不可信场景拒绝复用。

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
| cold / warm / edit | 规模与摘要收益 | `benchmark:s1` / 真实仓基准 |
| 快路径 / body 路径逐字节 diff | `ABS-14` 的等价性门禁 | core 等价性夹具 |
| 缓存命中率 | `ABS-05` / `ABS-10` / `ABS-16` | 缓存层日志 |

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
