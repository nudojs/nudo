# nudo check 在 CI 中的用法

> 产品能力与边界见 [nudo-check.md](./nudo-check.md)。  
> CLI 语义权威：[`design-cli-semantics.md`](./design-cli-semantics.md)。  
> 门禁语义：L1 精化蕴含（`@nudo:refine` / 侧车）+ L2 入口 may-throw（`nudo:entry-may-throw`）；有 `error` 则退出码 1。  
> 类型代数在 `@nudojs/core`，无独立 kernel 包。
>
> **报告是 Nudo 原生格式**（Abs 优先），不是 tsc 诊断换皮：
> - `signatures`：**成功也打印**；一行摘要，`--verbose` 才展开 shape/term/pred/conf；入口无约束参数显示 **`any`**
> - issues：`actual: …` / `expected: …` 写清 ⊭ 关系；throws 域上屏
> - dts 经 `nudo export --format dts` 生成，不是本报告主线
> - 观察无独立动词：签名来自 check，调用点 case 来自 `nudo test`

## 报告示例

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

L2 入口 may-throw（默认 error；`--ignore-throws TypeError` 可滤）：

```
signatures
  getName(user: any) => any  throws TypeError
issues
  [ERROR getName] getName (export): may throw TypeError  (nudo:entry-may-throw)
      actual:   getName(user: any) => any    throws TypeError
      expected: entry total, or declare/catch throws
```

（`--verbose` 会在 signatures 下展开 `term:` / `pred:` / `conf:` 完整 Abs。）

## 义务分层（CI 心智）

| 层 | 来源 | 默认 |
|----|------|------|
| L1 | `*.nudo.js` / `@nudo:refine` / 侧车 | 违例 → error |
| L2 | 入口 export 上未消化 may-throw | error（`nudo:entry-may-throw`） |

C0：**不**从 body AST 发明必填 slot。无显式契约时 shape 缺字段不报 L1；
入口对 `any` 的危险操作仍进 L2 throws 域。

## 真实包精度

- 金标：`check-real-packages.test.ts`（commander / escape-string-regexp / is-plain-obj / debug / yocto-queue / p-limit / kleur / eventemitter3 / ms / lodash 零误报）+ `check-real-commander.test.ts`（commander 三类 error code 锁零）
- 人工 recall 金标：`check-recall-gold.test.ts`（recall=precision=1）
- shape 精化：`check-shape-gold.test.ts`
- case ⊆ refine：`check-case-consistency.test.ts`

> L2 on 时 any-param / 入口 may-throw 期望需与 L2 off **分套件**；本仓库 zero-FP 叙述以 L2 off 基线为准，启用 L2 的 CI 应显式配置 `ignoreThrows` 或拆期望。

## 金标 recall（CI 门禁）

人工标注集：`packages/core/src/algebra/__tests__/check-recall-gold.test.ts`

| 指标 | 要求 |
|---|---|
| recall = TP/(TP+FN) | **1.0**（漏报 = 门禁失效） |
| precision = TP/(TP+FP) | **1.0**（误报 = 噪音） |

覆盖：延时 >0、百分比 0–100、端口、索引、clamp 真阴性、上界、箭头/export default、无前置不误报。

**当前扫描范围**：
- `fn(literalArgs)` 直接调用
- 别名：`const f = fn; f(lit)`
- 对象属性：`const api = { fn }` / `{ key: fn }` → `api.fn(lit)`
- 无条件转发：`function w(a){ return target(a); }` → `w(lit)` 用 target 前置
- 有守卫的转发（clamp）不传播
- **跨文件 require / ESM import / 动态 import**（CLI check 已解析相对路径）：
  - `const { fn } = require('./m.js'); fn(lit)`
  - `const m = require('./m.js'); m.fn(lit)`
  - `import { fn } from './m.js'; fn(lit)`
  - `import { fn as x } from './m.js'; x(lit)`
  - `import * as ns from './m.js'; ns.fn(lit)`
  - `const { fn } = await import('./m.js'); fn(lit)`
  - `const ns = await import('./m.js'); ns.fn(lit)`
- **re-export 一跳**：`export { fn } from './v.js'` 的 barrel 会跟到定义文件取前置
- **L2 入口 throws**：export / CJS 导出函数上未消化 may-throw（非 body slot）

## 本地

```bash
# 单文件（Day 0 / CI 正门）
pnpm run check path/to/file.js
pnpm run nudo -- check path/to/file.js

# 忽略特定入口 may-throw（只滤 L2，不吞 L1）
pnpm run check path/to/file.js --ignore-throws TypeError
pnpm run check path/to/file.js --entry-throws warning   # or off

# 调用点 case 报告（观察；断言失败才挡 exit）
pnpm run test:cli path/to/file.js

# 真实包精度扫描（多文件/包，生成 docs/check-real-packages.md）
npx tsx scripts/scan-real-packages.ts commander

# 示例门禁（矩阵 = docs/examples/README.md）
pnpm run verify:examples
```

## GitHub Actions 示例

```yaml
name: nudo-check
on: [push, pull_request]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: pnpm install
      - name: Type-as-computation gate
        run: |
          # 对 src 下入口文件跑 check；任一 FAILED → 失败
          # L2 入口 may-throw 默认 error；按需加 --ignore-throws 或 package.json#nudo.check
          set -e
          for f in $(find src -name '*.js' -not -path '*/node_modules/*' | head -50); do
            echo "==> $f"
            pnpm run check "$f"
          done
```

## 与 tsc 的关系（现阶段）

| | `tsc --noEmit` | `nudo check` |
|---|---|---|
| 赋值/结构检查 | 完备 | 部分：Abs leq（`nudo:assign-mismatch`）+ 显式 shape 契约；HOF `arg-structure` 仅回调；宽度子类型无 excess 检查 |
| 约束（`x>0`）+ 字面量调用 | 做不到 | **做** |
| 入口 `any.prop` | 通常不报 | throws 域；L2 默认 error |
| 零注解 JS | 需 checkJs | CLI 点名路径默认分析；IDE 出厂默认 `analysis.mode=exports`（export/侧车/指令）；无 export 脚本需 `mode=all` |
| 建议 | 大 TS 仓仍用 tsc | JS 仓 / 存量代码 / Agent 流水线 |

**推荐双跑**：TS 项目继续 tsc；纯 JS 或渐进迁移目录用 `nudo check` 作补充门禁。

## 退出码

- `0`：OK（signatures 仍打印）  
- `1`：存在 `severity=error` 的 issue（L1 如 `nudo:constraint-violated`；L2 `nudo:entry-may-throw` 未 ignore 时）

`nudo test` exit 1 **仅**当声明的 `@nudo:case` 断言失败；合成 `call@`/`entry@` 不挡 exit。
