# 求值引擎与集合语义（单引擎）

> **状态**：单引擎终态（2026-09-23 ast-eval 删除后）。历史双引擎对照与移除过程见
> [`plans/2026-09-22-remove-ast-eval.md`](./plans/2026-09-22-remove-ast-eval.md)。
> **真源**：架构 → kernel-merge.md；命令面 → cli-semantics.md；接口推导 → refine-derivation.md。

## 集合语义：Abs 就是值域集合

`Abs = shape × term × pred × conf` 的四个字段是集合的四种记账：

| 字段 | 集合语义 |
|---|---|
| shape | 集合的形状（number/string/tuple/obj/…） |
| term | 集合的身份（lit/var/app——`x`、`x+1`） |
| pred | 集合的边界条件（`x>0`） |
| conf | 是否知道集合的完整内容（exact/path/widened/partial/opaque） |

运算都是集合原算。用户侧 DSL 与 Abs 层一一对应：

```js
x = number().gt(0)      // 集合构造：{v | v > 0}
x.add(1)                // 集合映射：{v+1 | v ∈ x}
gt(x.add(1), 1)         // 集合间关系检查
```

## 单引擎：transpile → `new Function`

生产分析 **只有** evaluator：转译为 `$add` / `$gt` / `$fork` 等代数调用后编译执行。
控制流与作用域交给 V8；代数层仍是同一门 Abs 运算。

| 项 | 行为 |
|---|---|
| 形态 | transpile → `new Function` 编译执行（`runTranspiled` / `callTranspiledExportFull`） |
| 语法覆盖 | 全语法可 exec；`import.meta` → `$importMeta()`（`{url:string}`）；动态 `import()` → `$dynamicImport()`（`Promise<open obj>`）；JSX → `$unknown()`（不整文件 fail-closed） |
| 顶层 `this` | **ESM 语义托管**：读 → `$lit(undefined)`；写（`this.x = 1`）经 strict 写路径硬抛 TypeError（模块装载失败，与原生一致）。见 `eval-topthis.test.ts` |
| JSX | **表达式级** `$unknown()`（诚实无信息），文件其余构造保持 eval-hosted |
| Φ 路径条件 | `$fork` 压 `Φ∧test` 进臂作用域（Φ-native）；boundedPhi 上限 24 |
| 差分 oracle | eval-vs-native 独立 bug 发现器（`core/src/algebra/__tests__/differential/`），不依赖第二求值器 |

预算：`MAX_CALL_DEPTH` / `MAX_TOTAL_CALLS`（20k）/ `MAX_EVAL_TOTAL_FORKS`（默认 5000，可经 `NUDO_MAX_FORKS` / `nudo.analysis.maxForks` 调节）——截断观测见 `call-budget.ts`（调用截断 → `nudo:recursion-truncated`；fork 截断 → `nudo:fork-truncated`）。

## 分析期真实执行面

分析不是全符号沙箱：宿主全局按三层显式名单处置（定义均在
`packages/core/src/algebra/exec/calls.ts`，Math/JSON 折算在 `algebra/builtins/`）。

| 层 | 覆盖面 | 语义 |
|---|---|---|
| **真执行** | `GLOBAL_FNS` 名单（parseInt/Number/URI 族/escape 族…）+ `isHostGlobalFn` 兜底（Bug 20：按 `hostGlobalFnIds` **值身份**识别，覆盖 `const d = decodeURIComponent` 别名）+ Math 原生折叠 + JSON 解码 | host 纯函数真调用：全部实参为字面量 → 转真值执行，宿主异常折进 throws 域（`decodeURIComponent("%")` → URIError 不丢），返回值诚实转 Abs；任一抽象实参 → 不喂宿主（禁反模式：Abs 直接进真 JS 函数），保守 unknown + may TypeError |
| **fail-closed 拦截** | `NEVER_EXEC_HOST_FN_NAMES`（fetch / XMLHttpRequest / WebSocket / EventSource / setTimeout / setInterval / setImmediate / queueMicrotask / requestAnimationFrame / requestIdleCallback） | 不执行——`fetch(unknownAbs)` 会以 `[object Object]` 发真请求、未处理 rejection 崩掉分析进程；命中 → unknown#opaque + `nudo:host-effect-blocked` 上报，`$callNamed` 与 `$new` 共用 |
| **抽象化建模** | `process` / `fs` / `require` 等宿主面 | 经 `@nudojs/env` 的 Abs 声明消费，不触真实 IO；成员写（`process.exitCode = 1`）经 memberPath 写回链（`exec/transpile/member-path.ts`）重绑到 Abs 值——根绑定必须可重绑（`run.ts` env/mock 注入用 let），否则单点成员写毒化整场求值 |

