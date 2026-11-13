# 生成器体的**惰性**语义（Bug 212）· 架构说明

> **状态**：**步骤 1（join 隔离）已落地（2026-11-04，架构债批次 A1）**——§5.1 的
> 「自由写快照 + `$join` 折回」已实施（wrong-exact 消灭，回归钉见 §5.1 落地注记）。
> **步骤 2 的触发点骨架已落地（2026-11-05，零回归）**：`exec/match-iter.ts` 把
> 7 个元素面读出函数收口到模块私有的幂等触发器表（生产侧不登记 ⇒ 构造期
> eager 时序与全部值面逐字不变），回归钉
> [`gen-trigger-skeleton.test.ts`](../packages/core/src/algebra/exec/__tests__/gen-trigger-skeleton.test.ts)。
> **步骤 3（延迟体）已落地 2026-11-07**（见文末「步骤 3 实施记录」）；
> **步骤 4 的「挂起点绑定回放」值面切片已落地 2026-11-07**
> ——c3/c4 的 native `1` / `"a"` 逐点精确复现（见文末「步骤 4 实施记录」）。
> **仍未闭合**：把体降成真 JS generator 的**全量真挂起**（含非绑定类副作用
> 的时序），经复核在本内核里不是局部改造（见 §5.4 订正）。
> 关联：诚实台账 → [`limitations.md`](./limitations.md) §1.4；架构债台账 →
> [`architecture-debt.md`](./architecture-debt.md) A1；仓内回归钉 →
> [`eval-bug-212-generator-body-eager.test.ts`](../packages/core/src/algebra/__tests__/eval-bug-212-generator-body-eager.test.ts)、
> [`eval-generator-cross-function-consume.test.ts`](../packages/core/src/algebra/__tests__/eval-generator-cross-function-consume.test.ts)。
> 分片：S10 · 族 44 · **研究级** · 出路 **B（精确登记）** · 2026-10-23
>
> **2026-11-05 复核订正（6 处与实现不符，勿照旧口径排期）**：
> ① `leq.ts` 全文**不读 `conf`**（`leqAbs` / `leqShape` 均不读）⇒ §2.1 /
> §5.2 的「conf 参与 leqAbs ⇒ 全局影响 L1/L2 门禁」不成立；conf 实际只进
> `objects.ts::sameOptionalAbs` 与 projection / drift 证据门槛，且**不进
> `absKey`**。② `Confidence` 有 **6 个**取值（`exact/path/widened/mock/
> partial/opaque`，`abs.ts:19`），不是 3 个；「未收集」标记可考虑复用
> `partial`（语义是「推导失败」，需另定口径）。③ 生成器对象的**数字下标
> 槽仍在**（`async.ts:917-919`，族 01 契约），§1.3 附近「Bug 240 不再有
> 数字下标槽」的注释已过期 ⇒ 步骤 2 的「原地补写」对**原对象**可行。
> ④ 三张侧表不是元素面唯一来源：`dts-generator.ts::iteratorTSType` 直读
> shape 数字槽、`async.ts` 的 `next/return/throw` 读闭包 `full` ⇒ 步骤 3
> 的触发点必须额外覆盖这两条旁路。⑤ `slots` 按引用共享**只对原对象**
> 成立：`hof.ts::snapshotAbs` 对 obj **深拷贝 slots** 且 `conf` 值拷贝 ⇒
> fork / `$copy` / 步骤 1 的别名快照副本拿不到原地补写。⑥ dts 面已由
> A11 残余批次输出**两实参** `Generator<T, TReturn>`（`dts-generator.ts:312-326`）
> ⇒ TNext 是**第 3** 实参，不是第 2。

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

**本片状态判定：局部收窄已落地**（2026-11-04，S11 转译侧实施步骤 1 ⇒ 交付新钉
`eval-bug-212-generator-body-eager.test.ts`；步骤 2–4 待续，债面收窄为「时间轴缺失」）。

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
| 9 | **schema / standard / guard / contract 导出**（`packages/service/src/emit/*`） | 生成器身份由 `facets.brand` 投影到 zod / standard / guard 三个运行时校验器面（2026-11-05 bug fix，见 `architecture-debt.md` 的实施记录）；无 brand 的旧 Abs 仍走结构面；**元素域不进 schema** | 身份投影已递归到嵌套字段（2026-11-06：`core/denote.ts::denoteGuardB` + `syncGeneratorTags`），四面同口径；惰性化不改变该面 |
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

> **✅ 已落地（2026-11-04，架构债批次 A1）**。实现：`exec/transpile/emit.ts` 新增
> `genOuterFreeWriteNames`（`collectFreeAssignedNames(...body.body)` 扣**形参模式名**与
> **体内 var 提升名**（`collectVarHoistNames`——var 提升在 thunk 顶发射 `let <名> = $lit(void 0)`，
> 不扣则快照读它们会 TDZ），再经 `expandAliasNames` 扩 **const 别名伙伴**（别名展开用**外层
> 作用域**的 opts——体内作用域的分组会掺进体内局部名））+ `genFreeWriteWrap`（快照行
> `const __g0_<n> = $copy(<n>, <共享memo>)` + `try { 原体 } finally { <n> = $join(__g0_<n>, <n>) }`；
> `$copy` 第二实参 = 共享 `WeakMap` 身份 memo ⇒ 同一对象只拷一次，别名组内不分裂身份；
> 临时名 `__g0_<n>` / `__gCopyMemo` 经 `internalTmpName`/`internalTmpNameSet` 避让用户同名
> 标识符）。四个 `$gen` 发射点全部接入；快照集为空时**零发射**（不写外层绑定的生成器产物
> 逐字不变）。回归钉：`eval-bug-212-generator-body-eager.test.ts`（12 用例：四行症状 +
> 四发射点 + 元素面承重 + 容器/别名组 + 负控制）。**残余**（→ §5.5 订正注）：首个 yield
> 挂起点中间值不在 join 内；步骤 2–4 待续。

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

