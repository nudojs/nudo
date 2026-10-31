# @nudojs/lsp

## 1.8.3

### Patch Changes

- 9ff1709: Fix bug-report category 14 (LSP IDE surface) — BUG-140.
  
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
- 37e9aa0: Fix bug-report category 17 (vite-plugin gate surface).
  
  - BUG-110: the plugin's report face and gate face agree on `ignoreThrows`, so the same
    project no longer yields contradictory verdicts between the two faces.
  - BUG-111: project-level env is resolved from the project root rather than the importing
    file's directory, and env-module exports are merged with `mergeHarvestUnderEnv` instead
    of object spread — so adding an unrelated `@nudo:env` line no longer flips the gate from
    green to red, and harvest-only exports are no longer dropped.
  - BUG-221: project-level env resolves against the project base dir, so the plugin gate
    matches the evaluator.
  - BUG-222: a project-level env load failure is no longer silent in the plugin; it reports
    `nudo:env-unresolved` like the CLI and LSP instead of a false green.
  
  Regression tests: `vite-bug-110-*`, `vite-bug-111-*`, `vite-bug-221-*`, `vite-bug-222-*`.
  
  Note: BUG-140 (listed in this category file but whose defect is the LSP diagnostic face
  missing `nudo:internal`) is NOT covered here; it belongs to category 14.
- Updated dependencies [51e69f8]
- Updated dependencies [51b510a]
- Updated dependencies [aed8e00]
- Updated dependencies [e4190b5]
- Updated dependencies [6daa52e]
- Updated dependencies [206713f]
- Updated dependencies [0650ef0]
- Updated dependencies [fe03e18]
- Updated dependencies [250f0ba]
- Updated dependencies [d4ab7fb]
- Updated dependencies [9ff1709]
- Updated dependencies [37e9aa0]
  - @nudojs/core@1.17.2
  - @nudojs/service@1.10.3
  - @nudojs/parser@1.5.6

## 1.8.2

### Patch Changes

- Updated dependencies [d726525]
  - @nudojs/core@1.17.1
  - @nudojs/service@1.10.2
  - @nudojs/parser@1.5.5

## 1.8.1

### Patch Changes

- 0438f10: Fix evaluator correctness and remove duplicated machinery:
  
  - Respect user bindings named `undefined` / `NaN` / `Infinity` (module bindings, parameters) instead of unconditionally folding them; keep exact literal folding for unshadowed reads, suppress undefined-literal narrowing facts when the name is bound, and honor the same bindings in callee position (`NaN(1)`) and at the expression entry (declarations inside the expression itself).
  - Separate private top-level functions from the module export surface: `export *` precedence is restored, private named imports now report `nudo:missing-export`, `transpileSource` no longer emits `export` for private functions, and analysis keeps a non-enumerable local-function table (so same-name re-exports/CJS exports do not shadow analyzed locals).
  - Make the generated runtime import list a single source of truth (it is now self-consistent with `@nudojs/core/exec`), dedupe `RUNTIME_IMPORT_RE`, and share the `new Function` compile scaffold.
  - Dedupe the A/B call budgets and the two `@nudo:pure` memo caches behind shared factories; either public clear API now invalidates both.
  - Single-pass, memoized function facet analysis; dedupe Error/mutator/class-chain/nullish tables; remove dead service evaluator modules.
  - Split the evaluator's largest dispatch functions (`$invokeInner`, `$get`/`$set`, `invokeArrMethod`, `transpileStatement`) and move narrowing ops out of `runtime/async.ts`.
- Updated dependencies [0438f10]
- Updated dependencies [6ebf5a4]
  - @nudojs/core@1.17.0
  - @nudojs/service@1.10.1
  - @nudojs/parser@1.5.4

## 1.8.0

### Minor Changes

- e6c4586: agent 工具面的载荷**新增**了 `assertions` 段 / `pathErrors[]` 段与新诊断码
  （`nudo:path-not-found` / `nudo:path-not-target`）；`@nudojs/service` **新增**了
  一批公开导出（`mergeCheckIssues` / `directiveDiagIssues` / `mockFromErrorIssues` /
  `envUnresolvedIssues` / `collectCheckSupplementIssues` / `buildTestReport` /
  `pathNotFoundError` / `targetPathError` / `formatPathErrorText` 等）⇒ 纯**增量**
  （additive）⇒ minor。
  
  LSP agent 工具面（`nudo/check` / `nudo/test`）与 CLI 的通道对齐：补回
  check 的补充诊断通道、test 的断言汇总、imported 段、路径错误信封与
  「分析目标」闸门。
  
  - `nudo/check` 此前只跑裸 `checkSource`，CLI 侧并入 check 报告的三条补充
    通道（指令文法 `nudo:directive-syntax`、mock 装载失败
    `nudo:module-missing`、path env 未解析 `nudo:env-unresolved`）一条都没接
    ⇒ 同一文件 CLI / LSP 编辑器面 / agent 面给出三份 issue 集（agent 面把
    「指令写错了」整条吞掉，mock 文件缺失判绿）。并入逻辑下沉到
    `@nudojs/service`（`mergeCheckIssues` / `directiveDiagIssues` /
    `mockFromErrorIssues` / `collectCheckSupplementIssues`），三面共用同一份。
  - `nudo/test` 此前没有 `assertions` 段 ⇒ 消费方分不出「见证通过」与「见证
    失败」。现在并入与 CLI `nudo test --json` 同口径的
    `assertions`（passed / failed / unchecked，service 的 `buildTestReport`）。
  - `nudo/test` 的文本面此前**不渲染** imported（外部）函数 ⇒ CLI 有的
    `(imported)` 段在 IDE 面整段消失，而头部计数仍把外部 case 算进去
    （「3 case」只印 2 条）。现在按来源模块分组渲染，段头
    `--- <mod> (imported) ---`。
  - `nudo/test` 的 `functions` 过滤只重算**本地** case 数 ⇒ `summary.cases`
    与自身 payload 矛盾（summary 说 1、payload 躺着 2）。外部函数不在过滤
    范围内，其 case 仍留在 payload 里 ⇒ 计数改为与 payload 同源。
  - `nudo/check` / `nudo/test` 此前没有「分析目标」闸门 ⇒ 对侧车契约文件报
    「0 fn / 0 error」判绿（CLI 对同一文件 exit 1「Not an analysis
    target」），`nudo/test` 还把契约 DSL 构造器（`fn(...)` / `shape(...)`）
    当成真实调用点报成 case。入口现在复用与 CLI 同一份目标判定
    （`isNudoTargetPath` + 侧车 / `.d.ts` / JSX 排除），非分析目标返回
    `nudo:path-not-target`。
  - `nudo/check` / `nudo/test` 此前对不存在的文件只返回裸 `ENOENT` 文本
    （`format:"json"` 也不返回 JSON）。现在走结构化路径错误通道
    （`pathErrors[]` + `nudo:path-not-found` + suggestion），与 CLI
    `check --json` / `test --json` 同构。
  - `nudo/test` 的 `functions` 入参此前零校验：传字符串被逐字符建集合（函数
    全被滤掉 ⇒ 全空报告的假空结论），传数字 / 对象时过滤被整体跳过（静默
    失效）。畸形入参现在一律工具错误（`isError: true`）。
- e6c4586: 三个 contract 工具**新增**入参 `from?: string[]`（`--from` 等价通道），`@nudojs/service`
  **新增**公开导出 `collectCallsiteRecords`（+ 类型 `CallsiteRecords`）⇒ 纯**增量**
  （additive）⇒ minor。
  
  fix(lsp,service): 族 25 A2 —— 契约面四条缺陷（762 / 765 / 766 / 994）
  
  - **762** `nudo.contract.emit` 现在与 CLI `nudo contract --emit` **同序同口径**：
    先 `emitDerivedFromRoot`（root 驱动下行推导），再 `emitInterface`（本地侧车）。
    此前工具**从不**调派生步 ⇒ CLI 写得出的下游侧车（`add.nudo.js`）在 IDE 面
    永远不产生，且结果文本把「引擎没做的那一步」说成「name-clash」——误导性诊断。
    下游侧车的写盘边界与本地侧车同口径（必须落在 workspace roots 内）。
  - **765** 源文件 open buffer 与磁盘文本不一致时**拒绝写盘**（可诊断错误：
    save or discard before emit）——此前只挡了侧车自己的脏 buffer，源文件的脏
    buffer 会把**未保存**的代码形状写进侧车，磁盘源码却一个字节没变。
  - **766** emit 写盘边界改按**路径分量**判定逃逸（`..` 或 `..` + 分隔符），
    不再误杀 `..dotted.js` / `...triple.js` / `..cfg/x.js` 这类合法路径名；
    root 外的文件与指向 root 外的符号链接**仍然拒绝**。
  - **994** 三个 contract 工具（`nudo/contract` / `nudo/contract.draft` /
    `nudo/contract.emit`）新增 `from?: string[]`（`--from` 等价通道）：跨文件
    调用点证据参与契约求解，接口面/草稿/落盘与 CLI `nudo contract --from` 同口径。
    证据采集下沉到 service：新增导出 `collectCallsiteRecords`（+ 类型
    `CallsiteRecords`）。
