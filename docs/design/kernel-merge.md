# Nudo 类型系统架构（单轨）

> **唯一真理源**：`Abs = shape × term × pred × conf`（类型即计算）。
> 位置：`@nudojs/core/src/algebra`。
>
> 产品命令面 / any·unknown / check 门禁语义见
> [`cli-semantics.md`](./cli-semantics.md)。
>
> **无第二套 IR**：生产求值 Abs 原生、单引擎 **evaluator**（transpile+exec）；
> 不可求值 / 求值失败 **fail-closed**（unknown/空导出），无解释兜底。
> dts / schema / guard / LSP hover / 序列化都是 **Abs 的单向外延投影**
> （`formatShape` / `absToTSType` / `absToSchemaSource` / 守卫生成器）。
> 约束构建器（`number()` / `shape({...})` 等，`*.nudo.js` 模板）进入 Abs 作为 Pred。
>
> 无 `NUDO_KERNEL` 开关、无 `packages/kernel`、无双矩阵。

> **Executive summary (EN).** This document is the single source of truth for the Abs architecture: `Abs = shape × term × pred × conf` (types as computation). There is one IR and one evaluation engine (evaluator: transpile + `new Function`); failures fail closed (unknown / empty exports) — no interpreter fallback. dts / schema / guard / LSP hover / serialization are **one-way lossy projections** of Abs and are never read back. Constraint builders (`number()`, `shape({…})`, …) enter Abs as Preds and participate in algebra. Trust boundary: analysis **executes** target code in-process — treat `nudo check` / `nudo test` like running the code; sidecar `*.nudo.js` and mocks are ordinary JS inside that boundary. Cross-product invariants are listed near the end of this document; product CLI face lives in `cli-semantics.md`.

---

## 分层

```
parser ──▶ core
            ├── algebra/     ← 类型本体（Abs / Term / Pred / Φ / check / surface）
            ├── format       ← 外延投影（formatShape / formatAbs / absToTSType）
            └── refinements  ← *.nudo.js 约束构建器 → Pred
                 │
                 ▼
            service/evaluator    ← Abs 原生：evaluator（transpile+exec）单引擎
                 │
                 ▼
            service / lsp / vscode / dts / schema
```

## 运算路径

| 运算 | 路径 |
|---|---|
| `+ - * / %` 数值/字符串 | 代数 `add/sub/mul/div/mod` |
| `< <= > >=` 数值/字符串字面量 | 代数 `cmp` |
| `=== !==`（含 nullish） | 代数 `strictEqAbs` / `cmp` |
| `typeof` / `!` / 一元 `-` | 代数 `surface.ts`（`typeofAbs` / `notAbs` / `negAbs`） |
| 对象 spread / join | 代数 `spread` / `joinAbs` |
| range narrow | Pred 编码进 Abs |
| union | 逐成员代数 |
| refined 方法/属性 | `dispatchMethod/Property`（宿主扩展） |
| 混合 `+` / 无法判定的比较 | 粗化回 shape 基类型（Abs 内部，不传播约束） |

路由：`algebra/surface.ts`（一元/相等）+ `algebra/arithmetic.ts`（二元算术/比较）+ `algebra/objects.ts`（spread/join）。

## 约束如何传播

1. 调用点参数 `tagParamArg` 挂 `var(name)` 项身份（WeakMap 旁路）。
2. `if (x > 5)` → 真臂以 `withExecPhi(Φ ∧ test.pred)` 作用域进入路径前提 Φ（假臂合取否定）。
3. 分支内 `x+1` / `x>=3` 读 Φ 与自身 pred，单调性推出新约束。
4. narrow 产生的 range refined 保留 term，`toAbsWithTerms` 编码成 `ge/le` Pred。
5. `nudo check`：`checkSource` 做蕴含门禁（调用前置 vs clamp 不算违例）。

## 置信度

| conf | 含义 |
|---|---|
| exact | 字面量 / 可精确求值 |
| path | 依赖路径约束 |
| widened | 丢失结构后的保守外延 |
| mock | 来自 harvest/mock 声明而非观测求值 |
| partial / opaque | 未知或不可投影 |

