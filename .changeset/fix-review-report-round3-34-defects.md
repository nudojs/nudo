---
"@nudojs/core": minor
"@nudojs/service": minor
"nudojs": major
---

`@nudojs/core` 新增公开可选项 `TranspileOptions.disableAsyncGen`（async 生成器路径的**安全网**开关）、
`@nudojs/service` 新增公开导出 `analyzeFileWithEvalFailures` / `analyzeFileAsyncWithEvalFailures` /
`FileEvalFailure` ⇒ 均为纯**增量** ⇒ minor。

`nudojs` 为 **major**：模块级求值失败（引擎内部回落）现在**不再**让闸门静默放绿 ——
`nudo check` 以 **error 级 `nudo:internal`** 报出并以**非零码**退出，`nudo health` 的
`Result` 不再报 `OK`。**这是闸门口径的翻转**（详见下方「BREAKING」）。

fix: review 报告 34 条缺陷收口（闸门假红/假绿 · 契约面宽松 · 机器面谎报 · 文档与 changeset 漂移）

本轮把一份 34 条缺陷的 review 报告逐条落地：每条都先在当前代码上**复现**（或判定为
非缺陷），再修，并**逐条用回滚法自证「修前红 / 修后绿」**。新增 **39 个回归测试文件**。

---

**BREAKING**: `nudo check` / `nudo health` 现在对**引擎内部回落**（模块求值失败 ⇒ 该文件
的导出全部丢失）**fail-closed**。此前这类文件**零诊断 + exit 0** ⇒ CI 闸门**假绿**
（合法代码与违约代码都判绿）。现在：命中内部回落 ⇒ 报 **error 级 `nudo:internal`**
（消息含文件路径与原因）⇒ `nudo check` **非零退出**；`nudo health` 报
`Result: FAIL (engine internal fallback found)` 并非零退出。

谁会坏：依赖「坏文件也能过闸」的 CI 流水线（此前引擎自己挂了就当无事发生）。这些文件
本来就是引擎缺陷的暴露面 —— 现在会**显式**报出来。

怎么迁移：修掉被报出的文件（消息里给了路径与原因）。注意**口径边界**：`unsupported:*`
（能力边界）与 `nudo:opaque-result`（推断精度）**不**触发该失败路径；只有**引擎内部回落**
（`internal`）才 fail-closed。

---

### 高危（闸门级 · 5 条）

- **`await` 的位置表与转译侧脱节 ⇒ `yield` 落进嵌套箭头 ⇒ 整模块编译失败 ⇒ L2 闸门假绿**
  （`core/algebra/exec/transpile/async-plan.ts` · `core/algebra/exec/run.ts`）：async 体的
  真挂起靠**宿主生成器**（`function*(){…}` + `await` 发射 `yield`）实现 ⇒ `yield` 必须落在
  生成器**体内联**位置；而转译侧把若干操作数包进**宿主 thunk** —— `yield` 落在里面是
  **SyntaxError** ⇒ `new Function` 编译失败 ⇒ **整个模块**的导出全部丢失 ⇒ 闸门看不到任何
  入口 ⇒ **零诊断 + exit 0** ⇒ **CI 闸门假绿**。位置表此前只把「分支臂 / 循环体 / 短路右臂 /
  三元两臂」判为 thunk，漏了：**成员调用的实参**（`o.m(await 1)`）、**成员赋值的接收者/计算键/
  右值**（`o.x = await 1`）、**成员自增的计算键**（`o[await k]++`）、**逻辑赋值的右值**
  （`x ||= await 1`）、**循环判别式与步进式**、**switch 的 case 测试**、**早退守卫之后的后续
  语句**（`if (!c) return null; … await …`）。实测：`export async function load(id){ if(!id)
  return null; const res = await fetch("/x/"+id); return res.json(); }` 修前 ⇒ `nudo check`
  **OK / exit 0 / 签名全 unknown**；修后 ⇒ **error 级 `nudo:entry-may-throw`**（与 main 同结论）。
  修法（两处，缺一不可）：① 位置表补齐（上列位置判 thunk ⇒ 该 async 体回落 `$async` 同步
  路径，产物是**合法 JS**）；② **安全网**：生成器模式编译失败时**关闭 `asyncGen` 重试一次**
  ⇒ 纵有未来新增的脱节位置，模块也**编译得出来** ⇒ 导出可见 ⇒ 闸门照常判定
  （**宁可少精确，不可整模块消失**）。

