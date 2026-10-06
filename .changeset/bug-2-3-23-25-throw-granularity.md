---
"@nudojs/core": patch
---

fix(core): throws 域判定与值域计算粒度一致（Bug 2/3/23/25）—— L2 门（nudo:entry-may-throw）假阳性消除，守卫已证不抛的代码不再记 may-throw TypeError：

- **Bug 2**：早退提升路径（transpileFnBodyStmts）补守卫剪影——`if (p === null) return -1;` 后接非终结尾句（中间绑定/副作用语句）时，尾句在 fork 假值臂内执行，`p` 以剪除 null 后的版本影子重绑，`p.major` 不再撞未剪 null 臂记假 may-throw（与 IfStatement 路径同源；issue #97 五变体不回归）。
- **Bug 3**：nullish 守卫白名单扩展 + 剪除粒度——识别复合 `p === null || p === undefined`（否定臂剪 nullish）与 `typeof u === "undefined"`（假值臂只剪 undefined，`typeof null === "object"` 不误剪 null）；严格 `p === null`/`p === undefined` 按字面量粒度剪（`null === undefined` 为 false，严格等价只排除该字面量——同时修掉「假值臂连 undefined/null 一起剪」的既有假阴性）；`&&`/`||`/三元表达式面同享。
- **Bug 23**：新增 typeof 类型守卫剪枝（typeGuardOf + $narrowTypeOf）——`typeof v === "string"` 真臂把 v 影子重绑为 union 中 typeof 匹配成员、假臂绑补集（不可判成员保守保留）；守卫臂内 `+`/关系/for-of/spread/解构/模板串拿到成员类型，七面（addStr/relStr/forOfStr/spreadStr/destrStr/tmplStr/addNum）零假 L2，`typeof v === "number"` 臂不再产不可能的 string 值臂。
- **Bug 25**：isMaybeBigintOperand（arithmetic/surface 两处）对 sum 成员感知——纯 prim union（number|string）绝不可能是 Symbol/bigint，`v > "a"` 类关系运算不再记假 may-throw；obj/fn/brand/any 成员保持原子（对象经 @@toPrimitive 确可返 Symbol），unknown 豁免口径不变。

回归红线：真实可抛路径不剪（严格守卫假值臂的 undefined/null 成员保留并照常报 L2；any 入口守卫后仍诚实 may-throw；unknown 令牌口径不变）；check-gold / check-recall-gold / check-real-packages 全绿。
