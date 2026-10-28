---
"@nudojs/service": patch
"nudojs": patch
---

fix(service): emit / 接口派生面（BUG-003/021/032/040/041/043/079/107/192/203/214/232/233/266/271/272）

- BUG-214 — 仅当全部用例都是 `callsite` 时，主签名对观测返回值做 `widenObservedReturnAbs`；`entry@` / 指令用例保留嵌套精度（既有 Bug-565 引脚不变）。
- BUG-232 — `export --out` 下相对 specifier 按 outDir 重写（新增可选 `ExportArtifacts.sourcePath`）；`moduleKey` 仍与路径无关，BUG-016 语义不变。
- BUG-233 — 导出「阻断」判定对齐 `EXPORT_BLOCKING_CODES`，不再只看 `severity === "error"`。
- BUG-266 — 派生 `.nudo.ts` 侧车写入前补 builder 声明（TS 侧车），复用 `coreExportNameOf`。
- BUG-271 — 侧车 builder 可用性按 **core 导出名** 比较（`import { lit }` 不再豁免），必要时生成别名 `_nudo_lit` 与 `declare const … litC`。
- BUG-272 — draft 的 builder import 扫描改为调用位匹配 `(?<![\w$])b\s*\(`，字段名不再误命中。
- BUG-192 — 类型注解先前丢弃任何含 `/` 或换行的注解；现折叠换行，仅拒绝真正的注释标记（`//`、`/*`）。
- BUG-203 — Zod `.min()/.max()` 为码点计数，改为 `refine(s => s.length >= n)` 对齐 UTF-16（guard / standard / contract 一致）。
- BUG-003（部分）— 类构造器 / 静态参数未受约束时输出 `any`（而非 `unknown`），与 `nudo check` 及 CLAUDE.md 口径一致。
- BUG-021 — 点观测不再直接成为契约：`widenObservationAbs` 后再 `joinThenProject`；不可表达的联合保留原始投影兜底。
- BUG-032 — `absToSchemaNodeB` 增加 bigint 分支（`z.bigint()`），并去掉「已丢弃」账目。
- BUG-040 — draft 选择与 `contract-draft.ts` 守卫均按 **导出名** 比较；`--fn totallyMissing` 仍为用法错误（exit 1，不落盘）。
- BUG-041 — 派生段 label 改为包根相对（回退 basename），并以 `labelKey()` 统一身份，旧拼写去重而非并集。
- BUG-043 — 侧车解析错误重新抛出时带侧车路径（原带路径分支为死代码）。
- BUG-079 — `combinedAbs == null` 的跳过分支改为输出 `(...args: unknown[]): any`，不再整条导出消失。
- BUG-107 — `declaredParams` 的 `pattern` 分支读取 `FormalParam.optional`；`pattern + 默认值` 渲染为 `_p0?: T`，绑定模式名仍必填。

已更新的既有测试（原断言钉住声明的错误行为）：

- `emit/interface-emitter.test.ts`（BUG-021，2 处）
- `emit/emit-bug-514-…-dts-export-surface.test.ts`（BUG-003：`constructor(v: unknown)` → `any`）
- `emit/schema-bug-1046-bigint-literal.test.ts`（BUG-032：观测 bigint 由 `unknown` → `prim bigint`）
- `emit/schema-bound-anchor.test.ts`（2 处）、`emit/schema-generator.test.ts`（1 处）（BUG-203）

未修：
- BUG-196 —— 本夹具不再复现，但**当时不是真修**：`bar` 因 BUG-041 的 label 身份变化被报为 `not_projected`，双写者未消除。**已由后续轮次收口**：CLI / LSP agent 面的根侧车单写者（`finalContent` + `baseContent` + `skipWrite` + `directSections`）见 cat-11 changeset；LSP **add** 面新建段并溯源行常用的 `directCreatedSections` 见 cat-14 changeset（本文件同属 `@nudojs/service` 的发射面）。
- BUG-035 —— 排除无断言 `@nudo:case` 见证会改变契约产物；5 个既有 emit 测试钉住「指令用例 → 字面量契约」，属产品决策。
- BUG-168/189/190 —— 需把 `DtsModuleSurface` 贯穿 `computeMainSignature` / `tsParamAnnotation`，并改造 `dtsExportNameOf` 的返回形状（跨切面）。
- BUG-055/068/074/076/081/093/094/109/119/135/151/197 —— 未开始；其中 BUG-074 的扁平 `export default function` 形态被 `core-bug-435`、`emit-bug-514`、`export-dts-evidence` 钉住。

## 追加：观测拓宽改为「点域」判据（BUG-021 的收口）

