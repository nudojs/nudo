---
"nudojs": patch
---

fix(nudojs): `pathErrors[]` 命名漂移 —— check / test / contract 三个动词补齐 `targetErrors[]`（族 63b）

`pathErrors[]` 这个名字原本只承诺「`--from` 路径错误」，但 C1 把「**分析目标
闸门**」错误（路径不存在 / 空目录 / 非分析目标）也推进了**同一个** sink ⇒
数组名不再副实 ⇒ **机器消费者**读 `pathErrors[]` 时会误以为里面全是 `--from`
路径问题。

口径与 `nudo health`（族 63 · health 面）**同款**，三个动词统一：

- **`pathErrors[]`**：**有序全集**，**字段名 + 内容 + 顺序逐字不变**
  （既有机器消费者零影响；`--json` 的既有场景 stdout 逐字不变）；
- **`targetErrors[]`**（**新增的可选** JSON 字段）= **分析目标闸门**错误的
  **精确**子集
  - `--from` 路径错误**不**进它（它是**精确入口**，不是副本）；
  - 闸门错误**同时**留在 `pathErrors[]` 里（全集不变 ⇒ 不丢事实）；
- **无**闸门错误 ⇒ `targetErrors[]` **不出现**（既有场景输出逐字不变）。

覆盖动词：`nudo check --json`（CheckJsonMulti 信封）、`nudo test --json`
（CaseJson 信封）、`nudo contract --json`（聚合信封的错误条目）。
**人类面（stderr 文案）逐字不变**。
