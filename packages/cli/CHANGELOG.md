# nudo

## 2.0.1

### Patch Changes

- Updated dependencies [9731238]
  - @nudojs/core@2.0.1
  - @nudojs/env@0.4.0
  - @nudojs/service@3.0.0
  - @nudojs/harvester@0.2.6
  - @nudojs/parser@0.5.1

## 2.0.0

### Major Changes

- aea83f6: **BREAKING** (fix-2: close TypeScript DX gaps):

  - **C0.1 contract model:** body-AST required-slot inference removed. `nudo:arg-structure` now means HOF argument not callable / arity mismatch only. Obligations come from explicit `*.nudo.js` / `@nudo:refine` contracts or call-site facts; no evidence → any. Migration: add a sidecar shape contract where you need structure checks.
  - **A1 analysis default:** `package.json#nudo.analysis.mode` shipped default is now `exports` (was `directives`). Files with `export` / sidecar / `@nudo:` directives are analyzed by IDE/build. Escape hatch: `"mode": "directives"` (previous silence) or `"all"` (every target path). Named-path CLI commands still analyze the named file regardless of mode.

  Release notes / policy: `docs/versioning.md`. Scope defaults: `docs/design-analysis-scope.md`.

  Feature highlights (after accepting the defaults above):

  - Core algebra: Map/Set literal tracking + fork join, loop early-return fold, catch param binding, `==`/`!=` fold, logical assignment, HOF relations, class-method sidecar keys (`Class.method` / `Class_method`, local declaration name for `export { Local as Public }`)
  - Interface product: `nudo interface --draft` (code-first contracts), enforcement tiers, CJS/default/class export forms
  - IDE: LSP buffer-aware sidecars, quickfix/code actions, validate cancel + debounce, diagnostics tiers, agent/LSP parity
  - Scale: disk CheckJson cache, analysis session memo, call-site budget, watch invalidation (sidecar/config/env)
  - dts projection quality (tsc-clean HOF/unions), vite-plugin aligned to `analysis.mode`

### Patch Changes

- Updated dependencies [aea83f6]
  - @nudojs/core@2.0.0
  - @nudojs/service@2.0.0
  - @nudojs/parser@0.5.0
  - @nudojs/env@0.3.0
  - @nudojs/harvester@0.2.5

## 1.0.1

### Patch Changes

- Updated dependencies [61b8a6c]
  - @nudojs/core@1.0.1
  - @nudojs/env@0.2.5
  - @nudojs/harvester@0.2.4
  - @nudojs/parser@0.4.2
  - @nudojs/service@1.0.1

## 1.0.0

### Major Changes

- 0fd253f: **BREAKING**: `@nudojs/cli/evaluator` 子路径已移除。求值器 API 迁至 `@nudojs/service/evaluator`（消除 cli↔service 工作区环）。迁移：`import { … } from "@nudojs/cli/evaluator"` → `import { … } from "@nudojs/service/evaluator"`。

  架构与正确性批次：

  **正确性修复（core）**

  - `slots[key]` 原型链泄漏：`__proto__`/`toString`/`valueOf` 等键命中 Object.prototype 导致引擎崩溃或误报——新增 `getSlot` 守卫并接入 projectBrand / 静态与计算成员访问 / leq / check 五处读取点（eventemitter3 真实包上曾崩溃）
  - `Array.from` 语义修正：与 `Array.of` 混用导致 `Array.from(new Set(arr))` 误报 `Set[]`；现按元素分布（tuple→ 元素 join、string→string[]），未建模可迭代物诚实返回 unknown
  - 模板 `endsWith` 不健全判定修正：误报 false 的分支改为共享的健全 `decideEndsWith`
  - `nudo:assign-mismatch` 精度：分支/循环体内的可变绑定重赋值（特性检测模式）不再误报；无条件标量改型仍报（金标行为保持）
  - `nudo:arg-structure` 精度：`x && x.__esModule && x.default` 守卫后的成员访问不再计为必填 slot

  **结构拆分（无行为变化）**

  - check.ts 2024→748 行：源码级调用图侦察拆至 algebra/scan.ts；AstEnv 类型下沉 ast-env.ts（消 5 处巨石 type-import 环）
  - evaluator.ts 5164→4058 行：内置方法语义迁至 builtins/builtin-methods.ts；analyzer.ts LSP 表面拆至 service/lsp-surface.ts
  - 模板字符串语义归一：refinements/template.ts 七处重复实现改为委托 algebra/template.ts（单一真理源）
  - 容器策略单源：ast-eval 与 B 路径 runtime 共享 containers.ts（>8 元素字面量降级策略一致，B 路径 $concat 修正嵌套近似）
  - 求值器域从 @nudojs/cli 迁至 @nudojs/service/evaluator（消除 cli↔service 工作区环；`@nudojs/cli/evaluator` 子路径移除，改用 `@nudojs/service/evaluator`）
  - 真实包门禁加固：扫描失败/0 文件即红，不再静默 skip；fixture 包显式声明为 core devDependencies

