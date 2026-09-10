# Kernel ↔ 主 Evaluator 合并方案

> 目标：把 `packages/kernel` 的「类型即计算」内核并入主引擎，
> 淘汰双轨，而不是让两套类型系统长期并存。
> 原则：**先桥后换、路径切分、金标锁行为、可回滚**。

---

## 1. 现状盘点

### 1.1 两套系统

| | 旧主引擎 | 新 kernel |
|---|---|---|
| 位置 | `core/type-value` + `cli/evaluator` | `packages/kernel` |
| 类型表示 | `TypeValue`（kind 目录） | `Abs = shape × term × pred × conf` |
| 求值 | 5600 行 `switch (node.type)` | 模块化 `ast-eval` + 算术/对象/HOF |
| 约束 | `refined` 可挂上，运算会丢 | `Pred` 参与单调性传播 |
| 泛型 | `_typeArgs` hack | `generalize` 符号 α |
| 下游 | service / lsp / cli / vscode / dts | kernel CLI `nudo-types` |
| 测试 | 数千 | 74 + 与 Node 差分 |

### 1.2 依赖方向（今天）

```
parser ──▶ core(TypeValue) ──▶ cli/evaluator ──▶ service ──▶ lsp/vscode/cli
                │
                └──（旁路）kernel(Abs) ──▶ nudo-types
```

**问题**：kernel 不进主路径，改造价值无法兑现。

### 1.3 下游对 TypeValue 的硬依赖

| 消费者 | 依赖点 |
|---|---|
| `service/analyzer` | `evaluateFunctionFull`、`typeValueToString`、CaseResult |
| `dts-generator` | `typeValueToTSType(TypeValue)` |
| `schema-generator` | Zod |
| `guard-generator` | 运行时护栏 |
| `case-emitter` | 指令序列化 |
| LSP hover/completion | `nodeTypeMap: Map<Node, TypeValue>` |
| CLI infer/check/doctor | 全链路 |

**含义**：不能一次性把 `TypeValue` 删掉；必须先建立 **Abs ↔ TypeValue 桥**。

---

## 2. 三种合并策略

### 策略 A：Big Bang 替换

直接把 `TypeValue` 换成 `Abs`，改 core/evaluator/service/lsp。

- 优点：无双轨  
- 缺点：下游爆炸；无法灰度；回滚成本极高  
- **否决**

### 策略 B：永久双轨

kernel 独立产品线，旧引擎不动。

- 优点：零迁移风险  
- 缺点：语义分叉、用户困惑、改造白做  
- **否决**（仅作过渡期）

### 策略 C：桥接 + 路径切分（推荐）

```
1. 建立 Abs ↔ TypeValue 双向桥（有损但显式）
2. 在 evaluator 内按「语义域」逐步把路径切到 kernel
3. 下游继续吃 TypeValue（由桥投影）
4. 最后让 TypeValue 变成 Abs 的一个「外延视图」
```

---

## 3. 推荐架构：语义域切分

不要按「文件」合并，要按 **语义域（semantic domain）** 切：

```
                    ┌─────────────────────────────┐
   Babel AST ──────▶│  evaluator 分发层（保留）      │
                    │  信号/作用域/模块/诊断收集      │
                    └──────────┬──────────────────┘
                               │ 按节点类型路由
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
   ┌─────────────┐     ┌─────────────┐      ┌─────────────┐
   │ kernel 域    │     │ 旧 Ops 域    │      │ 内置表域      │
   │ 算术/比较     │     │ 字符串/对象   │      │ Map/Promise  │
   │ if 窄化Φ     │     │ 原型/instance│      │ fetch/Web    │
   │ HOF map/reduce│    │ 复杂 member  │      │ env 注入     │
   └──────┬──────┘     └──────┬──────┘      └──────┬──────┘
          │ Abs               │ TypeValue           │ TypeValue
          └────────────┬──────┴─────────────────────┘
                       ▼
              桥：Abs ⇄ TypeValue
                       ▼
              service / dts / lsp（继续 TypeValue）
```

**第一批切到 kernel 的域**（已验证、收益最大）：

