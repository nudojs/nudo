---
"@nudojs/core": patch
"@nudojs/service": patch
"nudojs": patch
---

fix(service): 分析器 / 模块图 / 缓存面（BUG-011/012/070/089/101/127/129/139/152/170/171/205/206/207/238/239/240/241/267/268/269/270/273）

模块解析与缓存：

- BUG-238/240 — 裸包 `import` 的 spec 现在携带 `mode` 并解析到真实文件（而非包名占位），模块图边与调用点记录据此建立。
- BUG-239 — `exports` 条件键按 package.json **声明顺序**求值；`browser` 仅作兜底，不再无条件优先。
- BUG-267 — pattern 键按 Node `PATTERN_KEY_COMPARE` 取最具体匹配（`./x/*` vs `./x/*.js`）。
- BUG-268 — 裸包解析在**最近的已存在** `node_modules` 停止；未命中的 `exports` 不再被上层包无声清空为 `exportsUnresolved=false`。
- BUG-269 — 歧义 `export *` 名称不再导出；导入方得到 `nudo:missing-export`，与 Node 的「模糊即不存在」一致。
- BUG-270 — `exports` 数组回退只发生在 target **非法**时；合法但文件缺失是终止态（`ERR_MODULE_NOT_FOUND`）。
- BUG-273 — `esm` 目录导入不再猜测 `index.*`；`legacy main` 保留该行为。
- BUG-241 — 磁盘缓存键的入口维度带项目根指纹，依赖维度仍可移植（跨项目不再互相污染）。
- BUG-012 — 函数缓存 `envKeyFn` 补上 `@nudo:env` 内容指纹，与另外两层缓存口径一致。

调用点与报告：

- BUG-070/170/171 — 同名调用点仅在冲突时加列号（`call@L6C9`）；`--from` 目录与重复调用点在合成前去重（先解析再按站点点位去重）。
- BUG-089 — 仅当本文件在该行列确实存在调用表达式时才附加 `callSiteFile`。
- BUG-127 — `dedupeCallRecords` 的键纳入调用点身份，不同站点的同名调用不再互相吞并。
- BUG-205 — 期望值判定统一走共享 `inferenceFailed`，并检查 `term`：`lit(null)` / `lit(undefined)` 是 exact，不是第三种「推断失败」态。
- BUG-206 — `never` 期望不再走「满足」短路。
- BUG-207 — 嵌套槽位谓词（`shape({ n: number().gt(0) })`）参与判定并按递归 `formatExpected` 渲染；CLI 报告面改用 service 的 `formatExpected`。
- BUG-011 — 空调用记录不再解引用 `deduped[0]`。
- BUG-101 — `isNudoTargetPath` 接受 `.cjs/.mts/.cts`（排除 `.d.mts/.d.cts`），`migrate retire` 的 `nudo check .` 与 `VERIFY_TARGET_EXTS` 对齐。
- BUG-129 — 空 `--from` 目录报 `nudo:path-empty-dir`。
- BUG-139 — 静态成员扫描白名单化节点类型，`ClassProperty` 不再被当作方法。
- BUG-152 — 匿名 `export default class` 注册到 `default` 槽位。

已更新的既有测试（原断言钉住声明的错误行为）：

- `service/src/__tests__/resolve-npm-exports.test.ts` — 数组回退改为「首个合法 target 即终止（即使文件缺失）」。
- `service/src/__tests__/disk-cache.test.ts` — 入口缓存键带项目身份，依赖键保持可移植。
- `service/src/__tests__/target-path.test.ts` — `.cjs` 由拒绝改为接受，新增 `.mts/.cts`。

已知未修（根因在本类文件之外，另行跟踪）：BUG-019（行号重映射在 `emit/case-emitter.ts`）、BUG-022（entry 结算重入语义未定）、BUG-045（CJS `module.exports` 成员导出面）、BUG-069（生成比较在 `emit/case-emitter.ts`）、BUG-085（`withAssumePremises` 未从 core 导出）。

