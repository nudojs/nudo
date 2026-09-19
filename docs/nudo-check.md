# nudo check — 精化门禁

> CLI 语义权威：[`design-cli-semantics.md`](./design-cli-semantics.md)（本分支已实现 CLI verbs + L2 + any≠unknown 展示）。  
> 产品命令面：`check` / `test` / `contract` / `export` / `health` / `env harvest`；观察无独立动词。

> **类型即计算**：检查的是 Abs 上的 Pred 蕴含，不是 TS 式「类型是否匹配」。
> 精化会进入 Abs 并参与代数；dts 只是 TS 生态兼容侧信道。

## 它是什么

对 JS 源码做代数分析（**严格 Abs-only**：CLI 不再叠加 TypeValue 外延诊断）：

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

### any ≠ unknown（展示契约）

| | `any` | `unknown` |
|---|-------|-----------|
| 含义 | 无约束：入口未标注参数的默认契约 | 推导失败 / 引擎无信息 |
| 谁负责 | 开发者细化（refine / guard / 窄化） | Nudo 修推导 / 补 env·mock |
| CLI 展示 | `f(user: any) => any` | 签名或 case 上出现 `unknown` + conf 标注 |

**禁止**把入口无约束参数打印或叙述成 `unknown`。

### 义务分层

| 层 | 来源 | check 行为 |
|----|------|------------|
| **L1 显式契约** | `*.nudo.js` / `@nudo:refine` / 侧车；调用点证据可作 domain | 违例 → **error** |
| **L2 默认 JS 契约** | 未显式收窄时的入口运行时语义 | 入口未消化 may-throw → **error**（`nudo:entry-may-throw`） |

无显式契约 ≠ 无契约：契约退化为 JS 运行时边界——入口参数为 `any`，对 `any` 的危险操作进入 throws 域；导出函数不得静默携带未声明、未捕获的 throws。**不**从 body AST 发明必填 slot（C0 仍成立）。

L2 **只执法入口**（export / `exports.x` / `module.exports`）；内部 helper 允许 throw，check 默认不因内部 may-throw 失败。

## 报告格式（非 TS 换皮）

| code | 含义 |
|---|---|
| `nudo:constraint-violated` | 调用/返回 ⊭ refine（标量界 / **shape 字段**） |
| `nudo:assign-mismatch` | 赋值 ⊭ 原有形状（leqAbs） |
| `nudo:arg-structure` | HOF：实参不是可调用 fn / arity 不匹配（**不再**表示 body 缺 slot） |
| `nudo:case-inconsistency` | **`@nudo:case` 见证 ⊭ refine** |
| `nudo:interface-param-mismatch` | 手写契约参数名不在形参表面（C4.5；默认参名/rest 裸名/解构绑定名合法） |
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

L2 入口 may-throw 示意：

```
nudo check  getName.js
signatures
  getName(user: any) => any  throws TypeError

issues
  [ERROR getName] getName (export): may throw TypeError  (nudo:entry-may-throw)
      actual:   getName(user: any) => any    throws TypeError
      expected: entry total, or declare/catch throws
      → property 'name' on any (unconstrained value) → refine / guard / try-catch / --ignore-throws TypeError
```

- **signatures**：默认一行摘要且**成功也打印**；`--verbose` 才展开 `term:` / `pred:` / `conf:`；代数面用 `check --abs`
- **actual / expected**：违例是蕴含失败，不是 assignability
- **throws 域**上屏；入口无约束参数显示 **`any`**
- `--json` 自动带 `signatures[].abs` 与 `summary`

### 旗标

| 旗标 | 作用 |
|------|------|
| `--watch` / `-w` | 持续重跑（原一级 `nudo watch`） |
| `--json` | CheckJson v1（单文件） |
| `--verbose` | 展开 Abs 签名 |
| `--abs` | 代数 term/pred/conf 观察（原 `nudo types`） |
| `--from <paths…>` | 使用处调用记录（原 `--callsites`） |
| `--ignore-throws <names>` | L2：忽略这些入口 may-throw 类型名（`TypeError,RangeError`） |
| `--entry-throws <mode>` | L2：`error` \| `warning` \| `off`（默认 `error`） |

`--ignore-throws` / `package.json#nudo.check.ignoreThrows` **只**作用于 L2 入口 throws，**不**吞 L1 契约违例。

```jsonc
// package.json
"nudo": { "check": { "ignoreThrows": ["TypeError"] } }
```

## 能扫描什么

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

## 什么是精化，什么不是

精化 **只来自声明**，唯一形态 `@nudo:refine <param> <constraint>`；  
返回精化用 `@nudo:refine return <constraint>`。

不用 JSDoc `@param`/`@return`：那是类型注解。  
不叫 requires：那只是「校验挡板」；refine 表示 Pred 进入 Abs，参与代数（x>0 ⇒ x+1>1）。

L2 入口 throws **不是** shape 必填义务，而是运行时效果门禁；与 C0（不从 body 发明 slot）正交。

```js
/// @nudo:import { delay, percent } from "./delay.nudo.js"

/**
 * @nudo:refine ms delay
 */
function setDelay(ms) {
  if (ms > 0) return ms;
  return 0;
}

setDelay(0);        // error: 0 ⊭ delay
setDelay(100);      // ok
```

### Object 形状契约（无需 interface）

```js
// shapes.nudo.js
export const user = shape({
  id: number().gt(0),
  name: string(),
});

/// @nudo:import { user } from "./shapes.nudo.js"

/**
 * @nudo:refine u user
 */
function register(u) {
  return `${u.id}:${u.name}`;
}

register({ id: -1, name: "a" }); // error: u.id ⊭ > 0
register({ id: 1 });             // error: missing u.name
register({ id: 1, name: 2 });    // error: u.name ⊭ string
register({ id: 1, name: "ada" }); // ok
```

