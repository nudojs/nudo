---
"@nudojs/core": patch
---

fix(core): 描述符 / 生成器协议面 / 任意 brand 的 `.length` 槽（族 58 · core runtime）

5 条精度债（族 58 台账 · W8 分片）——全部**对拍原生**（node v26.10.0 宿主实测），
新增回归钉 `packages/core/src/algebra/__tests__/eval-bug-58-descriptor-generator-proto.test.ts`（34 例）。

- **Bug 197 · 描述符 exists 分支的 `writable:true` 重定义**：台账记「`writable:true`
  的重定义不覆盖旧的 `[[Writable]]`」——**该缺陷在 HEAD 已被修掉**（Bug 292 的
  双向标志表工作：描述符的显式字段**覆盖**当前值），普通对象路径已逐字对齐原生
  （重定义后 `Object.getOwnPropertyDescriptor(o,"x").writable === true`）。本片
  **补上残留面**：**原型对象**（`X.prototype`）上 `defineProperty` 装的自有数据槽
  在 **gOPD 读面**此前落「descriptor | undefined」并 ⇒ 读 `.writable` 即**定抛
  TypeError**（wrong-**throw**：原生恒有描述符）⇒ 现在读面折**精确描述符**
  （值 + writable/enumerable/configurable 三标志），「重定义后读出新的 writable」
  在对象面与原型面**都成立**。
- **Bug 321 · 原型 brand 描述符面**：`Object.getOwnPropertyNames(Error.prototype)`
  此前折保守 `string[]`、`Object.hasOwn(Error.prototype, "name")` 此前折保守
  boolean ⇒ 现在对**引擎已建模成员**的原型（Error 家族）折**精确**：
  gOPN(Error.prototype) = `["constructor","name","message","toString"]`、
  gOPN(TypeError.prototype) = `["constructor","name","message"]`（`toString` 是
  **继承**的，不入自有键）、`Object.hasOwn(..., "name"/"message"/"toString")` 折
  **true**、表外键折 **false**、`Object.keys(Error.prototype)` 折**精确空元组**。
- **类原型的 gOPN / keys 面**：类原型的 `Object.getOwnPropertyNames` 此前折保守
  `string[]` ⇒ 现在对**引擎已建模成员**的类原型折**精确清单**
  （`["constructor", ...自有方法/访问器]`），`Object.keys(类原型)` 折**精确空元组**
  （原生：类成员全不可枚举），`Object.hasOwn(类原型, ...)` 折确定 boolean。
  **口径边界（诚实写明）**：只覆盖引擎已建模成员者——其余原型（Array/Object/Map…）
  仍走既有保守域 `string[]`（**不扩 Abs 形状**：扩形状是 A 类架构债）；类原型
  的**方法与访问器交错定义序**在引擎的类注册表里不可复原（methods / accessors 分
  两张表）⇒ 两者同时存在时仍给保守域。
- **生成器 `prototype.next` 协议面**：`g.prototype.next` 此前折 **exact undefined**
  （wrong-exact；原生是函数）⇒ 现在 `%GeneratorPrototype%` 的三个协议方法
  （next / return / throw）都可读（`typeof === "function"`），且**借用调用**按接收者
  派发（`g.prototype.next.call(it)` 真的推进该生成器 ⇒ 与 `it.next()` 同款语义）；
  无接收者调用原生定抛 TypeError ⇒ 引擎同抛（此前折 unknown 且**不记 may-throw**
  ⇒ L2 门禁假绿）。协议槽标 **internal**——原生该方法在**原型链**上而非原型对象
  的自有键 ⇒ 自有面（hasOwnProperty / gOPN / 枚举）不可见（`gOPN(g.prototype)`
  精确空元组，与原生 `[]` 一致）。
- **`.length` slot 在任意 brand 上不可读**：core 的 `$len` 此前只认 String /
  TypedArray 家族 / Arguments / Proxy 几个品牌 ⇒ 其余 brand（含 env 声明面建模的
  Buffer 实例）一律折 **unknown**，`buf.length` 拿不到 ⇒ 现在 `$len` 读**任意 brand
  内层 obj 的非可选 `"length"` 槽**（与 `$get` 品牌内层槽读**同口径** ⇒
  `buf.length` 与 `buf["length"]` 一致）；无该槽的 brand 仍折 unknown。

**附带（族 57 第 6 条 ② 的闭合点 · 主 agent 追加）**：普通对象面的符号键
**`in` / `delete`** 槽寻址此前只认 well-known 符号 ⇒ 用户符号的 `s in o` 折
boolean 域（原生 true）、well-known 符号的 `delete o[Symbol.iterator]` 不删槽
（原生 false）⇒ 现在 `$in` / `$del` 的槽键统一走 `symbolSlotKeyOf`
（well-known → `"@@X"`；用户符号 → `"@@sym#<身份 id>"`，`Symbol("x")` 每次新 id、
`Symbol.for("x")` 驻留同 id，**不按 description**——description 可撞会串键）。
裸字符串键 / 数字键 / 未定义键三类输入**不崩**且行为与改前**逐字一致**
（`isSymbolAbs` / `symbolSlotKeyOf` 先判「是不是 Abs」再取 shape）。

**已知偏差（诚实写明）**：
- 未建模成员的原型的 gOPN / hasOwn 仍走既有保守域（`string[]` / boolean 域）——
  扩到全体原型需要**扩 Abs 形状**承载原型自有键集 ⇒ 归 A 类架构债，本片不做。
- 类原型的方法/访问器**交错**定义序不可复原 ⇒ 该形态仍走保守域。
- 生成器协议面的**函数身份**面（`g.prototype.next === it.next` 原生 true）仍
  折 false（引擎的协议方法值与实例内部槽是**两个**函数对象）——本次只修「可读 +
  可调 + 借用调用按接收者派发」。
