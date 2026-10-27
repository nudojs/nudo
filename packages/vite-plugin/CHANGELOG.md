# vite-plugin-nudo

## 0.6.2

### Patch Changes

- Updated dependencies [d726525]
  - @nudojs/core@1.17.1
  - @nudojs/service@1.10.2

## 0.6.1

### Patch Changes

- Updated dependencies [0438f10]
- Updated dependencies [6ebf5a4]
  - @nudojs/core@1.17.0
  - @nudojs/service@1.10.1

## 0.6.0

### Minor Changes

- b37321b: **BREAKING**: `nudo.analysis.include` 的**字面量条目**现在真的命中
  （Bug 1018 同族）——此前不带通配符的条目**永不匹配** ⇒ 整份 allowlist 被
  **静默忽略** ⇒ 该工程此前**零诊断**；现在字面条目按路径命中（该文件或该目录）
  ⇒ 此前零分析的工程**开始产出诊断**，`failOnError: true` 的构建会由绿变红。
  env 加载失败（缺文件 / 未知 env 名 / 未导出 `defineEnv()`）此前**完全静默**
  ⇒ 受影响代码被当成「env 不存在」分析；现在会报出来。
  
  谁会坏：依赖 0.5.x「静默零分析」的项目（把 `nudo.analysis.include` 当**装饰**用、
  靠它压掉整片分析的构建流水线）；以及依赖「env 加载失败不阻断构建」的流水线。
  
  怎么迁移：把 `nudo.analysis.include` 写成**字面语义**即可；想继续「整片静音」
  请用 `nudo.analysis.diagnostics` 档位，而不是靠不生效的 allowlist。
  `vite-plugin-nudo` 仍是 **pre-1.0**（0.x）：本次按政策以 **minor** 发布
  （0.x 的 minor 可能含破坏性变更）。
  
  The build plugin reports the env failures it used to drop.
  
  - A path env file that failed to load — a missing file, an unknown env name,
    a file that does not export a `defineEnv()` function — produced no
    diagnostic during a build, so the affected code was analyzed as if the env
    did not exist. The failure is reported now.
  
  - A `nudo.analysis.include` entry without a wildcard never matched, so the
    whole allowlist was silently ignored. A literal entry is matched as a path
    now: it names that file, or that directory.
