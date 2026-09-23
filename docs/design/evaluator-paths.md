# 求值引擎与集合语义（双引擎：ast-eval × B-path）

> **状态**：2026-09-22 会话结论沉淀，全部结论经实测验证（探针输出见文末）。
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

转译产物（B-path）是同一门代数的编译形态：`$add(x, $lit(1))` 是集合映射；
`$gt(x, $lit(0))` 是集合间比较，返回「一定真 / 一定假 / 不定」三值；
`$fork` 处理「不定」时双臂展开 + join。

## 双引擎：同一门代数，两种执行方式

| | ast-eval | B-path |
|---|---|---|
| 形态 | AST 树遍历解释器 | transpile → `new Function` 编译执行 |
| 速度 | 慢（每节点解释税 + 不可变 env 复制 + 预算簿记） | 快（控制流/作用域交给 V8） |
| 语法覆盖 | 全部 | 全部（`runTranspiled` 可 exec 任意程序） |
| 缺席条件 | 无 | `isBPathCapable`：顶层 `this`；注释字面 `this.` 误判；require 源码；依赖指纹 fail-closed |
| 独有产品 | Phi 线程收窄、derivation 节点打点 | 真实执行语义（副作用/别名） |

**两引擎互为差分基准**：loop-fix 系列 18 批 bug 大多出在 B-path 转译/运行时，
靠「两实现对照 + native vm 对照」挖出。这是双实现存在的方法论理由，不是能力理由。

## 传播机制：调用点实参集合重求值 callee body

跨文件类型传播**不是**靠类型 scheme 传递，是逐调用点重求值：

```js
// main.js
import { id } from "./util.js";
const n = id(5);      // 用实参集合 {5} 重跑 id body → {5}
const s = id("hi");   // 用 {"hi"} 重跑 → {"hi"}
```

实现链：`generalizeFromAst` 语法归纳出 symbolic scheme（`(x: A1) => A1`）
→ `PolyFn.instantiate(args, phi)` 用调用点实参 α-替换后重求值 body。
**instantiate 的求值引擎当前是 ast-eval**（generalize.ts `run` → analyzeFn）。

`A1` 是**展示层**的类型参数（签名显示、泛化输出），不是传播必需品。
`any` 是「无约束集合」；两者语义不同：`any` 实例化后仍是 any（毒化下游），
`A1` 实例化后是实参集合（精确）。

## 入口集合的来源

- 侧车（`*.nudo.js`）契约 → `constraintToEntryAbs` → 入口 Abs（shape × pred）。
- 无契约：入口参数 = `any`（无约束集合，**不编造**单点值）。
- 侧车给的是**约束**（集合定义），不是值——所以下游全程在集合语义下执行；
  「调真实的函数」在分析期不可能，因为分析的是运行之前（入口参数还没被传、
  IO 还没发生、分支还没被走）。

## 模块图是 Abs-only

`evalAbsModuleGraph` → `evalProgramAbs`（依赖逐文件抽象执行，收集 Abs 导出），
**没有 B 实现**。B-path 自己的依赖注入先跑它（bpath-run.ts 第一步），
它产出的 `AbsModuleExports` 才是「模块加载」的真实含义：依赖导出抽象函数值，
mock-module/harvest/环 partial 命名空间都在这层协议里。

## check 门禁本体是 ast-eval

`checkSource`（core/check.ts）的执行面：`analyzeFn`（L673 签名重跑）、
`evalProgramAbs`（L712 结构赋值记录 + 调用记录）、`analyzeFnFull`（L933 L2 throws）。
B-hosted 诊断（service/bpath-diagnostics）是并行通道，**门禁判定在 ast-eval**。
本结论修正「ast-eval 只是 fallback」的简化说法：ast-eval 是 check 的主实现，
B-path 是精度更高的加速通道。

> **2026-09-22 收缩契约（refactor/rm-ast-eval 分支）**：L2 throws 已切 B
> （约束入口；any/unknown 入口因 HOF 提升语义保持 ast-eval）。剩余 ast-eval
> 生产面 = generalize/instantiate（phi+HOF）、记录通道（assign/call 记录）、
> derivation 打点、LSP 非 B-hosted hover 兜底、模块图 B 失败回落——均为
> 推导域产品（详见 plans/2026-09-22-remove-ast-eval.md §P4）。

## 实测锚点（2026-09-22 探针）

```
// 直线体 + 入口 x>0
analyzeFn: number  = (x + 1)  where (x + 1) > 1  #path

// 分支体转译产物（无 JS if：条件是 Abs 布尔，$fork 双臂）
return $fork($gt(x, $lit(0)), () => $add(x, $lit(1)), () => $lit(0));

// 泛化 vs 执行喂 unknown
generalize: passthrough → (x: A1) => A1 ；opaque → (x: A1) => unknown
执行喂 unknown：两者都 → unknown（「输出=输入」相关性在执行结果中不可见）
```
