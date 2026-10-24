# 生成器体的**惰性**语义（Bug 212）· 架构说明

> **状态**：**仍为架构债**（未修；本文给出精确数据流 + 可落地的最小改造路径）。
> 关联：诚实台账 → [`limitations.md`](./limitations.md) §1.4；架构债台账 →
> [`architecture-debt.md`](./architecture-debt.md) A1；仓内回归钉 →
> [`packages/core/src/algebra/__tests__/eval-bug-212-generator-body-eager.test.ts`](../packages/core/src/algebra/__tests__/eval-bug-212-generator-body-eager.test.ts)。
> 分片：S10 · 族 44 · **研究级** · 出路 **B（精确登记）** · 2026-10-23

## 0. 结论摘要（一句话）

**Bug 212 在本族内不可真修**——不是「没找到修法」，而是两条**互相独立**的硬约束：

1. **eager 收集是值域/签名面的承重结构**：生成器对象的元素域与 `conf`（exact/path/widened）
   在**构造期**就烘进 `Abs` 的 shape 与置信度 ⇒ 改成惰性会把 dts 的 `Generator<any | number>`
   退成 `Generator<unknown>`，并把 `conf` 降级（影响 `leqAbs` ⇒ L1/L2 门禁精度）。
2. **外层绑定的写穿在 runtime 侧无句柄可拦**：转译产物是**闭包变量的裸 JS 赋值**
   （`return n = __v`）；`$assignRecord` 只能观测、其返回值被丢弃 ⇒
   **任何能中和「写穿」的方案都必须先有转译侧钩子**。

⇒ 走 **出路 B**：本文给出精确的数据流、受影响消费面清单、**可落地的最小改造路径**
（好消息：**最小路径是纯转译侧的，且复用仓里已有的分析，不动公开面**），以及
**局部收窄方案的可行性判定**（结论：局部收窄**可行**，但落在 **S11 的转译侧** ⇒ 本片不能单独落地）。

**本片状态判定：仍为架构债**（未做局部收窄 ⇒ 未交付新钉；见 §6 的可行性判定）。

---

## 1. 现状数据流（构造期 → eager 收集 → 消费面）

### 1.1 转译侧：生成器体被降成一个 **thunk**

生成器函数的四种写法都被降成 `$gen(() => { …体… })`：

| 源形态 | 转译点（**符号名**定位，不钉行号） | 产物 |
|---|---|---|
| `function* g(){}` 声明 | `packages/core/src/algebra/exec/transpile/stmt/statement.ts`（生成器声明的 `$gen` 发射点） | `return $gen(() => { … })` |
| `function* g(){}` 表达式 | `packages/core/src/algebra/exec/transpile/expr/function.ts`（函数表达式的 `$gen` 发射点） | `return $gen(() => {\n…\n})`（async generator 追加 `, true`） |
| `{ *m(){} }` 对象方法 | `packages/core/src/algebra/exec/transpile/expr/object.ts`（对象方法的 `$gen` 发射点） | `return $gen(() => { … })` |
| `class C { *m(){} }` 类方法 | `packages/core/src/algebra/exec/transpile/class-emit.ts`（类方法的 `$gen` 发射点） | `return $gen(() => { … })` |

> ⚠️ **`$gen` 一共 4 个发射点**（声明 / 函数表达式 / 对象方法 / **类方法**）。
> 只改前 3 个会**漏掉类生成器方法** ⇒ 那一类生成器体仍然写穿外层绑定。

**关键**：体被降成 **普通 JS 闭包**，闭包**捕获调用方的 `let`/`const` 变量**。
体里的 `yield` 降成 `$yield(v)`、 `yield*` 降成 `$yieldStar(v)`
（两个 runtime 辅助函数都在 `packages/core/src/algebra/exec/runtime/async.ts`）。

实测转译产物（`$assignRecord` 观测钩子 + 裸赋值）：

