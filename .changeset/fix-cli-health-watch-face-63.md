---
"nudojs": patch
---

fix(nudojs): health 文本面量纲 / `pathErrors[]` 命名 / watch 多轮 JSON 形态（族 63 · nudojs CLI 协议面）

这 3 条都是**机器消费者**能看见的问题（`nudo health` 的报告面 + `--json` 面、
`--watch` 的 stdout 形态）：

- **health 文本面两处量纲不一**：Summary 的「N case drift」计的是**有漂移的
  文件数**，而同屏明细行计的是**见证条数** ⇒ 同一份报告里两个「N」量纲不同
  （一个文件里两条见证陈旧 ⇒ Summary 印「1 case drift」、明细行印「2 witness
  directive(s) changed」⇒ 用户读到的数自相矛盾）。现在 Summary 的数 =
  **见证（case）条数**（= Σ 各文件明细行的条数）⇒ 标签「case drift」（一条
  `@nudo:case` 见证指令）与数字终于同义；`--json` 面的 `summary.drift` 同一
  量纲（= Σ `files[].drift.(added+removed)`）⇒ **文本面 / JSON 面 / 每文件
  明细行三个面同一个数字、同一个量纲**。
  ⚠ **机器契约变更**：`--json` 的 `summary.drift` 的**单位**由「有漂移的
  文件数」改为「见证条数」（无漂移时仍是 `0` ⇒ 无漂移场景的输出**逐字不变**）。
  「有漂移的文件数」仍可由 `files[]` 逐条数出（`summary.files` 是文件总数）。
- **`pathErrors[]` 命名漂移**：C1 把「**分析目标闸门**」错误（非分析目标 / 空
  目录 / 路径不存在）也推进了同一个 sink ⇒ 该数组名不再只表示「`--from` 路径
  错误」⇒ 机器消费者按名字误读。**既有字段 `pathErrors[]` 的名字与内容逐字
  保留**（兼容既有机器消费者：它是**路径级错误全集**）⇒ 另**新增**一个可选
  字段 `targetErrors[]`（分析目标闸门错误的**精确**子集）⇒ 语义可见、旧字段
  兼容、事实不丢。（`--from` 路径错误**不**进 `targetErrors[]` ⇒ 新字段是精确
  入口，不是副本。）
- **watch 多轮累积的 JSON 形态**：第 2 轮起 stdout 里会有**第 2 份文档** ⇒
  机器消费者的 `JSON.parse(stdout)` 直接炸（"Unexpected non-whitespace
  character after JSON"）。现在 **`--watch --json` 的 stdout = JSON Lines**
  （**每行**一份完整 JSON 文档；`nudo health --watch --json` 一轮一份，
  `nudo check/test --watch --json` 一轮每文件一份）⇒ 机器消费者可**逐行**
  `JSON.parse`，不再随轮数炸。**非 watch 的单轮输出逐字不变**（仍是一份
  pretty 文档）；watch 横幅继续走 **stderr**（stdout 保持纯机器面）。