- c52b107: fix(vite-plugin): 构建期分析面的「模块 id → 匹配」层归一化（896 / 902 / 903 / 1018 / 1056）
  
  **BREAKING**: 项目相对 `include` / `exclude` 现在真的生效（Bug 1018）——
  此前插件选项只按**绝对 module id** 匹配 ⇒ `exclude: ["other/**"]` 静默不生效、
  `include: ["src/**"]` 静默把整份分析归零 ⇒ 「静默零分析」的工程此前**零诊断**。
  现在选项与 `nudo.analysis.include` / `exclude` **同口径**（绝对路径 **或** 相对
  `config.root` 的路径命中即算命中）⇒ 此前零分析的工程**开始产出诊断**，
  `failOnError: true` 的构建会由绿变红。
  
  谁会坏：依赖 0.5.x「静默零分析」的项目（把 `include` / `exclude` 当**装饰**用、
  靠它压掉整片分析的构建流水线）；以及显式传了 `exclude` 却指望它只作用于项目内
  路径的用法（依赖 / 软链依赖现在**一律排除**）。
  
  怎么迁移：把 `include` / `exclude` 写成**字面语义**即可（相对 `config.root` 的 glob
  现在与 `nudo.analysis.*` 同口径）；想继续「整片静音」请用
  `nudo.analysis.diagnostics` 档位，而不是靠不生效的 glob。`vite-plugin-nudo` 仍是
  **pre-1.0**（0.x）：本次按政策以 **minor** 发布（0.x 的 minor 可能含破坏性变更）。
  
  - **Bug 896（虚拟模块）**：Vite 的虚拟模块 id（`\0` 前缀 / `virtual:` 前缀）
    被原样拼成侧车路径 ⇒ 路径含 NUL ⇒ 必读不到 ⇒ **干净模块被判 error**
    （`failOnError: true` 时抛错中断构建）。虚拟 id 现在在分析入口被**跳过**。
  
  - **Bug 902（畸形入参）**：`transform(code = null)` 抛未捕获异常
    （`Cannot read properties of null (reading 'length')`，且异常在插件兜底
    `catch` 之外）。非字符串 `code` 现在被前置拦下，守卫调用也移进 `try`
    ⇒ 任何畸形入参都走「跳过」而不是抛给调用方。
  
  - **Bug 903（HMR query）**：`?t=<timestamp>` / `?v=<hash>` 让 include 失配
    ⇒ 整份文件被跳过 ⇒ **dev 期诊断消失（假绿）**。匹配与分析现在统一用
    **剥掉 query 的 id**。
  
  - **Bug 1018（相对 glob 失效）**：`include` / `exclude` **选项**此前只按
    **绝对 module id** 匹配 ⇒ 项目相对 glob（`other/**` / `src/**`）永不命中
    ⇒ 与**同名**的项目配置 `nudo.analysis.include` / `exclude` **判定相反**。
    选项现在与 `nudo.analysis.*` **同口径**：同时对「相对 `config.root` 的路径」
    与「绝对路径」求值。
    ⚠ **破坏性行为变更**：**项目相对 glob 现在生效** —— 此前
    `exclude: ["other/**"]` 静默不生效、`include: ["src/**"]` 静默把整份分析
    归零；现在两者都按字面语义执行。之前「静默零分析」的工程会开始产出诊断。
  
  - **Bug 1056（软链依赖）**：默认排除的「node_modules 段」规则匹配不到
    **软链工作区依赖**的 realpath id ⇒ 别的包源码被当项目源码分析
    （Vite 红 / 同项目 `nudo check` 绿 ⇒ 跨面矛盾 + 假红）。排除判定前先把 id
    归一化成**依赖图视角** ⇒ 软链依赖与物理目录依赖一致地被排除。
    ⚠ **行为变更**：依赖（`node_modules` 段 / 软链依赖 / 工程根 `config.root`
    之外的路径）现在**一律排除**，即使用户显式传了自定义 `exclude`。
- c52b107: The build plugin no longer hides contract failures or drops diagnostics.
  
  **BREAKING**: 两处构建期行为变化（0.5.x 的绿构建可能变红 / 静默构建可能变吵）：
  
  1. `nudo.analysis.diagnostics: "off"` **不再静默契约门禁**。此前门禁诊断
     （L1 `nudo:constraint-violated` / L2 `nudo:entry-may-throw`）与显示通道合并
     过滤 ⇒ `off` 项目**零诊断**、`failOnError: true` 也照样**绿**（坏契约上的
     绿灯 CI）。现在门禁通道独立：**error 级的 check 诊断在任何档位（含 `off`）
     都照常上报、照常拦构建**。
  2. `build.logLevel: "silent"` 现在**真的什么都不输出**（含汇总行）。汇总行此前
     走裸 `console.log`，逃出 Vite logger 的管辖 ⇒ 静默构建仍打印
     `[nudo] Analysis complete: N error(s), M warning(s)`，却看不到那 N 条诊断
     （只报数、不给理由）。现在汇总行走 Vite logger ⇒ 静默档下**连汇总行都没有**。
  
  谁会坏：靠 `diagnostics: "off"` 换「构建期不拦契约」的流水线（CI 由绿转红）；
  以及在 `logLevel: "silent"` 下仍依赖 `[nudo] Analysis complete: …` 这行汇总
  做日志采集的脚本（该行不再出现）。
  
  怎么迁移：想让构建期完全安静，用 `build.logLevel: "silent"`（现在它真的静默）
  并把 `failOnError` 设为 `false`；想让契约门禁在构建期也生效，保持现状即可
  （门禁不再被 `off` 抹掉，这是有意的 fail-closed 方向）。`vite-plugin-nudo` 仍是
  **pre-1.0**（0.x）：本次按政策以 **minor** 发布（0.x 的 minor 可能含破坏性变更）。
  
  - `nudo.analysis.diagnostics: "off"` no longer silences the **contract gate**.
    Previously the check-gate diagnostics (L1 `nudo:constraint-violated`, L2
    `nudo:entry-may-throw`) were merged into the display path and filtered
    together with it, so an `off` project reported **zero** diagnostics and a
    build with `failOnError: true` still **passed** — a green CI on a broken
    contract. The gate channel is now separate: error-level check diagnostics
    are reported and still fail the build under `failOnError: true`, in every
    diagnostics tier including `off`. The display path (evaluator diagnostics,
    path-env failures, and check warnings/info) keeps the old tier semantics.
  
  - `build.logLevel: "silent"` now silences **everything** the plugin prints.
    The build summary used to be written with a bare `console.log`, which
    escaped Vite's logger: a silent build still printed
    `[nudo] Analysis complete: N error(s), M warning(s)` while none of the N
    diagnostics were shown. The summary now goes through Vite's logger, so a
    silent build prints nothing at all.
  
  **Fixes**
  
  - `failOnError: true` reported only the **first** error-level diagnostic and
    dropped the rest, while the build summary counted them all ("2 error(s)"
    next to a single reported error). The first error still fails the build;
    every remaining error-level diagnostic is now reported as well, so the
    summary count and the number of reported diagnostics agree.
  
  - Diagnostics without a source position were rendered as `:0:0` (a line that
    does not exist) or `:1:0` (an invented first line). A diagnostic with no
    position now omits the `:line:col` part entirely, matching the CLI, which
    prints no location for the same diagnostic.
  
  - The evaluator-side diagnostics dropped their `(nudo:code)` suffix, so a
    single build log mixed two text formats and `grep '(nudo:'` only found half
    of the diagnostics. Every diagnostic now carries its code, and the two
    sources use the same format.
