---
"@nudojs/harvester": patch
---

族 27 修复 H4：Bug 814 · 815 · 817 · 818 · 820 · 824 · 827 —— 收割面不再丢
导出形式（`export default` / `export { X as Y }` / `export = X` / `export * from`），
导出表不再随 `.d.ts` 遍历顺序变，重载集不再塌成「第一个 overload 的参数 + union 返回」。

**Bug 814** — `export default` **不在模块导出表里** ⇒ 默认导入落 `unknown`（假警告）；
默认导出的**局部名**被当成具名导出（假绿：TS 侧是 TS2614，引擎侧解析成功）。

- `export default function foo()` / `export default class Foo {}` 的导出名改成
  `default`（局部名不再进导出表）；`export default <局部名>` 解析到该局部绑定的值。

**Bug 815** — `export { X as Y }`（本地改名再导出）被**整条丢弃** ⇒ 改名后的导出
根本不存在（假警告）。现在改名后的导出名进导出表，值取局部绑定。

**Bug 817** — `export * from` 的别名应用是**整记录替换**（`!ctx.modules[alias]` 守卫）
⇒ **有自有声明的模块**把星号再导出的名字**整批丢掉**。别名改成与模块自有声明
**合并**（自有优先），多目标（`export * from "a"; export * from "b";`）也合并；
纯别名仍与目标共用同一条记录（落盘面继续去重）。

**Bug 818** — `declare module "x" { export = <本地类/常量> }` ⇒ **整个模块记录不生成**
（`ctx.skipped++` 静默丢弃）。现在模块记录生成、`default` = 被导出实体的值；
解析不出来时计入 `skipped`（汇总行有信号）。按 TS 语义（`export =` 的类只能默认导入，
具名导入是 TS2595）**不**生成具名导出。

**Bug 820** — `export { X }` 的「是不是值」判定发生在 **Phase 1** ⇒ 模块导出表随
**`.d.ts` 遍历顺序**变（同一份声明换个文件顺序就少一个导出）。判定挪到物化阶段
（符号表完整时）⇒ 导出表逐项相同、与遍历顺序无关。类型位导出
（`export type { X }` / `export { type X }`）不产生运行时值，计入 `skipped`。

**Bug 824** — 模块级 `.d.ts` **顶层的 CJS `export = X`** 整个被丢弃 ⇒ 该包**没有
`default` 导出** ⇒ ESM 默认导入（`import _ from "pkg"`）落 `unknown` + 假警告。
现在顶层 `export = X` 进 `default` 导出（值 = X 的值），桥接层把它提升成包的
`default` 导出。

**Bug 827** — 顶层函数的**重载集塌成 union 返回**（参数只取第一个 overload）。
参数位改成保留**每个** overload 的参数类型（逐位 union；参数个数不同或带泛型 α
时保持原样），返回位仍是各 overload 返回类型的 union ⇒ 重载集不再在收割产物里
被抹掉。

⚠️ 已知残留（core 侧，本次不改）：`convert(1).toFixed()` 的 **L5 假红**还需要
core 侧「按实参形态选 overload arm」的 dispatch（Abs 的 fn 形状目前没有 overload
集合的承载位）＋ union 方法分派只认 `string` 成员（Bug 771 / 263）—— 收割侧
无法单独消掉该假红，详见交付报告的「越界发现」段。
