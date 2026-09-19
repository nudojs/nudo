# design-cli-semantics — CLI 产品命令面与 any/unknown/入口 throws 语义

> Status: **landed** — product CLI verbs, L2 entry-may-throw, any≠unknown display, test case reports, check JSON.
> Primary verbs: `check` / `test` / `contract` / `export` / `health` / `env harvest`.
> Product flags: `--from`, `test --freeze`, `export --format dts|guard|schema|standard|all` + `--dialect zod` + `export --out`.
> Abs 架构真源：[`design-kernel-merge.md`](./design-kernel-merge.md)。
> 限制与路线图：[`design-limitations.md`](./design-limitations.md)。

本文是**产品语义与 CLI 命令面**的唯一设计源。

引擎代数层（`abs.ts` 对 `any`/`unknown` 的定义、控制流窄化）与本文一致。

---

## 0. 设计原则

1. **一个动词只干一件事**；同一产物只有一条命令路径。模式（如 `--watch`）不做一级动词。
2. **命令名 = 用户任务**，不用引擎内部词作一级产品名。
3. **默认路径必须诚实**：无显式契约 ≠ 无契约；退化契约为 JS 运行时边界语义。
4. **要观察，不要观察命令**：签名/调用点事实/throws 是 `check`、`test`、IDE 的输出。观察与执法分离：stdout 上 `test --json` 只承载 cases；门禁与签名用 `check --json`。
5. **门禁只出现在带门禁语义的命令上**（exit 1）。
6. **Debug 能力可以存在，不得占据一级 help**。
7. **`any` 与 `unknown` 在产品语义上永不混用**（见 §2）。
8. TS 用户心智对齐：CI 门禁对齐 `tsc --noEmit` ↔ `nudo check`。与 tsc 的差别：check **成功时仍打印 signatures**（不能静默），这是终端面上的「观察」。

---

## 1. CLI 命令面（当前）

```text
nudo — JavaScript types, computed

  nudo check <path> [--watch|-w]   # 门禁 + 签名表（Day 0/CI 唯一终端入口）
  nudo test <path> [--watch|-w]    # 逐 case 调用点真值 + 可选断言（debug）
  nudo contract <path>             # 契约：打印 / draft / emit 侧车接口
  nudo export <path>               # 投影：dts | guard | schema | standard | all
  nudo health [paths] [--watch]    # 体检：分析错误 + 固化漂移
  nudo env harvest <pkg>           # 环境：@types → env 模块
```

`watch` 是模式不是任务：对应 `tsc --watch`。仅挂在有持续重跑意义的子命令上（`check` / `test`，`health` 可选）；**不**挂在 `export`（出货一次性投影）与 `contract --emit`（写盘）。

### 1.1 观察落在哪里（能力，不是一级命令）

| 想知道什么 | 跑什么 |
|------------|--------|
| 入口签名 / any / unknown / throws | `nudo check <path>`（默认打印 signatures） |
| 逐调用点真值 / 窄化结果 | `nudo test <path>`（打印全部 case，含合成 `call@`/`entry@`） |
| 使用处实参形态 | `nudo test/check/contract --from <paths…>` |
| 代数面 term/pred/conf | `nudo check --abs`（或 `test --abs`） |
| 机器可读 | `nudo check --json` / `nudo test --json` |
| 交互 | IDE hover / inlay |

#### `check` 默认输出（成功也要打印，不可静默）

```text
signatures
  getName(user: any) => any  throws TypeError
  subtract(a: any, b: any) => any
issues
  [error] getName: entry may throw TypeError  (nudo:entry-may-throw)
```

- 入口无约束参数显示 **`any`**，不得显示 `unknown`。
- 推导失败显示 **`unknown`** + conf 标注，并触发引擎债相关诊断。
- throws 域必须上屏。

#### `test` 默认输出（观察 = case 报告）