- c52b107: fix(vite-plugin): 构建期分析面看到**原始 TS 源码**（895 / 900）+ 模块 id 归一化接线
  
  **BREAKING**: 本版本一并生效的三处破坏性行为变化（详见下文
  「**Breaking behavior changes（本版本一并生效）**」逐条说明）：
  
  1. **899** —— `nudo.analysis.diagnostics: "off"` **不再抹掉契约门禁**：error 级的
     check 诊断在任何档位（含 `off`）都照常上报、照常拦构建 ⇒ 此前靠 `off` 拿到
     绿灯 CI 的流水线**由绿转红**。
  2. **1002** —— `build.logLevel: "silent"` 下插件**什么都不输出**（含汇总行）
     ⇒ 依赖 `[nudo] Analysis complete: …` 这行做日志采集的脚本**取不到**该行。
  3. **1018** —— 项目相对 glob 现在生效（`include` / `exclude` 同时对「相对
     `config.root` 的路径」与「绝对路径」求值）⇒ 此前「静默零分析」的工程
     **开始产出诊断**，`failOnError: true` 的构建**由绿转红**。
  
  谁会坏：靠 `diagnostics: "off"` 换「构建期不拦契约」的流水线；依赖静默构建里
  那行汇总做采集的脚本；把 `include` / `exclude` 当**装饰**用、靠它压掉整片分析的
  工程。
  
  怎么迁移：用 `build.logLevel: "silent"` + `failOnError: false` 换「构建期完全
  安静」；`include` / `exclude` 改成**字面语义**（与 `nudo.analysis.*` 同口径）；
  契约门禁在构建期生效是有意的 fail-closed 方向，保持现状即可。
  `vite-plugin-nudo` 仍是 **pre-1.0**（0.x）：本次按政策以 **minor** 发布
  （0.x 的 minor 可能含破坏性变更）。
  
  **Fixes**
  
  - **Bug 895（假红面）**：插件对象**缺** `enforce: "pre"` ⇒ 排在核心插件
    `vite:esbuild` **之后** ⇒ `transform` 收到的是 esbuild 的**转译产物**
    （TS loader 剥光注释）⇒ `.ts` 源里**只存在于注释**的 `@nudo:` 指令全部
    不可见 ⇒ 分析按「无指令普通模块」跑 ⇒ 报出 `nudo check` **不会**报的
    error（同一份文件：CLI 判 OK，`vite build` 红）。插件现在排在
    `vite:esbuild` **之前** ⇒ 看到**原始 TS 源码** ⇒ 指令可见 ⇒ 与 CLI 判同。
  
  - **Bug 900（假绿面 · 895 的反方向）**：同一根因的另一面 —— `.ts` 源里的
    `@nudo:contract` / `@nudo:case` 被 esbuild 删光 ⇒ **门禁静默放绿**
    （同一份契约：`.js` 源报红，`.ts` 源**零诊断**）。修复后 `.ts` 源与 `.js`
    源的**诊断集合一致**。
  
  - **模块 id 归一化接线**：分析 / 诊断一律用**剥掉 query**（`?t=` / `?v=`）
    的 module id ⇒ ① 诊断文本不再带 `?t=`；② `sidecarPathOf` 命中**真实
    侧车** ⇒ HMR 期侧车契约不再静默失效。
  
  - **诊断行号回到源码坐标系**：`enforce: "pre"` 之后诊断行号从「转译产物
    坐标系」回到「**源码坐标系**」—— 这是**预期修复**（诊断**集合**不变，
    位置回到用户写代码的那份文件）。
  
  - **TS 语法兜底**：`enforce: "pre"` ⇒ 插件看到含类型注解的原始 TS 源码 ⇒
    分析面必须吃得住 TS 语法。TS 特有语法（`interface` / 泛型 / `enum` /
    `namespace` / `as const` / `satisfies` / 抽象类 / 参数属性）照常解析；
    解析不了的语法（如装饰器）降级为一条 `Failed to analyze` warning ——
    **构建不炸**。
  
  **Breaking behavior changes（本版本一并生效）**
  
  - **899 —— `nudo.analysis.diagnostics: "off"` 不再抹掉契约门禁**。此前门禁
    诊断（L1 `nudo:constraint-violated` / L2 `nudo:entry-may-throw`）与
    evaluator 诊断合并后一起过滤 ⇒ `off` 项目**零诊断**、`failOnError: true`
    也**照样绿**（坏契约上的绿灯 CI）。现在门禁通道独立：**error 级的 check
    诊断在任何档位（含 `off`）都照常上报、照常拦构建**；显示通道
    （evaluator 诊断、path-env 失败、check 的 warning / info）保持原档位语义。
  
  - **1002 —— `build.logLevel: "silent"` 下插件**什么都不输出**（含汇总行）**。
    汇总行此前走裸 `console.log`，逃出 Vite logger 的管辖 ⇒ 静默构建仍打印
    `[nudo] Analysis complete: N error(s), M warning(s)`，却看不到那 N 条诊断
    （只报数、不给理由）。现在汇总行走 Vite logger ⇒ 静默档下**连汇总行都没有**。
  
  - **1018 —— 项目相对 glob 现在生效**。插件选项的 `include` / `exclude`
    此前只按**绝对 module id** 匹配 ⇒ 项目相对 glob（`other/**` / `src/**`）
    永不命中 ⇒ 与**同名**的项目配置 `nudo.analysis.include` / `exclude`
    **判定相反**。选项现在与 `nudo.analysis.*` **同口径**：同时对「相对
    `config.root` 的路径」与「绝对路径」求值。
    ⚠ **之前「静默零分析」的工程会开始产出诊断**（此前 `exclude: ["other/**"]`
    静默不生效、`include: ["src/**"]` 静默把整份分析归零）。

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
- c52b107: Internal restructuring only — no behaviour change.
  
  The plugin entry point was split into three package-internal modules so the
  individual concerns can be maintained separately:
  
  - `scope.ts` — module id normalisation and analysis-scope decisions
    (include/exclude matching, the `shouldAnalyzeFile` guard, `config.root`).
  - `check-assembly.ts` — assembling the `checkSource` call and turning its
    issues into diagnostics.
  - `report.ts` — the diagnostic reporting loop, `failOnError` aggregation, the
    build-end summary, and the single message-rendering outlet.
  
  `index.ts` is now a thin shell that only wires the plugin hooks together. The
  plugin's public surface is unchanged: the package still exports exactly one
  runtime symbol (`default`). The three new modules are not re-exported from the
  entry point and are not part of the package's `exports` map, so they stay
  internal.
  
  The public behaviour of the plugin — which files are analysed, which
  diagnostics are reported, and what the build end summary says — is unchanged
  by this restructuring.
