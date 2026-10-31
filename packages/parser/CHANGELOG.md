# @nudojs/parser


## 1.5.5

### Patch Changes

- Updated dependencies [d726525]
  - @nudojs/core@1.17.1

## 1.5.4

### Patch Changes

- 6ebf5a4: Evaluator engine correctness, host transpile cutover, and dedupe.
  
  - Fix `Object.assign` second-class calls (`const g = Object.assign; g(target, src)`, `.call`/`.apply`) so obj/tuple targets are mutated in place with native alias visibility; direct and builtin paths now share one `performObjectAssign` core. Frozen targets only reject a real `[[Set]]` (empty/null/undefined sources no longer report a false TypeError; unknown key sets become may-throw), and sealed targets dispatch own accessors through `$set` (setters still run; getter-only still rejects).
  - Fix function-value join/dedupe: branch-dependent expando slots, nested function values, anonymous/named same-shape functions, `optionalParams`/`ctor`/`paramTypes`/`returnType` differences no longer fold to a wrong exact value. `$copy` snapshots fn shapes independently and migrates impl/slot ownership, null-proto, and fresh-instance identity. Alias groups are scoped lexically, so fork snapshots (`$copy`) no longer break `const b = a` alias identity across nested functions or shadowed blocks.
  - Make `renameShape`/`snapshotAbs` structure-preserving: tuple `holes`/`rest`, fn `slots`/`optionalParams`/`ctor`, obj slot `symbolKey`/`internal`/`inherited`, brand/eff metadata.
  - Fix compiled-body lexical scope and strictness: block-scoped `let`/`const`/`for`/`catch`/class/static-block bindings no longer hide enclosing closures; `strict` is threaded from ESM/CJS source through core/service/parser Abs-fn constructors, and class bodies are always strict. An explicit `"use strict"` directive prologue now marks a CJS script source strict, and CJS class-method bodies compile as strict too.
  - Replace the transpile→ESM-text→regex-rewrite round-trip with `transpileModule()` metadata + host-target emission (`__nudoBindImport`/`__nudoExport*`, no runtime import line, no generated-code re-parse). Analyze-mode top-level stripping now happens during emission. Namespace-only `import * as ns` now emits valid ESM.
  - Fix `$set` fail-closed on nullish/non-Abs receivers: the host-write handler now reports hits explicitly instead of using `undefined` as a sentinel, so a write to a non-Abs receiver returns that receiver instead of crashing on `.shape`.
  - Fix `$switch` implicit no-match arm: it no longer contributes an empty yield collector, so single-arm switches keep precise generator element types instead of degrading to `unknown`. The switch-level snapshot/join set is pinned to outer bindings only: arm-local `let`/`const`/`function`/`class` (including nested blocks, `for` heads and `catch` params) never enter it, so an arm-local name can no longer copy/rebind a same-named outer binding and break its alias identity.
  - Fix free-write collection for nested functions: hoisted `var` / function-declaration names of a nested function body now shadow writes inside that body instead of being recorded as free writes of the enclosing unit (previously emitted `$copy(<name>)` for a binding that does not exist there, yielding a false `ReferenceError`/`never` and an error-level `nudo:entry-may-throw`). Block-scoped declaration shadowing is now per statement list rather than a recursive union, so a nested-block `let` no longer drops a legitimate sibling write from the fork set.
  - Module top level is now an alias-group scope boundary: `const b = a` at module scope keeps its alias identity across a top-level fork instead of leaving one name on the pre-fork object.
  - `Object.assign` onto a sealed / non-extensible brand (prototype) target now rejects a new own key with TypeError (native parity) while existing writable keys, own setters and owner-class members still assign.
  - Dedupe shared machinery: fork-arm wrapper, structural Abs keys, dependency-aware memo store + module identities, class-instance bridge, numeric bounds, internal-slot visibility, env-skip derivation from `NAMESPACE_GLOBALS`, proto walk, path projection, sum-arg dispatch, `undefAbs`, RegExp brand predicate, export-call exception skeleton.
  - **BREAKING**: Remove the dead public engine symbols instead of deprecating them: the module-level `phi` stack (`currentPhi`/`pushPhi`/`popPhi`/`resetPhi`/`withPhiConstraint`/`describePhi`), `$while`/`$forIter`/`$asyncReturn`/`$staticInit`/`$thisGet`/`$thisSet`, the HOF promotion helpers (`createHofCollectCtx`/`promoteParamShape`/`tryPromote*`/`HofCollectCtx`/`AstEnv.hofCollect`), the dead relation helpers `alphaOf`/`betaOf`, and `generalizeAll`. `$staticInvoke` also leaves the public surface (previously exported from `.` and `./exec`): it is now engine-internal, still implemented for the `check-may-throw` class bridge. Retire dead internal `language.ts` exports (keep `getClassChain`/`wrapPromise`).
  
    Migration: every removed name was a dead engine internal with no product-surface consumer — drop the imports from `@nudojs/core` / `@nudojs/core/exec`; `$staticInvoke` is no longer reachable from a host.
  - Rename `exec/class-regex.ts` to `exec/regexp-runtime.ts` to match its RegExp-brand role.
