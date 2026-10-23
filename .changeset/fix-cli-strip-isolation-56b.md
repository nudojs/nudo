---
"nudojs": patch
---

fix(nudojs): `migrate strip` 库面改**逐文件错误隔离**（族 56b · Bug 696 的库面半边）

台账里的「`migrate verify` 库面整批 abort」经实测**已不成立**（`migrateVerify`
早已逐文件隔离：同目标内部分文件语法错 ⇒ 失败文件记 `analysis-error`、成功文件
照常返回）；仍整批 abort 的是同族的 `migrateStrip`——`planStrip` → `makeStripPlan`
遇解析错即 `throw` ⇒ **同目标内其它文件的成功结果全丢**（且与 verify 的口径不一致）。

现在解析失败**降级成一行错误**（结构与 `migrateVerify` 的逐文件错误行**同款**：
`code` + `error`，`error` 带文件名；失败码沿用 verify 的 `analysis-error`，**不另立
码表**）⇒ 库面与 verify **同口径**：**先算完全部结果（含错误行）⇒ 再决定写不写**。

- **原子性不变**：任一文件失败 ⇒ **整批零写盘**（成功文件也不落盘）——好性质保留，
  没有为「不丢结果」改成部分写盘；写盘模式下成功行会附一条「未写盘」注记
  （防调用方把「计划成功」误读成「已写盘」）。
- **CLI 面逐字不变**：`nudo migrate strip` 的 stdout / stderr / exit code 与改前
  **逐字相同**（失败详情沿用旧文案 `parse failed: <文件>: <原因>`）；失败目标仍
  判失败（exit 1）、不进 `results`。
- **成功行的字段逐字不变**（负控：成功行不带 `code` / `error` 键 ⇒ `--json` 的
  成功信封与旧版逐字相同）。
- ⚠ **仍整批 throw 的两类错误**（未改）：`.tsx` 不可迁移（Bug 583 的产品判定）与
  目标级用法错误（`not found` / 非 TS 源）——它们不是逐文件的解析失败。
