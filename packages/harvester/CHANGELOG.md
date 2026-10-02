# @nudojs/harvester

## 0.3.0

### Minor Changes

- 2f9717b: 仓库级正确性批次（fix-10，19 项修复 + 3 项设计缺陷修复）
  
  安全与正确性：
  - 类型表达式 AST 白名单，阻断 @nudo:case/@nudo:as RCE（P0）
  - export/绑定名统一消毒（保留字/撞名）
  - 槽位/导出表全部改自有属性读，挡 Object.prototype 成员
  
  类型系统：
  - tuple rest 槽在 leq/widen/运行时/schema/dts 全链路生效
  - x++/x-- 与 +=/-= 同源传播 term/pred/Φ 约束
  - 键通道字面量区分 -0/0（litKeyString）
  - 投影/格式出口统一 ProjectionBudget：环与超深截断可观测
  
  CLI 门禁与契约：
  - health --from 路径错误并入 pathErrors，ok↔exit 单一来源
  - migrate verify 与 health 传 skips，与 nudo check 判定同源
  - 畸形 JSDoc 指令不再静默丢弃/吞行/抛宿主异常
  - case 实参递归深度上限 32（DoS 防护）
  
  服务层：
  - 缓存上限改为显式>env>project，env 形参每次生效
  - 会话 LRU 与 BoundedLruMap 对齐（覆盖写刷新位序，max=0 读 miss）
  - 模块缓存条目携带子树内容指纹，传递失效内聚（DESIGN-002）
  - sidecar 契约身份=导出名、绑定名可别名，保留字/string 导出安全发射（DESIGN-003）
  - @nudo:import 别名查导出表用原始名，miss 出诊断
  
  解析与诊断：
  - eval 诊断补 rest/默认值/具名表达式声明与计算键引用
  - ambient 侧车反查含 .nudo.mjs，后缀集合单一事实源
  
  S2/S5/S6 跟踪批次（BUG-017–028，主会话直修）：
  - 类型推断：collectPredVars 收 assumeFinite 约束；eqLit
    通道 tagged 化（eq(x, lit(undefined)) 可投影）；
    非有限界（NaN/±Infinity）不投影；fn rest 非数组类型
    提升为 (T)[]；可选参数名保留 `?`
  - 门禁与 CLI：check --fix 保持门禁语义（残余 error
    exit 1，旗标组合 usage error）；variadic 旗标吞位置
    参数 → 定向 usage error + `--` 终止符；export 走
    PathError 面（nudo:path-* + nudo:path-io）；
    findProjectConfig 解析失败诊断 + 停步
  - 求值引擎：注入表收集异常 fail-closed（绝不半张表）；
    同名类碰撞 epoch 检测 + 回落观测；EvalCallRecord.threw
    必填 + 桥接 fail-closed（threw 省略 → throwsAbs
    unknown）；tryEvalCall 显式 isAbsVal 守卫
  - LSP / 错误面：validateText 文档 version 门（陈旧
    分析不发布）；诊断 / agent 错误 message 绝对路径
    脱敏（家目录→~、根→.）；注入装配失败上屏挡 exit
  - 观察面：standard-schema 缺键 / 显式 undefined 区分；
    dts 投影可选参数名、fn rest TS 合法性

### Patch Changes

- Updated dependencies [2f9717b]
  - @nudojs/core@1.6.0
  - @nudojs/parser@1.3.0
  - @nudojs/env@0.4.14

## 0.2.19

### Patch Changes

- Updated dependencies [64ca356]
  - @nudojs/core@1.5.0
  - @nudojs/env@0.4.13
  - @nudojs/parser@1.2.1

## 0.2.18

### Patch Changes

