# TypeValue 代数重构设计

> **类型的本质不是「值的集合」，而是「可求值的计算与约束」。**
> 函数的类型就是函数本身——`(a, b) => a + b`；给常数就求值，给带约束的符号就传播约束。
> TypeScript 的签名 `(number, number) => number` 只是这条计算的**有损投影**（丢掉 `a>0`、丢掉 `c = a+1`）。
> Nudo 要替换 TS，靠的不是把结构类型格做大，而是让类型值**参与运算**，推出 `x>0 ⇒ add(x,1) > 1` 这类 TS 推不出的事实。

---

## 1. 命题

### 1.1 先问：类型是什么？

同一段代码，两种世界观：

```javascript
const add = (a, b) => a + b;
```

| 世界观 | `add` 的「类型」 | 能推出什么 |
|---|---|---|
| **TS（外延）** | `(a: number, b: number) => number` | 只知道「进 number 出 number」 |
| **Nudo（内涵）** | `(a, b) => a + b` —— **计算本身** | 进常数得常数 `(1,3)⇒4`；进带约束符号得带约束结果 |

```javascript
// 给常数：求值
add(1, 3)           // → 4

// 给带约束的符号：约束算术
// x : number, x > 0
const c = add(x, 1)
// → c : number, c > 1        // TS 做不到：它会把 c 收成 number，丢掉 >1
```

TS 的优势是**不用给常数**，给一个形状（`number`）就能检查。
TS 的天花板是**只能细化到基本类型/结构**，`a > 0`、长度、正则、模板关系都进不了类型。
Nudo 若只做「注解更少的 TS」，就永远活在 TS 的天花板下面。

**Nudo 的命题：把约束放进类型值，让类型值参与运算。**

```
类型值 = 抽象值（可求值的项）+ 约束（可传播的谓词）
类型检查 = 对项做抽象执行，看约束是否蕴含
```

这与「结构类型格」不是同一层——格是外壳，**项与约束算术**才是内核。

### 1.2 当前实现错在哪

当前 `TypeValue` 是一份固定的判别联合：

```
literal / primitive / refined / object / array / tuple
function / promise / instance / union / never / unknown
```

它是「带标签的运行时值 / 值的集合」，导致：

| 痛点 | 根因 |
|---|---|
| `x>0` 参与运算后丢失 | `refined` 只是附加检查，**不进入 `+` 的语义** |
| 高阶函数参数黑洞 | `function` 是闭包壳，不是「对抽象值的变换」 |
| 可选/索引/交叉缺席 | 结构层不完整（次要，可补） |
| 推断结果可信度不可见 | 置信度不是一等公民 |
| guard/schema/测试三套生成器 | 没有统一指称 |

即便把结构格补全（optional、meet、index），若 `add` 遇到 `refined(number, >0)` 仍直接拓宽成 `number`，Nudo 相对 TS **没有本质优势**。

### 1.3 核心洞察（修正版）

> **类型语言「薄」的根因不是 kind 不够，而是类型值不「可计算」。**

三层，缺一不可：

```
第 0 层  项（Term）     —— 抽象值的身份：lit / var / op(...)
第 1 层  约束（Pred）    —— 附着在项上的事实：x>0, x∈[1,10], s matches /a+/
第 2 层  结构（Shape）   —— obj/arr/fn/sum/... 的外壳
```

- **TS 停在第 2 层**（而且只有外延签名）。
- **Nudo 必须做透第 0–1 层**，第 2 层补全即可。
- 函数的内涵类型 = 「对第 0–2 层值的变换」；外延签名是有损投影。

核心运算从「集合代数」改为「抽象值上的求值 + 约束传播」：

```
eval(term, env)          // 抽象求值，产出新 term + 约束
meet/join/leq            // 约束与形状上的格运算（外壳）
simplify / subsume       // 项化简与约束蕴含
project / apply          // 结构访问与函数应用
denote                   // 具体化：v 是否落在抽象值指称内
```