约束模板在 `*.nudo.js`（参数无关，`number()` 链式）：

```js
export const delay = number().gt(0);
export const percent = number().ge(0).le(100);
```

```js
// ✓ 双侧边界
/**
 * @nudo:refine n percent
 */
function pct(n) {
  if (n >= 0 && n <= 100) return n;
  return 0;
}
pct(150);           // error

// ✓ 结构可赋值（Abs leq）
let a = { x: 1 };
a = { y: 2 };       // error: missing slot x（nudo:assign-mismatch）

// ✓ 传参结构：L1 义务来自显式 shape 契约（C0.1：不从 body 扫 slot）
/// @nudo:import { xy } from "./shapes.nudo.js"
/**
 * @nudo:refine p xy
 */
function readXY(p) { return p.x + p.y; }
readXY({ x: 1 });   // error: missing field p.y（nudo:constraint-violated）
// 无 refine 时同调用不报 shape 缺字段（调用点事实 / any）；入口 may-throw 仍属 L2

// ✗ if 分支不是精化；无 refine 则不检查该精化
function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
clamp(-5, 0, 10);   // ok
```

示例目录：`docs/examples/constraints/`

## 观察落在哪里（无观察动词）

| 想知道什么 | 跑什么 |
|------------|--------|
| 入口签名 / any / unknown / throws | `nudo check <path>`（默认打印 signatures） |
| 逐调用点真值 / 窄化结果 | `nudo test <path>`（打印全部 case，含合成 `call@`/`entry@`） |
| 使用处实参形态 | `nudo check/test/contract --from <paths…>` |
| 代数面 term/pred/conf | `nudo check --abs` |
| 机器可读 | `nudo check --json` / `nudo test --json` |
| 契约打印/draft/emit | `nudo contract` |
| dts / guard / zod 投影 | `nudo export --format …` |

## 金标与精度（CI）

| 门禁 | 文件 | 要求 |
|---|---|---|
| **人工 recall** | `check-recall-gold.test.ts` | recall = precision = **1.0**（45 条人工标注 + 11 条 require/ESM 跨文件） |
| **shape 精化** | `check-shape-gold.test.ts` | 字段 / 可选 / 边界 |
| **case ⊆ refine** | `check-case-consistency.test.ts` | 见证 ⊆ 定义域 |
| **真实包精度** | `check-real-commander.test.ts` / `check-real-packages.test.ts` | 10 个真实包上**零** error 级误报（`constraint-violated` / `assign-mismatch` / `arg-structure` 三类）：commander / escape-string-regexp / is-plain-obj / debug / yocto-queue / p-limit / kleur / eventemitter3 / ms / lodash |

L2 开启后，any-param / 入口 may-throw 相关金标需按 L2 off/on **分套件**；本分支 zero-FP 基线以 L2 off 叙述保留，L2 on 期望不在此文档虚构。

```bash
# 真实包扫描报告
npx tsx scripts/scan-real-packages.ts commander
# → docs/check-real-packages.md
```

## 与 tsc 的关系

| | `tsc --noEmit` | `nudo check` |
|---|---|---|
| 赋值/结构 | 完备（显式注解下） | 部分：推断 Abs 上的 leq（`nudo:assign-mismatch`）+ 显式 shape 契约；HOF `arg-structure` 仅回调形态；宽度子类型无 excess 检查 |
| 约束（`x>0`）+ 字面量调用 | 做不到 | **做** |
| 入口 `any.prop` | 通常不报 | 进入 **throws 域**；L2 可 error |
| 报告形态 | TS 诊断 | Abs / actual ⊭ expected；成功仍打印 signatures |
| 零注解 JS | 需 checkJs | 默认 |

**建议**：TS 大仓继续 tsc；纯 JS / 渐进迁移 / Agent 流水线用 `nudo check` 作约束门禁。dts 经 `nudo export` 生成，用于生态兼容。

## `--json` 契约（v1）

```bash
pnpm run check file.js --json
```

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
- 契约测试：`check-json.test.ts`

### Agent / LSP

| 通道 | 入口 |
|---|---|
| CLI | `nudo check file.js --json` |
| LSP command | `nudo.check`（`{ file, source?, format? }`） |
| LSP request | `nudo/check` |
| Hover Abs | `nudo.hover` / `nudo/hover`（`{ file, line, column, includeInlays? }`） |
| Case / InferJson | `nudo.infer` / `nudo/infer`（服务 API 名，对应 CLI `nudo test --json`） |

`format: "json"` 只返回 CheckJson / InferJson；缺省为人类摘要 + JSON。  
`nudo.hover` 返回无损 `abs` / `absMultiline` / `intension`，`ext` 仅作对照。  
服务层 `nudo.infer` 与 CLI **`test --json`** 同构（旧 `infer --json` 已 deprecated）；`functions: ["scale"]` 可过滤。

## 实现入口

| 层 | 位置 |
|---|---|
| 门禁核心 | `packages/core/src/algebra/check.ts` |
| 结构可赋值 | `packages/core/src/algebra/leq.ts`（`leqAbs`） |
| 金标 | `packages/core/src/algebra/__tests__/check-recall-gold.test.ts` |
| CI 用法 | `docs/ci-nudo-check.md` |
| CLI | `nudo check`（`packages/cli/src/index.ts`） |
| case 报告 | `nudo test`（`packages/cli/src/run-test.ts`） |

## `nudo test --json` 契约（v1，原 infer-json）

```bash
pnpm run test:cli file.js --json
```

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
- 契约测试：`packages/service/src/__tests__/infer-json.test.ts`  
- 实现：`packages/service/src/infer-json.ts`（`serializeInferJson`）
