---
"@nudojs/core": patch
"@nudojs/service": minor
"@nudojs/parser": patch
"nudojs": patch
"@nudojs/lsp": patch
---

`@nudojs/service` **新增**公开导出 `absolutizeEnvSpec`（env 规格的绝对化入口）
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