### 1.4 与 TS / 与旧 Nudo 的对照

| | TS | 旧 Nudo | 新命题 |
|---|---|---|---|
| `add` 的类型 | `(number,number)=>number` | 同左（body 可执行但结果拓宽） | `λa b. a+b`，外延签名只是投影 |
| `x>0` | 进不了类型 | `refined` 能挂上，但 `+` 会丢 | `x+1` 自动 `>1` |
| 字面量 | 保留到一定深度 | 保留（原则 1） | 保留，且是项的特例 |
| 结构类型 | 完整 | 薄 | 补全即可，非主战场 |
| 用户要学的 | 类型语言 | 指令 | 仍不学第二语言 |

### 1.5 产品命题（替换 TS）

| TS 心智 | Nudo 心智 |
|---|---|
| 我先声明类型，再写实现 | 我写实现与用例，类型被**算**出来 |
| 类型不准就改注解 | 类型不准就补 case / 约束 / mock |
| 类型是文档 | 类型是可求值、可校验的事实 |
| `any` 逃生舱 | 显式 `unknown` + 置信度 |
| 双语言同步 | 单语言：JS + 可计算类型值 |

命令面：

```bash
nudo check <file>     # 替代 tsc --noEmit：约束蕴含 + 结构（Abs 门禁）
nudo types <file>     # 展示推断签名、项与约束、置信度
nudo test <file>      # @nudo:case 即测试
nudo emit <file>      # 为 npm 生态导出 .d.ts（= generate --format dts）
nudo guard <file>     # 边界运行时校验（= generate --format guard）
nudo generate <file>  # zod | guard | dts 组合输出
```

已知未做：无（Phase A–C 核心命令面与自动化已收口；service Abs 路径仍限自包含源码）。

---

## 2. 代数骨架

### 2.1 项（Term）——抽象值的身份

```ts
type Term =
  | { op: "lit"; value: LiteralValue }
  | { op: "var"; id: string; origin?: "param" | "bind" | "fresh" }
  | { op: "app"; fn: string; args: Term[] }     // +, -, *, /, get, call, ...
  | { op: "ite"; c: Pred; t: Term; e: Term };   // 可选：控制流合成
```

规则：

- 字面量是项的特例：`add(1,3)` → `app("+",[1,3])` → **立刻化简**为 `lit(4)`。
- 参数进入函数体时是 `var`，带入调用点约束。
- 中间绑定可具名（SSA 风味），防止项无限增长：`const c = add(x,1)` 使 `c ↦ app("+",[var(x),1])`，或在阈值后 **leak** 成新 `var(c)` + 等式约束 `c = x+1`。

### 2.2 约束（Pred）——附着在项上的事实

```ts
type Pred =
  | { op: "eq" | "ne"; a: Term; b: Term }
  | { op: "lt" | "le" | "gt" | "ge"; a: Term; b: Term }
  | { op: "and" | "or" | "not"; args: Pred[] }
  | { op: "typeof"; t: Term; type: PrimName }
  | { op: "in-range"; t: Term; lo?: number; hi?: number }   // 语法糖，可归约
  | { op: "matches"; t: Term; re: string };
```

约束环境 `Φ` 是 Pred 的合取。求值时：

```
Φ ⊢ eval(op(args)) → (term', Φ')
```

例如 `Φ = { x > 0 }`，`eval(x + 1)`：

```
term' = app("+", [var(x), lit(1)])
Φ'    = Φ ∪ { term' > 1 }          // 由 x>0 与 + 单调性推出
```

**这是 TS 没有的、Nudo 的主武器。**

### 2.3 抽象值 = 形状 × 项 × 约束（新的 TypeValue）