```js
export function f() {
    let n = $lit(0);
    let s = $lit("");
    function g() {
      return $gen(() => {
        ((__v) => { $assignRecord("n", n, __v, 5, 18, false); return n = __v; })($add(n, $lit(1)));
        ((__v) => { $assignRecord("s", s, __v, 5, 29, false); return s = __v; })($add(s, $lit("a")));
        $yield(n);
        return $lit(void 0);
      });
    }
    let it = $callNamed("g", g, [], [6, 13], []);
    return(n);
}
```

⇒ **体对外层绑定的写 = 对闭包变量的裸 JS 赋值**（`return n = __v`）。
`$assignRecord(...)` 只是**观测钩子**（checkSource 的 assign-mismatch 通道），
其**返回值被丢弃**（发射点在 `packages/core/src/algebra/exec/transpile/expr/assignment.ts`）⇒
**runtime 侧无法让它「不写」**。

### 1.2 运行时：`$gen` 在**构造期**把整个体跑完

`packages/core/src/algebra/exec/runtime/async.ts` — `export function $gen(body: () => Abs, asyncMode = false): Abs`

```
        yieldStack.push(ys)                 ← 压收集器帧
        retVal = asAbsVal(loopExitsAls.run([], () => {
          return body();                     ← ★ 构造期就把整个体跑完（eager）
        }))
        catch → thrown = throwPayloadOf(e)  ← 体内异常被**延迟**到消费点（Bug 34）
        soft  = popMayThrowFrame(...)       ← 体内 may-throw 效果同样延迟（Bug 34/58）
        const arr = $arr(ys.els)            ← 收集序列 → 元素列表
        const els = …                       ← 类型面元素列表（≤cap 元组 / >cap 单代表）
        return makeGenObject(els, arr.conf, ret, deferred, ys.els, ctxs, true, asyncMode, delegations)
```

**Bug 58 的既有承诺**（`$gen` 上方注释）只覆盖 **throws 域**
（「体内效果不折进**调用方** throws 域」），**没有**承诺隔离**状态域**——
而实际上体对**外层绑定**的写是**照常落地**的（§1.1：闭包变量的裸赋值）。

### 1.3 生成器对象：元素域与 `conf` 在**构造期**烘进 shape

`packages/core/src/algebra/exec/runtime/async.ts` — `makeGenObject(…)`

```
        const slots = { next, return, throw, constructor }      ← 协议面（internal 槽）
        for (i…) slots[String(i)] = { value: els[i], internal } ← ★ 元素面 = 数字下标槽
        const g = abs({ k: "obj", slots }, undefined, undefined, conf)   ← ★ conf 一并烘进 Abs
        registerGenElements(g, live)          ← 元素侧表（WeakMap）
        registerGenDrain(g, { drain, peek, peekAll, exact })     ← 消费视图（WeakMap）
        registerGenDeferred(g, deferred)      ← 延迟异常/效果侧表（WeakMap）
```

`abs()`（`packages/core/src/algebra/abs.ts`）**不拷贝 shape** ⇒ shape 与 `slots` 是**按引用共享**的
（这一点在 §5.2 的「延迟填充」方案里有用）。

### 1.4 三张侧表 = 元素面的**唯一**权威来源

`packages/core/src/algebra/exec/match-iter.ts`

| 侧表 | 注册 | 读出面 |
|---|---|---|
| 元素表 `genIterTables` | `registerGenElements` | `matchIterElements` |
| 消费视图 `genDrainTables` | `registerGenDrain` | `genDrainViewOf` / `drainGenElements` / `peekGenElement` / `hasGenView` / `peekAllGenElements` |
| 延迟异常 `genDeferredTables` | `registerGenDeferred` | `replayGenDeferred` |

### 1.5 消费面（谁读元素域）