- **模块级求值失败 ⇒ 闸门假绿**（`service/src/analyzer-orchestrate.ts` ·
  `nudojs/src/commands/{check,check-report,health}.ts`）：见上方 **BREAKING** 段。
  修法：按**文件**收集 `internal` 回落（进程级计数无法定位到文件）⇒ 命中即产出
  **error 级 `nudo:internal`**（复用已注册码 `DIAG.internal`，未新增第二套码表）⇒
  `ok:false` ⇒ 非零退出；分析失败的降级产物**不回写磁盘缓存**（回写 ⇒ 下次命中缓存跳过求值
  ⇒ 静默转绿）。

- **早返回的关系补集默认「x 不是 NaN」⇒ 契约被证成 ⇒ 假绿**
  （`core/algebra/exec/transpile/stmt/{fn-body,statement}.ts`）：`¬(x <= k)` 还含 `x` 为
  **NaN** 的情形（NaN 与任何比较皆假）⇒ 后续路径只该断定 `x > k ∨ x is NaN`；此前直接断言
  `x > k`（排除了 NaN）⇒ `if (x < 0) return 0; return x;` + `return nonNeg` 判**成立**
  （零诊断），而原生 `x=NaN` 时返回 NaN ⇒ **真违规被放过**。且与**三元**写法
  （`x < 0 ? 0 : x`）结论**不一致**（三元判 `unproven-return`）。修法：撤销后续路径的否定界
  窄化 ⇒ 两条路径同口径。

- **Bug 370 把「确定违规」降为 warning**（`core/algebra/postcondition.ts`）：证据面判据
  从「`ret.pred` 有事实」改成「含**界原子**」⇒ `typeof` 级证据（`@nudo:contract x num` 的
  **声明域参数**）被判成「无证据」⇒ 返回义务降级成 `nudo:unproven-return`（**warning**，且
  warning **不改变 exit code** ⇒ 门禁空转）。`if (x === -1 || x === -2) return x;` + `return
  positive` 是**确定违规**（x=0 即违约），此前只出 warning。修法：判据回到「`ret.pred` 有
  事实」⇒ 声明域参数 ⇒ **error 级 `nudo:constraint-violated`**。

- **契约合取的结构型义务被静默丢掉 ⇒ 假绿**（`core/algebra/interface.ts`）：合取遇任一侧
  结构型就直接返回前侧 ⇒ 源码 shape`{id}` ∧ 侧车 shape`{id,name}` 的 **`name` 义务整条蒸发**
  ⇒ 契约面比声明面**宽松** ⇒ 违约代码被放过。修法：改为**字段级合并**（两侧都有的字段递归
  合取、单侧字段保留、`optional` 取交集）；合不了的形态组合按既有口径**不**判 conflict
  （能力边界 ≠ 语义不可满足）但**显式留痕**（新增 `EffectiveInterface.undecidable` ⇒ check 面
  发 **warning** 级 `nudo:interface-conflict`，**不静默宽松**）。

### 闸门可信度（假红 / 假绿 · 14 条）

- **展开实参被计为 1 个 ⇒ `nudo:arg-count` 假红**（`core/algebra/scan/literal-args.ts`）：
  `impl(...args)` 被计成 1 个实参 ⇒ 报「expects 2 argument(s), got 1」；数组字面量展开的**空洞**
  （`three(...[1,,3])`，原生是 3 个实参）被跳过；幻影槽位破坏 rest 聚合（`few(1, ...more)`
  对 `array(number()).max(1)` 报长度违规）。修法：个数不可判时**让位**元数检查；空洞按
  `undefined` 计入；rest / length 边界在展开处**停止**。