初版 `projectFunctionDsl()` 对**每个** callsite case 无条件拓宽再 join ⇒ 多值
观测域也被塌成 `number()`（`area(1); area(-2)` 写不出 `union(lit(1), lit(-2))`），
与 drift 对账面（`core/src/algebra/check-interface-drift.ts`）的域判据分叉 ⇒
`--emit` 之后 health 恒报漂移（BUG-199）。

现改为**先 join 后判点**：`isPointConstraint`（core，与 drift 共用）为真才拓宽，
多值观测域保留字面量并集；带断言的 `@nudo:case` 仍一律不拓宽。`widenObservationAbs`
随之移入 core（`@nudojs/core/internal`），service 内不再保留副本。

### 追加：本轮发射面修复（13 条）

- **BUG-168**：dts 不再抄不可解析的类型名（`id(x: any)` / `pair(a: any, b: any)`）；可解析的
  本地类补 `declare class`、导入名补 `import type`、`class Box<T>` 保留形参槽。
- **BUG-189**：一个绑定挂多个导出名全部落地（`export declare function foo` +
  `export { foo as default }`，类同理）。
- **BUG-190**：`export declare const/let/enum`（含成员与字面量初始化器）；无绑定值留
  `nudo:unresolved-value` 台账，TS2305 归零。
- **BUG-151**：`class B extends A`、未导出基类补 `declare class`、实例字段（`this.x=…` /
  类属性）落地、继承字段不重复。
- **BUG-108 / BUG-109**：入参面可选性 = 契约级 ∪ 声明级默认值；rest 槽**恒可选**且只有
  **一层**数组（zod `.optional()`、dts `...rest: any[]`）。
- **BUG-069**：见证等价改按「**文件** + 实参载荷」复合键 ⇒ 二次 `--freeze` 输出
  `freeze: no changes.`、文件字节不变。
- **BUG-081**：冲突面带 `conflict` / `undecidable`、行尾 `[unsatisfiable: n]`、stderr 同码
  error、`--json` 同名字段、exit 1；`nudo:interface-undecidable` 保持 warning（能力边界）。
- **BUG-068**：nullish 回填在同一次改写里补齐 TS 侧车 builder import（含
  `nullable as nb` 别名；JS 侧车不加）。注：缺陷正文里「`interface-draft.ts` BUILDERS 缺
  `nullable`」是**过期信息**。
- **BUG-198**：已申报的 `@nudo:throws` / `eff.throws` 原样进草稿 DSL；仅门禁算出的「可能抛」
  写成草稿头可照抄提示（不把「可能抛」变成草稿义务）。

### 追加：BUG-055 / BUG-119 已修，BUG-197 阻塞点已定位到行

- **BUG-055（`--freeze` 把违约见证搬进被调方）**：`insertGeneratedCaseDirectives()` 原先只筛
  「可序列化 + 非手写」，**从不与被写方自己的有效契约比对** ⇒ 调用方的违约被搬进被调方，随后由
  `check-case-scan` 对着被调方报 error 级 `nudo:case-inconsistency`。修：新增
  `contractGuardOf()` / `witnessViolation()`（`emit/case-emitter.ts`），读
  `effectiveInterface(...)` 且**只执法 `source === "handwritten"`**（与 §3.3 同档）；契约位→实参位
  映射与调用点面同规则（`paramNames.indexOf` → `locateContractParam`）；判据与
  `check-case-scan.ts` 的标量通道**同口径**（eq/union 走 `literalMeetsConstraint`；纯 bounds 先
  `isIntFlag` 再按**实例化后** pred 逐原子判；optional 的 `or` 包裹不执法）；**不可判 ⇒ 放行**
  （非字面量、结构/数组/函数域）。违约见证不写入，skip 记新原因 `contract-violation`，归因留在
  调用现场 `nudo:interface-domain-exceeds`。宿主接线（`filePath` / `loadModule` / `autoBind` /
  `projectDir`）由 `shared.ts` 的 `emitWiringOf()` 供给，与 `contractOf` / `checkSource` 同源。
  回归：`service-bug-055-freeze-contract-guard.test.ts`、`cli-bug-055-freeze-contract-guard.test.ts`。