| 消费面 | 位置（**符号名**） | 读法 |
|---|---|---|
| `for…of` / `for await…of` | `exec/runtime/containers/iterate.ts`（`genDrainViewOf` / `matchIterElements` / `drainGenElements` 的调用点） | `genDrainViewOf` / `matchIterElements` / `drainGenElements` |
| 数组下标 `it[0]` | `exec/runtime/containers/arr-index.ts`（`peekGenElement` / `peekAllGenElements` 的调用点） | `peekGenElement` / `peekAllGenElements` |
| `Array.from` / spread | `packages/core/src/algebra/builtins/array.ts`（`drainGenElements` / `matchIterElements` / `replayGenDeferred` 的调用点） | `drainGenElements` / `matchIterElements` / `replayGenDeferred` |
| `yield*` 委托的 `.return(v)` 转发 | `exec/runtime/async.ts`（`genDrainViewOf` 的调用点） | `genDrainViewOf` |
| **dts / 签名面** | `packages/service/src/emit/dts-generator.ts`（`iteratorTSType`） | **直接读 shape 的数字下标槽**（不经侧表！） |
| 摘要 / case 行 | service 的 eval call 记录 | 函数的**返回值 Abs** |

### 1.6 症状复现（before-state 取证）

> 仓内回归钉：`packages/core/src/algebra/__tests__/eval-bug-212-generator-body-eager.test.ts`
> （4 条 `it.todo` 逐条对应下面 4 行原生语义；负控制钉住族 01 的 eager 收集口径）。

| body | native | 引擎（当前） |
|---|---|---|
| `let n=0; function* g(){ n++; yield 1; } const it=g(); return n;` | `0` | **`1`** |
| `let log=""; function* g(){ log+="a"; yield 1; log+="b"; yield 2; } const it=g(); return log;` | `""` | **`"ab"`** |
| `function* g(){ n=1; yield 1; n=5; yield 2; } let n=0; const it=g(); it.next(); return n;` | `1` | **`5`** |
| `let log=""; … const it=g(); it.next(); return log;` | `"a"` | **`"ab"`** |
| 对照：`it.next().value` | `1` | `1` ✓ |
| 对照：普通函数副作用 | `1` | `1` ✓ |

> 第 3 行的 `n=1;`（首个 `yield` **之前**）不可省：原生 `it.next()` 只跑到第一个
> `yield`，没有这次写则观测值是 `0` 而不是 `1`（与仓内钉的
> `it.todo("原生：it.next() 之后只跑到第一个 yield（n = 1）")` 对齐）。

**值域泄漏到摘要面**（dts / 摘要面实测）：

```
=== dts (f) ===
/**
 * Case: entry@L1 () => 1        ← ★ Bug 212 的错值 1 被写进签名/摘要面（native 应为 0）
 * @returns number
 */
export declare function f(): number;
```

⇒ Bug 212 不只是「值错」，它**污染 L1 契约面与摘要面**（`nudo check` 打印的签名行就是这一行）。

---

## 2. 为什么「惰性」在本族内**不可落地**（硬约束）

### 2.1 硬约束①：**eager 收集是值域/签名面的承重结构**

证据（探针实测，当前工作树）：

```
=== dts (gen) ===
export declare function gen(x: any): Generator<any | number>;
```

`Generator<any | number>` 的元素类型**来自构造期烘进 shape 的数字下标槽**
（`packages/service/src/emit/dts-generator.ts` 的 `iteratorTSType`：遍历
`Object.entries(slots)` 取 `CANONICAL_INDEX` 键的槽值 join）。

⇒ 若把体改成「首次 `next()` 才跑」，**构造期没有元素槽** ⇒ dts 退成 `Generator<unknown>`
⇒ **签名面精确度回退**（违反本族验收标准「既有生成器行为（`$gen` 的产出摘要 / 签名面）不回归」）。

更严重的是 **`conf` 也要一起退**：`makeGenObject(…, arr.conf, …)`（`exec/runtime/async.ts`）
把 `$arr(ys.els)` 的置信度（线性收集 ⇒ `exact`）烘进 `Abs`。
`conf` 参与 `leqAbs` ⇒ 直接影响 **L1/L2 门禁**的判定（`exact` vs `path`/`widened`）。
构造期不知道序列 ⇒ 只能给 `path`/`widened` ⇒ **门禁面精度变化**（可能新增假红/假绿）。