- **裸名 callee 解析不看作用域 ⇒ 无契约也触发 arity 假红**（`core/algebra/scan-call-graph.ts`）：
  外层函数的**形参 / 局部 const / 嵌套函数 / for-of 绑定 / 解构绑定**同名时，把顶层声明当被调
  方 ⇒ 报「log expects 2 argument(s), got 1」+ 假 may-throw。修法：callee 解析引入**作用域链**。
- **`memberToFn` 按变量名做键 ⇒ 同名局部/参数互相串味**（`core/algebra/scan-call-graph.ts`）：
  别名与成员绑定改为**按作用域分桶**，重新赋值时失效。
- **TS `x?: T` 与 JSDoc `[x]` 被当成必需参数 ⇒ arity 假红**（`core/algebra/param-surface.ts`）：
  `h()` 对 `/** @param {number} [x] */ function h(x)` 报「expects 1 argument(s), got 0」。
- **`or` 契约的「不可判定」成员被当成失败**（`core/algebra/scan/literal-shapes.ts`）：
  `union(number().gt(0), lit("a"))` 对**非字面量 number** 实参误报。修法：三值聚合 ——
  **全部**成员确定假才报；不可判定且域容纳该形态 ⇒ 整条 union 保持未决。
- **显式 `undefined` 被当成值**（`core/algebra/scan/literal-args.ts`）：`d1(undefined)` 对带默认值
  的形参报约束错误。修法：显式 `undefined` ⇒ 走**默认值**。
- **默认值填充只在零参时发生 ⇒ 假绿**（`core/algebra/scan-literal-calls.ts`）：
  `e4(1)` 缺失的尾部位不补（运行时 x = -5）⇒ 静默。修法：补齐**所有缺失的尾部位置**。
- **switch 分组 case 标签的 `hit` 收窄不安全**（`core/algebra/exec/transpile/stmt-predicates.ts`）：
  `const x = null; switch (x) { case null: case "ab": return x.length; }` 原生抛 TypeError，
  引擎按源码推导读 `"ab".length` ⇒ **L2 may-throw 消失**。`case 0:` 还会把 `-0` 重绑成 `+0`
  （原生 `1 / -0` = `-Infinity`，引擎算成 `Infinity` = **自信的错值**）。修法：只有**同体全部
  标签都是原始字面量**才产命中事实；`0` 按**交集细化** `{0, -0}`。
- **`lit(NaN)` 契约被判自相矛盾 ⇒ 假红**（`core/algebra/interface.ts`）：字面量值比较用
  `!==` ⇒ `NaN !== NaN` ⇒ 同一个 `lit(NaN)` 自比被判成「两个不同字面量」⇒
  `nudo:interface-conflict`。修法：改用既有 helper `termEquals`（`===` + NaN 特例）。
- **import 别名撞 ambient builder 声明 ⇒ 整个 sidecar 装载失败**
  （`core/algebra/refine.ts`）：`import { number as string } from "@nudojs/core"` 与包装器的
  `const { number, string, … } = __nudoInjects` 同处一个外层作用域 ⇒ SyntaxError ⇒ 侧车整体
  装载失败 ⇒ **契约全丢**。修法：显式 import 的本地名从 ambient builder 名单里排除。
- **`autoBind:false` 下不可读的 ambient sidecar 仍被报成 error ⇒ 假红**
  （`core/algebra/load-deps-fp.ts` · `core/algebra/check.ts`）：**指纹计算**的推测性读取
  走的是**分析读**通道 ⇒ EACCES 被收口成 error；而那份侧车在 `autoBind:false` 下**根本不会被
  绑定**。修法：推测性读走**未经降级闸**的通道（读失败只让指纹标 `readError`）+ 按 ambient
  绑定资格 gate。
