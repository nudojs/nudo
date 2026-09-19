# Nudo Examples

单一入口。按场景分组，与实现目录无关。

| 目录 | 场景 |
|------|------|
| [`constraints/`](./constraints/) | `@nudo:refine` × Pred：标量 / shape / 返回精化 |
| [`structure/`](./structure/) | Abs `leq`：赋值 / 传参结构 |
| [`vs-ts/`](./vs-ts/) | 与 TypeScript 同逻辑对照 |
| [`mini-repo/`](./mini-repo/) | 多文件集成（ESM + class + async） |
| [`algebra/`](./algebra/) | 类型即计算（spread / HOF / reduce / mixin） |
| [`interface-derivation/`](./interface-derivation/) | 契约分层推导（手写根 → 下行生成段） |
| [`interface-draft/`](./interface-draft/) | 代码优先：从逻辑生成可审阅契约草稿 |

主题式浏览（同一引擎）见网站 [Examples 指南](https://nudojs.github.io/nudo/docs/guides/examples)；本目录是 CI 门禁真值（`pnpm run verify:examples`）。

## 产品命令面

- **Day 0**：`pnpm run check <file>`（门禁 + 签名）· `pnpm run test:cli <file>`（逐 case 报告）
- **Day 1**：`pnpm run contract` / `pnpm run nudo -- contract` · 继续 `check`
- **Ecosystem**：`pnpm run export:nudo … --format dts|guard|zod`

旧动词 `infer` / `types` / `interface` / `generate` / `emit` / `guard` / `doctor` / `watch` **已 deprecated**（stderr 提示，下一 major 删除）。

## 精化模型

契约不是类型注解，是 **进入 Abs 的 Pred**，会参与代数运算（`x>0` ⇒ `x+1>1`）。

- 精化只来自 **声明**（`.nudo.js` 导出的模板），`if` 分支不是精化
- 唯一形态：`@nudo:refine <param|return> <constraint>`；object 形状用 `shape({...})`，无需 interface / type
- 模板写法、返回精化、与 `@nudo:case` 的对照见 [`constraints/README.md`](./constraints/README.md)（本目录教程）

## 无契约时跟真实 JS

```js
function score(x) { return x + 1; }
// check signatures: score(x: any) => number | string
// score("x") 合法，返回 "x1"；不报 shape 错
```

- **`any`** = 入口无约束参数的默认契约（JS 值并集；开发者负责细化）
- **`unknown`** = 推导失败 / 引擎无信息（Nudo 负责修）

二者不是一回事；CLI **不会**把入口无约束参数打印成 `unknown`。
入口对 `any` 的危险操作可能触发 L2 `nudo:entry-may-throw`（默认 error）。

## 怎么跑

所有示例命令与期望退出码的**唯一真值**在下面这张矩阵；一条命令验证全部：
`pnpm run verify:examples`（CI 门禁，见 `scripts/verify-examples.sh`）。

- **命令与退出码**：只改矩阵——门禁脚本从本表解析命令 × 退出码，新增 /
  删除示例或改期望退出码 = 改这一张表，脚本自动跟随。
- **文件双向校验**：脚本交叉校验矩阵 ↔ 磁盘——每行命令的目标文件必须存在
  （负例行路径打错会以 exit 1 静默通过，此校验拦住）；`docs/examples` 下每个
  可运行的 `.js` / `.ts` 文件必须出现在至少一行矩阵（`*.nudo.js` 模板除外，
  它们经 `@nudo:import` 引入；`*.d.ts` 是 `export --format dts` 生成的声明产物，同样除外）。
  目标文件取命令里 `docs/examples/` 之后的
  第一个空白分隔 token，CLI 选项（如 `--assume "x>0"`）跟在它后面。
  新增示例文件 = 加一行矩阵，否则 CI 红。
- **输出承诺**：示例文件头注释与子目录 README 声称的输出行由脚本逐条钉住
  （固定串匹配，脚本 pins 段——命令 stdout 用 `pin`；`export --format dts`
  默认打印声明到 stdout，`--out <dir>` 时才写文件，可用 `pin_file`）。
  引擎精度变化导致输出漂移时 CI 会红——
  需同步更新示例文件注释/README 与脚本 pins。

每个子目录 README 与示例文件头注释里的单行命令只是就近提示。

| 命令 | 退出码 | 说明 |
|------|--------|------|
| `pnpm run check docs/examples/constraints/set-delay.js` | **1** | 负例：`setDelay[ms]: 实参 ⊭ 前置` / `needsPositive[x]: 实参 ⊭ 前置` |
| `pnpm run check docs/examples/constraints/register.js` | **0** | 正例：user / config 形状精化（signatures 钉住） |
| `pnpm run check docs/examples/constraints/return-contract.js` | **1** | 负例：`bad: 返回值 ⊭ @nudo:refine return positive` |
| `pnpm run check docs/examples/constraints/declared-vs-if.js` | **1** | 负例：if ≠ 精化 |
| `pnpm run check docs/examples/constraints/add-pred.js` | **1** | 负例：`scale[x]: 实参 ⊭ 前置`（`actual: -1 #exact`） |
| `pnpm run test:cli docs/examples/constraints/add-pred.js` | **0** | Pred 流入代数（test case 报告正例） |
| `pnpm run check docs/examples/structure/assign.js` | **1** | 负例：`config: 赋值 ⊭ 原有形状`（缺 port） |
| `pnpm run check docs/examples/structure/arg-structure.js` | **1** | 负例：shape 契约缺字段（`constraint-violated`，非 body 扫描） |
| `pnpm run check docs/examples/vs-ts/constraints/nudo.js` | **1** | nudo 报，对照 tsc 不报 |
| `pnpm exec tsc --noEmit --strict docs/examples/vs-ts/constraints/tsc.ts` | **0** | tsc 侧对照（不报） |
| `pnpm run check docs/examples/vs-ts/structure/nudo.js` | **1** | nudo 报（契约缺 name / 赋值缺 port） |
| `pnpm exec tsc --noEmit --strict docs/examples/vs-ts/structure/tsc.ts` | **2** | tsc 报 3 处（缺 name / excess / 缺 port） |
| `pnpm run check docs/examples/algebra/0-add-intensional.js` | **0** | 签名（check；`--verbose`/`--abs` 才展开 term/pred/conf） |
| `pnpm run test:cli docs/examples/algebra/0-add-intensional.js` | **0** | 字面量 case（`call@` / `debug`） |
| `pnpm run check docs/examples/algebra/0-add-intensional.js --abs --assume "x>0"` | **0** | 代数视图（term/pred/conf，`--assume`） |
| `pnpm run test:cli docs/examples/algebra/a-spread-optional.js` | **0** | spread 配置对象 |
| `pnpm run export:nudo docs/examples/algebra/a-spread-optional.js --format dts` | **0** | dts 投影：单一拓宽签名 + 字面量并返回（stdout 钉住签名） |
| `pnpm run test:cli docs/examples/algebra/b-hof-map.js` | **0** | HOF 回调传播 |
| `pnpm run test:cli docs/examples/algebra/c-reduce-sum.js` | **0** | reduce 单 pass 累加 |
| `pnpm run test:cli docs/examples/algebra/d-mixin-meet.js` | **0** | spread 形状 meet |
| `pnpm run test:cli docs/examples/algebra/e-index-proj.js` | **0** | 索引投影（字面量精确 / 动态 key 并集） |
| `pnpm run test:cli docs/examples/algebra/f-async-eff.js` | **0** | async × `@nudo:mock` |
| `pnpm run test:cli docs/examples/algebra/g-narrow-subtract.js` | **0** | 守卫窄化 |
| `pnpm run test:cli docs/examples/algebra/h-array-boundary.js` | **0** | 数组方法精度边界（reduce / forEach / some 均精确） |
| `pnpm run test:cli docs/examples/algebra/i-map-set.js` | **0** | Map / Set 字面量条目追踪（get 回查 / for-of 元素） |
| `pnpm run test:cli docs/examples/algebra/j-this-binding.js` | **0** | this 绑定：成员调用 receiver 注入精确（`compute(5)` → `25`） |
| `pnpm run test:cli docs/examples/algebra/k-try-catch.js` | **0** | try/catch：确定性 return 折叠 / catch 形参绑定 Error.message |
| `pnpm run test:cli docs/examples/algebra/l-primitive-conversion.js` | **0** | 原始值包装构造（String / Number / Boolean / parseInt / parseFloat 字面量折叠） |
| `pnpm run test:cli docs/examples/algebra/sample.js` | **0** | 无调用点 → `entry@`；参数显示 **`any`** |
| `pnpm run check docs/examples/mini-repo/user-service.js` | **0** | 多文件集成（check） |
| `pnpm run test:cli docs/examples/mini-repo/user-service.js` | **0** | 多文件集成（test case 报告） |
| `pnpm run check docs/examples/mini-repo/validators.js` | **0** | 支持文件 signatures：入口无约束参数 = any |
| `pnpm run test:cli docs/examples/mini-repo/validators.js` | **0** | 支持文件独立 test：entry@ 签名（any） |
| `pnpm run test:cli docs/examples/mini-repo/store.js` | **0** | class 方法经 analyzer 枚举：无调用点 → `entry@` |
| `pnpm run check docs/examples/interface-derivation/lib.js` | **0** | 根契约（lib.nudo.js 手写 add4）加载 |
| `pnpm run check docs/examples/interface-derivation/add.js` | **0** | 下行推导契约（add.nudo.js generated）执法 |
| `pnpm run contract --draft docs/examples/interface-draft/greet.js` | **0** | 代码优先草稿：callsite 投影 + body-read 建议（不发明 check 义务） |
| `pnpm run check docs/examples/l2-export-any.js` | **1** | L2：export any 成员访问 → `nudo:entry-may-throw` |
| `pnpm run check docs/examples/l2-export-any.js --ignore-throws TypeError` | **0** | L2 迁移开关：ignore TypeError 后不挡 exit |

> 负例文件（constraints / structure / vs-ts 的 check）**故意 exit 非 0**——报错行就是它们演示的内容。
