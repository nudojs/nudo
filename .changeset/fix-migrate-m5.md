---
"nudojs": patch
---

族 16 修复 M5：Bug 567 / 576 / 578 / 586 / 595 / 920 / 1006 / 1028 —— `nudo migrate retire` 的退役面、审计记录与作用域：

- **没有可退役的东西就不写盘**（567）：既无 `typescript` 依赖、又无门禁角色 tsc 脚本的包，`retire` 现在报「nothing to retire」并**零写盘**（此前仍写 `.nudo/migrate-retired.json` 并注入 `check:nudo`，`migrate status` 随后把它标成 `[retired]`）。
- **二次运行不再擦掉审计记录**（576）：`.nudo/migrate-retired.json` 与既有记录**合并**（并集 + 保留首次 `retiredAt`），此前第二次运行把 `removedDeps` / `rewrittenScripts` / `rewrittenWorkflows` 清空并改写 `retiredAt`。
- **注入真的落盘**（578）：`check:nudo` 注入写回 `pkg.scripts`（此前只改了局部副本 ⇒ 落盘文件里根本没有 `scripts` 键，CLI 输出与审计记录却都谎报「已改写」）。
- **编译脚本不再被换成门禁**（586）：只改写**门禁角色**的脚本（`--noEmit` / 裸 tsc）；`build` / `compile` / `bundle` / `emit` 等构建角色与带发射语义旗标（`--outDir` / `--declaration` / `-b` / `-p` 无 `--noEmit`）的脚本**原样保留**，并在结果与审计记录里列出（`preservedScripts`）；这类脚本仍需 tsc ⇒ `typescript` 依赖相应保留（摘掉它 build 当场坏掉）。只有编译脚本的包明确拒绝退役并说明原因。
- **多目标全退役或全报错**（595）：新增 `migrateRetireMany(paths)`（原子；任一目标失败 ⇒ 整批零写盘），CLI 侧需把 `targets[0]!` 换成 `targets`（见交付报告）。
- **workflow 改写作用域限定在被退役包**（920）：退役子包只改写**该包自有**的 `.github/workflows`，仓库根共享的 workflow 属于整仓作用域，不再被静默替换成 `npx nudojs check .`。
- **`retire --all` 包间原子**（1006）：整批先规划后统一提交，第 N 个包失败 ⇒ **前 N−1 个包也不落盘**（此前已提交的包留在仓库里而错误消息不点名）；错误消息点名本批涉及的包。
- **同键同型**（1028）：stdout `--json` 报文与落盘 marker 的 `rewrittenWorkflows` 现在都是 `{file,from,to}` 对象数组（此前 stdout 是对象数组、marker 是路径字符串数组），审计记录不再丢掉 CI 改写的前后内容。