**步骤 2 触发点骨架（2026-11-05 已落地，零回归）**：不改 Abs 表示、不动
公开面，只把「该跑了」的触发点收口到 `exec/match-iter.ts`：
`genTriggerTables`（模块私有 WeakMap）+ `fireGenTrigger`（按 Abs 身份幂等）
在 7 个读出函数首行调用（`drainGenElements` / `genDrainViewOf` /
`peekGenElement` / `hasGenView` / `peekAllGenElements` /
`replayGenDeferred` / `matchIterElements`），`copyMatchIterTables` 同步迁移。
**生产侧不登记触发器** ⇒ `$gen` 的 `body()` 时序不变、全部读出值逐字不变
（回归钉 `exec/__tests__/gen-trigger-skeleton.test.ts`，7 例）。
`registerGenTrigger` 不进任何 barrel（`src/index.ts` / `algebra/index.ts` /
`exec/index.ts` / `internal.ts` 均不 re-export 本模块）⇒ 公共 API 冻结不受影响。

**2026-11-06 旁路补齐（零回归，仍不构成语义增量）**：`fireGenTrigger` 改为
模块内导出（同样不进 barrel），`runtime/async.ts::makeGenObject` 的 `next` /
`return` / `throw` 三个协议方法首行接 `fireOnce()` —— 它们读的是闭包 `full`，
原骨架的 7 个读出面覆盖不到。生产侧**仍不登记任何触发器** ⇒ 三条调用恒为
WeakMap miss，值面逐字不变。回归钉
`exec/__tests__/gen-trigger-protocol-faces.test.ts`（7 例：三方法各触发一次且
幂等、与 7 面共享同一触发器、未登记时 Bug 212 / 族 01 精确串不回归）。

> 骨架与旁路补齐都**不构成 §5.2 的语义增量**：「可延后填充元素面」的
> `conf` 可提升机制、`dts` 直读 shape 旁路、`snapshotAbs` 深拷贝副本的原地
> 补写都**尚未处理** ⇒ 台账 A1 仍记步骤 2 未闭环，不得因接线落地改标为
> 「已修」。其中 `dts` 侧不是「漏接触发点」：它在 **service 包**且于**导出
> 时**读 shape，根本没有消费点（见下方 2026-11-06 实证 B）。

### 5.3 前的**步骤 3 停点**（2026-11-05 复核结论）

一次提交同时撼动 5 个面（构造点值域 / 元素面 / conf 与门禁 / 委托表时序 /
延迟异常重放），且要改的既有 expectation 是可枚举的一大批：

| 面 | 必改 expectation（精确文件） |
|---|---|
| 构造点值域 | `eval-bug-212-generator-body-eager.test.ts:49,59,70,81`（`'0 \| 1  #exact'` 等四行）、`:91,:99,:107,:115`（四发射点）、`:126`（元素面 exact）、`:138`（长度域）、`:149`（别名组） |
| 元素面 / dts | `exec-generator.test.ts:24,43,72,74,76,124,134`、`exec-generator-protocol.test.ts`（16 条）、`exec-generator-consumption.test.ts` / `-precision.test.ts` / `eval-generator-semantics.test.ts` 全族；`service/src/emit/__tests__/emit-abs-brand-projection.test.ts:85-91`（元素槽空 ⇒ `Generator<unknown>`） |
| 差分语料 | `differential/corpus/batch5.ts:310-317`、`batch11.ts:541-544`、`batch20-transpile-adversarial.ts:102-106` 共 14 条（「先消费再取值」形态在触发点覆盖 `next()` / spread / for-of 三条后应仍绿） |
| 委托表 | `async.ts:790-823` 的 `genDelegationStack` 在**体执行序**里建 ⇒ 随体延后则下标对位失效即「不转发」 |
| 延迟异常 | `deferred` 只在体跑后才有 ⇒ `replayGenDeferred` / `next()` 重放时点整体后移 |

**且 R3-b（跨函数消费）此前无回归钉**：仓内没有「生成器对象被 `return` 出
外层函数、体捕获外层 `let`、消费时刻读到不同值」的用例。`eval-generator-cross-function-consume.test.ts`
补了现状钉（引擎 `0` / 原生 `9`）与 3 条 `it.todo` 验收清单，作为步骤 3 的**前置条件**。

⇒ **本批次明确停点**：步骤 3 / 4、`conf` 可提升机制、`genNext` 真求值填充
**不做**。理由不是「没找到修法」，而是它们属引擎内核表示变更（§2.3「Abs
无时间轴」、控制流 token 跨挂起点不可恢复、`withIsolatedYields` 的 arm
换顶机制在真 generator 内失效），且必须独立成族 + 独立全仓基线。照
`architecture-debt.md` 的纪律「任何精度回退即回滚」，不在一次增量里合并。

#### 2026-11-06 独立成族轮：**实测复核**（把上面的推断升级为可复核证据）

在干净 HEAD `02371228` 上先建独立全仓基线（1651 入口 / 0 新增失败），再做
5 组受控实验（探针只在实验期临时插入、实验后**逐字撤除**，生产零残留）：