> **结论**：eager 收集不是「实现偷懒」，而是 **Abs 域里「元素面」的唯一来源**。
> 想改惰性 ⇒ 必须先给「尚未跑过的生成器」一个**可延后填充**的元素面表示（§5.3 步骤 2）。

### 2.2 硬约束②：**外层绑定的写穿在 runtime 侧无句柄可拦**

- 转译产物是**闭包变量的裸 JS 赋值**（§1.1：`return n = __v`）。
- `$gen` 只拿到一个 thunk `() => Abs`；**运行时没有任何句柄**能指向调用方的 `let n`
  （JS 闭包变量不可枚举、不可由外部寻址）。
- `$assignRecord(name, prev, next, line, col, cond)`（发射点在
  `exec/transpile/expr/assignment.ts`）**只能观测**
  （`prev` 读在写前、`next` 是待写值），且**其返回值被丢弃** ⇒ 无法用它「中和」这次写。
- `$recordBinding` 只在**顶层作用域**发射（`exec/transpile/stmt/statement.ts` 的
  `$recordBinding` 发射点，`opts.inFunction` 为假时），
  生成器体是函数内 ⇒ 不覆盖。

⇒ **runtime 侧（含 `exec/runtime/**` 全部）没有任何机制能让「体内对外层绑定的写」不落地。**
唯一能拦的位置是**转译侧**（在赋值发射处改形状）。

### 2.3 硬约束③：**Abs 域没有「时间轴」维度，续体不可表达**

Abs = `shape × term × pred × conf`（`packages/core/src/algebra/abs.ts`）——
一个程序点对应**一个** Abs（所有可达臂的 join），**没有「暂停在第 k 个 yield」这一维**。
生成器的原生语义是「体在第 k 次 `next()` 停在第 k 个 `yield`」——
这是**续体（continuation）**语义，Abs 域里**没有对应物**。

现有的 `ctxs`（`exec/runtime/async.ts` 的 `$gen`，`Bug 52`）只是**静态 try 上下文位**，
用来在 `.return()`/`.throw()` 时**分级结局**，**不是**可恢复的挂起帧
（`exec/runtime/async.ts` 的 `makeGenObject` 附近注释明写：「eager 快照模型下无挂起帧可恢复」）。

⇒ 即便把体改成「可挂起/可续跑」，也需要**把 Abs 的状态表达从「一个 join 值」升级成
「按 yield 点分段的状态序列」**——那是引擎内核的表示变更，不是 `$gen` 的局部改造。

---

## 3. 受影响消费面清单（逐个）