| 域 | 现状 | 切后收益 |
|---|---|---|
| `+ - *` 数值 | Ops 宽化 | term 保留 + 约束单调性 |
| `< > <= >=` | 字面量或 boolean | Φ 蕴含、精确 true/false |
| `if` 守卫 | shape 窄化 | **向 Φ 加谓词** |
| `map/reduce` | 特判/unknown | 内涵求值 |
| 字面量路径 | 有 | 与 Node 差分锁定 |

**暂不切、继续走旧域**：

- `instanceof` / 原型链 / class  
- Promise/async 完整语义  
- 模块图 / import  
- 复杂 member（getter、Proxy 语义）  
- 全部 builtin 表（先不动）

---

## 4. 桥（Bridge）设计

### 4.1 为什么要桥

下游 155+ 处引用 `TypeValue`。桥让：

- kernel 算完 → 投影回 `TypeValue` 给 dts/lsp  
- 旧路径结果 → 可升为 `Abs` 再进 kernel 运算  

### 4.2 映射表

| Abs | TypeValue | 方向 notes |
|---|---|---|
| `prim + term=lit(v)` | `literal(v)` | bijective |
| `prim` 无 term | `primitive(T)` | bijective |
| `prim + pred` | `refined(base, pred.check)` | Abs→TV 需可执行 check |
| `obj.slots` | `object.properties` | optional → `T \| undefined` 槽 |
| `arr.element` | `array` | |
| `tuple.elements` | `tuple` | |
| `fn mode=body` | `function` (params/body/closure) | 闭包在 TV 侧 |
| `fn mode=sig` | `function` + `_signature` | |
| `eff promise` | `promise` | |
| `brand` | `instance` | |
| `sum.members` | `union` | |
| `never` / `unknown` | 同名 | |
| **`term` 非 lit** | **无处安放** | 投影时丢 term → `primitive` + 注释 |
| **`pred`** | 部分进 refined | 无法表达则丢，conf=`widened` |
| **`conf`** | 无 | 可挂在 `_meta` 或旁路表 |

### 4.3 API（新文件 `packages/kernel/src/bridge.ts`）

```ts
// Abs → TypeValue（给下游；有损，必须标 conf）
export function absToTypeValue(a: Abs): TypeValue

// TypeValue → Abs（给 kernel 运算；尽量恢复 term=lit）
export function typeValueToAbs(tv: TypeValue): Abs

// 批量：CaseResult 投影
export function caseResultToTypeValue(r: KernelCase): TypeValue
```

**有损规则（写死）**：

1. 丢 `term`（非 lit）→ 结果 conf 降为 `widened`  
2. 丢 `pred`（无法 encode 成 refined）→ conf 降  
3. `absToTypeValue` **禁止**假装 exact  

### 4.4 置信度旁路

`TypeValue` 无 conf 字段。两个选项：

| 方案 | 做法 | 推荐 |
|---|---|---|
| A. 并行 Map | `WeakMap<TypeValue, Confidence>` | ✅ 零侵入 |
| B. 加 `_meta` 字段 | 改 core 类型 | 后期 |

LSP hover / CLI 展示从 WeakMap 读。

---

## 5. 分阶段合并路线

### Phase M0 — 桥与金标（1 周）

1. 实现 `bridge.ts` + 属性测试（round-trip 有损一致性）  
2. 抽取 **金标语料**：kernel 已有 74 测试 + 旧 evaluator 关键 case  
3. `pnpm test` 双跑：同一源码，旧路径 vs kernel 路径，对比 `typeValueToString`  
4. 开关：`NUDO_KERNEL=1` 或 config `kernelDomains: ["arith"]`

**出口标准**：金标 100% 一致（在已支持子集上）。

### Phase M1 — 算术与比较切 kernel ✅ 骨架已接

在 `evaluator.ts` 的 `BinaryExpression`：

```
if (kernelEnabled("arith") && numeric && op ∈ + - * < <= > >=) {
  const r = tryKernelBinary(op, left, right);
  if (r !== undefined) return r;
}
// 失败回退旧路径
```