- Updated dependencies [0438f10]
- Updated dependencies [6ebf5a4]
  - @nudojs/core@1.17.0

## 1.5.3

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
- e424592: File-level `@nudo:` directives no longer evaporate in silence: the mock-module
  payload grammar accepts single quotes, the env payload grammar accepts
  space-separated lists, block-comment `@nudo:import` is ignored instead of
  taking effect, and an empty `@nudo:import` payload is diagnosed.
  
  - `@nudo:mock-module 'axios' from './mocks/v-axios.js'` was silently dropped.
    The two payload regexes hard-coded double quotes, so a single-quoted payload
    matched neither and the directive returned `undefined`. The mock was never
    installed, no diagnostic was raised, and the gate stayed green. Single
    quotes are now accepted (the source and the path may even use different
    quote kinds), and an unparsable payload now raises `nudo:directive-syntax`
    instead of vanishing.
  - `@nudo:env node web` was silently dropped. The payload was split on commas
    only, so a space-separated list became a single token and was filtered out;
    a bare `/// @nudo:env` tag did not even match the tag regex. Both forms
    were discarded with no diagnostic, so no environment was loaded and
    everything stayed `unknown`. Commas and whitespace are now both accepted
    (trailing comments are stripped), and a bare tag raises
    `nudo:directive-syntax`.
  - `@nudo:import` inside a block comment took effect. The text scanner
    flattened line comments and block comments into one list and dropped the
    comment kind, so a block-comment import really loaded its sidecar — the
    opposite of `@nudo:env` / `@nudo:mock-module`, which the AST channel ignores
    in block comments. Comment kinds are now kept apart: line comments take
    effect, block comments are ignored and warned about.
  - `/// @nudo:import` with an empty payload was silently discarded. The payload
    was dropped before the malformed-import scanner could see it, so the
    malformed form had no diagnostic while other unrecognised forms of the same
    directive did. The empty payload is now reported as a malformed import and
    raises `nudo:contract-syntax`.
- e424592: `@nudo:case` witnesses no longer evaporate in silence: an escaped quote in an
  argument no longer swallows the whole case, the `=> expected` part is read on
  CRLF sources, on the next line and behind a `!! throws` suffix, redundant
  brackets around the expectation are stripped, and a glued
  `@nudo:case"name"` tag is diagnosed instead of vanishing.
  
  - `@nudo:case "k" ("a\"b") => 3` was dropped entirely. The bracket scanner was
    string-aware but not escape-aware, so the `\"` inside the string ended the
    string, the bracket closed early and the whole case was discarded. What
    remained on screen was a misattributed "unclosed argument list" warning.
    Balancing now follows JavaScript escape semantics first; a string that never
    closes (not valid JavaScript) still falls back to the previous lenient
    reading, so the argument count seen by the check face and by `nudo test`
    stays the same.
  - `=> expected` was lost in a CRLF source file. The line was split on `\n` and
    the trailing `\r` stayed in the expectation text, so the expectation failed
    to parse and was dropped: the case became `[unchecked]`, the assertion never
    ran, `nudo test` exited `0` and nothing was reported. Lines are now split on
    `\r?\n`.
  - A `!! throws [Kind]` suffix on the case line was read as the expectation
    text. With the suffix before `=>` the expectation disappeared entirely; with
    the suffix after `=>` the text `1 !! throws` was parsed and rejected. The
    suffix is now stripped from the expectation expression only — the case line
    itself is never rewritten, so the function-level `!! throws` declaration
    still sees it.
  - `=> (999)` / `=> ("a")` / `=> ({ b: 1 })` never parsed, because the
    expectation kept its outer brackets while the argument side had always
    stripped them. The expectation now drops its redundant outer brackets, the
    same way the arguments do. An arrow function (`(x) => y`) is left alone.
  - An expectation on the line after `=>` was silently discarded, and an
    expectation that was written but empty was discarded just as silently. The
    value is now read from the next line, and an empty `=>` is reported as
    `nudo:directive-syntax` instead of passing unnoticed.
  - `@nudo:case"c1" (1, 2)` — no space between the tag and the name — was
    neither extracted (the extractor requires a space) nor reported (the
    diagnostic side accepted it). The case vanished with no diagnostic and
    `nudo test` ran no case at all. Both sides now share one grammar, and the
    glued form is reported as `nudo:directive-syntax`, the same way a glued
    `@nudo:mock` name is.
