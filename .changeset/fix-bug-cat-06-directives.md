---
"@nudojs/parser": patch
"@nudojs/service": patch
---

Fix bug-report category 06 (directive system) — 5 of 7 defects.

- BUG-013: the scope-boundary guard no longer aborts at the walk root, so a bare-block
  annotated statement is replaced instead of falling through to a false
  "matched no expression" warning; the diagnostic now distinguishes "blocked by a nested
  scope" from "no such expression".
- BUG-086: orphan diagnostics for inline directives are reported per instruction (with
  the right line/column) instead of being swallowed by a global orphan counter.
- BUG-184: `@nudo:replace` only matches **value-slot expression** nodes; binding and key
  positions fall through to the "matched no expression" warning instead of being
  transpiled.
- BUG-195: an in-body `/// @nudo:import` line comment is now reported as misplaced (it
  previously fell into a silent `continue`).
- BUG-283: `@nudo:skip` (and the `@nudo:pure` sibling) bind to the **shallowest** same-name
  scope instead of the last writer, so an inner function can no longer steal the outer
  one's skip and an inner-only skip can no longer erase the exported function's `throws`
  annotation.

Regression tests: `service-bug-013-*`, `service-bug-086-*`, `service-bug-184-*`,
`service-bug-283-*`, `parser-bug-195-*`.

Known follow-ups NOT covered here (blocked on core/service call sites outside this
category's file set): BUG-020 and BUG-180 (`@nudo:mock` scope degrades to file level when
there is no same-name conflict) need `core/src/algebra/generalize.ts`
(`scopeSelectedInject` / `hasMocks`), `core/src/algebra/check-may-throw.ts`
(`evalThrowsOutcome`) and `service/src/abs-modules-graph.ts` (`evalDep`).

### 追加：BUG-080 已修（`@nudo:as` 在解构声明上被静默丢弃）

根因：`exec/transpile/stmt/statement.ts` 的 `emitVariableDeclaration` 里 `asVar`
（`matchAsOverride(stmt)` 的结果）**只在 Identifier 分支被消费**，解构分支（`d.id` 非 Identifier）
从头不读它 ⇒ 覆盖被静默丢弃；而指令本身**采集正常**（`VariableDeclaration` 是语句，
`isDirectiveCarrier = isStatement`）⇒ `asTargets` 非空 ⇒ 连 orphan 诊断都不触发 ⇒ 彻底静默、零诊断。

修法：解构分支与 Identifier 分支**同口径**消费 `asVar` —— 覆盖值取代 init 的**值**，原 init 仍求值
（`((initSrc), asVar)` 逗号表达式 ⇒ 副作用与 throws 域保留；`@nudo:as` 是**类型覆盖**不是求值替换）。
随后 `emitDestructure` 照旧逐项 `$get` / `$idx`，读到的自然是覆盖值 ⇒ 每个绑定按源键（对象模式）/
位置（数组模式）取自己的槽；改名 / 默认值 / rest / 嵌套模式全部走原生语义，无特判。

回归 `core-bug-080-as-destructure.test.ts`（8 例）：对象 / 数组模式、改名绑定、Identifier 对照不退化、
无指令与未标注声明的负控制、原 init 的副作用保留、原 init 的 `throws` 域保留；捕获力已实证
（回退该行 ⇒ 前 3 例失败）。

循环头解构（`for (const {a} of xs)`）上的 `@nudo:as` **没有 initializer**（for-of 头不经
`emitVariableDeclaration`，而是在 `emitForOfStatement` 内直接调 `emitDestructure`）⇒ 该形态不施加覆盖，
改为发一条显式 `nudo:directive-syntax`（详见下文「BUG-080 残留收口」）。

### BUG-080 残留收口：解构子名进绑定表 + 不可用的 `@nudo:as` 载体显式诊断

上一节记录的两处残留已收口：

**残留 A（假绿）—— 解构声明的子名此前不进顶层绑定表**（`$recordBinding` 只在 Identifier 分支登记）⇒
该名字在别处被当作实参时解析不出类型 ⇒ `checkSource` 的 `varAbs` 查不到 ⇒ **调用点的契约检查被整条跳过**
⇒ 同一份值走 Identifier 形态会报 `nudo:constraint-violated`，走解构形态**一声不吭**。
同一张表还喂 `collectAbsBindingsFromGraph`（hover / IDE 绑定）与 `mock-abs.ts` ⇒ 解构名在那些面上也没有 Abs。

修法（`packages/core/src/algebra/exec/transpile/stmt/statement.ts` 的 `emitVariableDeclaration`）：
解构分支按 Identifier 分支**同口径**登记绑定名（`$recordBinding(name, name)`，取自
`collectPatternNames`）—— 只限**顶层 depth 0**；块内 / 形参 / catch / for 头不是顶层绑定（作用域正确）。
覆盖对象 / 改名 / 数组 / 嵌套 / rest / 默认值 / export 包装全部走原生语义，无特判。

**残留 B（静默）—— `@nudo:as` 标注在无适用目标的语句上时被静默忽略**：`matchAsOverride` 只在
`emitVariableDeclaration` 与 `emitReturnStatement` 被询问，而指令采集接受**任意语句**
⇒ 标在 for 头 / for-init / if / 表达式语句 / 函数声明上的 `@nudo:as` 被采集却施加不到任何东西
⇒ 类型不变 + **零诊断**（假绿）。
修法（`packages/service/src/eval-injection.ts`）：目标形态白名单 = `VariableDeclaration` /
`ReturnStatement` / `ExportNamedDeclaration`（其 `declaration` 是变量声明）；不在白名单 ⇒
发一条既有的 `nudo:directive-syntax`（warning 级，不制造假红）且**不登记覆盖目标**。

**重钉**：无。

**文档**：`packages/website/docs/concepts/directives.md`（§`@nudo:as`）与 zh-Hans 镜像补两句 ——
解构声明受支持（覆盖施加在初始化表达式上，每个解构名各自绑定推断类型）；其它语句形态上不再静默，
而是报 `nudo:directive-syntax`。

**残留**：无。上一版这里写「LSP agent 面采集内联指令时没有诊断通道 ⇒ 新诊断在 IDE 面不可见」——
**实测不成立**：`nudo:directive-syntax` 经 `check-issues.ts` 的 `collectEvalReplacements(source, { diags })`
→ `directiveDiagIssues()` 进 `CheckIssue`，由 LSP 编辑面（`validation.ts` 的
`collectCheckSupplementIssues` → `checkIssueToLspDiagnostic`，warning 级、`source: "nudo-check"`）
与 agent check 工具（`agent-tools.ts` 的 check 工具）**都会发布**；只有
`buildLspInjection()`（hover / 补全的注入表装配，不是诊断面）不带 diags 汇。新增回归
`lsp-bug-080-directive-syntax-ide.test.ts` 钉住：非法载体（表达式语句 / 函数声明）在编辑面与
推送面各恰好 1 条 `nudo:directive-syntax`（warning、不重复），合法载体（变量声明 / `return`）
0 条（负控制）。