- **BUG-119（`--freeze=update` 静默删除活着的见证）**：update 链「剥离 → 重算 → 回写」的两层
  缺陷：① `stripGeneratedCaseDirectives` **无条件**剥离 `call@`；② 回写沿用 add 模式的**函数级**
  「有手写 case ⇒ 整函数跳过」⇒ 跨文件见证无法从当前证据重算时（无契约时分析器不合成跨文件
  case）就是净删除且不可恢复，汇总只数「新写出」⇒ 谎报「0 directive(s)」。修：**块级守门**
  （含手写 case 的 JSDoc 块不剥离生成态见证，往返闭合）+ `InsertCaseOptions.rebuildGenerated`
  （重建阶段按**见证身份**逐条重建，手写 case 只挡同名，载荷等价只判生成态之间）+
  `reemitUpdate` 返回 `removedWitnesses`（`netRemovedWitnesses` 按身份配对，行号漂移不算删除），
  CLI 汇总印 `(N directive(s) …, K removed)` 与逐条 `- call@…`。
  回归：`service-bug-119-freeze-update-rebuild.test.ts`、
  `cli-bug-119-freeze-update-keeps-live-witness.test.ts`。
- **BUG-135 已修**：实际改动在 LSP 侧（`a6-relax.ts` / `server-code-actions.ts`），见 cat-14
  changeset（relax 改「真写推断面」+ 落盘后验证门；CLI 文案在行为修好后为真，未改口径）。

仍未修 / 阻塞（根因在禁改文件或需产品裁决）：

- **BUG-035**：`projectFunctionDsl()` 把 `@nudo:case` 调试见证投影成契约；emit 测试目录里 5 处
  pin 了当前行为，改口径必须重钉 ⇒ 需产品裁决。
- **BUG-197 已修**：见 cat-02 changeset —— `arityFace` 接受契约可选位，本地与跨文件共用
  `contractOptionalIndexes` 映射（位次与 `interfaceToIndexed` 同一套，只对 `handwritten` 生效），
  `nudo:arg-count` 不再对契约 `.optional()` 的省略实参报红，且不会出现「同文件绿 / 跨文件红」。
- **BUG-076**：`any` 是既定口径（`docs/concepts/abs.md`、CLAUDE.md），真问题是文档表述
  （`docs/**` 本轮未改）。

### 追加：6 处 schema 期望按 BUG-093 重钉（不是放宽）

BUG-093 的声明正确行为 = 数值谓词面必须接受 `±Infinity`（`schema-generator.ts:704-705`
「`satisfies(Infinity)` ⇒ `.or(z.literal(Infinity))`」，`-Infinity` 同理），否则导出的 zod
schema 会拒绝 Abs 域里合法的值。`schema-generator.test.ts`（5 处）与
`schema-bound-anchor.test.ts`（1 处）钉的是加臂之前的字符串：

- `gt(0)` / `gte(0)` → `….or(z.literal(Infinity))`（含对象槽内与默认 dialect / module 面）
- `lte(100)` / `lt(5)` → `….or(z.literal(-Infinity))`

行为断言（`WIDE_NUMBER` 的 NaN/±Infinity 三臂、`int().gte(0)` 等）原样保留。

### BUG-035：`@nudo:case` 的调试见证不再被写成契约（`nudo contract --emit`）

**根因**：`packages/service/src/emit/interface-emitter.ts` 的 `projectFunctionDsl()` 把
`source === "directive"` 的指令 case 与 `source === "callsite"` 的调用点证据**平权**
当域来源 / 返回义务来源 ⇒ 纯点观测见证被投影成契约（`fn({ x: lit(5) }, lit(6))`），
与 `nudo check` 的 `f(x: any) => number | string` 自相矛盾：用户为调试加一条
`@nudo:case` 就把函数固化成「只接受那个点、只返回那个值」。

**修法**：指令来源**内部**再分档（新增 `emit/domain-cases.ts` 的
`isDomainDeclarationCase()` / `isPointObservationArgs()`，判据与 analyzer 侧
`isPointObservationArgs` 同源）——
- **域声明**：实参是约束构建器（`number()` / `shape()` / `union()` … 的域形状）**或**
  带断言（`=> expected`）⇒ 可作域来源与返回义务来源；
- **纯点观测见证**（实参全是字面量且无断言）⇒ **不生成域、不生成返回义务**。

**口径变化**：`directive` 纯见证不再产出契约（改前：`fn({ x: lit(5) }, lit(6))`；
改后：无证据 ⇒ `skipped … (not-projectable)`，不写侧车）。`callsite` 优先、
BUG-021 观测拓宽、域形状 `number()` 的 `not-projectable` 口径**均不变**；
`domainEvidenceCases()`（dts / zod / standard / guard 面）语义不变。