- e424592: Malformed `@nudo:` directives are diagnosed instead of evaporating in silence:
  an empty or glued `@nudo:assume` / `@nudo:invariant` / `@nudo:contract` /
  `@nudo:throws` now raises a syntax diagnostic, and a `!! throws` suffix is only
  read where it is actually a directive.
  
  - `@nudo:assume` with an empty payload, or `@nudo:assumed d <= max` (a space
    missing between the tag and the payload), matched no branch at all: the
    scanner returned nothing and nothing was reported. The lemma was dropped
    without a word, so the return contract fell back from "proved" to "unproved"
    and the only sign was a `nudo:unproven-return` whose text blamed inference
    precision instead of the rejected lemma. An empty or glued
    `@nudo:assume` / `@nudo:invariant` now produces a bad segment and raises
    `nudo:assume-invalid` / `nudo:invariant-invalid`; a glued or empty
    `@nudo:contract` / `@nudo:throws` raises `nudo:contract-syntax` /
    `nudo:directive-syntax`. The strict grammar is unchanged — a tag still needs
    a separating space — the loose forms are only reported.
  - `!! throws` was matched anywhere in a function's comment block, so a prose
    line ("this helper uses `!! throws`") or a case **name** that happens to
    contain that text was read as a function-level throw declaration. The
    declaration then covered every throw, `filterGateThrows` let them all
    through, and the `nudo:entry-may-throw` gate was silently switched off while
    the signature still printed `throws TypeError`. The suffix is now only read
    where it is a directive: after the argument list of a `@nudo:case` line, or
    on the continuation line of such a case. The documented case-suffix form
    (`@nudo:case "neg" (0) !! throws`) keeps working exactly as before.
  - The same glue was invisible to the inline directives of the parser package:
    `@nudo:replaceFoo x number()` matched neither the strict nor the loose
    pattern, so the whole inline directive disappeared. It now raises
    `nudo:directive-syntax`. The `@nudo:as` side keeps the behaviour already
    merged for Bug 842: a tag whose name is extended (`@nudo:asXYZ`) is not an
    `@nudo:as` directive and stays silent.
- 27cc16a: `@nudo:case` witnesses and expected values now follow JavaScript literal
  semantics, and an unreadable expected value can no longer pass silently.
  
  - The numeric branch of the case-argument grammar only recognized a decimal
    regex, so every other legal JavaScript number — exponent notation, hex,
    binary and modern octal literals, numeric separators, a leading or trailing
    dot, a unary sign — was folded into `unknown`. Since `unknown` is the top
    type (`leqAbs(actual, unknown)` always holds), the witness satisfied any
    contract and the assertion passed for the wrong reason. Those forms are now
    parsed with JavaScript literal semantics, so `1e3` is `1000`, `0x10` is `16`,
    `0b101` is `5`, `0o17` is `15`, `1_000` is `1000`, `.5` is `0.5` and `5.` is
    `5`.
  - A legacy octal literal was read as decimal (`Number("017")` is `17`), while
    sloppy-mode JavaScript reads it as octal (`017` is `15`). The witness and the
    expected value were therefore a confident **wrong** value. A leading zero now
    means octal (`017` → `15`, `010` → `8`), and a leading zero with `8` / `9`
    keeps sloppy decimal semantics (`08` → `8`).
  - Expression-shaped literals — a parenthesized value (`(7)`, `-(7)`), an
    unsigned or negative sign (`+1`, `- 7`), a template literal without
    interpolation (`` `x` ``) and a bigint (`7n`) — were also folded into
    `unknown` and are now recognized.
  - An expected value that cannot be parsed was folded into the same `unknown`
    Abs as an explicit `unknown`, so `leqAbs(actual, unknown)` always held and
    the assertion was vacuously true: the report said "1 passed" and the command
    exited with `0`. A parse failure is now distinct from an explicit `unknown`:
    it is reported through the existing `nudo:directive-syntax` channel and the
    assertion fails instead of passing. An explicit `unknown` / `any` keeps its
    meaning of "not constrained".
