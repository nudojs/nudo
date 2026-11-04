---
slug: /guides/directive-cheatsheet
description: "每条 @nudo: 指令的一行语法与语义 —— case、contract、mock、env、import、assume、invariant、budget、pure、skip、sample、as、replace、mock-module —— 附约束构建器速查。"
---

# 指令速查单

每条指令一行：语法、语义、详情页链接。权威参考是[指令](../concepts/directives.md)——本页是速查卡，不是替代品。

**摆放规则一句话：** 函数级指令写在紧贴函数上方的块注释里（`@nudo:case` / `@nudo:mock` / `@nudo:pure` / `@nudo:skip` / `@nudo:sample` 也接受单行 `//` 形态）；文件级指令用三斜杠 `///` 写在文件顶部；`@nudo:as` 与 `@nudo:replace` 是改写目标语句上方的行注释。

## 常用五条

| 指令 | 语法 | 一行语义 | 详情 |
|---|---|---|---|
| `@nudo:case` | `@nudo:case "name" (args)` · `@nudo:case "name" (args) => expected` | 调试见证：`nudo test` 以这些输入执行函数（`=> expected` 断言结果）；也驱动 LSP 场景切换。**不是**契约产品。 | [@nudo:case](../concepts/directives.md#nudocase--debug-witnesses) · [nudo test](./test.md) |
| `@nudo:contract` | `@nudo:contract x positive` · `@nudo:contract return positive` | 源内精化契约，约束参数或返回值；约束作为 Pred 进入 Abs 并参与代数。主路径是 `*.nudo.js` 侧车。 | [@nudo:contract](../concepts/directives.md#nudocontract--source-contract) · [nudo contract](./contract.md) |
| `@nudo:mock` | `@nudo:mock fetch = (url) => ({ … })` · `@nudo:mock name from "./mock.js"` | 求值期间用 mock 替换外部依赖（`fetch`、`fs`……）——五种形态，表达式必须单行。 | [Mock 外部依赖](../concepts/mocking.md) |
| `@nudo:env` | `/// @nudo:env web` | 文件级：启用内置运行时 API 类型 —— `es` / `web` / `node`（`web`、`node` 含 `es`），或自定义 `./nudo-env.ts`（导出 `defineEnv()`）。 | [@nudo:env](../concepts/directives.md#nudoenv--runtime-environment) |
| `@nudo:import` | `/// @nudo:import { positive } from "./shapes.nudo.js"` | 文件级：从 `*.nudo.js` 模块引入约束模板，供 `@nudo:contract` 使用（命名或 `* as ns`）。 | [@nudo:import](../concepts/directives.md#nudoimport--constraint-templates) |

## 高级指令

| 指令 | 语法 | 一行语义 | 详情 |
|---|---|---|---|
| `@nudo:assume` | `@nudo:assume d <= max`（`<=` 或 `>=`） | 跨变量引理：区间传播推不出的两个参数/顶层局部之间的关系；公理，引擎不验证 —— 依赖它的证明标记 `nudo:assume-relied`。 | [@nudo:assume](../concepts/directives.md#nudoassume--user-lemmas) |
| `@nudo:invariant` | `@nudo:invariant dp[*][*] >= 0` | 循环携带界：参数/顶层局部上的界（`[*]`、`.field` 路径下钻；`>= <= > <` 加数字常量）；公理 —— 标记 `nudo:invariant-relied`。 | [@nudo:invariant](../concepts/directives.md#nudoinvariant--loop-invariants) |
| `@nudo:budget` | `@nudo:budget calls=50000 depth=128`（还有 `forks=…`） | 抬高该函数的求值预算（默认：calls 20,000 · depth 64 · forks 5,000）；只抬不降 —— 抬不动调用**环**与循环截断。 | [预算](./performance.md) |
| `@nudo:pure` | `@nudo:pure` | 标记函数无副作用：求值器按实参 Abs 记忆化调用结果。 | [@nudo:pure](../concepts/directives.md#nudopure--mark-pure-functions) |
| `@nudo:skip` | `@nudo:skip` · `@nudo:skip => number()` | 跳过函数体求值：声明的类型（或 `any`）作为返回；参数契约仍然门禁调用点。 | [@nudo:skip](../concepts/directives.md#nudoskip--skip-evaluation) |
| `@nudo:sample` | `@nudo:sample N` | 保留的无效果指令：仅为兼容性解析，无消费者 —— 循环已由有界展开约束。 | [@nudo:sample](../concepts/directives.md#nudosample--loop-sampling-reserved-no-op) |
| `@nudo:as` | `// @nudo:as shape({ port: number() })` | 覆盖下一条语句的值类型（变量初始化器 / 返回值）。 | [@nudo:as](../concepts/directives.md#nudoas--type-assertion) |
| `@nudo:replace` | `// @nudo:replace res.data array(number())` | 替换下一条语句内某个子表达式的类型；可多行叠加。 | [@nudo:replace](../concepts/directives.md#nudoreplace--sub-expression-type-replacement) |
| `@nudo:mock-module` | `/// @nudo:mock-module "axios" from "./mocks/axios.js"` | 文件级：用 mock 文件替换被引入的模块 —— 说明符后加 `{ get }` 只 mock 这些导出。 | [@nudo:mock-module](../concepts/directives.md#nudomock-module--module-level-mock) |

还有一条真实指令：`@nudo:throws Error, TypeError`（或 `*`）申报有意抛错、按种类解除 L2 —— 见[指令参考](../concepts/directives.md#nudothrows--declare-intentional-throws)。

## 约束构建器

`@nudo:case` 实参、`@nudo:skip` / `@nudo:as` 载荷与 `*.nudo.js` 侧车共用的类型表达式文法：

| 构建器 | 含义 |
|---|---|
| `number()` `string()` `boolean()` `any()` | 基本类型域（`any()` = 无约束） |
| `lit(v)` | 字面量域 —— `lit(42)`、`lit("ada")`、`lit(true)` |
| `union(…)` / `nullable(c)` | 域的并 / `c` 加 `null` 与 `undefined` |
| `shape({ … })` | 对象形状，字段递归 |
| `array(c)` | 数组元素约束 |
| `fn({ x: … }, returns, { throws })` | 函数关系（参数、返回、throws 选项） |
| `and(…)` `partial(c)` `pick(c, keys)` `omit(c, keys)` `lazy(() => c)` | 组合子（`lazy` 仅侧车） |
| `.gt` `.ge` `.lt` `.le` `.int` `.min` `.max` `.length` `.shift` `.optional` | 链式约束 —— `number().gt(0).int()`、`string().min(1)` |

完整表格：[@nudo:contract 下的构建器](../concepts/directives.md#nudocontract--source-contract) · [Abs 中的类型表达式](../concepts/abs.md#type-expressions-in-directives)。

## 下一步

- [指令](../concepts/directives.md) —— 完整参考
- [Mock 外部依赖](../concepts/mocking.md) · [nudo contract](./contract.md) · [性能与预算](./performance.md)