- c52b107: The build plugin reads the project's L2 gate settings instead of ignoring them.
  
  - `package.json#nudo.check.entryThrows` was ignored during a build: the
    plugin always applied the strictest level, so a project that had moved the
    gate to `"warning"` (or `"off"`) saw `nudo check` pass while `vite build`
    reported an error — and with `failOnError: true` the build was interrupted.
    The configured level is applied now, matching the CLI and the editor.
  
  - `package.json#nudo.check.ignoreThrows` was ignored for the same reason: a
    throw class listed there was still reported as `nudo:entry-may-throw`.
    The listed classes are ignored now.
- c52b107: fix(vite-plugin): 补 Bug 901 的回归钉 —— info 不计入 warning 计数 + info 走 info 通道（假阳性片）
  
  - **Bug 901 的核心症状已由族 26 随 `f87c9f9d` 落地**（changeset
    `fix-lsp-core-F.md` 的「Bug 779 vite 半」）：`buildEnd` 汇总行的 warning 计数
    改成只数 `severity === "warning"`（此前是 `totalDiags - errorCount` ⇒ 把
    info 级诊断算成告警），诊断上报循环新增 **info → `this.info`** 分支（此前
    info 级诊断**一条都不上屏** ⇒ 汇总行与构建日志自相矛盾）。
  
  - 本次**只补回归钉**（`packages/vite-plugin/src/__tests__/vite-bug-901-info-not-counted-as-warning.test.ts`），
    **未改动任何实现**：钉住两条已成立的行为 ——
  
    1. **info 不计入 warning 计数**：汇总行 `[nudo] Analysis complete: X error(s), Y warning(s)`
       的 `Y` 只数 warning 级诊断；info 级诊断不计入，且汇总不得比「实际 warning 条数」多。
    2. **info 走 `this.info` 上屏**：info 级诊断出现在 vite 的 info 通道，**不混进 warn 流**
       （否则 info 冒充告警）。
  
  - 该钉在 **HEAD 只读副本上通过**（它钉的是已修好的行为 ⇒ 本族唯一的「反向闸例外」），
    在**族 26 修复前的副本上 3/3 失败** ⇒ 仍是一道有效的回归守护。
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