| # | 消费面 | 现状依赖 eager 的点 | 若改惰性会怎样 |
|---|---|---|---|
| 1 | **dts 生成**（`nudo export --format dts`） | `packages/service/src/emit/dts-generator.ts` 的 `iteratorTSType` 读构造期烘进 shape 的数字下标槽 | 元素类型退 `unknown`（`Generator<unknown>`）——**签名面回退** |
| 2 | **check 签名 / 摘要**（`nudo check` 打印的 `Case:` 行与 `@returns`） | 函数返回值 Abs 直接来自 eager 求值；Bug 212 的错值 `1` 已进摘要面（§1.6） | 惰性后构造期值 = native ⇒ 摘要面**转正**（但需要 §5.2 配套） |
| 3 | **L1 契约门禁**（`*.nudo.js` / `@nudo:contract`） | 契约比较的是「函数返回 Abs ⊑ 期望」；错值 `1` 会让**本该红的门禁假绿** | 同上（修复方向正确） |
| 4 | **L2 入口 may-throw 门禁** | 体内 throw 已由 Bug 34/58 延迟到消费点 ⇒ **本面不受 eager 状态写影响** | 不变 |
| 5 | **`for…of` / `for await…of` 展开**（`exec/runtime/containers/iterate.ts`） | 读消费视图/元素表；**构造期即已收集** ⇒ 迭代一次拿到全部元素 | 惰性后须在**首个消费点**触发体收集（§5.2 步骤 2），否则元素面空 ⇒ `unknown` |
| 6 | **spread / `Array.from`**（`packages/core/src/algebra/builtins/array.ts`） | 同上 | 同上 |
| 7 | **数组下标 `it[0]`**（`exec/runtime/containers/arr-index.ts`） | 同上（族 01 的历史口径：`g[0]` 读 yield 值） | 同上 |
| 8 | **`yield*` 委托的 `.return(v)` 转发**（`exec/runtime/async.ts`） | 委托表在**体执行序**里建（`GenDelegation`） | 委托表必须**随体一起延后建** ⇒ 委托校验（`async.ts` 的下标对位）的下标对位失效即「不转发」 |
| 9 | **schema / guard / interface 导出**（`packages/service/src/emit/*`） | 生成器在 schema 侧走 `z.instanceof(GeneratorFunction)`（Bug 233 已修）；**元素域不进 schema** | 影响小（元素域本就不进 schema） |
| 10 | **差分语料**（`core/src/algebra/__tests__/differential/corpus/`） | `batch5.ts` / `batch11.ts` / `batch20-transpile-adversarial.ts` 里的 13 条生成器用例 | 全部是「**先消费再取值**」形态 ⇒ 惰性模型下**仍需绿**（触发点必须覆盖 `next()` / spread / for-of 三条消费路径） |
| 11 | **既有生成器钉**（core 10+ 个文件） | 见 §3.1 | 见 §3.1 |

### 3.1 既有生成器钉（回归面清单）

`packages/core/src/algebra/__tests__/`：`exec-generator.test.ts`、`exec-generator-consumption.test.ts`、
`exec-generator-precision.test.ts`、`exec-generator-protocol.test.ts`、`eval-generator-semantics.test.ts`、
`eval-bug-141-async-generator.test.ts`、`eval-bug-141-decl-async-generator.test.ts`、
`eval-bug-141-async-iter-elems.test.ts`、`eval-bug-229-yield-star-return-forward.test.ts`、
`eval-bug-240-generator-own-properties.test.ts`、`eval-bug-240-guard-internal-slots.test.ts`、
`eval-bug-212-generator-body-eager.test.ts`（**本族**：4 条 `it.todo` = 未闭合缺口）、
`eval-loop-return-join.test.ts`（`$gen` 本地作用域臂）、`eval-bug-198-s20-residual-live-iter.test.ts`。

---

## 4. 结论：**出路 B**（本片交付）

见 §2：三条硬约束各自独立成立 ⇒ **真修需要「转译侧 + 内核表示」协同**，
超出 S10 的独占范围（`exec/runtime/async.ts` + 同目录生成器相关文件），
且 §2.1 的签名面回退在**没有 §5.3 步骤 2 的「可延后填充元素面」之前**不可接受。

⇒ 本片**不改源码**，产出本文（架构说明）+ 仓内回归钉的登记。
**未做局部收窄**（局部收窄的落点在 S11 的转译侧，见 §6）⇒ **不交付新钉**。

---

## 5. 最小可行改造路径

> **步骤 1（纯转译侧）** = 局部收窄（把「错值」降成「sound 的 join」）——**最便宜、不动公开面**，
> 落在 **S11 的 `exec/transpile/**`**；**步骤 2–4** = 逐步走向真惰性。
> 步骤 1 与步骤 2 需要主 agent 拍板/分派（见 §5.6）。

### 5.1 步骤 1（**推荐先做**）：**生成器体的「自由写」隔离**（转译侧，**不动公开面**）

**要什么**：生成器体对**外层绑定**的写，在 **eager 收集期**不应**确定地**落地。

