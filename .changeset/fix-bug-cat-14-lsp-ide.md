---
"@nudojs/lsp": patch
"@nudojs/service": patch
---

Fix bug-report category 14 (LSP IDE surface) — BUG-140.

- BUG-140: `nudo:internal` (analysis failed ⇒ the gate cannot decide the file) is now
  published on the LSP diagnostic face too, so the IDE no longer shows a file that the
  CLI rejects with exit 1 as completely clean. The diagnostic is emitted from the shared
  analysis path, so every consumer (CLI, LSP, vite-plugin) sees the same source, and the
  CLI's own `nudo:internal` output is unchanged (no duplicate).

The service-side emit of the diagnostic landed with the vite-plugin category commit
(`packages/service/src/analyzer-orchestrate.ts`); this changeset covers the LSP-facing
behaviour and its regression test.

Regression test: `lsp-bug-140-internal-diagnostic.test.ts`.

### 追加：本轮 IDE / CLI 面修复

`tmp/verify-bug.sh` 直接验证（exit 1 = 不再复现）：BUG-185、BUG-186、BUG-187、BUG-188、
BUG-201、BUG-202、BUG-227、BUG-235、BUG-236、BUG-237、BUG-262、BUG-263、BUG-274。
带新回归测试：BUG-024、BUG-034、BUG-071、BUG-090、BUG-091、BUG-104、BUG-105、BUG-133、
BUG-134、BUG-136、BUG-146、BUG-014、BUG-019、BUG-044、BUG-074（16 个新测试文件 / 44 例）。

口径变更（不是放宽断言）：

- **BUG-133**：数值 case 只改 `u` 自己的槽位并能清掉诊断；**shape 形参**那组 fixture
  改为**撤回**该 action —— 唯一可用的文本改写会命中返回槽，且可证明无法清除诊断，
  与其改错槽位，不如不给这个 action。
- **BUG-019 残留（语义未变）**：首次 `--freeze`（新增模式）写出的见证名仍是插入前
  坐标；`--freeze=update` 是修复路径（现已按最终文件坐标重算、保留已正确项、幂等）。

未修复（同一子系统，已定位）：

- **BUG-247 inlay 侧**：`packages/core/src/algebra/inlay.ts:304` 的 `generalizeFromAst`
  跑在 invariant 公理播种之外，`@nudo:invariant` 对 inlay 文本无效（公理与对照都打印
  `: number`）。播种入口 `invariantSpecsOf` / `assumePremisesPhiOf` 私有于
  `core/algebra/check.ts:672,831`，`withInvariantSpecs` 在
  `core/algebra/exec/runtime/state.ts:134` 且未从 `core/index.ts` / `core/internal.ts`
  导出。hover 侧已修（`=> 0 | number`）。
- **BUG-140 回归测试重基线**：`const x = undefinedGlobalAtTopLevel` 在 BUG-073 之后归
  类为 `module-throw`（不再走 `internal` 回落），测试改为断言「错误级诊断必须发布」
  的同一契约（细节见 cat-03 追加）。

既有测试更新（均为口径跟随，未删断言）：`lsp-bug-463-484-signature-param-names`
（detail 改为 BUG-091 声明的格式、签名标签解析出真实返回类型）、
`lsp-bug-711-nested-call-signature`（标签 `unknown` → 推断出的真实返回）、
`cli-bug-63b-path-errors-face`（干净 `test --json` 基线新增 BUG-014 要求的
`"errors": 0` / `"ok": true`）。

### 追加：三条回归的收口（env 诊断去重、调用点插入位、两条负控重钉）

- `validation.ts`：`checkToLspDiagnostics` 里 `collectCheckSupplementIssues` 会把 service 的
  `envUnresolvedIssues` 也发一遍，而 editor 面**已有**专属 env 通道（`validateText` 与 pull
  两处显式调 `envUnresolvedDiags`）⇒ 同一事实两条通道各发一次（**重复诊断** 1 → 2 条）；
  且 check 通道那份对「按名字记录」的条目（`e.path` 是名字本身、非绝对路径）**不按本文件
  env 名单过滤** ⇒ 同目录别的文件的无 path 诊断被**误吸**。修：check 通道跳过
  `DIAG.envUnresolved`，事实归属交给 live 通道（它按本文件 env 名单/路径双向收窄，且缓存
  命中轮仍发布）。解锁 `env-unresolved-diag`（4 条）与 `lsp-bug-470-937` 第 2 条。
- `server-code-actions.ts`：BUG-263 的形参身份把「形参位实参不是对象字面量」一律判为不可
  插入，而该实参若是**原始值字面量**（string/number/bool/null/bigint/template），运行时**不
  可能**是对象 ⇒ 形参身份自相矛盾、回落「唯一对象字面量实参」口径（多个仍不猜；表达式仍
  不下发，保住「绝不猜位置」）。解锁 `lsp-bug-737`（2 条）。