- e6c4586: **BREAKING**: 既有 `nudo/…` 请求的**响应信封**变了。
  
  - `nudo/trace` / `nudo/suggestCase` 的失败路径此前**不带** `isError: true`
    （失败被当成成功，客户端只能从正文分辨）⇒ 现在失败路径返回 `isError: true`
    （MCP 风格）⇒ 按「有没有 `isError`」分支的客户端行为变了；
  - `nudo/hover` 现在**校验**位置参数：非整数 `line` / `column` 此前被原样回显
    且所有分析字段为 `null`（与「此处无 hover」不可区分），现在答**工具错误**；
    `column` 缺省为 `0` ⇒ `{ file, line, column, … }` 的载荷形状恒成立。
  
  谁会坏：把失败响应当成功处理的客户端（`nudo/trace` / `nudo/suggestCase` 的失败
  现在带 `isError: true`）；以及用非整数 `column` 调 `nudo/hover` 探测「此处有没有
  东西」的客户端（现在拿到的是工具错误而不是一个全 `null` 的载荷）。
  
  怎么迁移：客户端按 `isError` 分支处理失败；`nudo/hover` 只传整数 `line` /
  `column`（`column` 缺省即 0）。
  
  Fix agent-tool (LSP) defects found by the族 25 audit:
  
  - **767** — `nudo/trace` / `nudo/suggestCase` failure paths now return `isError: true` (MCP-style), so a failed call is distinguishable from a successful one at the protocol level instead of only in the text.
  - **768** — `nudo/hover` validates its position arguments: a non-integer `line` / `column` is a tool error (previously the value was echoed back with every analysis field `null`, so "no hover here" and "my argument was the wrong type" were indistinguishable), and `column` now defaults to `0` so the documented `{ file, line, column, … }` payload shape always holds.
  - **961** — `nudo/whatIf` validates its arguments: a missing `target` is a tool error (previously a fake success reporting `Type of "undefined": unknown`), a non-array `bindings` is a diagnosable tool error (previously a raw `bindings.map is not a function`), and a binding without `name` is rejected instead of silently doing nothing. `injectBindings` in `@nudojs/service` gained the matching shape guard and names the offending entry (`<missing name>`).
  - **993** — the observing agent tools (`nudo/whatIf`, `nudo/suggestCase`, `nudo/trace`) now analyse through the asynchronous entry point, which preloads path-based `@nudo:env` modules. Their output no longer depends on whether the file happens to be open in the editor (previously the same file and tool could answer `never`/`unknown` or `99` depending on call order, together with a misleading "Built-in API is not covered" diagnostic). The analysis caches additionally key on the env **preload state** so a synchronous analysis taken before the preload can no longer feed a stale "no env" result to later calls.
  - **955 (shared entry)** — `normalizeFilePath` now rejects a non-string / empty / missing `file` with a diagnosable `file is required …` tool error instead of leaking a raw `file.startsWith is not a function` TypeError (or silently falling back to the server's working directory). Every agent tool goes through this shared entry point.
- e6c4586: **BREAKING**: LSP **协议契约**变了（`packages/lsp/PUBLIC_API.md` 这份**冻结清单**
  本版本同步更新）。
  
  - `nudo.selectCase` / `nudo.selectContract` 的失败面此前是 `{"success": true}`
    （对不存在的函数、对空调用都答成功）⇒ 现在答
    `{ success: false, error, isError: true }`；
  - `workspace/executeCommand` 上的**未知命令名**此前答 `result: null`（与
    「命令跑了但没产出」不可区分）⇒ 现在答协议级 `MethodNotFound` 错误。
  
  谁会坏：按 `success` 分支处理 `nudo.selectCase` / `nudo.selectContract` 的客户端
  （失败路径的 `success` 现在是 `false`）；以及靠 `result === null` 判「命令不存在」
  的客户端（现在收到的是 JSON-RPC 错误）。
  
  怎么迁移：客户端按 `{ success: false, error, isError: true }` 处理失败；用
  JSON-RPC 错误码判「命令不存在」（`MethodNotFound`）。
  
  The LSP editor commands now tell the truth: a selection that did not happen
  is reported as a failure, and the mirrors a selection touches are refreshed
  together.
  
  - `nudo.selectCase` validates its arguments before touching the active-case
    table. A `caseIndex` outside the function's `@nudo:case` list used to be
    accepted: `-1` crashed the analysis (`Cannot read properties of undefined
    (reading 'argsAbs')` in the diagnostics) and `99` silently replaced the
    observation slot. A `functionName` that is not a function of the target
    file used to be stored as-is, so `nudo.getActiveCases` reported ghost
    entries such as `{"":0}`. Both now return a structured error and leave the
    table untouched.
  - `nudo.selectContract` validates that the target function exists in the
    file. It used to answer `{"success":true}` for a function that was never
    there (and for a call without any arguments at all), so the client could not
    tell a real switch from a no-op.
  - A selection refreshes the inlay hints and the pull diagnostics as well as
    the code lenses. Only the code lenses were refreshed, so a client without
    code lens support kept showing the previous case, and a pull-diagnostics
    client never saw the diagnostics of the newly selected case.
  - `file` / `uri` arguments must be non-empty strings. A non-string `file` used
    to escape as a bare `TypeError` (`file.startsWith is not a function`), which
    reached the client as a JSON-RPC protocol error instead of a tool error
    carrying `isError: true`; a missing `file` silently fell back to the
    server's working directory.
  - An unknown command name on `workspace/executeCommand` now fails with the
    protocol-level `MethodNotFound` error instead of answering with a `null`
    result, which was indistinguishable from "the command ran and produced
    nothing".
- e6c4586: **BREAKING**: LSP **协议契约**变了（`packages/lsp/PUBLIC_API.md` 这份**冻结清单**
  本版本同步更新）——
  
  - 失败面统一成 `{ success: false, error, isError: true }`：
    `nudo/selectCase` / `nudo/selectContract` / `nudo/getActiveCases` 此前对
    非法入参**答 `{"success": true}`**（或幽灵条目），现在答结构化错误信封 ⇒
    客户端按 `success` 分支的代码路径变了；
  - `AGENT_TOOL_SOURCES` 的**值**同步为新的共享数据源（`analyzeFile` →
    `analyzeFileAsync`；`check` → `checkSource + mergeCheckIssues +
    serializeCheckJson`；`test` → `analyzeFileAsync + buildTestReport +
    serializeCaseJson`）⇒ 依赖这张表反推「命令 ↔ 数据源」的客户端读到不同的值。
  
  谁会坏：把 `nudo/selectCase` / `nudo/selectContract` 的**失败**当成功处理的
  客户端（此前恒 `success:true`，现在会拿到 `success:false` + `isError:true`）；
  以及读 `AGENT_TOOL_SOURCES` 做能力判断的客户端。
  
  怎么迁移：客户端按 `{ success: false, error, isError: true }` 分支处理失败
  （`packages/lsp/PUBLIC_API.md` 与两份 API 文档已同步）；不要再按
  `AGENT_TOOL_SOURCES` 的**字面**判能力，改按命令名判断。
  
  `@nudojs/service` 侧**新增**公开导出 `pathEnvPreloadFingerprint` ⇒ 纯**增量**
  （additive）⇒ minor。
  
  族 25 收口接线（6 项）：把跨片耦合的缺口补上，并让文档与工具面说同一件事。
  
  - **`testTool` 改异步入口**（Bug 993）：A4 把 `whatIf` / `suggestCase` / `trace`
    改成了 `analyzeFileAsync`（path 型 env 只能异步预载），但 `testTool` 属另一片
    的函数级边界 ⇒ 冷进程 `nudo/test` 首调仍是 env-less（`"unknown"` + 1 条误导
    诊断）。⇒ 改 `async` + `analyzeFileAsync`（**签名变更**：
    `AgentToolResult` → `Promise<AgentToolResult>`），同步调用点与既有测试。
  - **`AGENT_TOOL_SOURCES` 值同步**：工具面真换了数据源，表与文档要跟着走 ——
    `check` → `checkSource + mergeCheckIssues + serializeCheckJson`、
    `test` → `analyzeFileAsync + buildTestReport + serializeCaseJson`；同步
    `packages/lsp/PUBLIC_API.md` §5、`packages/website/docs/api/agent.md` 与
    `AGENT_TOOL_SOURCES` 的值钉。
  - **`nudo/contract.emit` 转发 `from`**（Bug 994）：三个 contract 工具已支持
    `--from` 等价通道，但协议入口 `makeHandleContractEmit` 只构造
    `{file, functionName, mode, dryRun?}` ⇒ **`from` 到不了 emit 工具** ⇒ 补
    入参类型 + 透传。
  - **CJS 导出的 hover 面**（Bug 998）：`findFunctionNameAtPosition` 没有
    `MemberExpression` property 分支 ⇒ `module.exports.alpha = function () {}`
    的 hover 回退成无名 `(x) => ?`（诊断面认得它、hover 面不认 ⇒ IDE 内部
    自相矛盾）⇒ 补分支（祖父节点走 `path.parentPath.parent` —— Babel 的
    `node.parent` 不存在）。
  - **失败面文档同步**：`selectCase` / `selectContract` / `getActiveCases` 的失败
    面统一为 `{ success: false, error, isError: true }` ⇒ 两份 API 文档的返回面
    记载同步；`nudo/contract.emit` 的 `from?: string[]` 参数也补进文档。
  - **`pathEnvPreloadFingerprint` 的瞬时 ReferenceError**：族内 build 前
    `dist` 落后于 `src` 造成的一次性混用 ⇒ 随本族 build 消失（已连跑 5 次
    复现不出）。

### Patch Changes

- 0f67015: fix: 并发 review 收口的 25 条缺陷 + 4 条跨文件尾巴（CI 闸门假红/假绿 · 自相信值 · 机器面口径漂移）
  
  本片是一次**并发 review**（8 个分片）收口的结果：25 条缺陷全部修复，另补
  4 条 worker 报告的跨文件尾巴。核心是**闸门可信度**——`nudo check` 是 CI
  闸门，假红会卡死用户仓库、假绿会让门禁空转。
  
  ### 高危（5 条 · 闸门级）
  
  - **L2 实例方法桥把**构造器**的 throws 归因给方法**（`core/algebra/check-may-throw.ts`）：
    实例桥用 `ctorAnyArgs`（全 `any`）跑构造器 ⇒ 构造器里的强制转换 TypeError
    被算进**方法**的 throws 域 ⇒ 普通类即触发 error 级 `nudo:entry-may-throw`。
    修法：构造器改在**独立 may-throw 会话**里跑（证据隔离、副作用保留）⇒
    构造器的 throws 归因给 `new C()` 入口而非方法；构造器抛时退**裸实例**
    继续求值方法体 ⇒ 方法自身的证据照常收集（闸门不整体关掉）。
  - **`async function*` **声明**体的 `await` 发射成裸 `yield`**
    （`core/algebra/exec/transpile/stmt/statement.ts`）：缺 `stmt.generator !== true`
    守卫 ⇒ 产物是非法 JS ⇒ **整模块 fail-closed** ⇒ 全部导出退 unknown/opaque ⇒
    error 级 `nudo:entry-may-throw` 降成 INFO `nudo:opaque-result`（门禁假绿）。
    修法：与函数表达式 / 对象方法 / 类方法三条兄弟路径对齐。
  - **Proxy `getOwnPropertyDescriptor` 陷阱违反 [[GetOwnProperty]] 不变量**
    （`core/algebra/builtins/object/descriptor.ts`）：引擎照抄陷阱的值 ⇒ 自信的
    错值。修法：以 **node v26.10.0 实测矩阵**（82 例零偏差）反推完整谓词 ⇒
    补齐「靶无该自有键」「可配置性不一致」「不可配置属性的 writable /
    enumerable / value 冻结」「数据 / 访问器描述符不得混报」四档。
  - **`Object.getOwnPropertyDescriptors` 丢 symbol 键自有属性**
    （`core/algebra/builtins/object/methods.ts`）：原生走 `[[OwnPropertyKeys]]`
    **含** symbol 键 ⇒ 结果对象少一个自有属性。附带修正 `builtins/invariants.ts`
    把 gOPDs 列进「只枚举字符串键」的**事实错误**注释。
  - **`Uint8ClampedArray` 元素先截断再钳位**（`core/algebra/builtins/error/binary.ts`）：
    `ToUint8Clamp` 是就近偶数取整、**不**向零截断 ⇒ 改传未截断值。
  
  ### 中危（9 条）
  
  - **`strip-types` 把构造器参数属性赋值插到 `super()` 之前**
    （`core/src/strip-types.ts`）：派生类产物在 `new C()` 时抛 ReferenceError ⇒
    `migrate` 是一程闸门（无回退）且 `node --check` 只验语法 ⇒ 静默写出坏代码。
    修法：按 tsc emit 口径插到 `super(...)` **之后**；找不到顶层 `super(...)` 时
    保持源自身的失败形态并产出一条 note（`nudojs/src/migrate.ts` 侧透出）。
  - **`Object.setPrototypeOf(Object.prototype, null)` 过拒绝**
    （`core/algebra/builtins/object/methods.ts` · `objects.ts`）：按 ES2024
    10.4.1.2（`[[SetPrototypeOf]]` 只在 V **非 null** 时抛）+ node v26 实测
    **放行 null**、仍拒非 null ⇒ 不再与原生/规范冲突（无需登记架构债）。
  - **`Reflect.ownKeys` 的 symbol 键排在字符串键之前**（`core/algebra/builtins/reflect.ts`）：
    按 ES2024 `OrdinaryOwnPropertyKeys` 改两段排列。
  - **`arr` 形参 × `tuple` 实参的 α 绑定只取首元素**（`core/algebra/hof.ts`）：
    异构数组字面量 `[1,"a"]` ⇒ `T := number` ⇒ 返回 `number[]`（**窄于**真实类型）
    ⇒ 把「不知道」升级成「知道」。修法：元素域取全部元素的同型 join，异构退 `any`。
  - **项目级 path env 按「被分析文件目录」解析**（`service/src/check-issues.ts` ·
    `service/src/analyzer-orchestrate.ts` · `lsp/src/validation.ts`）：假阳（报
    不存在的路径）+ 假阴（项目级 env 真实失败被静默丢弃）⇒ 改两层基准
    （项目级按项目根 / 文件级按文件目录），与 CLI 同口径。
  - **`check --json --watch` / `test --json --watch` 的路径错误早退分支打 pretty
    JSON**（`nudojs/src/commands/check-command.ts` · `test.ts`）：破坏 watch 面
    「stdout = JSON Lines」契约（机器消费者第一行即炸）⇒ 三动词统一一行一份 JSON。
  - **`migrate strip --json` 的 `pathErrors[].path` 混用目录 / 文件量纲，且同目标内
    成功文件的逐文件结果被整条丢弃**（`nudojs/src/commands/migrate.ts`）⇒
    逐文件隔离在 CLI 面等于没生效 ⇒ 失败条目改用文件路径、成功行进 `results`。
  - **vite-plugin：工程根含软链时全部源文件被判为「依赖」**
    （`vite-plugin/src/scope.ts` · `index.ts`）：`resolve()`（不解析软链）对比
    `realpathSync()`（解析软链）⇒ 整工程被 skip 且**零日志**（静默空转）⇒
    两侧都取 realpath 再比；root 改为按插件实例持有（同进程第二个 Vite config
    不再覆盖第一个的 root）。
  - **zh-Hans 镜像未跟随 en 更新**（5 个页面）：输出块按真机重抄 + 缺段补齐，并
    **新增机械闸门**（`website/tests/docs-coverage.test.ts` 规则 21：blocks /
    machine / tokens / rows / paras 五档 en↔zh 比对）⇒ 漂移不再静默过 CI。
  
  ### 低危（11 条）
  
  `__nudoLv{N}` 循环槽名改走 `internalTmpName`（`core/algebra/exec/transpile/stmt/statement.ts`）；
  后置条件证据面的 Φ 侧改**同项**判定（`core/algebra/postcondition.ts` · `check-return.ts`）
  ——无关 Φ 不再把「证不出」误判为 `disproved`；
  standard-schema 内联 `__nudoDescribe` 与库函数副本的 `-0` 口径统一
  （`service/src/emit/standard-schema.ts`）；整文件缓存键的「项目级 path env 内容」
  维度按项目根解析（`service/src/analyzer-cache.ts`）；两条新诊断码改用 core 的
  `DIAG` 注册表（`service/src/analyzer-orchestrate-uncached.ts`）；用法错误码三动词
  统一为 `nudo:usage-error`（`nudojs/src/commands/test.ts`）；vite-plugin 无 `line`
  的 issue 不再伪造成 `:1:0`（`vite-plugin/src/check-assembly.ts`）；parser 的文件级
  指令位置闸门补 class / 对象字面量体（`parser/src/directives/file-directives.ts`）；
  LSP 语义 token 降级路径复用 core 的真 lexer 遮罩（`lsp/src/semantic-tokens.ts`）；
  架构债台账条目数 9→10（3 处索引）；`walkAbs` 的 brand 解包补空值守卫
  （`scripts/env-coverage-baseline.ts`）。
  
  ### 跨文件尾巴（4 条 · worker 报告的同源缺口，本片一并收口）
  
  - **core 文本路径的同类位置闸门洞**（`core/algebra/directive-scan.ts`）：
    parser 侧修了 class / 对象体，core 的文本路径是孪生路径、同样漏了 ⇒ 按同口径
    补上（`nestedBodyRanges`）。
  - **`generalize.ts` 的类方法桥**（值域通道）：构造器抛 ⇒ 异常逃出 ⇒ 方法签名退
    unknown + 误导的 INFO `nudo:opaque-result`。`check-may-throw.ts` 反向 import
    `generalize.ts` ⇒ 跨模块复用会成包环 ⇒ 按仓库既有「就地复刻」惯例本地实现
    裸实例兜底。
  - **`nudojs/src/migrate.ts` 透出 `ctorParamPropsSuperMissing` note**：core 已置位
    但用户看不到 ⇒ 补提示。
  - **LSP / service 的项目级 env 预载基准**（见上「中危」条）。
  
  ### 验证
  
  全仓 `tsc --noEmit`（**含测试文件**）0 错误；`pnpm run test` **1756 文件 /
  14515 用例全绿**（exit 0）；`pnpm run build` exit 0；`verify-doc-examples.sh`
  278 checks passed / 0 failed；`coverage:env -- --check` exit 0。25 条缺陷各配
  一条「**修前红 / 修后绿**」的回归测试（新增 24 个测试文件），高危项另在
  **产品 CLI 面**逐条复现核对（与原生 node v26.10.0 逐值一致）。
- 2d96c29: `@nudojs/service` **新增**公开导出 `absolutizeEnvSpec`（env 规格的绝对化入口）
  ⇒ 纯**增量**（additive）⇒ minor。
  
  fix: 并发 review 收口的 10 条缺陷（闸门假红/假绿 · IDE/CLI 口径分裂 · 机器面谎报）
  
  上一片（并发 review 收口 25 条 + 族 65/1094 两轮）之后又做了一轮**并发
  review**（5 个分片 × 只读审查 + 逐条代码层复核）⇒ 查出 **10 条**该轮改动
  引入或遗留的缺陷，本片一次性收口。核心仍是**闸门可信度**：`nudo check` 是
  CI 闸门，**假红**卡死用户仓库、**假绿**让门禁空转。
  
  本片新增 **7 个回归测试文件**（全部含「修前红 / 修后绿」实测），另补 1 个
  残留洞（指令作用域闸门）。
  
  ---
  
  ### 高危（4 条 · 闸门级）
  
  - **构造器 may-throw 证据被整体丢弃且「归因落点」根本不存在 ⇒ L2 闸门假绿**
    （`core/algebra/check-may-throw.ts` · `core/algebra/scan-top-functions.ts` ·
    `core/algebra/check.ts`）：实例方法桥把构造器跑在独立 may-throw 会话里
    （软效果不进方法域 ⇒ 假红已消除），但**硬抛**（无条件 `throw`）也被
    `catch {}` 吞掉；而注释声称"归因给 `new C()` 入口"——**该入口并不存在**
    （`scan-top-functions.ts` 只登记 `Class.method`，跳过 ctor）⇒
    `export class A { constructor(x){ throw new TypeError("boom"); } }`
    在 check 闸门与 test 见证面**双面零诊断**（0 error / 0 warning / exit 0）。
    修法：新增**类导出入口**普查面 `listClassEntryNames`（`new C()` 是真实入口）
    ⇒ 类入口并入 L2 入口表（`check.ts`），构造器的**硬抛**进 throws 域、报在
    **类声明位置**；构造器的**软效果**（any 补位的强制转换）仍不进 ⇒ 普通类
    不触发 error 级 `nudo:entry-may-throw`（假红不回归）。另：类入口的
    `@nudo:throws` 申报落点 = 构造器 scope（`C.constructor`）⇒ 用户已申报不再被卡
    （`declaredThrowsForEntry`）。
  
  - **同一「裸实例兜底」在值域通道产出自信的错值 ⇒ 方法签名折 `never` + 假红**
    （`core/algebra/generalize.ts`）：兜底实例的内层是**空 obj** ⇒ 构造器写过的
    字段被建模成「确定不存在」⇒ `this.v` 读成**确定的 `undefined`**、
    `this.v + 1` 读成**确定的 `NaN`**；`this.v.toFixed(2)` 在**虚构实例**上抛
    ⇒ 签名 **`never`**（谎称"该方法必抛、恒返回 never"）⇒ 连带 **error 级
    `nudo:entry-may-throw`**。修法：兜底实例内层改 **unknown**（构造器写过的
    字段 = **不可知**，不是"缺槽"）⇒ 不折确定错值、不在虚构实例上抛 ⇒ 签名落
    `unknown`，且方法体照常求值（不退化成整体 opaque）。与上一条同源，两处
    **就地复刻**的孪生实现已互相点名，防止再漂移。
  
  - **Proxy `getOwnPropertyDescriptor` 不变量新增规则的 3 处阈值错误 ⇒ 假红**
    （`core/algebra/builtins/object/descriptor.ts`）：上一片新增的
    `enforceProxyGetOwnPropDescInvariant` 在 Object 面与 Reflect 面同时接线，
    三处口径与 node v26.10.0 不符 ⇒ **native 不抛、引擎抛 TypeError** ⇒
    error 级 `nudo:entry-may-throw` ⇒ 直接卡 CI：
    1. **形态一致性检查未以「靶属性不可配置」为前提** ⇒ ES2024
       `IsCompatiblePropertyDescriptor` 只在 `current.[[Configurable]]` 为 false
       时比对数据/访问器形态，引擎无条件抛 ⇒ **可配置**靶 + 异形态陷阱整类误判；
    2. **`frozen` 被当成 `enumerable:false`** ⇒ `Object.freeze` 只改
       writable/configurable、**不改 enumerable** ⇒ 冻结靶 + 诚实报告描述符的
       Proxy 被判违约（同处注释"frozen ⇒ enumerable 全 false"本身是事实错误）；
    3. **靶侧标志/extState 只查「内层 obj」不查「接收者」** ⇒ `defineProperty` 把
       标志记在接收者上（brand 靶记在 brand）⇒ 取不到 ⇒ 回落 `configurable:true`
       ⇒ **陷阱报告与靶完全一致也被判违约**。
    修法：形态比对收进「靶不可配置」分支；`frozen` 不再改 enumerable；靶侧三标志
    统一复用同文件 `currentPropDesc`（接收者优先、内层兜底）。**不可配置**靶 +
    异形态陷阱仍抛（能力未关）。
  
  - **项目级 env 的「两层基准」只做了一半 ⇒ 分析器通道丢 env 全局 / IDE 与 CLI
    结论相反**（`service/src/analyzer-orchestrate*.ts` · `service/evaluator/env-loader.ts`
    · `lsp/src/validation.ts` · `lsp/src/agent-tools.ts`）：上一片把项目级 env
    改为**按项目根**解析，但只改了**预载**侧；**收集期**仍用原始相对名查表，
    而相对说明符只有唯一候选（按文件目录解析）⇒ 与预载登记的 key 不匹配 ⇒
    **只要被分析文件声明了任何 `@nudo:env`（哪怕是内建名 `node`），项目级 path
    env 就对它完全不可见** ⇒ 返回面退 `never` + 假阳 `nudo:builtin-unknown`；
    同时 LSP 的 `env-unresolved` 诊断按「记录时的 preload 目录」归档 ⇒ 项目级 env
    的失败被**静默吞掉**（IDE 假绿，CLI 同刻仍报）。
    修法：绝对化规则收进 `env-loader.ts` 的**单一 helper**（`absolutizeEnvSpec`），
    预载侧 / 收集期 / 缓存键 / LSP 注入 / LSP 诊断**五处共用**；LSP 诊断按
    `fileEnvBaseDir + projectEnvBaseDir` 双取合并去重。改后 IDE 与 CLI 对同一
    文件结论一致。
  
  ### 中危（4 条）
  
  - **`migrate strip --write` 把「未写盘」的成功行报成 `wrote`**（`nudojs/src/migrate.ts`
    · `nudojs/src/commands/migrate.ts`）：库面在有失败时整批零写盘（原子性）并给
    成功行附注记，命令层却把注记行当普通成功行推入 `results`，人类面用
    `opts.write ? "wrote" : "dry"` **无条件**打 `wrote` ⇒ 同一行既说 "wrote"
    又说 "not written"，而磁盘上根本没有 `.js`；`--json` 侧只有一条自由文本
    `notes` 能区分 ⇒ 机器消费方极易误判已产出。修法：新增机器可判定的
    **`writeStatus`**（`"written"` / `"not-written"` / `"planned"`），人类面按逐行
    状态措辞（`wrote` / `not written` / `dry`）。
  
  - **HOF 元组元素域把**已知**的 null/undefined 压成 `any`**（`core/algebra/hof.ts`）：
    引擎把 `null`/`undefined` 建模成 **`unknown` 形状 + lit 项**，而元素域按
    **shape kind** 判"域是否可知" ⇒ 把**已知**类型误判成"域不可知" ⇒
    `[null]` 的元素域从 `null` 退成 `any`、`[1,null]` 退成 `any`（应为
    `number | null`）；`any` 是"自信的任意值"，参与算术即强制转换 ⇒ 记
    may-throw ⇒ L2 假红面。修法：三分类——已知 nullish（不参与异型判定、只贡献
    可空性，用仓内既有 `makeSum` 表达联合）、真·推断失败（退 **`unknown`**，
    不是 `any`）、其它（同型判定不变，异型仍退 `any`）。
  
  - **文件级指令的作用域闸门未覆盖 `ArrayExpression` / `ObjectPattern` / `ArrayPattern`**
    （`parser/src/directives/file-directives.ts` · `core/algebra/directive-scan.ts`）：
    写在数组字面量 / 解构模式里的 `@nudo:env` 被**静默提升**成整文件生效（零诊断，
    越权）。修法：两侧孪生闸门同步扩到三类嵌套体（两通道 23 组样例逐例一致）。
  
  - **引理账本写入是「死写」**（`core/algebra/check-return.ts`）：Φ 侧的消费在
    证明段里记进账本，而调用方传入的 `consumedAssume` 快照取自**调用之前** ⇒
    Φ 侧的写入永远读不到 ⇒ 账本与归因两套口径（changeset 宣称的"经
    `noteAssumeConsumed` 记进账本 ⇒ 归因可见"实际断在取数时序上）。
    修法：归因集**就地取账本**（读在写之后）⇒ 账本是"消费过"的唯一事实源，
    调用方快照退化为兜底。
  
  ---
  
  ### 验证
  
  - 全仓 `tsc --noEmit`（`pnpm run lint`）**0 错误**；`pnpm run build` exit 0；
  - `pnpm run test` 全量绿（**1757+ 文件 / 14500+ 用例**，exit 0）；
  - 新增 8 个回归测试文件，全部**修前红 / 修后绿**实测（红数由**回滚修复**逐条复核）：
    `core-bug-1095`（Proxy 阈值，22 例 · 修前 12 红）、`core-bug-1096`（构造器
    归因，11 例 · 修前 6 红）、`core-bug-1097`（HOF 元素域，15 例 · 修前 10 红）、
    `core-bug-1102` + `parser-bug-1101`（指令闸门，79 例 · 修前 12 红）、
    `core-bug-1103`（引理账本，5 例 · 修前 1 红）、`service-bug-1098` +
    `lsp-bug-1099` + `lsp-bug-1104`（env 两层基准，11 例 · 修前 6 红）、
    `nudojs-bug-1100`（migrate strip 写盘状态，6 例 · 修前 5 红）—— 合计 **149 例**；
  - 产品 CLI 面逐条复现核对：`nudo check` 对"构造器必抛"报 **error 级
    `nudo:entry-may-throw`（归在类入口）**、对"构造器软 throw"**零 error**；
    Proxy 三场景（可配置靶异形态 / 冻结靶 / brand 靶）**零 error**；
    `migrate strip --write` 失败批输出 **`not written`** 且磁盘**零写盘**、
    `--json` 带 **`writeStatus: "not-written"`**；项目级 env + 文件级 env 并存时
    `nudo check` 得 `f() => 42`（修前为 `never` + 假阳）。
  
  ### 已知边界 / 未闭合
  
  - **Proxy `gOPD` 仍有 3 处漏抛**（靶不可扩展且键不存在时报 `configurable:true`；
    靶不可写+不可配置而陷阱省略 `value`；靶为不可配置访问器且 get/set 身份不同）——
    **基线同样不抛**（非本次回归），新增抛点有制造新假红的风险 ⇒ 已把 node v26.10.0
    实测矩阵写进 `core-bug-1095` 测试文件注释，留待单独立项。
  - **不可配置访问器靶现在也会比对 `enumerable`**（原生确实抛）——属**收紧**，
    若有用例依赖旧的"访问器靶跳过该比对"需按原生重判。
  - **HOF 异型元素仍退 `any`**（`[1,"a"]`）——既有保守口径，本片未窄化成联合。
  - **真·未知 ⇒ `unknown`** 会让该 α 恰为返回类型时多一条 **warning 级**
    `nudo:unknown-inference`（级别 warning，不影响 L2 闸门）。
  - **进程级 `lastEnvBaseDir` 单槽**（同步 `analyzeFile` 路径下的**文件级**相对名）
    与 **Windows 下 `isPathEnvName` 只认 `/`** 均为既有基线，本片未动。
  - **MCP `nudo check` 工具面**（同步、无 path env 预载）与 **`migrate strip --json`
    顶层形态不统一**（成功=裸数组 / 失败=对象信封）仍待单独立项。
- 2af2bae: Return-contract diagnostics now carry the position of the function they
  belong to, name the constraint source they really came from, and only claim
  that a proof relied on a user lemma when the proof actually consumed it.
  
  - **Position.** `checkSource` built its return-contract issues without a
    `line` / `column`, so every consumer fell back to the top of the file:
    the LSP drew the diagnostic at line 1 column 0, `nudo check --gha`
    annotated `line=1,col=1`, GitLab Code Quality reported `lines.begin: 1`,
    and `--json` emitted no position at all — even when the offending
    function was declared on line 10. The issues are now built with the
    declaration position of the function, so the LSP, the CI annotations and
    the JSON machine contract all point at the real line.
  - **Constraint source.** The message of a violated return contract always
    said `@nudo:contract return <name>`, even when the constraint came from
    the return slot of a sidecar `fn({...}, <ret>)` binding — a directive
    that does not exist in the source file. The message now names the real
    source: `@nudo:contract return <name>` for a source directive,
    `sidecar fn() return slot (...)` for a sidecar return slot.
  - **Lemma attribution.** The `nudo:assume-relied` audit note claimed that
    a proof relied on a user lemma whenever the function declared one and
    the return contract happened to be provable — even when the lemma took
    no part in the proof (`return 0` is provable regardless of
    `@nudo:assume d <= max`). The engine now records which lemmas a proof
    actually consumed and attributes the note to those, so an unused lemma no
    longer produces a false "proved via @nudo:assume" claim. The proof
    result itself is unchanged: the note is an audit annotation, not a gate.
- c325a10: fix(lsp): `refactor.extract` 的多 edit 合成统一坐标口径（Bug 450）
  
  - 根因：`packages/lsp/src/extract-function.ts` 的 `applyEdits` **排序**用原
    `source` 的坐标、**应用**时却用 `posToOffset(out, …)` 在**已被前面的 edit
    改写过的** `out` 上求坐标 ⇒ 两个区间相互包含（插入点落在替换范围内部）时，
    后应用的 edit 落点按**陈旧坐标**漂移 ⇒ 源文件被搅成垃圾
    （`"AAAA BBBB CCCC"` + 替换 [5,9) + 插入 @6 ⇒ 改前 `"AAAA REPLBBB CCCC"`）。
  - 修法：**统一坐标口径** —— 全部 edit 的偏移都在**原 source** 上算好，再
    **从后往前**（起点倒序）应用；区间嵌套（插入点落在替换范围内部，LSP 规范下
    属非法重叠 edit）按「插入文本并入该替换范围、紧贴替换文本**之前**」
    **确定性合成** ⇒ 改后 `"AAAA INSREPL CCCC"`（插入内容不丢、源码不被搅乱）。
  - 替换范围之间**真的**重叠（部分重叠 / 交叉）无法确定性合成 ⇒ fail-closed：
    抛 `RangeError`（`server-code-actions.ts` 的 `refactor.extract` 是
    best-effort ⇒ 抛错即「不出 action」，绝不产出非法 WorkspaceEdit）。
  - 影响面：`applyEdits` 的两个调用点（**表达式提取路径** / **语句序列路径**）
    同时受益；不相交 edit 的既有行为**逐字不变**。
  - 未变：公共 API 冻结面零变更（`packages/lsp/src/public-api.ts` 四张表不动、
    零新增导出）。
- e6c4586: LSP 符号 / 观察面与导出面对齐：默认导出、导出类实例方法、CJS 成员导出不再
  整段消失，跨模块调用点补上 `call@` 观察透镜（Bug 753 / 769 / 998 / 1034）。
  
  - `export default function` 此前只存在于 hover / 大纲面，CodeLens 与
    inlayHint 的 interface 档（`● contract / imp` / `⚡ persist interface` /
    `⚡ draft interface`）整段缺失。默认导出现在与具名导出同形。
  - 导出类的实例方法（`Counter.inc`）此前只在 hover 面可见：CodeLens 没有
    interface 档，inlayHint 也没有返回 inlay。类方法现在以 `Class.method`
    为契约键进入两面，与顶层导出函数同形。
  - CJS 成员导出（`exports.f = fn` / `module.exports.f = fn`）此前在
    documentSymbol / workspace symbol / inlayHint / semanticTokens 四个面
    全部不可见，CodeLens 也没有 interface 档——而诊断面却点名该导出。
    四面现在与 ESM 具名导出同形（导出键带 function 档 + interface 档 modifier）。
  - 跨模块调用点（`import { add } from "./lib.js"` 后调用 `add(x, 2)`）此前
    不在调用方文件的 CodeLens 上投影——CLI `nudo test` 已经打印该事实。
    调用方文件现在出现与 CLI 同形的 `call@L4` lens；被导入函数的 entry@
    仍属被导入模块，不在调用方落镜。
  
  core 侧只改了内部未导出函数 `listFunctions` 的函数体（导出类实例方法与
  CJS 成员导出的枚举），未新增任何导出名。
- f87c9f9: fix(lsp): 成员补全引擎的接收者解析与内建原型投影（Bug 771 / 772 / 782 / 787 / 788）
  
  - **771** union 接收者的补全不再跳过「零成员」的那一支：sum 交集计算区分
    「该臂成员集为空」（原始值臂 ⇒ 交集必空）与「该臂补全信息不可得」
    （unknown / any / never ⇒ 可跳过）⇒ `{x,y} | 5` 的 `u.` 不再给出 `x` / `y`
    （取属性在原始值臂上是 TypeError）。
  - **772** 成员补全的接收者按**整条成员访问链**解析（`a.b.c` ⇒ 接收者是 `a.b`），
    不再取最后一段标识符 ⇒ `a.b.` 不再给出同名顶层绑定的成员。
  - **782** 接收者识别与源码消毒的标识符捕获组改为 Unicode 感知
    （JS IdentifierStart/Continue + `$`）⇒ 非 ASCII 接收者（`对象.`）给出该对象的
    成员，不再回落成顶层变量表。
  - **787** 字面量 / 括号 / 字符串接收者（`(42).` / `(true).` / `"abc".`）走内建
    原型表（Number / Boolean / String）；**认不出接收者时给空**，绝不回落成顶层
    变量表（那份表与「成员」意图无关）。
  - **788** prim 分支按类型分派到对应的内建原型表
    （number → Number / boolean → Boolean / bigint → BigInt / symbol → Symbol），
    品牌名命中内建类时同样投影该类成员 ⇒ number / boolean 接收者不再是零候选。
  
  新增 `getCompletionsAtPosition` 的**上下文入参**（`CompletionContext`）与
  `completionBranchAt` 补全面分支判定入口，供调用方（IDE 入口）按光标词法上下文
  与作用域决定成员面 / 变量面。
- f87c9f9: fix(lsp): 补全面的绑定下沉 + 词法上下文闸（Bug 789 / 952）
  
  - **789**：成员补全解析接收者 Abs 时不再只查**模块级** `bindings` 表（该表由
    service 的 `collectBindings` 只遍历**顶层**语句填充 ⇒ 函数体内的局部量 /
    形参不在表里）⇒ 函数内接收者一律**零候选**（连 `string` 局部量也是 0 项）。
    新增 `replay.ts` 的 `lookupScopedBinding`（**作用域感知**的绑定查询）：
    局部量走引擎节点级 Abs 重放（`recordPositions` 插桩在**声明位**记录初始化
    求值态 Abs——与模块级绑定面同口径），形参走契约种子（`generalizeFromAst` 的
    `entryShapes`，与 hover 的「A 参数面」同源）；`server-ide.ts` 的补全入口把
    它挂到 `CompletionContext.lookupBinding` 上（作用域面优先，作用域里没有才
    回落模块级绑定面）⇒ **同一份代码只改「接收者声明的位置」**，成员候选集完全
    一致。
  - **952**：补全入口**单次**计算光标的词法上下文（code / comment / string），
    指令面 / 成员面 / 变量面共用同一份 ⇒ 光标落在**字符串 / 模板字面量内部**或
    注释里时不再弹出候选（接受任一项即把标识符写进字面量内部 ⇒ 静默改写运行时
    值）；代码位与注释里的 `@nudo:` 指令面行为不变。
- f87c9f9: Hover now agrees with `nudo check` on what a parameter's type is, and an
  early-return guard no longer narrows away a `null` that is still reachable.
  
  - **Bug 773** — The flow facts treated `if (!p) { return 0; } else { … }` as
    an early-return guard and stripped the `nullable(…)` wrapper from `p` for
    the rest of the function. The `else` branch falls through to the code
    below the `if`, so `p` can still be nullish there; the hover showed a
    type that does not hold. The guard now only narrows when there is no
    `else` branch, or when the `else` branch also ends in `return` / `throw`.
  - **Bug 774** — A parameter of a function without a contract produced an
    empty hover, even though the signature block of the very same hover
    showed `x: any`. The parameter projection now falls back to the
    "unconstrained ⇒ `any`" rule (design §2); identifiers that are not
    parameters still report no information.
  - **Bug 775** — For contract parameters the hover showed the sidecar
    expression text (`x: number().gt(0)`) while `nudo check` showed the
    inferred type (`x: number`), so one function had two different parameter
    types depending on the surface. Non-union contract parameters now use the
    same inferred shape as the check signature line. Union parameters keep
    their declared form: a discriminated union expands to tens of thousands
    of characters and its arms are identified only by the user's own type
    names.
  - **Bug 786 (hover half)** — The hover surface never forwarded the
    `inject` bundle, so inline directives (`@nudo:mock` / `@nudo:as` /
    `@nudo:replace`, environment globals) were missing and the derivation
    collapsed to `unknown` ("inference failed") while the CLI gate showed the
    real type. `HoverInterfaceOpts` now carries `inject` and passes it to
    every `generalizeFromAst` call of the hover surface.
- f87c9f9: fix(lsp): server 骨架 8 条——重复诊断推送 / 配置深合并 / trace 位置参数桥 / 工作区根 / 畸形 URI / inlay 开关同口径 / pull 诊断 env 通道（Bug 776 / 777 / 780 / 783 / 784 / 790 / 781 / 992）
  
  - **Bug 776**（重复推送）：`vscode-languageserver` 的 `TextDocuments.listen()`
    在 `didOpen` 时**同时** fire `onDidOpen` 与 `onDidChangeContent` ⇒ 打开即
    验证路径与编辑防抖路径对**同一内容**各跑一遍完整校验、各 publish 一次
    （同 version 同内容发两次）。`server.ts` 记文档指纹（version + 内容），
    防抖路径遇到同一指纹即认定 didOpen 回声并跳过；publish 面再加**内容去重**
    （同 uri + 同 version + 同诊断内容只发一次，同版本但内容变了仍照发）。
  - **Bug 777**（配置深合并）：`workspace/didChangeConfiguration` 的载荷只带
    **变更部分**（或与 nudo 无关的整棵树），server 却把它当整棵子树读 ⇒
    未提及的键被抹成 `undefined` ⇒ 一次无关的设置变更就把宿主的
    `nudo.analysis.mode` 默认值清掉（分析范围静默收缩、hover 变 null）。
    宿主设置改为**累积合并树**：出现的键覆盖、未出现的键保留、`null` = 显式
    重置；扁平键（`"nudo.analysis.mode"`）按点号展开成嵌套路径，与嵌套形态
    等价。
  - **Bug 780**（命令桥 · server 侧）：`nudo.trace` **没有**位置参数桥
    （`nudo.contract*` 有）⇒ IDE 观察透镜的 `[uri, fn]` 落到兜底分支、把 uri
    字符串当参数对象传下去 ⇒ 工具 100% 失败。补上与 `nudo.contract*` 同款的
    位置参数桥（复用 agent 侧 `tracePositionalArgs`），并把兜底分支改成
    「参数不是对象 ⇒ 协议层 `InvalidParams`」，不再把字符串当对象传下去。
  - **Bug 783**（工作区根）：`workspaceRoots` 的写入点**全在** `onInitialize`
    里 ⇒ 之后永不更新；server 也从不订阅
    `workspace/didChangeWorkspaceFolders`，且 capabilities 未声明
    `workspace.workspaceFolders.changeNotifications` ⇒ 客户端根本不会发这条
    通知。现在声明该能力 + 订阅通知（增删根、realpath 归一）+ 根集合变化后
    清 `nudoFileCache`、重检已打开文档、广播 `workspace/diagnostic/refresh`
    （新纳入的目录不再被写盘边界误拒，已移出的目录不再保留过期授权）。
  - **Bug 784**（畸形 URI）：`onInitialize` 对每个 workspace folder 的
    `uriToFilePath` 没有兜底 ⇒ 一个百分号转义非法的 URI 抛 `URIError` ⇒
    initialize 整个失败 ⇒ 客户端拿不到 capabilities ⇒ 整个语言服务器会话
    起不来。改为逐个 folder 兜底：跳过畸形项 + 记可读告警，其余照常。
  - **Bug 790**（inlay 开关同口径）：项目侧 `nudo.inlayHints.parameters`
    **原样返回**原始值，宿主侧走 `parseInlayParams` ⇒ 同一个键两套规则
    （项目写字符串 `"false"` 反而**开启**参数 inlay，宿主同一个值**关闭**）。
    项目侧改用**同一个归一化函数**：非 boolean 一律回落默认（关）+ 一条
    可读告警。
  - **Bug 781 / 992**（诊断面同形）：push 面（`validateText`）会发
    `nudo:env-unresolved`，pull 面（`textDocument/diagnostic`）**完全没有**
    env 通道 ⇒ 同一文件两个诊断面互相打脸（IDE 与 CI 结论不一致）。pull 通道
    补上 env 通道——与 push **同源同档**（`envUnresolvedDiags` +
    `filterCheckLspByLevel` + 同一 level + 同一去重键空间）。
  
  冻结面：`packages/lsp/src/public-api.ts` 四张表本族**零变更**。`workspace`
   能力键已由 server 声明，但**未**写进 `NUDO_INITIALIZE_CAPABILITIES`
  （属于「stable 键集变更」，待 owner 拍板后统一补表 + 补 `PUBLIC_API.md`）。
- f87c9f9: fix(lsp): 诊断 range 夹到行尾 + check 通道保留 info 级（Bug 778 / 779 LSP 半）
  
  - **Bug 778**：service 的 `column: 999`「整行」哨兵被原样写进 LSP
    `end.character` ⇒ 协议层 range 越界（push / pull 两条通道都越界）。诊断
    range 的**唯一计算点** `lspDiagnosticRange`（`validation.ts`）：行号 1 基
    → 0 基、列号夹到该行长度以内、同 line 时 end ≥ start；行长表由本轮源码
    逐行算出（会话条目缓存 ⇒ pull 通道无源码参数时同样夹取）。
  - **Bug 779**（LSP 半）：`checkToLspDiagnostics` 在转换前就把 info 级砍掉 ⇒
    下游档位过滤器永远看不到 info ⇒ `nudo.analysis.diagnostics: "verbose"` 对
    check 诊断是空操作（`nudo:assume-relied` / `nudo:invariant-relied` /
    `nudo:opaque-result` 永不上屏，与 CLI `nudo check` 两侧集合不一致）。转换点
    改为保留三档，档位取舍只由 `filterCheckLspByLevel` 决定（verbose 放行
    info；default / errors / off 不放行，`off` 的门禁码可见性不变）。
  - **env 通道同档同 range**：`nudo:env-unresolved` 改走与 check 主通道同一个
    转换点（`checkIssueToLspDiagnostic`）⇒ severity 与 range 与主通道同口径。
  - 对外交付两个前置件：`envUnresolvedDiags` 改为 export（供 pull 诊断面
    消费）；`handleNudoDepFileChanged` 排除变更文件自身（防自激重检）。
- f87c9f9: fix(lsp/core): IDE 面与 CLI 同源装配注入 + info 级 check 诊断不再被提前砍掉（Bug 785 / 786 / 780 / 779 vite 半）
  
  - **Bug 785**（注入装配）：LSP 侧**从不采集**行内指令（`@nudo:as` /
    `@nudo:replace`）⇒ CLI 与 IDE 对同一份文件给出**相反**的门禁结论与签名
    （IDE 假红：用户声明过 `raw` 是 number，IDE 仍按 string 判
    `raw.toFixed` 不存在并报 `nudo:entry-may-throw`）。新增 **LSP 侧注入装配器**
    `buildLspInjection`（`packages/lsp/src/agent-tools.ts`）—— 与 CLI
    `buildCheckInjection` **同口径**（`@nudo:as` / `@nudo:replace` /
    `@nudo:mock` / env 全局 / 模块图），**不从 lsp 反向 import nudojs**，
    零新增 core / service 导出；agent check 工具面把它交给
    `checkSource({ inject })` ⇒ `nudo/check` 由 `ok=false · 1 error ·
    unknown #partial` 变为 `ok=true · 0 error · string`（与 CLI 同款结论）。
  - **Bug 786**（注入传递协议 + inlay 半）：`CollectAbsInlaysOpts` 新增
    `inject` 字段并透传给 `generalizeFromAst`（core 侧**只改内部函数体**、
    零新增 core 导出 ⇒ 不破 core 冻结面）⇒ inlay 面不再把「行内指令缺席」
    显示成 `unknown`（Nudo 词汇里 = 「推断失败」）。对外交付注入传递协议：
    `buildLspInjection(filePath, source, { loadModule?, modules? }) →
    RunTranspiledOptions`，消费方统一走
    `checkSource({ inject })` / `generalizeFromAst({ inject })` /
    `collectAbsInlays({ inject })`。
  - **Bug 780**（agent 侧）：`nudo.trace` 此前**只读 `params.file`** ⇒ LSP 自产的
    `file://…` uri 形态与 `executeCommand` 位置参数形态都让 `params.file` 变
    `undefined` ⇒ 观察透镜 100% 抛 TypeError。现在 `FunctionToolParams` 收
    `uri` 键（与 `file` 二选一，缺省时报共用入口闸的 `file is required …`
    而不是裸 TypeError），并导出位置参数桥 `tracePositionalArgs([uri, fn])`
    （形态不合法 ⇒ `undefined`，由命令桥报协议层参数形态错误）。
  - **Bug 779**（vite 半）：`checkIssuesToDiagnostics` 在转成 vite Diagnostic
    **之前**就把 info 级砍掉 ⇒ 下游档位过滤器永远看不到 info ⇒
    `nudo.analysis.diagnostics: "verbose"` 对 check 诊断是**空操作**
    （`nudo:assume-relied` / `nudo:invariant-relied` / `nudo:opaque-result`
    永不上屏）。转换点改为保留三档，档位取舍只由
    `filterDiagnosticsByLevel` 决定；info 级走 vite 的 **info 通道**
    （不混进 warn 流），warning 计数不含 info。
- 27a795e: 族 22 修复 D1：Bug 699 / 702 / 709 / 714 / 715 —— 符号表按作用域存绑定、引用集合只收标识符、rename 编辑协议合法。
  
  - **699**：babel 把 `ExportNamedDeclaration` **语句节点**放进导出绑定的
    `referencePaths`，改名时它变成一个「宽于单个标识符」的编辑目标 ⇒ `rename`
    一个导出绑定会把整条 `export function …` 声明替换成一个标识符，且与声明位
    的编辑**重叠**（LSP 不允许同一份 edit 列表里 range 重叠）。引用集合现在只收
    `Identifier` 节点；改名编辑另外加两道兜底：宽于一个标识符的编辑挡掉、互相
    重叠的编辑只留窄的一条。
  - **702**：`references` 把**声明位点返回两次**（符号表里的声明位 + 引用集合里
    的声明位），还混着上面那条语句级伪引用。引用集合按 (uri, 位置) 去重，语句级
    目标不再进集合。
  - **709**：符号表按**名字**索引 ⇒ **遮蔽**的同名局部变量上 F12 /
    Find-references 会落到另一个作用域的声明。定义现在按**作用域路径**存（同名
    绑定在不同作用域各存一条），查定义时按光标所在作用域取最内层的那条。
  - **714**：`references` 的 `context.includeDeclaration: false` 仍返回声明位点 ——
    该开关只关掉了「另一处」的声明。引用收集现在接受 `includeDeclaration` 入参并
    由 references 通道透传。
  - **715**：改名遇到**对象字面量简写属性**（`{ x }`）时，key 与 value 是同一段
    源码 ⇒ 整段替换会把 key 也改掉（对象的形状被静默改掉）。这类位置现在生成
    `x: <新名>`（保留 key、只换 value）；解构模式（`function f({ x })`）同理。
- 27a795e: 族 22 修复 D2：Bug 704 705 706 712 719 —— 大纲面与「方法引用 / 改名」面对齐真实符号。
  
  - 大纲里所有变量绑定都写成 `const`：`let mutable = 1` 与 `var x = 1` 的
    detail 都是 `const`（导出时是 `export const`）——文案只按「是否导出」二分，
    完全不看声明种类。现在按 `const` / `let` / `var` 如实输出（导出时前缀
    `export `）。
  - 大纲漏掉整个默认导出：`export default (x) => x` 与**匿名**
    `export default function () {}` 一条都不出（顶层语句循环只认函数 / 类 /
    变量声明；无名函数又被「没有 id 就丢弃」的守卫挡掉）。默认导出现在一定在
    大纲里：表达式型给一个名为 `default` 的符号，函数型即便匿名也出项
    （无名时名字取 `default`，有名时取函数名）。
  - 大纲漏掉**解构绑定**：`const { p, q } = …` / `const [first, second] = …`
    里的每个绑定都不出（取 id 的辅助函数只认普通标识符 ⇒ 整条声明被跳过）。
    解构模式现在逐个绑定展开，每个绑定各出一个变量项。
  - 类方法的 **references / definition 一律返回空**：类方法键不是绑定标识符，
    绑定面找不到绑定目标就直接返回空，而已经写好的方法面没有被这两个请求接入。
    两个请求现在改走方法面（方法键 + 同源成员访问）：在类方法上查引用能看到
    调用点，在 `k.m(…)` 上按 F12 能跳回类里的方法键。
  - 方法改名**越过无关对象**、且漏掉对象字面量的同名 key：改 `K.m` 会把
    `o.m`（另一个对象的成员）一起改掉，改坏调用点；而对象字面量里的
    `{ m() {} }` / `{ m: fn }` 的 key 又不在收集范围 ⇒ 定义位点与使用位点口径
    不一致。方法引用现在**以「归属」为界**：类方法归类、对象字面量方法归对象，
    成员访问只在接收者归属与该方法定义**同源**时计入；同名但不同类 / 不同
    对象的方法不合并（跨文件扫描同样按归属收敛）。
- 27a795e: Cross-file navigation follows the module graph the editor actually shows.
  
  - A default export had no cross-file references: `export default function
    greet()` in one file and `import greet from "./a.js"` in another — the
    definition jumped across files, but the references of that definition
    were empty. The export name of a symbol is now resolved before the
    importers are matched, so `default` is a first-class export name and the
    importing file shows up in the references.
  - A namespace import was read as if it named a single export:
    `import * as ns from "./def.js"` made every occurrence of `ns` a
    reference to *every* export of the imported file, including the ones the
    file never mentions. A namespace import now contributes only its member
    accesses (`ns.beta`), and a bare `ns` is not a reference.
  - Renaming an exported symbol across files edited the wrong side of an
    aliased import: `import { oldName as alias }` became
    `import { oldName as newName }` — the imported name was left behind, so
    the import no longer resolved and the module failed to load — while the
    alias, which is a separate local binding, was renamed. The imported side
    of the import specifier is edited now, the alias and its call sites are
    left alone, and renaming the alias itself no longer reaches into the
    imported module.
  - The fallback that jumps to a same-named export in the workspace fired
    on member accesses: `o.helper` jumped to an unrelated
    `export function helper` in another file. The fallback applies to plain
    identifiers only.
  - Cross-file definition, references and rename read the file from disk
    instead of the editor buffer, so an unsaved edit was invisible and the
    positions were off by the number of unsaved lines. The open document is
    the source of truth now, and the disk is only a fallback.
  - A re-export was invisible to references and rename: `export { a } from
    "./m.js"` established no edge, so renaming `a` in `m.js` left the
    re-export untouched and broke the module. The re-export edge is followed
    now, in both directions: the references of a re-export cover the target
    module, and renaming either side keeps the two in sync.
  - The sidecar contract lookup pointed at bindings the engine never
    consumes. Only an exported `fn({ … }, …)` binding is a contract (a value
    template such as `number().gt(0)` is reported as `not fn() form` and has
    no effect), so go-to-definition no longer sends the user to a binding
    that cannot take effect.
- 27a795e: 族 22 修复 D4：Bug 698 700 701 708 717 721 723 —— 补全面与语义 token 面对齐真实语义。
  
  - 尾随点号时补全整面清零：用户刚敲下 `obj.` 的那一刻 buffer 文本语法非法，
    而解析不容错 ⇒ 分析直接抛 ⇒ 补全返回空并在 console 报错——恰在最需要补全的
    时刻失效。分析输入与绑定解析输入现在共用同一个消毒器（把尾随 `x.` 改写成
    `x._ `），尾随点号与已敲出部分成员名给出同样的成员列表。缓存键仍按真实源码
    计算：消毒文本只喂给一次性分析，不写回分析缓存，缓存与真实源码不会串味。
  - 指令补全在乘号之后也弹 `@nudo:` 指令：判定是「前面出现过 `*` 或 `nudo`」的
    子串匹配（`@?n?u?d?o?:?` 整段可选），于是 `x * ` 之后、字符串字面量里的
    `@nudo:` 都算命中。指令面现在先算光标的**词法上下文**（注释 / 字符串 / 代码），
    只在光标确实落在注释里时才出；注释里（含跨行 JSDoc）照旧出。
  - `@nudo:sample` 的补全项吹着「Control loop iteration sampling」，但该指令只被
    解析、不被消费；而且插入文本缺 count，接受补全就产生诊断。说明改成如实描述
    （reserved / no-op），插入文本带上 count 占位。
  - 模块级函数的补全项被标成「方法」：顶层 `function` / 箭头函数绑定不是任何对象
    的成员，IDE 会把它渲染成方法。补全项新增 `function` 档（成员函数仍是
    `method`，非函数绑定仍是 `variable`）。
  - 语义 token 面漏标：类名、类方法、类字段、方法形参、数组解构元素全部不上色，
    对象解构的绑定被上成属性。类名 → class 档（图例末尾追加，老索引不变）、类
    方法键 → method、类字段键 → property、方法形参 → parameter、解构绑定 →
    variable。
  - 对象字面量里的简写 `{ x }` 是对变量的**引用**，却被当成属性定义（property 档
    且带 declaration 标记）。简写现在是 variable 档且不带 declaration 标记。
  - 标识符 token 的长度按解码后的名字算：`const abc = 1` 里名字是 `abc`（3），
    但源码写法是转义序列（8）⇒ token 只盖住转义序列前半截，客户端高亮错位。长度
    改用源码跨度（位置口径仍是 UTF-16 code unit）。
- 27a795e: 族 22 修复 D5：Bug 711 718 720 985 986 —— 签名帮助面对齐「正在被编辑的那个调用」。
  
  - 嵌套调用弹**外层**函数的签名：光标在内层实参里时，弹出的却是外层函数的
    签名（内层调用完全不参与）。命中第一个（外层）`CallExpression` 就停 +
    `path.skip()` ⇒ 内层 `CallExpression` 永不被访问。现在在所有命中里保留
    **最内层**者（被调者起点更靠后 / 终点更靠前者更内层），嵌套调用的签名帮助
    指向内层被调者。
  - `activeParameter` **越界**：2 参签名在第 2 个实参之后报下标 2（协议规定下标
    须落在签名参数表内，越界值客户端只能回落 0 ⇒ 高亮错误的参数）。下标现在按
    **签名参数表**夹住（`min(active, params-1)`），参数表为空时**省略**该字段
    （不是填 0）。
  - **方法调用**（`obj.method(…)`）**整面无响应**：被调者是接收者的**槽位**，
    不是模块级绑定 ⇒ 绑定面必然 miss。签名面现在沿 Abs 形状逐段下钻
    （`obj` → `obj.method`），与成员补全面同一条下钻口径。
  - **默认导出**的 callee（`export default function defFn(…)`）**整面无响应**：
    分析结果的绑定表只收**具名导出**，默认导出连 `default` 键都没有 ⇒ 绑定面
    必然 miss。签名面落到 **AST 定位回落**（与 hover 面同源的
    `generalizeFromAst`）⇒ 按**声明**找被调者，与绑定表的键口径无关。
  - **函数体内的局部 callee**（局部函数声明 / 局部箭头常量）**整面无响应**：
    局部绑定不在模块级绑定表里。同一套 AST 定位回落覆盖这一形态。
  - 查表与 AST 定位都 miss 时，返回**可观测的降级结果**（被调者标识符 + 空
    参数表）而不是 `null` —— 「没有签名」与「Nudo 不知道」必须可区分。
- 27a795e: 族 22 修复 D6：Bug 716 722 724 725 911 951 —— hover / CodeLens / inlay hint 面与 `nudo check` 对齐。
  
  - inlay hint 面无视请求区间：`textDocument/inlayHint` 的 `range` 是必填且表示
    「只请求该区间」，但服务端从不读它 ⇒ 两个不相交的区间返回**逐字节相同**的
    整文件 hint 集，客户端的局部刷新被无视、无关区段的 hint 反复重绘。现在
    返回的 hint 落在请求区间内（区间缺省时仍给整文件集，不丢内容）。
  - CRLF 源文件上的 inlay hint 位置越界 1 列：服务端按 `\n` 切行，行尾的 `\r`
    被算进行长 ⇒ end-of-line hint 的 `character` 比客户端算出的可见行长多 1
    （LSP 里行终止符不属于该行）。切行改成 CRLF 感知，服务端行长与客户端的
    可见行长一致。
  - hover 首行的契约档位恒为「激活」：hover 渲染 `● contract / …` 时没把观察
    选择器的状态带上（默认值就是激活），而同一文件的 CodeLens 在选中 case 后
    已翻成 `○ contract / …` ⇒ 同一个 IDE 里两个面互相打脸。现在 hover 与
    CodeLens 同源：选中 case 时契约档两处一起翻 `○`。
  - 观察透镜是死链：服务端 CodeLens 把 `entry@` / `call@` 透镜交给客户端执行
    `nudo.trace`，但 VS Code 扩展从未注册这个命令 ⇒ 点了报「command
    'nudo.trace' not found」，观察透镜 100% 不可用。扩展补注册该命令（转发到
    服务端的 `nudo/trace`），manifest 的 `contributes.commands` 一并登记。
  - hover 签名块整段丢掉 `throws` 通道：Abs 的四槽（shape × term × pred ×
    conf）没有 throws 槽 ⇒ IDE 里显示「不会抛」，而 `nudo check` 同一函数判
    `nudo:entry-may-throw`（error）⇒ 跨产品面自相矛盾，并违反
    `api/lsp.md` 明写的「check-identical signature」承诺。签名块现在按 check
    签名行的同款格式带上 `throws <Type>`（见证面证据；无证据时省略，不写
    `throws never`；非导出函数不带——CLI 的 L2 throws 只对 entry 生效）。
  - hover 签名块的返回类型按 `maxDepth: 4` 截断：同一份源码、同一函数、同一次
    分析下，`nudo check` 签名行 / 同文档的 inlayHint / `nudo.hover` 载荷给出
    三个互不相同的类型（越深的结构，hover 给的信息越少——深度 8 与深度 4 的
    hover 输出逐字节相同）。返回类型改走共享投影预算（与 check 同口径）。
- b37321b: The editor shows what the command line shows, at a position the editor can
  use.
  
  - A file that only contains `@nudo:assume`, `@nudo:invariant`, `@nudo:throws`
    or `@nudo:budget` was skipped as "not a Nudo file", so those directives
    were never analyzed and the file looked clean. Those files are analyzed
    now.
  - A `nudo:directive-syntax` diagnostic was published twice, and one copy
    carried line `-1` — not a valid position in the protocol. It is published
    once, at a valid position.
  - The placeholder position used for `nudo:module-missing` and
    `nudo:mock-invalid` was converted to line `-1`. Those two error
    diagnostics now land on a valid line.
  - An env diagnostic that names the env rather than a file was filtered out
    because the filter only matched file paths. The unknown-env-name and the
    env-contract diagnostics are visible now.
  - The project configuration fingerprint read the raw `autoBind` value while
    the analysis read the normalized one, so a configuration written as a
    non-boolean looked like a different configuration on every keystroke. The
    fingerprint uses the normalized value.
  - A path env whose load failed was reported by the service analysis before
    the check ran, and the check's own copy of the diagnostic could be lost. The
    diagnostic reaches the editor in both paths.
- 63b12c1: LSP IDE 面 8 处用户看得见的缺口（族 53）：语义高亮不再整面消失、指令补全
  不再子串误命中、类方法跳转与跨文件引用可解析、`executeCommand` 接位置参数、
  `ignoreThrows` 与 CLI 同口径、env 模板变更触发依赖文件复分析、扩展命令面板
  补齐 `nudo.selectContract`。
  
  - **语义 token 面在语法非法 buffer 上整面清零**（`semantic-tokens.ts`）：
    `buildSemanticTokens` 遇 `parse` 抛就 `return []` ⇒ 用户改到一半（括号没
    闭合 / 半个表达式）**整个文件的高亮瞬间消失**。现在解析失败走**词法降级**：
    把注释 / 字符串内容挖空（长度与换行不变 ⇒ 坐标不变）后按关键字
    （`function` / `class` / `const` / `let` / `var`）取紧随其后的标识符 ⇒
    **仍有部分 token**。取舍：降级档**只给声明位**上色（成员访问 / 参数 /
    引用位静态不可知 ⇒ 不猜，宁可少上色不可错上色），且**不缓存上次成功结果**
    （旧坐标比清零更坏）。
  - **指令补全的前缀过滤是子串匹配**（`server-ide.ts`）：过滤收敛为**纯前缀
    匹配**（`label.startsWith(typed)`），语义写死在 `matchesDirectivePrefix`
    的注释里。⚠ 前缀语义：`@nudo:ca` 只命中 `@nudo:case`（`@nudo:contract`
    的前缀是 `@nudo:co`）；`@nudo:c` 命中**所有**以 `@nudo:c` 开头的指令
    （`@nudo:case` 与 `@nudo:contract` **都**真前缀于它）——被排除的是「不是
    typed 前缀」的 label（子串语义才会把 `@nudo:mock` / `@nudo:replace` 这类
    **含** `c` 的项误纳进来）。
  - **方法面未下沉到符号层**（`symbols.ts`）：类 / 对象方法的**方法键不是绑定**
    （绑定表不收它）⇒ 纯函数面 `resolveDefinitionLocations` /
    `resolveReferences` 直接调用时认不出方法（此前只有协议通道内联了一份
    方法判据 ⇒ 纯函数面与协议面口径分裂）。方法面现在下沉到符号层
    （`methodTargetAt`），协议通道改为**委托**符号层 ⇒ 两面同一口径。
  - **跨文件方法 references 未接**：references 通道对方法只扫**当前文件**
    ⇒ 跨文件的 `Alpha.run` 调用点不在结果里，而改名面已经会带上它们 ⇒ 用户
    「查引用看不到、一改名却跨文件被改」。方法面现在**跨文件**扫描
    （`collectMethodReferencesAcrossFiles`：`extraFiles` + 打开文档 buffer
    覆盖层），归属（owner）由光标所在文件显式给出 ⇒ 同名不同类（`Beta.run`）
    仍不合并。
  - **`executeCommand` 缺位置参数 → 对象桥**（`server.ts`）：IDE 侧历史上用
    **位置参数**发命令（`[uri, …]`），而 executeCommand 通道只认**对象**参数
    ⇒ 位置形态落到兜底分支 ⇒ 协议层 InvalidParams ⇒ 命令 100% 失败（扩展侧
    只能绕道 slash 请求）。`agent-tools.ts` 的 `positionalCommandParams` 统一桥
    `nudo.check` / `nudo.hover` / `nudo.test` / `nudo.whatIf` /
    `nudo.suggestCase` / `nudo.getActiveCases`。对象形态**行为不变**；位置形态
    缺必填项仍报协议层参数形态错误。
  - **LSP 侧 `ignoreThrows` 口径与 CLI 分裂**（`gate-config.ts`）：service 的
    `checkConfig` 只认**严格 `string[]`** ⇒ 配置写成 `"TypeError"`（裸字符串）
    或 `["TypeError,RangeError"]`（数组元素内含逗号）时被静默丢成空表 ⇒ IDE
    仍报 `nudo:entry-may-throw`（假红），而 CLI 认这两种写法 ⇒ 同一份
    `package.json` **CLI 绿 / IDE 红**。LSP 侧改为按**同一语义**解析（裸字符串 /
    字符串数组都接受；数组元素内部也按逗号切分；trim 后丢空；非字符串元素忽略），
    并把 CLI 的解析器作为**测试 oracle** 逐值比对。⚠ 根因在 service / core 的
    配置解析层 ⇒ 本次只修 IDE 面（service 层未动）。
  - **LSP 的 env 模板无反向边**（`validation.ts`）：watched-files 只按 LSP 自己
    的 `nudoDepParents` 定向重检 ⇒ path 型 `@nudo:env` 模板改了**不一定**触发
    依赖源文件复分析（CLI watch 走 service 的 env 反向边表 ⇒ 两面口径分裂）。
    现在 LSP 直接消费 **service 的同一张表**（`envPathDependents`——解析口径
    同源，不另写一份）⇒ IDE 与 CLI 同口径。
  - **manifest 漏登记 `nudo.selectContract`**（`packages/vscode/package.json`）：
    扩展的 handler 认这个命令（languageclient 自动注册 ⇒ CodeLens 可用），
    但 `contributes.commands` 没有它 ⇒ **命令面板里搜不到**。现在登记进 manifest
    （标题与兄弟命令同款风格）。
- a6e9fa2: LSP navigation now agrees with itself: method and `catch` parameters have a
  definition, private class members keep their own identity, and renaming an
  aliased export renames the export instead of the local binding.
  
  - `textDocument/definition` returned `null` for a **class method parameter**, an
    **object method parameter**, and a **`catch` parameter**, while
    `textDocument/references` at the very same position returned the
    declaration. The symbol table only visited the parameters of three kinds of
    function, so those parameters never became definitions and the definition
    lookup fell through to a workspace fallback that found nothing. The symbol
    table now visits class methods, object methods, private methods, private
    fields, and `catch` clauses; a `catch` parameter is scoped to the `catch`
    clause itself.
  - A **private class member** (`#name`) was resolved as if it were the ordinary
    identifier `name`, so `definition`, `references`, and `rename` all landed on
    an unrelated binding with the same name — renaming a private method rewrote
    an unrelated exported symbol and its importers across files, breaking the
    module graph. A private member now has its own identity (`#name`), scoped to
    the class that declares it; `prepareRename` reports the placeholder with the
    `#`, and the edited range still covers only the identifier so the `#` is
    kept.
  - An **aliased export** (`export { a as b }`) packed two identities into one
    specifier: the local name `a` and the exported name `b`. Renaming through an
    importer collected the edit set by the local name, so it rewrote the local
    declaration and the local side of the export specifier while the importers
    were renamed to a name the module no longer exported — the module graph broke
    even though both files stayed syntactically valid. The local name and the
    exported name are now separate identities: renaming the exported name edits
    the exported side of the specifier together with the `imported` side of every
    importer, and never the local declaration; renaming the local name edits the
    local declaration and the local side of the specifier only. The exported-name
    position is no longer a dead end: `definition`, `references`,
    `prepareRename`, and `rename` all answer there.
- a6e9fa2: LSP: make the navigation face answer per the client's capabilities, encode
  URIs correctly, validate rename targets, and give every navigation request
  the same file gate.
  
  - **Bug 745 — `workspace/symbol` never returned class members.** The handler
    only walked the *top level* of `documentSymbols`, while class methods and
    class properties live in a symbol's `children` ⇒ they could never appear
    in a workspace search. The handler now walks the tree recursively and
    flattens it into `SymbolInformation[]`, expressing the hierarchy through
    `containerName` (which is what the flat LSP protocol expects).
  - **Bug 748 — `filePathToUri` and `uriToFilePath` were not inverses of each
    other.** The encoding side concatenated `file://` with the raw path (so
    `%`, `#`, `?` and spaces were never escaped) ⇒ the server produced URIs
    that were not valid URIs; the decoding side ran a bare
    `decodeURIComponent` ⇒ a malformed percent escape threw an uncaught
    `URIError` and aborted `didOpen` / `didChange` / `didClose`, leaving that
    document with **zero diagnostics**. The encoding side now uses Node's
    `pathToFileURL` and the decoding side uses `fileURLToPath` with a
    `try`/`catch` fallback (malformed input degrades to the undecoded text and
    never throws), so the two are exact inverses; `cacheKey` benefits as well.
    URIs for non-`file:` schemes (`untitled:` …) are still returned verbatim.
  - **Bug 749 — `textDocument/documentSymbol` ignored the client's
    capabilities.** The server never kept `params.capabilities`, so it always
    answered with the hierarchical shape and the full `SymbolKind` range even
    when the client declared `hierarchicalDocumentSymbolSupport: false` or a
    restricted `symbolKind.valueSet` (both are protocol violations). The
    navigation handlers now consume the client capabilities that
    `initialize` captured: a client without hierarchical support receives a
    flat `SymbolInformation[]` (`location` instead of
    `range` / `selectionRange` / `children`), and a kind outside the client's
    `valueSet` is clamped to a safe value inside that set (with a note in
    `detail`). When the client sends no capability section at all the default
    answer is kept — hierarchical shape, full `SymbolKind` range.
  - **Bug 750 — `textDocument/rename` never validated the new name.** The
    request's `newName` was used as the replacement text verbatim ⇒ a single
    rename could turn the source into invalid JavaScript (an invalid
    identifier, an empty name or a reserved word) and `node --check` would
    fail with a `SyntaxError`. The new name is now checked at the syntax
    level — it must be a legal JavaScript identifier, non-empty and not a
    reserved word — and an invalid name produces no edits at all.
  - **Bug 751 — the navigation requests each had their own file gate.** The
    sidecar contract file (`*.nudo.js`) was let through by `definition` only,
    was rejected by the other four navigation requests, and was listed by
    `workspace/symbol`, which had no gate at all ⇒ one coordinate, three
    different answers (the server contradicted itself). `definition` no longer
    has its sidecar escape hatch and `workspace/symbol` now uses the same
    path-level gate, so sidecar contract files are invisible to every
    navigation request. (The cost is that a source symbol can no longer jump
    into its sidecar contract; that capability needs the symbol table to model
    sidecar bindings and is tracked separately.)
- a6e9fa2: LSP: capture the client's capabilities at `initialize`, and give the
  navigation/IDE file gate a single source of truth.
  
  - **Bug 749 — the server never kept `params.capabilities`.** `onInitialize`
    only echoed the server's own capability declaration, so no handler could
    answer according to what the client asked for: `textDocument/documentSymbol`
    always answered with the hierarchical shape and the full `SymbolKind` range,
    even when the client declared `hierarchicalDocumentSymbolSupport: false`
    or a restricted `symbolKind.valueSet`. The client capabilities are now
    captured during `initialize` and handed to the navigation handlers through
    the existing `deps` object (no new package export). When the client sends
    no capability section at all the value stays `undefined` and the handlers
    keep the default answer (hierarchical shape, full `SymbolKind` range) — an
    old client must not degrade the server's output. The `initialize` result
    itself is unchanged, so the declared server capability inventory is
    untouched.
  - **Bug 751 — every request had its own file gate.** The sidecar contract
    file (`*.nudo.js`) was let through by `definition` only, was rejected by
    the other navigation requests and by all six IDE requests, and was listed
    by `workspace/symbol`, which had no gate at all — one coordinate, three
    different answers. The gate now has a single source of truth
    (`server.ts`'s `isNudoFile`, which explicitly excludes sidecar contract
    files) and the same predicate instance is injected into the navigation and
    the IDE handlers, so both sides answer alike. Sidecar exclusion is also
    spelled out in the predicate itself, so it survives a future drift of the
    path-level suffix table.
- a6e9fa2: LSP: three reverse guard tests for the navigation findings that no longer
  reproduce.
  
  This slice changes **no implementation code** — it only adds three regression
  tests that pin the *already fixed* behaviour of the navigation face. The
  symptoms described in the bug report do not reproduce on `HEAD`: they were
  covered by an earlier family, and the tests below are the guard rails that
  keep them from coming back (they are expected to **pass** on `HEAD`).
  
  - **Bug 746 — renaming a local alias must not drag the exported symbol and
    the other importers along.** Renaming the local alias of
    `import { oldName as alias } from "./xf-def.js"` now edits only the local
    side of the import specifier and its call site; the defining module and
    the other importer stay untouched. The opposite direction is pinned as
    well: renaming the exported name from the defining module edits that
    module and the *imported* side of every importer, and leaves the alias
    alone. (Covered by the Bug 710 fix of the earlier signature family.)
  - **Bug 747 — renaming a parameter must not drag the shadowing top-level
    variable along.** With `const x = 1;` next to `export function f(x)`, both
    directions are pinned: renaming the parameter edits only the parameter
    declaration and its use, renaming the top-level variable edits only that
    one place. `definition` and `references` stay scope-aware as well.
    (Covered by the Bug 709 fix of the earlier signature family.)
  - **Bug 1025 — the *imported* side of an aliased import resolves to the
    module it really imports.** With two files exporting the same name, the
    `definition` of the imported side lands in the imported module instead of
    the unrelated same-named export, and its `references` are not the empty
    array the report saw — they are the same set the non-aliased form
    returns. The underlying key space of the import binding table (it is
    still keyed by the local name alone) is tracked as a residual item; the
    position-aware lookup currently covers it.
- a6e9fa2: LSP: the workspace-folder subscription must never take the server down.
  
  `connection.workspace.onDidChangeWorkspaceFolders` is a **getter** in
  `vscode-languageserver@10.1.2` that throws
  (`Client doesn't support sending workspace folder change events.`) unless the
  client declared `capabilities.workspace.workspaceFolders` — and it only
  becomes usable **after** `initialize`, when the library has processed the
  client's capabilities. The server read that getter while it was still being
  constructed, i.e. before any client had spoken, so the getter threw for
  **every** client and the language server died on startup with
  
  ```
  Error: Client doesn't support sending workspace folder change events.
      at get onDidChangeWorkspaceFolders (…/vscode-languageserver/lib/common/workspaceFolder.js:38:23)
      at createNudoServer (…/packages/lsp/src/server.ts:374:3)
  ```
  
  The optional chaining (`?.`) did not help: it only guards `null` /
  `undefined`, not a thrown exception.
  
  The value is now read inside a `try`/`catch`; a client that does not
  support the notification face makes the server skip the subscription
  silently and start normally, and `initialize` still answers with the
  unchanged server capabilities. The subscription itself is kept: it is taken
  once at construction (in-memory connections) and, for a real transport, once
  more right after `initialize` — where the getter is finally ready — so the
  workspace-folder change handling (the authorization boundary follows the
  added/removed folders) keeps working instead of being silently dropped by
  the guard.
- e2d4688: The code-action face of the language server no longer crashes and no longer
  writes broken code into the user's sources.
  
  - The language server captured the agent-tool dependencies before the server
    had finished initializing, so every `textDocument/codeAction` request threw
    and the whole face was unavailable. The dependencies are now read on demand.
  - The quick fix for a missing call-site field wrote the literal `undefined`
    into the source, which then failed the very check it was meant to fix. The
    placeholder is now `null`, and the violation is still reported afterwards.
  - The quick fix that adds a field to a contract inserted it into the
    parameter list instead of the parameter's shape, producing a sidecar that
    no longer parsed. The insertion point is now located through the syntax
    tree, and a field that is already declared is not offered at all.
  - The quick fix that inserts a call-site field used a textual heuristic that
    could land inside a string literal. The insertion point is now located
    through the syntax tree, and the fix is not offered when there is no object
    argument.
  - The quick fix that writes a sidecar inserted the new declaration at the
    top of the file, which left the previous contents in place and produced a
    file with a duplicate export. The edit now covers the existing sidecar, and
    a plan that would duplicate an export is not offered.
- e2d4688: The "inline variable" refactoring of the language server now refuses to inline
  a value it cannot prove is safe.
  
  - A variable was inlined even when it was reassigned or captured by a closure,
    which changed the program's behaviour. The refactoring now only offers an
    inline action when the variable is provably single-assignment and not
    captured.
  - A variable was inlined across an export boundary, so the module's public
    API changed silently. Exports are now detected and left alone.
  - The refactoring was offered for a binding that the selected range does not
    actually cover, and it sometimes inlined the wrong occurrence of a shadowed
    name.
- e2d4688: fix(lsp): Extract to function 的插入点 / 语句切分 / 取名收口（族 23 片 C：Bug 732 / 734 / 736 / 740 / 742 / 971）
  
  - **Bug 732**：`Extract to function` 不再把原函数的 `export` 关键字偷给新函数 ——
    插入点改用**语句起点**（`export` 的列）而不是 `function` 关键字的列 ⇒ 模块公开 API
    不再从 `['f']` 静默变成 `['extracted']`。
  - **Bug 734**：被抽出的若是**赋值表达式**（`x = compute();`），调用点生成**赋值表达式**
    （`x = extracted(...)`）而不是硬编码的 `const x = ...` ⇒ 不再与外层 `let x` 重复声明
    （文件曾彻底不可解析）。原本就是声明时还原同种声明（`const` / `let` / `var`）。
  - **Bug 736**：新函数只插在**语句位置** ⇒ 箭头初始化式 / 对象字面量方法 / class 方法
    三种宿主不再产出不可解析的文件。
  - **Bug 740**：选区含 `break` / `continue` 时**拒绝**抽取（不再产出
    `SyntaxError: Illegal break statement`）；选区末条是 `return` 时**把返回值接回调用点**
    （`return extracted();`）⇒ 外层返回值不再被静默丢掉。
  - **Bug 742**：顶层选区的插入点跳过文件前导区（hashbang / 指令 / 前导注释）⇒ 新函数不再
    落到 `#!/usr/bin/env node` 之前（文件曾整体不可解析）。
  - **Bug 971**：新函数名做**占用检查**（在 `extract-function.ts` 内部，调用方零改动）⇒
    撞名时自动改名（`extracted` → `extracted1`）⇒ 不再出现
    `SyntaxError: Identifier 'extracted' has already been declared`。
  - 抽取产物新增「仍可解析」自检：坏产物一律不出 edit。
- 27a795e: 族 22 收口接线：方法改名在**归属歧义**时拒绝执行，而不是改出自相矛盾的代码。
  
  - 改一个类方法时，如果文件里同时存在「接收者归属解析不出来」的成员访问
    （形参、外部对象）**和**另一个同名但不同归属的成员，那么这个成员访问
    **可能**指目标方法、也可能指那个别的归属——静态上不可判定。此时改名只有
    两种自洽结果：全改（可能改到无关对象，运行时读到 `undefined`）或全不改
    （**定义改了、调用点没改**，同样读到 `undefined`）。两者都会改坏代码，
    所以现在**拒绝这次改名**：不产出任何编辑，编辑器显示该符号不可改名。
    准备改名的提示与真正的改名请求同口径，不会先让用户改、改的时候又拒绝。
  - 之前把「改定义、不改歧义调用点」当成安全的做法，实际它同样改坏代码；
    这一条修掉之后，改名要么覆盖全部可能的调用点，要么明确拒绝。
- 169ed52: The disk cache, the LSP and the Vite plugin now agree with the CLI about
  environments, budgets and injected modules.
  
  - The cache key did not contain the effective fork budget, so changing
    `NUDO_MAX_FORKS` still served the previous run's result. The effective
    value (environment variable, then `package.json`, then the default) is now
    part of the key.
  - An invalid `nudo.check.entryThrows` value was reported once per checked
    file. The warning is now printed once per distinct invalid value.
  - `@nudo:as` did not apply to an exported binding, so the tool still reported
    "bindings applied" while the type stayed unchanged. The override now
    matches the exported declaration as well.
  - `--what-if` attached an assumption to the wrong variable when a line ended
    with a comment, and it reported a made-up reason when two declarations
    shared a line. Assumptions are now anchored by statement identity.
  - The LSP and the Vite plugin never applied `@nudo:mock`, so a project that
    checked cleanly in the CLI reported a spurious "may throw" in the editor and
    in the build. Both now assemble the same injection channel the CLI uses.
- 3432d8c: `nudo/suggestCase`（LSP agent 工具）给出的见证建议不再落进引擎的「合成 / 固化」
  名字空间，并带上可判定的期望。
  
  - **改前**：工具把合成 case 的**原名**（`call@L<n>`）原样写进建议文本
    （`* @nudo:case "call@L4" ("bob")`）。该名字属于合成 / 固化见证的名字空间
    （`call@` = `nudo test --freeze` 固化的见证，`entry@` = 入口兜底见证）⇒
    用户照建议原样贴回源码后，同一个调用点会留下**两条**见证（工具建议的
    `call@L4` + 固化出来的 `call@L7`）。
  - **改后**：建议里的名字是**手写见证名** `witness@<n>`（与 `call@` / `entry@`
    不相交；名字只含字母 / `@` / 数字 ⇒ 指令文法承载得了；同一份源码每次建议
    同名 ⇒ 可重复贴回），并且每条建议都带上 **`=> expected`**（观测值，用
    `--freeze` 同一个序列化器产出 ⇒ 往返保真）⇒ 贴回后**真的**产生断言
    （进断言面、计入 `passed`），而不是一条没有期望的 `unchecked` 见证。
  
  引擎推不出结果（`unknown` / `any` / `opaque`）、调用抛错（`never`）或结果
  无法用指令文法表达时，不给期望（并在建议末尾说明条数）——宁可留一条诚实的
  无期望见证，也不写一条注定判红的期望。
  
  工具名 / 协议面不变（`nudo.suggestCase` / `nudo/suggestCase` / `suggestCase`
  三处表项未动）。
- Updated dependencies [02aa122]
- Updated dependencies [6ec8afc]
- Updated dependencies [7fea13a]
- Updated dependencies [bb8e201]
- Updated dependencies [5c750f2]
- Updated dependencies [e3b8791]
- Updated dependencies [8a5bf7e]
- Updated dependencies [8542f44]
- Updated dependencies [f11510a]
- Updated dependencies [5c750f2]
- Updated dependencies [29d766d]
- Updated dependencies [e3b8791]
- Updated dependencies [e3b8791]
- Updated dependencies [6e5344a]
- Updated dependencies [f896290]
- Updated dependencies [a069994]
- Updated dependencies [7fea13a]
- Updated dependencies [8bf3fd0]
- Updated dependencies [5749924]
- Updated dependencies [0f67015]
- Updated dependencies [2d96c29]
- Updated dependencies [e3b8791]
- Updated dependencies [f6538a2]
- Updated dependencies [e3b8791]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [2af2bae]
- Updated dependencies [e424592]
- Updated dependencies [e424592]
- Updated dependencies [e424592]
- Updated dependencies [e424592]
- Updated dependencies [e424592]
- Updated dependencies [ec0a9e4]
- Updated dependencies [ec0a9e4]
- Updated dependencies [ec0a9e4]
- Updated dependencies [ec0a9e4]
- Updated dependencies [ec0a9e4]
- Updated dependencies [ec0a9e4]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [0366b6d]
- Updated dependencies [ec0a9e4]
- Updated dependencies [c325a10]
- Updated dependencies [c325a10]
- Updated dependencies [b37321b]
- Updated dependencies [e2880fd]
- Updated dependencies [e59c991]
- Updated dependencies [e59c991]
- Updated dependencies [e59c991]
- Updated dependencies [e59c991]
- Updated dependencies [e59c991]
- Updated dependencies [e59c991]
- Updated dependencies [3d79864]
- Updated dependencies [e2880fd]
- Updated dependencies [e2880fd]
- Updated dependencies [e2880fd]
- Updated dependencies [e2880fd]
- Updated dependencies [e2880fd]
- Updated dependencies [e2880fd]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [da4fbfc]
- Updated dependencies [5dd89ca]
- Updated dependencies [97f28ed]
- Updated dependencies [97f28ed]
- Updated dependencies [97f28ed]
- Updated dependencies [97f28ed]
- Updated dependencies [97f28ed]
- Updated dependencies [97f28ed]
- Updated dependencies [97f28ed]
- Updated dependencies [e2880fd]
- Updated dependencies [5c750f2]
- Updated dependencies [4d1a249]
- Updated dependencies [af09752]
- Updated dependencies [fcaa9e9]
- Updated dependencies [7fea13a]
- Updated dependencies [9ccffb3]
- Updated dependencies [e9fdaa7]
- Updated dependencies [cc9b638]
- Updated dependencies [2688251]
- Updated dependencies [7fea13a]
- Updated dependencies [1caec28]
- Updated dependencies [69e67d3]
- Updated dependencies [69e67d3]
- Updated dependencies [69e67d3]
- Updated dependencies [b0878e3]
- Updated dependencies [b0878e3]
- Updated dependencies [a069994]
- Updated dependencies [493b8c2]
- Updated dependencies [d7ae28a]
- Updated dependencies [edc7590]
- Updated dependencies [5c750f2]
- Updated dependencies [ed4d259]
- Updated dependencies [e20c128]
- Updated dependencies [abff33b]
- Updated dependencies [e3b8791]
- Updated dependencies [5c750f2]
- Updated dependencies [c80456a]
- Updated dependencies [e6c4586]
- Updated dependencies [e6c4586]
- Updated dependencies [e6c4586]
- Updated dependencies [e6c4586]
- Updated dependencies [e6c4586]
- Updated dependencies [f87c9f9]
- Updated dependencies [27a795e]
- Updated dependencies [5c750f2]
- Updated dependencies [a3c95a4]
- Updated dependencies [e3b8791]
- Updated dependencies [7fea13a]
- Updated dependencies [d56cbd7]
- Updated dependencies [e5b3f38]
- Updated dependencies [089d4ec]
- Updated dependencies [ed4d259]
- Updated dependencies [f896290]
- Updated dependencies [169ed52]
- Updated dependencies [169ed52]
- Updated dependencies [169ed52]
- Updated dependencies [02aa122]
- Updated dependencies [02aa122]
- Updated dependencies [3432d8c]
- Updated dependencies [3432d8c]
- Updated dependencies [f47fd50]
- Updated dependencies [5c750f2]
- Updated dependencies [d2cf3cf]
- Updated dependencies [27cc16a]
- Updated dependencies [27cc16a]
- Updated dependencies [27cc16a]
- Updated dependencies [27cc16a]
- Updated dependencies [27cc16a]
- Updated dependencies [27cc16a]
- Updated dependencies [fbca6fb]
- Updated dependencies [aa23265]
- Updated dependencies [535adcd]
- Updated dependencies [5c750f2]
- Updated dependencies [535adcd]
- Updated dependencies [e3b8791]
- Updated dependencies [b6abab4]
- Updated dependencies [356172a]
- Updated dependencies [ebe909e]
- Updated dependencies [e3b8791]
- Updated dependencies [a069994]
- Updated dependencies [b37321b]
- Updated dependencies [b37321b]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [dde4b03]
- Updated dependencies [b37321b]
- Updated dependencies [b37321b]
- Updated dependencies [106ad1d]
- Updated dependencies [369a42d]
- Updated dependencies [29d766d]
- Updated dependencies [7fea13a]
- Updated dependencies [56f308e]
- Updated dependencies [5c750f2]
- Updated dependencies [7fd7468]
- Updated dependencies [ed4d259]
- Updated dependencies [f896290]
- Updated dependencies [ae69b28]
- Updated dependencies [5c750f2]
- Updated dependencies [8542f44]
  - @nudojs/core@1.16.0
  - @nudojs/service@1.10.0
  - @nudojs/parser@1.5.3

## 1.7.2

### Patch Changes

- Updated dependencies [4513a45]
  - @nudojs/core@1.15.2
  - @nudojs/parser@1.5.2
  - @nudojs/service@1.9.2

## 1.7.1

### Patch Changes

- Updated dependencies [76dee40]
- Updated dependencies [3f3b080]
- Updated dependencies [a3a5dee]
- Updated dependencies [3338ae5]
- Updated dependencies [471ddb3]
- Updated dependencies [2ab2f46]
- Updated dependencies [babee2b]
- Updated dependencies [4c6666b]
- Updated dependencies [1fed4a4]
- Updated dependencies [70631ed]
- Updated dependencies [367ef5a]
- Updated dependencies [8dd2b50]
- Updated dependencies [725c8e4]
  - @nudojs/core@1.15.1
  - @nudojs/parser@1.5.1
  - @nudojs/service@1.9.1

## 1.7.0

### Minor Changes

- 8faa2b0: **BREAKING** (runtime floor): `engines.node` raised from `>=20` to `>=22` on all published packages. Node 20 reached end-of-life on 2026-04-30, and the nightly engine-smoke matrix only covers Node 22 (the `packageManager`-pinned pnpm already requires `node:sqlite`, i.e. Node >= 22.5, to orchestrate at all). No code or API changes — installs on Node 20 will now warn per npm `engines` semantics.

### Patch Changes

- 52de5ca: Classify fs "miss" vs "read failure" everywhere. Replaced every
  `existsSync(p) && statSync(p)` double call (TOCTOU race + errno swallowing)
  with a single `statSync(p, { throwIfNoEntry: false })` per the repo's
  load-module convention: ENOENT stays a silent miss, EACCES/EIO surface via the
  site's error channel (top-level catch, `reports.push({error})`, exit-1
  message, or a logged warning) instead of masquerading as "file absent".
  Read-failure catches now branch on `e.code`: sidecar contracts unreadable for
  reasons other than ENOENT print a `warning: cannot read sidecar contract …`
  in `check`/`check --fix` (no more silent contract-blind green runs);
  `@nudo:mock` seed evaluation failures warn in `export` before degrading;
  `pnpm-workspace.yaml` read failures other than ENOENT abort `migrate` (a
  snapshot/read failure no longer disguises the file as "other" and skips
  rollback); mock files that exist but can't be read report `read-failed` with
  the errno instead of the misleading "Mock file not found"; npm entry
  probes and LSP module-candidate stats log persistent failures instead of
  degrading a package's export face to unknown or silently breaking
  go-to-definition; `contract --from-dts` path-like arguments that don't exist
  now error as `path not found` instead of being treated as npm package names
  ending in a misleading `no .d.ts files found`.
