---
"nudojs": patch
---

族 16 收口接线：把各分片「越界发现」里明确交给**命令层**
（`packages/nudojs/src/commands/migrate.ts`）的接线项补齐 —— migrate 的
四个子命令此前在命令层与库面**口径分裂**。

**Bug 668** — `migrate status` 只把 `targets[0]` 交给 `migrateStatus` ⇒
`nudo migrate status pkg-a pkg-b` 只报 pkg-a、无警告、exit 0（迁移审计场景下
这是危险的静默截断）。改为**全量审计**（按包根去重）。

**Bug 595** — `migrate retire <a> <b>` 只退役 `a`，`b` 静默跳过。改用库面的
多目标入口 `migrateRetireMany`（**全退役或全报错**，任一失败 ⇒ 整批零写盘）。

**Bug 675** — `migrate retire --all --json` 的顶层 JSON 形状**随结果条数变化**
（1 个包 = 对象，≥2 个包 = 数组）⇒ 机器可读契约不稳定。改为**恒为数组**，
与 `migrate status --json` / `migrate strip --json` 一致。

**Bug 1006** — `migrate retire --all` 失败时 **stdout 为空** ⇒ `--json` 契约
下 stdout 不是合法 JSON。改为失败时 stdout 也给出**合法 JSON 信封**
（`{ok:false, action, targets, error}`），人类面引导仍走 stderr。

**Bug 567 / 586** — 「无可退役」被当成**错误**（库面抛错 ⇒ CLI exit 1）⇒ 用户
跑一次正常退役却看到红色。改为「无可退役」是**正常结果**（exit 0 + 明确提示）；
编译器角色的脚本被原样保留时，CLI **打印**该脚本与保留原因（否则看起来像漏改）。

**Bug 588（retire 侧）** — 畸形 `package.json` 被 `readJson` 的「解析失败 =
不存在」压成同一个 `undefined` ⇒ 谎报「no package.json under X」（与 `nudo check`
面的「package.json parse failed」不同口径）。改用详细读取并 **fail-closed**；
`retire --all` 侧同样不再**静默跳过**畸形清单。

**Bug 586（判据收口）** — 「这个脚本是不是编译脚本」的判据必须是「**它会不会真的
产出产物**」，而不是「命令行里出现了 `-p`」或「脚本名叫 build」：
- `tsc -p tsconfig.build.json`（带 `outDir` + `declaration`）⇒ **真会 emit**
  ⇒ 编译器角色 ⇒ 原样保留（**报告 586 要的就是这个**）；
- `tsc -p .` 而 tsconfig 里 `compilerOptions.noEmit: true` ⇒ **不产出任何产物**
  ⇒ 它其实是**类型门禁** ⇒ 改写成 `nudo check` 且 typescript 依赖**可摘**
  （仓内公开样板 `docs/examples/migrate/before` 正是这一形状 —— 旧判定会让
  「退役 tsc」的故事落空：依赖摘不掉）。
判定会读 tsconfig（含 `extends` 链）与 JSONC 注释；**读不到配置 ⇒ 保守按
「会 emit」处理**（不得猜着改写）。