### 追加：本轮分析器面修复

- **BUG-022**：`settleEntryOnlyCandidates` 不再删除注册表条目；记录增长时先摘掉上次合成的 case
  再按**全量**记录重合成 ⇒ 调用点先出现 `f(3)` 与后出现 `f(3)` 得到同一组见证
  （`3 witnesses，call@L5/8/11`）与**逐字节相同**的 `--emit --dry-run` 契约。
  测试：`service-bug-022-callsite-domain-order.test.ts`。
- **BUG-045**：`tryEvalCallFull` 走 core 的 cjs-member 语义（对 `exports["default"]` 做
  `$invoke`），并在合成调用记录里过滤无位置记录 ⇒ `obj.js`（`module.exports = {…}`）与
  `dot.js`（逐成员导出）在 dts/schema/guard 三面**逐字节一致**（dts 由 `unknown` →
  `number | string`）。测试：`service-bug-045-cjs-object-export-member`、
  `cli-bug-045-cjs-object-export-face`。
- **BUG-099（递归 / fork 两臂）**：分析器为**整轮**装截断收集器（串到 `eval-run` 的嵌套
  collector，否则单槽会被静默覆盖），标签映射到 `nudo:recursion-truncated` /
  `nudo:fork-truncated`，文案与 `check` 同口径 ⇒ `nudo test` 与 `--json`
  （`summary.diagnostics`）都可见。测试：`service-bug-099-*`、`cli-bug-099-*`。
  循环臂（`nudo:loop-truncated`）此前缺 core 导出，现已补
  `LOOP_TRUNCATION_LABEL`（`@nudojs/core/internal`），接线待做。
- **BUG-069** 的发射侧（见证等价按「文件 + 实参载荷」）已由 emit 类修复并回归；
  本条**未修的是 CLI `--freeze` 新增模式的坐标**（见 BUG-019）。
- **BUG-085** 已修：`runAbsView` 现把 `extractAssumeSegs` 的 `ok` 段折进**前提槽**
  （`withAssumePremises`，不是 `phi`），详见 cat-09 changeset。
- **BUG-099 循环臂已修**：`truncationDiagnostics` 增加 `label === LOOP_TRUNCATION_LABEL`
  分支，且必须排在 `label.startsWith("#")` 兜底**之前**（兜底会把 `#loop-iterations`
  静默吞掉）。`nudo test` / `--json` 现报 `nudo:loop-truncated`，文案与 `check` 面逐字一致
  （「A loop did not terminate within its iteration budget …」），anchor 为文件起点 1:0
  （事件不带函数归属，check 面同样无位置）。回归：
  `service/src/__tests__/service-bug-099-loop-truncated.test.ts`。
  注：loop 迭代预算不在 `@nudo:budget` 覆盖范围内，故建议文案不提该指令。

### 追加：可见性判据（`gateFatal`）与 `./internal` 快照

- `analyzer-orchestrate.ts` 的 per-file 失败信号判据改为
  `f.reason === "internal" || f.gateFatal === true`（**标签 ≠ 可见性**）：BUG-073 把装载期
  逃逸改标 `module-throw` 后，原判据（只收 `internal`）会让 `evalFailures` 变空 ⇒ 闸门丢掉
  「模块装载失败 ⇒ 不得判绿」（BUG-072）。三条假红防线（`unsupported:*` / 建模内
  `NudoThrow` / 干净文件）不变。
- `service/eval-run.ts` 的「引擎产出非 Abs 值」回落改传 `origin: "engine"`（引擎自身违约
  ⇒ `internal`，与该 guard 的既有语义一致）。
- `packages/core/public-api.snapshot.json` 追加 4 个 `./internal` 导出（引擎机件面，语义上
  允许 minor 变动）：`LOOP_TRUNCATION_LABEL`、`extractAssumeSegs`、`isPointConstraint`、
  `widenObservationAbs`，以及类型 `AssumeSeg`；`public-api-freeze` 测试随之复绿。