```text
=== getName ===
  entry@L1  (any) => any   throws TypeError
  call@L42  ({ name: "Ada" }) => "Ada"
  debug "empty"  ({}) => undefined
assertions
  ✓ 2 passed · 0 failed · 1 unchecked
```

- 合成 `call@`/`entry@` **默认打印**（这就是调用点观察）。
- 仅 `@nudo:case` 且带 `=> expected` 的进入 pass/fail；失败才影响 exit。
- `--freeze[=update]`：见证固化，挂在 `test` 名下。

### 1.2 当前命令面要点

| 命令 | 产品职责 |
|------|----------|
| `nudo check` | Day 0 / CI 门禁；默认打印 signatures + L2 entry may-throw |
| `nudo test` | case 报告 + 声明断言；`--from` 注入使用处；`--freeze` 固化见证 |
| `nudo contract` | 打印 / `--draft` / `--emit` 侧车接口；`--from` 供域证据 |
| `nudo export` | 一次性投影：`dts` / `guard` / `schema`（`--dialect zod`）/ `standard` / `all`；`--out` 写出目录 |
| `nudo health` | 分析错误 + 固化漂移；`--watch` 可选 |
| `nudo env harvest` | `@types` → env 模块 |

### 1.3 exit code 契约

| 命令 | exit 1 |
|------|--------|
| `export` / `contract`（只读） | 仅用法 / IO 错误 |
| `check`（含 `--abs` / `--json`） | 任一 error 级诊断（L1 或未 ignore 的 L2）；`--abs` 是观察面，**不是**关 CI 的旁路 |
| `test`（含 `--json` / `--abs`） | 任一**声明断言**失败（合成 case / entry@ 不挡 exit） |
| `health` | drift 或 analysis error |
| `contract --emit --exit-on-diff` | 将写盘且有 diff（须同时 `--dry-run`；无 dry-run 时为 usage error） |

CI 门禁只认 `check`（及 `test` 的声明断言、`health` 的 drift）。

### 1.4 check 旗标

| 旗标 | 作用 |
|------|------|
| `--watch` / `-w` | 持续重跑（模式旗标，不是一级动词） |
| `--json` | CheckJson v1（单文件） |
| `--verbose` | 展开 Abs 签名（term/pred/conf） |
| `--abs` | 代数 term/pred/conf 观察 + L1/L2 门禁 |
| `--fn` / `--assume` / `--generalize` | 与 `--abs` 配合的观察过滤 |
| `--from <paths…>` | 使用处调用记录 |
| `--ignore-throws <names>` | L2：忽略这些入口 may-throw 类型名（`TypeError,RangeError`） |
| `--entry-throws <mode>` | L2：`error` \| `warning` \| `off`（默认 `error`） |

`--ignore-throws` / `package.json#nudo.check.ignoreThrows` **只**作用于 L2 入口 throws，**不**吞 L1 契约违例。

```jsonc
// package.json
"nudo": { "check": { "ignoreThrows": ["TypeError"], "entryThrows": "error" } }
```

---

## 2. `any` vs `unknown`

与 `packages/core/src/algebra/abs.ts` 现有注释一致，并提升为**产品契约**：

| | `any` | `unknown` |
|---|-------|-----------|
| 含义 | 无约束：JS 值的并集；**开发者**负责细化 | **推导失败 / 引擎无信息**；**Nudo** 负责修 |
| 来源 | 未标注入口参数、显式 `any()`、refine 解析失败回退 | 求值失败、native 未建模、截断、泄漏、opaque |
| 运算 | 按真实 JS 语义取并集；不是「分析失败」 | 不得假装成合法契约；应触发引擎债诊断 |
| 窄化 | 条件语句可窄化（`typeof` / `===` / `Array.isArray` / `switch` / 真值 / 判别字段）——**已实现**，见 `guides/control-flow-narrowing.md` | **不能**被用户条件「合法化」；先修推导或补 env/mock/refine |
| 展示 | `any`、可带 type-var（`A1`） | `unknown` + conf 标注 |
| 产品话术 | 「未写契约 ⇒ 默认约束为 any + JS 运行时效果」 | 「Nudo 遇到无法处理的场景」 |

