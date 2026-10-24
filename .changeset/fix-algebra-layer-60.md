---
"@nudojs/core": patch
---

fix(core): 族 60 · core 代数层 5 条精度债——rest 形参元数信息 + 复合关系守卫（片 W10）

族 60 的 5 条 core 代数层精度债，本片（core · `algebra/**`）落**两条新修法**，
另两条**已在 HEAD 修好**（本片补钉锁住，**不改源码**），第 5 条**只报告**
（正解必然新增公共导出 ⇒ 触及公共 API 冻结面 ⇒ 本片不擅自新增）。

**1) S6-1008 · rest 形参的元数信息在 core 层可读**（新修）

`packages/core/src/algebra/param-surface.ts`：`FormalParam` 的 rest 变体此前
只有 `kind: "rest"` + `optional: true` ⇒ **元数信息缺失** ⇒ 「真正变长」只能由
每个消费方各自按名字后缀（`...x` / `x?`）重猜一遍。现在 rest 形参带
`arity: { min, variadic: true }`：`min` = **必选元数**（rest 之前**必选**形参的
个数；默认形参 / 带默认值的解构形参可省略 ⇒ 不计；TS 的 `this` 接收者标注不是
形参 ⇒ 不计）、`variadic` = **变长**（rest 吸收 0..n 个实参 ⇒ 元数无上界）。

**2) 复合测试接关系守卫**（新修）

`packages/core/src/algebra/arithmetic/cmp.ts`（新增 `matchRelIdentLitComposite`）
+ `exec/transpile/stmt-predicates.ts` + `exec/transpile/stmt/fn-body.ts`：
关系守卫此前只认**单一**关系式（`x > 0`）⇒ 复合测试（`x > 0 && x < 10`）**不接**
任何守卫 ⇒ 事实臂里的裸 `return x` 丢守卫界 ⇒ `@nudo:contract return
number().gt(0)` 判「证不出」（**与语义等价的单关系写法结论相反** ⇒ L1 门禁口径
分裂）。

现在合取（`&&`）的**每一个**同变量合取项界都接进事实臂（`x > 0 && x < 10` ⇒ 事实臂
同时持有 `x > 0` 与 `x < 10`）：合取为真 ⇒ 每一合取项为真 ⇒ 事实臂可靠。

**sound 护栏（关键）**：`¬(A ∧ B)` = `¬A ∨ ¬B` —— **不是**单一关系 ⇒ 复合守卫
**只**用于事实臂；**补集方向**（后续路径 / else 臂）在 `narrowRelComplementArmThunk`
处**整体跳过**（守卫带 `composite: true` 标记）⇒ 不会在「测试为假」的路径上断言
`¬A`（**假绿**）。析取（`||`）**不**接（合取才蕴含）。只接**一个**界会在契约朝
**另一**方向时把「证不出」变成「证反了」（假红）⇒ 同名多界**一并**接上。

**已在 HEAD 修好、本片只补钉锁住（不改源码）**：

- **族 21 遗留 · `buildArgsFromAssume` 写死 `x > 0`**：族 08（Bug 976）已改成
  「用户声明的界落进形参自己的 pred」——无界时**不写界**（不替用户发明更强的默认
  界）。本片补钉锁住两条口径（用户界落位 + 无界不写）。
- **S11-534 · core 字面量渲染 bigint 不可分**：族 06（Bug 361）/ 族 20（Bug 1065）
  已让 `lit(10n)` 与 `lit(10)` **可分**（bigint 保 `n` 后缀），且 `-0` 保符号。
  本片补钉锁住「数字字面量渲染**逐字不变**」的负控。

**只报告不擅自改（第 5 条）**：`absShapeForTsTypeText`（TS 声明类型文本 → Abs
形状）在 core 内部可用，但**未**进公共面 ⇒ service 的 dts 产物面拿不到它。正解
必然**新增公共导出** ⇒ 触及公共 API 冻结面 ⇒ 本片**不**擅自新增，**留给主 agent
拍板**（可行替代：service 侧复用 core 的既有公共导出；或把工具挪到 service 侧并
删 core 重复实现——后者超出本片范围）。

**口径**：公共 API 冻结面**零变更**（core 四张表无新增导出；`FormalParam` 只加
**可选字段** `arity?`，既有导出签名不动）；本片**未**动 service / env / lsp /
nudojs / harvester。