- 9a3d6e7: Stop silently swallowing business-Promise failures. `nudo check/test --watch`
  incremental rounds died silently when the round body threw outside the
  per-file try (`buildModuleGraph` / `evictForDependents` / `topoSortDirty`) —
  the screen just froze on the previous round's results; the error is now
  printed (`nudo <label> incremental failed: …`), mirroring the existing
  first-round BUG-023 handling. In the LSP server, `validateDocument` (didOpen /
  didChange debounce) and `handleNudoDepFileChanged` (didOpen / didChange /
  watched-files) rejections were discarded with an empty catch — a file throwing
  in the analyzer produced no diagnostics and no trace, forever; failures are
  now logged to stderr as `[nudo-lsp] …` lines. Best-effort client capability
  requests (`DiagnosticRefresh` / `CodeLensRefresh` / inlay-hint refresh) keep
  their intentional silent catch.
- Updated dependencies [aae0f96]
- Updated dependencies [52de5ca]
- Updated dependencies [1ccff57]
- Updated dependencies [8faa2b0]
  - @nudojs/core@1.15.0
  - @nudojs/service@1.9.0
  - @nudojs/parser@1.5.0

## 1.6.10

### Patch Changes

- Updated dependencies [c19bd48]
- Updated dependencies [c19bd48]
  - @nudojs/core@1.14.1
  - @nudojs/parser@1.4.24
  - @nudojs/service@1.8.0

