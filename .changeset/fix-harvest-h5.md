---
"@nudojs/harvester": patch
---

族 27 修复 H5：Bug 793 · Bug 794 · Bug 796 · Bug 804 · Bug 826 —— 声明采集
**丢实体 / 元数错位 / 可构造性未知**（收割面）。

**Bug 793** — 顶层 `declare namespace` 的**运行时成员被摊平进 globals** ⇒
harvester **凭空造出全局**（`declare namespace Foo { function bar() {} }` ⇒
globals 里多出一个不存在的 `bar`）⇒ 并**抑制**了对应的 ReferenceError 诊断
（裸 `bar()` 被当成有定义；`tsc --strict` 对同一份代码报 TS2304）。

- `harvest-dts.ts` 的 `collectStatement`：`namespace` 分支改为把运行时成员收进
  **命名空间自有的记录**（`Scope.nsRec`），并挂一个命名空间对象 `Foo`（成员在
  `Foo.bar` 面）⇒ **不摊平**进 globals。
- `recordFor` 命中 `scope.nsRec` ⇒ 命名空间成员落在自己的记录里；`scopeKey`
  把命名空间链计入作用域键 ⇒ 两个命名空间的同名成员不会被当成 overload 合并。
- 只有类型（interface / type）的命名空间**不产生**运行时对象 ⇒
  `declare namespace _ { interface X {} }` 不会凭空多出一个全局 `_`。
- 模块作用域（`declare module "x" { namespace Y { … } }`）保持既有口径
  （成员摊平进模块记录）：`export = ns` 的模块（@types/node 的 path / fs）
  正是这个形态。

**Bug 794** — `this` 形参被当**普通形参**收割 ⇒ **元数错位**（arity +1，
第一个真实实参被绑到 `this` 槽）+ 契约草稿凭空多一个必填参数。

- `harvest-dts.ts` 的 `signatureToFnSig` 跳过 `this` 形参（TS 把它建模成
  名字为 `this` 的普通 ParameterDeclaration，不显式跳过就与真形参无法区分）。
- `classValueAbs` 的构造器参数同口径（跳过 `this` 形参）。
- 草稿面（`dts-contract-draft.ts`）不在本片区间：对应改法见交付报告。

**Bug 796** — `declare class` 的**实例成员整体丢失**（`declare class` 的
`instanceFor` 拿到空壳 ⇒ 展开成空 obj）+ `const p: Point` 这个**绑定从
globals 彻底消失**。

- `harvest-dts.ts` 的 `interfaceDeclsOf` 放宽为「interface **或** class」
  （成员收集器本来就写好了类支持，只是被一道 `isInterfaceDeclaration` 过滤
  挡在门外）；返回类型随之放宽为 `NamedTypeDecl[]`。
- `registerTypeDecl` 对 class 也登记**限定名**（命名空间里的 class
  `NodeJS.Process` 的实例面可解析）。

**Bug 804** — 映射类型 / 模板字面量类型 / 索引访问类型（以及 `keyof` /
`typeof`）落 `unknown` 后，**`declare const` 整条绑定被丢弃** ⇒ 用户代码引用
它时被判「**确定抛 ReferenceError**」（L2 假红；`tsc --strict` exit 0）。

- `harvest-dts.ts` 的 `materialize` var 分支：类型判不出时**保留绑定**（值为
  `unknown`）——「类型未建模」是**降级**（值域未知），不是「符号不存在」⇒
  不再计入 `skipped`（丢了才计入）。

**Bug 826** — 收割的 **`declare class` 类值没有 `ctor` facet** ⇒ `new X()`
被判「**可能抛 TypeError**（可构造性未知）」⇒ L2 假红。

- `harvest-dts.ts` 的 `classValueAbs`：类值走 `absCtorSig`（带 `ctor: true`
  facet）—— core 的 `new` 路径按 callee 的 `ctor` facet 判可构造性。
- `harvest-to-abs.ts` 的 `harvestedValueToAbs`：mock 化时**透传** `ctor`
  facet（否则又变回「可构造性未知」）。
