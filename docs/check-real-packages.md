# nudo check 真实包扫描报告

生成：2026-09-11（结构违例 code 扩展后）

## 语料清单与新鲜度

语料 = `packages/core/src/algebra/__tests__/check-real-packages.test.ts` 扫描的真实 npm 包，声明于 `packages/core` devDependencies（`packages/core/node_modules` 解析安装）。版本为 2026-10-16 从磁盘实查的安装版本：

| 语料 | 语料版本 | 上次刷新 |
|---|---|---|
| commander | 15.0.0 | 2026-10-16 |
| escape-string-regexp | 5.0.0 | 2026-10-16 |
| is-plain-obj | 4.1.0 | 2026-10-16 |
| debug | 4.4.3 | 2026-10-16 |
| yocto-queue | 1.2.2 | 2026-10-16 |
| p-limit | 7.3.3 | 2026-10-16 |
| kleur | 4.1.5 | 2026-10-16 |
| eventemitter3 | 5.0.4 | 2026-10-16 |
| ms | 2.1.3 | 2026-10-16 |
| lodash | 4.18.1 | 2026-10-16 |

刷新义务：升级/增删语料时须同步四处——`packages/core/package.json` devDependencies、测试套件、本表（版本 + 上次刷新）、`scripts/check-corpus-freshness.mjs` 的 `CORPUS` 清单。新鲜度检查：`node scripts/check-corpus-freshness.mjs`（手动 / 可选 nightly，不进 CI；对 npm registry latest 比 major 落后，离线优雅跳过）。

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
