# 设计：HOF 关系 Abs（不是 TS 泛型语言）

> **状态**：主路径已实施——关系原语与双路径消费、generalize 使用驱动提升（`fnRels` / `entryShapes`）、check 实参检查挂钩、dts 投影侧信道有实现与测试。**未实施**：调用点经验泛化（P3，独立设计，明确暂缓）；跨文件自动归纳（范围外）。
> **真源**：架构 → kernel-merge.md；命令面/any/unknown/check → cli-semantics.md
>
> 产品面观察仍走 `nudo check` / `nudo test` / IDE；序列化 `CaseJson` 的 `intension` 携带无损 Abs。`export` 投影（含 schema `absToSchemaSource`）与 dts 都是 Abs 的单向外延渲染。

---

## 现状（已落地）

### 问题边界

高阶函数在**无调用点 / 符号回调**时，形参若是函数且无实现，旧路径两侧塌成 `unknown`，`returnType` 也不记「输入 → 输出」关系。

```js
function processItems(items, transform, filter) {
  return items.filter(filter).map(transform);
}
// 期望：items: arr(α), transform: α→β, filter: α→bool ⇒ 返回 arr(β)
// 无关系时：transform/filter 入口无 impl → unknown
```

**明确不做**：用户可写 `<T,U>` / 条件类型 / `infer`；完整 HM；第二套类型系统；破坏 `Abs = shape × term × pred × conf` 单轨；跨文件自动归纳；形参别名提升；async 回调与 sort 比较器专门建模。

### fnRels 核心思想

关系**进 Abs 外延槽**，不另开 IR：

| 载体 | 内容 |
|---|---|
| `shape.k === "fn"` 的 `paramTypes` / `returnType` | 展示与 format 读这里（term 可为 `var("A1")` / `var("B:f")`） |
| `PolyFn.fnRels` | 函数形参的关系快照 + `RelSource`（`promote` / `refine` / `relationFn`） |
| `PolyFn.entryShapes` | 值形参提升快照（如 `items → arr(A1)`） |
| `PolyFn.hofSites` | body 内对该形参的应用点记录 |
| `impl.relation` | harvest / mock / `relationFn` 写入的无 body 纯关系 |

`relationFn(paramTypes, returnType)`：**双写** shape 槽 + `impl.relation`；默认 `conf="path"`（禁止对齐 `absFunction` 的 exact）；fingerprint 必填（call-budget 身份，禁止用 returnType 兜底）。

消费端统一入口 `applyCallbackAbs` / `applyAbsFn`：

```text
impl.apply → impl.body → impl.relation → isRelFn(shape-only) → unknown
```

`isRelFn`：**不要求** term 是 var；要求有 returnType 且 paramTypes 与 arity（或 required arity）对齐——半截签名不算关系。有 impl 走 body/relation，不算 rel。

内建 HOF（map / filter / reduce / flatMap）与 `$call` / `exec/class` **共用**上述 helper；调用门为 `getFnImpl || isRelFn`（漏改则 shape-only 提升永远进不来）。tuple 保逐元素精确路径；`filter` **不**把回调 pred 传播到元素。

### 使用驱动提升（关系的生产端）

`generalize` 的 **symbolic 一次跑**中，只在观测到使用时提升形参形状（绝不预置）：

| 观测 | 提升 |
|---|---|
| `p(x)` / `p(a,b)` | `fn(paramTypes=[αOf(…)], returnType=B:param)` |
| `arr.filter(p)` | `fn([αOf(el)], boolean)` |
| `arr.map/flatMap(p)` | `fn([αOf(el)], B:param)` |
| `arr.reduce(p, init)` | `fn([αOf(init), αOf(el)], B:param)` |
| 形参上的方法派发 miss | `arr(自身 var)`，再走 arr 分支 |
| for-of 迭代对象 | `arr(自身 var)` |
| 未使用 / 仅转发 / 仅属性访问 | 不提升 |

纪律：

- 挂载点至少：方法 miss + CallExpression callee + HOF 回调实参（+ for-of）；同 pass 串联，不二次重跑。
- `αOf` 白名单：仅复用本次 typeParams 的 var；否则 fresh α——局部字面量不得冻进签名。
- 写入：**替换** `env.vars[param]` 新对象，term 身份不变，conf=`path`；禁止 mutate 共享 Abs；禁止给提升产物挂 `impl.relation`。
- `@nudo:contract` 契约形状优先，不重复提升（`entryShapes` 可记 `source="refine"`）。
- 裁决 **arrival-first**：先 eval 到的形状定型；冲突拒绝新观测，**禁止**按 loc 回滚。
- 截断门：`conf === "opaque"` → `fnRels` / `entryShapes` / `hofSites` 均不落 PolyFn；`partial` **不是**截断，关系保留。
- 返回侧共享输出变量 `B:${param}`；同一形参多观测不改该 β id。