| 实验 | 做法 | 实测结果 | 判定 |
|---|---|---|---|
| **A** | 临时让 `$gen` 构造期跑空体 | 生成器 8 族 **100 失败 / 38 通过** | §2.1 实证：eager 收集是值域 / `conf` / 元素面的承重结构，不是可选优化 |
| **B** | 真实 `absToTSType` 对「有无数字下标元素槽」的生成器 Abs | 有槽 `Generator<number>`，无槽 **`Generator<unknown>`** | dts 在**导出时**直读 shape、无消费点 ⇒ 体延后必然让签名面精度回退；且该面在 service 包，core 侧触发器结构性不可达 |
| **C** | 真实 `snapshotAbs` 副本 + 首消费点原地补写 slots | 原对象恢复 `Generator<number>`，副本仍 `Generator<unknown>`；两者 `slots` **不共享引用** | §5.2 未处理的旁路被坐实：`$copy` / fork / 快照副本拿不到补写 |
| **D**（新发现） | 真实 `$gen` + 手工 body，构造后改写外层绑定再跑 | 构造期 `0  #exact`，重跑 `9  #exact` | **`body` thunk 捕获活绑定，不是构造期快照** ⇒ R3-b 的「消费期绑定可见」在表示层并非不可达（文档此前未评估） |
| **E**（对 D 的否决） | 体里带 `n++` 类副作用后重跑 | 第二次跑读到 `99`（副作用被重复执行并累加） | 否决「消费点重跑 + join」这条捷径：体重跑会把副作用再执行一次 ⇒ 不是 sound 的修法，仍需 §2.3 的续体表示 |

**结论**：步骤 3 / 4 本轮仍**不实施**。D 曾打开一条看似可绕开内核改造的窄
路，E 用实测把它关上；B / C 则说明即便解决 D/E，签名面与快照副本仍会精度
回退 ⇒ 按纪律「任何精度回退即回滚」，全量方案必须停在**引擎内核表示变更**
（Abs 需有「按 yield 点分段的状态序列 / 可恢复挂起帧」这一维）。

证据已固化为可执行 PoC（不接生产、不改既有断言）：
- core 侧 `core/src/algebra/exec/__tests__/a1-laziness-evidence-core.test.ts`（A / D / E，4 例）
- service 侧 `service/src/emit/__tests__/a1-laziness-evidence-poc.test.ts`（B / C，2 例）
- 旁路基线 `core/src/algebra/exec/__tests__/gen-trigger-protocol-faces.test.ts`（7 例）

**下一轮若要真推进，最小前置清单**（按依赖序）：① `conf` 可提升机制 +
`leqAbs` 影响面复核（§5.2 R2-a）；② dts 元素域通道（**2026-11-06 已收口**：第三种预置
`AbsFacets.genElements` 承载位 + 返回注解降级为一致性诊断；符号 PoC 实证
「独立编译实例的无约束入口求值可零精度损失回填」；同日产品裁定
「nudo any ≈ TS unknown」把 TS 投影面归一 ⇒ 退化档 `Generator<any>` →
`Generator<unknown>`，接产前的 soundness 前置关闭。**但实测 `analyzeFile` 的
`combinedAbs.facets.genElements` 本已非空**（`number | string | 7`）⇒ 导出期
再求值回填属重复劳动、零收益，且会引入双重真值来源 + 冷/热缓存分裂；
唯一有意义的接产形态仍是步骤 3「体延后」引擎内核改造，见下节；**注意归一只关闭 soundness 前置，不解锁值面**，末轮复核实测体延后仍 100 条回归）；
③ `snapshotAbs` / `$copy` / fork 的补写迁移；④ 步骤 4
的控制流 token 与真 `function*` 挂起点对齐（`control.ts::withIsolatedYields`
的 arm 换顶、`NudoReturn` / `NudoLoopSignal` 跨挂起点语义）。

#### 2026-11-06 第五轮 · TS 投影面归一与步骤 3 停点（独立成族）

**产品裁定**：「nudo 的 `any` 含义更接近 TS 的 `unknown`」。代码侧依据：
`abs.ts:29-37` 的 `any` 是「JS 里任意值 / 无约束并集」，三面运行时校验器
早把 any / unknown 同映为 `unknown`（`schema-generator.ts:578` /
`guard-generator.ts:141` / `standard-schema.ts`），`.d.ts` 曾唯一把 nudo any
直译成 TS `any`。`abs.md:100` 的 display 规则被 `dts-generator.ts` 误引到 TS
产物面 ⇒ 实为**作用域误用**，不是产品契约冲突。

**落地**：`absToTSTypeB` 的 `case "any"` → `unknown`；另补齐 `classParamDecl`、
无签名导出 fallback、泛型基类实参三处硬编码。`formatAbs` / `nudo check` /
`nudo contract` / `case-json` / contract draft 等 **nudo 展示面逐字不变**。

| 实验 / 证据 | 结论 |
|---|---|
| 全仓归一实验 | 26 条新增失败**全是 TS 精确串断言**，0 功能失败 ⇒ 可订正 |
| 端到端 `nudo export --format dts` | `Generator<any>` → `Generator<unknown>`；`a(x: unknown)`；stderr 点名提示覆盖主路径 |
| BUG-076 提示通道 | 按「渲染为 unknown」触发 ⇒ 归一后长期「文档承诺 vs 实现」矛盾**彻底关闭** |
| Bug 544 tsc 实证 | 未收窄返回值触发 TS2571 从「假红」改判为**正确提示**，收窄后过 strict |
| `analyzeFile` 的 `combinedAbs.facets.genElements` | 实测非空（`number \| string` / `7`）⇒ 导出期重复求值**零收益** |

**步骤 3 明确停点（本轮不实施）**：符号 PoC 建议的「导出期独立求值回填」在
**体仍 eager** 的现状下是负收益（双重真值来源 + `analyzer-cache.ts:149`
克隆后冷/热可能拿到不同序列）。真正解绑仍需让 `$gen` 构造期不跑体 =
引擎内核表示变更（实验 A：100 条生成器族回归；`conf` 可提升、
`snapshotAbs` 补写迁移、控制流 token 对齐）⇒ 按纪律独立成族 +
独立全仓基线。本轮只关闭 soundness 前置，**不碰 `$gen` 运行时时序**。

