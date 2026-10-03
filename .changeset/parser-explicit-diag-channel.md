---
"@nudojs/parser": minor
---

feat(parser): extractDirectives 新增显式诊断通道 `extractDirectives(ast, { diags })`——指令文法诊断同步落调用方数组，不碰模块级状态（无 seq 锚、无跨消费方窃取窗口）；模块级 side-channel（takeDirectiveDiags / takeDirectiveDiagsSince / directiveDiagCount / setDirectiveDiagCollector）降级为 deprecated 兼容层（nudojs check 的多发射窗口迁移前保留）。service analyzer 与 LSP validateText 已迁移显式通道