**禁止：**

- 文档/CLI 把入口无约束参数打印或叙述为 `unknown`。
- 把 `unknown` 与 `any` 在表格里并成同一格（如 `unknown`/`any` = 全集）。
- 在 check 中对 `unknown`（失败）静默通过而不报引擎债相关诊断。

**允许（代数层已如此）：**

- `leq`：任意 ≤ `any`；`any` ≤ 任意（由 pred/slot 再卡）。
- generalize 入口参数使用 `abs({ k: "any" }, var, pTrue, "path")`。

---

## 3. 义务分层与入口 throws

### 3.1 两层义务

| 层 | 来源 | check 行为 |
|----|------|------------|
| **L1 显式契约** | `*.nudo.js` / `@nudo:refine`；调用点证据可作 domain | 违例 → **error** |
| **L2 默认 JS 契约** | 未显式收窄时的运行时语义；对**入口/导出**函数 | 未消化的 may-throw → **error**（可用 ignore 过滤） |

「无显式契约」的正确叙述：

> 契约退化为 JS 运行时边界：入口参数为 `any`，对 `any`/可空值的操作可能抛；导出函数不得静默携带未声明、未捕获的 throws。

### 3.2 入口（entry）定义

L2 **只执法入口函数**，不对每个内部 helper 无差别报 may-throw。

入口 = 模块边界上对消费者可见的函数，至少包括：

- `export` / `export default` 声明或赋值
- CJS `exports.x =` / `module.exports` 上的函数
- （可选后续）package `exports` 公开路径上的再导出

内部函数：允许 throw；observe 可见；check 默认不因内部 may-throw 失败。

### 3.3 throws 建模要求

| 接收者 | 成员读 / 危险操作 | Abs / throws |
|--------|-------------------|--------------|
| `any`（无约束） | `user.name` 等 | 结果保持信息可得部分；**记录 may-throw**（常为 `TypeError`） |
| `null` / `undefined` 成员 | `x.prop` | **throws `TypeError`** |
| 对象缺槽 | `obj.missing` | 返回 `undefined`（或 optional），**不**一律 throws |
| 条件 throw 且条件不可判定 | `if (c) throw …` | case 带 may-throw |
| try-catch 消化 | | throws 从出口效果中移除；**catch rethrow 则不消化**（soft/hard 均上浮） |
| 无 handler 的 try | | soft may-throw 上浮至 L2 |
| 显式 refine 将参数收成 shape | | 操作落在已约束形状上；L2 消失或降为 L1 |

**L2 失败示意（`getName`）：**

```js
export function getName(user) {
  return user.name;
}
```

```text
[error] getName (export): may throw TypeError
  cause:    property 'name' on any (unconstrained param `user`)
  actual:   (user: any) => any    throws TypeError
  expected: entry total, or declare/catch throws
  → refine user / guard / try-catch / --ignore-throws TypeError
```

### 3.4 与 Node 类比

未捕获异常使 Node 进程以非零码退出；同样，**导出边界**上的未声明/未捕获 throws 使 `nudo check` 失败。内部调用栈中的 throw 是实现细节，由调用方或 L1 契约处理。

---

## 4. 窄化与 `any` 的开发者路径

开发者将 `any` 收窄的方式（产品主路径）：

1. **代码内条件**（零注解）：`typeof` / `===` / `Array.isArray` / `switch` / 真值 / 判别字段 —— 求值器已支持（具体调用点精确；符号 `any` 可能 join，属精度债，记入 unknown 类引擎问题）。
2. **显式契约**（Day 1）：`@nudo:refine` / `*.nudo.js` 把入口 `any` 收成 shape/pred。
3. **env / mock**：补外部 API，消除因未建模产生的 `unknown`。

`contract` / `--draft` / `--emit` 是路径 2 的命令面。

