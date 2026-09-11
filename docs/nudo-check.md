# nudo check — 约束门禁

> **类型即计算**：检查的是 Abs 上的约束蕴含，不是 TS 式「类型是否匹配」。
> dts 是 TS 生态兼容添头；本门禁与报告格式是 Nudo 原生的。

## 它是什么

对 JS 源码做代数分析：

1. 每个顶层函数归纳**符号 Abs**（shape × term × pred × conf）
2. 扫描字面量调用点，检查实参是否满足前置 Pred
3. 输出 **Nudo 原生报告**：`signatures` + `actual ⊭ expected`

```bash
npx tsx packages/cli/src/index.ts check path/to/file.js
```

退出码：有 `error` → `1`（CI 可直接当门禁）。

## 报告格式（非 TS 换皮）

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

## 什么是前置，什么不是

```js
// ✓ 成功路径前置：调用方必须满足
function needsPositive(x) {
  if (x > 0) return x;
  return 0;
}
needsPositive(-1);  // error

// ✓ 双侧边界
function pct(n) {
  if (n >= 0 && n <= 100) return n;
  return 0;
}
pct(150);           // error

// ✗ clamp 回退守卫：不是调用前置
function clamp(n, lo, hi) {
  if (n < lo) return lo;   // 越界是合法输入
  if (n > hi) return hi;
  return n;
}
clamp(-5, 0, 10);   // ok

// ✗ 有守卫的转发：不传播目标前置
function safeWrap(n) {
  if (n > 0) return needsPositive(n);
  return 0;
}
safeWrap(-1);       // ok
```

## 金标与精度（CI）

| 门禁 | 文件 | 要求 |
|---|---|---|
| **人工 recall** | `check-recall-gold.test.ts` | recall = precision = **1.0**（45 条） |
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

`format: "json"` 只返回 CheckJson；缺省为人类摘要 + JSON。  
`nudo.hover` 返回无损 `abs` / `absMultiline` / `intension`，`ext` 仅作对照。

## 实现入口

| 层 | 位置 |
|---|---|
| 门禁核心 | `packages/core/src/algebra/check.ts` |
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
        "display": "scale: <A1>(x: A1) => number = (A1 + 1)",
        "abs": "number  = (A1 + 1)  #path",
        "absMultiline": "…",
        "term": "(A1 + 1)",
        "conf": "path"
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
