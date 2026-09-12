# nudo check — 精化门禁

> **类型即计算**：检查的是 Abs 上的 Pred 蕴含，不是 TS 式「类型是否匹配」。
> 精化会进入 Abs 并参与代数；dts 只是 TS 生态兼容侧信道。

## 它是什么

对 JS 源码做代数分析：

1. 每个顶层函数归纳**符号 Abs**（shape × term × pred × conf）
2. 扫描调用点 / 返回值，检查是否满足 `@nudo:refine` 声明
3. 输出 **Nudo 原生报告**：`signatures` + `actual ⊭ expected`

```bash
npx tsx packages/cli/src/index.ts check path/to/file.js
```

退出码：有 `error` → `1`（CI 可直接当门禁）。

## 报告格式（非 TS 换皮）

| code | 含义 |
|---|---|
| `nudo:constraint-violated` | 调用/返回 ⊭ refine（标量界 / **shape 字段**） |
| `nudo:assign-mismatch` | 赋值 ⊭ 原有形状（leqAbs） |
| `nudo:arg-structure` | 实参结构 ⊭ body 访问的 slot |
| `nudo:case-inconsistency` | **`@nudo:case` 见证 ⊭ refine** |

```
nudo check  src/validators.js
FAILED
  1 error · 0 warning · 0 info · 1 fn

signatures
  needsPositive(x)  number  = x  where x > 0  #path
    pred: x > 0
    conf: path

issues
  [ERROR L12 needsPositive] needsPositive[x]: 实参 ⊭ 前置
      actual:   -1  #exact
      expected: x > 0
      → 改用满足 x > 0 的值，或放宽 x 的前置
```

- **signatures**：无损 Abs（verbose 展开 term/pred/conf）
- **actual / expected**：违例是蕴含失败，不是 assignability
- `--json` 自动带 `signatures[].abs` 与 `summary`

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

// ✓ 传参结构：body 访问 p.x / p.y → 实参须齐（字面量或标识符）
function readXY(p) { return p.x + p.y; }
readXY({ x: 1 });   // error: missing slot y（nudo:arg-structure）
const o = { x: 1 };
readXY(o);          // error（标识符绑定表）

// ✗ if 分支不是精化；无 refine 则不检查
function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
clamp(-5, 0, 10);   // ok
```

示例目录：`docs/examples/constraints/`

## 金标与精度（CI）

| 门禁 | 文件 | 要求 |
|---|---|---|
| **人工 recall** | `check-recall-gold.test.ts` | recall = precision = **1.0**（57 条） |
| **真实包精度** | `check-real-commander.test.ts` | commander 上 **零** `constraint-violated` 误报 |

```bash
# 真实包扫描报告
npx tsx scripts/scan-real-packages.ts commander
# → docs/check-real-packages.md
```

## 与 tsc 的关系

| | `tsc --noEmit` | `nudo check` |
|---|---|---|
| 赋值/结构 | 完备 | 不做 |
| 约束（`x>0`）+ 字面量调用 | 做不到 | **做** |
| 报告形态 | TS 诊断 | Abs / actual ⊭ expected |
| 零注解 JS | 需 checkJs | 默认 |

**建议**：TS 大仓继续 tsc；纯 JS / 渐进迁移 / Agent 流水线用 `nudo check` 作约束门禁。dts 生成可选，用于生态兼容。

## `--json` 契约（v1）

```bash
npx tsx packages/cli/src/index.ts check file.js --json
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
| Infer Abs | `nudo.infer` / `nudo/infer`（`{ file, source?, format?, functions? }`）→ InferJson v1 |

`format: "json"` 只返回 CheckJson / InferJson；缺省为人类摘要 + JSON。  
`nudo.hover` 返回无损 `abs` / `absMultiline` / `intension`，`ext` 仅作对照。  
`nudo.infer` 与 CLI `infer --json` 同构；`functions: ["scale"]` 可过滤。

## 实现入口

| 层 | 位置 |
|---|---|
| 门禁核心 | `packages/core/src/algebra/check.ts` |
| 结构可赋值 | `packages/core/src/algebra/leq.ts`（`leqAbs`） |
| 金标 | `packages/core/src/algebra/__tests__/check-recall-gold.test.ts` |
| CI 用法 | `docs/ci-nudo-check.md` |
| CLI | `nudo check` |

## `nudo infer --json` 契约（v1）

```bash
npx tsx packages/cli/src/index.ts infer file.js --json
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
      "args": ["unknown"],
      "result": "number | string",
      "throws": null,
      "source": null,
      "intension": {
        "display": "scale: <A1>(x: A1) => number | string = (A1 + 1)",
        "abs": "number | string  = (A1 + 1)  #partial",
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
- **ext**：`args` / `result` 为 TypeValue 字符串（有损兼容）  
- **intension**：无损 Abs（`abs` / `term` / `pred` / `conf`）  
- 契约测试：`packages/service/src/__tests__/infer-json.test.ts`  
- 实现：`packages/service/src/infer-json.ts`（`serializeInferJson`）