```ts
type Abs = {
  shape: Shape;           // 结构外壳：prim/obj/arr/fn/sum/...
  term?: Term;            // 这项值「是谁」（常数/变量/表达式）
  pred?: Pred;            // 相对 term 的约束
  conf: Confidence;
};

type Shape =
  | { k: "never" } | { k: "unknown" }
  | { k: "prim"; type: "number"|"string"|"boolean"|"bigint"|"symbol" }
  | { k: "obj"; slots: Record<string, Slot>; index?: IndexSig; open?: boolean }
  | { k: "arr"; element: Abs } | { k: "tuple"; elements: Abs[]; rest?: Abs }
  | { k: "fn"; fn: FnMode; typeParams?: TypeParam[] }
  | { k: "brand"; name: string; shape: Abs }
  | { k: "eff"; eff: "promise"|"generator"; inner: Abs }
  | { k: "sum"; members: Abs[] };

type Slot = { value: Abs; optional?: boolean; readonly?: boolean };
```

说明：

- **`term` 是一等的**：`lit(4)`、`var(x)`、`app("+",…)` 都可挂在 prim/obj 上。
- **`pred` 相对 `term`**：`pred: term > 0`，项一变约束跟着平移——这是「`x>0 ⇒ x+1>1`」能成立的原因。
- 旧 `literal` kind 并入 `prim + term=lit`；旧 `refined` 并入 `prim/obj + pred`。
- 结构运算在 `shape` 上做；算术与守卫在 `term/pred` 上做。

### 2.4 格运算（外壳，仍需要）

```
join(a, b) : Abs     // 并：sum；项无法并时丢 term，尽量保 pred
meet(a, b) : Abs     // 交：约束合取 + 形状交
leq(a, b)  : bool    // Φ ⊢ a ⊑ b  ⟺ 形状 leq 且 pred 蕴含
subtract   : Abs     // 守卫取反
```

**join 时的项策略：**

```
join(lit(1), lit(2))           → shape=number, term 丢失, pred 可留 (v=1 ∨ v=2) 或 widened
join(var(x)[x>0], lit(0))      → shape=number, pred=(x>0 ∨ v=0)
join(obj1, obj2) 异 key        → sum，绝不自动折 optional
join(fn1, fn2)                 → sum of functions（重载），禁止参数/返回独立并
```

原则：**丢 term 是损失**，置信度降到 `widened`；能留 pred 就留 pred。

### 2.5 函数：内涵优先，外延是投影

```ts
type FnMode =
  | { mode: "body"; params: string[]; node: Node; closure: Environment }
  | { mode: "sig"; signature: FnSig }       // 内置/harvest：已是外延，无法再内涵
  | { mode: "typeFn"; apply: (args: Abs[]) => Abs };
```

`add` 的内涵类型就是 body。应用：

```
app(add, [x_abs, lit(1)])
  = eval(body, env{a: x_abs, b: lit(1)})
  = eval(a + b)
  = eval(x + 1)
  → Abs{ shape: prim(number), term: app("+",[var(x),1]), pred: term > 1 }
```

外延投影（给 `.d.ts` / 人类）：

```
ext(add) = (number, number) => number     // 丢 term、丢 pred
```

**永远不要把外延当成真相。** `nudo types` 默认展示内涵摘要：

```
add : (a, b) => a + b
      // 外延: (number, number) => number
c   = add(x, 1)  where x > 0
      → c : number, c = x+1, c > 1     #path
```

### 2.6 `app` 分派（含重载）

```
app(fn, args):
  if fn.shape.kind == "sum" and members are fns:
    M = { f | leq(args, params(f)) }
    |M|=0 → open-world / error
    |M|=1 → app(only(M), args)                    // 保相关性
    |M|>1 → join( map(app, M) )                   // 仅匹配分支
  if mode == "body": abstract-eval body under Φ
  if mode == "sig":  match params, return codomain (no terms)
  if mode == "typeFn": typeFn(args)
```

### 2.7 指称 `denote`

```ts
denote(abs) : (v: unknown) => boolean
```

- 无 `pred`：按 shape 检查（typeof / 结构）。
- 有 `pred`：在赋值 `term ↦ v` 下检查 Pred（区间算术可判定时直接判；否则保守）。
- `sum`：任一成员。

护栏 / schema / 测试都走这一条。

