# 审计批次 34 条 bug · 根因分类与修复计划

> 来源：`tmp/bug-report.md`（2026-11-14 审计，34 条）。目标：**按根因分类修复，优先设计类**；同一根因只修一次，不做逐条补丁。
> 真源：架构边界见 [`../kernel-merge.md`](../kernel-merge.md)、[`../adr-0001-semantic-index-and-evidence.md`](../adr-0001-semantic-index-and-evidence.md)；命令面见 [`../cli-semantics.md`](../cli-semantics.md)；口径差异登记在 [`../limitations.md`](../limitations.md) §1.4。

## 0. 分类原则

34 条不是 34 个独立缺陷。按**修复点**（同一张表 / 同一条投影路径 / 同一个判据）归并后是 8 组：

- **设计类（D）**：缺失的是「单一事实源」或「类型级不变量」，补分支修不干净 ⇒ 先建结构，再让具体 bug 顺带闭合。
- **遗漏类（O）**：结构已在，某个形态 / 某个面没接上 ⇒ 在正确的单一入口补一处，禁止在消费面各修一次。

判据：**如果修完这条，同组的下一条还会以别的形态复发，就是设计类。**

## 1. 分组总览

| 组 | 主题 | 覆盖 bug | 类 | 状态 |
|---|---|---|---|---|
| **D1** | 契约 → 入口 Abs 的 binder 传递 | 018、020 的假红半边 | 设计（fail-open 收口） | **018 已交付**；**020 未修**（见 §12） |
| **D2** | 产物类型来源 = 唯一优先级格 | 007、014、033（+ 029 的名字半边） | 设计 | **已交付**（注解 > 源码赋值 > brand；getter 按返回值观测） |
| **D3** | 发布门 = 语义判据（不是码表） | 021、025 的发布半边、008 的形态半边 | 设计 | **已交付**（语义门 / `export =` / 装载期必抛） |
| **D4** | 导出槽解析 = 一张表 | 002、013、017 的槽名半边 | 设计 | **已交付**（002/017 随导出槽映射；013 默认导出名换算） |
| **D5** | 入口普查面 = 一张表 | 015、016、017、023、024、032 | 设计（已由 SemanticIndex 承接） | **已交付**（索引入口面 + 可选链调用点） |
| **D6** | 模块面投影 = 一次投影 | 005、006、009、012、027、029、031、033 | 遗漏（同一投影器缺分支） | **已交付**（类型名判据统一 + default/再导出/namespace/解构面补齐） |
| **D7** | LSP = 与 CLI 同源装配 | 019、028、034 | 遗漏（装配缺参 / 词法判据） | **已交付**（词法扫描器 + 类成员表） |
| **D8** | 单点判据 | 001、003、004、010、011、022、026 | 遗漏 | **已交付** |

## 2. 执行顺序与理由

1. **D1（018）**：最小、最独立，直接消一类假红；顺带把「裸 catch 吞异常」这个 fail-open 模式清掉，是 D3 的前置心态。
2. **D3（021/008）**：把发布门从「码表」换成「证据 + 形态」，D2 与 D6 的产物判据都依赖它。
3. **D2（007/014/033）**：优先级格就位后，D6 的字段 / getter / 注解三条一起收口，避免在投影器里再写一遍优先级。
4. **D4（002/013）**：导出槽是 check 与 dts 的共同上游；修一次两面受益。
5. **D5 验证**：SemanticIndex 已覆盖五个形态，只差可选链调用的调用点收集（032）。
6. **D6 → D7 → D8**：按面推进；每步用该组的一变量对照夹具验收。

## 3. D1 · 契约 → 入口 Abs 的 binder 传递（BUG-018）

**根因**：`generalize.ts:1555/1577/1609` 调 `constraintToEntryAbs(c, param)` 未传第 4 参 `binders`；跨槽 `ref("a")` 在别的槽位 ⇒ `resolveRef` 抛错 ⇒ 被 `generalize.ts:1703` 的裸 `catch {}` 吞掉 ⇒ 该位静默退回 `any()`（假红 + 契约义务失效）。

**设计**：契约的 binder 表是 `EffectiveContract` 的字段（`eff.binders`），投影时必须整体带上 —— 与 check 的 `@nudo:skip` 分支（`check.ts:1276`）、dts 的 `contractParamFace` 同口径。catch 改为 fail-closed：记录 `nudo:contract-load`（复用现有码），**不**静默 any。