已落地：

- `packages/cli/src/kernel-router.ts`：域开关（`NUDO_KERNEL=0|arith|all`）、Phi 栈、`tryKernelBinary`
- `packages/cli/src/phi-from-test.ts`：从 `x > n` 提取 whenTrue
- `IfStatement`：真/假分支 `pushPhi/popPhi`
- `evaluateProgram` 入口 `resetPhi()`

**验证**：

| 检查 | 结果 |
|---|---|
| 默认 off | 旧 evaluator 124 测试无回归 |
| `NUDO_KERNEL=arith` 字面量 parity | `1+2*3=7`、`scale(5)=6` |

**已知边界（M1.5）**：~~`TypeValue` 无 `var term`~~ → **已解决**（见下）。

### Phase M1.5 — TypeValue 项身份旁路 ✅

问题：主路径 `T.number` 是单例且无 term，Φ 的 `x>0` 接不到「当前 number 就是 x」。

方案：`packages/cli/src/term-registry.ts` WeakMap 旁路。

```
tagParamArg(T.number, "x")
  → clone（不污染 T.number 单例）
  → attachTerm(var("x"))
typeValueToAbs 时优先读旁路
```

**已验证**：

```
Φ: x > 0
scale(T.number) = x + 1
  → refined number, meta: { op: "gt", n: 1 }
  → check(2)=true, check(0)=false
```

端到端 `evaluateFunctionFull` 在 `NUDO_KERNEL=arith` + pushPhi 下已产出 refined。

| 检查 | 结果 |
|---|---|
| 单例不被污染 | ✅ |
| 字面量路径仍 exact | ✅ `5+1=6` |
| 默认 off 无回归 | ✅ evaluator 124 测试 |
| 合计 | **224 测试全绿** |

### Phase M2 — HOF map/reduce ✅

`evaluateArrayMethodValues` 中：

- map/filter/reduce 回调元素经 `tagParamArg` 挂 term（`kernelEnabled("hof"|"arith")` 时）
- 抽象数组 `reduce` 改为**不动点迭代**（最多 6 轮），与 kernel 纪律一致
- 字面量 tuple 路径保持 exact（parity）

**已验证**：

```
[1,2,3].map(x=>x*2)           → [2,4,6] #exact
Arr(number).map(x=>x+1)       → number[]
Φ: x>0 下 Arr(number).map(x=>x+1)
                              → 元素 refined (x+1)>1
[1,2,3].reduce((a,n)=>a+n,0)  → 6
Arr(number).reduce(+,0)       → number（不动点）
```

合计 **230 测试全绿**（默认 off 无回归）。

### Phase M3 — generalize 进 analyzer ✅

`CaseResult` 新增可选 `intension: { display, term, pred, conf }`。

entry@ 回退时（`NUDO_KERNEL` 开启且 `setKernelModule` 注入）：

```
旧：entry@ (unknown) => unknown
新：entry@ (unknown) => number | string
    intension: scale: <A1>(x: A1) => number = (A1 + 1)
```

CLI `nudo infer` 预加载 kernel 并打印 intension。外延 TypeValue / `.d.ts` 不变。

**实测**（`NUDO_KERNEL=arith nudo infer sample.js`）：

```
add:    <A1, A2>(a: A1, b: A2) => number = (A1 + A2)
scale:  <A1>(x: A1) => number = (A1 + 1)
twice:  <A1>(x: A1) => number = ((A1 + 1) + 1)
negate: <A1>(x: A1) => number = (A1 * -1)
```

**164 测试相关套件全绿。**

CaseResult 增加可选字段：

```ts
{
  term?: string;   // "x+1"
  pred?: string;   // "(x+1)>1"
  conf?: Confidence;
}
```

**出口标准**：`nudo infer` 对 `scale` 输出内涵摘要；`--dts` 仍是外延。

### Phase M4 — 对象 spread ✅

`ObjectExpression` 的 `SpreadElement` 在 `kernelEnabled("object"|"arith")` 时走 `tryKernelObjectSpread`（kernel `spread`），失败回退 `Object.assign`。