### 2.8 置信度

```ts
type Confidence = "exact" | "path" | "widened" | "mock" | "partial" | "opaque";
```

- 全字面量且化简成功 → `exact`
- 保留 term/pred 的路径结果 → `path`
- **丢 term / 塌 optional / 字面量并塌缩 / 函数参数独立并** → `widened`
- 依赖 mock → 不得高于 `mock`；碰 `unknown` 叶 → `partial`

---

## 3. 约束算术：主武器如何工作

### 3.1 单调性表（算术核）

对 `Φ ⊢ a + b`，在 `term(a), term(b)` 已知时：

| 已知 | 推出 |
|---|---|
| `a > p`, `b > q` | `a+b > p+q` |
| `a ≥ p`, `b ≥ q` | `a+b ≥ p+q` |
| `a ∈ [p1,p2]`, `b ∈ [q1,q2]` | `a+b ∈ [p1+q1, p2+q2]` |
| `a = lit`, `b = lit` | **直接求值**，term 收成 lit |
| `a = var(x)`, `b = lit` | term=`x+b`，pred 跟着平移 |

乘除、比较、`||`/`&&` 有对应表；不可判定时**丢 pred 保 shape**，不撒谎。

### 3.2 与守卫的交互

```javascript
function f(x) {
  // Φ: x > 0
  const c = x + 1;   // c ↦ term=x+1, pred: c > 1
  if (c > 5) {
    // Φ': x+1 > 5  ⇒  x > 4
    return c;        // term 仍是 x+1，pred: c>5 ∧ c>1
  }
  return 0;
}
```

守卫不是「窄化 shape」，而是**向 Φ 添加谓词**；返回值的 term 仍指回原表达式。

### 3.3 何时丢项（防爆炸）

| 触发 | 动作 | 置信度 |
|---|---|---|
| 项深度/宽度超阈值 | leak 为新 `var`，附等式约束 | `path`；等式也丢则 `widened` |
| join 异 kind / 不可合取 | 丢 term，保留可合取的 pred | `widened` |
| emit `.d.ts` | 投影成外延 shape | 展示层可标「有损」 |
| native / 未知内置 | 无 term | `partial`/`opaque` |

### 3.4 `join` / 塌缩纪律（结构层，沿用）

```
// 对象：积之和，不自动折 optional
{ port: 3000 } ⊔ {}  →  { port: 3000 } | {}

// 函数：签名并（重载）
(A→B) ⊔ (C→D)  →  (A→B) | (C→D)
// 禁止：(A|C) → (B|D)   —— 除非显式 collapse，且 #widened

// 显式损失 API（单独，强制 #widened）
collapseLiteralUnion / collapseToOptional / dropTerms
```

---

## 4. 示例推演

符号：`Φ` 约束环境；`↦` 绑定；`#c` 置信度。

纪律：

1. call-site 多态，不预并。
2. **term 优先保留**；丢 term 是损失。
3. 函数 join = 签名并（重载），禁止参数/返回独立并。
4. 塌 optional / 字面量 widen / 丢 term = 显式损失，`#widened`。
5. generalize（内涵 `typeFn`）优先于有损并。

---

### 示例 0：`add` —— 类型即计算（定义性示例）

```javascript
const add = (a, b) => a + b;

add(1, 3);

function scale(x) {
  // 前置条件：x > 0
  return add(x, 1);
}
```

**0.1 `add` 本身（无调用）**

```
add ↦ fn.body(λa b. a + b)
内涵类型：对抽象值 (A,B) ↦ eval(a+b, {a:A,b:B})
外延投影：(number, number) => number    // 有损，仅展示用
```

**0.2 字面量调用：直接求值**

```
Φ = ⊤
app(add, [lit(1), lit(3)])
  env {a: lit(1), b: lit(3)}
  eval(a+b) = app("+",[1,3]) → 化简 lit(4)
→ Abs{ shape: prim(number), term: lit(4), conf: exact }
```

**0.3 符号调用 + 约束：约束算术**