**已有零件（关键发现）**：转译侧**已经有**「自由写名字」的分析 ——
`collectFreeAssignedNames(...nodes)`
（在 `packages/core/src/algebra/exec/transpile/helpers.ts`，别名
`collectForkBindingNames` 同文件），
它按作用域（函数参数 / 块级词法声明 / catch 参数 / for-of 绑定 / `for (let …)` init）算「遮蔽」，
只留下**未被遮蔽的赋值/自增目标** ⇒
`collectFreeAssignedNames(...生成器体的语句)` **正好** = 「该体写到的**外层**绑定」。

**发射形状**（**四个** `$gen` 发射点：`exec/transpile/stmt/statement.ts`（声明）/
`exec/transpile/expr/function.ts`（函数表达式）/ `exec/transpile/expr/object.ts`
（对象方法）/ `exec/transpile/class-emit.ts`（**类方法**），插在 `bodyStmts` 外层）：

```js
return $gen(() => {
  const __g0_n = $copy(n);      // ① 体外绑定的**事前快照**（与 fork 臂同口径：$copy 深拷贝容器）
  try {
    …原体…
  } finally {
    n = $join(__g0_n, n);        // ② 「可能已写、尚未观测」⇒ 折成 join（sound）
  }
  return $lit(void 0);
});
```

- `$copy` / `$join` **都已是 `exec/index.ts` 的既有导出**（`$copy` / `$join`）
  ⇒ **不新增导出名、不改既有导出签名 ⇒ 不触公开面冻结** ✓
- ② 用 **join**（而非「还原成事前值」）的原因：
  - 原生构造点的值 = 事前值（精确），但**消费点之后**的值可能是写后的值；
  - 引擎没有时间轴（§2.3）⇒ 一个 Abs 要同时覆盖两个时点 ⇒ **join 是唯一 sound 的选择**；
  - 「还原成事前值」在构造点**精确**、但在消费点**欠近似**（丢掉「写后」这一支）
    ⇒ 可能造成 **L1 假绿** ⇒ 只在能证明「写是无条件的且体不再被消费」时才可用。
- ② 必须放在 `finally` 里 ⇒ 体抛异常时也要折（否则写穿）。

**收益**：Bug 212 的四行症状从「**确定的错值**」变成「**sound 的过近似**」：
构造点 `n` = `0 | 1`（native `0`）⇒ 摘要/dts 面的 `Case: entry@L1 () => 1` 变成 `0 | 1` ⇒
**不再有「在任何原生观测点都不成立的值」** ✓（这正是 brief 要求的 fail-closed 收窄）。

**风险**：
- R1-a：**精度回退**——受影响函数的返回类型从 `number` 变 `0 | 1`（摘要/dts 面可见）。
  （只影响「生成器体写了外层绑定」的函数；不写外层绑定的生成器**完全不受影响** ⇒ 既有生成器钉零回归。）
- R1-b：`collectFreeAssignedNames` 的遮蔽口径若漏判（e.g. `var` 提升、嵌套函数改写外层），
  会把**体内自有局部**误纳入隔离 ⇒ 体内逻辑被折坏（元素域退化）⇒ 必须用既有生成器钉 + 差分语料兜底。
- R1-c：`$copy` 快照对**容器**是深拷贝 ⇒ 隔离后调用方看到的容器是「事前副本」，
  与「原生：同一个容器对象被改了」不同（identity 面差异）⇒ 需在报告里记口径。
- R1-d：与 `Bug 58`（体内 throw 不折进调用方 throws 域）的边界要一起讲清：状态域隔离 ≠ throws 域隔离。

### 5.2 步骤 2：**元素面可延后填充**（保住签名面 / 门禁面）

**改什么**：让「尚未跑过体的生成器对象」也能承载**将来**的元素面：

- `makeGenObject` 的 `slots` 已是**按引用共享**的（§1.3：`abs()` 不拷贝 shape）⇒
  体跑完后**原地补写**数字下标槽可行（`slots[String(i)] = …`）。