##### 2026-11-06 末轮复核 · 归一之后步骤 3 能不能做

在 `b0609869`（归一已落地）上加**临时探针**令 `$gen` 构造期不跑体，
实验后逐字撤除、零残留、工作区干净：

| 实测 | 结果 |
|---|---|
| 生成器 8 族 | **100 失败 / 38 通过 / 3 todo（141）**，与归一前的实验 A **逐字一致** |
| 端到端 `nudo export --format dts` | 4 个生成器全退 `Generator<unknown, undefined, unknown>`（不再 `any`，但仍是精度回退） |

⇒ **归一关闭的是 soundness 前置（TS 用词），不是步骤 3 的解锁条件**。
上一轮把 `any → unknown` 称作「接产前唯一硬前置」措辞过宽，易被读成
「关了就能做」，在此订正：步骤 3 的承重阻塞一直是**运行时值面**
（eager 收集烘进 `full` 闭包 / 元素槽 / `conf` / 委托表 / 延迟异常）。

**同时订正上一轮的「撤回接产建议」边界**：「导出期独立求值回填零收益」
只在**体仍 eager** 时成立；一旦体延后，`genElements` 为空 ⇒ 回填从
「零收益」变成**必需子任务**（符号 PoC 实验 E 已证零精度损失）。
所以步骤 3 的完整切片 = 体延后 + 导出期符号回填 + 值面懒填充，三者同批。

**判定：路径已闭合，无未知技术不可行项 ⇒ 可立项独立成族**，但不是零成本
小步。剩余工作量：① `makeGenObject` 的「体已跑完」假设改为首消费点触发
并懒填充；② 重订 100 条断言 + 4 个生成器族 + 14 条差分语料；
③ `conf` 可提升机制（缓存键失效 + `confJoin` 单调不升）尚未实施；
④ `snapshotAbs` 的 shape 槽补写对副本失效（实验 C）仍未解 —— WeakMap
侧表迁移已修但不是同一件事。步骤 4 的控制流 token 对齐**不属于**步骤 3
前置（步骤 3 后 c3/c4 仍不精确是已知剩余缺陷，§5.5）。

#### 2026-11-06 前置复核（同日第二轮，逐项收敛）

| 前置 | 复核结论 | 落地 |
|---|---|---|
| ① `conf` 可提升 + `leqAbs` | **原判定「影响 L1/L2 门禁精度」被实测推翻**：`leq.ts` 全文 0 次 `conf`；`leqAbs(path, exact)` 与反向均 `{ok:true}`；`absKey` / `absShapeKey` 不进 conf。真正要设计的是 ⓐ **缓存键失效**（同键复用 path 时期结论，升 exact 后不自动重算）与 ⓑ **`confJoin` 单调不升**（一旦有中间 join 参与，提升必须显式重算）；`formatAbs` 的 `#exact` / `#path` 后缀会变 ⇒ 精确串断言需逐条复核 | `core/.../__tests__/a1-conf-promotion-evidence.test.ts`（4 例） |
| ③ `snapshotAbs` 侧表迁移 | **已修（A7 镜像一致性缺口）**：`$copy` 早有 `copyMatchIterTables`，`snapshotAbs` 此前只搬 fn impl ⇒ 生成器 / 模板 / matchAll / 用户迭代器 / Proxy 的迭代元素、延迟异常、drain 视图在副本上整体丢失（L2 假阴）。`hof.ts` 末尾补 `copyMatchIterTables(a, out)`；`match-iter.ts` 只依赖 algebra 顶层叶子、不依赖 `hof.ts` ⇒ 无环。**与 `$copy` 同口径共享视图引用**（副本消费推进原对象状态，负控钉住） | `core/.../__tests__/snapshot-match-iter-tables.test.ts`（6 例），全仓 0 新增失败 |
| ② dts 元素域通道 | **第三种已落地**（显式承载位 + 注解一致性诊断；fork 分支 `unknown` → `number \| string`）；**符号 PoC 轮**进一步实证「独立编译实例 + `any` 入口」可回填承载位、体延后零精度损失 ⇒ 接产绑定步骤 3，不单独接 | `core/.../gen-elements-facet.test.ts`（7 例）、`service/.../emit-gen-elements-facet.test.ts`（9 例）、实验 F（2 例）、`exec/__tests__/symbolic-yield-domain-poc.test.ts`（21 例） |

> ⚠️ ③ 修的是 **WeakMap 侧表迁移**，**不等于** 实验 C 的「首消费点补写
> `shape.slots` 对副本失效」——后者仍是未解前置：`snapshotAbs` 对 obj 槽
> 是**深拷贝**（`hof.ts:67-76`），补写只落原对象。要让补写同步到副本，
> 需另建「原对象 → 副本集合」的反向映射或让副本共享 slots 引用（后者会
> 破坏快照的独立语义）⇒ 留待步骤 3 独立成族时一并设计。

##### dts 元素域通道 · **第三种已落地（2026-11-06）**

实证 F：`generateDts(result)` 只吃 `AnalysisResult`，`dts-generator.ts` 只
import `@nudojs/core` 的纯函数 / 类型、**不引 exec 运行时**，且 `absToTSType`
对同一 Abs 幂等、不写回 shape ⇒ **导出期没有、也不该有消费点**（dts 必须
是纯投影）。所以「体延后」时元素域不可能靠「调用方先消费再导出」补回。