```
Φ = { var(x) > 0 }
app(add, [Abs{prim(number), term: var(x), pred: x>0}, lit(1)])
  eval(a+b) = app("+", [var(x), lit(1)])
  单调性：x>0 ∧ 1≥0 ⇒ x+1 > 1
→ Abs{
    shape: prim(number),
    term:  app("+",[var(x),1]),
    pred:  term > 1,
    conf:  path
  }
```

`scale` 返回值即上式。**TS 在这里只能给 `number`，Nudo 给出 `c = x+1 ∧ c > 1`。**

**0.4 进一步传播**

```javascript
function twice(x) {
  const c = add(x, 1);   // c ↦ x+1, c>1
  return add(c, 1);      // (x+1)+1, >2
}
// Φ: x>0  ⇒  twice(x) : number, term=(x+1)+1, pred: >2
```

**0.5 与 TS 对照**

| | TS | Nudo |
|---|---|---|
| `add(1,3)` | `number`（或 as const 字面量） | `lit(4)` |
| `add(x,1)`，`x>0` | `number` | `x+1 > 1` |
| `add` 的「类型」 | `(number,number)=>number` | `λa b. a+b` |

---

### 示例 A：spread 配置——字面量与重载并

```javascript
function createConfig(options) {
  return { host: "localhost", port: 8080, debug: false, ...options };
}
createConfig({ port: 3000, debug: true });
createConfig({});
createConfig({ host: "api.example.com" });
```

**A.1 多态 call-site（term 保留）**

| 调用点 | 结果 | conf |
|---|---|---|
| c1 | `{ host:"localhost", port:3000, debug:true }` | `#exact` |
| c2 | `{ host:"localhost", port:8080, debug:false }` | `#exact` |
| c3 | `{ host:"api.example.com", port:8080, debug:false }` | `#exact` |

**A.2 合并签名 = 函数并（禁止参数/返回独立并）**

```
createConfig :
  | ({port:3000,debug:true})   → {host:"localhost",port:3000,debug:true}
  | ({})                       → {host:"localhost",port:8080,debug:false}
  | ({host:"api.example.com"}) → {host:"api.example.com",port:8080,debug:false}
```

等价 TS 重载联合，**不是** `(P1|P2|P3)=>(R1|R2|R3)`。

**A.3 generalize：内涵是 `Merge`**

```
∀ω. (ω) → Merge(defaults, ω)
```

比 optional 塌缩精确；塌缩仅 emit/阈值，`#widened`。

---

### 示例 B：HOF `map` —— 内涵变换 + generalize

```javascript
function map(arr, fn) {
  const out = [];
  for (const item of arr) out.push(fn(item));
  return out;
}
map([1, 2, 3], (x) => x * 2);
map(["a"], (s) => s.toUpperCase());
```

```
map 内涵：对 (Arr α, fn) 抽象执行
  item : α
  out  : Arr(eval(fn(α)))
map : ∀α β. (Arr α, α→β) → Arr β

调用 1: α:=number, fn(x)=x*2 → β=number；小数组可展开 [2,4,6] #exact
调用 2: β=string
```

若回调是 `x => x + 1` 且元素带约束 `>0`，结果元素 term/pred 同步传播——**外延 `number[]` 只是投影**。

---

### 示例 C：`reduce` —— 累加器的项与不动点

```javascript
function sum(numbers) {
  return numbers.reduce((acc, n) => acc + n, 0);
}
sum([1,2,3,4,5]);
```

```
字面量路径：0+1+…+5 → lit(15) #exact
符号路径：acc₀=0, accᵢ₊₁=accᵢ+nᵢ
  不动点：shape=number
  term 可选保留为 fold；深度超阈则 leak
  pred：若 nᵢ > 0 则 sum > 0
```

---

### 示例 D：mixin —— `meet` / brand

```javascript
function withLogging(Base) {
  return class extends Base { log(msg) { console.log(msg); } };
}
class Service { fetch(id) { return { id, ok: true }; } }
const Svc = withLogging(Service);
```

