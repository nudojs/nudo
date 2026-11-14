# NaN 感知的契约词汇与关系补集累积

> **状态**：**已实施**（2026-11-14）。`.finite()` + 运行时 `$refineRelComplement`
> 已落地，验收见 §6；残余与边界见 §7。
> **需求锚点**：[issue #185](https://github.com/nudojs/nudo/issues/185)（顺序早退 / De Morgan
> 两种拼写的 `add6` 仍 unproven）。已交付的 `86bc56e1` 只放开了**可健全证明**的合取形态，
> 负控见 `packages/core/src/algebra/__tests__/check-guard-conjunction-185.test.ts:109-124`。
> **实施锚点**：`constraint.ts`（builder）、`exec/runtime/narrow.ts`（`$refineRelComplement`）、
> `exec/transpile/stmt/predicates.ts`（事实集）、`scan/literal-preds.ts` + `scan/literal-shapes.ts`
> （字面前置）、`env/src/es.ts`（`NaN` / `±Infinity` 字面量化）；回归
> `check-guard-finite-185.test.ts`（12 例）。
> **真源**：契约文法 → `refine.ts` / `constraint.ts`；Pred 代数 → `pred.ts`；
> 守卫事实 → `exec/transpile/stmt/predicates.ts`、`arithmetic/cmp.ts`。

---

## 1. 问题

`add6(x, y)` 的契约是 `number()`，守卫式写法：

```js
if (x < 1) return 3;
if (y < 2) return 3;
return x + y;   // 契约 ge(3)
```

引擎在 fall-through 路径上**不能**断言 `x ≥ 1 ∧ y ≥ 2`。原因不是区间机器不会算
（嵌套 if 能证），而是**补集断言对 NaN 不成立**：

| 拼写 | 无 finite 证据 | `.finite()` / 数值界证据后 | 原因 |
|---|---|---|---|
| `if (x >= 1 && y >= 2) return x + y;`（合取事实臂） | 证得 | 证得 | 合取为真 ⇒ 每项为真，NaN 不可达 |
| `if (x < 1) return 3; … return x + y;` | unproven | **证得** | 补集 `x ≥ 1` 在非 NaN 证据下健全；无证据仍 unproven |
| `if (x < 1 \|\| y < 2) return 3; …`（De Morgan） | unproven | **证得** | `¬(A ∨ B) = ¬A ∧ ¬B`，逐项取补集 |
| `if (!(x < 1 && y < 2)) return 3; …`（否定合取臂） | 证得 | 证得 | 布尔取反精确；`!(A ∧ B)` 为假 ⇒ 合取为真 |

`predicates.ts::relGuardOfNegation` 的注释把这条钉死了：`¬(x < k)` 只断得
`x ≥ k ∨ x is NaN`（Bug 1115），**不得**当 `x ≥ k` 用。要把这两行从 unproven
翻成 proved，缺的不是推理能力，而是一个**用户可写的「非 NaN」证据**。

## 2. 机制与落点

| 机制 | 位置 | 现状 |
|---|---|---|
| `assumeFinite(t)` Pred | `pred.ts:132`、`pred.ts:153` | 已有一等谓词：`t` 是有限数（非 NaN/±Inf），开启线性环化简 |
| 非 NaN 判定 | `arithmetic/bounds.ts::isNonNaN` | 已消费字面量 / `sum` 成员 / 数值界 / `ne(t, NaN)` / `assumeFinite` |
| 守卫事实累积 | `exec/transpile/stmt/predicates.ts` | 合取（`others`）+ 否定臂 + **补集事实集**（`relGuardComplementFactsOf`，支持 `\|\|` 逐项）+ **NaN 守卫**（`nanGuardOf`：`Number.isNaN(x)` / `Number.isFinite(x)` / `x === x` / `x !== x` / `!`）+ **const 别名**（`const ok = Number.isNaN(x); if (!ok)`） |
| 关系补集 | `exec/runtime/narrow.ts::$refineRelComplement` | **已实施**：`isNonNaN(a, currentExecPhi())` 门（绑定 pred ∪ 臂 Φ）+ `REL_COMPLEMENT_OPS` 单源映射；`$refineNotNaN` 生产 `ne(x, NaN)` |
| 契约 builder | `constraint.ts` | `number().finite()`（+ `gt/ge/lt/le/int/min/max/length/shift/optional/at`） |

## 3. 实现

### 3.1 契约词汇：`number().finite()`

- 链式方法 `.finite()` 追加 `assumeFinite(selfTerm())`，语义 = `Number.isFinite`
  （排除 `NaN` 与 `±Infinity`）；展示沿用 `pred.ts::predToString` 的
  `assumeFinite(x)`，错误面文案在实施时按 `actual ⊭ expected` 复核（不新造展示层）。
- 纯数据形态（侧车 JSON / `@nudo:contract` 模板求值产物）用同义 Pred 表示，
  不新增 `NudoConstraint` 字段；`toPlainConstraint` 与 `absToSchemaSource` 按既有
  Pred 投影处理（schema 面仍写 `z.number()`，有限性属于运行期精化）。
- **不新增 `op`**：复用 `assumeFinite`，因此 `absKey` / `generalize-key` /
  `summary-bounds` / `hof` 的逐 op 分派已就绪，无 schema 迁移。

### 3.2 关系补集：只在非 NaN 证据下断言

补集事实由**运行时**判定，不在转译器里做（转译器只看语法，看不到 Abs）：

```text
¬(x < k)  ∧  isNonNaN(x, phi)  ⇒  x ≥ k
¬(x ≤ k)  ∧  isNonNaN(x, phi)  ⇒  x > k
¬(x > k)  ∧  isNonNaN(x, phi)  ⇒  x ≤ k
¬(x ≥ k)  ∧  isNonNaN(x, phi)  ⇒  x < k
```

- 落点 = `exec/runtime/narrow.ts::$refineRelComplement(a, op, k)`：拿到当前
  `Abs`，先 `isNonNaN(a, currentExecPhi())` 判定（绑定 pred：契约 `.finite()` /
  数值界 / `ne(x, NaN)`；臂 Φ：`$fork` 压入的 `x === x` 等事实），成立才按
  `REL_COMPLEMENT_OPS[op]` 挂界，否则**原样返回**（fail-closed）。
- 转译器只在 fall-through / else 臂发射该调用（与 `$refineRel` 的事实臂对称），
  不自行决定是否收紧；`A \|\| B` 形态由 `relGuardComplementFactsOf` 逐项收集，
  合取（`composite`）不收集（`¬(A ∧ B)` 是析取）。
- `isNonNaN` 已经是「字面量 / 数值界 / `ne(t, NaN)` / `assumeFinite`」的单一判据
  （`bounds.ts:214`），直接复用，不另造谓词。数值界自身排除 NaN
  （`NaN < k` 为假），所以 `number().ge(0)` 这类既有契约会自动获得补集能力；
  `number()`（无界）则必须显式 `.finite()`。
- `±Infinity` 不属于此门禁的问题面：`Infinity ≥ k` 为真，补集**事实**仍然成立；
  需要排除 ±Inf 的是具体契约（如 `le(100)`），由既有数值界负责。
- 否定臂（`!(A ∧ B)` 为假 ⇒ 合取为真）**不经过**此门禁：布尔取反精确，NaN 无关
  ——已交付的 `narrowRelNegationArmThunk` 保持原样。

### 3.3 影响 seam（按实施顺序）

1. `constraint.ts`：`ConstraintBuilder` 增 `.finite()`；`toPlainConstraint` /
   `derefConstraint` 透传。
2. 约束 → entry Abs / Pred：`constraint.ts::constraintToEntryAbs` 与 `derefConstraint`
   把 builder 的 `preds` 原样注入，无需特判（`assumeFinite` 已是 Pred 联合成员）。
3. `predicates.ts`：fall-through / else 臂发射 `$refineRelComplement`（或
   `negated` 形式）；语法层只决定**在哪一侧**发射，不决定是否收紧。
4. `exec/runtime/narrow.ts`：补集入口按 `isNonNaN(a, currentExecPhi())`
   fail-closed；`$refineNotNaN` 给 NaN 守卫的非 NaN 臂挂 `ne(x, NaN)`。
5. `cmp.ts`：`implies` 的补集规则**保持现状**（它没有 Abs 上下文，不能看到
   `assumeFinite`）；补集只发生在运行时事实臂。
6. 诊断/展示：`check-report.ts` 的 `assumeFinite` 分支已有格式化，确认
   `number().finite()` 的错误面文案（`actual ⊭ expected`）可读。

## 4. 不变量

- 不放松 Bug 1115：缺少非 NaN 证据时，补集**不得**断言（现有负控逐条保留）。
- `leqAbs` 不接受集不变；不新增 Shape 判别成员；`formatShape` 不变。
- `.finite()` 是**契约侧**词汇，不是 `any()`/`unknown` 的替代；入口无约束参数仍显示 `any`。
- 不给 `unknown` 参数自动加 finite 假设（fail-closed）。
- `Number` 被用户遮蔽（形参 / 声明 / mock 注入）时**不得**把
  `Number.isNaN(x)` 当内建 ⇒ 不产出 `ne(x, NaN)` 事实（`shadowedIntrinsics`
  现在跟踪 `Number`；源码门禁钉住）。

## 5. 语义边界（诚实声明）

| 形态 | 结果 |
|---|---|
| `number().finite()` + `¬(x < 1)` ⇒ `x ≥ 1` | 是（`$refineRelComplement`） |
| `number()`（无 `.finite()`）+ 同上 | 否（NaN 可达，保持 unproven / 可证伪） |
| `number().ge(0)` + `¬(x < 1)` | 是（数值界已排除 NaN） |
| 字面量 `NaN` / `+Infinity` / `Number.NaN` 实参 + `.finite()` | 契约违反（`judgeLiteralPred` + env 字面量化） |
| `if (Number.isNaN(x)) return …;` / `if (x !== x) return …;` 的后续路径 | `ne(x, NaN)`（`$refineNotNaN`） |
| `if (x === x)` / `if (!Number.isNaN(x))` 的真臂 | `ne(x, NaN)` |
| `const ok = x === x; if (ok) …` | Φ 提供 `eq(x, x)` ⇒ 非 NaN 证据（无需绑定 pred） |
| `if (Number.isFinite(x)) { … }` | 真臂 `ne(x, NaN)`（单边事实；取反不可用） |
| `const ok = Number.isNaN(x); if (!ok) …` / `const ok = !Number.isNaN(x); if (ok) …` | 别名解析后挂 `ne(x, NaN)`（`const` 才登记） |
| `const ok = Number.isFinite(x); if (ok) …` | 真臂 `ne(x, NaN)`；`if (!ok)` 不成立（单边） |
| `add6(1, 2)` | 精确 `3` |
| `number().finite()` 参数 ⇒ 返回值也有限 | **否**：有限数相加可溢出到 `±Infinity`；返回位需单独的 `.finite()` / 数值界契约（`add6` 的 `ge(3)` 不受影响） |
| 非字面量实参（`any` / 未知全局） | 调用点不猜（既有边界：`judgeLiteralPred` 三值判定） |
| `.int()` | 已隐含有限（整数），不新增语义 |

## 6. 验收（已通过，2026-11-14）

- **#185 矩阵**：顺序早退 / De Morgan / 三元 else 在 `number().finite()` 下转 proved；
  无 `.finite()` 时负控保持逐字 unproven（`check-guard-conjunction-185.test.ts`
  现有断言未改宽）。
- **NaN 守卫**：`Number.isNaN(x)` / `x !== x` 早退；内联 `!Number.isNaN(x)` /
  `x === x` 真臂；`const ok = x === x; if (ok)` 经 Φ——均把 `ne(x, NaN)` 接入补集。
- **遮蔽门禁**：`function f(Number, x)` / 局部 `const Number = …` 时转译产物
  不含 `$refineNotNaN(x)` 调用（传输层 `shadowedIntrinsics` 跟踪 `Number`）。
- **NaN 反例**：`0/0`（NaN）/ `1/0`（Infinity）在 `.finite()` 契约下报
  `nudo:constraint-violated`；`f(1)` 放行（`check-guard-finite-185.test.ts`）。
- 金标：`check-recall-gold` + `check-real-packages` + `check-real-commander`
  **3 文件 / 200 用例通过**（1 expected fail 照旧）。
- 未使用 `.finite()` 的既有侧车输出与断言逐字不变（`--changed` 套件）。
- 回归：`check-guard-finite-185.test.ts`（25 例：首创/负控/数值界/builder/运行时门/NaN 守卫/Φ/别名/单边事实）。
- changeset：`@nudojs/core` minor（新增 builder 方法）+ `@nudojs/env` patch
  （`NaN` / `±Infinity` 字面量化）。

## 7. 残余与未决

1. **别名边界**：只支持**函数体本层**的 `const` 别名（`const ok =
   Number.isNaN(x)`）；`let` / `var` 别名不登记（可被改写），模块顶层
   `const` 暂不登记（模块体不经 `transpileFnBodyStmts`，无顺序别名链）。
   被守卫变量在本层有任何自由写（含嵌套闭包写）即不登记；同名声明删除
   别名；函数 / 方法体边界清空（形参可同名遮蔽）。
2. **非早退 fall-through 未覆盖**：`if (x < 1) { log(); }` 之后继续执行的语句
   没有臂 thunk 可挂补集。把剩余语句包成 thunk 可避免复制，但会改变 `var` /
   函数声明提升与生成器 `yield` 的作用域（REST 出现在两个臂 ⇒ 复制则有指数
   膨胀风险）⇒ 暂不做，保持现状。
3. **命名**：采用 `.finite()`（`Number.isFinite` 语义，同时排除 ±Inf）。
   `.notNaN()` 会暗示 `Infinity` 合法，不采用。
4. **`.nan()`**：不暴露（当前无需求）。
5. **schema / guard 投影**：默认不表达有限性（运行时校验器按 `z.number()`），
   避免「校验通过但契约未满足」的假绿；需要时另立投影增强。
6. **`.finite().ge(0)` 展示顺序**：沿用 `preds` 声明序，`and()` 去重。
7. **`@nudo:assume finite(x)`**：未提供；`.finite()` 已覆盖契约面需求。