**验收**：BUG-018 的 `min.js` / `doc.nudo.js` 从 `FAILED` 变 `OK`，签名 `y: (z: number) => ret`；对照 `ctl.js` 逐字不变。

**已交付（2026-11-15）**：`generalize.ts` 在 `effectiveContract` 之后把 `eff.binders`（Record）转成 `contractBinders`（ReadonlyMap），三处 `constraintToEntryAbs` 统一传入；`min.js` 现为 `OK`、`paramTypes[1] = "(number = bind:a) => any"`，`ctl.js` 仍 `(any) => any`。回归钉 `core-bug-018-cross-slot-binders.test.ts`。**残余**：外层 `catch {}` 对「真正未绑定的 ref」仍退 `any`（fail-open）——归入 D1 下一步与 020 一起收口。

## 4. D2 · 唯一优先级格（BUG-007 / 014 / 033）

**根因**：`dts-generator.ts` 三处各有一套取值口径 ——
- `classFieldType`（`:3253`）：初始化器优先，注解兜底 ⇒ 014；
- 字段面取内部 `new C()` 的观测值，不与构造器形参域 join ⇒ 007；
- 类 getter 只读源码注解，无注解即 `unknown` ⇒ 033（对象 getter 已有读域）。

**设计**：`Evidence<T>` 的 `resolvePublicType` 已是唯一优先级格（`declared > join(observed) > degraded`）。三处取值改为构造证据数组后走同一函数：注解 = `declared`，构造器形参域 / 读域 / 初始化器 = `observed`（多路 join），无证据 = `degraded(unknown-inference)`。**禁止**在投影器里再写 `if (fromInit !== "unknown")` 之类的局部优先级。

**验收**：报告里 t8/t9、p1/p2/p3、g.js 三组一变量对照；`tsc --strict` 消费方零错。

## 5. D3 · 发布门 = 语义判据（BUG-021 / 008）

**根因**：`EXPORT_BLOCKING_CODES` 按码枚举，非清单码连上屏都被丢（021）；CJS `module.exports = fn` 一律投影成 ESM 导出（008 的形态半边）。

**设计**：
1. `CheckReport` 增 `hasDeclaredContract: boolean`（由 check 已算出的 `effectiveContract` 顺带产出，零额外遍历）；**语法错契约也算申报**（`nudo:contract-syntax` 本身就是申报证据）。
2. 发布门：`blocking = 语义判据(publishBlockedBy) || 现有码表`，上屏不再按码丢弃 degraded 族。
3. `ModuleForm`（已存在）接进 dts 发射：CJS `export =` 用 `export =`，不再伪造 ESM 默认导出。

**验收**：`f16_syntax.js` 从 exit 0 变 exit 1 且 stderr 有诊断；`f16_mismatch/load` 不变；`real.cjs` 的 `.d.cts` 含 `export =`，消费方 `import real from` 可调用。

## 6. D4 · 导出槽一张表（BUG-002 / 013）

**根因**：`resolveExportSlotCall` 只认精确同名 / ESM 别名 / 对象字面量成员 / `module.exports = function inner`；缺 `exports.<slot> = <local>`、`exports['<slot>'] = …`、`module.exports.<slot> = …`。
匹配阶段 `recordMatchesCandidate` 只比 `fnName` / `targetExport` / `targetAliases`，重命名 default 导入（`other` / `default`）三条都不命中。

**设计**：槽表补成员赋值分支（左值 → 槽名，右值 → 本地符号）；匹配阶段统一按 `targetExport === 候选的导出名` 归因，不以「本地名恰好同名」当命中。

**验收**：`b1.cjs`（槽名 ≠ 本地名）、`use4.js`（重命名 default）、`use2/use3` 全部与对照组同结论。

## 7. D5 · 入口普查面（015/016/017/023/024/032）

前五条已由 `SemanticIndex.entries` 承接（解构导出、default 对象、匿名 default 类、CJS 类、ESM 类表达式，见 ADR §16）。**残余 032**：`OptionalCallExpression` / `OptionalMemberExpression` 不进 `scan-literal-calls` / `scan-call-graph` 的调用点收集 ⇒ 可选链调用绕过契约执法。