**已验证**：`defaults ⊕ {port:3000}` 字面量保留，与旧路径 parity。

### Phase M5 — 默认开启 ✅

**修复**：

1. `tagParamArg` 克隆后 `copyOrigin`（provenance WeakMap 不随 clone 继承）
2. 函数/实例不 clone（丢 `_signature` 会炸 Promise executor）
3. reduce 不动点不把 `unknown` join 进 acc

**默认**：`NUDO_KERNEL` 未设时开启 `arith,hof,object`。

| 开关 | 行为 |
|---|---|
| （未设） | arith+hof+object **开** |
| `NUDO_KERNEL=0` / `off` | 全关，回退旧路径 |
| `NUDO_KERNEL=all` | 含 generalize |
| `NUDO_KERNEL=arith` | 仅算术 |

**验证**：

| 场景 | 结果 |
|---|---|
| 默认开启 | **931/931 全绿** |
| `NUDO_KERNEL=0` | evaluator 124 全绿 |
| `NUDO_KERNEL=all` | 931 全绿 |

### 合并总状态 ✅

| 阶段 | 状态 |
|---|---|
| M0 桥 | ✅ |
| M1 + M1.5 算术/term | ✅ |
| M2 HOF | ✅ |
| M3 generalize/analyzer | ✅ |
| M4 对象 spread | ✅ |
| M5 默认开启 | ✅ |

### 旧路径处置（M5 后）

**已删除 / 空壳化：**

- 抽象数组 reduce 的「单次调用」分支 → 统一不动点（unknown 不 join）
- `extractBranchPhis` → 恒 `undefined`（Φ 走 AST `phiFromTest`）
- 算术域：kernel 为唯一产品路径，`dispatchBinaryOp` 仅在 `tryKernelBinary → undefined` 时兜底

**故意留给旧路径（kernel 未覆盖 / 有更好实现）：**

| 域 | 原因 |
|---|---|
| abstract `string + …` | 需 `createTemplate` 产生 template refined |
| `==` / `!=` | 宽松相等特判 |
| `instanceof` / `in` | 原型语义 |
| union 分布 | `distributeBinaryOverUnion` |
| typeof / ! / 一元 | Ops |
| 全部 builtin / Promise / class / 模块 | 不在 kernel 域 |

**双字面量 `+`** 与 **abstract string 拼接** 均已走 kernel。

### Template string 拼接 ✅

`packages/kernel/src/template.ts`：

- `concatString` / `createTemplateAbs`：parts 合并、相邻字面量折叠  
- `absToTypeValue` → core `createTemplate`（`` `x${string}!` ``）  
- `typeValueToAbs` 恢复 template parts，支持链式拼接  

```
"x" + string     → `x${string}`
("x"+string)+"!" → `x${string}!`
```

抽象 string 的 `+` 不再依赖 evaluator 旧 template 路径。

**938 测试全绿。**

**933 测试全绿。**

### Phase M5 — 清理与默认开启（1 周）

1. 默认 `kernelDomains` 全开（已切换的域）  
2. 旧 Ops 对应分支删除或标 `@deprecated`  
3. 文档：设计文档 Phase 状态 = 已合并  
4. benchmark：hoek/json-ext 对比合并前后  

### Phase M6+（后续，不在本方案交付）

- async/promise 进 kernel `eff`  
- class/brand  
- 模块图  
- 废弃 `_typeArgs`  

---

## 6. 关键接线点（文件级）

| 文件 | 改动 |
|---|---|
| `packages/kernel/src/bridge.ts` | **新建** Abs⇄TypeValue |
| `packages/cli/src/evaluator.ts` | BinaryExpression / IfStatement / member map 路由 |
| `packages/cli/src/narrowing.ts` | 守卫结果写入 `Phi`（旁路，不改旧 narrow） |
| `packages/service/src/analyzer.ts` | CaseResult 扩展；generalize 兜底 |
| `packages/service/src/dts-generator.ts` | 读桥投影结果（通常无感） |
| `packages/lsp/src/*` | hover 显示 term/pred/conf |
| config | `kernelDomains: string[]` 或 env |