### Minor Changes

- 0f0b7d5: **Feature**: Interface 分层推导 Phase 1（design-refine-derivation.md）

  - 侧车同名自动绑定：`foo.nudo.js` 导出绑定 `foo.js` 本地 named export；手写 > `@generated` > 隐式合并序
  - 约束代数：`lit` / `union` / `fn` / `shift` / `and` / `partial` / `pick` / `omit`
  - Abs→ 契约投影与字面量域隶属（domain-membership）
  - 新诊断：`nudo:interface-drift` / `interface-domain-exceeds` / `interface-conflict` / `interface-cycle` / `interface-load` / `interface-name-clash`
  - CLI：`nudo interface`（别名 `refine`）分层打印；`--emit` / `--fn` / `--all` / `--dry-run` / `--exit-on-diff` / `--callsites`；`nudo check --callsites`
  - 配置：`package.json#nudo.interface.autoBind`（默认 true；node_modules 永不 ambient 加载）
  - LSP：CodeLens interface 默认层 + persist/update；agent 工具 `nudo.interface` / `nudo.interface.emit`（emit 路径限制在项目根内）
  - 新薄壳包 `nudo`（`bin` 委托 `@nudojs/cli`）

### Patch Changes

- de47d84: Review fixes on feat/interface Phase 1:

  - **autoBind kill-switch**: analyzer's cross-file `nudo:interface-domain-exceeds` path now reads `package.json#nudo.interface.autoBind` (was silently ambient-loading sidecars when `autoBind: false`).
  - **`nudo check --callsites`**: inject usage-site call records so CI gate can surface `nudo:interface-domain-exceeds` (previously only reachable via analyze/interface paths).
  - **Sidecar auto-bind coverage**: `localNamedExports` accepts local `export { x }` / `export { local as exported }` list form (was declaration-only; silent miss for common style).
  - **Directory targets**: `isNudoTargetPath` excludes `*.nudo.js` / `*.nudo.ts` so check/infer/doctor no longer treat contract modules as source.
  - **VS Code client**: documentSelector includes TypeScript; file watcher covers `**/*.{js,mjs,ts}` (includes `.nudo.ts` sidecars).
  - **LSP emit**: failed `interfaceEmit` no longer claims "sidecar written" and skips the invalidation path.
  - **UX**: first `--emit` with empty default targets prints a `--fn`/`--all` tip; `--fn`/`--all` without `--emit` warn; CodeLens titles use "interface" not "refine"; domain-exceeds message is English (matches other diagnostics).

- Updated dependencies [0fd253f]
- Updated dependencies [a2aac9e]
- Updated dependencies [0f0b7d5]
- Updated dependencies [de47d84]
- Updated dependencies [78f6752]
  - @nudojs/core@1.0.0
  - @nudojs/service@1.0.0
  - @nudojs/env@0.2.4
  - @nudojs/harvester@0.2.3
  - @nudojs/parser@0.4.1

## 0.4.0

### Minor Changes

- 1d6bb01: dist 产物自包含：`@nudojs/*` 依赖经 tsconfig paths 指向兄弟源码并被 noExternal 打进 bundle（splitting:false，单文件 bin）。此前 dist 仍 external 引用 `.ts` 源码依赖，Node 的类型剥离拒绝 node_modules 下的 `.ts`，导致安装后的 CLI 无法运行（需要消费者把源码复制出 node_modules 的 workaround）。新增 tsconfig.build.json（rootDir 拓宽以容纳 paths 映射的源码）；banner 补齐 `__filename`/`__dirname`（修复内联 CJS 依赖如 typescript/debug 的 ESM 互操作崩溃）。

### Patch Changes