- 27cc16a: String literals in `@nudo:case` / `@nudo:skip` / `@nudo:mock` now follow
  JavaScript string semantics, and a text that is not a single string literal
  is no longer folded into a wrong value.
  
  - A string literal was taken by slicing off the first and the last
    character, so escape sequences were never interpreted: `"a\tb"` became the
    four-character string `a\tb` (with a literal backslash) instead of
    `a<TAB>b`. A witness therefore did not denote the same string as the
    sidecar contract, which is evaluated as real JavaScript, and the contract
    gate reported `witness ⊭ contract` for a witness that was in fact
    correct. Escapes are now interpreted with JavaScript semantics (`\t`,
    `\n`, `\\`, `\"`, `\uXXXX`, …).
  - The same slice accepted any text that merely started and ended with a
    quote, so `"a" + "b"` was folded into the string `a" + "b` — a value
    nobody wrote. The expectation of a case, a case witness, the declared
    return type of `@nudo:skip` and the payload of `@nudo:mock` all carried
    that wrong value, and the reported expectation was unreadable text. A
    string is now recognised only when the whole text is one string literal;
    anything else is reported as unrecognized (`nudo:directive-syntax`) and
    no longer produces a confident wrong value.
  - The rule lives in one place (`directives/string-literal.ts`), so the case
    argument, the expectation, `@nudo:skip` and `@nudo:mock` share it.
- 27cc16a: `@nudo:case` / `@nudo:mock` payloads no longer lose structure or optionality.
  
  - The object / array literal branch of the case-argument grammar only checked
    the first and the last character of the text, so trailing text was folded
    into the value: `[1][0]` became the tuple `[unknown]` and
    `{ a: 1 } + { b: 2 }` became `{ a: unknown }`. The engine then reported a
    confident wrong value and the assertion failed even though the expected
    value was plain JavaScript. The whole text is now validated as exactly one
    literal; anything else is treated as "not recognized" (`unknown`) and is
    reported through the existing `nudo:directive-syntax` channel.
  - An object literal property without a top-level colon (a getter, a method
    shorthand or a shorthand property) was silently dropped, so a `@nudo:mock`
    payload lost that property without a word and the mock value became a
    confident wrong value. Such a literal is now rejected as "not recognized"
    and the offending property is named in a `nudo:directive-syntax`
    diagnostic.
  - The `optional` flag of a `shape({ … .optional() })` field was dropped when
    the expected value was projected into an Abs, so an optional field became
    mandatory and a legal actual value failed the assertion, and the reported
    `expected` text did not show `?`. The flag is now projected into the slot,
    matching the contract (sidecar) face of the same grammar.
- 27cc16a: Directive parsing no longer loses or over-applies directives: malformed mock
  tags are reported instead of evaporating, file-level directives only apply
  where they are written, and a case expectation is no longer voided by a
  trailing comment.
  
  - A file-level `/// @nudo:mock-module "fs" from "./mock-fs.js"` was caught by
    the function-level `@nudo:mock` tag pattern, so a correct file produced a
    fabricated `nudo:directive-syntax` warning ("Malformed @nudo:mock …").
    The mock tag now requires a name boundary that excludes the `-` suffix of
    the file-level family.
  - `@nudo:mock` with an empty payload (`@nudo:mock fetch =`, `@nudo:mock g
    from`) matched neither strict grammar, so the directive evaporated silently
    — no mock, no diagnostic, and the analysis ran against the real API. The
    three mock grammars are now closed: a tag that matches the lenient pattern
    but neither strict one is reported through `nudo:directive-syntax`.
  - `@nudo:skip=> number()` (no space between the tag and the payload) dropped
    the whole payload, so the declared return type never took effect and the
    signature degraded from `f() => number` to `f() => any` — an `any` leak into
    the product surface. The separating whitespace is no longer part of the
    required structure.
  - `@nudo:mockfetch = …` (no space between the tag and the name) did not even
    match the lenient tag pattern, so the whole mock was invisible to the
    scanner: zero diagnostics and the analysis ran against the real
    implementation. The lenient pattern now sees the glued spelling and reports
    that a space is required.
  - A `@nudo:case` expectation with a trailing comment (`=> string() // the
    result is a number`) failed to parse and fell back to an explicit `unknown`,
    which satisfies every expectation — the assertion was silently voided and
    the command reported "1 passed" with exit code `0`. The trailing comment is
    now stripped before the expectation is parsed.
  - A malformed `@nudo:case` did not register an argument-region mask, so
    `@nudo:mock` / `@nudo:skip` written inside its arguments leaked out as real
    directives (false positives, methods dropped from the emitted declaration).
    Malformed cases now mask their argument region as well; the malformed-name
    diagnostic is unchanged.
  - A file-level `@nudo:env` / `@nudo:mock-module` written inside a function
    body was promoted to whole-file scope: the environment or the module
    replacement applied to the entire file, with zero diagnostics. File-level
    directives are now position-gated — a line comment inside a function body is
    ignored and reported through `nudo:directive-syntax`, while top-level
    positions (file header, `export` line, between statements) keep working. The
    same gate is applied to the text-level extraction used by `@nudo:import`, so
    the three file-level families now behave alike.
