---
"@nudojs/core": patch
"@nudojs/lsp": minor
---

fix(lsp): IDE 面（hover/inlay/check 诊断）接入模块图——跨模块 import 塌缩 unknown 的假空与假红

- 根因：CLI `nudo check` 经 `buildCheckInjection` 把 `evalAbsModuleGraph` 模块图传给 `checkSource`/`generalizeFromAst`，而 LSP 侧同族调用（hover intension、`collectAbsInlays`、`checkToLspDiagnostics`）不带图——跨模块 import 不可解析，函数体求值 fail-closed。表现：函数名 hover 显示 `(_p0: A1) => unknown / conf: opaque`（参数无侧车种子 + 返回 unknown），Abs inlay 为空/unknown，且 `nudo:unproven-return` 假红（CLI 同文件全绿）。求值引擎本身精确（entry@/combinedAbs 无误），仅 host 装配缺口。
- `validation.ts` 新增 `evalAnalysisModules(filePath, source)`：`evalAbsModuleGraph` 组装（abs-modules-graph 内容缓存，重复调用廉价；cycle 不注入，与 CLI hasCycle 分支同语义 fail-closed）。
- `lsp-surface.ts` 函数名 hover 的 `generalizeFromAst` 补 `refine`（fromFile/loadModule/autoBind——此前连 refine 都没传，参数丢契约种子成 A1）与 `modules`（经 `SurfaceReuse.modules`）。
- `core/algebra/inlay.ts` `CollectAbsInlaysOpts` 增加 `modules` 透传给 generalize；`server-ide.ts` hover/inlay 处理器组装并传入图。
- 验证（npm-safe scanner decide.js，手写侧车 + 跨模块调用链）：修复后 hover = 契约 + `{confidence: 1|0.9|0.7|0.95, grade: "F"|string, …}`，inlay 三函数全精确，假红诊断 0；全套 vitest 1841 通过。

feat(lsp): 观察选择器——contract 成为与各 case 并排的 ●/○ 选项 + 档线改名 `● contract / hw|gen|imp`

- 档线改名：CodeLens / hover 首行 / inlay 档投影的 `● interface / handwritten|generated|implicit` 统一改为 `● contract / hw|gen|imp`（`formatInterfaceTierLine` 单源，新增 `INTERFACE_SOURCE_ABBR` 导出）。
- **contract 是观察选择器的一项，与各 case 互斥**（IDE 内点 ●/○ 切换，非配置开关）：
  - 默认 `● contract / hw|gen|imp`、全部 case `○`——与分析器默认（无激活 case 不跑 case 种子）一致（此前 case 0 默认显示 ● 与实际观察态不符）；
  - 点击 case（`nudo.selectCase`，已有）→ 该 case `●`、契约转 `○`；点击契约选项（新增 `nudo.selectContract`，executeCommand + `nudo/selectContract` 请求别名，位置参数 `[uri, fn]`）→ 取消激活 case（幂等）；
  - inlay 档投影镜像激活态（`●/○ contract / …`）；persist/draft 动作与 `call@`/`entry@` 观察层不受选择影响。
- hover 与 Abs inlay（参数约束/返回 term/pred）不参与选择器（推导面）。