**重钉清单**（原断言钉住「指令用例 → 字面量契约」的错误行为；夹具改为**带断言的域声明**，
断言文本未动）：`emit-bug-523-section-order.test.ts`（2 处）、
`emit-bug-532-value-template-clash.test.ts`（1 处）、`emit-bug-540-crlf-byte-fidelity.test.ts`
（1 处）、`emit-bug-548-import-name-clash.test.ts`（1 处）。
新增回归：`emit/__tests__/emit-bug-035-case-witness-not-contract.test.ts`（三种 case 形态 +
「有调用点证据时见证不得污染返回义务」+ 分档判据）。

**残留边界**：既有侧车里由见证生成的旧生成段，在 update 模式下按「证据消失 ⇒ 删除该生成段」
处理（见下文「BUG-035 残留收口」）；宽域 / `derived-from:` 段 / `@nudo:skip` 段仍按原策略保留。
`contract --draft` 面本就不投影见证的返回义务（`projected: false`），无需改动。

### BUG-076：`nudo export --format dts` 的「无证据参数」口径统一为 `any`（文档侧修正 + 回归锁定）

**判定**：`BUG-076` 的 section 结论 —— 代码侧「未取证参数渲染 `any`」是**有意为之**的产品口径
（`docs/concepts/abs.md`：入口无约束 = `any`，不因缺证据改用 `unknown`），真正错的是仍在承诺
「`unknown` + stderr 点名提示」的两处文档。故本条按**文档侧**收口，零行为变更。

**改动**：
- `docs/design/cli-semantics.md` §2「已记录例外（export 投影面）」改为 `any` 口径，并说明只有
  真正推导失败才出现 `unknown`（由 `nudo:unknown-inference` 之类引擎债诊断标注）。
- `packages/website/docs/guides/export-ecosystem.md:114/185` 与 zh-Hans 镜像同步改为 `any`，
  删除「`export --format dts` 会打 stderr 提示」的承诺。
- 新增 `cli-bug-076-unevidenced-any.test.ts`（3 例）：主路径无证据形参 ⇒ `any` 且 stderr 无提示；
  契约只覆盖部分形参 ⇒ 未覆盖位仍 `any`；窄路径（`@nudo:skip` + 手写契约未覆盖位）⇒
  `unknown` + `note: <fn>.<param> rendered as unknown …`（两条路径都实测可达 ⇒
  `reportUnevidencedParams` **不是**死代码，只是只在窄路径出现）。
- `helpers/run-cli.ts` 新增 `writeSrcTsconfig()`：CLI 子进程按 cwd 找 tsconfig，否则会落到共享
  `dist/` 旧构建（测试钉源码语义的前提）。

### 重钉：BUG-021（调用点点观测拓宽）

调用点**点观测**不再直接成为字面量契约 —— 先 `widenObservationAbs` 再 `joinThenProject`
⇒ 一次 `alpha({ x: 5 })` 折出 `shape({ x: number() })`、返回 `5` 折出 `number()`。据此重钉：

- `packages/nudojs/src/__tests__/cli-bug-657-emit-fn-unmatched.test.ts`
  「对照组：名字正确 ⇒ 只改那一个」的断言由
  `toContain("+export const alpha = fn({ p: shape({ x: lit(5) }) }, lit(5));")` 改为
  `toContain("+export const alpha = fn({ p: shape({ x: number() }) }, number());")`。
  「只改 alpha、beta 不出现 `-`/`+`」与同文件「全部未命中 ⇒ 用法错误 + 侧车逐字不变」
  「连 dry-run 预览都不给」「部分命中 ⇒ `skipped nope (not-an-export)`」三组断言**未改动**。

### BUG-035 残留收口：证据消失 ⇒ 旧生成段被删（不再「保留原段」）

**根因**：`emitInterface` 的 update 分支把「**不可投影**」一律当成「今天没有证据 ⇒ 把落盘的段原样保留」。
BUG-035 之后 `@nudo:case` 见证不再进契约 ⇒ 由见证写出的旧段（`fn({ x: lit(5) }, lit(6))`）却因此
**永久留在侧车里**，与 `nudo check` 的结论（`f(x: any) => number | string`）长期矛盾。

**修法**（`packages/service/src/emit/section-provenance.ts` 新增，`interface-emitter.ts` 接线）：
落盘的 `@generated` 段在**两个条件同时成立**时被删除 ——
① 当前投影**确实无证据**（无调用点、无域声明 case、无 entry 推断、且非 `@nudo:skip`；
   「有证据但表达不出来」不算无证据 ⇒ 保留）；
② 该段的证据**可证明来自本文件**（无 `// derived-from:` 标签，且某个顶层槽钉住了单个字面量 ——
   今天的发射器会把调用点点观测拓宽（BUG-021），故单字面量域只可能来自本文件的域声明 / `entry@`）。
