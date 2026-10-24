---
"@nudojs/lsp": minor
"@nudojs/service": minor
---

agent 工具面的载荷**新增**了 `assertions` 段 / `pathErrors[]` 段与新诊断码
（`nudo:path-not-found` / `nudo:path-not-target`）；`@nudojs/service` **新增**了
一批公开导出（`mergeCheckIssues` / `directiveDiagIssues` / `mockFromErrorIssues` /
`envUnresolvedIssues` / `collectCheckSupplementIssues` / `buildTestReport` /
`pathNotFoundError` / `targetPathError` / `formatPathErrorText` 等）⇒ 纯**增量**
（additive）⇒ minor。

LSP agent 工具面（`nudo/check` / `nudo/test`）与 CLI 的通道对齐：补回
check 的补充诊断通道、test 的断言汇总、imported 段、路径错误信封与
「分析目标」闸门。

- `nudo/check` 此前只跑裸 `checkSource`，CLI 侧并入 check 报告的三条补充
  通道（指令文法 `nudo:directive-syntax`、mock 装载失败
  `nudo:module-missing`、path env 未解析 `nudo:env-unresolved`）一条都没接
  ⇒ 同一文件 CLI / LSP 编辑器面 / agent 面给出三份 issue 集（agent 面把
  「指令写错了」整条吞掉，mock 文件缺失判绿）。并入逻辑下沉到
  `@nudojs/service`（`mergeCheckIssues` / `directiveDiagIssues` /
  `mockFromErrorIssues` / `collectCheckSupplementIssues`），三面共用同一份。
- `nudo/test` 此前没有 `assertions` 段 ⇒ 消费方分不出「见证通过」与「见证
  失败」。现在并入与 CLI `nudo test --json` 同口径的
  `assertions`（passed / failed / unchecked，service 的 `buildTestReport`）。
- `nudo/test` 的文本面此前**不渲染** imported（外部）函数 ⇒ CLI 有的
  `(imported)` 段在 IDE 面整段消失，而头部计数仍把外部 case 算进去
  （「3 case」只印 2 条）。现在按来源模块分组渲染，段头
  `--- <mod> (imported) ---`。
- `nudo/test` 的 `functions` 过滤只重算**本地** case 数 ⇒ `summary.cases`
  与自身 payload 矛盾（summary 说 1、payload 躺着 2）。外部函数不在过滤
  范围内，其 case 仍留在 payload 里 ⇒ 计数改为与 payload 同源。
- `nudo/check` / `nudo/test` 此前没有「分析目标」闸门 ⇒ 对侧车契约文件报
  「0 fn / 0 error」判绿（CLI 对同一文件 exit 1「Not an analysis
  target」），`nudo/test` 还把契约 DSL 构造器（`fn(...)` / `shape(...)`）
  当成真实调用点报成 case。入口现在复用与 CLI 同一份目标判定
  （`isNudoTargetPath` + 侧车 / `.d.ts` / JSX 排除），非分析目标返回
  `nudo:path-not-target`。
- `nudo/check` / `nudo/test` 此前对不存在的文件只返回裸 `ENOENT` 文本
  （`format:"json"` 也不返回 JSON）。现在走结构化路径错误通道
  （`pathErrors[]` + `nudo:path-not-found` + suggestion），与 CLI
  `check --json` / `test --json` 同构。
- `nudo/test` 的 `functions` 入参此前零校验：传字符串被逐字符建集合（函数
  全被滤掉 ⇒ 全空报告的假空结论），传数字 / 对象时过滤被整体跳过（静默
  失效）。畸形入参现在一律工具错误（`isError: true`）。
