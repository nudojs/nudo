---
"nudojs": major
---

**BREAKING**: `nudo contract --json` 的**顶层载荷形状**从「一个对象」变成
「**单元素数组**」（目录形态此前是 N 份 JSON 首尾相接 ⇒ `JSON.parse` 直接抛）。

谁会坏：解析 `nudo contract --json` stdout 的机器消费方 —— 单文件形态的顶层
从 `{ file, entries[], draftPath, … }` 变成 `[{ file, entries[], draftPath, … }]`
⇒ `payload.file` / `payload.entries` 变成 `undefined`；元素内部的键
（`file` / `entries[].fn` / `entries[].signature` / `draftPath` / `draftSource` /
`diff`）**未变**。

怎么迁移：消费方改读 `docs[0]`（并按数组遍历，别再假设「单文件 = 单对象」）。

fix(nudojs): `nudo contract` 的 `--json` 机器面（跨文件聚合 + 失败可读）+ `--from-dts` 的用法校验顺序

族 20 · 片 A（658 / 659 / 661 / 664）。

- **Bug 658 —— `contract --json` 的 stdout 必须是**一份** JSON（跨文件聚合层）**。
  改前 JSON 出口是**单文档**（每个 root 一次 `console.log`），而命令层对每个 root
  各跑一次 ⇒ 目录形态的 stdout 是 **N 份 JSON 首尾相接**，`JSON.parse` 抛
  `Unexpected non-whitespace character after JSON`。现在命令层加**跨文件聚合层**：
  收集所有 root 的机器文档后**一次**打印；**单文件也走同一路径** ⇒ 形态恒定。
  ⚠ **破坏性变更**：单文件载荷的**顶层形状**从「一个对象」变成「**单元素数组**」
  （元素内部的键 `file` / `entries[].fn` / `entries[].signature` /
  `draftPath` / `draftSource` / `diff` **未变**）。消费方请改读 `docs[0]`。
  同一修法覆盖 **print 分支**（`contract --json <目录>` 改前同样是多份拼接）。
- **Bug 659 —— `--from-dts` 不再绕过全部用法校验**。改前 `--from-dts` 在**所有
  校验之前**短路 ⇒ `--emit` / `--draft` / `--json` 被静默吞掉
  （`--from-dts --emit --draft` 不报互斥、exit 0；`--from-dts --json` 的 stdout
  是 draft 文本、不是 JSON）。现在 `--from-dts` 与其它模式共用同一套
  「先校验、后分派」的顺序：`--emit`/`--draft` 互斥、`--write` 需要草稿模式、
  `--exit-on-diff` 需要 `--emit --dry-run` 都对 `--from-dts` 生效；
  `--json` 与 `--from-dts` **显式互斥**（`--from-dts` 没有机器可读载荷 ⇒
  显式拒绝，不许「给了不生效且不报错」）。
  ⚠ `--write` + `--from-dts` 仍是**合法**组合（help 与 CLI Reference 的口径都是
  「With `--draft` / `--from-dts`」）⇒ 校验按模式判定，不误伤。
- **Bug 661 —— `--json` 形态下路径错误必须进 JSON body**。改前 `--json` 把
  `reportPathErrors`（stderr 面）整段跳过，而 `pathErrors` 只接进 draft 分支 ⇒
  print / emit 形态下「置红的那个原因」既不在 stdout 也不在 stderr，**exit 1
  没有任何理由**。现在路径错误进聚合信封的 `pathErrors[]`
  （print / emit / draft **三形态统一**），exit 仍为 1。
- **Bug 664 —— 失败的 root 也必须进 `--json` 载荷**。改前 per-root `catch` 只产
  人类文本：单文件形态 stdout **0 字节** + exit 1（违反「绝不空 stdout + 非零
  exit」不变量）；目录形态 stdout 是一份**只含好文件**的合法 JSON，失败文件
  **彻底消失**。现在失败 root 进聚合结果的 `errors[]`
  （`code: nudo:contract-analysis-failed`）⇒ stdout 永不为空、载荷不缺项。
- 顺带：`--json` 形态下的**用法错误**也落一份机器可读信封
  （`pathErrors[{code:"nudo:usage-error"}]` + exit 1），口径与 `nudo check --json`
  的用法错误信封同款（`--json` 下 stdout 永不为空）。