---

## 5. check 执法面（报告 / 码 / 金标）

> 类型即计算：检查的是 Abs 上的 Pred 蕴含，不是 TS 式「类型是否匹配」。
> 精化进入 Abs 并参与代数；dts 只是 TS 生态兼容侧信道。

### 5.1 check 做什么

1. 每个顶层函数归纳**符号 Abs**（shape × term × pred × conf）
2. **L1**：扫描调用点 / 返回值，检查是否满足 `@nudo:refine` / 侧车声明
3. **L2**：入口（export / CJS 导出）函数上未消化的 may-throw → 默认 **error**
4. 输出 **Nudo 原生报告**：`signatures`（成功也打印）+ `actual ⊭ expected`

```bash
pnpm run check path/to/file.js
# 或
pnpm run nudo -- check path/to/file.js
```

退出码：有 `error` → `1`（CI 可直接当门禁）。

### 5.2 诊断码

| code | 含义 |
|---|---|
| `nudo:constraint-violated` | 调用/返回 ⊭ refine（标量界 / **shape 字段**） |
| `nudo:assign-mismatch` | 赋值 ⊭ 原有形状（leqAbs） |
| `nudo:arg-structure` | HOF：实参不是可调用 fn / arity 不匹配（**不**表示 body 缺 slot） |
| `nudo:case-inconsistency` | **`@nudo:case` 见证 ⊭ refine** |
| `nudo:interface-param-mismatch` | 手写契约参数名不在形参表面（默认参名/rest 裸名/解构绑定名合法） |
| `nudo:interface-conflict` | 手写契约合取不可满足（常数界交叉等） |
| `nudo:interface-name-clash` | 侧车导出名与源码导出冲突 |
| `nudo:interface-underivable` | 手写契约无法从源码推导（underivable） |
| `nudo:interface-load` / `nudo:interface-cycle` | 侧车加载失败 / 侧车环 |
| `nudo:interface-domain-exceeds` | 跨文件调用证据 ⊄ 手写契约 |
| `nudo:interface-drift` | `@generated` 段 ≠ 今日重算（warning，不挡 exit） |
| `nudo:no-signature` | 无法归纳符号 Abs |
| `nudo:opaque-result` / `nudo:eval-error` | 求值不透明 / 求值抛错 |
| `nudo:recursion-truncated` | 递归预算截断（结果 widen） |
| **`nudo:entry-may-throw`** | **L2：入口未消化 may-throw（默认 error）** |
| `nudo:may-throw` / `nudo:unreachable` | 路径可能抛出（case 线索 / warning）/ 不可达代码 |
| `nudo:unknown-inference` | 引擎债：出口或签名出现真 `unknown` |
| `nudo:unknown-recv` | 引擎债：unknown 接收者成员访问；**不得**替代 L2 throws 建模 |
| `nudo:missing-slot` | C0.5 可选：求值命中已知对象缺字段（默认 off，见 limitations） |

**L2 入口 throws 是独立、默认 error、可 ignore 的码**，不得与「内部 may-throw warning」共用一个永不挡 CI 的码。

### 5.3 报告示意

```
nudo check  src/validators.js
FAILED
  1 error · 0 warning · 0 info · 1 fn

signatures
  needsPositive(x: number) => number

issues
  [ERROR L12 needsPositive] needsPositive[x]: 实参 ⊭ 前置  (nudo:constraint-violated)
      actual:   -1  #exact
      expected: x > 0
      → 改用满足 x > 0 的值，或放宽 x 的前置
```

- **signatures**：默认一行摘要且**成功也打印**；`--verbose` 展开 `term:` / `pred:` / `conf:`；代数面用 `check --abs`
- **actual / expected**：违例是蕴含失败，不是 assignability
- **throws 域**上屏；入口无约束参数显示 **`any`**

### 5.4 调用点扫描形态（能看见什么）