```
Service 实例 : brand("Service", { fetch: ... })
withLogging  : brand 内 shape ← meet(原 shape, { log: ... })
new Svc().fetch(1) → proj + app
```

---

### 示例 E：pick —— 字面量 key / index

```javascript
function pick(obj, key) { return obj[key]; }
pick({ a: 1, b: "x" }, "a");   // → lit(1) #exact
```

动态 key：`join(各槽) ⊔ index.value`，吸收后 `#path`。

---

### 示例 F：async —— `eff` 引入/消除

```javascript
async function loadUser(id) {
  const res = await fetch(`/users/${id}`);
  if (!res.ok) throw new Error("fail");
  return res.json();
}
```

`await` 解 `eff("promise", T)`；async `return` 再包一层；`throw` 进 throws。

---

### 示例 G：守卫 —— 向 Φ 添加谓词

```javascript
function len(x) {
  if (typeof x === "string") return x.length;
  if (Array.isArray(x)) return x.length;
  return -1;
}
```

`typeof`/`Array.isArray` 不是「换 shape」，而是 `Φ += …`；返回 term 仍指回原表达式。

---

## 5. 迁移映射

| 旧构造 | 新构造 | 说明 |
|---|---|---|
| `literal` | `prim + term=lit` | 字面量是项的特例 |
| `refined(base, pred)` | `shape + term + pred` | pred 相对 term，可随项平移 |
| `primitive` | `prim` 无 term | 纯外延基元 |
| `union` | `sum` | join 时尽量留 pred |
| `object` | `obj.slots[].value: Abs` | optional/readonly 在 Slot |
| `function` + `_signature` | `fn.mode=body/sig/typeFn` | 废除旁路 |
| `promise`/`instance` | `eff` / `brand` | |
| Map `_typeArgs` | brand 或 typeFn | 废除 |

兼容：先并行 `typeValueToString` 与金标，再切换。

---

## 6. 实施阶段

### Phase A — 项与约束内核 ✅（`@nudojs/core/src/algebra`）
1. ✅ `Term` / `Pred` / `Abs` 数据结构
2. ✅ 算术单调性核（+ − * 比较，负数翻转）+ 化简
3. ✅ `body` 抽象求值时 term 保留；守卫写入 `Φ`；return 信号
4. ✅ 属性测试：`x>0 ⊢ x+1>1`；字面量求值；丢 term 时 conf=`widened`
5. ✅ 示例 0 金标；term leak

### Phase B — 结构层补全 + 多态 🚧
1. ✅ `Slot.optional/index`、sum-of-products、函数重载并骨架
2. ✅ 对象 spread；`collapseToOptional` 显式损失
3. ✅ HOF map/reduce/filter 在 AST 上的内涵求值
4. ✅ `nudo types` CLI（`--assume x>0` / `--generalize`）
5. ✅ generalize 真·多态签名（符号 α 执行）
6. ✅ emit 外延投影 + `nudo emit`；tsc 往返门禁（`emit-tsc-roundtrip.test.ts`）

### Phase C — 产品替换面 🚧
1. ✅ 约束诊断：`nudo check` / CheckJson v1 / LSP 主通道
2. ✅ harvest 自动化：分析路径按需注入 @types（`nudo harvest --auto` 报告）
3. ✅ 与真实 Node 执行差分回归（8 用例，exact 对齐）
4. ✅ 挂到主 CLI：`nudo types --assume/--generalize` 已通
5. ✅ `nudo test`（`@nudo:case` 即断言）
6. ✅ `nudo emit` / `nudo guard` 命令面；guard 走 `denoteGuard(abs)`

### 已知边界（2026-09 收口后）

