---
"nudojs": patch
---

族 21 修复 C2：Bug 687 688 925 927 929 —— health 的输出面与 watch 面。

- **687**：文本面与 `--json` 面的 error 计数**同源**（文件内 error + `--from`
  路径错误 ⇒ `totalErrors`）⇒ 同一轮两个面不再给出两个数字（此前文本面
  「0 error(s)」+ JSON 面 `summary.errors: 1`）。
- **688**：`health` 的 `--from` 多值语义与 `check` / `contract` **同口径** ——
  多文件 `--from` 被**接受**（`nudo health lib.js --from a.js b.js`），
  分析目标仍是 `lib.js`；多值时 stderr 如实说明「`--from` 之后的裸 token
  全部按使用点文件处理」。无位置路径时仍是 usage error（文案如实：
  此时 paths 确实为空，与 check / test / contract 同款）。
- **925**：`health --json` 的机器面**序列化 budget 截断快照**
  （`files[].budget`，与 `nudo check --json` 同源同义）+ 多文件聚合出
  `summary.budgetTruncated` ⇒ 文本面报「budget truncated / 结果被宽化」时，
  机器消费者也拿得到 `truncated` 标志（此前 JSON 面给 `"ok": true` 的
  「干净」报告）。
- **927**：`health --watch` 在**装 watch 之前**做路径存在性校验 ⇒ 缺失路径
  与无 watch 面**同款**（`File not found` 上屏 + exit 1）且**不装 watch**
  ⇒ 不再是「静默空会话 + 绿」（假绿）。
- **929**：watch 的 runner **按轮去重**（`startWatch` 的 `onRoundStart`）——
  一轮只跑一次 `runHealth` ⇒ 首轮只产出一份完整报告（此前按文件数重跑整个
  路径集 ⇒ N 份报告 / N 份 JSON 文档 ⇒ `JSON.parse(stdout)` 必炸）。
