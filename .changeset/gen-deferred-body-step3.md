---
"@nudojs/core": minor
---

**A1 步骤 3 落地：生成器体从构造期挪到首个消费点**（`docs/design/generator-laziness.md` §5.3）。此前 `$gen` 在构造期一次性跑完整个体收集 yield 序列；现在构造期只产一个空壳并登记一次「待跑体」触发器，`next()` / `.return()` / `.throw()` 与 7 个元素面读出任一先触达才跑体，把完整结果 in-place 合并回壳。

- **值面收益**：body thunk 捕获活绑定（实验 D）⇒ 跨函数消费读到**消费时刻**的外层绑定，与原生一致（`yield n` 在 `n = 9` 后消费得 `9`，此前给 `0`）。构造点 c1/c2 从步骤 1 的 `0 | 1` / `"" | "ab"` 过近似收敛为精确的 `0` / `""`；容器 mutator 的长度域过近似也收敛为精确 `0`。
- **副作用只跑一次**：触发按 Abs 身份幂等 + 同一延迟体族的 `ensureFresh` 缓存 ⇒ 绕开实验 E 的「重跑重复副作用」；`n++` 在构造 + 多次消费后仍只加一次。
- **两条不变量保障**：① core 求值入口 `callTranspiledExportFull` 在收口时排空未触发的壳 ⇒ 「构造后从不消费」的既有 eager 值面契约（Bug 212 / 族 01 数字下标）与 service 侧 `.d.ts` 纯投影的元素域**都不退化**（端到端 `Generator<number | string>` 等与改前逐字一致）；② 触发器按族广播到 `snapshotAbs` / `$copy` 的所有别名，副本先消费时原对象与副本的元素面 / `genElements` 都完整。
- **改动面**：`runtime/async.ts`（`collectGenBody` 抽出 + 空壳 `$gen` + `mergeDeferredBody` + 协议三方法首调转发）、`exec/match-iter.ts`（触发器带目标身份、别名广播、pending 排空）、`exec/run.ts`（求值收口排空）。公共导出形状未变，`registerGenTrigger` / `fireGenTrigger` / `drainPendingGens` 均不进任何 barrel。
- **已知边界**：步骤 4「真挂起」未做 ⇒ 首 yield 之后的写仍在首次消费时一次跑到底（§5.5 的 c3/c4 不逐点精确）；`eval-generator-cross-function-consume.test.ts` 保留 1 条 `it.todo` 作验收清单。

回归：新增 `exec/__tests__/gen-deferred-body.test.ts`（5 例，直接钉构造期零体求值 / 只跑一次 / 幂等 / 别名广播 / async 同编）；`eval-generator-cross-function-consume.test.ts` 由「现状钉 + 3 todo」升级为 4 例 R3-b 验收；Bug 212 的 5 条精确断言与步骤 2 骨架的 2 条负控制按新语义重订（全部为精度提升或契约前提变更，**无精度回退**）。全仓结果见当日工作日志。按整批裁决发 **minor**，不写 BREAKING / Migration 标注。