| 边界 | 说明 |
|---|---|
| **B 路径（主路径）** | capable 文件 case / entry@ / call@symbolic 主求值；语言面基本齐 |
| for / while | 有界 `$for`/`$while`；transpile while 用 `$whileSeq`（预算） |
| service Abs 路径 | 相对 import + 裸包 harvest + require + @nudo:env（含路径型） |
| TypeValue 兜底 | 弱结果、B 失败；method-missing 已 B 化并按名去重；provenance B 有调用点 origin；**named/default/ns 相对 import + re-export（`export {x} from` / `export * from`）+ class/async default 均走 B Abs 模块图** |
| **method-missing / unknown-recv 双报** | B 成员分派（`$invoke`/`$get` + **ast-eval** 跨文件函数体）为权威；TypeValue 同类 method/property 在 B hosted 时整类让位。实参 provenance argLocs |
| **module-load / recursion / unknown-global 双报** | B `evalAbsModuleGraph.issues`；Abs 截断；静态 builtin-unknown |
| **evaluateProgram** | **B hosted 时跳过**。诊断/call@/nodeTypeMap/env 全 B；TypeValue 仅 `!bHostedEval` 时跑 |
| **class 桥接** | Abs-eval `registerClassDecl` → `class-registry` → B `$new`/ctor |
| **箭头函数** | transpile `ArrowFunctionExpression`/`FunctionExpression`（原先未覆盖） |
| **arr 方法** | B `$invoke` map/reduce/filter/join；JS 回调与 Abs 回调都可 |
| emit 往返 tsc / harvest 自动化 | ✅ `emit-tsc-roundtrip` + 分析路径 auto-harvest |
| guard denotational | ✅ `denoteGuard`；`nudo guard` 优先 Abs 路径 |

### 验证状态（2026-09 收口后）

| 检查 | 结果 |
|---|---|
| vitest | **1653 passed**（全 monorepo） |
| tsc -p tsconfig.lint.json | **clean** |
| nudo types sample --assume 'x>0' | term+pred 正确 |
| nudo check | 约束蕴含诊断 + 金标 recall/precision=1.0 |
| differential vs Node | exact 一致 |

### 已验证输出

```
# nudo types sample.js --assume 'x>0'
scale(number)     term=(x+1)       pred: (x+1)>1       #path
twice(number)     term=((x+1)+1)   pred: >2            #path
negate(number)    term=(x*-1)      pred: (x*-1)<0      #path

# nudo types sample.js --generalize
# 无契约参数 = any；+ 按真实 JS 取并集 number|string
# 有 assumes/refine 才走数值路径（number + pred）
add:    <A1, A2>(a: A1, b: A2) => number | string = (A1 + A2)
scale:  <A1>(x: A1) => number | string = (A1 + 1)
twice:  <A1>(x: A1) => number | string = ((A1 + 1) + 1)
negate: <A1>(x: A1) => unknown = (A1 * -1)
```

---

## 7. 风险与非目标

**风险**
- 项爆炸 → leak + 等式约束 + 阈值
- 约束不可判定 → 保守丢 pred，禁止假证明
- 性能：区间/线性域足够起步；SMT 可后挂，不进默认热路径

**非目标**
- 映射类型/条件类型语法
- 与 tsserver 双向同步
- 证明任意程序性质（只做抽象解释可判定的传播）

---

## 8. 一句话

> **类型是可求值的计算，不是值的集合。**
> `add` 的类型是 `λa b. a+b`；`x>0` 时 `add(x,1)` 得到 `x+1>1`。
> TS 的 `(number,number)=>number` 只是有损投影。
> 结构格是外壳，**项与约束算术**才是 Nudo 替换 TS 的理由。

---

## 附录：示例速查

| 示例 | 考察点 | 关键机制 |
|---|---|---|
| **0 add** | **类型即计算** | **term 保留 + 约束单调性** |
| A createConfig | 结构层字面量/重载 | 积之和、函数并、Merge |
| B map | HOF 内涵 | generalize |
| C reduce | 累加器 | 不动点 + term |
| D mixin | 交叉 | meet / brand |
| E pick | 投影 | 字面量 key / index |
| F async | 效应 | eff |
| G narrow | 守卫 | Φ 添加谓词 |