- 需要一个「**未收集**」标记（而不是 `exact` 空元组）：
  - `conf`：构造期不能给 `exact`（会假精确）⇒ 先给 `path`（或新增 `partial` 语义），
    收集完成后**再提升**——但 `conf` 是 `Abs` 的字段（`packages/core/src/algebra/abs.ts`）⇒ 需要「可提升的置信度」机制
    （**内核表示变更**，影响 `leqAbs`）。
  - `packages/service/src/emit/dts-generator.ts` 的 `iteratorTSType` 读的正是这些槽 ⇒ 元素面补齐后签名面自然恢复。
- **触发点**（谁负责「该跑了」）：消费侧读元素面的那一刻 ⇒ 需要一个**触发器注册表**
  （生成器对象 → 触发函数），并在所有元素面读出点前置触发：
  `match-iter.ts` 的 5 个读出面 + `replayGenDeferred` + `async.ts` 的 `next`/`return`/`throw`。
  ⇒ **跨文件**（`exec/match-iter.ts`、`exec/runtime/containers/*`、`builtins/array.ts`）。

**风险**：
- R2-a：`conf` 的「先降后升」影响 `leqAbs` ⇒ **L1/L2 门禁精度变化**（可能新增假红/假绿）⇒ 需金标回归。
- R2-b：触发器注册表若需从 `exec/index.ts` 导出 ⇒ **公开面新增** ⇒ 需主 agent 拍板；
  （若只在 `exec/match-iter.ts` 内部持有、不导出，则**不触公开面** ⇒ 推荐这条。）
- R2-c：触发点覆盖不全 ⇒ 某些消费路径拿到空元素面 ⇒ 元素域退 `unknown` ⇒ 既有生成器钉变红。

### 5.3 步骤 3：**把「首次 `next()` 才跑」做成默认**（构造期不再跑体）

步骤 1 + 步骤 2 就位后，把 `$gen` 的 `body()` 调用从**构造期**挪到**首个消费点**：

- 构造期只登记「待跑体 + 触发器」。
- 首个消费点（`next()` / 元素面读 / 迭代展开）触发体 ⇒ 收集序列 + 落地状态写。
- **剩余缺陷**：体仍**一次跑到底** ⇒ 第一个 `yield` 之后的写会在**首次消费**时提前落地
  （§1.6 第 3、4 行：native `1` / 引擎 `5`）⇒ 需要步骤 4 才彻底闭合。

**风险**：R3-a：触发时点改变 ⇒ **副作用的可见时序**整体变化 ⇒ 既有生成器钉与差分语料（§3 表 #10）需全量回归；
R3-b：体在**消费点**才跑 ⇒ 若消费点在**另一个函数**里（生成器被返回给外部再消费），
体读到的外层绑定是「消费时刻」的值 ⇒ 与原生一致 ✓，但与**当前** eager 结果不同 ⇒ 既有期望值可能过时
（⇒ 按纪律「停下来报告」）。

### 5.4 步骤 4（完整解）：**真挂起**（体在第 k 个 `yield` 真正暂停）

- 把生成器体降成**真 JS generator**（转译侧发 `function*(){ … yield $yieldValue(v) … }`），
  `yield` 变真挂起点 ⇒ 步骤 3 的「一次跑到底」缺陷消失（native 的 `1` / `"a"` 精确复现）。
- 代价：`try/finally` / `break` / `continue` / `return` 在真 generator 内的语义要与 Abs 引擎的
  控制流 token（`NudoReturn` / `NudoLoopSignal`）**对齐**（`control.ts` 的一整套逃逸门）——
  这是**引擎内核级**改造，风险最高，建议独立成族。

### 5.5 各步的「值面」效果对照（以 §1.6 四行为例）

| 方案 | c1（native 0） | c2（native ""） | c3（native 1） | c4（native "a"） |
|---|---|---|---|---|
| 现状（eager 写穿） | `1` ✗ | `"ab"` ✗ | `5` ✗ | `"ab"` ✗ |
| **步骤 1（join 隔离）** | `0 \| 1` ✓sound | `"" \| "ab"` ✓sound | `0 \| 1` ✓sound | `"" \| "ab"` ✓sound |
| 步骤 3（延迟到消费点） | `0` ✓ | `""` ✓ | `5` ✗ | `"ab"` ✗ |
| 步骤 4（真挂起） | `0` ✓ | `""` ✓ | `1` ✓ | `"a"` ✓ |

