---
"@nudojs/core": patch
---

fix(core): TS 剥除 pass 的六处缺陷（445 / 446 / 447 / 448 / 913 / 968）

`stripTypes` 是全链（CLI / service / LSP / evaluator）共用的 TS→JS 剥除 pass。
本轮修了六处会让 `nudo migrate strip` 产出**不可加载**的 `.js`、或让分析面
**假红 / 假绿**的缺陷：

- **445** 值位置的「类型专用导入」被消除（与 tsc 的 import elision 同口径）：
  `import { Foo } from "./t.js"` 且 `Foo` 只在类型位置被用到 ⇒ tsc 会消掉这条
  import；不消掉的话，被 import 的模块被剥成空模块 ⇒ 产物 ESM 链接期
  `SyntaxError: does not provide an export named 'Foo'`。判据是语法级的
  「值位置引用收集」，**保守**：判不准的绑定一律保留。
- **446** TS-only 的模块出口语句 `export = X` / `export as namespace X` 被剥除
  （原样留在 `.js` 里 ⇒ 产物不是合法 JS）。
- **447** 类成员的 `x!`（确定赋值断言）、`y?`（可选属性）、`m?()`（可选方法）
  被剥除（原样留在 `.js` 里 ⇒ `node --check` 报 `Unexpected token '!'` / `'?'`）。
- **448** TS 的 `this` 形参从形参数组里删除（原样留在 `.js` 里 ⇒ 产物不是合法
  JS，Node 加载即 `SyntaxError: Unexpected token 'this'`）。
- **913** TS 的 `enum` 不再被整段删除，而是**合成**成等价的运行时对象
  （逐形态对齐 tsc 的 emit：反向映射 / 自动递增 / 字符串枚举 / `const enum`）。
  此前 enum 声明被删 ⇒ 成员引用退化成未绑定全局读取 ⇒ 门禁报 error 级
  `nudo:entry-may-throw`（假红）+ dts / zod / standard / guard 四个产物面把
  返回类型落成 `never`。
- **968** 挂在「将被删除的语句」上的文件级指令（`/// @nudo:import` /
  `@nudo:env` / `@nudo:mock-module` …）被**转挂**到下一个幸存节点，不再随语句
  一起消失（此前源红、产物绿的假绿）。

`StripOptions.report` 增加了可选的事实回报字段（`enumSynthesized` /
`exportAssignmentRemoved` / `thisParamRemoved` / `typeOnlyImportRemoved` /
`typeOnlyImportKept` / `directivesBefore` / `directivesAfter` /
`directivesDropped`）——`@nudojs/core` 的公开导出面**零新增**。