## 0.5.2

### Patch Changes

- Updated dependencies [4513a45]
  - @nudojs/core@1.15.2
  - @nudojs/service@1.9.2

## 0.5.1

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
  - @nudojs/service@1.9.1

## 0.5.0

### Minor Changes

- 8faa2b0: **BREAKING** (runtime floor): `engines.node` raised from `>=20` to `>=22` on all published packages. Node 20 reached end-of-life on 2026-04-30, and the nightly engine-smoke matrix only covers Node 22 (the `packageManager`-pinned pnpm already requires `node:sqlite`, i.e. Node >= 22.5, to orchestrate at all). No code or API changes — installs on Node 20 will now warn per npm `engines` semantics.

### Patch Changes

- Updated dependencies [aae0f96]
- Updated dependencies [52de5ca]
- Updated dependencies [1ccff57]
- Updated dependencies [8faa2b0]
  - @nudojs/core@1.15.0
  - @nudojs/service@1.9.0

## 0.4.43

### Patch Changes

- c19bd48: Misplaced file-level directives now warn instead of being silently ignored, and `nudo.analysis.exclude` supports real globs (fix-12 batch).
  
  - parser: file-level directives (`@nudo:env` / `@nudo:mock-module`) written inside JSDoc blocks emit `nudo:directive-syntax` with the correct `///` form instead of being dropped silently.
  - service: `nudo.analysis.exclude` accepts glob patterns (shared `compilePattern`, extracted from vite-plugin as the single source; plain substrings still work, defaults always stack).
  - vite-plugin: pattern matching cut over to the shared `compilePattern` — behavior unchanged, one implementation.