⇒ **步骤 1 就能把「确定的错值」变成「sound 的过近似」**（brief 的 fail-closed 收窄标准）；
步骤 4 才逐点精确。

### 5.6 需要主 agent 拍板 / 分派的事项

1. **步骤 1 的归属**：`exec/transpile/**` 属 **S11** ⇒ 需 S11 承接（或另派片）。
   本片已把发射形状、复用点（`collectFreeAssignedNames`）、风险列全（§5.1）。
2. **步骤 1 的口径选择**：② 用 **join**（sound，推荐）还是「还原成事前值」（构造点精确、消费点欠近似 ⇒ 可能 L1 假绿）。
3. **步骤 2 的触发器注册表**：建议**不导出**（留在 `exec/match-iter.ts` 内部）以避开公开面；
   若需导出 ⇒ 拍板（公开面新增）。
4. **步骤 2 的 `conf` 可提升机制**：属**内核表示变更**（影响 `leqAbs` ⇒ 门禁精度）⇒ 需单独排期。
5. **是否本轮做步骤 1**：它不动公开面、只影响「生成器体写了外层绑定」的函数 ⇒ 收益明确、风险可控。

---

## 6. **局部收窄（fail-closed）方案**的可行性判定

brief 要求判定：「能否先做一个 fail-closed 收窄——生成器体在构造期改写外层绑定时，
至少不要把外层绑定改成『在任何原生观测点都不成立的值』」。

| 候选 | 做法 | 判定 |
|---|---|---|
| **N1 runtime-only 中和写** | 让 `$gen` 在跑体时把外层绑定的写拦下 | ❌ **不可行**：runtime 无句柄指向调用方闭包变量（§2.2）；`$assignRecord` 只能观测、不能中和（`exec/transpile/expr/assignment.ts` 丢弃其返回值） |
| **N2 runtime-only 延迟到首次消费** | 体推迟到首个 `next()`/元素面读才跑 | ❌ **本族内不可行**：元素面与 `conf` 都在构造期烘进 shape/置信度（§2.1）⇒ dts 元素类型退 `unknown`、`conf` 退 `path` ⇒ 签名面与 L1/L2 门禁面精度回退；且触发器注册表要跨 `match-iter.ts` / `containers/*` / `builtins/array.ts`（超出本片独占范围） |
| **N3 转译侧 join 隔离** | §5.1 步骤 1（② 取 `$join`） | ✅ **可行且不动公开面**（`$copy`/`$join` 均已是既有导出）——**但落点在 S11 的转译侧** ⇒ 本片不能单独落地；本片已给出可直接实施的规格 |
| **N4 只做观测、不改值** | 记录「体内写了外层绑定」并出诊断 | ⚠️ **可行且最轻**：`$assignRecord` 已有钩子，`$gen` 可在跑体期间挂一个**链式** collector（不夺走 service 的 assign-mismatch 通道）统计写入的名字 ⇒ 供 `nudo check` 报「生成器体改写外层绑定」提示。**但它只改「提示面」，不改「值面」** ⇒ 不能算 Bug 212 的收窄（可作 N3 的过渡/伴生措施） |

**结论**：
- **局部收窄在技术上可行**（N3），且**不需要新增/改动任何公开导出**；
- 但它的**唯一落点是转译侧**（`exec/transpile/**`，S11 范围）⇒ **S10 的独占范围内无法单独落地**；
- ⇒ 本片**不做**局部收窄 ⇒ **不交付新钉**，Bug 212 **仍为架构债**，
  **但已产出可直接实施的最小规格**（§5.1）+ 精确的受阻原因（§2.2）。

---