| 方案 | 代价 | 判定 |
|---|---|---|
| **(a) 接受 `Generator<unknown>` sound 降级** | 精度回退；且与 schema / standard / guard 三面按 brand 收紧的口径**不一致**（四面指向不同声明域） | 需产品明确接受；按现行「任何精度回退即回滚」纪律，**默认否决** |
| **(b) 导出前跨包触发体** | 破坏 dts 纯投影（导出变成有副作用求值）；且 `fireGenTrigger` 按 Abs 身份登记，Abs 经 harvest / 快照往返后身份已变 ⇒ 触发不到 | ❌ 技术不可行 |
| **(c) 把元素域烘进 `AbsFacets` 随值搬运** | 构造期仍需求值体（回到 eager）⇒ 与步骤 3 目标矛盾；或新增「静态 yield 域推断」通道（独立大族） | ✅ **已实施「第三种」**（承载位 + 注解降级为诊断）；但**不解锁步骤 3**，见下方边界 |

**2026-11-06 裁决与实施**：用户裁定走「第三种」——(c) 的显式承载位
（`AbsFacets.genElements`）+ 源码返回注解**降级为一致性校验**（只落
`nudo:return-annotation-mismatch` 台账，绝不覆盖观测产物）。设计理由：
单一真值来源；把「从 shape 数字槽用 `CANONICAL_INDEX` 正则反推语义」
升级为随值携带的显式字段；延续 A11 facets 的既有设计；避免 BUG-168
在形参位修掉的「check 面与 dts 面相反裁决」在返回位复现。

###### 实测收益（端到端 `nudo export --format dts`）

| 场景 | 第三种之前 | 第三种之后 |
|---|---|---|
| fork 分支 `if (f) yield 1; else yield "s"` | `Generator<unknown>` | **`Generator<number \| string>`** |
| 快照 / 重建产物的元素域 | 靠数字槽（可能折损） | 随 facets 同源、副本不丢 |
| 手工 Abs 只有 `genElements`、无数字槽 | `Generator<unknown>` | `Generator<number>` |
| 注解 `Generator<number>` 但实现 `yield "s"` | 无提示 | 台账 + 产物仍 `Generator<string>` |

分支精度回升的原因：`$gen` 的 `ys.els`（完整序列）本来就是 Bug 53
注释点名的**权威数据**，而 shape 数字槽是 `$arr` / fork join 之后的结构
近似；此前 dts 读的是后者 ⇒ 被折成 `unknown`。

###### ⚠️ 边界：**第三种没有解锁步骤 3**

`genElements` 仍是**构造期跑体**得到的（`$gen` 内 `ys.els`）。步骤 3 把
`body()` 挪到首消费点 ⇒ 构造期没有序列 ⇒ 该字段也填不上；而实证 F 的
结论不变（dts 是纯投影，**导出期没有也不该有消费点**）。所以它解决的是
「同源携带 / 精度 / 概念诚实」，**不是**「惰性化的签名面」。上一轮把 (c)
描述为「能解锁步骤 3」的判断据此订正：它只**预置了承载位与未填充语义**
（`undefined` = 未收集），真正填值仍需静态 yield 域推断或接受降级。

⇒ 前置 ② 现在是「**部分解决 + 解法已实证**」；步骤 3 若推进，按下节
PoC 结论把「符号求值从构造期解绑到导出期」作为同轮子任务即可，**不再需要
在「静态推断」与「接受降级」之间拍板**（该问题已由 PoC 关闭）。
注解降级为诊断后，**不再**是补产物的候选（实现是事实、声明是断言）。
另：静态声明收割（harvest）不构造生成器运行时值 ⇒ `genElements` 不进
`HARVEST_DISK_ABI`，缺省时消费面严格 fallback 到数字槽。

###### 2026-11-06 符号 yield 域 PoC 轮（独立成族，只读实证）

在干净 HEAD `951b2566` 建独立全仓基线（`1658 入口 / 20 失败 = 基线 20`），
用**真实引擎 API** 做 5 组实验，**不接生产、不改任何既有断言**，固化为
`core/src/algebra/exec/__tests__/symbolic-yield-domain-poc.test.ts`（21 例）。

| 实验 | 结论 |
|---|---|
| A · 无约束入口 vs 具体入口 | `callTranspiledExportFull(ex, "g", [anyAbs])` 的 `genElements` 是 concrete 的 **sound 上界**：常量精确、参数运算 / 分支 / 循环过近似、宿主调用 / `yield*` 退 `any` |
| B · 投影面 | 符号版交给 `absToTSType` 得 `Generator<number \| string>` 等；**当时**退化档是 `Generator<any>`（同日第五轮已归一为 `Generator<unknown>`） |
| C · 副作用隔离 | **独立编译实例 3 次结果逐字相同**（`1  #exact`）；同一实例内重跑第 2 次变 `number  #partial`（坐实实验 E）⇒ 独立编译天然规避「重复副作用」，这是「消费点重跑」被否决后绕开它的关键 |
| D · 生产路径 | `nudo export --format dts` 对 `a(x)` / `b()` / `c(xs)` / `d(flag)` 的产物与符号 PoC **逐字一致** ⇒ **引擎本来就在做符号求值**：入口形参是 `any`，`genElements` 已经是「无约束入口跑体」的结果，通道不是新机制 |
| E · 回填闭环 | 真·体延后（清掉数字槽 + `genElements: undefined`）⇒ `Generator<unknown>`；用**独立编译实例**再做一次符号求值回填同一承载位 ⇒ **`Generator<number \| string>`，零精度损失** |

**覆盖矩阵量化**（14 形态 × 多个具体见证，判据 `leqAbs(concrete, symbolic)`）：
**精确 7 / sound 过近似 4 / 退化 3 / unsound 0**。退化 3 例全是
「参数直接 yield / 宿主调用 / `yield*` 委托」⇒ `any`。注：`any` 作目标时
`leqAbs` 平凡通过 ⇒ 真正信号是**非退化 11 例全部 sound、其中 7 例精确**。