- Updated dependencies [c19bd48]
- Updated dependencies [c19bd48]
  - @nudojs/core@1.14.1
  - @nudojs/service@1.8.0

## 0.4.42

### Patch Changes

- Updated dependencies [0d9e7de]
- Updated dependencies [0d9e7de]
  - @nudojs/core@1.14.0
  - @nudojs/service@1.7.0

## 0.4.41

### Patch Changes

- Updated dependencies [f5c0c6e]
  - @nudojs/core@1.13.0
  - @nudojs/service@1.6.25

## 0.4.40

### Patch Changes

- Updated dependencies [e4e491f]
- Updated dependencies [1881f97]
- Updated dependencies [1881f97]
- Updated dependencies [8466793]
  - @nudojs/core@1.12.0
  - @nudojs/service@1.6.24

## 0.4.39

### Patch Changes

- Updated dependencies [08d7a55]
  - @nudojs/core@1.11.3
  - @nudojs/service@1.6.23

## 0.4.38

### Patch Changes

- Updated dependencies [82eaae8]
  - @nudojs/core@1.11.2
  - @nudojs/service@1.6.22

## 0.4.37

### Patch Changes

- Updated dependencies [612d64f]
  - @nudojs/core@1.11.1
  - @nudojs/service@1.6.21

## 0.4.36

### Patch Changes

- Updated dependencies [cce5e58]
- Updated dependencies [16cda31]
- Updated dependencies [cce5e58]
  - @nudojs/core@1.11.0
  - @nudojs/service@1.6.20

## 0.4.35

### Patch Changes

- Updated dependencies [8806e93]
  - @nudojs/core@1.10.2
  - @nudojs/service@1.6.19

## 0.4.34

### Patch Changes

- Updated dependencies [96090cd]
  - @nudojs/core@1.10.1
  - @nudojs/service@1.6.18

## 0.4.33

### Patch Changes

- Updated dependencies [334b914]
- Updated dependencies [94197eb]
- Updated dependencies [b8db17b]
- Updated dependencies [fa52735]
- Updated dependencies [35ce944]
- Updated dependencies [5e275df]
  - @nudojs/core@1.10.0
  - @nudojs/service@1.6.17

## 0.4.32

### Patch Changes

- Updated dependencies [2af4016]
- Updated dependencies [2af4016]
  - @nudojs/core@1.9.4
  - @nudojs/service@1.6.16

## 0.4.31

### Patch Changes

- Updated dependencies [b6495c6]
- Updated dependencies [b6495c6]
- Updated dependencies [04a6d1d]
  - @nudojs/core@1.9.3
  - @nudojs/service@1.6.15

## 0.4.30

### Patch Changes

- Updated dependencies [c8e0417]
  - @nudojs/core@1.9.2
  - @nudojs/service@1.6.14

## 0.4.29

### Patch Changes

- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
- Updated dependencies [bf601e0]
  - @nudojs/core@1.9.1
  - @nudojs/service@1.6.13

## 0.4.28

### Patch Changes

- Updated dependencies [aeb6f7e]
  - @nudojs/core@1.9.0
  - @nudojs/service@1.6.12

## 0.4.27

### Patch Changes

- Updated dependencies [05c2c8c]
- Updated dependencies [33239da]
- Updated dependencies [3588ddd]
- Updated dependencies [c647af8]
  - @nudojs/core@1.8.0
  - @nudojs/service@1.6.11

## 0.4.26

### Patch Changes

- Updated dependencies [427da20]
- Updated dependencies [427da20]
  - @nudojs/core@1.7.10
  - @nudojs/service@1.6.10

## 0.4.25

### Patch Changes

- Updated dependencies [b14ac2d]
  - @nudojs/core@1.7.9
  - @nudojs/service@1.6.9

## 0.4.24

### Patch Changes

- Updated dependencies [58b7938]
  - @nudojs/core@1.7.8
  - @nudojs/service@1.6.8

## 0.4.23

### Patch Changes

