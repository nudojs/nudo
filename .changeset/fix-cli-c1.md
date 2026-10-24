---
"nudojs": patch
---

族 21 修复 C1：Bug 674 682 683 691 947 948 949 —— `nudo health` 的诊断与判定面。

- **674**：`health` 把**所有非 drift 的分析诊断**丢掉 → 坏掉的侧车在 health 面
  **绿灯**（假绿）。现在 analyzer 的 **error 级诊断**（「分析错误」：
  `nudo:interface-load` / `nudo:module-missing` …）进 `report.error` ⇒
  `ok:false` / `errors≥1` / 非零 exit，与 `nudo check` 对同一路径同口径
  （口径 = `guides/health.md` 的 health 门「Analysis errors」）。
- **682**：witness drift 计数不再用「新集合大小 + 旧集合大小」的**和式**
  （把同一条见证的改写拆成 +1 new / -1 removed 各计一次 ⇒ 只改 1 条见证报
  「2 条变更」，且与同屏 Summary 的「1 case drift」自相矛盾）。改为按**见证
  身份（调用点）**逐条比对的**实际变更条数**（同一条见证被改写只计 1 次）；
  `--json` 面额外给出 `drift.changed`（机器面可拆分 new / changed）。
- **683**：`health --from` 的使用点**一条调用记录都没有**时，整段漂移检测被
  静默跳过 ⇒ 见证早已陈旧仍报 `Result: OK` / exit 0（假绿）。现在显式报
  「**无法判定漂移**」（`nudo:path-missing-callsite` + `fix:` 提示）并判红；
  没有冻结见证时「0 drift」属实 ⇒ 不发假红。
- **691**：`health` 的**契约漂移判定**不施加 **mock 通道** ⇒ 同一份陈旧生成段，
  `nudo check` 报 `nudo:interface-drift` 而 `health` 报 0 contract drift / OK /
  exit 0（假绿 + 跨动词自相矛盾）。现在契约漂移判定与 `nudo check`
  **同口径**（同一注入包装配：模块图 + mocks + env 全局 + replace/as）。
- **947**：`health` **不设「分析目标」闸门** ⇒ 把 `.d.ts` / 侧车 / `.jsx` 当成
  **已检查的源文件**并报「Result: OK」（exit 0），而 `check` / `test` 对同一
  路径 exit 1「Not an analysis target」（假绿 + 跨动词自相矛盾）。现在目标解析
  与 check / test **同口径**（`isNudoTargetPath` 闸门 + 同款 `pathNotTarget`
  错误：同样的 message / suggestion）。
- **948**：`health --json` 在**空目标集**时给出 `"ok": true` + `"files": []` +
  exit 0 ⇒ 机器消费者读到「一切正常」，而实际上**一个文件都没检查**。现在
  空目录与 check 同口径判红（`nudo:path-empty-dir` + `ok:false` + 非零 exit）。
- **949**：`health` 的 `uncovered` 指标**在结构上恒为 0**（过滤式恰好排除了文档
  定义的「entry fallback」那一类）⇒ 文档承诺的「uncovered ⇒ Reported,
  informational only」**永不成立**；机器面读出的 `"uncovered": 0` 恒为假。
  现在 `uncovered` = 「无调用点证据（回落 entry@）」的函数（口径 =
  `guides/health.md`）⇒ 文本面逐个点名报出，机器面 `summary.uncovered` 真实；
  仍是 informational only（不判红）。