- f10066d: fix: repository-scale bug hunt — algebra, CLI, IDE, cache, release hardening
  
  Correctness (core algebra / check):
  - `Symbol() < 1` now TypeError (cmp relational ops); `eq`/`ne` unchanged
  - bare prim contracts reject obj/arr/tuple/fn/brand/eff returns
  - `lit(undefined)` is a real literal (`LitValueResult {ok,value}` tagged path)
  - empty-sum reduce guards (DEC-006); explicit re-exports win over `export *`
  - projection fidelity: tuple holes, tuple-rest parens, schema eq-app anchoring
  
  Design refactors (additive public API):
  - `LitValueResult` + bigint in `LiteralValue`
  - `AbsApplyResult {abs,throws}` + `callTranspiledExportApply` (sole wrap point) + `$call` throws routing
  - `directive-scan` single-source extractors; directives bind AST nearest Function (nested/class/object methods)
  - `stablePathKey` / `stablePathKeyGraph` for L0/LSP/CLI/disk path identity
  
  Product / CLI / migrate:
  - `check --json` path errors enter the CheckJson envelope (`pathErrors`, `ok:false`); ok↔exit single source
  - migrate: missing paths error (no parent `package.json` fallthrough); retire is atomic with rollback; rewritten paths are single-quoted
  - malformed directives warn instead of silent drop; `@nudo:skip` requires explicit types
  
  Service / cache:
  - disk-cache atomic write + portable path keys (incl. maxForks in cache key)
  - pure memo replays may-throw; bounded memo maps; sidecar EACCES ≠ missing
  
  IDE / extension:
  - LSP path-key unify (Windows drive forms); directive diag watermark; hover follows G2 scope
  - VS Code client catches start/sendRequest; selectCase rollback
  
  Release / CI supply chain:
  - `gen-llms` confines slug writes under build root (path-escape fix)
  - gate-major: 2.x / major jumps / first 1.0.0 need `confirm_major`; 1.x train auto-publishes
  - release: quoted secrets, tag whitelist + semver precedence incl. prerelease, pinned website actions
- Updated dependencies [f10066d]
  - @nudojs/core@1.4.0
  - @nudojs/parser@1.2.0
  - @nudojs/env@0.4.12

## 0.2.17

### Patch Changes

- Updated dependencies [8df9215]
  - @nudojs/core@1.3.1
  - @nudojs/env@0.4.11
  - @nudojs/parser@1.1.9

## 0.2.16

### Patch Changes

- Updated dependencies [6bc08c7]
- Updated dependencies [d925692]
- Updated dependencies [c717017]
  - @nudojs/core@1.3.0
  - @nudojs/env@0.4.10
  - @nudojs/parser@1.1.8

## 0.2.15

### Patch Changes

- Updated dependencies [662aeb5]
  - @nudojs/core@1.2.2
  - @nudojs/env@0.4.9
  - @nudojs/parser@1.1.7

## 0.2.14

### Patch Changes

- Updated dependencies [5494f67]
- Updated dependencies [7b8df37]
- Updated dependencies [af8cb68]
- Updated dependencies [ff37d91]
  - @nudojs/env@0.4.8
  - @nudojs/core@1.2.1
  - @nudojs/parser@1.1.6

## 0.2.13

### Patch Changes

- Updated dependencies [5ff4202]
- Updated dependencies [5ff4202]
  - @nudojs/core@1.2.0
  - @nudojs/env@0.4.7
  - @nudojs/parser@1.1.5

## 0.2.12

### Patch Changes

- Updated dependencies [634932f]
  - @nudojs/core@1.1.4
  - @nudojs/env@0.4.6
  - @nudojs/parser@1.1.4

## 0.2.11

### Patch Changes

- Updated dependencies [3bf9997]
  - @nudojs/core@1.1.3
  - @nudojs/parser@1.1.3
  - @nudojs/env@0.4.5

## 0.2.10

### Patch Changes

- Updated dependencies [c1f3e93]
  - @nudojs/core@1.1.2
  - @nudojs/env@0.4.4
  - @nudojs/parser@1.1.2

## 0.2.9

### Patch Changes

- Updated dependencies [86d1f87]
- Updated dependencies [892899d]
- Updated dependencies [faccd76]
  - @nudojs/core@1.1.1
  - @nudojs/env@0.4.3
  - @nudojs/parser@1.1.1

## 1.0.0-beta.1

### Major Changes

