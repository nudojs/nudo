---
"@nudojs/core": patch
"@nudojs/service": patch
"nudojs": patch
"@nudojs/lsp": patch
"vite-plugin-nudo": patch
"@nudojs/parser": patch
---

fix: 并发 review 收口的 25 条缺陷 + 4 条跨文件尾巴（CI 闸门假红/假绿 · 自相信值 · 机器面口径漂移）

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