- Updated dependencies [1d6bb01]
- Updated dependencies [1d6bb01]
- Updated dependencies [1d233a7]
  - @nudojs/core@0.4.0
  - @nudojs/parser@0.4.0
  - @nudojs/service@0.3.2
  - @nudojs/env@0.2.3
  - @nudojs/harvester@0.2.2

## 0.3.1

### Patch Changes

- bee69d4: Publish built dist instead of TypeScript source: packages now ship compiled ESM + .d.ts, CLI bin gets a shebang, `nudo --version` reads the real package version, and `nudo check` accepts multiple paths.
- Updated dependencies [21427eb]
- Updated dependencies [df1726c]
- Updated dependencies [bee69d4]
- Updated dependencies [8d85d99]
  - @nudojs/core@0.3.1
  - @nudojs/env@0.2.2
  - @nudojs/service@0.3.1
  - @nudojs/parser@0.3.1
  - @nudojs/harvester@0.2.1

## 0.3.0

### Minor Changes

- 5786fa5: Promote the B-path (transpile + in-process Abs runtime) to the primary evaluation path for capable sources.

  - Module graph now supports relative imports, bare-package harvest, default/namespace imports, re-exports, `export *`, require, cycle/depth/missing guards, and env modules (`path` / `node:path` etc.).
  - Diagnostics, `@nudo:env` / mock injection, `call@` / `entry@` provenance, method-missing, unknown-recv, generators, classes, async/await, optional chaining, and destructuring run through B.
  - When B hosts a file, `evaluateProgram` is skipped so TypeValue no longer double-reports.
  - CLI `check` / `types` / `test` accept directories; check uses an Abs-only gate.
  - LSP hover / `getTypeAtPosition` on capable files read the Abs node table; `*.nudo.js` edits evict L0 and recheck open parents.
  - Public core surface now re-exports the algebra API (`Abs`, check, generalize, exec, bridge, `parseSource`, `stripTypes`).

- 5786fa5: Speed up repeated analysis with layered memos and tighter cache contracts.

  - Shared parse/AST LRU, `generalizeFromAst` L0–L3 (instantiate, α-equivalence, dep fingerprint + LRU), Abs module cache, and session-wide memos with an incremental after-edit path.
  - Host cache-eviction contract, AST/function-fingerprint memory caps, conservative call-scan depth cap, and fail-open truncated dependency fingerprints.
  - Fix session-memo staleness and identity holes so after-edit results stay correct.

### Patch Changes

- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
- Updated dependencies [5786fa5]
  - @nudojs/core@0.3.0
  - @nudojs/service@0.3.0
  - @nudojs/harvester@0.2.0
  - @nudojs/parser@0.3.0
  - @nudojs/env@0.2.1

## 0.2.1

### Patch Changes

- 0fd0718: Merge the three environment packages into one: `@nudojs/env-es`, `@nudojs/env-web`, `@nudojs/env-node` are replaced by a single `@nudojs/env` package with subpath exports `@nudojs/env/es`, `@nudojs/env/web`, `@nudojs/env/node`.

  Move agent-facing tools from the standalone MCP server into the language server: `@nudojs/mcp` is removed. `@nudojs/lsp` now exposes `nudo.whatIf`, `nudo.suggestCase`, `nudo.trace`, `nudo.selectCase`, and `nudo.getActiveCases` via `workspace/executeCommand` (custom-request aliases `nudo/whatIf` etc. included), adds pull-mode diagnostics, and works on files that are not open in the editor (disk fallback). `nudo.whatIf` now actually applies the given type bindings — previously they were ignored. AI agents connect through any LSP↔MCP bridge (cclsp, mcpls, agent-lsp) or a native LSP client; an installable agent skill ships at `packages/lsp/agent-skill/SKILL.md`.

- Updated dependencies [0fd0718]
  - @nudojs/env@0.2.0
  - @nudojs/service@0.2.1

## 0.2.0

### Minor Changes

- 6c38283: docs and ci
- 9f7f819: fix pkg info
- c175f71: version

### Patch Changes

- Updated dependencies [6c38283]
- Updated dependencies [9f7f819]
- Updated dependencies [c175f71]
  - @nudojs/core@0.2.0
  - @nudojs/parser@0.2.0

## 0.1.0

### Minor Changes

- Conceptual design and basic implementation.

### Patch Changes

- Updated dependencies
  - @nudojs/core@0.1.0
  - @nudojs/parser@0.1.0
