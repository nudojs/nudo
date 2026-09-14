# 设计：HOF 关系 Abs（不是 TS 泛型语言）

> 目标：让高阶函数在 **无调用点 / 符号回调** 时仍能归纳出「输入 → 输出」关系，  
> 而不是在 `unknown` 上塌掉。  
> **不做** 用户可写的 `<T, U>`、条件类型、`infer`。  
> 多态仍由 **抽象解释 + 调用点实例化** 承担；本设计只补 **关系形状**。

---

## 1. 问题与边界

### 1.1 现状

| 路径 | 行为 | 位置 |
|---|---|---|
| 内联回调 | `arr.map(x => x*2)` 可跑 | `ast-eval.ts` `applyUnaryCallback` |
| 具名回调有 impl | `getFnImpl` → `$call` / `applyAbsFn` | `abs-fn.ts` / `exec/call.ts` |
| 内建 map | tuple 逐元素；`arr` 取 `element` 一次应用 | `ast-eval.ts:1096` / `exec/class.ts:190` |
| generalize | 每个形参挂 `anyVar("A1")`，body 跑出 `symbolic` | `generalize.ts` |
| 缺口 | 形参本身是函数且无 impl → `unknown`；`returnType` 不记关系 | `design-limitations.md` P1 |

双路径差异（统一前必须对齐）：

| | `ast-eval` | `exec/class` |
|---|---|---|
| 回调入口 | `applyUnaryCallback` / `applyBinaryCallback` | `invokeArrMethod` 内 `callFn` |
| Identifier | `getFnImpl` → `applyAbsFn`；否则 `env.fns`；否则 `unknown` | 只认 Abs/`$call`，不走 `env.fns` |
| reduce | 不动点最多 6 次 | 单 pass 遍历元素 |
| 无 impl 的 fn Abs | `unknown` | `$call` 同样 `unknown`（`exec/call.ts:16`） |

### 1.2 要解决

```js
function processItems(items, transform, filter) {
  return items.filter(filter).map(transform);
}
// 期望关系：∀α. items: arr(α), transform: α→β, filter: α→bool
//           ⇒ 返回 arr(β)
// 现状：入口 transform/filter 无 impl → 两边 unknown
// 注意：`items: arr(α)` 同样不来自入口——由 §5.2 的使用观测提升得到
```

### 1.3 明确不做

- 用户语法 `function map<T,U>(...)`
- 完整 Hindley–Milner / 子类型约束求解
- 在 TypeValue 上并行开第二套类型系统
- 破坏 `Abs = shape × term × pred × conf` 单轨
- async 回调（`map(async x => …)` → `Promise[]`）的专门建模
- `sort` 比较器 / `thisArg` 重载
- **跨文件自动归纳**：`extractFn` 只收同文件顶层函数；A 文件的 `processItems` 被 B 文件调用时，B 侧 **不** 自动获得 `fnRels`。跨文件关系仅通过 harvest / env 绑定 / `relationFn` 进入（见 §12）。若后续要做跨模块 generalize 图，另开设计。
- **形参别名提升**：`const p = filter; items.map(p)` 里挂载点③ 只认 `Identifier ∈ paramNames`，本地别名 `p` 不在集合中 → **不提升**（结果保持 unknown）。这是诚实限制，不是 bug；实现者不得「顺手」做别名追踪。若后续要做，另开设计。
- **`app(fn, args)` 依赖 term 的精确输出身份**：P2 返回侧统一用共享输出变量 `B:${param}`（见 §5.1），**不**在 P2 引入 `app` 形态。需要按实参区分输出时，等后续增强，不与本期混做。

---

## 2. 核心思想

把「类型变量」继续用现有 **term 变量**（`{ op: "var", id }`）表示；  
把「函数关系」用 **fn 形状上的外延槽 + 应用点 term** 表示。

```text
现在：
  α  ──(instantiate)──▶ 具体 Abs ──(eval body)──▶ 结果

补上：
  形参 f 的形状 ──▶ fn(paramTypes=[α], returnType=β)（由 body 使用观测提升，§5.2）
  body 内 f(x)  ──▶ 应用点：returnType 的 term = var("B:f")（共享 β，§5.1 钉死）
  map(arr(α), f) ──▶ arr(returnType)  而不是 unknown
```

关系 **进 Abs**，因此：

- `formatAbs` / hover 能展示 `fn(α) => β`
- `leqAbs` 能做函数逆变/协变比较（已有）
- `nudo check` 仍走 Pred 蕴含；HOF 关系主要影响 **归纳签名与返回 shape**
- dts 侧可 **投影** 成 TS 泛型（兼容通道，不是内核）

---

## 3. 数据结构扩展

### 3.1 Shape：fn 关系槽（向后兼容）

现有：

```ts
{ k: "fn"; params: string[]; name?: string; paramTypes?: Abs[]; returnType?: Abs }
```

不改字段名，只约定 **poly 语义**：

| 约定 | 含义 |
|---|---|
| `paramTypes[i].term` 为 `var("A1")` 且 shape 为 `any`/`prim`/… | 该位置是 **多态输入变量**（与 `PolyFn.typeParams` 同 id 空间） |
| `returnType.term` 为 `var("B1")` 或 `app("f", [var("A1")])` | 多态输出 / 依赖参数的应用结果 |
| 无 `paramTypes` / `returnType` | 保持现状：仅 arity，外延未知 |
| `conf` | 关系归纳阶段默认 `path`；实例化后按实参 conf 提升/降级 |

**不新增 shape 种类。** 关系仍是外延槽上的 term/pred。

### 3.2 PolyFn：补 `fnRels` / `entryShapes` / `hofSites`

```ts
export type HofSite = {
  /** 形参名（函数形参） */
  param: string;
  /** 输入侧 term：实参的 term（element 的 var/lit/app）；map 1 个、reduce 2 个 */
  argTerms: Term[];
  /** 输出侧：归纳出的返回 Abs（可能带 term=app(param, argTerms) 或 β） */
  result: Abs;
  /** 源位置，便于 diagnostics */
  loc?: { line: number; column: number };
};

/** 关系来源标记：P4 豁免与 diagnostics 依赖它，禁止隐式猜 */
export type RelSource = "promote" | "refine" | "relationFn";

export type PolyFn = {
  name: string;
  params: string[];
  typeParams: TypeParam[];
  instantiate: (args: Abs[], phi?: Phi) => Abs;
  symbolic: Abs;
  display: string;
  entryReqs?: Array<{ param: string; pred: Pred }>;
  /**
   * 新增：函数形参的符号外延（与 typeParams 同 α 空间）。
   * key = 形参名；value = fn(paramTypes, returnType) 的关系 Abs。
   * 由 §5.2 的「使用观测提升」在 symbolic 一次跑时写入；instantiate 重跑不写。
   * value 带 RelSource；P4 的 warning/error 豁免读这里，不读 shape 形态猜。
   */
  fnRels?: Map<string, { abs: Abs; source: RelSource }>;
  /**
   * 新增：值形参（非函数）的提升快照，如 `items → arr(A1)`。
   * 与 fnRels 同一生命周期：symbolic 结束时从 env **拷出**，不是第二套类型。
   * 展示（formatPoly）从这里读 `items: arr(A1)`；禁止靠 mutate typeParams[i].value 达成展示。
   */
  entryShapes?: Map<string, { abs: Abs; source: RelSource }>;
  /**
   * 新增：body 内对该形参的应用点（check/hover/dts 用）。
   */
  hofSites?: HofSite[];
};
```

`instantiate` **不改**：实参绑定进 env 后照常重跑 body——L1/L2 memo 键与  
语义均不动，也不新增特殊分支。

relation-only 实参的能力全部由调用点 fallback 提供（§4.1 D/E 路径）：
body 内 `f(x)` 求值到无 impl 的 fn Abs 时，按 `paramTypes → returnType`
做 α 替换返回，不进 body。`instantiate` 对 relation-only 无感知。

### 3.3 Abs 函数值：无 body 也可有关系

`abs-fn.ts` 的 `AbsFnImpl` 可选增加：

```ts
export type AbsFnImpl = {
  params: string[];
  body?: Node;          // 原先必填；允许无 body 纯关系
  async?: boolean;
  env?: AstEnv;
  kind?: string;
  apply?: (args: Abs[]) => Abs;
  fingerprint?: string;
  /** 新增：无 body 时，按 paramTypes 做 α 替换得到返回 */
  relation?: { paramTypes: Abs[]; returnType: Abs };
};
```

**P1 必交付的测试/harvest 构造器**（与 `absFunction` 并列导出）：

```ts
/**
 * 无 body、纯关系的 fn Abs。params 仅记 arity。
 *
 * **双写纪律（阻塞）：** 同一份关系数据必须同时写到——
 *   1. `shape.paramTypes` / `shape.returnType`  —— format / leq / 展示读这里
 *   2. `impl.relation`                         —— D 路径应用读这里
 * 只写 impl 会让 formatShape 看不见关系（它只读 shape 槽）；只写 shape
 * 则 relationFn 进不了 D 路径（apply 入口认 impl）。禁止两套内容分叉。
 *
 * 默认 conf="path"（与提升产物一致）。禁止静默对齐 absFunction 的 "exact"。
 * fingerprint 必填（见下方 call-budget 纪律）；未传时由 paramTypes+returnType 稳定序列化生成。
 */
export function relationFn(
  paramTypes: Abs[],
  returnType: Abs,
  opts?: { params?: string[]; conf?: Confidence; fingerprint?: string },
): Abs;
```