| 形态 | 例 |
|---|---|
| 直接调用 | `needsPositive(-1)` |
| 别名 | `const f = needsPositive; f(-1)` |
| 对象属性 | `const api = { needsPositive }; api.needsPositive(-1)` |
| 重命名属性 | `{ check: fn }; api.check(-1)` |
| 无条件转发 | `function w(a){ return target(a); }` → `w(lit)` |
| CJS require | 解构 / `m.fn` / `require().fn` |
| ESM import | 具名 / `as` 别名 / `* as ns` |
| 动态 import | `const { fn } = await import('./m')` |
| barrel 一跳 | `export { fn } from './v.js'` 跟到定义 |

### 5.5 什么是精化，什么不是

精化 **只来自声明**，唯一形态 `@nudo:refine <param> <constraint>`；  
返回精化用 `@nudo:refine return <constraint>`。

不用 JSDoc `@param`/`@return`：那是类型注解。  
不叫 requires：那只是「校验挡板」；refine 表示 Pred 进入 Abs，参与代数（x>0 ⇒ x+1>1）。

约束模板在 `*.nudo.js`（constraint builders）：

```js
export const delay = number().gt(0);
export const percent = number().ge(0).le(100);
export const user = shape({ id: number().gt(0), name: string() });
```

```js
/// @nudo:import { delay, user } from "./shapes.nudo.js"

/**
 * @nudo:refine ms delay
 */
function setDelay(ms) {
  if (ms > 0) return ms;
  return 0;
}
setDelay(0);        // error: 0 ⊭ delay
setDelay(100);      // ok

/**
 * @nudo:refine u user
 */
function register(u) {
  return `${u.id}:${u.name}`;
}
register({ id: -1, name: "a" }); // error: u.id ⊭ > 0
register({ id: 1 });             // error: missing u.name
```

- L2 入口 throws **不是** shape 必填义务，而是运行时效果门禁；与 C0（不从 body 发明 slot）正交。
- 示例目录：`docs/examples/constraints/`

### 5.6 金标与精度（CI）

| 门禁 | 文件 | 要求 |
|---|---|---|
| **人工 recall** | `check-recall-gold.test.ts` | recall = precision = **1.0**（45 条人工标注 + 11 条 require/ESM 跨文件） |
| **shape 精化** | `check-shape-gold.test.ts` | 字段 / 可选 / 边界 |
| **case ⊆ refine** | `check-case-consistency.test.ts` | 见证 ⊆ 定义域 |
| **真实包精度** | `check-real-commander.test.ts` / `check-real-packages.test.ts` | 10 个真实包上**零** error 级误报（`constraint-violated` / `assign-mismatch` / `arg-structure`） |

L2 开启后，any-param / 入口 may-throw 相关金标需按 L2 off/on **分套件**；zero-FP 基线以 L2 off 叙述为准。

```bash
npx tsx scripts/scan-real-packages.ts commander
# → docs/check-real-packages.md
```

### 5.7 与 tsc 的关系

| | `tsc --noEmit` | `nudo check` |
|---|---|---|
| 赋值/结构 | 完备（显式注解下） | 部分：推断 Abs 上的 leq（`nudo:assign-mismatch`）+ 显式 shape 契约；HOF `arg-structure` 仅回调形态；宽度子类型无 excess 检查 |
| 约束（`x>0`）+ 字面量调用 | 做不到 | **做** |
| 入口 `any.prop` | 通常不报 | 进入 **throws 域**；L2 可 error |
| 报告形态 | TS 诊断 | Abs / actual ⊭ expected；成功仍打印 signatures |
| 零注解 JS | 需 checkJs | 默认 |

**建议**：TS 大仓继续 tsc；纯 JS / 渐进迁移 / Agent 流水线用 `nudo check` 作约束门禁。dts 经 `nudo export` 生成，用于生态兼容。

---

## 6. 机器可读契约（v1）

### 6.1 `check --json`（CheckJson）

