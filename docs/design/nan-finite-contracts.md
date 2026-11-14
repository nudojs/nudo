# NaN 感知的契约词汇与关系补集累积（草案）

> **状态**：草案（2026-11-14）。未实施；实施前先按本文件第 6 节建负控与等价门禁。
> **需求锚点**：[issue #185](https://github.com/nudojs/nudo/issues/185)（顺序早退 / De Morgan
> 两种拼写的 `add6` 仍 unproven）。已交付的 `86bc56e1` 只放开了**可健全证明**的合取形态，
> 负控见 `packages/core/src/algebra/__tests__/check-guard-conjunction-185.test.ts:109-124`。
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

| 拼写 | 现状 | 原因 |
|---|---|---|
| `if (x >= 1 && y >= 2) return x + y;`（合取事实臂） | 证得 | 合取为真 ⇒ 每项为真，NaN 不可达 |
| `if (x < 1) return 3; … return x + y;` | unproven | `NaN < 1` 为假 ⇒ 落入 fall-through；`x + y = NaN ⊭ ge(3)` |
| `if (x < 1 \|\| y < 2) return 3; …`（De Morgan） | unproven | 同上 |
| `if (!(x < 1 && y < 2)) return 3; …`（否定合取臂） | 证得 | 布尔取反精确；`!(A ∧ B)` 为假 ⇒ 合取为真 |

`predicates.ts::relGuardOfNegation` 的注释把这条钉死了：`¬(x < k)` 只断得
`x ≥ k ∨ x is NaN`（Bug 1115），**不得**当 `x ≥ k` 用。要把这两行从 unproven
翻成 proved，缺的不是推理能力，而是一个**用户可写的「非 NaN」证据**。

## 2. 现有机制（都已存在，缺的是接线）

| 机制 | 位置 | 现状 |
|---|---|---|
| `assumeFinite(t)` Pred | `pred.ts:132`、`pred.ts:153` | 已有一等谓词：`t` 是有限数（非 NaN/±Inf），开启线性环化简 |
| 非 NaN 判定 | `arithmetic/bounds.ts::isNonNaN` | 已消费字面量 / `sum` 成员 / 数值界 / `ne(t, NaN)` / `assumeFinite` |
| 守卫事实累积 | `exec/transpile/stmt/predicates.ts` | #185 已支持异名合取项（`others`）与否定臂；补集仍禁 |
| 关系补集 | `arithmetic/cmp.ts::matchRelIdentLit*` | 注释明确「补集方向依旧不可用」 |
| 契约 builder | `constraint.ts:127-151` | 只有 `gt/ge/lt/le/int/min/max/length/shift/optional/at`；**无** `finite` / `notNaN` |

## 3. 提案

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

- 落点 = `exec/runtime/narrow.ts`：新增 `$refineRelComplement(a, op, k)`
  （或给 `$refineRel` 加 `negated` 参数）——它拿到当前 `Abs`，先 `isNonNaN(a, phi)`
  判定，成立才挂 `ge/gt/le/lt`，否则**原样返回**（fail-closed）。
- 转译器只在 fall-through / else 臂发射该调用（与 `$refineRel` 的事实臂对称），
  不自行决定是否收紧。
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
4. `exec/runtime/narrow.ts`：补集入口按 `isNonNaN(a, phi)` fail-closed；
   `phi` 取当前求值环境可见的证据（入口 Abs pred / 作用域守卫事实），
   取不到时只看 `a.pred`，仍取不到即不收紧。
5. `cmp.ts`：`implies` 的补集规则**保持现状**（它没有 Abs 上下文，不能看到
   `assumeFinite`）；补集只发生在运行时事实臂。
6. 诊断/展示：`check-report.ts` 的 `assumeFinite` 分支已有格式化，确认
   `number().finite()` 的错误面文案（`actual ⊭ expected`）可读。

## 4. 不变量

- 不放松 Bug 1115：缺少非 NaN 证据时，补集**不得**断言（现有负控逐条保留）。
- `leqAbs` 不接受集不变；不新增 Shape 判别成员；`formatShape` 不变。
- `.finite()` 是**契约侧**词汇，不是 `any()`/`unknown` 的替代；入口无约束参数仍显示 `any`。
- 不给 `unknown` 参数自动加 finite 假设（fail-closed）。

## 5. 语义边界（要写进文档的诚实声明）

| 形态 | `.finite()` 后是否可证 |
|---|---|
| `number().finite()` + `¬(x < 1)` ⇒ `x ≥ 1` | 是 |
| `number()`（无 `.finite()`）+ 同上 | 否（NaN 可达，保持 unproven） |
| `number().ge(0)` + `¬(x < 1)` | 是（数值界已排除 NaN） |
| `x = NaN` 字面量实参 + `.finite()` | 契约违反（`.finite()` 被违反，报 `unproven`/`violated` 中与现有一致的一侧） |
| `x = +Infinity` 字面量实参 + `.finite()` | 契约违反（`.finite()` 排除 ±Inf） |
| `.int()` | 已隐含有限（整数），不新增语义 |

## 6. 验收（实施时）

- **#185 矩阵四行**：顺序早退 / De Morgan 在 `number().finite()` 下转 proved；
  无 `.finite()` 时两条负控保持逐字 unproven（`check-guard-conjunction-185.test.ts`
  现有断言不得改宽）。
- **NaN 反例**：`add6(NaN, 5)` / `add6(Infinity, 5)` 在 `.finite()` 契约下必须报
  （不得假绿）；`add6(1, 2)` 精确 `3`。
- 金标：`check-recall-gold` recall = precision = 1.0；`check-real-packages` 零 FP。
- 等价门禁：未使用 `.finite()` 的侧车输出逐字节不变；`absKey` 对同一契约逐字节不变。
- `nudo check` / `test` / `export --format dts` 三条产品面各跑一次；dts 只输出 `number`。
- changeset：`@nudojs/core` minor（新增 builder 方法）。

## 7. 未决

1. 命名：`.finite()` vs `.notNaN()`。推荐 `.finite()`——它同时排除 ±Inf，语义可用
   `Number.isFinite` 一句话说清；`.notNaN()` 会暗示 `Infinity` 合法，但对
   `le(100)` 类契约没有帮助。
2. 是否同时暴露 `.nan()`（`NaN` 专属域）。当前无需求，不做；等真实用例。
3. schema / guard 投影是否要表达有限性。默认不表达（运行时校验器按 `z.number()`），
   避免投影面出现「校验通过但契约未满足」的假绿。
4. 组合子 `.finite().ge(0)` 的展示顺序与去重：沿用 `preds` 声明序，`and()` 已去重。
5. 是否需要 `@nudo:assume finite(x)` 的指令级拼写（与 `.finite()` 同义）。
   等 1 落地后看是否有人需要在函数体上假定。
