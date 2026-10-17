# nudo check 真实包扫描报告

生成：2026-10-16（扫描 10 个语料包）

<!-- corpus-manual:start -->
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

刷新义务：升级/增删语料时须同步四处——`packages/core/package.json` devDependencies、测试套件、本表（版本 + 上次刷新）、`scripts/lib/corpus.mjs` 的 `CORPUS`（单源，被 `scan-real-packages.ts` 与本表下述脚本共用）。新鲜度检查：`node scripts/check-corpus-freshness.mjs`（手动 / 可选 nightly，不进 CI；对 npm registry latest 比 major 落后，离线优雅跳过）。

| code | commander 上误报 |
|---|---|
| `nudo:constraint-violated` | **0** |
| `nudo:assign-mismatch` | **0** |
| `nudo:arg-structure` | **0** |

CI 门禁：`check-real-commander.test.ts` 对三种 error code 一并锁零。

以下为文件级扫描摘要（`npx tsx scripts/scan-real-packages.ts` 生成，重跑即刷新；2026-09 首扫（仅 constraint 时代）已验证零 error）：

<!-- corpus-manual:end -->

## commander

| 文件 | fn | error | warn | ok |
|---|---:|---:|---:|:---:|
| `packages/core/node_modules/commander/index.js` | 3 | 0 | 0 | ✓ |
| `packages/core/node_modules/commander/lib/argument.js` | 8 | 0 | 0 | ✓ |
| `packages/core/node_modules/commander/lib/command.js` | 100 | 0 | 1 | ✓ |
| `packages/core/node_modules/commander/lib/error.js` | 0 | 0 | 0 | ✓ |
| `packages/core/node_modules/commander/lib/help.js` | 40 | 0 | 0 | ✓ |
| `packages/core/node_modules/commander/lib/option.js` | 18 | 0 | 0 | ✓ |
| `packages/core/node_modules/commander/lib/suggestSimilar.js` | 2 | 0 | 0 | ✓ |

**零 error**（在已扫描文件上）
## escape-string-regexp

| 文件 | fn | error | warn | ok |
|---|---:|---:|---:|:---:|
| `packages/core/node_modules/escape-string-regexp/index.js` | 1 | 0 | 0 | ✓ |

**零 error**（在已扫描文件上）
## is-plain-obj

| 文件 | fn | error | warn | ok |
|---|---:|---:|---:|:---:|
| `packages/core/node_modules/is-plain-obj/index.js` | 1 | 0 | 0 | ✓ |

**零 error**（在已扫描文件上）
## debug

| 文件 | fn | error | warn | ok |
|---|---:|---:|---:|:---:|
| `packages/core/node_modules/debug/src/browser.js` | 5 | 0 | 0 | ✓ |
| `packages/core/node_modules/debug/src/common.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/debug/src/index.js` | 0 | 0 | 0 | ✓ |
| `packages/core/node_modules/debug/src/node.js` | 7 | 0 | 3 | ✓ |

**零 error**（在已扫描文件上）
## yocto-queue

| 文件 | fn | error | warn | ok |
|---|---:|---:|---:|:---:|
| `packages/core/node_modules/yocto-queue/index.js` | 5 | 0 | 0 | ✓ |

**零 error**（在已扫描文件上）
## p-limit

| 文件 | fn | error | warn | ok |
|---|---:|---:|---:|:---:|
| `packages/core/node_modules/p-limit/index.js` | 3 | 0 | 0 | ✓ |

**零 error**（在已扫描文件上）
## kleur

| 文件 | fn | error | warn | ok |
|---|---:|---:|---:|:---:|
| `packages/core/node_modules/kleur/colors.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/kleur/index.js` | 3 | 0 | 0 | ✓ |

**零 error**（在已扫描文件上）
## eventemitter3

| 文件 | fn | error | warn | ok |
|---|---:|---:|---:|:---:|
| `packages/core/node_modules/eventemitter3/dist/eventemitter3.esm.js` | 2 | 0 | 0 | ✓ |
| `packages/core/node_modules/eventemitter3/dist/eventemitter3.umd.js` | 0 | 0 | 0 | ✓ |
| `packages/core/node_modules/eventemitter3/index.js` | 5 | 0 | 0 | ✓ |

**零 error**（在已扫描文件上）
## ms

| 文件 | fn | error | warn | ok |
|---|---:|---:|---:|:---:|
| `packages/core/node_modules/ms/index.js` | 4 | 0 | 0 | ✓ |

**零 error**（在已扫描文件上）
## lodash

| 文件 | fn | error | warn | ok |
|---|---:|---:|---:|:---:|
| `packages/core/node_modules/lodash/_DataView.js` | 0 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_Hash.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_LazyWrapper.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_ListCache.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_LodashWrapper.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_Map.js` | 0 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_MapCache.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_Promise.js` | 0 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_Set.js` | 0 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_SetCache.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_Stack.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_Symbol.js` | 0 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_Uint8Array.js` | 0 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_WeakMap.js` | 0 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_apply.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_arrayAggregator.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_arrayEach.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_arrayEachRight.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_arrayEvery.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_arrayFilter.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_arrayIncludes.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_arrayIncludesWith.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_arrayLikeKeys.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_arrayMap.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_arrayPush.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_arrayReduce.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_arrayReduceRight.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_arraySample.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_arraySampleSize.js` | 1 | 0 | 1 | ✓ |
| `packages/core/node_modules/lodash/_arrayShuffle.js` | 1 | 0 | 1 | ✓ |
| `packages/core/node_modules/lodash/_arraySome.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_asciiSize.js` | 0 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_asciiToArray.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_asciiWords.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_assignMergeValue.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_assignValue.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_assocIndexOf.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_baseAggregator.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_baseAssign.js` | 1 | 0 | 0 | ✓ |
| `packages/core/node_modules/lodash/_baseAssignIn.js` | 1 | 0 | 0 | ✓ |

**零 error**（在已扫描文件上）
---

**合计**：61 文件 · 241 函数 · 0 error · 6 warning

说明：只扫 `*.js`（非 min）；import/require 依赖文件仍会分析（Abs 路径对 host 回落）。金标 recall 见 `check-recall-gold.test.ts`。