**conf 纪律：** 未显式传入时默认 `"path"`，**禁止**默认 `exact`。`absFunction` 默认 `exact`（有 body 的真实函数），两者语义相反，API 上不要对齐。

**写入载体分工（阻塞实现，防止 E 路径死代码）：**

| 来源 | 写哪 | 走哪条应用路径 |
|---|---|---|
| `relationFn()` / harvest / mock | `attachFnImpl` 的 `impl.relation` **且** 同步写 `shape.paramTypes/returnType`（双写，见上） | D（impl.relation） |
| §5.2 使用驱动提升 | **只改** `env.vars[param]`（**替换 map 项，禁止 mutate 旧对象**），写 `shape.paramTypes/returnType`，**禁止** `attachFnImpl` | E（isRelFn） |
| `PolyFn.fnRels` / `entryShapes` | symbolic 结束时从 env **快照**拷出（带 `RelSource`），不是第二套类型 | 展示 / check / dts / P4 豁免 |

若提升也挂上 `impl.relation`，`isRelFn` 的 `!getFnImpl(a)` 恒为 false，E 路径变死代码——禁止。

`$call` / `applyAbsFn` / `applyCallbackAbs` **三条入口**统一顺序（有 impl 时 body 优先于 relation）：

```text
impl.apply?     → 用
impl.body?      → eval body
impl.relation?  → instantiateReturn(paramTypes → returnType)
shape.fn + returnType 且无 impl（isRelFn）→ 同上
else            → unknown
```

若 `impl.body` 与 `impl.relation` 共存（harvest 可能造出），**body 胜出**；relation 仅作 body 求值失败后的展示/降级信息，不参与应用结果。

**展示 vs 应用的读槽：**

| 用途 | 读哪 |
|---|---|
| `formatShape` / hover / dts 投影 | `shape.paramTypes` / `shape.returnType`（**必须**在 relationFn 构造时已写入） |
| D 路径应用 | `impl.relation` |
| E 路径应用 | `shape.paramTypes` / `shape.returnType`（无 impl） |

P1a 实现 `relationFn` 时若漏写 shape 槽，会出现「D 路径应用正确、format 读不到关系」——P1a 用 shape 字段断言钉住双写；P1b 用 format 断言钉住「含 term 展示」。

harvest / `--callsites` / mock / 测试 可只给 `relation`，不伪造 body。

**call-budget 身份（body 可选后必须改）：** `applyAbsFn` 里 `stableCallId(impl.body)` 在 `body` 缺失时退化。键改为：

```text
body 存在 → stableCallId(body)          （现状不动）
无 body   → impl.fingerprint            （必填；relationFn 未传则自动生成稳定序列化）
```

**禁止**用 `returnType` 兜底作 identity——两个不同的 relation-only 函数若 returnType 同为 `var("B1")` 或同为 `number` 会撞同一 budget 键，在多回调同文件场景误伤调用预算。`returnType` 只作展示级 fallback，不进 identity。

**已知限制（接受，不修）：** 两个**签名完全相同**的 relationFn（paramTypes/returnType 序列化一致）会共享同一 fingerprint → 共享 budget 键。对「同签名、不同语义、又互相递归」的极端场景可能过早截断；概率极低，P1 不为此引入额外 identity 字段。若未来撞上，再单独评估。

---

## 4. 语义：内建 HOF + 符号回调

### 4.1 回调应用统一入口

收敛 `ast-eval` 与 `exec/class` 两套路径到同一 helper（**单点定义，禁止两处各写各的**）：

```ts
// packages/core/src/algebra/hof.ts  (新)

/**
 * 「有可用外延签名」判定：唯一权威定义。
 *
 * 名实说明：isRelFn **不要求** term 是 var。完全单态的具体签名
 * （paramTypes=[number], returnType=string）同样满足——map 有槽就用。
  * 多态（term=var）只是其中一种形态；名字里的 Rel 指「关系槽可用」。
 * P2 返回侧统一用共享 var（§5.1），不引入 app 形态。
 *
 * 收紧条件——仅有 returnType 而 paramTypes 与 arity 不对齐时，不算 rel，
 * 防止半截签名在 map 里冒充关系（把弱信息装成 arr(T)）。
 */
export function isRelFn(a: Abs | undefined | null): a is Abs {
  if (!a || typeof a !== "object") return false;
  if (getFnImpl(a)) return false;                 // 有 impl 走 B/C/D，不算 rel
  const s = a.shape;
  if (!s || s.k !== "fn") return false;
  if (s.returnType === undefined) return false;   // 至少有输出槽
  // paramTypes 缺失：仅当零参（如 fn()=>B1）才视为完整关系
  if (s.paramTypes === undefined) return s.params.length === 0;
  // paramTypes 存在：必须与 arity 对齐，否则是半截展示槽，保持 unknown
  return s.paramTypes.length === s.params.length;
}

export function applyCallbackAbs(
  cb: Abs | Node,
  args: Abs[],
  env: AstEnv,
  phi: Phi,
  budget: LeakBudget,
): Abs {
  // 0. Identifier 解析层（统一 ast-eval 与 exec/class 的现状差异）
  //    Identifier → 读 env → 得到 Abs 或 Node，再进入 A–F
  // A. Node：内联箭头 / FunctionExpression → 现状 extractCallback + eval
  // B. Abs + impl.apply → apply(args)
  // C. Abs + impl.body → eval body
  // D. Abs + impl.relation → instantiateReturn
  // E. isRelFn（shape.fn + returnType，无 impl）→ instantiateReturn
  // F. 其它 → unknown
  //
  // A 路径预算：内联箭头现状不进 applyAbsFn 的 call-budget（直接 evalNode）。
  // 本设计 **不扩大** 该面：A 路径保持现状；只有经 Abs/impl 的 B–E 才进 budget。
  // 若嵌套 HOF 出现递归面扩大，另开 budget 设计，不在此顺手加。
}
```

**Identifier 解析层（步骤 0，必须写进实现）：**

现状双路径在 Identifier 上本就不一致，统一时不能静默抹掉或凭空新增：

| 路径 | 现状 Identifier 行为 | 统一后 |
|---|---|---|
| `ast-eval` | `env.vars` + `getFnImpl` → `applyAbsFn`；否则 `env.fns` → `callFunction`；否则 `unknown` | 步骤 0：`env.vars` 有 Abs → B/C/D/E；`env.fns` 有 → `callFunction`（保持）；否则 unknown |
| `exec/class` / `$call` | 只认 Abs / `$call`，**不走** `env.fns` | 步骤 0 同读 `env.vars`；`env.fns` 在该宿主 env 里通常为空，自然退化，不强制塞入 |

**函数 union（sum）回调（阻塞 P1，禁止静默掉成 unknown）：**

`cond ? f : g` / `@nudo` 环境里已有的「函数 union 透传给 HOF」（见 `cli/src/evaluator.ts` 相关分支）在统一入口后必须保留。步骤 0 之后、进入 A–F 之前：

```text
shape.k === "sum"
  → 对每个 member 按 A–F 求值
  → joinAbs 各成员结果
  → 无任何 fn member → unknown（与现状一致）
```

`isRelFn(sum)` 恒为 false——**不要**试图在 sum 上读 paramTypes。union 分支写在 `applyCallbackAbs` 内，禁止在 map/filter 各处再抄一份。

纪律：

1. **不得**为了「统一」给 `exec/class` 强制新增 `env.fns` 查找——那是行为变更，超出关系 Abs 范围。
2. **不得**在收敛时丢掉 `ast-eval` 的 `env.fns` 路径——那是现有行为，P1 回归。
3. 双路径一致性测试的含义是「关系处理一致」，不是「强行让两边 env 完全同构」。
4. **不得**在统一后丢掉 sum 回调分支——那是现有行为，P1 回归。

D/E 是 relation-only 的**唯一**处理点——`instantiate`、check、B 路径都不另开机制。

**接入点（P1b 接 ast-eval map；P1c 补齐其余入口。漏一处即出现「map 认了 relation、$call 仍 unknown」）：**

| 入口 | 现状进入条件 | 动作（阶段） |
|---|---|---|
| `ast-eval.applyUnaryCallback` / `applyBinaryCallback` | Identifier：`bound && getFnImpl` → applyAbsFn；否则 `env.fns`；否则 unknown | **P1b**：委托 `applyCallbackAbs`（保留 `env.fns`）；**进入条件扩为** `bound && (getFnImpl(bound) \|\| isRelFn(bound))` |
| `exec/class.invokeArrMethod` 的 `callFn` | 无 impl → `$call` → `unknown` | **P1c**：委托 `applyCallbackAbs`（不新增 `env.fns`）；同上扩条件 |
| `exec/call.$call` | 仅在已有 impl 时被调用 | **P1c**：函数体内部按 apply→body→relation→isRelFn 分支；**调用方**若只在 `getFnImpl` 成功时才 `$call`，E 路径永远进不来——须改调用门 |
| `ast-eval.applyAbsFn` | 仅在 `bound && getFnImpl(bound)` 时被调用 | **P1b**：同上：**调用门必须扩为** `getFnImpl \|\| isRelFn`，否则 E 为死代码 |
| Identifier CallExpression（`p(x)`） | `bound && getFnImpl` 才进 applyAbsFn | **P1b**：同上扩条件；`p` 为 shape-only rel 时进入 E，不得落入 `env.fns`/unknown |

**调用门（阻塞实现，漏改即 E 死代码）：**

现状代码写的是：

```ts
const bound = env.vars.get(name);
if (bound && getFnImpl(bound)) { applyAbsFn(bound, …); }
// else env.fns / unknown
```