```jsonc
{
  "version": 1,
  "file": "…",
  "ok": false,
  "summary": { "errors": 1, "warnings": 0, "infos": 0, "functions": 1 },
  "signatures": [
    { "name": "needsPositive", "params": ["x"], "display": "…",
      "detail": "…", "conf": "path", "abs": "number  = x  where x > 0  #path" }
  ],
  "issues": [
    { "severity": "error", "code": "nudo:constraint-violated",
      "message": "…", "fn": "needsPositive", "line": 6,
      "actual": "-1  #exact", "expected": "x > 0", "suggestion": "…" }
  ]
}
```

- `version: 1` — 字段只增不改语义  
- `ok` — 有 error 则 false；CLI 退出码对齐  
- Abs 以 **formatAbs 字符串**给出，不序列化内部 shape 图  
- 契约测试：`check-json.test.ts`；实现：`packages/core/src/algebra/check-report.ts`

### 6.2 `test --json`（CaseJson）

```jsonc
{
  "version": 1,
  "file": "…",
  "summary": { "functions": 1, "externalFunctions": 0, "cases": 1, "diagnostics": 0 },
  "functions": [{
    "name": "scale",
    "loc": { "start": {…}, "end": {…} },
    "entryOnly": true,
    "cases": [{
      "name": "entry@L1",
      "args": ["any"],
      "result": "number | string",
      "throws": null,
      "source": null,
      "intension": {
        "display": "scale: (x: A1) => number | string = (A1 + 1)",
        "abs": "number | string  #partial",
        "absMultiline": "…",
        "term": "(A1 + 1)",
        "conf": "partial"
      }
    }]
  }],
  "diagnostics": []
}
```

- `version: 1` — 字段只增不改语义  
- **ext**：`args` / `result` 为 `formatShape(Abs)` 字符串（有损兼容）；入口无约束参数序列化为 **`any`**  
- **intension**：无损 Abs（`abs` / `term` / `pred` / `conf`）  
- 实现：`packages/service/src/case-json.ts`（`serializeCaseJson`）；契约测试：`case-json.test.ts`

### 6.3 Agent / LSP 通道

| 通道 | 入口 |
|---|---|
| CLI | `nudo check file.js --json` / `nudo test file.js --json` |
| LSP executeCommand | `nudo.check` / `nudo.test` / `nudo.hover` / `nudo.contract*` |
| LSP custom request | `nudo/check` / `nudo/test` / `nudo/hover` / `nudo/contract*` |

`format: "json"` 只返回 CheckJson / CaseJson；缺省为人类摘要 + JSON。  
`nudo.hover` 返回无损 Abs。服务层 `nudo.test` 与 CLI **`test --json`** 同构。

---

## 7. 分析范围与噪声档（IDE / watch）

> 配置入口：`package.json#nudo`（不引入 `nudo.json`）。
> 与 `nudo.contract.autoBind` / `nudo.contract.emit` 同源。实现：`service/evaluator/config.ts` + `analysis-scope.ts`。

```jsonc
{
  "nudo": {
    "contract": { "autoBind": true, "emit": [] },
    "check": { "ignoreThrows": [], "entryThrows": "error" },
    "analysis": {
      "include": [],
      "exclude": ["**/node_modules/**", "**/dist/**", "**/coverage/**"],
      // "directives" | "exports" | "all"  — 出厂默认 exports
      "mode": "exports",
      // "off" | "errors" | "default" | "verbose"
      "diagnostics": "default",
      // C0.5 可选：求值命中缺槽 warning（默认 off）
      "evalMissingSlot": "off",
      "callSiteBudget": 3
    }
  }
}
```

| 键 | 管什么 | 不管什么 |
|---|---|---|
| `nudo.contract.autoBind` | 侧车 ambient 执行 | 是否分析该文件 |
| `nudo.contract.emit` | emit 写盘白名单 | 分析范围 |
| `nudo.analysis.*` | **是否分析 + 诊断噪声 + C0.5** | 契约语义 |
| `nudo.check.*` | L2 门禁过滤 | 分析范围 |

