---
"@nudojs/lsp": patch
---

fix(lsp): 参数 hover——形参（含解构属性）从 PolyFn 面投影，不再空白

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
