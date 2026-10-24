---
"@nudojs/core": patch
---

fix(core): 族 65 · core 剩余 6 条精度债收口（BC #28 / #44 / #45 + 族 62 的 3 条）

本片收掉 core 侧最后 6 条精度债（台账 `#28` / `#44` / `#45` + 族 62 的
`Intl.Collator` / `cause` 继承槽 / 类型化数组元素值），全部**对拍 node
v26.10.0 原生**后落码：

- **BC #44 · `Object.getOwnPropertySymbols` 的自有 symbol 键面**
  （`builtins/object/methods.ts`）：引擎把 symbol 键投影成 `"@@X"` 槽
  （`Slot.symbolKey` 标记）⇒ **闭**对象的自有 symbol 键集可精确列举 ⇒ 折
  精确元组；原生 `[]` 的目标（普通对象 / 数组 / 字符串 / 数字 / 函数 /
  Error 实例 / TA 实例 / **生成器对象**）不再折保守 `symbol[]`；宿主命名
  空间对象（Math / JSON / Intl / Reflect）折 1 个 symbol 键
  （原生 `[Symbol.toStringTag]`）。键集**不可判**（开放 obj / 抽象 brand /
  arr / 原型 brand / Proxy / any / unknown / sum）⇒ **仍**保守 `symbol[]`
  （不折空——空是自信的确切错值）。
- **BC #45 · 生成器身份面**（`exec/runtime/async.ts`）：同步生成器补
  `@@toStringTag = "Generator"` ⇒ `Object.prototype.toString.call(g())`
  原生同款 `"[object Generator]"`（此前折 `"[object Object]"`——自信的错
  值）。槽仍 internal + symbolKey ⇒ 自有面 / 枚举面 / gOPS 面不可见
  （原生生成器对象无任何自有可枚举属性）。**不扩 Abs 形状**：生成器对象
  仍是闭 obj ⇒ 「类型投影面与空对象同形」这一条**未**收口（根治需
  `makeGenObject` 改 `brand("Generator")` ⇒ A 类架构债，已登记为
  `docs/design/architecture-debt.md` 的 **A11**）。
- **BC #28 · try/catch 与控制流信号**（`exec/transpile/stmt/fn-body.ts` ·
  `stmt/statement.ts` · `transpile/types.ts`）：台账记的 `try { break; } catch {}`
  在 HEAD **已不复现**（族 02 的 Bug 211 已让 `$catchVal` 透传
  `NudoLoopSignal`）；本片收掉的是**同族仍在的既有缺口**——try / catch /
  finally **块体**里的早退提升（`if (c) return X;` + 后续语句）此前把
  「块内**后续路径**的值」当成函数返回值抛出 ⇒
  `try { if (0) return 42; n++; } catch (e) {} return n;` 原生 `1`、引擎折
  `undefined`（自信的错值）。修法：早退臂置标志 + 后续路径内的 `return` 走
  `$loopReturn` 信号 ⇒ **只有早退真的发生**才早退；块完成 ≠ 函数尾由新增的
  `inCtrlBlock` 位表达（catch / finally 体此前落「返回值」协议）。
- **族 62 ① · `Intl.Collator` 实例面**（`exec/runtime/members.ts`）：
  `BUILTIN_BRAND_METHODS` 补 `"Intl.Collator"`（`compare` /
  `resolvedOptions`）⇒ `typeof new Intl.Collator().compare` 折精确
  `"function"`（此前是 unknown 域）。
- **族 62 ③ · Error 的 `cause` 继承槽**（`builtins/error/error-family.ts`）：
  原生 InstallErrorCause 走 `HasProperty(options, "cause")`——**含原型链**
  ⇒ `new Error("m", Object.create({cause: 1})).cause` 原生是 `1`，此前引擎
  读出**精确 undefined**（「确定不存在」——自信的错值）。修法：键集不可判
  （开放 obj / 原型链开放 / 抽象 options）时装**值为 unknown 的 cause 槽**
  （读出「有槽但不知道值」）；原型链上**确有** cause 键时（存在性确定）装
  同款 unknown 值槽 ⇒ `in` / `hasOwn` / gOPN 面与原生同（确定含
  `"cause"`）。闭 obj 无 cause 键 ⇒ 仍**不装**槽（原生同）。
- **族 62 ④ · 类型化数组的元素**值**面**（`builtins/error/binary.ts` ·
  `exec/runtime/containers/arr-index.ts` · `containers/member.ts`）：闭 tuple
  源逐元素过 ToNumber / ToBigInt + 家族取值转换（整数 TA 的模 2^n 回绕、
  向零截断、Float32 的 `fround` 舍入、Uint8Clamp）⇒ 值入索引槽 ⇒
  `new Int8Array(["3"])[0]` 折 `3`（原生同；此前是 `number | undefined`）。
  值不可判的源（对象源的 `valueOf` 回调 / 抽象域 / 长度形态）**不入槽**
  ⇒ 读面仍回落「元素域 ∪ undefined」（不假精确）。

新钉 `packages/core/src/algebra/__tests__/eval-bug-65-core-remaining.test.ts`
（23 例：6 条各 ≥1 例 + 负控，逐条对拍原生）。既有金标**只加强不弱化**：
`eval-object-json-w9.test.ts` 的 gOPS 断言（保守 `symbol[]` → 精确元组
+ 抽象接收者仍保守）、`eval-bug-332-intl-collator-shape.test.ts` 与
`packages/env/src/__tests__/env-bug-62-es-web-surface.test.ts` 的
`it.fails` 旗标（族 62 的 3 条）均已摘旗转正。