- Updated dependencies [d6fa067]
- Updated dependencies [92e6a5f]
  - @nudojs/core@1.7.7
  - @nudojs/service@1.6.7

## 0.4.22

### Patch Changes

- Updated dependencies [856d8bf]
  - @nudojs/core@1.7.6
  - @nudojs/service@1.6.6

## 0.4.21

### Patch Changes

- Updated dependencies [4c3fafd]
  - @nudojs/core@1.7.5
  - @nudojs/service@1.6.5

## 0.4.20

### Patch Changes

- Updated dependencies [0fd8e1a]
  - @nudojs/core@1.7.4
  - @nudojs/service@1.6.4

## 0.4.19

### Patch Changes

- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
  - @nudojs/core@1.7.3
  - @nudojs/service@1.6.3

## 0.4.18

### Patch Changes

- 446914f: fix(vite-plugin): checkSource 崩溃不再静默吞掉——默认 `this.warn("[nudo] check failed for <id>: <msg>")`，`failOnError: true` 时升级 `this.error` 红构建（与 CLI BUG-023「注入/装配失败必须红」同口径）；check 面按 (id, source) 套会话缓存，同一 build 会话内未变文件（如 client/SSR 双环境重复 transform）不重跑 check 推断链。
- Updated dependencies [446914f]
- Updated dependencies [446914f]
- Updated dependencies [a00bccc]
- Updated dependencies [446914f]
- Updated dependencies [39332ca]
- Updated dependencies [446914f]
- Updated dependencies [89358f2]
- Updated dependencies [89358f2]
- Updated dependencies [89358f2]
- Updated dependencies [446914f]
  - @nudojs/core@1.7.2
  - @nudojs/service@1.6.2

## 0.4.17

### Patch Changes

- Updated dependencies [ef514a8]
  - @nudojs/core@1.7.1
  - @nudojs/service@1.6.1

## 0.4.16

### Patch Changes

- Updated dependencies [f6ec0e8]
  - @nudojs/core@1.7.0
  - @nudojs/service@1.6.0

## 0.4.15

### Patch Changes

- Updated dependencies [2f9717b]
  - @nudojs/core@1.6.0
  - @nudojs/service@1.5.0

## 0.4.14

### Patch Changes

- Updated dependencies [64ca356]
  - @nudojs/core@1.5.0
  - @nudojs/service@1.4.0

## 0.4.13

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
  - @nudojs/service@1.3.0

## 0.4.12

### Patch Changes

- Updated dependencies [8df9215]
  - @nudojs/core@1.3.1
  - @nudojs/service@1.2.4

## 0.4.11

### Patch Changes

- Updated dependencies [6bc08c7]
- Updated dependencies [d925692]
- Updated dependencies [c717017]
  - @nudojs/core@1.3.0
  - @nudojs/service@1.2.3

## 0.4.10

### Patch Changes

- Updated dependencies [662aeb5]
  - @nudojs/core@1.2.2
  - @nudojs/service@1.2.2

## 0.4.9

### Patch Changes

- Updated dependencies [7b8df37]
- Updated dependencies [af8cb68]
- Updated dependencies [ff37d91]
  - @nudojs/core@1.2.1
  - @nudojs/service@1.2.1

## 0.4.8

### Patch Changes

- Updated dependencies [5ff4202]
- Updated dependencies [5ff4202]
  - @nudojs/core@1.2.0
  - @nudojs/service@1.2.0

## 0.4.7

### Patch Changes

- Updated dependencies [634932f]
  - @nudojs/core@1.1.4
  - @nudojs/service@1.1.4

## 0.4.6

### Patch Changes

- Updated dependencies [3bf9997]
- Updated dependencies [43fb345]
  - @nudojs/core@1.1.3
  - @nudojs/service@1.1.3

## 0.4.5

### Patch Changes

- Updated dependencies [c1f3e93]
  - @nudojs/core@1.1.2
  - @nudojs/service@1.1.2

## 0.4.4

### Patch Changes

- Updated dependencies [86d1f87]
- Updated dependencies [892899d]
- Updated dependencies [faccd76]
  - @nudojs/core@1.1.1
  - @nudojs/service@1.1.1