删除沿用既有「死段」路径（整段 + 尾随换行），填充 `EmitInterfaceResult.removed`，
发一条 info `nudo:interface-not-projectable`（「evidence disappeared — dropping its generated section…」），
人类面 `formatEmitSummary` 增一行 `removed: <names>`，机器面（`nudo contract --emit --json`）
增 `removed` 字段。

**重钉**：无（既有断言一条未动；`interface-emitter.test.ts` 的「update 无证据保留原段」用例
其段是宽域 ⇒ 不满足「可证明来自本文件」⇒ 原样通过）。

**残留**：① 宽域且来自本文件调用点的段，调用点消失后仍保留 —— **已收口**（见下
   「BUG-035 证据范围收口」：生成段记 `// evidence: local|external`，宽域段也能判定）；
   ② BUG-021 之前的旧侧车，点字面量 `--from` 段与见证段不可区分，可能被删
   （`--dry-run` 可先预览）；③ 只看顶层槽 ⇒ `shape({ x: lit(1) })` 形态的**旧**段保守保留
   （现格式下由 `// evidence:` 判定，不再受此限）；④ 带 `// derived-from:` 标签的段保留。

### 追加：BUG-035 证据范围收口 —— 生成段记录 `// evidence:`，宽域段也能判定刷新

**症状（上一轮收口后仍留的最后一条边界）**：删除陈旧段的判据只能「证明」**单点字面量**域的
证据在文件内（今天的发射模型把调用点观测拓宽，单点字面量只可能来自文件内 case/entry）。
**调用点来源的宽域段**（`fn({ x: number() }, number())`）与「`--from` 采集的使用现场记录来源段」
**逐字同形** ⇒ 调用点被删后宽域段只能保守留存（侧车继续承诺今天已不存在的域，与 `nudo check`
签名面矛盾）；反过来盲删又会丢掉 `--from` 段的用户契约。

**修法（侧车格式变更）**：
- `FunctionAnalysis.externalEvidence`（`analyzer-orchestrate-uncached.ts` 的合成路径）：本函数的
  callsite 证据是否混入 `--from` 外部记录。判据取**去重前**的匹配集 ⇒ 保守方向永远是「少删」；
  该字段是纯增量（`cloneFunctionAnalysis` 走浅展开，缓存回放不丢）。
- 生成段由三行变**四行**：`@generated` / `// source:` / `// evidence: local|external` / export
  （`interface-emitter.ts` 的 `sectionText`；`roundTrip` 自检同文本，故自检与写盘同源）。
- `section-provenance.ts`：新增 `sectionEvidenceScope()`；`sectionEvidenceIsInFile()` 改为
  「无 `derived-from` 标签 **且**（`local` 标记 **或** 旧侧车无标记时的单点字面量启发式）」。
  ⇒ `local` 宽域段在「今天没有证据」时可证「证据没了」⇒ 删段；`external` 段与旧侧车宽域段
  继续保留。旧侧车（无 `// evidence:` 行）行为**完全不变**；旧段在因内容变化被重写时自动带上标记。
- 标记是**确定性函数**（证据范围只取决于本轮是否用了外部记录）⇒ 二次发射逐字节相同。

**重钉（2 处，均为「当轮格式」更新，断言文本一条未动）**：
- `service/src/emit/__tests__/emit-bug-523-section-order.test.ts` 的 `SIDECAR` 夹具
  （注释即「首次 emit 生成的形态」）补 `// evidence: local` —— 该文件钉的是**段序不重排 /
  无改动**，不是段的行数。
- `lsp/src/__tests__/lsp-bug-196-single-writer-sidecar.test.ts` 的 `SIDECAR_CONVERGED`
  补 `// evidence: local` —— 该文件钉的是 add/update **逐字节收敛**，格式变更后收敛态随之更新。

**新回归**：`emit/__tests__/emit-bug-035-evidence-scope.test.ts`（7 例）—— ① 宽域 `local` 段
在调用点消失后被删（+ `removed` 台账 + info 诊断）；② `--from` 外部记录来源段带 `external`
标记、证据缺失时留存且逐字节不变；③ 旧侧车宽域段留存（迁移期零回归）；④ 旧侧车单点字面量段
仍按旧启发式删除；⑤ `derived-from` 段即使带 `local` 标记也留存；⑥ 标记确定性/幂等；
⑦ 本地与外部记录混合 ⇒ `external`（保守方向）。

**文档**：`packages/website/docs/guides/contract.md` 与 zh-Hans 镜像的侧车示例与 dry-run diff
示例补 `// evidence: local`（该行是两版之间的**上下文行**，hunk 头不变）。