**设计**：调用点收集统一走「callee 归一」函数（`Identifier | MemberExpression | OptionalMemberExpression`），节点类型集合含 `OptionalCallExpression`；与求值面同一 AST 判据。

## 8. D6 · 模块面投影（005/006/009/012/027/029/031/033）

八条分布在同一投影器的四条子路径，按子路径修（不在每条 bug 上打补丁）：
- **镜像声明**（005/006）：本地 interface/type 进可解析集合；镜像声明引用的导入名进 `annotationRefs`。
- **default 槽**（009）：对象 / 数组字面量走命名槽同款 Abs 槽位投影。
- **再导出**（012）：`import …; export { … }` 的导入绑定进 `exportBindings`，早退判据同步。
- **namespace**（027/031）：`namespaceMemberLines` / `namespaceClassLines` 读 `typeParameters` / `superClass`，与模块级共用同一发射器。
- **契约寻址**（029）：`lookupContractSlot` 补点路径分支；形参名落占位时按 `PublicName` 边界处理（030）。

## 9. D7 · LSP 同源装配（019/028/034）

- **028**：`resolveCalleePolyFn` 补 `modules` / `inject` / `autoBind`，与 hover / 补全同一装配。
- **019**：`cursorLexicalContext` 的等长掩码遇 `\n` 会丢「字面量内」判定 ⇒ 以「光标在 span 内」为准，不靠行内回退。
- **034**：`brand` 分支补「类实例 → 类方法表」，`this.` 接收者同源。

## 10. D8 · 单点判据（001/003/004/010/011/022/026）

各自独立，逐条修；其中 003（局部绑定表）与 011（守卫合取聚合）是「同一张事实表 / 同一个谓词入口」的缺口，可各自一次修干净。

## 11. 纪律

- **每组建一个一变量对照**（报告已给），修复前后逐字对比；不设白名单、不加 `@nudo:throws` 噪声。
- 每组建一次 changeset 条目；跨包出口仍只走 `@nudojs/core/internal`，`.` 面不泄漏引擎符号。
- 完成一组即在 §1 表标记状态，并把该组的残余写进 `limitations.md`（如「已收窄」）。

## 12. 交付补记（2026-11-15）

33 / 34 已修，逐组一次提交（`bd5b4e6f` D1 → `1f38e5ed` D3）。

| 组 | 提交 | 关键点 |
|---|---|---|
| D1 | `bd5b4e6f` | 三处形参投影都带跨槽 binder 表（018） |
| D3 | `3b76658a` / `d7c2cbbd` / `1f38e5ed` | 语义发布门（021）、`export =`（008）、装载期必抛（025） |
| D2 | `6c472f67` | 注解 > 源码赋值 > brand；getter 按返回值观测（007/014/033） |
| D6 | `6b4f937d` | 一个「类型名可解析」判据；default / 再导出 / namespace / 解构面补齐（005/006/009/012/027/029/030/031） |
| D7 | `5b3f083e` | 逐字符词法扫描器（019）；类成员表（034） |
| D8 | `1c5334cf` | 循环头 const（001）、局部绑定表声明面（003）、能力档诊断（026） |
| D4 | `dac1fb09` | 默认导出名在 `--from` 两侧的换算（013） |

**两处有意改变的产品口径**（已写进回归钉的注释）：

1. `nudo:contract-syntax` 从此**阻断 export**（此前 exit 0 且零上屏）——它同样是「整条契约丢失」；
2. `<fn>Input` 对解构形参按**字段名**建顶层键（BUG-030 覆盖 BUG-120 的 `_p0` 槽名）——
   占位名不是公共名，而旧口径让发布的校验器拒绝唯一合法的调用形态。

**唯一未修：BUG-020**（`.ts` 构造器注解 / 参数属性不进 `this.<field>` 的域）。

原因不是「没想到怎么修」，而是修点落在**执行模型的类实例形状构造**上：`this` 在
transpile 后是一个合成形参，其实参 Abs 由 `new C(...)` 的求值给出；构造器形参的
注解在 generalize 的 `formals.tsType` 里可见（`check` 打印的签名就带着
`size: number`），但那条注解没有进入实例槽的种子。要做到「注解即域」，需要在
实例形状构造点按构造器形参注解播下符号槽位——这会改动 `this` 的绑定语义，属于
求值模型的手术，且必须有 real-package 零 FP 背书。本批次停在「把根因定位到具体
函数」这一步，不半改。