- 27cc16a: Inline directives and mock payloads keep their meaning: an `@nudo:as` payload is
  no longer dropped when it is written without a separating space, a trailing
  comment no longer turns a valid type into `unknown`, an inline mock keeps its
  `async` flag and its parameter bindings, and two identical malformed
  directives in one file are no longer collapsed into a single diagnostic.
  
  - `@nudo:as(string())` (no space between the tag and the payload) matched
    neither the "payload" pattern (which required whitespace) nor the "bare
    tag" pattern (which only accepted `@nudo:as` on its own), so the whole
    directive evaporated with zero diagnostics and the type override never took
    effect. The separating whitespace is now optional, an outer pair of
    balanced parentheses is unwrapped (`@nudo:as(string())` is
    `@nudo:as string()`), a tag whose name continues with an identifier
    character (`@nudo:assume`, `@nudo:ascii`) is still not an `@nudo:as`
    directive, and an empty payload is reported explicitly.
  - A trailing comment without a preceding space (`@nudo:as string()// why`) was
    merged into the type expression, so a valid type was judged "unsafe" and
    degraded to `unknown` — the type override silently stopped applying.
    Trailing comments are now detected by lexical boundary; a `//` that follows
    a numeric literal and a digit is still read as a division, and comment
    markers inside a string literal are still ignored.
  - `@nudo:mock f = async (x) => x + 1` lost its `async` flag during parsing,
    so the mock was modelled as a synchronous function and the call site
    `f(1).then(…)` was reported as "method 'then' missing on number receiver" —
    an error-level false positive (native returns a promise). The scan result now
    carries the `async` flag.
  - The parameters of an inline mock payload had no binding semantics: a
    destructuring parameter was replaced by a placeholder name, a default-value
    parameter was dropped entirely, and a rest parameter kept its literal `...`.
    The mock body therefore read undeclared globals (`ReferenceError`) and the
    emitted declaration said `never`. The parameter list now keeps the source
    form, the parameter ASTs and the bound names, all aligned one-to-one.
  - The deduplication identity of a directive diagnostic was the code plus the
    message text, with no position, so two word-for-word identical malformed
    directives in one file collapsed into a single diagnostic and the second
    occurrence was completely invisible. A diagnostic now carries the position
    of the offending directive and the identity includes it: the same problem at
    the same place is still reported once, while the same text at two different
    places is reported twice.
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
- Updated dependencies [e2880fd]
- Updated dependencies [5c750f2]
- Updated dependencies [4d1a249]
- Updated dependencies [af09752]
- Updated dependencies [fcaa9e9]
- Updated dependencies [7fea13a]
- Updated dependencies [9ccffb3]
- Updated dependencies [e9fdaa7]
- Updated dependencies [7fea13a]
- Updated dependencies [69e67d3]
- Updated dependencies [69e67d3]
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
- Updated dependencies [f87c9f9]
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
- Updated dependencies [f47fd50]
- Updated dependencies [5c750f2]
- Updated dependencies [d2cf3cf]
- Updated dependencies [27cc16a]
- Updated dependencies [27cc16a]
- Updated dependencies [fbca6fb]
- Updated dependencies [535adcd]
- Updated dependencies [5c750f2]
- Updated dependencies [535adcd]
- Updated dependencies [e3b8791]
- Updated dependencies [b6abab4]
- Updated dependencies [356172a]
- Updated dependencies [ebe909e]
- Updated dependencies [e3b8791]
- Updated dependencies [a069994]
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
  - @nudojs/core@1.16.0

## 1.5.2

### Patch Changes

- Updated dependencies [4513a45]
  - @nudojs/core@1.15.2

## 1.5.1

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

## 1.5.0

### Minor Changes

- 8faa2b0: **BREAKING** (runtime floor): `engines.node` raised from `>=20` to `>=22` on all published packages. Node 20 reached end-of-life on 2026-04-30, and the nightly engine-smoke matrix only covers Node 22 (the `packageManager`-pinned pnpm already requires `node:sqlite`, i.e. Node >= 22.5, to orchestrate at all). No code or API changes — installs on Node 20 will now warn per npm `engines` semantics.

