---
"@nudojs/lsp": patch
"@nudojs/core": patch
---

fix(lsp/core): IDE 面与 CLI 同源装配注入 + info 级 check 诊断不再被提前砍掉（Bug 785 / 786 / 780 / 779 vite 半）

- **Bug 785**（注入装配）：LSP 侧**从不采集**行内指令（`@nudo:as` /
  `@nudo:replace`）⇒ CLI 与 IDE 对同一份文件给出**相反**的门禁结论与签名
  （IDE 假红：用户声明过 `raw` 是 number，IDE 仍按 string 判
  `raw.toFixed` 不存在并报 `nudo:entry-may-throw`）。新增 **LSP 侧注入装配器**
  `buildLspInjection`（`packages/lsp/src/agent-tools.ts`）—— 与 CLI
  `buildCheckInjection` **同口径**（`@nudo:as` / `@nudo:replace` /
  `@nudo:mock` / env 全局 / 模块图），**不从 lsp 反向 import nudojs**，
  零新增 core / service 导出；agent check 工具面把它交给
  `checkSource({ inject })` ⇒ `nudo/check` 由 `ok=false · 1 error ·
  unknown #partial` 变为 `ok=true · 0 error · string`（与 CLI 同款结论）。
- **Bug 786**（注入传递协议 + inlay 半）：`CollectAbsInlaysOpts` 新增
  `inject` 字段并透传给 `generalizeFromAst`（core 侧**只改内部函数体**、
  零新增 core 导出 ⇒ 不破 core 冻结面）⇒ inlay 面不再把「行内指令缺席」
  显示成 `unknown`（Nudo 词汇里 = 「推断失败」）。对外交付注入传递协议：
  `buildLspInjection(filePath, source, { loadModule?, modules? }) →
  RunTranspiledOptions`，消费方统一走
  `checkSource({ inject })` / `generalizeFromAst({ inject })` /
  `collectAbsInlays({ inject })`。
- **Bug 780**（agent 侧）：`nudo.trace` 此前**只读 `params.file`** ⇒ LSP 自产的
  `file://…` uri 形态与 `executeCommand` 位置参数形态都让 `params.file` 变
  `undefined` ⇒ 观察透镜 100% 抛 TypeError。现在 `FunctionToolParams` 收
  `uri` 键（与 `file` 二选一，缺省时报共用入口闸的 `file is required …`
  而不是裸 TypeError），并导出位置参数桥 `tracePositionalArgs([uri, fn])`
  （形态不合法 ⇒ `undefined`，由命令桥报协议层参数形态错误）。
- **Bug 779**（vite 半）：`checkIssuesToDiagnostics` 在转成 vite Diagnostic
  **之前**就把 info 级砍掉 ⇒ 下游档位过滤器永远看不到 info ⇒
  `nudo.analysis.diagnostics: "verbose"` 对 check 诊断是**空操作**
  （`nudo:assume-relied` / `nudo:invariant-relied` / `nudo:opaque-result`
  永不上屏）。转换点改为保留三档，档位取舍只由
  `filterDiagnosticsByLevel` 决定；info 级走 vite 的 **info 通道**
  （不混进 warn 流），warning 计数不含 info。
