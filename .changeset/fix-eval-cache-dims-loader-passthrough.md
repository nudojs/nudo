---
"@nudojs/service": patch
---

fix(service): evaluator run 缓存键补齐维度与宿主 loader 透传。`tryRunEval` 缓存条目加入 `lenientGlobals` / `maxLoopIters` 命中维度，并按「入口文件 × mode」分槽——同 source 不同 lenient/迭代预算不再互命中陈旧结果，`collectCallRecords` 的 exec 采集不再踢掉同文件的 analyze 条目（`evictEvalCacheForFiles` 一并清两种 mode 槽）。宿主 `loadModule`（LSP 虚拟 FS / 侧车）现透传到模块图组装与 depKey：analyzer 一次分析内求值不再回落 `defaultLoadModule`，`tryEvalCall` / `tryEvalCallFull` 同口径接受 loader 与宿主预计算 `depKey`（复用 analyzer 一次 BFS，避免 per-fn 线性放大）。模块图组装序列（evalAbsModuleGraph → collectEnvModules → mergeHarvestUnderEnv → applyMockModule*）收敛为 `composeEvalModules` 单一入口（analyzer 与 evaluator 共用，消除一次分析内的重复 parse/eval 与两处漂移）。删除恒真死代码 `isEvalCapable`（公共导出一并移除；能力判定由转译点 fail-closed 承担）与 analyzer 中永不填充的 `unreachableRanges`/不可达 else 分支；`setEvalCallCollector` 恢复改为显式 `undefined` 判定；`defaultAbsLoadModule`/`resolveRel` 候选遍历收敛为单一 `readFirstRel`。
