---
description: 各包当前版本发布说明 —— 由 changesets CHANGELOG 自动生成；破坏性变更含迁移说明。
slug: /releases
---

# 发布记录

> 由 `pnpm run docs:gen` 从 `packages/*/CHANGELOG.md` 生成 —— 请勿手改。破坏性条目带 `**BREAKING**` 与一行迁移说明。

本页只保留各包**当前版本**说明。完整历史见 [完整发布历史](./releases-history.md)。

| 包 | 当前版本 |
|----|----------|
| `@nudojs/core` | 1.7.3 |
| `@nudojs/service` | 1.6.3 |
| `nudojs (CLI)` | 1.3.4 |
| `@nudojs/parser` | 1.4.0 |
| `@nudojs/lsp` | 1.4.1 |
| `@nudojs/env` | 0.4.18 |
| `@nudojs/harvester` | 0.3.4 |
| `vite-plugin-nudo` | 0.4.19 |
| `nudo-vscode` | 0.3.23 |

**按包跳转:** [`@nudojs/core`](#pkg-core) · [`@nudojs/service`](#pkg-service) · [`nudojs (CLI)`](#pkg-nudojs) · [`@nudojs/parser`](#pkg-parser) · [`@nudojs/lsp`](#pkg-lsp) · [`@nudojs/env`](#pkg-env) · [`@nudojs/harvester`](#pkg-harvester) · [`vite-plugin-nudo`](#pkg-vite-plugin) · [`nudo-vscode`](#pkg-vscode)

## @nudojs/core 1.7.3 {#pkg-core}

## 1.7.3

### Patch Changes

- 50e50f1: fix(core): analyze 模式顶层剥离（stripEffectfulTopLevel）改结构化——Babel 解析 transpile 产物、按顶层语句整条剥除，替代行级正则 + `endsWith(";")`/括号计数启发式。修复三类实证误剥：① 多行语句回调体内行以 `;`/`}` 结尾提前终止跳过 → 语句尾悬空 `new Function` SyntaxError（如顶层 `setTimeout(fn, 100)`，整模块 fail-closed）；② 字符串/模板字面量里的未配对 `(`（如 `"fetch("`）被计入 `$for`/`$fork` 括号平衡 → 连带误删后续顶层 `export function`（导出静默 unknown）；③ 列 0 的 `catch (` 头匹配「未知全局调用」正则 → 顶层 try/catch 一律被剥成悬空块。剥除口径零变更（`$callNamed` 未知全局、`$for`/`$fork`/`$while*` 与源形态 if/for/while 剥；本地调用、for-of、赋值、`$switch`/`$throw`、try/catch、`__nudo*` 簿记保留），35 例新旧差分语料 30 例字节级一致、5 例均为旧实现损坏样本；新增 run-strip-effectful.test.ts 差分护栏，eval-*（64 文件 657 用例）与 core algebra 全量（272 文件 3078 用例）绿。
- 50e50f1: fix(core): Math 原生折叠抛错不再静默拓宽为 number——min/max、round/floor/ceil/trunc、通用 impl 三处 catch 补 `noteAbsTruncation`（`#math-fold-error`，check 映射 info 级 `nudo:math-fold-error`，不再误报 recursion-truncated），宿主篡改/环境分叉的 `Math.*` 精度损失可观测。`leqAbs` pred 失败文案改用 `predToString` 渲染（`pred ⊭ x > 5` 替代裸 op 名），`nudo:assign-mismatch` suggestion 直接可读。内部：leq 比较辅助函数改精确 `CmpPred`/`Term` 类型（删除三处 `as never` 与弱结构签名，行为零变更）；checkSource 消除 sidecar 场景对同一 source 的二次完整 parse（`localNamedExports` 复用一次结果）。
- 50e50f1: fix(env+check+eval): env 表不再遮蔽宿主命名空间（Math/Number/JSON/Object/Array/String/Date/Promise/BigInt——issue #87，区间透传恢复）；check 与 test/LSP 同口径 preload path 型 env（issue #89）；rewriteBareImports 支持子路径 specifier + nudojs 依赖 `@nudojs/env` + path env 导入失败发 `nudo:env-unresolved` warning（issue #88）；`??` 左值 nullish 臂过滤（`$removeNullish`，issue #90）；循环 pack/unpack 名单剔除循环体内局部词法声明（issue #91，消除 ReferenceError 误报）
- 50e50f1: fix(core): filter 元组投影保真 + assign 拓宽补全数组 sum（OSS semver L1 FP）
  
  - `filter` 空元组结果从 `unknown[]`（无界长度）改为 `[]`；不确定谓词对 ≤3 元组
    枚举精确子序列和（长度有界——filter 不增元素），更大元组保持无界 arr（sound 旧口径）
  - `widenForAssign` 补全数组 sum 分支：全 tuple/arr 成员的 sum 按 tuple 分支同口径
    拓宽为单 arr（可变绑定持数组后赋任意数组是合法 JS）；混入 obj/prim 的 sum 仍精确对账
  - 复合效果：循环 push-join 绑定（`[] | [unknown]`）重赋 `map(...).filter(...)` 不再
    假报 `nudo:assign-mismatch`（benchmark/oss 语料 semver/bin/semver.js L109，#91
    循环 pack 健全化暴露的既有失真）；元素改型等真违例仍报
  - lsp：补全面放行 path-conf 元组（filter 子集和臂成员的 length 是诚实字面量），
    sum 臂 detail 渲染去重

更早版本（26）→ [完整发布历史](./releases-history.md#pkg-core)

## @nudojs/service 1.6.3 {#pkg-service}

## 1.6.3

### Patch Changes

- 50e50f1: fix(env+check+eval): env 表不再遮蔽宿主命名空间（Math/Number/JSON/Object/Array/String/Date/Promise/BigInt——issue #87，区间透传恢复）；check 与 test/LSP 同口径 preload path 型 env（issue #89）；rewriteBareImports 支持子路径 specifier + nudojs 依赖 `@nudojs/env` + path env 导入失败发 `nudo:env-unresolved` warning（issue #88）；`??` 左值 nullish 臂过滤（`$removeNullish`，issue #90）；循环 pack/unpack 名单剔除循环体内局部词法声明（issue #91，消除 ReferenceError 误报）
- 50e50f1: fix(service): evaluator run 缓存键补齐维度与宿主 loader 透传。`tryRunEval` 缓存条目加入 `lenientGlobals` / `maxLoopIters` 命中维度，并按「入口文件 × mode」分槽——同 source 不同 lenient/迭代预算不再互命中陈旧结果，`collectCallRecords` 的 exec 采集不再踢掉同文件的 analyze 条目（`evictEvalCacheForFiles` 一并清两种 mode 槽）。宿主 `loadModule`（LSP 虚拟 FS / 侧车）现透传到模块图组装与 depKey：analyzer 一次分析内求值不再回落 `defaultLoadModule`，`tryEvalCall` / `tryEvalCallFull` 同口径接受 loader 与宿主预计算 `depKey`（复用 analyzer 一次 BFS，避免 per-fn 线性放大）。模块图组装序列（evalAbsModuleGraph → collectEnvModules → mergeHarvestUnderEnv → applyMockModule*）收敛为 `composeEvalModules` 单一入口（analyzer 与 evaluator 共用，消除一次分析内的重复 parse/eval 与两处漂移）。删除恒真死代码 `isEvalCapable`（公共导出一并移除；能力判定由转译点 fail-closed 承担）与 analyzer 中永不填充的 `unreachableRanges`/不可达 else 分支；`setEvalCallCollector` 恢复改为显式 `undefined` 判定；`defaultAbsLoadModule`/`resolveRel` 候选遍历收敛为单一 `readFirstRel`。
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
  - @nudojs/core@1.7.3
  - @nudojs/parser@1.4.0
  - @nudojs/env@0.4.18
  - @nudojs/harvester@0.3.4

更早版本（28）→ [完整发布历史](./releases-history.md#pkg-service)

## nudojs (CLI) 1.3.4 {#pkg-nudojs}

## 1.3.4

### Patch Changes

- 50e50f1: fix(env+check+eval): env 表不再遮蔽宿主命名空间（Math/Number/JSON/Object/Array/String/Date/Promise/BigInt——issue #87，区间透传恢复）；check 与 test/LSP 同口径 preload path 型 env（issue #89）；rewriteBareImports 支持子路径 specifier + nudojs 依赖 `@nudojs/env` + path env 导入失败发 `nudo:env-unresolved` warning（issue #88）；`??` 左值 nullish 臂过滤（`$removeNullish`，issue #90）；循环 pack/unpack 名单剔除循环体内局部词法声明（issue #91，消除 ReferenceError 误报）
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
  - @nudojs/core@1.7.3
  - @nudojs/service@1.6.3
  - @nudojs/parser@1.4.0
  - @nudojs/env@0.4.18
  - @nudojs/harvester@0.3.4

更早版本（25）→ [完整发布历史](./releases-history.md#pkg-nudojs)

## @nudojs/parser 1.4.0 {#pkg-parser}

## 1.4.0

### Minor Changes

- 50e50f1: feat(parser): 指令文法诊断通道收敛为显式 sink
  
  > 原变更曾以 major（2.0.0）形式发布后被整班撤回；现按团队决定以 1.4.0 minor 落地。内容含删除模块级 side-channel 旧 API（`takeDirectiveDiags` / `takeDirectiveDiagsSince` / `directiveDiagCount` / `setDirectiveDiagCollector`）——仓库内全部消费方（service / lsp / nudojs / harvester）已随本班车迁移显式通道，外部如有直接使用这些旧 API 的集成请按下述迁移。
  
  - `extractDirectives(ast, { diags })` / `extractInlineDirectives(node, { diags })`：诊断同步落调用方数组，单次调用内同文案去重；不传 `diags` 为纯查询形态（诊断丢弃，等价 `extractDirectivesQuiet`）
  - 新增 `runWithDirectiveDiags(diags, fn)`：把「extract + 复解析」（如 nudo check D1 段的 `@nudo:mock` 表达式种子复解析）包进同一去重域
  - 删除模块级缓冲与上述旧 API。迁移路径：`directiveDiagCount()` + `takeDirectiveDiagsSince(since)` 锚点对 → `extractDirectives(ast, { diags })` 直接落袋（或 `runWithDirectiveDiags` 包住 extract+复解析窗口）；`takeDirectiveDiags()` 整批排干 → 显式 `diags` 数组
  - `collectEvalReplacements(source, { diags })`（@nudojs/service，additive）：行内 `@nudo:as`/`@nudo:replace` 文法诊断显式落袋，nudojs check 的 D1 并入面行为零变更（issue code / 合并顺序 / 去重口径保持）
  - 删除动因：模块级缓冲曾引发两轮跨消费方偷诊断事故（R2B-003：全量 take 在 await 窗口偷走在途诊断）；service analyzer 与 LSP validateText 此前已迁移显式通道

### Patch Changes

- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
  - @nudojs/core@1.7.3

更早版本（25）→ [完整发布历史](./releases-history.md#pkg-parser)

## @nudojs/lsp 1.4.1 {#pkg-lsp}

## 1.4.1

### Patch Changes

- 50e50f1: fix(core): filter 元组投影保真 + assign 拓宽补全数组 sum（OSS semver L1 FP）
  
  - `filter` 空元组结果从 `unknown[]`（无界长度）改为 `[]`；不确定谓词对 ≤3 元组
    枚举精确子序列和（长度有界——filter 不增元素），更大元组保持无界 arr（sound 旧口径）
  - `widenForAssign` 补全数组 sum 分支：全 tuple/arr 成员的 sum 按 tuple 分支同口径
    拓宽为单 arr（可变绑定持数组后赋任意数组是合法 JS）；混入 obj/prim 的 sum 仍精确对账
  - 复合效果：循环 push-join 绑定（`[] | [unknown]`）重赋 `map(...).filter(...)` 不再
    假报 `nudo:assign-mismatch`（benchmark/oss 语料 semver/bin/semver.js L109，#91
    循环 pack 健全化暴露的既有失真）；元素改型等真违例仍报
  - lsp：补全面放行 path-conf 元组（filter 子集和臂成员的 length 是诚实字面量），
    sum 臂 detail 渲染去重
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
  - @nudojs/core@1.7.3
  - @nudojs/service@1.6.3
  - @nudojs/parser@1.4.0

更早版本（29）→ [完整发布历史](./releases-history.md#pkg-lsp)

## @nudojs/env 0.4.18 {#pkg-env}

## 0.4.18

### Patch Changes

- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
  - @nudojs/core@1.7.3

更早版本（25）→ [完整发布历史](./releases-history.md#pkg-env)

## @nudojs/harvester 0.3.4 {#pkg-harvester}

## 0.3.4

### Patch Changes

- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
  - @nudojs/core@1.7.3
  - @nudojs/parser@1.4.0
  - @nudojs/env@0.4.18

更早版本（25）→ [完整发布历史](./releases-history.md#pkg-harvester)

## vite-plugin-nudo 0.4.19 {#pkg-vite-plugin}

## 0.4.19

### Patch Changes

- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
- Updated dependencies [50e50f1]
  - @nudojs/core@1.7.3
  - @nudojs/service@1.6.3

更早版本（28）→ [完整发布历史](./releases-history.md#pkg-vite-plugin)

## nudo-vscode 0.3.7 {#pkg-vscode}

## Unreleased

- Settings wiring is real now: `nudo.analysis.mode` is forwarded to the language server as `initializationOptions` and re-pushed on `workspace/didChangeConfiguration` (only for `nudo.*` changes). Priority: an explicit project `package.json#nudo.analysis.mode` always wins; the VS Code setting only provides the default when the project does not set it (also stated in the setting description). `nudo.coexistence.suggestMuteTsValidation` is consumed extension-side: when false, `Nudo: Apply coexistence settings` no longer offers the tsserver mute suggestion — only the guide link.
- Case highlight decorations now parse via `@nudojs/parser` (`parse` + `extractDirectivesQuiet`, the same `@nudo:case` grammar as the server) instead of a parallel regex implementation in the extension; pure span computation lives in `src/case-decorations.ts` (unit-tested), the extension only maps spans to `vscode.Range`.
- Bundle fix: `tsup` auto-externalized `dependencies`, so `out/extension.js` shipped unresolvable `require("vscode-languageclient/node")` (and would have for the new `@nudojs/parser`) while the vsix excludes `node_modules/`. `tsup.config.ts` now bundles both into the self-contained `out/extension.js`.

更早版本（3）→ [完整发布历史](./releases-history.md#pkg-vscode)