## 1.6.9

### Patch Changes

- Updated dependencies [0d9e7de]
- Updated dependencies [0d9e7de]
  - @nudojs/core@1.14.0
  - @nudojs/service@1.7.0
  - @nudojs/parser@1.4.23

## 1.6.8

### Patch Changes

- Updated dependencies [f5c0c6e]
  - @nudojs/core@1.13.0
  - @nudojs/parser@1.4.22
  - @nudojs/service@1.6.25

## 1.6.7

### Patch Changes

- Updated dependencies [e4e491f]
- Updated dependencies [1881f97]
- Updated dependencies [1881f97]
- Updated dependencies [8466793]
  - @nudojs/core@1.12.0
  - @nudojs/parser@1.4.21
  - @nudojs/service@1.6.24

## 1.6.6

### Patch Changes

- Updated dependencies [08d7a55]
  - @nudojs/core@1.11.3
  - @nudojs/parser@1.4.20
  - @nudojs/service@1.6.23

## 1.6.5

### Patch Changes

- 82eaae8: Fix `nudo:recursion-truncated` misattributing call-cycle truncation to "depth/size budget", and make `nudo check --json` budget stats see the B-path (`$callNamed`) truncation (issue #158):
  
  - `enterCall` / `evalEnterCall` now attribute a truncation reason — `cycle` (same name+arg fingerprint already on the evaluation stack; data-dependent self/mutual recursion such as directory walkers or `grow`-style recursion) vs `depth` / `calls` (real budget exhaustion). The check diagnostic message, suggestion, structured action, and a new `reason` field on the issue (`cycle` | `depth` | `calls` | `budget`) split accordingly: cycle says *"budget cannot lift this"* and never points at `@nudo:budget`; depth/calls name the exact raisable dimension (`@nudo:budget depth=…` / `calls=…`).
  - The `check --json` / health budget block no longer reports `truncated:false` alongside a `nudo:recursion-truncated` info: B-path counters are latched across execution sessions within one host entry and surfaced as `evalCalls` / `maxEvalCalls` / `evalCallTruncated`, plus `cycleTruncated` and a sorted `reasons[]` set (single-file and multi-file envelopes, and the disk-cache round trip). Fork counters/truncation flags are latched per host entry too (the last-session snapshot could previously erase an already-reported `nudo:fork-truncated`).
  - The `@nudo:budget` quickfix (`nudo check --fix` / LSP code action) is no longer offered when the truncation reason is `cycle`; the `reason` is plumbed through `check --json`, the disk cache, LSP diagnostic data, and `materializeAction`.
  - Raising `@nudo:budget` on a same-args recursion could never lift the truncation — the old message misled real budget investigations into "directive ignored" hypotheses.
  - Loop-iteration truncation (`#loop-iterations`) no longer masquerades as recursion: it now emits its own `nudo:loop-truncated` info with an honest message and suggestion (the call-budget knobs cannot lift a loop budget — `@nudo:budget calls=/depth=` does not apply), gets a `loopTruncated` flag in the `check --json` / health budget block (single-file and multi-file envelopes), and no longer offers the misleading `@nudo:budget` quickfix it used to inherit from the recursion branch.
- Updated dependencies [82eaae8]
  - @nudojs/core@1.11.2
  - @nudojs/service@1.6.22
  - @nudojs/parser@1.4.19

## 1.6.4

### Patch Changes

- Updated dependencies [612d64f]
  - @nudojs/core@1.11.1
  - @nudojs/parser@1.4.18
  - @nudojs/service@1.6.21

## 1.6.3

### Patch Changes

- Updated dependencies [cce5e58]
- Updated dependencies [16cda31]
- Updated dependencies [cce5e58]
  - @nudojs/core@1.11.0
  - @nudojs/parser@1.4.17
  - @nudojs/service@1.6.20

## 1.6.2

### Patch Changes

- Updated dependencies [8806e93]
  - @nudojs/core@1.10.2
  - @nudojs/parser@1.4.16
  - @nudojs/service@1.6.19

## 1.6.1

### Patch Changes

- Updated dependencies [96090cd]
  - @nudojs/core@1.10.1
  - @nudojs/parser@1.4.15
  - @nudojs/service@1.6.18

## 1.6.0

### Minor Changes

- b8db17b: 参数契约折叠展示（inlay + hover + 签名）：
  
  - **inlay**：侧车 `fn()` 形参表达式原文（如 `where nullable(astNode)`）或 `@nudo:contract` 指令约束名替代谓词无损展开（lazy 判别联合展开可达数万字符），完整谓词经 LSP inlay tooltip 展示。侧车 ∧ 指令并存时展示 `expr ∧ name`（任一文本缺席则整体回落谓词全展）；整表达式别名（`import { astNode as N }` 的裸 `N`）规范化为导入名；派生形参（spread / computed）无静态文本，回落谓词全展。
  - **hover**：参数声明位 hover 折叠为声明形态（`node: nullable(astNode)`），函数名 hover 签名的契约参数同口径折叠；函数名 hover 的契约面 display 同步折叠。**体内引用位经求值器重放直读引擎求值态 Abs**（核心变更）：transpile `recordPositions` 插桩（`$nodoPos`——标识符值读 / 静态成员属性位 / 可选链成员跳属性位，计算成员记表达式起始位；记录并原样返回，语义恒等）+ `runTranspiled` 符号执行导出函数（入口 Φ 种子 + 契约参数 Abs），位置直读求值态 Abs——流敏感窄化为**引擎求值语义**（早退守卫 nullish 剥离 / 判别等值窄化 / `!==` 对偶 / typeof 守卫 / `&&` / `||` 链，Φ-native `$fork` 臂内 `withExecPhi` + `$narrowMemberEq` 剪影），非 LSP 层近似。显示阶梯：求值态与入口 Abs 等价（leqAbs 双向）或仅剥 nullish 的位置（声明位 / 检查点 / 成员访问对象 / 落回位）→ 折叠声明形态 + 类型值变量链接；窄化位（守卫 then 分支 / 成员读槽位 / 局部量）→ 求值态展示（`node: { type: lit("StringLiteral"), value: string } | { type: string }`——`showLits` 渲染 lit 判别值与侧车文法同形；开放尾臂按 may 态保守保留——其 `type: string()` 值域与 lit 判别重叠，成员读槽位在尾臂缺席 → `string | undefined` sound）。重放 fail-closed（求值失败 / 预算超限 / 无契约 / 非导出 / 解构形参）→ 回落声明形态面：`||` 组 then 分支（引擎 phi 合取不能表达析取事实）LSP 层按匹配臂联合源文本窄化（sound）；else 分支否定形态有界跳过。折叠面中的**类型值变量包为链接**（`[astNode](file://<依赖侧车>#L<定义行>)`——经侧车 import 表 / 本地顶层声明 / re-export 一级解析；渲染为 plain markdown——代码块内链接不渲染），替代原独立"契约原文"行；无引用变量的契约回落契约原文行。
  - **core API**：`formatShape(a, { maxDepth, showLits })`——`showLits` 把 `eq(self, lit(v))` pred（槽位为 `get(p, k)` 字段项、顶层为参数项）渲染为 `lit(v)`（默认 false——既有全部展示面口径不变）。
  - **修复**：exec 缓存命中（同内容侧车在不同路径——复制的契约）时不重跑 `execSidecar`，参数折叠文本注册表按路径键在命中路径补登记；此前第二个同内容侧车路径查不到折叠文本、回落谓词全展。
- fa52735: 参数契约 inlay hints（形参后 `where …`）默认关闭：显式契约（递归 AST 节点联合等）行内展开可达数万字符。新增 `nudo.inlayHints.parameters`（boolean，默认 `false`）三级配置——项目 `package.json#nudo.inlayHints.parameters` 显式值赢，宿主设置（VS Code `nudo.inlayHints.parameters` / Zed `language-servers.nudo.initialization_options.inlayHints.parameters`）只在项目未设置时作默认；`workspace/didChangeConfiguration` 实时生效并触发 `inlayHint/refresh`。返回类型 inlay（`: …`）、case hints 与 interface 档 inlay 不受影响；hover 仍展示完整契约。

### Patch Changes

- 334b914: Discriminant narrowing visible in slot display; mid-token hover resolution
  
  - `$narrowMemberEq` keep-arm refinement: surviving union members with a compatible discriminant slot now carry the `eq(slotTerm, lit)` fact on that slot (conjoined with any existing pred). `formatShape(showLits)` renders it via `litPredValue`, so the open-tail arm displays `{ type: lit("TemplateLiteral") }` after `node.type === 'TemplateLiteral'` instead of the unrefined `{ type: string }`; `memberEqClass` upgrades those members to `only`, improving chained discriminant narrowing and complement-arm pruning. `any`/`unknown` slots stay untouched (fail-closed markers).
  - `litPredValue` now reads `eq(self, lit)` facts through `and`-conjunctions, not only top-level eq preds.
  - LSP A0 hover replay resolves mid-token cursor positions: record keys are Babel start positions (`$nodoPos` uses `loc.start`), so a cursor anywhere inside an identifier span now resolves to that identifier's record instead of falling back to the declared-form fold (previously only the first column hit).
- f89677d: Hover 无响应排查修复：A0 重放缓存 LRU 化 + 进程级异常兜底
  
  - `absNodeReplayCache`（64 条上限）从「超限全清」改为 LRU 滚动淘汰（命中刷新新端、超限删最旧）。此前多文件浏览填满缓存后一次清空，后续 hover 全部触发冷重放（大文件同步重放数百 ms），与编辑防抖/诊断/inlay 同一事件循环排队，客户端感知 hover 卡死且无日志；LRU 后热条目（当前文件/最近浏览）在缓存压力下持续命中（实测雪崩 70 key 后原条目 12ms）。
  - server bin 入口注册 `unhandledRejection` / `uncaughtException` 兜底：默认行为下未捕获异步异常会静默终止进程（客户端只见 "server shut down"、无 stderr 留痕），现在记录后继续运行，把静默死亡变成可排查的日志事件。
- 94197eb: hover 弹窗可读性与 return 表达式推导：
  
  - **pretty 缩进展示**：`formatShape(a, { pretty: true })`（opts 挂 `ProjectionBudget.pretty`，与 `showLits` 同先例）——object 每槽一行 + 尾逗号 + 2 空格缩进递增；union 仅当至少一臂是复合 shape（object/array/map/set/fn 或渲染含 `{`）时按臂断行（` | ` 前缀换行），纯 prim/lit 联合保持单行（`string | null | undefined` 不断）；截断标记 `…`/`…cycle` 原样内联。默认（不传 pretty）输出字节不变——check 签名 / dts / inlay / 语义 token 面不受影响。应用点仅 hover 面：标识符 hover（identHover / A0 求值态）与 return 表达式 hover；`gSig` 签名、`paramDisplayOf` 声明形态折叠面保持单行。
  - **删除「契约原文」链接行**：hover 弹窗不再推送 `[契约原文](file://…#L<n>)` 链接（`linkedText` 变量链接面保留）；`HoverInfo.sidecarPath`/`sidecarLine` 字段随唯一消费方一并删除。
  - **return 表达式推导 hover**：transpile `ReturnStatement` 在 `recordPositions` 时把返回值包 `$nodoPos(src, line, column)` 记录到 **`return` 关键字起始位**（argument 起始位与内部根标识符读记录同键 first-wins 丢失；`emitRet` 单一 choke point 覆盖 asVar/try/loop/mutator 全路径；裸 `return;` 不记录）。LSP `absNodeAtPosition` 词中回落从 Identifier 泛化为任意带 loc 节点（候选仅当起始键已有记录，取最小 span——词中标识符行为不变）；新增无 ident 分支——hover `return` 关键字或表达式内非标识符位（`?.[`、`[0]`、`.`）直接显示推导类型（无 ident 前缀，pretty 渲染）。
- 35ce944: Fix recursive-fn local hover poisoning and arity-only fn hover display
  
  - `$nodoPos` position records and call/assign records now carry the caller-frame depth; hover replay surfaces (`absNodeAtPosition`, `collectEnclosingFnLocals`) only read outermost-frame records. Recursive functions on self-referential contracts (`lazy(() => astNode)`) no longer bind cycle-truncated `opaque unknown` into local-variable hovers (`obj` now shows the computed `null | string | undefined`).
  - `const x = <non-call init>` declarations record the bound Abs at the declarator-id position during hover replay (`recordPositions` only) — ternary/optional-chain/literal-initialized locals are hoverable (`prop`, `q`).
  - `callTranspiledExportFullInner` refines the called fn Abs `returnType` slot after a successful call (same policy as class method slots, display-only).
  - LSP hover: an arity-only fn Abs (empty `returnType` slot) no longer preempts the generalize intension face; fn-name/callee hovers show the full contract signature `(node: nullable(astNode)) => null | string | undefined` instead of `(arg0) => ?`.
- 5e275df: fix: review hardening — Map.groupBy empty-reduce crash, Bug 1 early-exit relational narrowing, fs-error graph-edge degradation, agent tool module graph, brand presence for URLSearchParams/TextDecoder/Intl, generator side-table $copy migration
  
  - `Map.groupBy` / `Object.groupBy`: shadow-domain join no longer bare-`reduce`s an empty unkeyed list (raw host `TypeError: Reduce of empty array with no initial value` escaped module evaluation → fail-closed unknown exports when the callback folds a literal key over arr/abstract-string-prim items); empty fold degrades to `unknown`.
  - Early-exit lift path (if-return followed by non-tail statements) now applies the same relational-arm narrowing as the regular IfStatement path (`narrowRelArmThunk`), fixing false positives like `if (x >= 0) return x; console.log(x); return 1;` under `@nudo:contract return nonNeg`.
  - `extractImportEdges` skips import edges whose target resolution throws `ModuleReadError` (EACCES/ESTALE, #135) instead of crashing module-graph construction (CLI watch start, incremental rebuild false-green rounds, LSP validation).
  - `new Function(...)` / `new Function("a", "b", ...)` validate every argument for the L2 may-throw gate, not just the first.
  - Brand presence tables: URLSearchParams (methods + `size`), TextDecoder (`decode` + accessors), Intl.NumberFormat/DateTimeFormat (`format`/`formatRange`/parts/`resolvedOptions`); URLSearchParams joins ITERABLE_BRANDS (@@iterator → function).
  - `$copy` snapshots migrate generator/match side tables (genDeferred throws, genIter/matchAll elements), so fork/switch-arm rebinding no longer silently drops deferred generator throws.
  - LSP agent tools (check/hover) build the module graph like the CLI and LSP validation do, fixing cross-module unknown collapse (E5 parity).
- Updated dependencies [334b914]
- Updated dependencies [94197eb]
- Updated dependencies [b8db17b]
- Updated dependencies [fa52735]
- Updated dependencies [35ce944]
- Updated dependencies [5e275df]
  - @nudojs/core@1.10.0
  - @nudojs/service@1.6.17
  - @nudojs/parser@1.4.14

## 1.5.1

### Patch Changes

- 71fd9fc: fix(lsp): 参数 hover——形参（含解构属性）从 PolyFn 面投影，不再空白
  
  - 根因：hover 的标识符解析只有模块级 import 绑定面（bindings / collectAbsBindingsFromGraph），形参从不入绑定表；带 `@nudo:case` 的函数体内更被整体短路（旧理由“保护 case 重放”，但重放面已删成恒 null）——`decide({ grade, findings })` 的参数声明与体内引用 hover 全空。
  - 修复：`getHoverAtPosition` 末段新增参数投影——traverse 直查光标最内层 enclosing 函数（不依赖指令存在，`extractDirectivesQuiet` 只返回带指令的函数），`generalizeFromAst`（与函数名 hover 同源：契约种子 refine + 模块图）后从 `PolyFn.entryShapes + formals` 解析：
    - 直接形参（id/default）→ `entryShapes[name]`；rest 同理；
    - 解构形参（pattern）→ `bound` 名经 `propKey` 投影到 placeholder 对象 slot（rename `{a: b}` 时契约可写 a 或 b，Abs 对象只有 slot a，语义正确）。
  - fail-closed 不变：无契约/无提升的参数与体内局部变量保持空（诚实 unknown，不冒充 any）；非 case 函数体内的 import 引用仍走绑定面。
  - 验证：npm-safe `decide.js`（手写侧车）——`grade` → `string / term: grade #path`，`findings` → `{ ruleId: string, severity: string, veto?: boolean }[]`，声明处与体内引用一致；函数名 hover 无回归；单测覆盖侧车解构投影、提升形参、fail-closed 三态。
  
  follow-up（同 patch）：
  
  - **标识符 hover 单行化**：参数/局部/绑定引用不再展开 `term/pred/conf` 多行内涵（那是函数名 hover 契约面的职责），单行外延 `grade: string` / `vetos: { ruleId: string, … }[]`。
  - **体内局部 hover**：`const vetos = vetoFindings(findings)` 这类调用初始化局部，经 entry 实参（契约种子）驱动一次 enclosing 调用，从 `EvalCallRecord.result`（callLoc 对位）投影；`let` 再赋值经 `$assignRecord` 范围内 join。结果按 (file, fn, 源指纹) 缓存，hover 连续触发不重跑。非调用/非赋值初始化保持 fail-closed。
  - **case 函数体内的模块级引用**：绑定面不再被 `insideCaseFn` 整体短路（原理由"保护 case 重放"已随重放删除失效）——`vetoFindings` 等导入/同文件顶层引用恢复 hover；导入函数 callee（本文件无声明、intension 面缺失）同样放行到绑定面。
  - 验证：stdio 实测 npm-safe `decide.js`——`grade`（声明/引用）单行 `grade: string`；`vetos` → `{ ruleId: string, severity: string, veto?: boolean }[]`（filter 后元素形状保持）；`vetoFindings` → fn Abs；函数名 hover（`● contract / hw` + 契约）无回归。
  
  follow-up 2（同 patch）：函数名 hover 弹层格式化——档线 + check 同口径签名单块
  
  - 旧弹层四块近重复：builder 语法契约模板 + symbolic 多行（shape + `conf:`）+ `_p0` 占位符 display 签名 + `ext:` 对照。现在：`● contract / hw` + 一个代码块，内容与 `nudo check` 签名**逐字同口径**（`formalParamSignatureNames` + `formatShape` 同公式，解构参数名还原为源码名；throws 归 check 门禁面）。
  - 面的归属：签名面只在**声明名**位置（函数声明 id / `const f =` / 方法键），调用 callee 保持调用点面 + intension；标识符保持单行外延。无损面（builder 模板 / absMultiline / intension）保留在 `nudo.hover` slash payload，仅 IDE 弹层去重。
  - 验证：stdio 实测 npm-safe `decide.js`——fn 名弹层 = 档线 + `decide({ grade, findings }: { grade: string, findings: { ruleId: string, severity: string, veto?: boolean }[] }) => { … }`，与 `nudo check` 输出逐字一致；`grade` / callee hover 无回归；新增 attachHover markdown 组装用例（此前弹层组装零覆盖）。
- Updated dependencies [2af4016]
- Updated dependencies [2af4016]
  - @nudojs/core@1.9.4
  - @nudojs/parser@1.4.13
  - @nudojs/service@1.6.16

## 1.5.0

### Minor Changes

- 04a6d1d: fix(lsp): IDE 面（hover/inlay/check 诊断）接入模块图——跨模块 import 塌缩 unknown 的假空与假红
  
  - 根因：CLI `nudo check` 经 `buildCheckInjection` 把 `evalAbsModuleGraph` 模块图传给 `checkSource`/`generalizeFromAst`，而 LSP 侧同族调用（hover intension、`collectAbsInlays`、`checkToLspDiagnostics`）不带图——跨模块 import 不可解析，函数体求值 fail-closed。表现：函数名 hover 显示 `(_p0: A1) => unknown / conf: opaque`（参数无侧车种子 + 返回 unknown），Abs inlay 为空/unknown，且 `nudo:unproven-return` 假红（CLI 同文件全绿）。求值引擎本身精确（entry@/combinedAbs 无误），仅 host 装配缺口。
  - `validation.ts` 新增 `evalAnalysisModules(filePath, source)`：`evalAbsModuleGraph` 组装（abs-modules-graph 内容缓存，重复调用廉价；cycle 不注入，与 CLI hasCycle 分支同语义 fail-closed）。
  - `lsp-surface.ts` 函数名 hover 的 `generalizeFromAst` 补 `refine`（fromFile/loadModule/autoBind——此前连 refine 都没传，参数丢契约种子成 A1）与 `modules`（经 `SurfaceReuse.modules`）。
  - `core/algebra/inlay.ts` `CollectAbsInlaysOpts` 增加 `modules` 透传给 generalize；`server-ide.ts` hover/inlay 处理器组装并传入图。
  - 验证（npm-safe scanner decide.js，手写侧车 + 跨模块调用链）：修复后 hover = 契约 + `{confidence: 1|0.9|0.7|0.95, grade: "F"|string, …}`，inlay 三函数全精确，假红诊断 0；全套 vitest 1841 通过。
  
  feat(lsp): 观察选择器——contract 成为与各 case 并排的 ●/○ 选项 + 档线改名 `● contract / hw|gen|imp`
  
  - 档线改名：CodeLens / hover 首行 / inlay 档投影的 `● interface / handwritten|generated|implicit` 统一改为 `● contract / hw|gen|imp`（`formatInterfaceTierLine` 单源，新增 `INTERFACE_SOURCE_ABBR` 导出）。
  - **contract 是观察选择器的一项，与各 case 互斥**（IDE 内点 ●/○ 切换，非配置开关）：
    - 默认 `● contract / hw|gen|imp`、全部 case `○`——与分析器默认（无激活 case 不跑 case 种子）一致（此前 case 0 默认显示 ● 与实际观察态不符）；
    - 点击 case（`nudo.selectCase`，已有）→ 该 case `●`、契约转 `○`；点击契约选项（新增 `nudo.selectContract`，executeCommand + `nudo/selectContract` 请求别名，位置参数 `[uri, fn]`）→ 取消激活 case（幂等）；
    - inlay 档投影镜像激活态（`●/○ contract / …`）；persist/draft 动作与 `call@`/`entry@` 观察层不受选择影响。
  - hover 与 Abs inlay（参数约束/返回 term/pred）不参与选择器（推导面）。

### Patch Changes

- b6495c6: fix(service): check 结果对瞬时/持久 fs 故障确定性化（#135 少集模式）
  
  - `resolveModuleFile` 改单次 statSync（消灭 existsSync+statSync TOCTOU 双调用）：ENOENT/ENOTDIR/EISDIR 按候选 miss；其余 errno（EACCES/EIO/ESTALE/EMFILE…）抛 ModuleReadError，不再被 existsSync 吞成「无此文件」。
  - 持久 fs 故障：侧车 ambient 绑定显式报 error 级 `nudo:interface-load`（带路径+errno）且 check exit 1——修复前同一故障静默丢整族契约诊断（constraint-violated/unproven-return 整体消失、无任何诊断、exit 0 假绿，且跨版本逐字节相同）。
  - 瞬态故障自愈：checkSource per-call loadModule 缓存对「抛错」不缓存、下一探测重试——单次 stat 抖动不再钉死整场 miss。
  - `LoadDepsFingerprint.readError`（`readerr:` 前缀，`trunc:` 优先）：读错误轮指纹键不可信，check 整文件 memo / generalize L0 / evaluator memo / analysisFileCacheKey / LSP 校验指纹一律 fail-closed 不读不写，杜绝错误轮与 miss 轮互为跨次陈旧命中。
  - `findProjectConfig` stat 错误分类：非 ENOENT 的 package.json stat 故障 stderr 告警 + 子树 fail-closed（不静默继承/丢失 profile、env 名单），修复 severity 漂移（adoption 丢失导致 entry-may-throw error↔warning 摆动）。
- Updated dependencies [b6495c6]
- Updated dependencies [b6495c6]
- Updated dependencies [04a6d1d]
  - @nudojs/core@1.9.3
  - @nudojs/service@1.6.15
  - @nudojs/parser@1.4.12

## 1.4.12

### Patch Changes

- Updated dependencies [c8e0417]
  - @nudojs/core@1.9.2
  - @nudojs/parser@1.4.11
  - @nudojs/service@1.6.14

## 1.4.11

### Patch Changes

- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
  - @nudojs/core@1.9.1
  - @nudojs/parser@1.4.10
  - @nudojs/service@1.6.13

## 1.4.10

### Patch Changes

- Updated dependencies [aeb6f7e]
  - @nudojs/core@1.9.0
  - @nudojs/parser@1.4.9
  - @nudojs/service@1.6.12

## 1.4.9

### Patch Changes

- Updated dependencies [05c2c8c]
- Updated dependencies [33239da]
- Updated dependencies [3588ddd]
- Updated dependencies [c647af8]
  - @nudojs/core@1.8.0
  - @nudojs/parser@1.4.8
  - @nudojs/service@1.6.11

## 1.4.8

### Patch Changes

- Updated dependencies [427da20]
- Updated dependencies [427da20]
  - @nudojs/core@1.7.10
  - @nudojs/parser@1.4.7
  - @nudojs/service@1.6.10

## 1.4.7

### Patch Changes

- Updated dependencies [b14ac2d]
  - @nudojs/core@1.7.9
  - @nudojs/parser@1.4.6
  - @nudojs/service@1.6.9

## 1.4.6

### Patch Changes

- Updated dependencies [58b7938]
  - @nudojs/core@1.7.8
  - @nudojs/parser@1.4.5
  - @nudojs/service@1.6.8

## 1.4.5

### Patch Changes

- Updated dependencies [d6fa067]
- Updated dependencies [92e6a5f]
  - @nudojs/core@1.7.7
  - @nudojs/parser@1.4.4
  - @nudojs/service@1.6.7

## 1.4.4

### Patch Changes

- Updated dependencies [856d8bf]
  - @nudojs/core@1.7.6
  - @nudojs/parser@1.4.3
  - @nudojs/service@1.6.6

## 1.4.3

### Patch Changes

- Updated dependencies [4c3fafd]
  - @nudojs/core@1.7.5
  - @nudojs/parser@1.4.2
  - @nudojs/service@1.6.5

## 1.4.2

### Patch Changes

- Updated dependencies [0fd8e1a]
  - @nudojs/core@1.7.4
  - @nudojs/parser@1.4.1
  - @nudojs/service@1.6.4

## 1.4.1

### Patch Changes

- 50e50f1: fix(core): filter 元组投影保真 + assign 拓宽补全数组 sum（OSS semver L1 FP）
  
  - `filter` 空元组结果从 `unknown[]`（无界长度）改为 `[]`；不确定谓词对 ≤3 元组
    枚举精确子序列和（长度有界——filter 不增元素），更大元组保持无界 arr（sound 旧口径）
  - `widenForAssign` 补全数组 sum 分支：全 tuple/arr 成员的 sum 按 tuple 分支同口径
    拓宽为单 arr（可变绑定持数组后赋任意数组是合法 JS）；混入 obj/prim 的 sum 仍精确对账
  - 复合效果：循环 push-join 绑定（`[] | [unknown]`）重赋 `map(...).filter(...)` 不再
    假报 `nudo:assign-mismatch`（benchmark/oss 语料 semver/bin/semver.js L109，#91
    循环 pack 健全化暴露的既有失真）；元素改型等真违例仍报
  - lsp：补全面放行 path-conf 元组（filter 子集和臂成员的 length 是诚实字面量），
    sum 臂 detail 渲染去重
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
  - @nudojs/core@1.7.3
  - @nudojs/service@1.6.3
  - @nudojs/parser@1.4.0

## 1.4.0

### Minor Changes

- 446914f: feat(lsp): server 端接收宿主 analysis.mode 默认值——initialize 的 `initializationOptions.analysis.mode` 与 `workspace/didChangeConfiguration` 的 `settings.nudo.analysis.mode` 在项目 package.json#nudo.analysis.mode 未显式设置时作为默认 gate 档（项目显式值优先），变更时重检打开文档（新纳入出诊断、新排除清诊断）。VS Code 扩展侧此前声明的 `nudo.analysis.mode` 设置由此真正生效。

### Patch Changes

- 39332ca: fix(core): filter 元组投影保真 + assign 拓宽补全数组 sum（OSS semver L1 FP）
  
  - `filter` 空元组结果从 `unknown[]`（无界长度）改为 `[]`；不确定谓词对 ≤3 元组
    枚举精确子序列和（长度有界——filter 不增元素），更大元组保持无界 arr（sound 旧口径）
  - `widenForAssign` 补全数组 sum 分支：全 tuple/arr 成员的 sum 按 tuple 分支同口径
    拓宽为单 arr（可变绑定持数组后赋任意数组是合法 JS）；混入 obj/prim 的 sum 仍精确对账
  - 复合效果：循环 push-join 绑定（`[] | [unknown]`）重赋 `map(...).filter(...)` 不再
    假报 `nudo:assign-mismatch`（benchmark/oss 语料 semver/bin/semver.js L109，#91
    循环 pack 健全化暴露的既有失真）；元素改型等真违例仍报
  - lsp：补全面放行 path-conf 元组（filter 子集和臂成员的 length 是诚实字面量），
    sum 臂 detail 渲染去重
- 446914f: fix(lsp): 高频 IDE 入口零缓存与会话 Map 无界增长修复。hover / completion / signatureHelp 现先过 `getCachedOrAnalyze`（同一未变文件连续触发只跑一次全量分析），lsp-surface 复用传入的 `result.bindings` + 条目 AST（`cachedAstFor`，随条目同指纹失效）——不再每次 transpile + new Function 整文件求值，`getHoverAtPosition` 内部重复 parse（自身一次 + `file ?? parse(source)` 兜底）删除。Abs-check 主通道诊断挂进 analysisCache 条目（`getCachedCheckDiags`；source/deps/cfg 指纹同键，与 evaluator 诊断同口径失效），push 防抖与 pull 诊断不再每次全量 checkSource + extractDirectives。`depsFingerprint` 从「只 hash 自身侧车」改走 core `loadModuleDepsFingerprint`（覆盖 `@nudo:import` 全部 .nudo.js / require / 动态 import / 侧车闭包）——被 import 侧车内容变更（无 watcher 事件）不再命中陈旧缓存；截断走 fail-visible 唯一指纹。analysisCache / knownFiles / nudoDepParents 套与 service `getSessionCacheLimits` 同源的 LRU 上限（maxFiles / 4×maxFiles，0 = 关闭该层）。IDE 处理器（hover/completion/codeLens/inlayHint/semanticTokens/signatureHelp）catch 不再静默——统一 `connection.console.error` 留痕，返回语义不变。signatureHelp 的 `findEnclosingCall` 手写递归 visitor 改 @babel/traverse：区间判定含列（旧实现只比行号），参数下标按完整区间计算（跨行参数不再被「start 在前 → +1」误判，尾逗号 → arity）。
- Updated dependencies [446914f]
- Updated dependencies [446914f]
- Updated dependencies [a00bccc]
- Updated dependencies [446914f]
- Updated dependencies [39332ca]
- Updated dependencies [446914f]
- Updated dependencies [446914f]
- Updated dependencies [446914f]
- Updated dependencies [89358f2]
- Updated dependencies [89358f2]
- Updated dependencies [89358f2]
- Updated dependencies [446914f]
  - @nudojs/core@1.7.2
  - @nudojs/service@1.6.2
  - @nudojs/parser@2.0.0

## 1.3.2

### Patch Changes

- Updated dependencies [ef514a8]
  - @nudojs/core@1.7.1
  - @nudojs/parser@1.3.2
  - @nudojs/service@1.6.1

## 1.3.1

### Patch Changes

- Updated dependencies [f6ec0e8]
  - @nudojs/core@1.7.0
  - @nudojs/service@1.6.0
  - @nudojs/parser@1.3.1

## 1.3.0

### Minor Changes

- 2f9717b: repo-wide correctness batch (fix-10: 19 fixes + 3 design-defect fixes)

  Security & correctness:
  - type-expression AST whitelist blocks @nudo:case/@nudo:as RCE (P0)
  - unified export/binding-name sanitization (reserved words / collisions)
  - slot & export tables read via own-property, blocking Object.prototype members

  Type system:
  - tuple rest slot effective across leq / widen / runtime / schema / dts
  - x++/x-- propagate term/pred/Φ constraints from the same source as +=/-=
  - key-channel literals distinguish -0/0 (litKeyString)
  - projection/format exits unified under ProjectionBudget: cycle & depth truncation observable

  CLI gates & contracts:
  - health --from path errors fold into pathErrors; ok↔exit single source
  - migrate verify/health pass skips, judged same as nudo check
  - malformed JSDoc directives no longer silently dropped / line-swallowed / host-throwing
  - case-arg recursion depth cap 32 (DoS protection)

  Service layer:
  - cache-limit precedence explicit > env > project; env params take effect per call
  - session LRUs aligned with BoundedLruMap (overwrite refreshes position; max=0 read miss)
  - module-cache entries carry subtree content fingerprints; transitive invalidation cohesive (DESIGN-002)
  - sidecar contract identity = export name, binding name aliasable; reserved-word / string exports emitted safely (DESIGN-003)
  - @nudo:import alias lookup uses the original export name; miss reports a diagnostic

  Parsing & diagnostics:
  - eval diagnostics cover rest / default-value / named-expression declarations and computed-key references
  - ambient sidecar lookup includes .nudo.mjs; suffix set single source of truth

  S2/S5/S6 tracking batch (BUG-017–028):
  - type inference: collectPredVars collects assumeFinite constraints; eqLit channel tagged (eq(x, lit(undefined)) projectable); non-finite bounds (NaN/±Infinity) not projected; fn rest non-array types promoted to (T)[]; optional param names keep `?`
  - gates & CLI: check --fix preserves gate semantics (residual errors exit 1; flag combos are usage errors); variadic flags swallowing positional args → targeted usage error + `--` terminator; export on the PathError face (nudo:path-* + nudo:path-io); findProjectConfig parse-failure diagnostic + stop
  - eval engine: injection-table collection exceptions fail-closed (never a half table); same-name class collision epoch detection + fallback observation; EvalCallRecord.threw required + bridge fail-closed (omitted threw → throwsAbs unknown); tryEvalCall explicit isAbsVal guard
  - LSP / error face: validateText document version gate (stale analysis never published); diagnostic / agent error message absolute-path redaction (home→~, root→.); injection setup failure surfaces and blocks exit
  - observation face: standard-schema missing-key vs explicit-undefined distinction; dts projection optional param names, fn rest TS validity

  PR #80 review batches (merge 7e6051ae):
  - own-property reads across sidecar import/export tables and the modules table; emit-identity dedup; quote-aware sidecar binding scan; check injection-failure gate (no fake-green --json exit, no degraded cache write); class-collision epoch scoped to the entry-call phase; LSP error redaction with real workspace roots; health --from requires explicit paths

### Patch Changes

- Updated dependencies [2f9717b]
  - @nudojs/core@1.6.0
  - @nudojs/service@1.5.0
  - @nudojs/parser@1.3.0

## 1.2.0

### Minor Changes

- 64ca356: feat: clamp bounds + scalar-over-sum + action-map quickfixes (#68 #69)
  
  ## #68 inference
  
  - `Math.min` / `Math.max` / `Math.round` (and floor/ceil/trunc) propagate
    operand numeric bounds: `max(0, min(100, n))` derives `[0, 100]`.
  - NaN is explicit (option 1): a possibly-NaN operand yields `NaN | number@bounds`,
    so clamp contracts stay honest; `if (Number.isNaN(n)) return …` narrows the
    false arm (`ne(n, NaN)`) and the guarded clamp is provable.
  - Scalar return contracts now distribute over sum arms like shape/array
    (`nullable(c)` + multi-return `null | number` is provable). Gold-FP
    protection kept: any-widened bare-prim arms downgrade siblings to
    `unproven-return` warnings instead of errors.
  
  ## #69 DX
  
  - `actionsForIssue` kinds are materialized as LSP quickfixes with
    `[fix]` / `[silence]` / `[review]` / `[adjust]` / `[scaffold]` titles.
  - `nudo check --fix [--only <code>] [--write]` reuses the same edit layer
    (default dry-run prints unified diffs).
  - Body-read fields auto-fill types from usage (`node.type === "x"` →
    `string()`, arith → `number()`, no evidence → `any()`); never emit empty
    `shape({})`.
  - L2 `entry-may-throw` suggestions include a copyable sidecar clause.

### Patch Changes

- Updated dependencies [64ca356]
  - @nudojs/core@1.5.0
  - @nudojs/service@1.4.0
  - @nudojs/parser@1.2.1

## 1.1.10

### Patch Changes

- f10066d: fix: repository-scale bug hunt — algebra, CLI, IDE, cache, release hardening
  
  Correctness (core algebra / check):
  - `Symbol() < 1` now TypeError (cmp relational ops); `eq`/`ne` unchanged
  - bare prim contracts reject obj/arr/tuple/fn/brand/eff returns
  - `lit(undefined)` is a real literal (`LitValueResult {ok,value}` tagged path)
  - empty-sum reduce guards (DEC-006); explicit re-exports win over `export *`
  - projection fidelity: tuple holes, tuple-rest parens, schema eq-app anchoring
  
  Design refactors (additive public API):
  - `LitValueResult` + bigint in `LiteralValue`
  - `AbsApplyResult {abs,throws}` + `callTranspiledExportApply` (sole wrap point) + `$call` throws routing
  - `directive-scan` single-source extractors; directives bind AST nearest Function (nested/class/object methods)
  - `stablePathKey` / `stablePathKeyGraph` for L0/LSP/CLI/disk path identity
  
  Product / CLI / migrate:
  - `check --json` path errors enter the CheckJson envelope (`pathErrors`, `ok:false`); ok↔exit single source
  - migrate: missing paths error (no parent `package.json` fallthrough); retire is atomic with rollback; rewritten paths are single-quoted
  - malformed directives warn instead of silent drop; `@nudo:skip` requires explicit types
  
  Service / cache:
  - disk-cache atomic write + portable path keys (incl. maxForks in cache key)
  - pure memo replays may-throw; bounded memo maps; sidecar EACCES ≠ missing
  
  IDE / extension:
  - LSP path-key unify (Windows drive forms); directive diag watermark; hover follows G2 scope
  - VS Code client catches start/sendRequest; selectCase rollback
  
  Release / CI supply chain:
  - `gen-llms` confines slug writes under build root (path-escape fix)
  - gate-major: 2.x / major jumps / first 1.0.0 need `confirm_major`; 1.x train auto-publishes
  - release: quoted secrets, tag whitelist + semver precedence incl. prerelease, pinned website actions
- Updated dependencies [f10066d]
  - @nudojs/core@1.4.0
  - @nudojs/parser@1.2.0
  - @nudojs/service@1.3.0

## 1.1.9

### Patch Changes

- Updated dependencies [8df9215]
  - @nudojs/core@1.3.1
  - @nudojs/parser@1.1.9
  - @nudojs/service@1.2.4

## 1.1.8

### Patch Changes

- Updated dependencies [6bc08c7]
- Updated dependencies [d925692]
- Updated dependencies [c717017]
  - @nudojs/core@1.3.0
  - @nudojs/parser@1.1.8
  - @nudojs/service@1.2.3

## 1.1.7

### Patch Changes

- Updated dependencies [662aeb5]
  - @nudojs/core@1.2.2
  - @nudojs/parser@1.1.7
  - @nudojs/service@1.2.2

## 1.1.6

### Patch Changes

- Updated dependencies [7b8df37]
- Updated dependencies [af8cb68]
- Updated dependencies [ff37d91]
  - @nudojs/core@1.2.1
  - @nudojs/service@1.2.1
  - @nudojs/parser@1.1.6

## 1.1.5

### Patch Changes

- 5ff4202: refactor!: rename B-path / BPath engine identifiers to eval / evaluator
  
  The AST-walk interpreter is long gone, so the dual-engine campaign name
  "B-path" no longer means anything and forced a glossary entry just to
  explain itself. The single production evaluation engine is now simply
  the **evaluator** (mechanism: transpile → `new Function` on Abs).
  
  Renamed B-path engine to evaluator/eval — see the @nudojs/core table above.
- Updated dependencies [5ff4202]
- Updated dependencies [5ff4202]
  - @nudojs/core@1.2.0
  - @nudojs/service@1.2.0
  - @nudojs/parser@1.1.5

## 1.1.4

### Patch Changes

- Updated dependencies [634932f]
  - @nudojs/core@1.1.4
  - @nudojs/parser@1.1.4
  - @nudojs/service@1.1.4

## 1.1.3

### Patch Changes

- Updated dependencies [3bf9997]
- Updated dependencies [43fb345]
  - @nudojs/core@1.1.3
  - @nudojs/parser@1.1.3
  - @nudojs/service@1.1.3

## 1.1.2

### Patch Changes

- Updated dependencies [c1f3e93]
  - @nudojs/core@1.1.2
  - @nudojs/parser@1.1.2
  - @nudojs/service@1.1.2

## 1.1.1

### Patch Changes

- Updated dependencies [86d1f87]
- Updated dependencies [892899d]
- Updated dependencies [faccd76]
  - @nudojs/core@1.1.1
  - @nudojs/parser@1.1.1
  - @nudojs/service@1.1.1

## 2.0.0-beta.1

### Major Changes

- 4305674: Split the `@nudojs/service` god package: harvest → `@nudojs/harvester`, IDE surface → `@nudojs/lsp`, emit products consolidated under `@nudojs/service/emit`.
  
  **BREAKING** for `@nudojs/service` subpath consumers:
  
  | Removed subpath | Migrate to |
  |---|---|
  | `@nudojs/service/interface` | `@nudojs/service/emit` |
  | `@nudojs/service/dts` | `@nudojs/service/emit` |
  | `@nudojs/service/case` | `@nudojs/service/emit` |
  | `@nudojs/service/lsp` | `@nudojs/lsp` (library entry — no server side effects) |
  | `@nudojs/service/harvest` | `@nudojs/harvester` |
  
  `@nudojs/service` keeps `.`, `./analysis`, `./evaluator`, `./emit`. The language server moves to `@nudojs/lsp/server` (bin `nudo-lsp` unchanged); `@nudojs/lsp` is now a side-effect-free library entry re-exporting the IDE surface.
  
  No dependency cycles: `lsp → service`, `harvester` stays independent of `service`. Emit is a service subpath (same package). Public function signatures and diagnostic codes are unchanged.

### Patch Changes

- Updated dependencies [4305674]
  - @nudojs/service@5.0.0-beta.1

## 2.0.0-beta.0

### Major Changes

- 22baf33: feat!: product CLI face only — remove deprecated verbs/aliases; L2 entry may-throw
  
  - **BREAKING — deleted with no compatibility layer:** verbs `infer` / `types` / `interface` / `refine` / `generate` / `emit` / `guard` / `doctor` / top-level `watch` / `harvest`; flags `--callsites`, `--output`, `--format zod`, `--dts`, `--emit-cases`; API `absToZodSchema`; `InferJson`/`serializeInferJson` → `CaseJson`/`serializeCaseJson`; LSP agent tools `nudo.infer` / `nudo.interface*` and aliases → `nudo.test` / `nudo.contract*`; config key `package.json#nudo.interface.*` → `package.json#nudo.contract.*`. Root scripts `infer`/`types`/`interface` removed.
  - Primary verbs: `check` / `test` / `contract` / `export` / `health` / `env harvest`. Observation is check signatures + test case reports + IDE hover. Thin shell `@nudojs/nudojs` follows `@nudojs/cli` majors.
  - L2: undigested may-throw on entry/export functions is `nudo:entry-may-throw` (default **error**). Configure with `--ignore-throws` / `--entry-throws` or `package.json#nudo.check.{ignoreThrows,entryThrows}`.
  - Nested try: soft may-throw from an inner try re-homes to the enclosing try frame. Catch rethrow does not digest soft effects.
  - `check` always prints signatures on success; unconstrained entry params display as **`any`** (true `unknown` = inference failure + `nudo:unknown-inference`).
  - `test` prints every case including synthetic `call@`/`entry@`; only declared `@nudo:case` expectations affect exit. `--freeze[=update]` solidifies witnesses.
  - Flags: `--from`, `export --format dts|guard|schema|standard|all` (`--dialect zod` for schema), `export --out`. `--json` cannot combine with `--abs`.
  - Design docs consolidated: truth sources `design-kernel-merge.md` + `design-cli-semantics.md`; domain designs compressed to status summaries.
  - Breaking for CI scripts that still call old verbs or read old config keys.
- 0e1432a: feat!: source contract directive is `@nudo:contract` only
  
  `@nudo:refine` and `@nudo:interface` are deleted with no alias layer. The product word is **contract** end to end (sidecar `*.nudo.js`, `@nudo:contract`, `nudo contract`, `package.json#nudo.contract.*`).
  
  - **BREAKING:** replace every `@nudo:refine` / `@nudo:interface` with `@nudo:contract` (including `@nudo:contract return <constraint>`). Grammar is unchanged: `@nudo:contract <param> <constraint>`.
  - Constraints still enter Abs as Preds and participate in algebra (`x>0` ⇒ `x+1>1`) — this is not a call-site validation gate.
  - Diagnostic codes `nudo:interface-*` are unchanged in this release.
  - Chinese product copy uses 契约, not 精化.

### Minor Changes

- P1–P3 engineering hardening (review follow-ups) — no product-face breaks
  
  - **@nudojs/parser**: export typed Babel AST narrowers (`ast-guards.ts`); service `analyzer-ast` / lsp `symbols` no longer use `as any` on nodes.
  - **@nudojs/cli**: extract pure decision modules (`check-gate-config`, `check-json-map`, `check-ci-flags`, `export-format`) and cover them with in-process unit tests; per-package coverage floors raised.
  - **@nudojs/service**: host cache-invalidation contract documented (`docs/design/cache-invalidation.md`) + C1–C8 regression tests; LSP targeted eviction now clears path-env and abs-module cache for changed deps.
  - **@nudojs/lsp**: `server.ts` split into watch/commands/navigation/code-actions/ide modules (public API unchanged); path-env clear on dependent eviction.
  - **@nudojs/service**: `interface-derivation` / `analyzer-orchestrate` split into cohesion modules with stable facades.
  - Docs: trust-boundary note in Quick Start, version narrative consistency, env mock-boundary checklist, CheckJson `actions[]` field table.
  - vite-plugin: named `logAnalysisSummary` helper (logging surface unchanged).
- 5a5e167: **feat(export)+review P0–P2**: dialect-aware schema export, Standard Schema path, CLI/LSP honesty fixes.
  
  Service / schema:
  - `absToSchemaSource` / `projectAbsToSchema` / `absToSchemaNode` — SchemaNode carries refinements and `dropped` notes.
  - Projection prefers core `absToConstraint` (parity for `eq(self,lit)` → `z.literal`, or-literal unions, int/bounds/string length).
  - Schema projection API: `absToSchemaSource` / `projectAbsToSchema` (zod via `{ dialect: "zod" }`).
  - New `absToStandardSchemaModule` / `validateSchemaNode` — Standard Schema v1 modules (`~standard`, vendor `nudo`).
  
  CLI:
  - `nudo export --format schema [--dialect zod]` → `*.nudo.schema.<dialect>.ts`
  - `nudo export --format standard` → `<fn>.nudo.standard.ts` (contract-first domains; joinAbs when no contract)
  - `test --json` stdout is **one** JSON document (cases only); `check --json` stays a separate command
  - `--ignore-throws` now **merges** with `package.json#nudo.check.ignoreThrows` (additive)
  
  LSP:
  - Gate codes (`nudo:entry-may-throw` etc.) keep Error **and Warning** under `analysis.diagnostics=off|errors` so IDE matches CLI when `entryThrows=warning`
  
  Docs/product copy:
  - Day1 sidecar example uses `fn({ params }, returns?)` (not bare `number().gt(0)` on a function export)
  - Help / generated markers use `schema`/`standard` and `nudo contract --emit`

### Patch Changes

- Updated dependencies [22baf33]
- Updated dependencies [0e1432a]
- Updated dependencies [3c3f9d2]
- Updated dependencies
- Updated dependencies [279d73a]
- Updated dependencies [5a5e167]
  - @nudojs/core@3.0.0-beta.0
  - @nudojs/service@5.0.0-beta.0
  - @nudojs/parser@1.1.0-beta.0

## 1.0.0

### Major Changes

- 69ebbf6: Align product surface with interface-first design: `@nudo:case` is debug / `nudo test` only, and the `T.*` directive grammar is removed.

  - Directive type expressions accept constraint builders (`number()`, `lit()`, `shape()`, `union()`, `array()`, `any()`, …) and concrete literals only. Bare `T.*` parses as unknown; `parseTypeValueExpr` is no longer exported — use `parseCaseArgExpr`.
  - `serializeCaseArg` / `--emit-cases` emit builders (`number()`, `union(…)`) instead of `T.*`.
  - LSP `typeExprToDirective` emits builders (`number()`, `union(…)`, `any()`).
  - CLI `infer` reports call-site facts (`call@L…`) and `debug "name"` witnesses with `Observed:` joins — not `Case "…"` / `Combined:` as the type product. Contracts stay on `*.nudo.js` / `@nudo:refine`.
  - Constraint builders accept concrete nested literals so directive grammar round-trips.

### Patch Changes

- Updated dependencies [69ebbf6]
  - @nudojs/parser@1.0.0
  - @nudojs/service@4.0.0
  - @nudojs/core@2.1.0

## 0.8.1

### Patch Changes

- 9731238: **BREAKING (behavior)** `@nudojs/service`: handwritten `@nudojs/env` now **wins** over harvest / module-graph modules on overlapping module keys and export names (`mergeHarvestUnderEnv`). This is the documented B8 priority — harvest only fills missing slots — but analysis results on projects that relied on harvest overwriting a handwritten env export will change.

  Migration: remove or update the conflicting handwritten `@nudojs/env` slot if you needed harvest's version; otherwise no code change. Conflicts emit a `nudo:env-harvest-conflict` warning listing overwritten module/export names.

  Also in this service major (additive public surface, riding the required major for the priority change):

  - Public harvest helpers: `mergeHarvestUnderEnv` (optional per-call `onConflict`), `setEnvHarvestConflictCollector` (returns previous; save/restore for nested analysis), `getEnvHarvestConflictCollector`, `clearNodeHarvestCache`, `getNodeHarvestCacheSize`, `isHarvestNodeDisabled`, `HARVEST_NODE_DEFAULT_*`. Negative harvest outcomes (`not-found` / `no-dts` / `failed`) are cached in-process; `NUDO_HARVEST_NODE=off` stays explicit and uncached. `clearNodeHarvestCache()` also drops `not-found` misses so a later `@types/node` install is visible in-process. `nudo:env-harvest-conflict` warnings point at the conflicting import specifier when found (file-level `line 0` otherwise).
  - `@nudojs/env` (minor): `events` / `stream` / `querystring`; high-frequency `util` slots; **Promise APIs only under `fs.promises` / `node:fs/promises`** (callback-style `fs.readFile` etc. no longer pretend to return Promise). Optional Node params (`path.basename` ext, `url.URL` base) keep typed labels (`ext?: string`) but are **not** required slots — `requiredFnArity` skips `?` / `...`.
  - `@nudojs/core` (patch): `formatShape` renders fn rest labels (`...paths`) and optional labels (`options?`) as `...name: T` / `name?: T`. `leqAbs` fn arity uses **required** slots only (`requiredFnArity` skips `...rest` / `name?`): src is assignable to tgt iff `src.required ≤ tgt.required` (TS-like — rest src ⊑ required tgt; required src ⊭ rest tgt when src requires args). Pairwise `paramTypes` contravariance is unchanged.
  - `@nudojs/lsp` (patch): freeze inventory in `public-api.ts` (also exported as `@nudojs/lsp/public-api`); agent slash requests register from `NUDO_AGENT_TOOL_NAMES`; `selectCase` / `getActiveCases` are editor executeCommand + slash-only (not dot-form custom requests).

  Migration for env consumers who need bit-stable hover/format strings: pin `@nudojs/env` `~0.3.0` after the next release, and prefer **leaf-clean** coverage counts (empty `{  }` shapes are not leaf-clean) over raw resolved ratios.

- Updated dependencies [9731238]
  - @nudojs/core@2.0.1
  - @nudojs/service@3.0.0
  - @nudojs/parser@0.5.1

## 0.8.0

### Minor Changes

- aea83f6: **BREAKING** (fix-2: close TypeScript DX gaps):

  - **C0.1 contract model:** body-AST required-slot inference removed. `nudo:arg-structure` now means HOF argument not callable / arity mismatch only. Obligations come from explicit `*.nudo.js` / `@nudo:refine` contracts or call-site facts; no evidence → any. Migration: add a sidecar shape contract where you need structure checks.
  - **A1 analysis default:** `package.json#nudo.analysis.mode` shipped default is now `exports` (was `directives`). Files with `export` / sidecar / `@nudo:` directives are analyzed by IDE/build. Escape hatch: `"mode": "directives"` (previous silence) or `"all"` (every target path). Named-path CLI commands still analyze the named file regardless of mode.

  Release notes / policy: `docs/versioning.md`. Scope defaults: `docs/design/cli-semantics.md`.

  Feature highlights (after accepting the defaults above):

  - Core algebra: Map/Set literal tracking + fork join, loop early-return fold, catch param binding, `==`/`!=` fold, logical assignment, HOF relations, class-method sidecar keys (`Class.method` / `Class_method`, local declaration name for `export { Local as Public }`)
  - Interface product: `nudo interface --draft` (code-first contracts), enforcement tiers, CJS/default/class export forms
  - IDE: LSP buffer-aware sidecars, quickfix/code actions, validate cancel + debounce, diagnostics tiers, agent/LSP parity
  - Scale: disk CheckJson cache, analysis session memo, call-site budget, watch invalidation (sidecar/config/env)
  - dts projection quality (tsc-clean HOF/unions), vite-plugin aligned to `analysis.mode`

### Patch Changes

- Updated dependencies [aea83f6]
  - @nudojs/core@2.0.0
  - @nudojs/service@2.0.0
  - @nudojs/parser@0.5.0

## 0.7.1

### Patch Changes

- Updated dependencies [61b8a6c]
  - @nudojs/core@1.0.1
  - @nudojs/parser@0.4.2
  - @nudojs/service@1.0.1

## 0.7.0

### Minor Changes

- 0f0b7d5: **Feature**: Interface 分层推导 Phase 1（design-refine-derivation.md）

  - 侧车同名自动绑定：`foo.nudo.js` 导出绑定 `foo.js` 本地 named export；手写 > `@generated` > 隐式合并序
  - 约束代数：`lit` / `union` / `fn` / `shift` / `and` / `partial` / `pick` / `omit`
  - Abs→ 契约投影与字面量域隶属（domain-membership）
  - 新诊断：`nudo:interface-drift` / `interface-domain-exceeds` / `interface-conflict` / `interface-cycle` / `interface-load` / `interface-name-clash`
  - CLI：`nudo interface`（别名 `refine`）分层打印；`--emit` / `--fn` / `--all` / `--dry-run` / `--exit-on-diff` / `--callsites`；`nudo check --callsites`
  - 配置：`package.json#nudo.interface.autoBind`（默认 true；node_modules 永不 ambient 加载）
  - LSP：CodeLens interface 默认层 + persist/update；agent 工具 `nudo.interface` / `nudo.interface.emit`（emit 路径限制在项目根内）
  - 新薄壳包 `nudo`（`bin` 委托 `@nudojs/cli`）

### Patch Changes

- a2aac9e: Final review pass on feat/interface Phase 1:

  - **LSP emit bound live**: `handleInterfaceEmit` now passes `agentToolDeps` so `workspaceRoots` reach `assertEmitTargetAllowed` (was dead in production).
  - **Emit fail-closed**: empty `workspaceRoots` rejects; no ancestor-`package.json` authorization fallback; `realpath` blocks symlink escape; refuse writes under `node_modules`.
  - **autoBind kill-switch complete**: threaded through scan `generalizeFromAst` / same-file `eiOpts`; empty `fromFile` no longer ambient-binds `.nudo.js`.
  - **Conflict skip**: conflicted params no longer also emit call-site `constraint-violated`; detect eq/eq and eq/bound unsat.
  - **Return contracts**: string length bounds (`string().min/max`) enforced via domain membership.
  - **Perf/stability**: file-local `effectiveInterface` memo in check; `take*Since` on memo hit/miss (no LSP diag theft); `shift` rejects non-finite offsets; `@generated` marker requires adjacent comment block; add-mode empty targets no longer rewrite trailing whitespace; emit tmp name randomized.

- de47d84: Review fixes on feat/interface Phase 1:

  - **autoBind kill-switch**: analyzer's cross-file `nudo:interface-domain-exceeds` path now reads `package.json#nudo.interface.autoBind` (was silently ambient-loading sidecars when `autoBind: false`).
  - **`nudo check --callsites`**: inject usage-site call records so CI gate can surface `nudo:interface-domain-exceeds` (previously only reachable via analyze/interface paths).
  - **Sidecar auto-bind coverage**: `localNamedExports` accepts local `export { x }` / `export { local as exported }` list form (was declaration-only; silent miss for common style).
  - **Directory targets**: `isNudoTargetPath` excludes `*.nudo.js` / `*.nudo.ts` so check/infer/doctor no longer treat contract modules as source.
  - **VS Code client**: documentSelector includes TypeScript; file watcher covers `**/*.{js,mjs,ts}` (includes `.nudo.ts` sidecars).
  - **LSP emit**: failed `interfaceEmit` no longer claims "sidecar written" and skips the invalidation path.
  - **UX**: first `--emit` with empty default targets prints a `--fn`/`--all` tip; `--fn`/`--all` without `--emit` warn; CodeLens titles use "interface" not "refine"; domain-exceeds message is English (matches other diagnostics).

- 78f6752: Fix hover, case switching, and NaN folding in Zed-style clients.

  - `const n = double(21)` reports the init Abs (`42`) instead of the statement's `unknown` (record the declarator id in `evalVarDecl`).
  - `const s = double("a")` is `NaN` (JS `"a" * 2`), not `unknown` — concrete string/boolean lits coerce under ToNumber; `formatAbs` prints `NaN`/`Infinity` instead of `null`.
  - Relational compare folds mixed concrete lits (`"a" > 3` → false), so `if (x > 3)` does not join both branches for NaN inputs.
  - `joinValues` uses `Object.is` so `join(NaN, NaN)` stays `NaN` (`NaN === NaN` is false).
  - `workspace/executeCommand` accepts positional `nudo.selectCase` args from CodeLens (`[uri, fn, index, name]`).
  - Hover inside `@nudo:case` functions goes through TypeValue + `activeCases` instead of call-site B-path nodes.
  - Param inlay no longer invents `where x > 3` from `if (x > 3) return x` — only explicit `@nudo:refine` contracts show as preconditions.
  - Return inlay is a path summary with source param names: `x + 1`, `x | x * 2` (not the refined `number where x>3 | string | …` dump).
  - Number range narrowing uses exclusive bounds (`> 3`, not integer-style `>= 4`).
  - Concrete `if` tests no longer narrow the tested value into a range (`44 > 3` keeps `x` as `44`).
  - True branch of `x > k` on unknown refines to `number>… | string` (JS ToNumber space).
  - `flattenSum` keys prim members by term/pred so `number=A1>3` and `number=A1*2` stay distinct paths.

- Updated dependencies [0fd253f]
- Updated dependencies [a2aac9e]
- Updated dependencies [0f0b7d5]
- Updated dependencies [de47d84]
- Updated dependencies [78f6752]
  - @nudojs/core@1.0.0
  - @nudojs/service@1.0.0
  - @nudojs/parser@0.4.1

## 0.6.0

### Minor Changes

- 1d6bb01: - dist 产物自包含（同 cli：@nudojs/\* 源码进 bundle、splitting:false、banner 补齐）
  - 自定义请求别名同时注册 `nudo/<tool>` 与 `nudo.<tool>` 两种拼写（后者与 executeCommand 命令名一致，供 MCP 桥接客户端复用）
  - 跨文件 definition：本地声明与 import 绑定都未命中时，新增工作区导出回退扫描（同名导出定义，≤200 文件 + 会话已知文件），修复解构注入参数（`computeScorecard({…})` 形参）无法跳转的问题；rename 刻意不接此回退（重命名必须绑定真实绑定点）
  - 附带回归测试：export 形式 refine、跨文件定义回退、早返回折叠

### Patch Changes

- 1d233a7: Fix hover and CodeLens case switching in Zed-style clients, and fold JS ToNumber for `- * / %`.

  - `const n = double(21)` now reports the init Abs (`42`) instead of the statement's `unknown` (record the declarator id in `evalVarDecl`).
  - `const s = double("a")` is `NaN` (JS `"a" * 2`), not `unknown` — concrete string/boolean lits coerce under ToNumber; `formatAbs` prints `NaN`/`Infinity` instead of `null`.
  - `workspace/executeCommand` accepts positional `nudo.selectCase` args from CodeLens (`[uri, fn, index, name]`), not only the agent object form.
  - Hover inside `@nudo:case` functions goes through TypeValue + `activeCases` instead of call-site B-path nodes, so selecting a case actually changes the shown types.

- Updated dependencies [1d6bb01]
- Updated dependencies [1d6bb01]
- Updated dependencies [1d233a7]
  - @nudojs/core@0.4.0
  - @nudojs/parser@0.4.0
  - @nudojs/service@0.3.2

## 0.5.0

### Minor Changes

- 4a43e10: Add a `nudo-lsp` bin (shebang on `dist/server.js`) and default to stdio when the host did not pass a transport flag (`--stdio` / `--node-ipc` / `--socket=`). Editors and agent bridges can launch the server as a bare command (`nudo-lsp`, `node dist/server.js`) instead of `tsx` + `src/server.ts`. The [Zed extension](https://github.com/nudojs/nudo-zed) uses this path.

## 0.4.1

### Patch Changes

- 34b246c: Implement textDocument/documentSymbol and workspace/symbol; make definition, references, and rename follow relative imports across files so go-to-definition on an imported symbol lands in the defining module and rename/references include importer call sites.
- bee69d4: Publish built dist instead of TypeScript source: packages now ship compiled ESM + .d.ts, CLI bin gets a shebang, `nudo --version` reads the real package version, and `nudo check` accepts multiple paths.
- Updated dependencies [21427eb]
- Updated dependencies [df1726c]
- Updated dependencies [bee69d4]
- Updated dependencies [8d85d99]
  - @nudojs/core@0.3.1
  - @nudojs/service@0.3.1
  - @nudojs/parser@0.3.1

## 0.4.0

### Minor Changes

- 5786fa5: Promote the B-path (transpile + in-process Abs runtime) to the primary evaluation path for capable sources.

  - Module graph now supports relative imports, bare-package harvest, default/namespace imports, re-exports, `export *`, require, cycle/depth/missing guards, and env modules (`path` / `node:path` etc.).
  - Diagnostics, `@nudo:env` / mock injection, `call@` / `entry@` provenance, method-missing, unknown-recv, generators, classes, async/await, optional chaining, and destructuring run through B.
  - When B hosts a file, `evaluateProgram` is skipped so TypeValue no longer double-reports.
  - CLI `check` / `types` / `test` accept directories; check uses an Abs-only gate.
  - LSP hover / `getTypeAtPosition` on capable files read the Abs node table; `*.nudo.js` edits evict L0 and recheck open parents.
  - Public core surface now re-exports the algebra API (`Abs`, check, generalize, exec, bridge, `parseSource`, `stripTypes`).

### Patch Changes

- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
  - @nudojs/core@0.3.0
  - @nudojs/service@0.3.0
  - @nudojs/parser@0.3.0

## 0.3.0

### Minor Changes

- 0fd0718: Merge the three environment packages into one: `@nudojs/env-es`, `@nudojs/env-web`, `@nudojs/env-node` are replaced by a single `@nudojs/env` package with subpath exports `@nudojs/env/es`, `@nudojs/env/web`, `@nudojs/env/node`.

  Move agent-facing tools from the standalone MCP server into the language server: `@nudojs/mcp` is removed. `@nudojs/lsp` now exposes `nudo.whatIf`, `nudo.suggestCase`, `nudo.trace`, `nudo.selectCase`, and `nudo.getActiveCases` via `workspace/executeCommand` (custom-request aliases `nudo/whatIf` etc. included), adds pull-mode diagnostics, and works on files that are not open in the editor (disk fallback). `nudo.whatIf` now actually applies the given type bindings — previously they were ignored. AI agents connect through any LSP↔MCP bridge (cclsp, mcpls, agent-lsp) or a native LSP client; an installable agent skill ships at `packages/lsp/agent-skill/SKILL.md`.

### Patch Changes

- @nudojs/service@0.2.1

## 0.2.0

### Minor Changes

- 6c38283: docs and ci
- 9f7f819: fix pkg info
- c175f71: version

### Patch Changes

- Updated dependencies [6c38283]
- Updated dependencies [9f7f819]
- Updated dependencies [c175f71]
  - @nudojs/core@0.2.0
  - @nudojs/service@0.2.0

## 0.1.0

### Minor Changes

- Conceptual design and basic implementation.

### Patch Changes

- Updated dependencies
  - @nudojs/core@0.1.0
  - @nudojs/service@0.1.0