**不改**（本阶段）：parser、harvester、vscode 扩展本体、website。

---

## 7. Phi 的生命周期

旧 narrowing 只改 `Environment` 绑定。合并后需要旁路 `Phi`：

```
evaluator 栈帧:
  { env: Environment, phi: Phi, kernelOn: Set<Domain> }

if (test) {
  // 真分支
  env' = narrow(env, test)          // 旧
  phi' = and(phi, trueConstraint)   // 新
  eval(consequent, env', phi')
}
```

约束只增不减（路径敏感）；join 两分支时 `phi` 回到 if 前（保守）。

**实现建议**：`Phi` 挂在 evaluator 的模块级栈，与现有 `_callDepth` 同风格，避免改所有函数签名。

---

## 8. 测试与回滚

### 8.1 三层测试

| 层 | 内容 |
|---|---|
| kernel 自测 | 已有 74，保持全绿 |
| 桥 round-trip | Abs→TV→Abs 在无 term/pred 时恒等 |
| **差分金标** | 同一 fixture：旧路径 vs kernel 路径 `typeValueToString` |
| 与 Node | kernel exact 路径继续 execFileSync 对齐 |

### 8.2 金标语料来源

1. `packages/cli/src/__tests__/` 现有 evaluator 测试  
2. `packages/service/src/__tests__/integration.test.ts`  
3. kernel 示例 0–G  

### 8.3 回滚

- 每个 Domain 独立开关  
- CI 跑 `NUDO_KERNEL=0` 与 `=1` 双矩阵  
- 任一金标失败 → 该 domain 自动回退旧路径（运行时 catch → fallback）

```
try { kernelPath() } catch { legacyPath() }
```

禁止静默吞错：fallback 必须 `recordUnknown` / log。

---

## 9. 风险清单

| 风险 | 缓解 |
|---|---|
| 桥有损导致 dts 回归 | 金标锁 typeValueToString；conf 标 widened |
| Phi 与旧 narrow 不一致 | Phi 只做增强，不替换 narrow；冲突时以 narrow 的 env 为准 |
| 性能（Phi 合取膨胀） | leak 阈值；Phi 化简；benchmark |
| 双跑不一致 | 差分报告进 CI artifact |
| evaluator 继续膨胀 | 新逻辑进 kernel，evaluator 只路由 |
| 用户无感失败 | conf 在 hover 可见；`--json` 带 conf |

---

## 10. 交付物清单（本方案）

| 交付物 | 状态 |
|---|---|
| 本方案文档 | ✅ |
| `bridge.ts` | ⬜ Phase M0 |
| evaluator 路由骨架 + config | ⬜ M1 |
| Phi 栈 | ⬜ M1 |
| 差分金标 harness | ⬜ M0 |
| analyzer CaseResult 扩展 | ⬜ M3 |
| LSP hover term/pred | ⬜ M3–M4 |
| 默认开启 + 清理旧分支 | ⬜ M5 |

---

## 11. 一句话

> **不要替换文件，要替换语义域。**  
> 用 Abs⇄TypeValue 桥保住下游，用 evaluator 路由把算术/守卫/HOF 切到 kernel，  
> 用金标与开关保证可回滚。TypeValue 最终成为 Abs 的外延视图，而不是平行真理源。

---

## 附录 A：Domain 注册表（建议）

```ts
export const KERNEL_DOMAINS = {
  arith:   ["+", "-", "*", "<", "<=", ">", ">=", "===", "!=="],
  hof:     ["Array.prototype.map", "Array.prototype.reduce", "Array.prototype.filter"],
  object:  ["ObjectExpression", "SpreadElement"],
  generalize: ["entry@-fallback"],
} as const;
```

## 附录 B：合并后用户可见变化（示例）

```
# 旧
scale:
  Case "call@L3": (number) => number

# 新
scale:
  Case "call@L3": (number) => number
    term: (x + 1)
    pred: (x + 1) > 1
    conf: path
```

`.d.ts` 仍导出 `(x: number) => number`——外延不变，内涵更富。