- 两条 signatureHelp **负控**钉的 `(a: any, b: any) => unknown` 正是 **BUG-104** 判红的症状
  （声明空壳 label 与同面 hover / CLI 互斥）；空壳不采纳后给精确签名
  `(a: any, b: any) => number | string`（`a + b` 两侧 `any` ⇒ JS `+` 的 ToPrimitive 并集）
  ⇒ 按 BUG-104 声明的正确行为重钉 label，`parameters` 长度/参数名断言原样保留。

### 追加：BUG-135 与 BUG-247 收口（relax 真写推断面；inlay 内部 id 不外泄）

- **BUG-135**：动作标题与 CLI 机器面都承诺「放宽到**推断面**」，但唯一实现只做
  `stripNumericPreds` ⇒ 落盘 `number()`（基类型），既不是推断面、也**消不掉**诊断
  （`any ⊭ number()`），且没有落盘后验证门。修：`lsp/src/a6-relax.ts` 新增
  `relaxSidecarReturnToSurface()`（把 `fn(…, <返回槽>)` 的**第二个顶层实参**整体改写为给定推断面
  文本，含括号 / 字符串 / 注释感知的实参切分）；`server-code-actions.ts` 取 **check 同源**推断面
  （`checkSource` → `NudoSig.abs`，与 CLI 签名行 / hover 同源）渲染为侧车文本（精确投影 ⇒
  `lit(0)` / `number().gt(40)` / `union(lit…)`；`any` ⇒ `any()`；widened/partial prim ⇒ 基类型），
  并加**落盘后验证门**（`sidecarRelaxClearsTarget` 增 `codes` 参数，重跑 check；诊断残留或界面
  装载失败 ⇒ **不下发**，与 BUG-134「不给消不掉诊断的假修复」同例）。
- **BUG-247（inlay 侧）**：`entrySeedsOfFn` 的播种本身是对的（inlay 已随 `@nudo:invariant` 变
  `0 | number`）；残留真缺陷在**渲染**——`invariant-apply.ts` 铸造的内部 id `inv#N` 只在成员
  顶层 `var` 处被拦，循环值参与算术时（`inv#2 + 1` 是 **app** 项）漏网 ⇒ IDE 印
  `: inv#2 + 1 | NaN`，而 check / hover 印 `number | NaN`（内部 id 上屏 + 两面互斥）。修：
  `core/algebra/inlay.ts` 新增 `hasInternalInvId()` 走**整棵 term 树**，命中即退形状
  （`formatShape`），与 check 面同一位置渲染同源。回归含**真 LSP server** 的 hover / inlay 逐字对拍。

### 追加：BUG-196（add 面）—— add 模式新建的直写段也要带 `// derived-from:` 溯源行

**症状**：`nudo.contract.emit` 的 **add** 模式下，本轮直写分支新建的段**永远不带**溯源行。
根因是两步顺序的合成：① 直写分支（dry-run）把新段追加进基底 D；② 派生分支以 D 为基底时
`findGeneratedSectionText` 在 D 里找到了这个**刚建的**段 ⇒ 命中 add 面「既有段不可动 ⇒
`no-change`」跳过 ⇒ 标签行被丢弃。后果：add 面与 update 面对同一份输入收敛出不同字节，
且下游「靠 `derived-from` 反查根」失去锚点。

**修法**（不改 add 面「既有内容不动」的契约，只区分「本轮新建」与「此前既有」）：
- `packages/service/src/emit/interface-derivation-emit.ts`：`emitDerivedFromRoot` 新增可选
  `directCreatedSections`（= **本轮**直写分支新建的段名）。add 面只在
  「直写负责（`directSections`）+ 本轮新建（`directCreatedSections`）」时允许把标签行并进去；
  此前既有的段仍走原 `no-change` 跳过。合并后与既有段逐字相同 ⇒ 仍按 `no-change`（不空转 rewrite）。
- 组装面：这类段**已在基底里** ⇒ add 面必须**就地替换**（新增 `replaceSectionsInPlace()`，
  段边界同 `collectGeneratedSectionsRaw`：`@generated` 头 → export 语句末，段外字节与段序逐字保留）；
  旧实现只做「追加」，会把同一导出名写成两段（非法 ESM ⇒ 整份侧车装载失败）。既有新段的追加路径不变。
- `packages/lsp/src/agent-tools.ts`：`serializedEmit` 在 `mode === "add"` 时传
  `directCreatedSections: new Set(direct.written)`（add 面 `written` 恰好 = 本轮新建段；update 面
  无此语义，不传）。CLI 不受影响（`contract-emit.ts` 的派生分支恒为 `mode: "update"`）。

**回归**：`lsp-bug-196-single-writer-sidecar.test.ts` 的 add 用例扩为断言
「直写正文 + `// derived-from: lib.js:tag` + 同一段只有一份 + 收敛态逐字节（与 update 面相同）+
根侧车只写一次」；新增 add 幂等用例（第二跑逐字不变、不写盘、不报 `Updated`）。