| 入口 | include/exclude | mode |
|---|---|---|
| CLI `nudo check/test <path>` | 忽略（点名路径） | **忽略**（用户点名即意图） |
| LSP / vite-plugin validate | 应用 | 应用；默认 `mode=exports` |
| watch 扫描 | 应用 | 不应用 mode（与 CLI 目标扫描同规则） |

出厂默认 `mode=exports`：含 `export` / 侧车 / `@nudo:` 的文件进 IDE 分析；无 export、无侧车的脚本需显式 `mode=all`。1.x 默认切换属 intentional major note（见 `docs/versioning.md`）。

**C0.5 `evalMissingSlot`**：默认 `off`。`"warning"` 时对**求值命中**的已知对象缺字段发 `nudo:missing-slot` warning。禁止 body AST 预扫描发明义务；草稿产品路径仍是 `nudo contract --draft`。详见 [`design-limitations.md`](./design-limitations.md)。

---

## 8. 一级 help

```text
nudo check <path> [--watch]  Gate contracts + entry throws; print signatures (CI)
nudo test <path> [--watch]   Report every inferred case; assert declared expectations
nudo contract <path>         Draft / emit interfaces
nudo export <path>           Project dts / guard / schema / standard
nudo health [paths]          Project health & drift
nudo env harvest pkg         Harvest @types into an env

Day 0   check（读签名）/ test（看 case） · Day 1   contract + check · Ecosystem   export
```

---

## 9. 实现状态

1. **展示层**：`formatShape` / CLI / CaseJson / LSP inlay —— 入口 `any` vs `unknown` 拆开；throws 上屏；check 默认 signatures；test 默认全量 case。 **[done]**
2. **Abs throws**：`any`/`nullish` 成员访问与危险操作写入 `throwsAbs` 或 may-throw 标记；nested try soft 上浮到外层帧。 **[done]**
3. **check L2**：仅入口；`nudo:entry-may-throw` 默认 error；`--ignore-throws` + 配置；export 形态矩阵覆盖。 **[done]**
4. **命令面**：`check` / `test` / `contract` / `export` / `health` / `env harvest`；schema 用 `--dialect zod`；`--from` / `test --freeze` / `export --out`。 **[done]**
5. **文档与 gold**：guides/gold/examples 对齐当前命令面；zero-FP 套件区分 L2 off/on；verify:examples 0 fail。 **[done]**
6. **分析范围**：`analysisConfig` + `mode=exports` 出厂默认 + 诊断噪声档。 **[done]**

---

## 10. 非目标

- 不在 body AST 上发明「必填 slot」义务（C0 仍成立；L2 是运行时效果，不是 shape 必填）。
- 不把 `.d.ts` 投影当真理源。
- 不为每个内部函数强制 totality。
- 不在本设计中重写 Abs 代数；只约束产品语义与执法面。
- 不做 `check --cases` / 独立观察动词。
- 不做独立 `.nudorc` / `nudo.config.js`。

---

## 11. 参考（现仓锚点）

| 片段 | 位置 |
|------|------|
| Abs 架构 | [`design-kernel-merge.md`](./design-kernel-merge.md) |
| 限制 / 路线图 / C0.5 | [`design-limitations.md`](./design-limitations.md) |
| CI 用法 | [`ci-nudo-check.md`](./ci-nudo-check.md) |
| 示例矩阵 | [`examples/README.md`](./examples/README.md) |
| 门禁核心 | `packages/core/src/algebra/check.ts` |
| 金标 | `packages/core/src/algebra/__tests__/check-recall-gold.test.ts` 等 |
| CLI | `packages/cli/src/index.ts` |
| case 报告 | `packages/cli/src/run-test.ts` · `packages/service/src/case-json.ts` |
| analysisConfig | `packages/service/src/evaluator/config.ts` |
| 窄化指南 | `packages/website/docs/guides/control-flow-narrowing.md` |