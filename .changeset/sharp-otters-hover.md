---
"@nudojs/lsp": patch
---

fix(lsp): 参数 hover——形参（含解构属性）从 PolyFn 面投影，不再空白

- 根因：hover 的标识符解析只有模块级 import 绑定面（bindings / collectAbsBindingsFromGraph），形参从不入绑定表；带 `@nudo:case` 的函数体内更被整体短路（旧理由“保护 case 重放”，但重放面已删成恒 null）——`decide({ grade, findings })` 的参数声明与体内引用 hover 全空。
- 修复：`getHoverAtPosition` 末段新增参数投影——traverse 直查光标最内层 enclosing 函数（不依赖指令存在，`extractDirectivesQuiet` 只返回带指令的函数），`generalizeFromAst`（与函数名 hover 同源：契约种子 refine + 模块图）后从 `PolyFn.entryShapes + formals` 解析：
  - 直接形参（id/default）→ `entryShapes[name]`；rest 同理；
  - 解构形参（pattern）→ `bound` 名经 `propKey` 投影到 placeholder 对象 slot（rename `{a: b}` 时契约可写 a 或 b，Abs 对象只有 slot a，语义正确）。
- fail-closed 不变：无契约/无提升的参数与体内局部变量保持空（诚实 unknown）；非 case 函数体内的 import 引用仍走绑定面。
- 验证：npm-safe `decide.js`（手写侧车）——`grade` → `string / term: grade #path`，`findings` → `{ ruleId: string, severity: string, veto?: boolean }[]`，声明处与体内引用一致；函数名 hover 无回归；单测覆盖侧车解构投影、提升形参、fail-closed 三态。
