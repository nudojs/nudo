# nudo check 真实包扫描报告

生成：2026-09-11（结构违例 code 扩展后）

| code | commander 上误报 |
|---|---|
| `nudo:constraint-violated` | **0** |
| `nudo:assign-mismatch` | **0** |
| `nudo:arg-structure` | **0** |

CI 门禁：`check-real-commander.test.ts` 对三种 error code 一并锁零。

以下为首次扫描（仅 constraint 时代）的文件级摘要，供对照：

## commander

| 文件 | fn | error | warn | ok |
|---|---:|---:|---:|:---:|
| `node_modules/commander/index.js` | 0 | 0 | 0 | ✓ |
| `node_modules/commander/lib/argument.js` | 1 | 0 | 0 | ✓ |
| `node_modules/commander/lib/command.js` | 2 | 0 | 0 | ✓ |
| `node_modules/commander/lib/error.js` | 0 | 0 | 0 | ✓ |
| `node_modules/commander/lib/help.js` | 1 | 0 | 0 | ✓ |
| `node_modules/commander/lib/option.js` | 2 | 0 | 0 | ✓ |
| `node_modules/commander/lib/suggestSimilar.js` | 2 | 0 | 0 | ✓ |

**零 error**（在已扫描文件上）

---

**合计**：7 文件 · 8 函数 · 0 error · 0 warning

说明：只扫 `*.js`（非 min）；import/require 依赖文件仍会分析（Abs 路径对 host 回落）。金标 recall 见 `check-recall-gold.test.ts`。
