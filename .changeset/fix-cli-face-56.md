---
"nudojs": patch
---

fix(nudojs): CLI 机器面的 3 条（族 56 · nudojs **CLI 面**）

这 3 条都是**机器消费者**能看见的问题（`nudo migrate` 的 `--json` 面 / 迁移
闸门）：

- **排除清单未上 stdout**（`migrate status` / `migrate retire --all`）：排除
  清单（pnpm 负向模式 `!packages/legacy` 命中的包）此前**只**出现在 **stderr**
  的人读行 ⇒ **机器消费者**看不到「哪些包被排除了」。现在它同时进 **stdout 的
  机器面**：`--json` 的每行/每条结果多一个 `excluded` 字段（相对**扫描根**的
  posix 路径，与 stderr 那行**逐字一致**）。口径：**只在有排除时出现** ⇒ 无排除
  时 `--json` 输出与旧版**逐字相同**；**文本面 stdout 不变**（stderr 那行人读
  提示仍在原处）。
- **多目标退役的错误消息只带第一个失败目标**（`migrate retire <a> <b>`）：
  `migrateRetireMany` 此前**遇到第一个失败就抛** ⇒ 其余失败目标**丢失**
  （用户以为只有一个包有问题）。现在消息**列出全部失败目标**（`<原因> (target:
  <目标>)` 之后追加 `  <目标>: <原因>` 清单），`--json` 面另有结构化的
  `failedTargets`。**原子性不变**：任一失败 ⇒ 整批零写盘；单个失败的消息与旧
  实现**逐字同形**。附带修一处**假绿**：一批里混着「无可退役」与**真错误**时，
  旧口径按**第一个**失败项定 exit（真错误被当成正常结果 ⇒ exit 0）⇒ 现在
  「**全部**失败项都是无可退役」才算正常结果，否则报红。
- **verify 的扫描面不含 `.jsx`**（`migrate verify`）：verify 此前复用 service
  的 `isNudoTargetPath`（排除 `.jsx`）⇒ **JSX 产物**（旧 `migrate strip` 的
  `.tsx → .jsx` 映射产物，Node 加载不了）对迁移闸门**不可见** ⇒ 闸门对**不可
  加载的产物**发绿灯。verify 现在**自己算扫描面**（纳入 `.jsx` / `.tsx` /
  `.cjs`；声明文件 / 侧车 / draft 产物**仍不是**目标 ⇒ Bug 566 同口径不变）。
  ⚠ **根因仍在 service**（`isNudoTargetPath` 排除 `.jsx`）——`nudo check` /
  `nudo health` / `nudo test` 共用那条规则，本片只做 **CLI 侧兜底**。
