---
"@nudojs/core": patch
---

fix(core): 宿主函数面的 `constructor` 与普通对象的**符号键槽寻址**（族 57）

族 57 的 8 条容器 / Proxy / 符号键精度债，本片（core · `exec/runtime/containers/**`）
落了**两条修法**（其余六条已是原生或修法落在别的分片，见下）：

- **Bug 234 · 宿主函数面 / 命名空间面的 `constructor`**
  （`packages/core/src/algebra/exec/runtime/containers/member.ts`）：
  此前 `f.constructor` / `g.constructor` 落 `unknown`（宿主函数面**没有**
  `constructor` 臂），`Number.constructor` / `Math.constructor` 落通用成员读
  （抽象 fn 面 ⇒ `.name` 是抽象串）。现在按**宿主真值**取构造器名
  （`hostCtorNameOf`）：普通函数 → `Function`、生成器 → `GeneratorFunction`、
  async → `AsyncFunction`（转译后声明是宿主普通函数 ⇒ 种类读 Bug 325 的
  `fnKind` 戳，不猜）、`Number` → `Function`、`Math` / `JSON` → `Object`
  ⇒ `f.constructor === Function` 折 `true`、`.name` 折精确串。
- **外-02 ① · 普通对象面的符号键槽寻址**
  （`packages/core/src/algebra/exec/runtime/containers/arr-index.ts` +
  新增 `containers/symbol-slot.ts`）：`propertyKeyOf` 对 symbol 返 undefined
  ⇒ 符号键**写被丢弃**（对象标 open）、**读落抽象下标投影**（`unknown`）。
  现在符号键有内部槽键通道：well-known 符号 → `"@@X"`（与转译侧静态投影
  同源），用户符号 → `"@@sym#<身份 id>"`（`Symbol("x")` 每次是新符号 ⇒ 每次
  新 id；`Symbol.for("x")` 是驻留符号 ⇒ 同一 id，同键）⇒
  `const s = Symbol("x"); const o = {}; o[s] = 1; o[s]` 折 `1`（原生同款），
  且符号槽带 `symbolKey` 标记 ⇒ 字符串枚举面不可见（Bug 73 口径）。

**口径与边界**：

- sound 优先：所有新读面在「键不可判」时仍折 `unknown` / `undefined`，
  不把「判不准」升级成确定值；Proxy 面按规范把**真 symbol** 传给陷阱
  （Bug 149），不走槽寻址。
- 本片**未**动的两处（修法落在别的分片的文件范围，已在报告里给出精确改点）：
  `in` / `delete` 的符号键通道（`exec/runtime/members.ts`）与
  `mk().x += 2` 的复合赋值（`exec/transpile/expr/assignment.ts`）。
- 公共 API 冻结面零变更（无新增导出）。