shape-only 的提升产物 **没有** `impl`（§3.3 禁止 `attachFnImpl`），上述门把它挡在外面。
所有 Identifier / `$call` 调用方必须改为：

```ts
if (bound && (getFnImpl(bound) || isRelFn(bound))) {
  // → applyAbsFn / $call / applyCallbackAbs（内部再分 D/E）
}
```

helper 内部分支顺序不变；**变的是「谁能进入 helper」**。测试须含：
`relationFn`（走 D）与纯 shape 提升产物（走 E）在 map（P1b）/`$call`（P1c）上行为一致。

注：形参从 `any` 提升为 fn/arr 形状发生在 generalize 的「形参形状提升」（§5.2），
在本 helper 之前完成；本 helper 只消费已提升的形状。

### 4.2 `map` / `filter` / `flatMap` / `reduce`（arr 侧）

优先级（有 impl 时 **body 优先于 relation**，与 §3.3 顺序一致）：

```text
inline Node / impl.apply / impl.body  →  执行
仅 isRelFn / impl.relation            →  instantiateReturn
```

```ts
function mapArr(arr: Abs, cb: Abs, phi: Phi, budget: LeakBudget): Abs {
  // 只接 arr；tuple 由调用侧走逐元素精确路径（见本节末），不进这里
  const elem = arr.shape.element;

  // 关系回调：无 body（或无 impl），有 returnType（term 为共享 β，见 §5.1）。
  // 与 §3.3 一致：有 impl.body/apply 时不得走本分支——body 胜出。
  const impl0 = getFnImpl(cb);
  const relOnly =
    !impl0?.body && !impl0?.apply && (isRelFn(cb) || !!impl0?.relation);
  if (relOnly) {
    const out = instantiateReturn(cb, [elem]);
    return abs({ k: "arr", element: out }, undefined, undefined, confJoin(arr.conf, out.conf));
  }

  // 有 impl / 内联：一次抽象应用（现状；内部按 apply→body→relation→E）
  const out = applyCallbackAbs(cb, [elem], /* env */ …, phi, budget);
  if (isUnknown(out) && elem.term?.op === "var") {
    // 仅「有 impl、body 在符号实参上跑出 unknown」时的诚实降级：
    // 用 shape.returnType 槽，conf 强制 partial（不假装 exact）。
    // 注意：这条与上方 relOnly 分支互斥——rel 回调不会走到这里。
    const slot = (cb.shape as FnShape).returnType;
    if (slot) return abs({ k: "arr", element: slot }, undefined, undefined, "partial");
  }
  return abs({ k: "arr", element: out }, undefined, undefined, confJoin(arr.conf, out.conf));
}

function filterArr(arr: Abs, _cb: Abs): Abs {
  // filter 不改元素 shape。
  // 明确不做：把回调 pred 传播到元素——src pred 变强会改变 leqAbs 蕴含方向，
  // 假阴风险 >> 收益。
  // 能力上限：filter 后 element 的 pred 不增强。后续若有人当 bug 修，须重开设计，
  // 不得在本文件内「顺手」加 pred 传播。
  return arr;
}

function flatMapArr(arr: Abs, cb: Abs, phi: Phi, budget: LeakBudget): Abs {
  // 与 map 同优先级：body 优先，仅 relation 时 instantiateReturn。
  // 回调返回约定为 arr(γ) 时，结果 element = γ；否则诚实 unknown。
  // P1c 实现：复用 mapArr 的回调应用逻辑，再做一层 element 投影。
  // 若无法证明返回是 arr → 保持 unknown（不编造）。
}

function reduceArr(arr: Abs, cb: Abs, init: Abs, …): Abs {
  // 有 body → 现状不动点 6 次（精确路径优先，不因关系槽而降级）
  // 仅 isRelFn → 一次 join
  // body + relation 共存 → body 胜出（与 §3.3 一致），不因 relation 跳过不动点
  if (isRelFn(cb) && !getFnImpl(cb)) {
    // cb: (γ,α)→δ。符号阶段分不出数组空性 → 结果 ∈ join(init, δ)。
    // join 幂等：一次应用即收敛，不跑不动点。
    // 可选（P2 后）：tuple 或已证非空时只返回 δ，跳过 join(init,·)。
    const d = instantiateReturn(cb, [init, arr.element]);
    return joinAbs(init, d);
  }
  // 现状不动点 6 次
  …
}
```

**tuple 路径不变**：逐元素保精确（字面量计算优势保留）。tuple 侧**禁止**落入 unknown 兜底。

**P1c 可选（便宜、建议顺手做）：**

| 方法 | 有 relation 回调时 |
|---|---|
| `forEach` | `undefined` |
| `find` | `join(instantiateReturn(cb,[el]), undefined)` 或 `element ∪ undefined` |
| `some` / `every` | `boolean` |

`flatMap` 属 P1 必做（与 map 同级）。软出口仅限 **body 路径的返回 arr 投影**：若实现期发现 body 路径投影边界不清，可先只做 relation 路径、body 路径保持现状——**不得**据此整体跳过 flatMap，relation 路径必须合入。

### 4.3 `instantiateReturn` / `substAbs`（α 替换）

```ts
function instantiateReturn(fn: Abs, args: Abs[]): Abs {
  const shape = fn.shape as FnShape;
  // impl.relation 槽优先于 shape.returnType
  const src = getFnImpl(fn)?.relation ?? {
    paramTypes: shape.paramTypes ?? [],
    returnType: shape.returnType ?? unknown,
  };
  const map = new Map<string, Abs>();
  src.paramTypes.forEach((p, i) => {
    if (p.term?.op !== "var") return;
    const id = p.term.id;
    // 重复 α（paramTypes=[A1, A1]）：后写不覆盖先写。
    // 避免静默用最后一个实参改写已绑定类型；冲突保持 first-binding。
    if (map.has(id)) return;
    map.set(id, args[i] ?? unknown);
  });
  return substAbs(src.returnType, map);
}
```

**重复 α 纪律（阻塞实现）：** `paramTypes = [A1, A1]` 且实参为 `[number, string]` 时，**保留第一个**绑定（`A1 := number`），不覆盖、不 join。提升生产端（§5.2.2 `αOf`）应尽量避免同一形参写出重复 id；harvest 若写出，消费端按本条处理并可选记 diagnostic。

**`substAbs` 规范语义（阻塞实现，必须单测钉住）：**

现有 `substTerm`/`substPred`（`pred.ts:135`）要求全替换函数，不满足部分替换，故全新实现。

| 输入 | 行为 |
|---|---|
| `var ∈ map` | **整 Abs 替换**（吸收对方 shape + term + pred；conf 取 `confJoin` 或更保守） |
| `var ∉ map` | **原样保留**（类型变量身份不动；shape/term/pred 全保留） |
| 非 var 的 term（lit / app） | 递归替换 args；`app` 的 fn 名不动 |
| shape | 递归（obj slots / arr element / tuple elements / fn paramTypes+returnType / sum members / eff inner） |
| 替换过程中丢 term / pred | **禁止** conf 保持 `exact`（与 bridge 同纪律） |

**pred 替换三条规则（阻塞实现，必须单测钉住）：**

「无法安全替换」不可留给实现者猜测。按下表执行：

| pred 中的 var | 实参 Abs 形态 | 动作 |
|---|---|---|
| var ∈ map，实参有 term | 可归约则归约；否则残余 pred 保留 | 例：`A1>0` + A1:=lit(5) → true；A1:=number(term=n1) → `n1>0` |
| var ∈ map，实参无 term / shape-only | `pred → true`，`conf → widened/partial` | 替换后无法维持蕴含语义 |
| var ∉ map（自由 α，如 B1 上的 pred） | **原样保留**（与 term 同纪律） | 不得因「换不到」而抹掉 |

第三条尤其重要：`returnType` 上若挂了关于 `B1` 的 pred，只换 `A1` 时**不得**把 `B1` 的 pred 抹掉。

**反例（文档级断言，P1 单测必须覆盖）：**

```text
fn: paramTypes=[A1], returnType = { shape: any, term: var("B1"), conf: path }
instantiateReturn(fn, [number])
错误：B1∉map 就丢 term → 任何（β 身份没了，嵌套 HOF / 二次 instantiate 全废）
正确：结果 term 仍为 var("B1")

fn: paramTypes=[A1], returnType = { shape: number, term: var("B1"), pred: B1>0 }
instantiateReturn(fn, [number])
错误：把 pred 一并丢掉
正确：pred 仍为 B1>0（自由 α 的 pred 原样保留）
```

`returnType = var("B1")` 在 map 只有 `{A1: number}` 时，**不得**降成裸 shape。

---

## 5. generalize：从「跑 α」到「归纳关系」

### 5.1 应用点收集与形参提升钩子

在 `evalNode` 的 CallExpression 路径接 collector，**不用全局单例**——`setAbsAssignCollector`
式全局可变状态在 L0 memo + LSP 并发下会串状态。

collector 不是新的 Phi 种类，而是 **run 局部上下文字段**（与 `Phi` 并列，不进 Φ 合并）：

```ts
type HofCollectCtx = {
  /** 本次归纳的形参名集合（身份判定用） */
  paramNames: ReadonlySet<string>;
  /** 本次 typeParams 的 α id 集合（term 复用白名单，§5.2） */
  alphaIds: ReadonlySet<string>;
  sites: HofSite[];
  /** 函数形参关系；value 带 RelSource */
  fnRels: Map<string, { abs: Abs; source: RelSource }>;
  /** 值形参提升（如 items→arr）；value 带 RelSource */
  entryShapes: Map<string, { abs: Abs; source: RelSource }>;
};
```

