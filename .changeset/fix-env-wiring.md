---
"@nudojs/core": patch
"@nudojs/env": patch
"@nudojs/service": patch
---

族 29 主 agent 收口：跨分片组合出来的 4 个缺口。

- **Bug 884（web 侧）**：`web.ts` 的 `structuredClone` 声明已删（node 侧同款
  修法在 `node.ts`）⇒ 回落宿主内建 ⇒ 不可克隆值的 throws 面（宿主
  `DOMException` / `DataCloneError`）不再被 env 声明整段吃掉 ⇒ L2 门禁恢复。
- **`enforceArgs` 的并集实参过严**（S3 越界发现，主 agent 修正）：实参是**并集**
  （如 `string | undefined`）时，`leqAbs(sum, pt)` 整体判 false ⇒ 旧实现把它
  当「确定不符 ⇒ 必抛 TypeError」，而原生只在 `undefined` 分支抛 ⇒ 可能假红。
  现在**逐成员**判定：只有**全部分支**都不兼容才判必抛，部分分支不兼容判
  may-throw ⇒ 与原生同口径。
- **Bug 886 / 889 的组合缺口**（S1 删声明 + S5 覆盖推导撞出来的）：web env 的
  `TextDecoder` 声明已删（宿主才有精确的 `RangeError` 与「类不可裸调」语义），
  但 core 的**构造面** `evalBuiltinNew` 不认 `TextDecoder` ⇒
  ① `nudo test` 报「Built-in API "TextDecoder" is not covered by Nudo's type
  inference」（假阳）；② Abs 面与 `$new` 宿主面口径分裂。现在
  `evalBuiltinNew` 补 `case "TextDecoder"` ⇒ 两侧同 builder
  （`makeTextDecoderAbs`），假阳消失。
- **「已被覆盖」判定里的手写例外已删**（族 29 Bug 865 的根因收口）：core 其实
  已精确建模 `WeakRef`（`evalBuiltinNew` 的 `case "WeakRef"`），但三条既有
  service 契约把 `WeakRef` 当作「未被覆盖的全局」样例钉住，于是判定里留了
  一张手写例外表——那正是 Bug 865 要消灭的「手写白名单」换了个地方继续写。
  现在例外表删除，三条契约的**样例全局**换成真正未被建模的宿主全局
  `Atomics`（core 无 `Atomics` 建模面；它是 `globalThis` 里的数据属性 ⇒
  不触发访问器副作用），契约的**意图**（未建模全局要报 `builtin-unknown`、
  且不与 `unknown-global` 双报）完全保留。
