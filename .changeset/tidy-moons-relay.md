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

feat(lsp): 观察层互斥视图 `nudo.lens`（contract | case）+ 档线改名 `● contract / hw|gen|imp`

- 档线改名：CodeLens / hover 首行 / inlay 档投影的 `● interface / handwritten|generated|implicit` 统一改为 `● contract / hw|gen|imp`（`formatInterfaceTierLine` 单源，新增 `INTERFACE_SOURCE_ABBR` 导出）。
- `nudo.lens`（initializationOptions 或 `settings.nudo.lens`，非法值回落）二选一：
  - `contract`（默认）：interface 档 lens + persist/draft 动作 + inlay 档投影；
  - `case`：case 选择器 lens（`●/○ case "…"`）+ `call@`/`entry@` 观察 lens + caseHints inlay。
  - Abs inlay（参数约束/返回 term/pred）与 hover 不受视图影响（推导面）；切换即时发 CodeLensRefresh + inlayHint.refresh。
- 服务端纯函数（computeInterfaceLenses / computeObservationLenses / collectAbsInlays）不变，过滤在 server-ide 渲染层。