- 仅 generalize 的 **symbolic 一次跑**安装用于沉淀的 collector；`instantiate` 重跑
  可装 **throwaway** collector（只服务形参提升，run 结束即丢），**不写**
  `hofSites`/`fnRels`/`entryShapes`（保证 L1/L2 memo 结果确定性）；
- `instantiate` 的 body 重跑仍享受 §5.2 的**形状提升**（纯函数、run 局部），
  但不沉淀任何共享状态。

**截断 / 失败时的快照丢弃（阻塞）：**

symbolic 跑若出现 call-budget 截断（`conf === "opaque"`）、或 collector 安装后 eval
中途失败，**不得**把半截 `fnRels` / `entryShapes` / `hofSites` 挂到 PolyFn。
**注意：`partial` 不是截断**——for-of / join 会诚实产出 partial，提升过程仍完整，
此时必须保留关系。规则：

```text
symbolic.conf === "opaque"  →  三者置 undefined（截断，不写半截关系）
否则（含 exact/path/widened/mock/partial）→  从 env 拷贝快照到 PolyFn
```

**禁止**用 `isCacheableAbs` 当「run 成功」代理：它拒 partial，会误丢
`applyEach` 型 for-of 归纳出的关系。

L0 本就不缓存不可缓存的 PolyFn；本条管的是「PolyFn 对象仍被返回 / 被 check 半路读到」
时不得带残缺关系。

**fnRels / entryShapes 快照语义（避免三处各写一套）：**

关系在以下位置出现，实现时必须保持一致，禁止分别演化：

| 位置 | 内容 | 生命周期 |
|---|---|---|
| 符号跑期间 `env.vars[param]` | 被提升后的 Abs（fn：shape.paramTypes/returnType；值形参：arr 等） | run 局部，随 env 丢弃 |
| `PolyFn.fnRels` / `entryShapes` | symbolic **正常结束时** env 中已提升形参 Abs 的**快照** + `RelSource` | 挂 PolyFn，随 L0 |
| Abs 自身 `shape.paramTypes/returnType` | 同一份关系数据（fn） | 同上 |

纪律：快照不是第二套类型。symbolic 结束时从 env **拷贝**（新对象，不是共享引用）；
`instantiate` 重跑只读不写。

触发条件用**身份判定**，不用形状判定：

- 被调值是 `Identifier` 且名字 ∈ `paramNames` → 应用点。
  不要写 `shape.k === "fn"`——形参入口绑定是 `any`（§2），按形状判定一条都收不到。

则记录 `HofSite`，并令返回值带上：

```ts
abs(
  shapeFromUsage,                 // 若未知则 any
  term: termVar(`B:${param}`),    // 共享输出变量（见下方钉死规则）
  pred: pTrue / 从 body 单调性推出,
  conf: "path",
)
```

**返回侧 term 形态（P2 钉死，禁止实现者二选一）：**

| 决策 | 内容 |
|---|---|
| **P2 采用** | 共享输出变量 `var("B:${param}")`。同一形参的所有应用点共用一个 β；`instantiate` / dts 投影 / 展示都读这个 id。 |
| **P2 不做** | `app(paramName, argTerms)` 依赖 term 的形态。它能按实参区分输出，但引入第二套返回身份，与 `substAbs` / format / L2 memo 的交互未设计。 |
| **观测表对齐** | §5.2.1 的 `returnType=fresh β` 即 `var("B:${param}")`（或 collector 分配的等价 id，须并入本次 α 空间供 format/dts 使用）。 |
| **多观测** | 同一形参第二次应用**不改** returnType 的 β id（arrival-first，见 §5.2.3）；argTerms 只进 `hofSites`，不进 returnType term。 |

理由：共享 β 实现最短、展示稳定、与「无调用点也能归纳关系」的目标一致；按实参区分输出是精度增强，等 P2 稳定后再评估，不在本期开口子。

### 5.2 使用驱动的形参形状提升（relation 的生产端）

`generalizeFromAstUncached` 的 symbolic 跑 body 过程中，**只在观测到**下述语法使用时
提升形参形状——绝不预置（§10 假关系纪律）。提升是 **单 pass、替换 env 项**
（不是 mutate 共享对象，见 §5.2.0b）：发生在各 fallback 放弃前，拿到新形状后继续正常分支，
不需要二次重跑。

#### 5.2.0 提升 hook 的唯一挂载点（P2 实现索引）

P2 最大的实现风险是「只挂在 map 分支」。提升 hook **仅允许**出现在下列三处，
其余位置禁止旁路实现：

| 挂载点 | 位置 | 触发 |
|---|---|---|
| **方法派发 miss** | `ast-eval` 方法查找、`exec/class.invokeArrMethod` 入口 | receiver 是形参 Identifier，shape 为 `any`/未知，方法名为 filter/map/reduce/flatMap |
| **CallExpression callee** | `evalNode` CallExpression 路径（Identifier ∈ paramNames） | 直接调用 `p(x)` / `p(a,b)` |
| **HOF 回调实参** | `applyCallbackAbs`（或 map/filter/reduce/flatMap 调用它之前） | 回调是 Identifier ∈ `paramNames`，尚未有 fn 形状 |
| **for-of 迭代对象** | `evalForOf` 入口 | `for (const x of items)`，`items` ∈ paramNames 且仍 any/unknown → `arr(自身 var)`（`applyEach` 型；不依赖方法名） |

**为何必须有第三挂载点：** 主路径 `items.filter(filter).map(transform)` 的求值顺序是——

1. `items` 为 `any` → `.filter` method-miss → 按挂载点① 提升 `items` 为 `arr(A1)`
2. 落入正常 filter/map 分支，对 `filter`/`transform` 调 `applyUnaryCallback` / `applyCallbackAbs`
3. 此时 **receiver 已是 arr，不再是 method-miss**；callee 也不是 CallExpression
4. 若无挂载点③，回调形参无法提升 → 仍 unknown，观测表里 `arr.filter(p)` 一行落空

挂载点① 与③ **同 pass 串联**（items 先提、回调再提），不二次重跑。refine 已给 items 挂上 `arr` 时，步骤 1 的 miss 不发生，步骤 3–4 仍靠③ 提升回调形参。

约束：

1. hook 发生在 **fallback 放弃前**（方法 miss 返回 unknown 之前 / `applyCallbackAbs` F 之前），拿到新形状后**继续正常分支**，不 return、不二次重跑；写入按 §5.2.0b 替换 map 项。
2. `filter`/`reduce`/`flatMap` 的 miss 与 `map` **同级**，不得只处理 map；挂载点③ 对四者同样生效。
3. 非内建 HOF（`withRetry` 的 `p()`、`applyEach` 的 `fn(x)`）只靠 CallExpression 挂载点，**不依赖**方法名。
4. for-of 迭代对象提升与 `p()` 直接调用同属 P2 必覆盖（§11.1.D `applyEach`）；`items` 提升走 for-of 挂载点，`fn` 提升走 CallExpression。
5. 提升 **只写** `env.vars[param]`（见下方载体纪律），**禁止** `attachFnImpl`（§3.3 写入载体分工）；否则 E 路径死代码。

#### 5.2.0b 提升写入载体：替换 map 项，禁止 mutate 共享 Abs

symbolic 跑时 `local.vars.set(p, args[i])` 与 `typeParams[i].value` **初始是同一 Abs 对象**。
若对 shape 做原地 mutate，会连带改写 PolyFn 上的 typeParams，并与 L0 memo / 展示产生别名事故。

**唯一合法写法：**

```ts
const prev = env.vars.get(param)!;   // 通常是 anyVar(A1) 之类
const next: Abs = {                  // 新对象
  shape: promotedShape,              // 如 { k: "fn", params, paramTypes, returnType } 或 { k: "arr", element }
  term: prev.term,                   // α 身份不变
  pred: prev.pred,
  conf: "path",                      // 提升产物禁止 exact
};
env.vars.set(param, next);           // 替换 map 项，不 mutate prev
```

- **禁止** `prev.shape = …` 式原地改写。
- 值形参（`items → arr(A1)`）与函数形参同样替换 map 项；函数形参另拷入 `fnRels`，
  值形参另拷入 `entryShapes`（均在 symbolic **正常结束时**，带 `RelSource = "promote"`）。
- `typeParams[i].value` **保持原 any(α)**；展示走 `entryShapes`/`fnRels`，不读被改脏的 typeParams。
- `@nudo:refine` 已给契约形状时：不提升；若需展示契约 shape，写入 `entryShapes` 且
  `source = "refine"`（来自 `constraintToEntryAbs` 的那份 Abs）。

#### 5.2.1 观测表

| 观测到的使用（p 为形参 Identifier） | 提升为（写 `env.vars` 新项，见 §5.2.0b） |
|---|---|
| `p(x)` 直接调用 | `fn(paramTypes=[αOf(x)], returnType=B:param)` |
| `p(a, b)` 直接调用 | `fn(paramTypes=[αOf(a), αOf(b)], returnType=B:param)` |
| `arr.filter(p)` | `fn(paramTypes=[αOf(arr.element)], returnType=boolean)`（内建知识） |
| `arr.map(p)` | `fn(paramTypes=[αOf(arr.element)], returnType=B:param)` |
| `arr.reduce(p, init)` | `fn(paramTypes=[αOf(init), αOf(arr.element)], returnType=B:param)` |
| `arr.flatMap(p)` | `fn(paramTypes=[αOf(arr.element)], returnType=B:param)` |
| 形参本身（`any` 形状）上有 `.filter/.map/.reduce/.flatMap` 派发 | 见 §5.2.3；成功则 `arr(自身 var)`，按 arr 分支继续 |
| 未使用 / 仅转发 / 仅 `p.foo` 访问 | 不提升、不写 fnRels |