**决策：可行，但本轮不单独接产。**
1. 现状生产路径**已经有**正确的 `genElements`（实验 D）⇒ 现在再接一次独立
   求值属重复劳动、零收益且多一次求值开销。接产动作应**绑定在步骤 3 那一轮**，
   作为「把符号求值从构造期解绑到导出期」的子任务，与体延后同批验证。
2. ~~**接产最小切片**：analyzer 导出期独立求值回填 `combinedAbs`~~
   —— **第五轮已撤回**：实测 `analyzeFile` 的 `combinedAbs.facets.genElements`
   本已非空（`number \| string` / `7`）⇒ 重复求值零收益，且会带来双重真值
   来源与 `analyzer-cache` 冷/热序列分裂。真解绑仍需 `$gen` 构造期不跑体。
3. **接产前必须先修（✅ 第五轮已落地）**：当时退化档 `Generator<any>` 在
   TS 里比 `Generator<unknown>` 更宽松（`any` 是逃生舱）⇒ 上一轮「严格占优」
   不成立。按产品裁定「nudo any ≈ TS unknown」把 **TS 投影面全局归一**
   （不止 `iteratorTSType` 元素位）：`absToTSTypeB` 的 `case "any"` → `unknown`
   + 三处硬编码 fallback；26 条精确断言重订、0 功能失败；按 11-05 判例走
   **patch**。详见上方「第五轮 · TS 投影面归一与步骤 3 停点」。
4. 上一轮「静态推断 vs 接受降级」的待拍板问题**关闭**：数据支持推断通道；
   降级的正确位置仍是推断失败时的**回退值**，不是产品默认契约。

### 5.3 步骤 3：**把「首次 `next()` 才跑」做成默认**（构造期不再跑体）

> **状态：2026-11-07 已落地**（独立成族，见文末「步骤 3 实施记录」）。
> 下文保留的是**设计原文**，其中「未做 / 待前置」的表述按实施记录理解。

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

> **状态：2026-11-07 值面切片已落地**（见文末「步骤 4 实施记录」）。
> 下文「把体降成真 JS generator」的**字面方案经复核在本内核不可局部落地**，
> 理由见下方订正；已实施的是「挂起点绑定回放」——不改体执行时序，把
> native 的挂起点语义在**外层绑定值面**精确复现。

- 原设想：把生成器体降成**真 JS generator**（转译侧发
  `function*(){ … yield $yieldValue(v) … }`），`yield` 变真挂起点 ⇒ 步骤 3
  的「一次跑到底」缺陷消失（native 的 `1` / `"a"` 精确复现）。
- 代价：`try/finally` / `break` / `continue` / `return` 在真 generator 内的语义要与 Abs 引擎的
  控制流 token（`NudoReturn` / `NudoLoopSignal`）**对齐**（`control.ts` 的一整套逃逸门）——
  这是**引擎内核级**改造，风险最高，建议独立成族。

**2026-11-07 结构订正（为何字面方案不是局部改造）**：

1. **语法层**：引擎的分支/循环/switch/try 体是**宿主箭头回调**
   （`$fork(test, () => …)`、`$whileSeq(() => …, () => …)`、`$for(…, () => …)`）。
   `yield` 落在非生成器箭头里是 **SyntaxError**，一次编译失败会让整模块
   导出全丢 ⇒ L2 闸门假绿（仓内 `Bug 1139` 安全网正是为此存在）。仓里
   `transpile/async-plan.ts` 只对 **async 体**做「await 是否全在 gen 级」的
   判定，且必须配 `disableAsyncGen` 重试；生成器体没有等价的门。
2. **语义层**：抽象 fork **一次跑完双臂**（`withIsolatedYields` 逐臂隔离收集器，
   `mergeArmYields` 再 join）。真 generator 一个 `next()` 只能挂在一个程序点
   ⇒ 两臂各有一个 `yield` 时无法同时挂起；继续体也无从选择。要让双臂各自
   可挂起，需要把 `$fork` / `$whileSeq` / `$for` / `$switch` / `$try*` 全部
   改成 generator 变体并由外层 `yield*` 委派（CPS 重写），且 `loopExits` /
   may-throw 帧 / `yieldStack` 的 ALS 作用域要跨 `next()` 续接。
3. **结论**：这是 Abs 求值模型的表示层改造，不是「步骤 4 单独成族」能
   收口的一刀。本轮采取**值面切片**：体仍一次跑完（步骤 3 不变量），
   用转译侧 `capture`/`restore` 钩子把**外层自由写绑定**在每个 `$yield`
   处记成时间轴，消费推进到第 k 个 yield 时回放到 `timeline[k-1]`。
   §5.5 的四行 native 值全部精确，且零精度回退；非绑定类副作用
   （宿主调用、may-throw 收集）的时序仍整体落在首次消费点，是**已知边界**。

### 5.5 各步的「值面」效果对照（以 §1.6 四行为例）

| 方案 | c1（native 0） | c2（native ""） | c3（native 1） | c4（native "a"） |
|---|---|---|---|---|
| 现状（eager 写穿） | `1` ✗ | `"ab"` ✗ | `5` ✗ | `"ab"` ✗ |
| **步骤 1（join 隔离）** | `0 \| 1` ✓sound | `"" \| "ab"` ✓sound | `0 \| 5` ✓sound* | `"" \| "ab"` ✓sound* |
| 步骤 3（延迟到消费点） | `0` ✓ | `""` ✓ | `5` ✗ | `"ab"` ✗ |
| **步骤 4（2026-11-07 挂起点回放）** | `0` ✓ | `""` ✓ | `1` ✓ | `"a"` ✓ |

⇒ **步骤 1 就能把「确定的错值」变成「sound 的过近似」**（brief 的 fail-closed 收窄标准）；
步骤 4 的值面切片让四行逐点精确（§5.4 订正：体执行时序本身未真挂起）。

