---
"@nudojs/parser": major
---

feat(parser)!: 指令文法诊断通道收敛为显式 sink，删除模块级 side-channel

- `extractDirectives(ast, { diags })` / `extractInlineDirectives(node, { diags })`：诊断同步落调用方数组，单次调用内同文案去重；不传 `diags` 为纯查询形态（诊断丢弃，等价 `extractDirectivesQuiet`）
- 新增 `runWithDirectiveDiags(diags, fn)`：把「extract + 复解析」（如 nudo check D1 段的 `@nudo:mock` 表达式种子复解析）包进同一去重域
- **删除（breaking）**：模块级缓冲与 `takeDirectiveDiags` / `takeDirectiveDiagsSince` / `directiveDiagCount` / `setDirectiveDiagCollector`。迁移路径：`directiveDiagCount()` + `takeDirectiveDiagsSince(since)` 锚点对 → `extractDirectives(ast, { diags })` 直接落袋（或 `runWithDirectiveDiags` 包住 extract+复解析窗口）；`takeDirectiveDiags()` 整批排干 → 显式 `diags` 数组
- `collectEvalReplacements(source, { diags })`（@nudojs/service，additive）：行内 `@nudo:as`/`@nudo:replace` 文法诊断显式落袋，nudojs check 的 D1 并入面行为零变更（issue code / 合并顺序 / 去重口径保持）
- 删除动因：模块级缓冲曾引发两轮跨消费方偷诊断事故（R2B-003：全量 take 在 await 窗口偷走在途诊断）；service analyzer 与 LSP validateText 此前已迁移显式通道