表中 `B:param` 记法 = term `var("B:${param}")`，即该形参的共享输出变量（§5.1）。

#### 5.2.2 `αOf`：term 复用白名单（防把局部具体值冻进关系）

```ts
/** 仅当 term 是 var 且 id ∈ alphaIds（本次 typeParams）时复用；否则 fresh α */
function αOf(absOrTerm: Abs | Term | undefined, ctx: HofCollectCtx): Term {
  const t = isAbs(absOrTerm) ? absOrTerm.term : absOrTerm;
  if (t?.op === "var" && ctx.alphaIds.has(t.id)) return t;
  return freshAlpha(ctx); // 如 `T${n}`，并入 alphaIds
}
```

| 场景 | 正确 | 错误 |
|---|---|---|
| `items.filter(filter)`，items 已提成 `arr(A1)` | filter → `fn([A1], bool)` | — |
| `const xs = [1,2,3]; xs.map(transform)` | transform → `fn([T1], B1)`（fresh） | `fn([1], B1)` 把字面量冻进签名 |
| 本地 `arr(number)` 的 element.term 为具体 var/无 term | fresh α | 直接用 element.term |

**α 对齐性质仍成立**（在白名单内）：`items.filter(filter)` 提升 filter 时
`arr.element.term` 就是 items 提升出的同一个 `A1`（`A1 ∈ alphaIds`），无需事后对齐。
白名单外的 term 一律 fresh，**绝不**把调用点具体值写进 fnRels。

#### 5.2.3 first-wins 与冲突裁决（arrival-first，禁止回滚）

同一形参在一次 symbolic 跑中可能被观测多次。裁决规则是 **arrival-first**：

> **谁先被 eval 到，谁定形状；冲突时拒绝新观测，不回滚。**

**不是**「源位置更前优先」。抽象解释在分支上可能两支都跑；若写成
「loc 更前必须回滚」，循环回边与 L2 重放会引入回滚语义，实现面和确定性都更差。
求值顺序在单次 run 内由 AST/控制流决定，对同一源码是确定的；签名依赖
「本次 run 的观测顺序」，**不依赖** loc 比较——loc 只用于 diagnostics 展示，不进裁决。

| 已有 | 新观测 | 动作 |
|---|---|---|
| 无（`any`） | 提升为 `fn` 或 `arr` | 接受，写入 env / 快照槽 |
| 已是 `fn` 或 `arr` | 任意后续观测（含源位置更前的回边） | **拒绝新观测**，保持已有形状；可记 `hofSites` / diagnostic |
| 已是 `fn` | 再次同形 `p(x)`（仍是 fn） | 不改 paramTypes/returnType；可记 `hofSites` |
| 两观测 **无 loc** | 任意冲突 | 同上：先到先赢；loc 缺失**不**改变裁决，只影响 diagnostic 质量 |
| `@nudo:refine` 契约已有 shape | 任意提升 | **契约优先**，不提升、不写 fnRels |

实现建议：collector 在方法 miss / CallExpression / 回调入口拿到 Node 时带 `loc`；
裁决函数**只**比较「是否已有形状」，**不比较** `(line, column)`。loc 仅写入
`hofSites` 供 hover/diagnostics。**禁止**用「Map 插入顺序 = 源顺序」假设；
**禁止**根据 loc 做回滚。

理由：先 eval 到的用法是本次 symbolic 路径上的主导角色；冲突拒绝保证形状单调；
无回滚则 L0/L2 缓存与重放语义简单可证。若两支用法本质冲突（先 arr 后 fn），
后到的 call-miss 走 unknown——诚实，不 join 成怪类型。

**与「源位置 first-wins」的差异（迁移说明，v6）：** v5 文案写「按 loc、不按 eval 顺序」，
但冲突表在「更前 / 更后」两行都拒绝新观测，实际已是 arrival-first。v6 删除 loc 裁决
表述，与表一致，避免实现者按正文写回滚。

#### 5.2.4 方法名提升的假阳性边界

形参上的 `.filter/.map/.reduce` 派发 **不足以** 证明它是 JS Array——自定义
Collection 也有同名方法。纪律：

1. 有 `@nudo:refine` → 契约优先，不靠方法名提升。
2. 无契约时允许提升，但 conf 至少 `path`（禁止 exact）；展示不写 `#exact`。
3. 同时存在「当函数调用」的观测 → 按 §5.2.3 拒绝后到的那种形状（不 join 成怪类型）。
4. 若后续在 body 中又观测到明显非数组行为（如 `p.push` 之外的独占 obj 槽），
   本次仍 arrival-first，不在同一 pass 里回滚——错误形状的风险由 conf 与 check 豁免吸收。

#### 5.2.5 其余性质

- **§1.2 必要条件**：`items.filter(...).map(...)` 里 `items` 入口绑定是 `any(A1)`，
  不提升出 `arr(A1)` 的话 `.filter` 走 dispatch-miss → unknown、链断。
  提升方式见 §5.2.0b（替换 `env.vars` 项，进 `entryShapes` 快照）。
- **回调形参靠挂载点③**：`filter`/`transform` 的提升发生在 `applyCallbackAbs`
  入口（Identifier ∈ paramNames 且尚无 fn 形状），与挂载点① 同 pass 串联；
  items 经 refine 已是 arr 时①不触发，③仍必须生效（§5.2.0）。
- 有 `@nudo:refine` 入口契约时**契约形状优先**，不重复提升（`constraintToEntryAbs`
  已挂 shape+pred；`entryShapes` 可记 `source="refine"`）。
- 提升对 `instantiate` 的重跑同样生效（纯函数、run 局部），使嵌套 HOF
  （`caller(items) { return processItems(items, x=>x*2, x=>x>0) }`）的调用点也拿到
  `arr(β)`；但 fnRels/entryShapes/hofSites 只在 symbolic **一次正常跑**沉淀（§5.1）。
- 提升只作用于 shape 为 `any`/未知的形参；调用点已绑定的**具体** `arr`/`fn` 不改写
  （arrival-first 表的「已有 → 拒绝新观测」覆盖此情形）。
- for-of 迭代对象提升与 `p()` 直接调用均已覆盖（见 §5.2.0；`applyEach` 正例）。
- **分支合流**：见 §5.2.3 —— arrival-first；已有形状不被后来的冲突观测改写。
- **形参别名**：本地 `const p = filter` 后 `items.map(p)` **不提升**（`p ∉ paramNames`）；见 §1.3。

### 5.3 展示（P2 显式交付，不是附带）

现状 `formatPoly` 只打 α id（`items: A1`），**不读**提升后的 shape；`formatShape` 的
fn 分支也 **不打印 paramTypes**，且 `formatShape(returnType: Abs)` 只渲染 shape、丢 term，
因此 `fn(A1) => B1` 目前渲染不出来。§12 的 format 改动必须一并交付。

目标：

```text
processItems: (items: arr(A1), transform: fn(A1) => B1, filter: fn(A1) => bool) => arr(B1)
```

规则：

| 情形 | 打印 |
|---|---|
| 该形参在 `entryShapes` / `fnRels` 有提升快照 | 完整 `formatShapeRel`（见下） |
| 无提升 / 仅 any(α) | 保持现状短形式：`items: A1` |
| `@nudo:refine` 契约 | 契约 shape（`source="refine"`），可附 where pred |

`formatShape` fn 分支需扩展（**阻塞 P2 展示**；P1 的 `relationFn` 测试即覆盖）：

```ts
// 1. paramTypes 有槽时打印类型而非仅参数名
// 2. 槽内 Abs 与 returnType Abs 都必须走「含 term」渲染
//    —— 不能只调 formatShape：它对 returnType 目前只渲染 shape、丢 term
//    例：(A1) => B1，而不是 (any) => any
// 3. paramTypes 缺失时保持现状 (x) => ?
// 4. 展示不渲染 conf 徽章；#exact 仅当 conf 为 exact
```

**含 term 的 fn 槽渲染建议：** 抽一个 `formatShapeSlot(abs)`：`formatShape(abs)` + 非 lit term 时 `termToString(abs.term)`。paramTypes 每个槽与 returnType 共用它。禁止在 format 里内联复制 term 逻辑。

无关系时保持现状短展示。展示 **不渲染 conf 徽章**；`#exact` 仅当 conf 为 exact
（提升产物默认 path，不会误标）。`relationFn` 双写 shape 后，P1a/P1b 的 format 测试
即可覆盖 `fn(A1) => B1`，不依赖 P2。

---

## 6. 与 `nudo check` 的交互

### 6.1 不改门禁问题

`checkSource` 仍是 **Pred 蕴含**（调用前置 / 返回 refine / assign leq）。  
HOF 关系 **不发明新的 error code**。

### 6.2 签名更准 → 更少误报/漏报

| 场景 | 无关系 | 有关系 |
|---|---|---|
| `processItems(xs, f, g)` 后 `r.map` | 返回 `unknown[]`，成员访问可漏报 `no-method` 或吞掉 | `arr(β)`，`r[0]` 类型有信息 |
| 对 HOF 实参结构检查 | 无法要求 `transform` 可调用 | `arg-structure` 可要求实参是 `fn` 且 arity 匹配（Phase 4，含 §6.3 豁免规则） |
| `@nudo:refine return` | symbolic 为 unknown，返回契约**不可证**（假阴） | symbolic 为 `arr(β)` 等更精形状，可证性只增不减；残余假阴来自 β 无约束（诚实不编造，可接受） |

