---
"nudojs": patch
"@nudojs/service": patch
---

fix(nudojs): `nudo contract --draft` 的 dry-run 面（打 unified diff）+ `--json`/`--write` 显式互斥 + 项目根判据按路径分量

族 20 · 片 B（660 / 663 / 665）。

- **Bug 660 —— `--draft --write --dry-run` 不打 unified diff**（只打一行
  「[dry-run] would write → …」），而 CLI Reference 承诺 `--dry-run` =
  "Print a unified diff instead of writing"。同一个 `--dry-run` 旗标在
  `--emit` 与 `--draft` 两条分支上语义不同。现在 `--draft` 分支**复用
  `--emit` 分支的同一个 diff 生成器**（`unifiedDiff`，已在
  `@nudojs/service/emit` ⇒ 零新增导出），对照面是**既有草稿文件**的磁盘内容
  （与 `--draft --json` 审阅面同款口径），diff 头与 `--emit --dry-run` 同形
  （`--- a/<path>` / `+++ b/<path>`）；dry-run 仍然**不写盘**。
- **Bug 663 —— `--draft --json --write` 静默丢弃 `--write`**（`--json` 分支
  早退 ⇒ 写盘分支不可达）⇒ 草稿根本没落盘、exit 0、零提示 ⇒ **假绿 + 静默
  数据丢失**。现在 `--json` 与 `--write` **显式互斥**：
  `error: --write cannot be combined with --json` + **exit 1**，机器面仍给出
  一份合法 JSON 载荷（`{file, errors:[{code:"nudo:usage-error"}]}`，由命令层的
  跨文件聚合层收进恒定数组外壳）。
- **Bug 665 —— 项目根边界用 `rel.startsWith("..")` 判逃逸** ⇒ 项目根下的
  **合法目录名**（`..data/` / `...cfg/`）与**合法文件名**（`..data.js`）被误判
  成「越出项目根」⇒ 草稿**拒写**（exit 1），而同一项目里的普通文件正常写出。
  判据改成**按路径分量**：「整段等于 `..`」或「以 `..` + 路径分隔符开头」或
  「跨盘（绝对路径）」——CLI 半（`nudo contract --draft --write`）与 service 半
  （`writeInterfaceDraft` 的写盘守卫）**逐字同款**；真正越出项目根的路径**仍被
  拒**。