## 0.4.3-beta.1

### Patch Changes

- Updated dependencies [4305674]
  - @nudojs/service@5.0.0-beta.1

## 0.4.3-beta.0

### Patch Changes

- P1–P3 engineering hardening (review follow-ups) — no product-face breaks
  
  - **@nudojs/parser**: export typed Babel AST narrowers (`ast-guards.ts`); service `analyzer-ast` / lsp `symbols` no longer use `as any` on nodes.
  - **@nudojs/cli**: extract pure decision modules (`check-gate-config`, `check-json-map`, `check-ci-flags`, `export-format`) and cover them with in-process unit tests; per-package coverage floors raised.
  - **@nudojs/service**: host cache-invalidation contract documented (`docs/design/cache-invalidation.md`) + C1–C8 regression tests; LSP targeted eviction now clears path-env and abs-module cache for changed deps.
  - **@nudojs/lsp**: `server.ts` split into watch/commands/navigation/code-actions/ide modules (public API unchanged); path-env clear on dependent eviction.
  - **@nudojs/service**: `interface-derivation` / `analyzer-orchestrate` split into cohesion modules with stable facades.
  - Docs: trust-boundary note in Quick Start, version narrative consistency, env mock-boundary checklist, CheckJson `actions[]` field table.
  - vite-plugin: named `logAnalysisSummary` helper (logging surface unchanged).
- Updated dependencies [22baf33]
- Updated dependencies [0e1432a]
- Updated dependencies [3c3f9d2]
- Updated dependencies
- Updated dependencies [279d73a]
- Updated dependencies [5a5e167]
  - @nudojs/core@3.0.0-beta.0
  - @nudojs/service@5.0.0-beta.0

## 0.4.2

### Patch Changes

- Updated dependencies [69ebbf6]
  - @nudojs/service@4.0.0
  - @nudojs/core@2.1.0

## 0.4.1

### Patch Changes

- Updated dependencies [9731238]
  - @nudojs/core@2.0.1
  - @nudojs/service@3.0.0

## 0.4.0

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

## 0.3.4

### Patch Changes

- Updated dependencies [61b8a6c]
  - @nudojs/core@1.0.1
  - @nudojs/service@1.0.1

## 0.3.3

### Patch Changes

- Updated dependencies [0fd253f]
- Updated dependencies [a2aac9e]
- Updated dependencies [0f0b7d5]
- Updated dependencies [de47d84]
- Updated dependencies [78f6752]
  - @nudojs/core@1.0.0
  - @nudojs/service@1.0.0

## 0.3.2

### Patch Changes

- Updated dependencies [1d6bb01]
- Updated dependencies [1d233a7]
  - @nudojs/core@0.4.0
  - @nudojs/service@0.3.2

## 0.3.1

### Patch Changes

- bee69d4: Publish built dist instead of TypeScript source: packages now ship compiled ESM + .d.ts, CLI bin gets a shebang, `nudo --version` reads the real package version, and `nudo check` accepts multiple paths.
- Updated dependencies [21427eb]
- Updated dependencies [df1726c]
- Updated dependencies [bee69d4]
- Updated dependencies [8d85d99]
  - @nudojs/core@0.3.1
  - @nudojs/service@0.3.1

## 0.3.0

### Minor Changes

- 5786fa5: Ship TypeScript-aware defaults and Abs check diagnostics in the Vite plugin.

  - Default include covers `.js` / `.mjs` / `.ts` / `.mts`; exclude also skips `*.d.ts`.
  - Glob matching is a real anchored RegExp (not `endsWith` heuristics).
  - Runs `analyzeFileAsync` plus `checkSource` so Abs constraint issues surface as Vite warnings/errors.
  - Exposes `clearAnalysisSessionCaches` for long-lived Vite processes.

### Patch Changes

- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
  - @nudojs/core@0.3.0
  - @nudojs/service@0.3.0

## 0.2.1

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
  - @nudojs/service@0.2.0

## 0.1.0

### Minor Changes

- Conceptual design and basic implementation.

### Patch Changes

- Updated dependencies
  - @nudojs/service@0.1.0