外延投影丢 term/pred 时不得假装 exact。

## 模块边界

- **algebra 无 fs/path**：模块解析、harvest、scan 在 service/cli/scripts。
- **scripts 不进 `packages/*/src`**。
- **core 不依赖 parser 包**（`parseSource` 用 `@babel/parser` + `stripTypes`）。
- **内核不 import exec/**：Abs 代数是内核、exec 是引擎消费者——import 图上
  algebra/*.ts 不得 `from "./exec/…"`。throw 原语定居内核叶子
  `algebra/nudo-throw.ts`（NudoThrow 载荷）与 `algebra/may-throw.ts`
  （may-throw 效果收集 / errorTypeAbs / L2 过滤器；依赖仅 `abs.ts` +
  `node:async_hooks`）；arithmetic / surface / methods / builtins/* 直接消费
  叶子。`exec/nudo-throw.ts`、`exec/may-throw.ts` 仅作 re-export 面保留
  （runtime/*、check*、internal.ts 既有路径不断；transpile 协议注入的
  `$`op 经 `rt.ts` 绑定表解析，与二者无关）。exec/→algebra/ 的正向边
  （如 `exec/call.ts` import `objects/hof`）是引擎消费内核，保留。

## 绑定索引层（ADR 0001 · 不是第二 IR）

> 决策与迁移计划见 `adr-0001-semantic-index-and-evidence.md`。本节只钉**架构边界**。

- `algebra/scan/semantic-index.ts` 一次 binding 产出**纯数据索引**：`SymbolId`
  （`scopeUid + declarationStart`）是跨面引用的唯一身份；`refs` /
  `exportSlots` / `entries` / `members` / `spans` / `calls` 一律只读。
  索引是**绑定元数据，不是值 IR**：不参与求值、不进 Abs shape、不改
  `leqAbs` / `formatShape` / 缓存 ABI。Abs 仍是唯一类型表示。
- `algebra/diagnostics/evidence.ts` 是**分析期证据标签**（`declared` /
  `observed` / `degraded`），同样不是 Abs 槽位；`unknown` 只由 `degraded`
  产生，没有「降级成 `any`」的构造子。
- 跨包唯一出口是 `@nudojs/core/internal`；`.`（产品面）不得泄漏索引符号。
  投影仍单向有损，「Nothing reads a projection back」不变。
- 索引缓存以 `File` 为键（`WeakMap<File, SemanticIndex>`），与 `parseSource`
  的 AST 同生命周期，不引入第二套 AST 缓存。
- `algebra/scan` 不得 import `exec/transpile`（沿用上文「模块边界」纪律）；
  解构模式收集与该处同形实现，不制造反向依赖。
- 阶段 1 起逐面迁移：`check` 面先影子双读、**旧面为准**，确认零回归后才
  允许切换，再逐个删除孪生扫描器。切换前 `Evidence` 不得进入任何分析结论，
  故暂不纳入 `analysisFileCacheKey` / `fnDepSeg`。
- 阶段 1 切片 2：`check` 的入口名表经 `resolveEntryFace` 可显式切到
  `SemanticIndex.entries`；切换口径是 `entries ∪ 旧面缺口`：迁移期不得让任何
  旧入口消失；索引为空时 fail-closed 回退旧面。service 的
  `collectTopLevelFunctions` 仍是「名称 + 节点」孪生扫描器（节点供形参 /
  定位 / `noDeclaration`），索引只有名字，**不能替换它**；
  `recordServiceEntryFace` 只读索引产出分歧快照，不改写普查结果。
- 阶段 1 切片 3：`check` 索引面**默认开启**（`entryFaceEnabled = true`），
  `setSemanticIndexEntryFace(false)` 是可回退旧面的 fallback（阶段 3 删除）。
  两个开关职责分离：`shadowEnabled` 只管**只读观察**（service 快照与
  `takeSemanticIndexShadow`），`entryFaceEnabled` 只管**入口口径**；二者的
  状态都由 core 单点持有，service 不得自建开关。尤其：索引面默认开启后
  service 只读快照**不得**随之开启，否则每次 `analyzeFile` 都多建一次索引。
- **缓存键纪律（切片 3 起）**：索引面状态经
  `semanticIndexEntryFaceSegment()`（`idx1` / `idx0`）进入 core
  `checkMemoKey`、service `analysisFileCacheKey` 的 `auxKey` 与函数级
  `fnCacheKey`，两档结论互不回放；因此 fallback 开关可在同一进程内翻转
  （切片 2 的「不得热切换」限制随之解除）。`Evidence` 仍未进入任何分析
  结论，故暂不单独纳入 `analysisFileCacheKey` / `fnDepSeg`；D2 首次接入
  产品面时再补。
- 索引 `entries` 只收**模块顶层**的可调用形态：函数体内嵌套声明、
  getter / setter 访问器都不得成为公共入口（否则名字解析不到 ⇒ 假
  `nudo:opaque-result` / `entry-may-throw`）。绑定表（`symbols` / `refs` /
  `spans` / `calls`）仍遍历整棵 AST，不受此门控影响。
- **证据层（切片 4.1）**：`algebra/diagnostics/evidence.ts` 的 `Evidence<T>`
  经 `@nudojs/core/internal` 暴露只读面；`evidence-shadow.ts` 把发布门的
  「按码白名单」与 `publishBlockedBy` 语义判据做**影子双读**，默认关闭、
  只输出分歧清单、不改结论。诊断按 §10 决议 2 复用现有码。影子阶段
  Evidence 尚未进入任何分析结论 ⇒ **不纳入** `analysisFileCacheKey` /
  `fnDepSeg`；切片 4.2 首次切换判据时同步补键纪律。

## Collector 作用域（ALS）

- **动机**：collector / 诊断通道曾是模块级单变量 + set→finally→restore 配对；
  同步路径单线程下正确，但宿主 async 入口存在 await 窗口——LSP
  `validateText`、`analyzeFileAsync` 的 path-env preload、`emitContract` 的
  `await analyzeFileAsync`。两轮「await 窗口偷诊断」事故根因相同：交错分析
  共享同一缓冲 / collector（since 锚只缓解全量 take 变体）。
- **机制**（单一定义：`algebra/collector-scope.ts` + `algebra/diag-channel.ts`，
  把 may-throw.ts / member-diag.ts 的 ALS 先例抽成共享原语，
  经 `@nudojs/core/internal` 导出）：
  - `createScopedSlot`：模块级 fallback + ALS store；无作用域时读写
    fallback（行为与收敛前逐位一致），公共 setter/getter 签名不变；既有
    save/restore 在作用域内写最内层 store，配对语义继续正确。
  - `createScopedDiagChannel`：作用域内空缓冲、seq 归零（锚与缓冲是消费方
    私有），观察者继承。
  - `runWithCollectorScope`：幂等（ALS 标记）；最外层调用为全部注册参与者
    开 store，嵌套 / 同异步链调用直接执行 body；async 续体沿 ALS 继承，
    交错分析各开各的。plain 槽开作用域时继承当前值（嵌套语义 = 今日模块
    全局）。
- **入口包裹**（粒度 = 一次完整分析的 collector 生命周期）：core
  `checkSource` / `runTranspiled` / `callTranspiledExportFull`；service
  `tryRunEval` / `tryEvalCallFull` / `tryEvalCall` / `analyzeFile` /
  `analyzeFileAsync`（先于 preload await）/ `emitContract`；lsp
  `validateText`。new Function 求值路径（transpile 注入的 runtime 在同步
  调用链上）继承 ALS 上下文，跨帧读 collector 正确。

| 状态 | 状态点 | 理由 |
|---|---|---|
| 已收敛 | refine / contract 诊断通道（`nudo:contract-*`）；侧车加载失败去重表；evalCall / evalAssign collector；bindingSink；absTruncation collector；memberDiag collector；evalFallback collector；implicationOracle；derivation 会话（collector / 节点表 / id 序号）；envHarvestConflict collector（service）；yieldStack / genPathSensitive / genJoinOverride 生成器收集槽（runtime/control.ts） | 跨 await 存活的分析态，必须随作用域隔离；生成器三槽虽在单次生成器求值（同步）内 push/pop 与 save/restore 配对完成，但跨 await 窗口的交错分析仍需各开各的 store——已 `createScopedSlot` + `registerCollectorScopeParticipant` |
| 保留 | 调用 / fork 预算计数器与 `@nudo:budget` 上限；phi 栈 / armOverlays / forkTouchedStack；`_fb*` 回落计数器；ID 序号（symbolIdSeq / fnCallIdSeq / moduleMapIdSeq / nextLoadModuleId / leakCounter / classEpoch / truncDepsSeq）；缓存 / memo（check-memo、hash-source、pureMemo / pureCallMemo、objectProtoSingleton）；may-throw.ts；member-diag 的 evalMissingSlot；service analysis-session `defaultSession` / session-cache-limits；同步 save/restore 配对旗标 `awaitUnsettledHit`（runtime/async.ts，`$async` 入口 save/reset、finally 恢复）与 `loopSignalFromAbstractArm`（runtime/state.ts，`withAbstractForkArm` finally 恢复） | 预算与各栈是严格同步调用栈生命周期，await 窗口必为空 / 已恢复；`_fb*` 是进程级 health 指标、刻意累计；ID 序号跨分析唯一性是语义；缓存 / memo 按内容键、无害共享；may-throw.ts 与 evalMissingSlot 已有各自 ALS 会话（`runWithMayThrowSession` / `runWithEvalMissingSlot`）；`defaultSession` 是进程级配置、非分析态（setter 仅测试使用），session-cache-limits 是 env 纯函数读取 |

> 历史残留行已清空：parser `directiveDiags` side-channel 缓冲已删除退役
> （2026-10，@nudojs/parser major）——诊断通道唯一形态为显式
> `extractDirectives(ast, { diags })` / `runWithDirectiveDiags(fn)`，仓库内
> 消费方（nudojs check D1 等）已全部迁移。parser 的字面量助手已并轨
> `@nudojs/core/internal` 的 `absLit` 单源（parser 本就依赖
> `@nudojs/core`，见上方分层图，旧「不得引入 parser→core 依赖」表述作废）。

## 执行模型与信任边界

> **本节是信任边界的唯一事实源。** 用户侧警告见 README「Security」与 website
> `concepts/semantics.md`「Trust boundary」；求值引擎机械细节见
> [`evaluation.md`](./evaluation.md)。

生产分析是 **分析即执行**：evaluator 把目标源码转译成 `$add` / `$fork` 等代数调用后，
用 **`new Function` 编译并运行**（`runTranspiled` / `callTranspiledExportFull`）。
被分析代码以抽象值（Abs）在分析器进程内**真实求值**——顶层副作用、
`import` / `require`、以及侧车 `*.nudo.js` 与 `@nudo:mock` / `@nudo:mock-module`
提供的普通 JS 都在分析期执行。

**信任边界**：`nudo check` / `nudo test`（以及 LSP / vite 插件的分析路径）
等价于「在本机执行目标代码」。

- **不要**对 untrusted 代码运行 nudo（陌生 npm 包、用户提交、未经审查的 PR）。
- CI 上只分析**可信仓库**。
- 侧车契约与 mock 也是普通 JS，同属信任边界之内——它们不是声明式数据。

这不是沙箱声明：Nudo **没有**隔离求值进程。预算（`MAX_CALL_DEPTH` /
`MAX_TOTAL_CALLS` / forks 截断）只防失控分析，**不构成安全边界**。

## 不变量（跨产品）

- 检查的是 Abs 上的 **Pred 蕴含**，不是 TS 式类型匹配。
- 投影单向：分析从不读回 dts/schema/guard。
- 入口无约束参数产品展示为 **`any`**；**`unknown` = 推导失败**（见 cli-semantics §2）。
- L2 入口 may-throw 是运行时效果门禁，不是 body AST 必填 slot（C0）。

## 历史

历史上的 kernel 独立包、`NUDO_KERNEL` 开关、TypeValue 求值 IR 均已删除。
迁移见 git：`feat/typevalue-algebra` → `feat/mimo`。