### 6.3 check 对 HOF 实参的新增检查（Phase 4）

在现有 `checkCall` 旁增加 **arity / shape-fn**：

```text
processItems(xs, notAFunction, g)
  → ERROR nudo:arg-structure
       expected: fn (1 param) ⇒ ?
       actual:   number  #exact
```

目标形状用 `leqAbs` 思路：`src ≤ fn(paramTypes, returnType)`（逆变参数、协变返回，
已有骨架，`leq.ts:247`）。但 **arity 严格相等**（`leq.ts:250`）对 JS 太严——JS 允许
多余实参。此检查用自定义放宽比较（`src.params.length >= tgt.params.length`），
不直接喂 `leqAbs`。

**零误报豁免规则（设计约束，不是实现细节）**——JS 生态 `string | fn` 多态 API
（commander / express 遍地）会让此检查大面积误报：

- 实参 Abs 为 `any` / `unknown` / 无信息 → 跳过；
- 实参是 `sum` 且任一 member 满足目标 fn 形状 → 通过；
- 实参有 `getFnImpl`（真实 body）→ 跳过（本检查只管"形状不完整"的实参）；
- 签名来源是提升（`fnRels` 中 `RelSource === "promote"`），而非用户 `@nudo:refine`
  契约或 harvest `relationFn` → 报 **warning** 而非 error。  
  **来源判定读 `RelSource` 标记，禁止**从 shape 是否含 var 反推。

违反豁免 → 金标 / commander 零误报门禁必然回归。豁免规则与 P4 同合入、同测试。
P2 落地 `fnRels` 时必须带 `source` 字段，否则 P4 此条无法实现——不是 P4 再补。

**P4 error 分支现状（诚实边界）：** constraint 语言目前**无法**表达 fn 形状的
`@nudo:refine`，因此 `source === "refine"` → **error** 路径暂不可经 `checkSource`
触发；已合入的可测行为只有 promote → **warning**。refine 能表达 fn 后再补
error 单测；在此之前 release note **不得**声称「refine 违约会 error」。

### 6.4 报告字段

`--json` 的 `signatures[].abs` 自动带上关系（formatAbs 输出）。  
`intension.abs` 同步。**version 仍为 1：只增展示信息，不改契约语义。**

---

## 7. dts / Agent 投影（侧信道）

`absToTypeValue` / dts-generator：

```text
fn(paramTypes=[A1], returnType=B1)  with  A1,B1 as poly vars
  →  TS: <A1, B1>(...args) => B1
  或  (args: A1) => B1  当签名单独导出时用泛型函数声明
```

主要工作量是 **α 作用域判定**（哪些 var 是该签名的泛型参数、哪些是自由变量）——
复用 `generalize.ts` L2 已有的 `collectTermVars` / α-rename 基建，不自造。

Agent `nudo.infer` / `nudo.hover`：在 `intension` 已有无损 Abs 时 **无需新协议**；  
可选在 human text 里多一行 `hof: transform: A1 => B1`。

**LSP / hover 读槽纪律（P2 起，阻塞展示不一致）：**

| 消费方 | P2 后读哪 |
|---|---|
| CLI `formatPoly` / `nudo types` | `PolyFn.display` / `entryShapes`+`fnRels`（§5.3） |
| LSP hover 的 **intension 侧** | 同上（Abs / formatPoly），**不读** TypeValue 的 fn 形状 |
| LSP hover 的 **TypeValue 侧** | P5 之前仍是 arity-only 投影——**不得**当作权威关系源 |

实现：`getHoverAtPosition` 在**函数名/调用 callee 位置**先取 `generalizeFromAst` →
`g.display` 作 **intension**，**再落** B-path / TypeValue 得到 typeText（调用点显示
结果类型，不是函数签名），最后把 intension 合并进结果。禁止 B-path 的 arity-only
fn Abs 早退顶掉 intension，也禁止用 intension 顶掉调用点的结果类型。

若 hover 在 P2 仍读 TypeValue，会出现「CLI 显示 `fn(A1)=>B1`、LSP 显示 `(x)=>?`」的不一致。
P2 退出标准含：LSP 关系相关展示走 intension，或明确标记 extensional 侧尚未投影。

---

## 8. 分期落地

### 8.1 主分期

| Phase | 内容 | 退出标准 |
|---|---|---|
| **P1a 关系原语** | `substAbs` / `instantiateReturn` / `isRelFn` / `relationFn` 纯函数（不接线） | 见 §8.2 P1a；可独立合入 |
| **P1b ast-eval map 接线** | 调用门 + `applyCallbackAbs` + map 认 relation + format 断言 | 见 §8.2 P1b |
| **P1c 双路径 + 其余 HOF** | filter/reduce/flatMap + `$call`/`exec/class` + sum 回调 | 见 §8.2 P1c；双路径一致性 |
| **P2 关系生产（generalize）** | §5.2 使用驱动提升 + `αOf` 白名单 + arrival-first；`hofSites`/`fnRels`/`entryShapes`（局部 collector + RelSource）；`formatPoly`/`formatShape` 关系展示；check 签名带上关系；LSP hover 读 intension（§7） | 见 §8.3；无关系的函数展示不变 |
| **P4 check 强化** | HOF 实参 arity/shape 检查（§6.3 豁免规则同合入；依赖 P2 的 RelSource） | 金标不回归；commander 仍零误报 |
| **P5 dts 投影** | 泛型函数 `.d.ts`（α 作用域复用 L2 基建） | emit-tsc-roundtrip 覆盖 HOF |

P1a+P1b+P1c+P2 关闭 `design-limitations.md` 2.1 的主路径（symbolic 归纳 + relation-only 调用点）；  
无任何关系信息时 **仍保持 unknown**（诚实，不编造）。  
跨文件自动归纳不在本期（§1.3）；过渡期用户可写 `@nudo:refine` 契约（契约优先，见 §5.2.3）。

### 8.2 P1 交付清单（关系槽消费，可独立合入）

> **P1 的用户可见收益边界：** P1 只消费关系，不生产。主路径 `processItems`
> 的自动归纳要等 P2；P1 期间关系来源仅限 harvest / mock / `relationFn()` 构造。
> 主路径 fixture 用 `relationFn` **手造**，不要写成「generalize 已能归纳」。
> Release note 建议标为 internal foundation，避免用户预期「HOF 已会推断」。
>
> **为何拆 P1a/b/c：** 合成一个 PR 体量过大（原语 + 四入口 + 四方法 + format + 双路径），
> review 与回滚成本高。a 纯函数最快落地；c 的双路径是回归主雷区，单独合入。

#### P1a — 关系原语（纯函数，不接调用点）

实现：

1. `hof.ts`：`isRelFn`（按 §4.1 收紧 + 名实说明）+ `instantiateReturn` + `substAbs`（含 pred 三条规则 + 重复 α 先绑定保留）
2. `abs-fn.ts`：`body?` + `relation?` + `relationFn()` 构造器（**双写 shape + impl.relation**；默认 conf=`path`，fingerprint 必填/自动生成）
3. call-budget 键适配：无 body 用 `impl.fingerprint`，**禁止** returnType 兜底（§3.3）

P1a **不**改任何调用门、不接 map、**不**改 `formatShape`（展示级 term 渲染在 P1b）。可独立合入、独立回滚。

**P1a 测试矩阵：**

| 维度 | 取值 |
|---|---|
| substAbs term | `instantiateReturn(fn(A1)=>B1, [number])` 后 term 仍为 `B1` |
| substAbs pred | 自由 α（B1）上的 pred 原样保留；map 内 var + shape-only 实参 → pred→true + conf 降级 |
| substAbs 重复 α | `paramTypes=[A1,A1]` + `[number,string]` → `A1:=number`（先绑定保留） |
| isRelFn 负例 | 有 returnType 但 paramTypes 与 arity 不对齐 → 不算 rel；有 impl → 不算 rel |
| conf | `relationFn()` 默认 `path`，不出现 `#exact` |
| call-budget | 两个 returnType 同为 `B1` 的 `relationFn`，budget 键不撞车（靠 fingerprint） |
| 双写 | `relationFn` 后 **shape 对象**上已有 `paramTypes`/`returnType` 槽（P1a 用字段断言；展示级 format 含 term 属 P1b） |

#### P1b — ast-eval map 接线

实现：

1. `applyCallbackAbs`（Identifier 解析层 + A–F + **sum union 分支**）
2. **调用门扩为** `getFnImpl || isRelFn`（§4.1）；`applyAbsFn` / Identifier CallExpression / `applyUnaryCallback` 入口条件同步
3. `map` 认 relation（body 优先；仅 relation 时 `instantiateReturn`）；tuple 精确路径不动
4. `formatShape` fn 分支认 paramTypes/returnType **含 term**（§5.3）

Identifier 解析按 §4.1 纪律：ast-eval **保留** `env.fns`。

**P1b 测试矩阵（map 专项 + 门）：**

| 维度 | 取值 |
|---|---|
| 容器 | tuple（保精确） / arr |
| 回调形态 | 内联箭头 / Identifier 有 impl / Identifier 仅 relation（shape-only E） / Identifier `relationFn`（D） / Identifier 经 `env.fns` / 非 fn / **函数 union** |
| impl 共存 | body + relation 共存 → body 胜出 |
| 调用门 | 纯 shape 提升（无 impl）经 map 走 E，与 D 结果一致 |
| format | `relationFn([A1], B1)` 展示含 term；双写漏 shape 红 |
| 负例 | 无 returnType 的裸 fn → 仍 unknown |