### Patch Changes

- Updated dependencies [aae0f96]
- Updated dependencies [1ccff57]
- Updated dependencies [8faa2b0]
  - @nudojs/core@1.15.0

## 1.4.24

### Patch Changes

- c19bd48: Misplaced file-level directives now warn instead of being silently ignored, and `nudo.analysis.exclude` supports real globs (fix-12 batch).
  
  - parser: file-level directives (`@nudo:env` / `@nudo:mock-module`) written inside JSDoc blocks emit `nudo:directive-syntax` with the correct `///` form instead of being dropped silently.
  - service: `nudo.analysis.exclude` accepts glob patterns (shared `compilePattern`, extracted from vite-plugin as the single source; plain substrings still work, defaults always stack).
  - vite-plugin: pattern matching cut over to the shared `compilePattern` — behavior unchanged, one implementation.
- Updated dependencies [c19bd48]
  - @nudojs/core@1.14.1

## 1.4.23

### Patch Changes

- Updated dependencies [0d9e7de]
  - @nudojs/core@1.14.0

## 1.4.22

### Patch Changes

- Updated dependencies [f5c0c6e]
  - @nudojs/core@1.13.0

## 1.4.21

### Patch Changes

- Updated dependencies [e4e491f]
- Updated dependencies [1881f97]
- Updated dependencies [1881f97]
- Updated dependencies [8466793]
  - @nudojs/core@1.12.0

## 1.4.20

### Patch Changes

- Updated dependencies [08d7a55]
  - @nudojs/core@1.11.3

## 1.4.19

### Patch Changes

- Updated dependencies [82eaae8]
  - @nudojs/core@1.11.2

## 1.4.18

### Patch Changes

- Updated dependencies [612d64f]
  - @nudojs/core@1.11.1

## 1.4.17

### Patch Changes

- Updated dependencies [cce5e58]
- Updated dependencies [16cda31]
- Updated dependencies [cce5e58]
  - @nudojs/core@1.11.0

## 1.4.16

### Patch Changes

- Updated dependencies [8806e93]
  - @nudojs/core@1.10.2

## 1.4.15

### Patch Changes

- Updated dependencies [96090cd]
  - @nudojs/core@1.10.1

## 1.4.14

### Patch Changes

- Updated dependencies [334b914]
- Updated dependencies [94197eb]
- Updated dependencies [b8db17b]
- Updated dependencies [5e275df]
  - @nudojs/core@1.10.0

## 1.4.13

### Patch Changes

- Updated dependencies [2af4016]
- Updated dependencies [2af4016]
  - @nudojs/core@1.9.4

## 1.4.12

### Patch Changes

- Updated dependencies [b6495c6]
- Updated dependencies [04a6d1d]
  - @nudojs/core@1.9.3

## 1.4.11

### Patch Changes

- Updated dependencies [c8e0417]
  - @nudojs/core@1.9.2

## 1.4.10

### Patch Changes

- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
  - @nudojs/core@1.9.1

## 1.4.9

### Patch Changes

- Updated dependencies [aeb6f7e]
  - @nudojs/core@1.9.0

## 1.4.8

### Patch Changes

- Updated dependencies [05c2c8c]
- Updated dependencies [33239da]
- Updated dependencies [3588ddd]
- Updated dependencies [c647af8]
  - @nudojs/core@1.8.0

## 1.4.7

### Patch Changes

- Updated dependencies [427da20]
- Updated dependencies [427da20]
  - @nudojs/core@1.7.10

## 1.4.6

### Patch Changes

- Updated dependencies [b14ac2d]
  - @nudojs/core@1.7.9

## 1.4.5

### Patch Changes

- Updated dependencies [58b7938]
  - @nudojs/core@1.7.8

## 1.4.4

### Patch Changes

- Updated dependencies [d6fa067]
- Updated dependencies [92e6a5f]
  - @nudojs/core@1.7.7

## 1.4.3

### Patch Changes

- Updated dependencies [856d8bf]
  - @nudojs/core@1.7.6

## 1.4.2

### Patch Changes

- Updated dependencies [4c3fafd]
  - @nudojs/core@1.7.5

## 1.4.1

### Patch Changes

- Updated dependencies [0fd8e1a]
  - @nudojs/core@1.7.4

## 1.4.0

### Minor Changes

