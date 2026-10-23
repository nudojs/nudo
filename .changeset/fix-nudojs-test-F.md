---
"nudojs": patch
---

nudo test: 补一条**反向回归钉**，锁住「声明式 `@nudo:case` 不得因名字前缀被丢出断言面」。

本片**零实现改动** —— Bug 651 的引擎侧根因已由族 14/15 的收口提交 `dde4b037` 修掉：
synthetic 判据已从**名字前缀**（`name.startsWith("call@") || name.startsWith("entry@")`）
改成**来源**判据（`c.source !== "directive"`，CLI 面 `packages/nudojs/src/run-test.ts`
与平行副本 `packages/service/src/test-report.ts` 同改）。本片只补钉，把「已修」的
行为钉住 ⇒ 防止将来有人把判据改回**名字前缀**。

新钉 `packages/nudojs/src/__tests__/cli-bug-651-declared-case-name.test.ts`（5 例，
只钉**语义**、不钉汇总行字面量）：

- 声明式见证 `@nudo:case "call@L42" (2) => 5`（实得 4）⇒ 计入失败、**exit 1**、
  报告面出现 `[FAIL]` 行（旧行为：被当成 synthetic ⇒ 断言面「0 failed」、**exit 0**，
  而诊断面同时报 `nudo:case-expected` error ⇒ 报告自相矛盾）。
- 同一形状的 `entry@L42` 前缀变体 ⇒ 同上。
- `--freeze` 写回形态的名字（`call@<file>:<line>`）⇒ 同上（这正是来源判据的原始动机：
  写回的见证**写在源码里** ⇒ 已声明）。
- **同名对照**：普通名字（`myCase`）的失败断言行为与前缀变体**完全一致**。
- 期望相符的 `call@L42` ⇒ 计入通过、**exit 0**（不是 `unchecked`、不是 synthetic）。

实测：钉子在 HEAD 只读副本上**通过**（5/5 ⇒ 假阳性钉在 HEAD 上通过）；
把副本里的判据改回名字前缀后 **4/5 失败**（只有普通名字的对照例仍通过）
⇒ 钉子确实能抓住「判据改回名字前缀」这一回归。