- 4305674: Split the `@nudojs/service` god package: harvest → `@nudojs/harvester`, IDE surface → `@nudojs/lsp`, emit products consolidated under `@nudojs/service/emit`.
  
  **BREAKING** for `@nudojs/service` subpath consumers:
  
  | Removed subpath | Migrate to |
  |---|---|
  | `@nudojs/service/interface` | `@nudojs/service/emit` |
  | `@nudojs/service/dts` | `@nudojs/service/emit` |
  | `@nudojs/service/case` | `@nudojs/service/emit` |
  | `@nudojs/service/lsp` | `@nudojs/lsp` (library entry — no server side effects) |
  | `@nudojs/service/harvest` | `@nudojs/harvester` |
  
  `@nudojs/service` keeps `.`, `./analysis`, `./evaluator`, `./emit`. The language server moves to `@nudojs/lsp/server` (bin `nudo-lsp` unchanged); `@nudojs/lsp` is now a side-effect-free library entry re-exporting the IDE surface.
  
  No dependency cycles: `lsp → service`, `harvester` stays independent of `service`. Emit is a service subpath (same package). Public function signatures and diagnostic codes are unchanged.

## 0.2.8-beta.0

### Patch Changes

- Updated dependencies [22baf33]
- Updated dependencies [0e1432a]
- Updated dependencies [3c3f9d2]
- Updated dependencies
- Updated dependencies [279d73a]
  - @nudojs/core@3.0.0-beta.0

## 0.2.7

### Patch Changes

- Updated dependencies [69ebbf6]
  - @nudojs/core@2.1.0

## 0.2.6

### Patch Changes

- Updated dependencies [9731238]
  - @nudojs/core@2.0.1

## 0.2.5

### Patch Changes

- aea83f6: **BREAKING** (fix-2: close TypeScript DX gaps):

  - **C0.1 contract model:** body-AST required-slot inference removed. `nudo:arg-structure` now means HOF argument not callable / arity mismatch only. Obligations come from explicit `*.nudo.js` / `@nudo:refine` contracts or call-site facts; no evidence → any. Migration: add a sidecar shape contract where you need structure checks.
  - **A1 analysis default:** `package.json#nudo.analysis.mode` shipped default is now `exports` (was `directives`). Files with `export` / sidecar / `@nudo:` directives are analyzed by IDE/build. Escape hatch: `"mode": "directives"` (previous silence) or `"all"` (every target path). Named-path CLI commands still analyze the named file regardless of mode.

  Release notes / policy: `docs/versioning.md`. Scope defaults: `docs/design/cli-semantics.md`.

  Feature highlights (after accepting the defaults above):

  - Core algebra: Map/Set literal tracking + fork join, loop early-return fold, catch param binding, `==`/`!=` fold, logical assignment, HOF relations, class-method sidecar keys (`Class.method` / `Class_method`, local declaration name for `export { Local as Public }`)
  - Interface product: `nudo interface --draft` (code-first contracts), enforcement tiers, CJS/default/class export forms
  - IDE: LSP buffer-aware sidecars, quickfix/code actions, validate cancel + debounce, diagnostics tiers, agent/LSP parity
  - Scale: disk CheckJson cache, analysis session memo, call-site budget, watch invalidation (sidecar/config/env)
  - dts projection quality (tsc-clean HOF/unions), vite-plugin aligned to `analysis.mode`

- Updated dependencies [aea83f6]
  - @nudojs/core@2.0.0

## 0.2.4

### Patch Changes

- Updated dependencies [61b8a6c]
  - @nudojs/core@1.0.1

## 0.2.3

### Patch Changes

- Updated dependencies [0fd253f]
- Updated dependencies [a2aac9e]
- Updated dependencies [0f0b7d5]
- Updated dependencies [de47d84]
- Updated dependencies [78f6752]
  - @nudojs/core@1.0.0

## 0.2.2

### Patch Changes

- Updated dependencies [1d6bb01]
- Updated dependencies [1d233a7]
  - @nudojs/core@0.4.0

## 0.2.1

### Patch Changes

- bee69d4: Publish built dist instead of TypeScript source: packages now ship compiled ESM + .d.ts, CLI bin gets a shebang, `nudo --version` reads the real package version, and `nudo check` accepts multiple paths.
- Updated dependencies [21427eb]
- Updated dependencies [df1726c]
- Updated dependencies [bee69d4]
- Updated dependencies [8d85d99]
  - @nudojs/core@0.3.1

## 0.2.0

### Minor Changes

- 5786fa5: Auto-inject `@types` during analysis-path harvest and guard oversized dts work.

  - Analysis can resolve package roots upward and feed harvested Abs into the B module graph.
  - `harvestDts` accepts optional `maxFileBytes` / `maxMs` and skips unreadable or oversized files instead of failing the run.

### Patch Changes

- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
  - @nudojs/core@0.3.0