- 50e50f1: feat(parser): 指令文法诊断通道收敛为显式 sink
  
  > 原变更曾以 major（2.0.0）形式发布后被整班撤回；现按团队决定以 1.4.0 minor 落地。内容含删除模块级 side-channel 旧 API（`takeDirectiveDiags` / `takeDirectiveDiagsSince` / `directiveDiagCount` / `setDirectiveDiagCollector`）——仓库内全部消费方（service / lsp / nudojs / harvester）已随本班车迁移显式通道，外部如有直接使用这些旧 API 的集成请按下述迁移。
  
  - `extractDirectives(ast, { diags })` / `extractInlineDirectives(node, { diags })`：诊断同步落调用方数组，单次调用内同文案去重；不传 `diags` 为纯查询形态（诊断丢弃，等价 `extractDirectivesQuiet`）
  - 新增 `runWithDirectiveDiags(diags, fn)`：把「extract + 复解析」（如 nudo check D1 段的 `@nudo:mock` 表达式种子复解析）包进同一去重域
  - 删除模块级缓冲与上述旧 API。迁移路径：`directiveDiagCount()` + `takeDirectiveDiagsSince(since)` 锚点对 → `extractDirectives(ast, { diags })` 直接落袋（或 `runWithDirectiveDiags` 包住 extract+复解析窗口）；`takeDirectiveDiags()` 整批排干 → 显式 `diags` 数组
  - `collectEvalReplacements(source, { diags })`（@nudojs/service，additive）：行内 `@nudo:as`/`@nudo:replace` 文法诊断显式落袋，nudojs check 的 D1 并入面行为零变更（issue code / 合并顺序 / 去重口径保持）
  - 删除动因：模块级缓冲曾引发两轮跨消费方偷诊断事故（R2B-003：全量 take 在 await 窗口偷走在途诊断）；service analyzer 与 LSP validateText 此前已迁移显式通道

### Patch Changes

- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
  - @nudojs/core@1.7.3

## 1.3.2

### Patch Changes

- Updated dependencies [ef514a8]
  - @nudojs/core@1.7.1

## 1.3.1

### Patch Changes

- Updated dependencies [f6ec0e8]
  - @nudojs/core@1.7.0

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

## 1.2.1

### Patch Changes

- Updated dependencies [64ca356]
  - @nudojs/core@1.5.0

## 1.2.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [f10066d]
  - @nudojs/core@1.4.0

## 1.1.9

### Patch Changes

- Updated dependencies [8df9215]
  - @nudojs/core@1.3.1

## 1.1.8

### Patch Changes

- Updated dependencies [6bc08c7]
- Updated dependencies [d925692]
- Updated dependencies [c717017]
  - @nudojs/core@1.3.0

## 1.1.7

### Patch Changes

- Updated dependencies [662aeb5]
  - @nudojs/core@1.2.2

## 1.1.6

### Patch Changes

- Updated dependencies [7b8df37]
- Updated dependencies [af8cb68]
- Updated dependencies [ff37d91]
  - @nudojs/core@1.2.1

## 1.1.5

### Patch Changes

- Updated dependencies [5ff4202]
- Updated dependencies [5ff4202]
  - @nudojs/core@1.2.0

## 1.1.4

### Patch Changes

- Updated dependencies [634932f]
  - @nudojs/core@1.1.4

## 1.1.3

### Patch Changes

- 3bf9997: fix(core): JS semantics soundness — ToString args, compare undefined, NaN identity, JSON.stringify
  
  B-path Abs folding corrections so concrete results match native JS:
  
  - string/parse methods (`startsWith`/`endsWith`/`includes`/`split`/`replace`/
    `indexOf`/`parseInt`/`parseFloat`) honor ToString and missing-arg defaults;
    `split` keeps the ES special case that an **undefined** separator returns
    `[ToString(O)]` without splitting
  - relational compare of `lit(undefined)` folds via ToNumber (all relations false)
  - same-var `===` is not exact `true` when the value may be NaN
  - `JSON.stringify` of top-level function/symbol returns the JS `undefined` value
  - NaN literal identity uses SameValue (assignment/`leq`), not `===`
  - drop unsound `x*0=0` / `x+0=x` algebra identities (NaN/`-0`/string domain)
  - `n % 0` folds to NaN; `x % k` bounds only for finite dividends
  - `0n` is falsy; `Number.is*` fold non-number lits to false; global `isNaN` coerces
  - string index methods (`charAt`/`slice`/…) honor ToNumber and default args
  - unary minus and `parseInt`/`parseFloat` honor ToNumber/ToInt32
  - Math.* folds ToNumber lits (own numeric methods only — no `constructor`/`toString`)
  - tuple index reads use canonical array index (`a["0"] === a[0]`)
  - call-spread placeholder is `unknown`, not `undefined` lit
  
  `fix(parser)`: directive scanners (`splitTopLevelArgs` / colon / arrow / balanced
  parens) respect string literals.
  
  Review follow-ups folded in: `split(undefined)` special case, `indexOf` returns
  number shape on abstract receivers, Math method allowlist.