**2026-11-07 实测补记**：步骤 4 之后 c3/c4 分别为 `1  #exact` / `"a"  #exact`；
连续两次 `next()` 后推进到 `5` / `"ab"`；抽象分叉体、`yield*` 委托、
未启动生成器上的 `.return()` / `.throw()` 三类形态由 sound 守卫整帧禁用
回放 ⇒ 严格回退到 `0 | 5` 的 join 过近似，未产「自信的错值」。

\* **2026-11-04 落地实测订正**：c3/c4 的 join 成员是**事前/事后两端**（c3 = `0 | 5`，
c4 = `"" | "ab"`）——首个 yield **挂起点**的中间值（native `1` / `"a"`）不在 join 内
（Abs 无时间轴，§2.3），两行按「构造点 native 值 ∈ join」的 sound 标准判 ✓（构造点
native `0` / `""` 均在 join 内）。本表 2026-10-23 原稿把 c3 写成 `0 | 1` 是笔误
（该值需挂起点信息，步骤 4 才可产）。

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

---

## 2026-11-07 · 步骤 3 实施记录（独立成族）

**改前基线**：`b0609869` 全仓 `1659 入口 / 20 失败 = 基线 20`。末轮复核在
归一后的 HEAD 用临时探针（构造期停跑体、无触发器）实测 **100 失败 /
38 通过**；本轮把**触发式填充**接上后，同族从 100 失败收敛到 0。

**实现**（core 包内，公共导出形状不变）：
1. `runtime/async.ts`：把 `$gen` 的跑体收集抽成 `collectGenBody`；`$gen`
   构造期只产空壳（`makeGenObject` 空序列 + `conf: path`）并 `registerGenTrigger`
   登记 `(target) => mergeDeferredBody(target, ensureFresh())`；`ensureFresh`
   缓存一次体求值。**协议三方法**在 `fireOnce()` 后把本次调用转发到升级后的
   槽值（否则首调读到空壳序列，实测 `undefined:1`）。
2. `exec/match-iter.ts`：触发器值类型改为 `(target: Abs) => void`，
   `fireGenTrigger(a)` 传 `a`；新增 `genTriggerAliases` 按族广播到
   `snapshotAbs` / `$copy` 的所有别名（每别名只合并一次）；新增
   `pendingGenShells` / `notePendingGen` / `drainPendingGens`。
3. `exec/run.ts`：`callTranspiledExportFull` 在求值收口排空未消费的壳
   ⇒ 既有 eager 值面契约（Bug 212 / 族 01 数字下标）与 service 侧 `.d.ts`
   纯投影的元素域**都不退化**（端到端 `Generator<number \| string>` 等与
   改前逐字一致），无需跨包回填、无需独立符号求值。

| 实测 | 结果 |
|---|---|
| 首版（无协议转发） | 生成器 9 族 66 失败（`undefined:1`） |
| 加协议转发 | 13 失败，全部为期望过时 / 骨架负控制前提变更，**零真精度回退** |
| 加求值收口排空 | 9 失败；四类消费面（next / spread / 下标 / for-of）全精确 |
| 断言重订 + 别名广播 | 生成器 9 族 **全绿** |
| 端到端 dts | `Generator<number \| string>` / `Generator<number>` / `Generator<unknown>` / `Generator<number \| string>`，与基线一致 |

**值面收益（与原生一致）**：跨函数消费 `yield n` 读到消费期绑定 `9`
（此前 `0`）；构造点 c1/c2 从 `0 \| 1` / `"" \| "ab"` 收敛为精确 `0` / `""`；
容器 mutator 长度域过近似收敛为精确 `0`。`n++` 只执行一次（幂等 + 缓存）。

**回归**：新增 `exec/__tests__/gen-deferred-body.test.ts`（5 例）；
`eval-generator-cross-function-consume.test.ts` 由「现状钉 + 3 todo」升级为
4 例 R3-b 验收 + 1 条步骤 4 todo；Bug 212 的 5 条精确断言、步骤 2 骨架
2 条负控制、`snapshot-match-iter-tables` 的 `gen()` 夹具按新语义重订。

**abrupt completion（2026-11-13，ABS-13 方案 C）**：`.return()` / `.throw()` /
`for-of break` / `yield*` 委托会执行外围 `finally`。此前外层绑定停在挂起点快照
⇒ finalizer 写过的绑定可能是 native 不可能的定值（`try { yield 1 } finally {
cleaned = true }` 的 `.return()` 后读到 `false`，native 为 `true`）。方案 C 在
abrupt 完成时把「挂起点快照」与终态格**逐绑定 join**（`exec/runtime/async.ts`
的 `joinGenSuspendTerminal`，并封锁后续时间轴回放）⇒ sound，但精度只到
`false | true`。**方案 A-narrow（2026-11-13）已交付**：可安全抽取的 `finally`（无 yield/return/
throw/break/continue/await/var）由转译器发射为 thunk，经 `$yield`/`$yieldStar`
第三实参传到 runtime；`.return()` / 无 catch 的 `.throw()` 回到挂起点快照后按
内→外重放 ⇒ `try { yield } finally { cleanup }` 的清理值精确（嵌套 `[true,true]`）。
剩余：finalizer 含 yield/return/throw、`for-of` close、async generator 的
finalizer 抛错（应走 rejected promise）。夹具 `abs13-abrupt-completion.test.ts`
（11 例，含无 finally / 正常耗尽 / 不扩大化对照）。

**剩余（本轮时点）**：步骤 4 全量真挂起（含非绑定类副作用时序）；
`conf` 可提升机制与 `snapshotAbs` shape 槽补写失效前置，因求值收口排空 +
别名广播已让可观察面不退化，本轮未单独实施。**c3/c4 的中间值已由
2026-11-07 步骤 4 值面切片闭合**（见下节）。