### 与 check 的交互

- **不改门禁问题**：`checkSource` 仍是 Pred 蕴含（调用前置 / 返回契约 / assign leq）。
- 关系让签名更准：返回 `arr(β)` 而非 `unknown[]`，可证性只增不减；β 无约束时的残余假阴是诚实缺口。
- HOF 实参 arity / shape 检查挂在调用执法旁：目标形状按 fn 槽比较；**零误报豁免**——`any`/`unknown`/无信息跳过；sum 任一 member 满足则通过；有真实 body 的 impl 跳过；`RelSource === "promote"` 只 **warning**。
- 来源判定读 `RelSource`，禁止从 shape 是否含 var 反推。
- constraint 语言可表达 fn 形状（`fn({x}, ret)` → `shape.fn`）；**refine 违约 → error** 已可测。promote 仍只 warning。
- `--json` / CaseJson 的 Abs 字段自动带上关系展示；`export` 与 schema 投影只消费外延，不回写关系。

---

## 关键不变量 / 设计决策（仍在约束代码的）

1. **单轨 Abs**；关系是 fn shape 外延槽 + term/pred，不是平行类型系统。
2. **无新用户语法**；多态仍由抽象解释 + 调用点实例化承担。
3. **body 优先于 relation**；`instantiate` 不对 relation-only 开特判。
4. **双写纪律**：`relationFn` 必须同时写 shape 槽与 `impl.relation`；展示读 shape，D 路径读 impl。
5. **提升只写 env 替换项**，禁止 `attachFnImpl`，否则 shape-only 应用路径变死代码。
6. **`relationFn` 默认 path**，禁止静默 exact；budget 身份用 fingerprint。
7. **`substAbs`**：map 内 var 整 Abs 替换；**自由 α 的 term/pred 原样保留**（`returnType=B1` 在只替换 A1 时不得塌成裸 shape）。
8. **重复 α**（`paramTypes=[A1,A1]`）先绑定保留，不覆盖、不 join。
9. **filter 不增强元素 pred**；改动须重开设计，不得顺手加。
10. **函数 union 回调**在统一入口内逐 member 应用后 join，不得静默掉成 unknown。
11. **Identifier 纪律**：`env.fns` 解析注入走 `compiledBodyOf`（Abs 值 / `absFunction` 包装）；不可解析名（全局/自递归）整段回落解释路径保预算。
12. **跨文件不自动归纳**；关系经 harvest / env / `relationFn` 进入。
13. **形参别名不提升**；P3 调用点经验泛化不入主路径。
14. **金标 / 零误报门禁不因关系展示而放松**；promote 来源只 warning。
15. 无任何关系信息时 **仍保持 unknown**——不编造。

---

## 未决 / 未实施

- **调用点经验泛化（P3）**：anti-unification、样本停机、过拟合防护与 memo 交互未设计评审，**不实现**。
- **跨文件 generalize 图**：范围外；`extractFn` 只收同文件顶层函数。
- **constraint 表达 fn 形状**：**已开**——`fn()` → entry Abs `shape.fn`；refine→error 可测（`hof-refine-error.test.ts`）。promote→warning 纪律不变。
- dts 泛型投影与 LSP hover 读 intension 的纪律以实现与测试为准；**权威关系源是 Abs / PolyFn**，不是外延投影。
- 同签名 `relationFn` 共享 fingerprint → 共享 budget 键：已知限制，不为此加 identity 字段。

---

## 源码锚点

- packages/core/src/algebra/hof.ts
- packages/core/src/algebra/abs-fn.ts
- packages/core/src/algebra/ast-env.ts · ast-records.ts · call-budget.ts
- packages/core/src/algebra/exec/call.ts
- packages/core/src/algebra/exec/class.ts
- packages/core/src/algebra/generalize.ts
- packages/core/src/algebra/format.ts
- packages/core/src/algebra/check.ts
- packages/core/src/algebra/scan.ts
- packages/core/src/algebra/diagnostics.ts
- packages/service/src/dts-generator.ts
- packages/service/src/__tests__/hof-dts-projection.test.ts
- packages/core/src/algebra/__tests__/hof.test.ts
- packages/core/src/algebra/__tests__/hof-relation.test.ts
- packages/core/src/algebra/__tests__/hof-relation-paths.test.ts
- packages/core/src/algebra/__tests__/hof-p2-generalize.test.ts
- packages/core/src/algebra/__tests__/hof-p4-check.test.ts
- packages/core/src/algebra/__tests__/hof-review-fixes.test.ts