- Updated dependencies [3bf9997]
  - @nudojs/core@1.1.3

## 1.1.2

### Patch Changes

- Updated dependencies [c1f3e93]
  - @nudojs/core@1.1.2

## 1.1.1

### Patch Changes

- Updated dependencies [86d1f87]
- Updated dependencies [892899d]
- Updated dependencies [faccd76]
  - @nudojs/core@1.1.1

## 1.1.0-beta.0

### Minor Changes

- P1–P3 engineering hardening (review follow-ups) — no product-face breaks
  
  - **@nudojs/parser**: export typed Babel AST narrowers (`ast-guards.ts`); service `analyzer-ast` / lsp `symbols` no longer use `as any` on nodes.
  - **@nudojs/cli**: extract pure decision modules (`check-gate-config`, `check-json-map`, `check-ci-flags`, `export-format`) and cover them with in-process unit tests; per-package coverage floors raised.
  - **@nudojs/service**: host cache-invalidation contract documented (`docs/design/cache-invalidation.md`) + C1–C8 regression tests; LSP targeted eviction now clears path-env and abs-module cache for changed deps.
  - **@nudojs/lsp**: `server.ts` split into watch/commands/navigation/code-actions/ide modules (public API unchanged); path-env clear on dependent eviction.
  - **@nudojs/service**: `interface-derivation` / `analyzer-orchestrate` split into cohesion modules with stable facades.
  - Docs: trust-boundary note in Quick Start, version narrative consistency, env mock-boundary checklist, CheckJson `actions[]` field table.
  - vite-plugin: named `logAnalysisSummary` helper (logging surface unchanged).

### Patch Changes

- Updated dependencies [22baf33]
- Updated dependencies [0e1432a]
- Updated dependencies [3c3f9d2]
- Updated dependencies
- Updated dependencies [279d73a]
  - @nudojs/core@3.0.0-beta.0

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
  - @nudojs/core@2.1.0

## 0.5.1

### Patch Changes

- Updated dependencies [9731238]
  - @nudojs/core@2.0.1

## 0.5.0

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

## 0.4.2

### Patch Changes

- Updated dependencies [61b8a6c]
  - @nudojs/core@1.0.1

## 0.4.1

### Patch Changes

- Updated dependencies [0fd253f]
- Updated dependencies [a2aac9e]
- Updated dependencies [0f0b7d5]
- Updated dependencies [de47d84]
- Updated dependencies [78f6752]
  - @nudojs/core@1.0.0

## 0.4.0

### Minor Changes

- 1d6bb01: `getFunctionName` 对 `export const f = …`（ExportNamedDeclaration + VariableDeclaration）返回 `<anonymous>`——现在递归进入声明节点，导出箭头函数获得真实函数名，case 求值可达。

### Patch Changes

- Updated dependencies [1d6bb01]
- Updated dependencies [1d233a7]
  - @nudojs/core@0.4.0

## 0.3.1

### Patch Changes

- bee69d4: Publish built dist instead of TypeScript source: packages now ship compiled ESM + .d.ts, CLI bin gets a shebang, `nudo --version` reads the real package version, and `nudo check` accepts multiple paths.
- Updated dependencies [21427eb]
- Updated dependencies [df1726c]
- Updated dependencies [bee69d4]
- Updated dependencies [8d85d99]
  - @nudojs/core@0.3.1

## 0.3.0

### Minor Changes

- 5786fa5: Improve `@nudo:mock` parsing for sinon-style stubs and share parse/strip with core.

  - Support `stub().onFirstCall()`, `stub().callsFake(fn)`, and `sinon.`-prefixed chains as the same MockHelper shape TypeValue/Abs already consume.
  - Drop the unused `ReturnsDirective` / `@nudo:returns` directive type (contracts use `@nudo:refine`).
  - `parse()` now strips types unconditionally via core `parseSource` (shared AST cache).

### Patch Changes

- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
  - @nudojs/core@0.3.0

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

## 0.1.0

### Minor Changes

- Conceptual design and basic implementation.

### Patch Changes

- Updated dependencies
  - @nudojs/core@0.1.0