**已知边界**：`drainPendingGens` 目前只挂在
`callTranspiledExportFull`（analyzer / evaluator 的主求值入口）。若某条路径
直接经 `$call` / `runTranspiled` 顶层创建生成器且**从不消费、也不经过该入口**
（如个别 LSP replay 分支），空壳会保留到下一次求值收口才排空 ⇒ 该路径的
未消费展示面在此期间是 `{  } #path`。全仓基线未踩到该形态；若后续出现，
把排空挂到 `runWithCollectorScope` 出口即可（同一函数、更大作用域）。

---

## 2026-11-07 · 步骤 4 实施记录（挂起点绑定回放 · 值面切片）

**改前基线**：`533c8c66`（步骤 3 已落地）全仓
`1660 入口 / 20 失败 = 基线 20，0 新增 / 0 消失`。

**为什么不是「把体降成真 JS generator」**：见 §5.4 的 2026-11-07 结构订正
——转译产物的分支/循环臂是宿主箭头（真 `yield` 进去即 SyntaxError），
抽象 fork 又一次跑完双臂、无法只挂在其中一臂。字面方案要求把 `$fork` /
`$whileSeq` / `$for` / `$switch` / `$try*` 全部改成 generator 变体并跨
`next()` 续接 ALS 帧，属求值模型表示层改造，不是局部一刀。

**实现（core + transpile，公共导出形状不变）**：

1. `transpile/emit.ts::genSuspendTail(names, opts, asyncMode)`：四个 `$gen`
   发射点（声明 / 函数表达式 / 对象方法 / 类方法）在自由写名集非空时，
   给 `$gen` 追加**可选第三实参** `{ capture, restore }`。`capture` 用
   `$copy` + 共享 memo 读出全部自由写绑定的 Abs 快照（容器深拷贝、
   const 别名组身份不分裂）；`restore` 用 `$rebindable` 守卫写回
   （宿主全局不被包装 Abs 污染，同 B1 口径）。**名集为空时零发射**
   ⇒ 绝大多数生成器的转译产物逐字不变。
2. `runtime/async.ts`：`$yield` / `$yieldStar` 在挂起点调
   `noteGenSuspendPoint()` 把 `capture()` 推进当前帧的 `timeline`
   （委托按并出元素数占多个挂起点，保持与元素序列对齐）。
   `collectGenBody` 在体执行期间压帧，结束后把帧挂到 fresh 生成器对象，
   `mergeDeferredBody` 再随别名广播共享同一帧。
3. `makeGenObject`：`next()` 交付第 `state.i` 个 yield 后调
   `applyGenSuspend(genSelf, state.i)` 回放 `timeline[state.i-1]`；
   **`next()` 耗尽**与迭代 `drain()` 都推进到**终态格**
   `full.length + 1`（体跑完、步骤 1 的 finally join 已折回的快照）
   ⇒ 最后一个 yield 之后的写不被 wrong-exact 抹掉。回放**单调**
   （`lastApplied`）⇒ 耗尽后的 `next()` 不回卷。`.return()` /
   `.throw()` **不推进**——原生落在未启动生成器上时体根本不跑，
   推进到末尾会产 wrong-exact `5`，故保留步骤 1 的 join 过近似。
4. **帧栈隔离**：`collectGenBody` 每次调用都压一格（无钩子时压
   `undefined` 哨兵）。嵌在外层体里创建并消费的内层生成器，其
   `$yield` 若读到栈顶的外层帧会把快照错记进外层时间轴 ⇒
   `exec-generator-consumption` 的 inner `.return(77)` 钉住过该污染
   （首轮全仓唯一新增失败），加哨兵后归零。

**sound 守卫**（`collectGenBody` 整帧 `enabled = false`，严格回退 join）：
① 路径敏感（`genJoinOverride !== null || bumpGenPathSensitive`）——fork 臂
序列是 join 不是线性时间轴；② 体内延迟异常（Bug 34）；③ `yield*` 委托
（`genDelegationStack` 非空）。三类实测均为 `0 | 5  #exact`，无「自信错值」。

| 实测 | 步骤 3 | 步骤 4 |
|---|---|---|
| c3 `it.next()` 后 n（native 1） | `0 \| 5` | `1  #exact` |
| c4 `it.next()` 后 log（native "a"） | `"" \| "ab"` | `"a"  #exact` |
| 连续两次 next()（native 5 / "ab"） | `0 \| 5` | `5` / `"ab"` |
| 分段读取 `1:1:2:5`（native） | 不精确 | `"1:1:2:5"  #exact` |
| 消费期绑定 × 回放叠加（native 9:9:5） | 不精确 | `"9:9:5"  #exact` |
| 迭代整体 drain（native 5:2） | 过近似 | `"5:2"  #exact` |

**回归**：新增 `exec/__tests__/gen-suspend-replay.test.ts`（8 例机制钉：
构造期零捕获 / 首次回放 / 单调推进 / drain / 别名广播 / async 同编 /
嵌套帧隔离 + 终态格 / 无钩子零开销）；`eval-bug-212-generator-body-eager.test.ts` 的 c3/c4
断言重订为精确 native 值并补 2 例推进用例（14 例全绿）；
`eval-generator-cross-function-consume.test.ts` 的步骤 4 todo 升级为
5 例验收（含两类 sound 守卫与 `.return()` 回退，9 例全绿）。

**已知边界（诚实台账）**：这是**外层绑定值面**的挂起点精确化，体仍一次
跑完。宿主调用、may-throw 收集、容器外部引用等非「自由写绑定」类副作用
的时序仍整体落在首次消费点；若后续要全量真挂起，需按 §5.4 订正做
CPS 级改造。求值隔离仍按用户约定搁置。