主路径 fixture（手造）：`processItems(arr(α), fRel, gRel)` → `arr(β)`（可先只走 map 段）。

#### P1c — 双路径 + 其余 HOF

实现：

1. `filter`/`reduce`/`flatMap` 认 relation（与 map 同优先级：body 胜出）
2. `exec/class.invokeArrMethod.callFn` / `exec/call.$call` 委托 `applyCallbackAbs`；**调用门**同步扩条件
3. Identifier 解析：exec **不**强行新增 `env.fns`（§4.1）
4. 可选：`forEach`/`find`/`some`/`every`

**P1c 测试矩阵：**

| 维度 | 取值 |
|---|---|
| 方法 | map / filter / reduce / flatMap（+ 可选 forEach 等）——各至少一条 relation-only |
| 路径 | ast-eval 与 B-path（`$call`）**关系处理**一致；ast-eval 的 `env.fns` 行为不回归 |
| 调用门 | 纯 shape 提升经 map 与 `$call` 均走 E，与 D 一致 |
| reduce | 仅 relation → `join(init, δ)` 一次，不动点仍只在有 body 时跑 |
| flatMap | relation 返回 `arr(γ)` → element=γ；否则 unknown |

主路径 fixture：`processItems(arr(α), fRel, gRel)` → `arr(β)` 完整走 filter+map。

**测试落盘：**

| 文件 | 内容 |
|---|---|
| `packages/core/src/algebra/__tests__/hof-relation.test.ts` | P1a 原语 + P1b map 接线 + relation-only |
| 同上或 `hof-relation-paths.test.ts` | P1c 双路径一致性（ast-eval vs `$call`） |

不要把 P1 关系用例零散追加进现有 `hof.test.ts`（该文件钉的是内联回调 + 具体实参）。

### 8.3 P2 退出标准（补充）

正例：

- `generalizeFromAst("processItems")`：symbolic 为 `arr(B1)`，display 含
  `items: arr(A1)`（来自 `entryShapes`） / `transform: fn(A1)=>B1` / `filter: fn(A1)=>bool`（来自 `fnRels`）
- 非内建 HOF：`withRetry(fn) { return fn(); }` → 返回 term 为 `β`；
  `applyEach(items, fn)` → items 提成 `arr(A1)`，fn 提成 `fn([A1], B1)`
  （靠 §5.2.0 CallExpression 挂载点，不依赖方法名）
- 方法链：`items.filter(g).map(f)` 在 **map / filter / reduce / flatMap** 各至少一条
  （禁止只测 map）
- 嵌套：`caller(items) { return processItems(items, x=>x*2, x=>x>0); }` 调用点得 `arr(number)`
- 快照：`fnRels`/`entryShapes` 的对象 **不是** `env.vars` 中同一引用（deep-equal 可、`===` 不可）
- 来源：无 refine 时 `source === "promote"`；有 refine 时 `source === "refine"` 且不重复提升

负例（禁止提升 / 禁止写入 fnRels）：

- 未使用的形参
- 仅转发：`function id(f) { return f; }`
- 仅属性访问：`function g(f) { return f.length; }`
- 有 `@nudo:refine` 时：不重复提升
- 局部具体数组 + 回调形参：paramTypes 必须是 fresh α，不是字面量
- `typeParams[i].value` 在提升后仍为原 any(α)（禁止 mutate 别名）

冲突例（arrival-first，见 §5.2.3）：

- 同一形参先 `arr.filter(p)` 再 `p(x)`：保持 `fn([A1], bool)`（先到的 filter 提升胜出）
- 分支两用：**先 eval 到**的观测定形状；后到的冲突观测拒绝，**不**按 loc 回滚
- 无 loc 的观测：裁决与有 loc 时相同（arrival-first）；loc 缺失只影响 diagnostic
- symbolic 截断 / 不可缓存：`fnRels`/`entryShapes`/`hofSites` 均为 undefined

挂载点覆盖（§5.2.0）：

- 方法 miss：至少覆盖 map/filter/reduce 各一条 receiver=形参 `any` 的提升
- 直接调用：`withRetry` 的 `p()` 一条
- HOF 回调实参：`items` 经 refine 已是 `arr`（无 method-miss）时，`items.map(transform)` 仍能把 `transform` 提成 `fn([A1], B1)`——专测挂载点③ 不依赖①
- 同 pass 串联：`items.filter(filter).map(transform)` 一条里 items 与 filter/transform 均被提升，fnRels 含三项、entryShapes 含 items

### 8.4 P3 callsites 经验泛化（**暂缓，不入主分期**）

> 状态：**独立设计，P2 有 unknown 叶子基线后再评审。**

原表格把它写成一行是不够的——本质是 anti-unification，未决问题至少包括：

- 收集多少 callsite / 何时停止（L0 TTL？N 次？）
- `(α_i, β_i)` 的 join / LGG 格
- 少数 callsite 过拟合产生的假关系如何防止
- 与 L1/L2 instantiate memo 的交互

在单独设计成文并评审前，**不实现**；避免把「从调用点猜签名」混进关系 Abs 主路径。

---

## 9. 伪代码串场（目标行为）

```js
// —— 无 body 的关系回调（harvest / 符号入口）——
// transform: fn(A1) => B1
// filter:    fn(A1) => bool
// items:     arr(A1)

items.filter(filter)   // → arr(A1)          (filter 不改 shape)
       .map(transform) // → arr(B1)          (map 用 returnType)

// —— generalize 展示 ——
// processItems: (items: arr(A1), transform: fn(A1) => B1, filter: fn(A1) => bool)
//               => arr(B1)

// —— 非内建 HOF ——
function withRetry(fn) { return fn(); }
// fn: fn() => B1；返回 term = B1

function applyEach(items, fn) {
  for (const x of items) fn(x);
}
// items: arr(A1)，fn: fn(A1) => B1；返回 undefined

// —— check ——
processItems([1,2,3], (x) => x * 2, (x) => x > 0)
// 调用点 instantiate：A1=lit/number → transform 有 body → B1=number
// 若 transform 仅 relation 且返回 refine 冲突 → 仍可检

processItems([1,2,3], 42, null)
// ERROR arg-structure: expected fn, actual number / null

// —— 局部数组不冻进关系 ——
function scaleFirst(transform) {
  const xs = [1, 2, 3];
  return xs.map(transform)[0];
}
// transform: fn(T1) => B1，不是 fn(1) => B1
```

---

## 10. 风险与纪律

| 风险 | 缓解 |
|---|---|
| 假关系（未使用却预置 fnRels） | 只在观测到应用点后写入；未观测不写（§5.2） |
| 形状误提升（把普通 `any` 当 arr/fn） | 身份判定：仅本次归纳形参才可提升；`@nudo:refine` 契约形状优先（§5.2.3） |
| 方法名假阳性（自定义 Collection 也有 `.filter`） | conf≥path，不标 exact；契约优先；见 §5.2.4 |
| 局部具体 term 冻进签名 | `αOf` 白名单：非 typeParams var 一律 fresh α（§5.2.2） |
| 同一形参冲突提升 | arrival-first：先到定形状，后到拒绝，禁止 loc 回滚（§5.2.3） |
| 形参别名漏提升 | 明确不做（§1.3）；禁止实现者顺手加别名追踪 |
| sum 回调在统一后掉成 unknown | `applyCallbackAbs` 内 sum 分支（§4.1）；P1b 测试矩阵含函数 union |
| 重复 α 静默覆盖 | `instantiateReturn` 先绑定保留；生产端尽量不写重复 id（§4.3） |
| `substAbs` 误丢未映射 var | var∉map **原样保留**；单测钉 `B1` 存活（§4.3） |
| α 替换丢 pred | 按 §4.3 pred 三条规则：自由 α pred 原样保留；仅「map 内 var + 无 term 实参」才降 true + conf 降级 |
| `isRelFn` 过宽（半截签名冒充关系） | paramTypes 缺失仅零参允许；存在则必须与 arity 对齐（§4.1） |
| `relationFn` 默认 exact 污染 gold | 默认 `conf="path"`，禁止对齐 `absFunction`（§3.3） |
| 双路径分叉（map 认了、$call 不认） | D/E 单点 `hof.ts`；P1c 四入口全接 + **调用门** `getFnImpl \|\| isRelFn` + 双路径一致性测试（§4.1） |
| 统一时误改 Identifier/`env.fns` 行为 | Identifier 解析层显式纪律：ast-eval 保留、exec 不强行新增（§4.1） |
| P2 提升 hook 只挂在 map 分支 / 漏挂回调实参 | 挂载点三处写死：方法 miss + CallExpression callee + **HOF 回调实参**；filter/reduce/flatMap 同级；①③ 同 pass 串联（§5.2.0） |
| body 可选后 call-budget 键失效 | 无 body 时 **必须** `impl.fingerprint`（`relationFn` 自动序列化）；**禁止**用 returnType/params 兜底 identity（§3.3） |
| 提升误挂 impl 导致 E 路径死代码 | 提升只写 shape 槽，禁止 `attachFnImpl`；`relationFn` 才走 impl.relation（§3.3 写入载体分工） |
| 提升 mutate 共享 Abs（typeParams 别名） | 替换 `env.vars` 项、新对象；禁止原地改 shape（§5.2.0b） |
| `relationFn` 只写 impl、format 读不到 | 双写 shape + impl.relation；P1a format 断言（§3.3 / §8.2） |
| 半截 fnRels 落上 PolyFn | `conf === "opaque"` → 快照置空（§5.1） |
| 用 `isCacheableAbs` 当 run 成功代理 → partial（for-of/join）误丢 fnRels | 门禁改为 `conf !== "opaque"` 才沉淀；partial 保留提升（§5.1） |
| filter 后被当 bug 加 pred 传播 | 能力上限写死：element pred 不增强；改动须重开设计（§4.2 filterArr） |
| fnRels / env / shape 三处漂移 | 快照语义 + RelSource；禁止第二套类型（§5.1） |
| P4 无法区分 promote/refine | `RelSource` 在 P2 一并落地，禁止 shape 反推（§3.2 / §6.3） |
| 组合爆炸（多 HOF） | 关系不展开笛卡尔积；保持 term 符号，仅应用点替换 |
| 与 TypeValue 双轨 | 关系只活在 Abs；TypeValue 仍是投影 |
| check 回归 | 金标 + commander 零误报门禁不变；P4 前不改 error code；P4 自带 §6.3 豁免规则 |
| 全局 collector 串状态 | 不用全局单例；collector 走 `run` 局部上下文字段（非 Phi），仅 symbolic 一次跑安装（§5.1） |
| P3 假关系 | 暂缓，单独设计（§8.4） |
| 跨文件误以为已归纳 | §1.3 明确不做；靠 harvest/env（§1.3） |
| 性能 | generalize L0 memo 已有；hofSites/快照挂在 PolyFn 上，随 L0 失效；提升单 pass，无二次重跑 |