- **缓存的 sidecar 诊断丢失依赖归属**（`core/algebra/refine.ts`）：root→dep 递归求值共享同一
  diags 数组 ⇒ 依赖侧车的诊断一律记到 **root** 名下。修法：诊断带**来源文件**并纳入去重键。
- **`lit(1n)` 的大字面量被提前过滤 ⇒ 假绿**（`core/algebra/contract-face.ts`）：bigint 过滤
  发生在 `literalMeetsConstraint` **之前** ⇒ `lit(1n)` 契约下返回 `2n` 的被调函数被判**满足**
  ⇒ 违约被放过。修法：bigint 参与比较（`1n !== 1`，与 number 不混同）。

### 机器面 / 契约面 / 工具链（8 条）

- **`@nudo:skip` 签名分支输出旧机器面**（`core/algebra/check.ts`）：JSON `display` 带
  `#exact` 而终端显示 `number` ⇒ 机器消费方拿到的是**人类面之外的文本**。修法：与其它路径
  同款（`formatSigCached`）。
- **内部临时名遮蔽用户标识符**（`core/algebra/exec/transpile/{member-path,expr/assignment,
  expr/call,expr/optional-chain,expr/short-circuit}.ts` · `helpers.ts`）：引擎写死的
  `__nudoMp*` / `__nudoDefR` / `__nudoReArgs` / `__v` 会**遮蔽**用户源码里的同名绑定 ⇒ 自信错值
  或 TDZ **ReferenceError**（⇒ 闸门**假红**）；模块级同名还会撞出重复声明 SyntaxError ⇒
  **整模块 fail-closed** ⇒ 闸门**假绿**。修法：改用既有 `internalTmpName` /
  `internalTmpNameSet`（**无碰撞时基名原样返回 ⇒ 产物逐字不变**）。
- **CJS 对象字面量导出的普查键必须是成员键**（`core/algebra/export-slot.ts`）：
  `module.exports = { greet: function inner(x){…} }` 的侧车契约**整个不绑定**（只剩
  `unproven-return` 警告、签名退成 `unknown` ⇒ **假绿**），且内层 id 与成员键碰撞时映射串。
  修法：导出槽映射**只用成员键**。
- **`leq` 的 fn arity 只比较必需参数个数**（`core/algebra/leq.ts`）：`(a = 1, b) => b.toFixed()`
  被接受为单参目标（原生 `g(1)` 抛 TypeError）⇒ 判定比原生松 ⇒ 假绿。修法：按**最后一个必需
  参数的位置**比较。
- **生成的守卫对 `new Proxy(...)` 抛错**（`core/algebra/denote.ts`）：`x instanceof Proxy` 在
  原生**抛 TypeError**（Proxy 没有 prototype）⇒ 守卫产物一跑就炸。修法：对**无可用 prototype**
  的构造器跳过身份子句。
- **超参 warning 忽略可选/默认槽位**（`core/algebra/diagnostics.ts`）：`f(a, b = 1)` 被 `f(1, 2)`
  调用时误报「takes 1 argument(s) but 2 were passed」。修法：上界按**非 rest 形参总数**。
- **多行 `@nudo:case … !! throws` 声明丢失**（`core/algebra/directive-scan.ts`）：case 参数跨行
  时后缀正则匹配不到 ⇒ 申报的 throws 丢失 ⇒ `nudo:entry-may-throw` **假红**。修法：先在完整
  注释里找平衡的 case 参数终点再识别后缀。
- **`export default C` 的类入口被漏**（`core/algebra/scan-top-functions.ts`）：Babel 的
  `Identifier` 字段是 **`name`**（代码读的是 `d.id?.name` ⇒ `undefined`）⇒ 类入口不在入口表里
  ⇒ 构造器入口闸门看不到它 ⇒ **假绿**。

### async 运行时（2 条）

