---
"nudojs": minor
---

新增 CLI 旗标 `nudo contract --from-dts --write --force`（覆盖既有草稿的**可见**
逃生口）—— 1.x+ 包的新旗标属**增量**变更（additive）⇒ minor。

fix(nudojs): `nudo contract --from-dts --write` 新增 `--force` 旗标（覆盖既有草稿的可见逃生口）

族 20 · 收口片（主 agent 接线）。`--from-dts --write` 在目标草稿已存在且内容不同时
会**拒绝覆盖**（exit 1，零写盘）。此前唯一的逃生口是环境变量 `NUDO_DRAFT_FORCE=1`
—— 对脚本不可见、不可审计。

现在新增 CLI 旗标 `--force`：

- `nudo contract --from-dts --write --force` ⇒ 允许覆盖既有草稿；
- 与 `NUDO_DRAFT_FORCE=1` **等价**（旗标优先），但**在 CLI 面可见、可被脚本审计**；
- 不加 `--force` 时的行为**不变**（仍然拒绝覆盖 + exit 1 + 零写盘）。

旗标只在 `--from-dts --write` 组合下有意义；与其它模式同用时不改变既有语义。