---

## 11. 与 TS 泛型对照（设计定位）

| | TS 泛型 | 本设计 |
|---|---|---|
| 表面语法 | `<T,U>` / 条件类型 | **无**新语法 |
| 关系载体 | 类型语言里的签名 | Abs fn 形状 + term var/app |
| 实例化 | 合一 | `instantiate` / `substAbs` / 重跑 body |
| 值约束 | 无（外挂） | 既有 Pred，可挂到 α |
| 无调用点 | 签名完整 | body 已知则归纳；否则 harvest/relation-only（callsites 经验泛化另议） |
| Soundness | checker | 仍非 checker |

### 11.1 应用层对照：同一段 JS，两种「类型从哪来」

用户源码**一行不改**。差别只在：TS 靠用户/声明文件写签名；Nudo 靠 body 使用观测归纳出关系 Abs。

#### A. 内建 HOF 组合（§1.2 主路径）

**用户 JS（两边完全相同）：**

```js
function processItems(items, transform, filter) {
  return items.filter(filter).map(transform);
}

const r = processItems([1, 2, 3], (x) => x * 2, (x) => x > 0);
```

**TS 侧（用户必须先写泛型，否则 `r` 是 `any`/推断不全）：**

```ts
function processItems<T, U>(
  items: T[],
  transform: (x: T) => U,
  filter: (x: T) => boolean,
): U[] {
  return items.filter(filter).map(transform);
}

// 调用点：T=number, U=number（合一）
const r = processItems([1, 2, 3], (x) => x * 2, (x) => x > 0);
//    ^? number[]
```

**Nudo 侧（无新语法；关系由 §5.2 提升 + P1 消费）：**

```text
# 归纳签名（fnRels，非用户书写）
processItems: (items: arr(A1), transform: fn(A1) => B1, filter: fn(A1) => bool) => arr(B1)

# 调用点 instantiate（重跑 body / α 替换）
A1 := number（来自 [1,2,3]）
transform 有 impl → 跑出 number，对齐 B1
r: arr(number)
```

对照要点：

| | TS | Nudo |
|---|---|---|
| 关系写在哪 | 用户 `<T,U>` 或 `.d.ts` | body 观测 → `fnRels` |
| 无调用点 | 签名仍在（只要用户写了） | body 已知也能归纳出 `A1→B1` |
| 用户没写签名 | 多为 `any` / 不完整 | 同样是 plain JS，自动提升 |
| 调用点 | 编译期合一 | `instantiate` / `substAbs` |

#### B. 值约束：Pred 挂到 α（TS 没有对应物）

**用户 JS + Nudo 契约（非 TS 语法）：**

```js
/**
 * @nudo:refine items: arr(number) where every > 0
 * @nudo:refine return: arr(number)
 */
function positiveDoubled(items) {
  return items.map((x) => x * 2);
}
```

**TS 侧只能「外挂」或根本写不出「每个元素 > 0」的数组类型：**

```ts
// TS 写不出 items: Array<number & { > 0 }>
// 只能靠收窄后的标量，或注释/品牌类型
function positiveDoubled(items: number[]): number[] {
  return items.map((x) => x * 2);
}
```

**Nudo：** 关系槽上的 Pred 与 `abs` 同轨；`map` 后元素 term/pred 单调传播，  
`nudo check` 做蕴含门禁。这是「关系型 Abs」相对 TS 泛型的能力差，不是语法糖差。

#### C. 无 body 的 relation-only 回调（harvest / 符号入口）

**库函数只有关系、没有实现：**

```ts
// harvest 得到的 Abs（不是用户 JS）
// transform = relationFn([A1], B1)   // 无 body
```

**TS 侧：声明文件写签名即可：**

```ts
declare function processItems<T, U>(
  items: T[],
  transform: (x: T) => U,
  filter: (x: T) => boolean,
): U[];
```

**Nudo：** P1 用 `isRelFn` / `impl.relation` 在 `map` 处 `instantiateReturn`，  
不伪造 body、不进 `instantiate` 特判。与 TS 的 `.d.ts` 地位类似，但载体仍是 Abs 槽位。

#### D. 非内建 HOF：TS 靠手写签名，Nudo 靠直接调用观测

**用户 JS：**

```js
function withRetry(fn) {
  return fn();
}
function applyEach(items, fn) {
  for (const x of items) fn(x);
}
```

**TS：**

```ts
function withRetry<T>(fn: () => T): T {
  return fn();
}
function applyEach<T>(items: T[], fn: (x: T) => void): void {
  for (const x of items) fn(x);
}
```

**Nudo（§5.2 观测表）：**

```text
withRetry:  fn() => B1          // p() 直接调用
applyEach:  items: arr(A1), fn: fn(A1) => B1; return undefined
            // for-of + fn(x) 直接调用；items 提升来自 for-of/使用，不靠 .map
```

（若 for-of 元素提升尚未在 P2 覆盖，可先只对 `.map/.filter` 方法名提升；  
`withRetry` 这类 `p()` 直接调用是 P2 必须覆盖的非内建形状——靠 §5.2.0 的
CallExpression 挂载点，不依赖方法名。）

#### E. 调用点实例化机制对照

| | TS | Nudo |
|---|---|---|
| 发生时刻 | 编译期 | `instantiate(args)` / `substAbs` |
| 多态变量 | 类型参数 `T,U` | term `var(A1), var(B1)` |
| 约束 | 条件类型 / `extends` | Pred + Φ（可挂 α） |
| 失败 | 类型错误 | 降 unknown / conf 降级；不假装 exact |
| 缓存 | 编译器 | L0 PolyFn + L1/L2 inst memo |

**结论：** Nudo 需要的是 **关系型 Abs**，不是 **TS 式泛型语言**。  
用户永远面对 plain JS；关系是分析器在 Abs 外延槽上归纳/消费的副产品，  
dts 投影（§7）只是把已有关系**降级投影**回 TS 泛型，不是第二套内核。  
本设计把 P1 限制在「内建 HOF 认函数形状的 returnType」——最小闭环，可独立合入。

---

## 12. 涉及文件（实现索引）

| 区域 | 路径 |
|---|---|
| 新 helper（isRelFn / applyCallbackAbs / instantiateReturn / substAbs） | `packages/core/src/algebra/hof.ts` |
| fn 关系 impl + `relationFn`（双写 shape + impl.relation；默认 conf=`path`） | `packages/core/src/algebra/abs-fn.ts` |
| 调用（含调用门 `getFnImpl \|\| isRelFn`） | `packages/core/src/algebra/exec/call.ts`、`ast-eval.ts`（Identifier / `$call` / `applyAbsFn` / callback 入口） |
| 内建 map/filter/reduce/flatMap | `ast-eval.ts` 对应分支、`exec/class.ts` `invokeArrMethod` |
| 提升 hook 挂载点（§5.2.0） | 方法派发 miss：`ast-eval` 方法查找 + `exec/class.invokeArrMethod`；CallExpression callee：`evalNode` CallExpression；HOF 回调实参：`applyCallbackAbs` |
| generalize（形参提升 + fnRels/entryShapes/hofSites + RelSource） | `packages/core/src/algebra/generalize.ts`（§5.1/§5.2/§5.2.0b） |
| format（fn paramTypes + returnType term + formatPoly 读快照） | `packages/core/src/algebra/format.ts`（§5.3，P1 即可测 relationFn 展示） |
| check 签名 | `packages/core/src/algebra/check.ts`、`diagnostics.ts` |
| 金标 | `packages/core/src/algebra/__tests__/hof.test.ts`（内联）+ `hof-relation.test.ts`（P1a/b）+ `hof-relation-paths.test.ts`（P1c 双路径） |

---

*状态：草案 v6（在 v5 基础上合入本轮评审：冲突裁决改为 **arrival-first** 并删除 loc 回滚表述；返回侧 term **钉死**共享 `B:${param}`（P2 不做 app）；P1 拆为 **P1a/P1b/P1c**；sum 回调写入 `applyCallbackAbs` 阻塞清单；形参别名明确不做；`instantiateReturn` 重复 α 先绑定保留；formatShape 槽位含 term 的读法写死；LSP hover 读 intension 纪律；`relationFn` 同签名共享 fingerprint 记为已知限制。不改动现有 gold 门禁语义；P1a 可独立实现与回滚；P3 暂缓。*