- **callee 有 2 个及以上 await 时 caller 提前恢复**（`core/algebra/exec/runtime/async.ts`）：
  队列为 `[callee-resume, caller-resume]` ⇒ callee 的**第二次**续体排在 caller 之后 ⇒ caller
  读到**占位符**。实测 `async function g(){ log.push(1); await null; log.push(2); await null;
  log.push(3) }` 原生 `"1,2,3"` / 修前 `"1,2"` / 修后 `"1,2,3"`；`return await h()` 原生 `7` /
  修前 `unknown` / 修后 `7`。修法：live promise 维护 **pending 态 + waiter 列表**，await 的
  恢复排在 settle **之后**。
- **`Promise.all` 取调用期快照**（`core/algebra/builtins/promise.ts`）：元素尚未 settle 时取到
  占位符 ⇒ 兑现值被永久冻住；元素**拒绝**通道丢失 ⇒ 拒绝臂成死代码（**假绿**）。修法：组合子
  自身 pending，元素 settle 后重算聚合；任一元素确定拒绝 ⇒ 组合子短路拒绝。

### 约束构造器（1 条）

- **`.int()` 暴露给非 number builder ⇒ 同一约束两个裁决**（`core/algebra/constraint.ts`）：
  `literalMeetsConstraint("abc", string().int())`（域面）接受 `"abc"`，而 Abs/投影面却带整数
  谓词。修法：非 number builder 上 `.int()` **抛错**（与 `shift()` 同口径）。同批收口：
  `fn()` 缺字段表守卫、`boolean().gt(1)` / `string().length(-3)` 等**恒假**契约（假红）、
  `array(1,2)` 静默丢元素约束（假绿）。

### 文档 · changeset · 诊断注册表（4 条）

- **自称破坏性的 vite-plugin changeset 声明为 patch**（`.changeset/fix-vite-plugin-s{1,3,4}.md`
  等 32 个）：按 `docs/versioning.md` 逐个复核并**升级 bump 级别**（pre-1.0 的破坏性 ⇒ minor；
  1.x+ 的 JSON 形状变更 / 默认严重级变更 ⇒ major），并补 `**BREAKING**:` 与迁移说明。
- **设计文档引用了被 gitignore 的产物**（`docs/design/generator-laziness.md` ·
  `docs/design/architecture-debt.md`）：`tmp/…` 路径（读者不可达）、`bun` 命令、过时行号、
  `$gen` 发射点数目（3 ⇒ 实为 4）。修法：删交接笔记、引用**符号名**、指向仓内回归钉。
- **中文 API 文档漂移**（`packages/website/i18n/.../api/{agent,cli-reference,lsp,harvester,
  service}.md`）：手写页与 EN 现状不一致（`--json` 的形态、`force?: boolean`、旧契约…）⇒
  逐页同步；同时**收紧**文档覆盖闸门（`docs-coverage.test.ts`）让手写 api 页也进闸门。
- **诊断码绕过注册表**（`packages/core/src/algebra/diag-codes.ts` ·
  `packages/nudojs/src/commands/migrate.ts`）：`nudo:migrate-strip-failed` 此前直写字面量 ⇒
  进 `DIAG` 注册表并由 CLI 引用常量。

### 附带（不改变对外行为）

- `nudo init` 的祖先配置继承口径与加载器对齐（本包已有 `nudo` 键 ⇒ 祖先**不可继承** ⇒ 不再用
  祖先配置当拒绝理由，消除「拒绝 + 不可修复」的死锁）。
- `contract --help` 的 `--json` 描述、`contract --from-dts` 的拒绝提示（同时给出 `--force` 与
  `NUDO_DRAFT_FORCE=1`；**人工改过的草稿永不被覆盖**这条口径不变）。
- `nudo:migrate-strip-failed` 进注册表；`interface` 缓存面新增 `undecidable` 透传。
- 6 条**被放松/空转**的既有测试恢复为**强断言**（`check-regex-capture-narrow-136` ·
  `eval-loop-return-join` · `eval-bug-499` · `core-bug-1064` · `loop-pack-shadow-soundness` ·
  `core-bug-1079`）—— 此前它们在 main 上也通过，钉不住任何回归。