**前向兼容规则**：`isHostGlobalFn` 收集 `globalThis` 全部函数值属性——Node 未来
新增的副作用全局（调度/网络/IO 族）默认会落进真执行兜底。兜底面出现**新名字
必须审计**：进 `NEVER_EXEC_HOST_FN_NAMES` 拦截，或确认纯函数后并入探针基线。
CI 信号 = 漂移探针
[`packages/core/src/algebra/__tests__/host-global-drift.test.ts`](../../packages/core/src/algebra/__tests__/host-global-drift.test.ts)：
裸 node 子进程枚举函数值名字 ↔ 基线 fixture（并集语义，跨 Node 版本只增不减）∪
`NEVER_EXEC_HOST_FN_NAMES` 比对——基线外新名字失败（附处置指引），老 Node
缺名字仅告警（CI Node 22 矩阵必然少于基线生成面 Node 26）。

## 传播机制：调用点实参集合重求值 callee body

跨文件类型传播**不是**靠类型 scheme 传递，是逐调用点重求值：

```js
// main.js
import { id } from "./util.js";
const n = id(5);      // 用实参集合 {5} 重跑 id body → {5}
const s = id("hi");   // 用 {"hi"} 重跑 → {"hi"}
```

实现链：`generalizeFromAst` 语法归纳出 symbolic scheme（`(x: A1) => A1`）
→ `PolyFn.instantiate(args, phi)` 用调用点实参 α-替换后重求值 body（evaluator + 入口 Φ 种子）。

`A1` 是**展示层**的类型参数（签名显示、泛化输出），不是传播必需品。
`any` 是「无约束集合」；两者语义不同：`any` 实例化后仍是 any（毒化下游），
`A1` 实例化后是实参集合（精确）。

## 入口集合的来源

- 侧车（`*.nudo.js`）契约 → `constraintToEntryAbs` → 入口 Abs（shape × pred）。
- 无契约：入口参数 = `any`（无约束集合，**不编造**单点值）。
- 侧车给的是**约束**（集合定义），不是值——所以下游全程在集合语义下执行；
  「调真实的函数」在分析期不可能，因为分析的是运行之前（入口参数还没被传、
  IO 还没发生、分支还没被走）。

## 模块图

`evalAbsModuleGraph` 依赖求值步走 `runTranspiled`（eval 优先）；JS 导出经
`absFunction(apply)` 桥接成 Abs fn。B 失败 → **fail-closed**（空导出），
不再解释回落。mock-module / harvest / 环 partial 命名空间仍在 `AbsModuleExports`
协议层。

## check 门禁本体

`checkSource`（core/check.ts）执行面走 evaluator（`runTranspiled` +
`callTranspiledExportFull`）；记录通道经 `$recordBinding` / `$assignRecord`
运行时插桩。门禁判定 = Pred 蕴含；不可求值 / 求值失败 → fail-closed
（unknown / 空表），触发引擎债诊断而非静默通过。

## 实测锚点（探针）

```
// 直线体 + 入口 x>0
analyzeFn: number  = (x + 1)  where (x + 1) > 1  #path

// 分支体转译产物（无 JS if：条件是 Abs 布尔，$fork 双臂 + Φ）
return $fork($gt(x, $lit(0)), () => $add(x, $lit(1)), () => $lit(0));

// 泛化 vs 执行喂 unknown
generalize: passthrough → (x: A1) => A1 ；opaque → (x: A1) => unknown
执行喂 unknown：两者都 → unknown（「输出=输入」相关性在执行结果中不可见）
```
