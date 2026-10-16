/**
 * 诊断码唯一注册表（P3-7）：所有 `nudo:*` 诊断码字符串的单一真理源。
 *
 * - 零依赖叶子：core 内部相对 import，跨包（parser/service/lsp/nudojs）
 *   走 `@nudojs/core/internal`——不引环、加载零成本。
 * - 拼写漂移在类型层不可表达：键不存在 → tsc 报错，新增码只能落在本表。
 * - 门禁联动：packages/website/tests/docs-coverage.test.ts 的 emittedCodes()
 *   以「本注册表 ∪ src 残留字面量」双源强制诊断术语表（en+zh）锚点——
 *   注册表里每个码都必须有 `{#nudo-<code>}` 锚点（冒号转连字符）。
 * - 非诊断码的 `nudo:*` 字符串**不进**本表：指令名（`nudo:case` 等）、
 *   控制流/Error 标记（`nudo:throw` / `nudo:return` / `nudo:loop` /
 *   `nudo:unsupported`）、Symbol 哨兵（`nudo:not-literal` / `nudo:json-omit` /
 *   `nudo:no-lit-key`）。
 */

/** 键名 = 码去掉 `nudo:` 前缀后按 `-` 分段转 camelCase。 */
export const DIAG = {
  // --- 调用点 / 约束面（check 调用诊断） ---
  argCount: "nudo:arg-count",
  argOpaque: "nudo:arg-opaque",
  argStructure: "nudo:arg-structure",
  assignMismatch: "nudo:assign-mismatch",
  constraintUnproven: "nudo:constraint-unproven",
  constraintViolated: "nudo:constraint-violated",
  fnNotFound: "nudo:fn-not-found",
  partialResult: "nudo:partial-result",
  unprovenReturn: "nudo:unproven-return",
  // --- 指令文法 / 引理前提 ---
  assumeInvalid: "nudo:assume-invalid",
  assumeRelied: "nudo:assume-relied",
  contractSyntax: "nudo:contract-syntax",
  directiveSyntax: "nudo:directive-syntax",
  invariantInvalid: "nudo:invariant-invalid",
  invariantRelied: "nudo:invariant-relied",
  mockInvalid: "nudo:mock-invalid",
  // --- case 诊断（debug/test 面） ---
  caseExpected: "nudo:case-expected",
  caseInconsistency: "nudo:case-inconsistency",
  // --- 入口 / L2 门禁 ---
  dualEntry: "nudo:dual-entry",
  entryMayThrow: "nudo:entry-may-throw",
  mayThrow: "nudo:may-throw",
  noSignature: "nudo:no-signature",
  // --- 求值精度 / 截断归因 ---
  builtinUnknown: "nudo:builtin-unknown",
  forkTruncated: "nudo:fork-truncated",
  hostEffectBlocked: "nudo:host-effect-blocked",
  loopTruncated: "nudo:loop-truncated",
  mathFoldError: "nudo:math-fold-error",
  opaqueResult: "nudo:opaque-result",
  promiseMicroError: "nudo:promise-micro-error",
  promiseMicroTruncated: "nudo:promise-micro-truncated",
  recursionTruncated: "nudo:recursion-truncated",
  unknownInference: "nudo:unknown-inference",
  unknownRecv: "nudo:unknown-recv",
  // --- 成员 / 槽位 ---
  missingSlot: "nudo:missing-slot",
  noMethod: "nudo:no-method",
  // --- 接口（sidecar / 契约面） ---
  interfaceConflict: "nudo:interface-conflict",
  interfaceCycle: "nudo:interface-cycle",
  interfaceDomainExceeds: "nudo:interface-domain-exceeds",
  interfaceDrift: "nudo:interface-drift",
  interfaceEmitDenied: "nudo:interface-emit-denied",
  interfaceEntryOnly: "nudo:interface-entry-only",
  interfaceLoad: "nudo:interface-load",
  interfaceMultiDeclarator: "nudo:interface-multi-declarator",
  interfaceNameClash: "nudo:interface-name-clash",
  interfaceNotProjectable: "nudo:interface-not-projectable",
  interfaceParamMismatch: "nudo:interface-param-mismatch",
  interfaceUnderivable: "nudo:interface-underivable",
  // --- 模块 / env 加载 ---
  envHarvestConflict: "nudo:env-harvest-conflict",
  envUnresolved: "nudo:env-unresolved",
  exportsUnresolved: "nudo:exports-unresolved",
  missingExport: "nudo:missing-export",
  moduleCycle: "nudo:module-cycle",
  moduleDepth: "nudo:module-depth",
  moduleMissing: "nudo:module-missing",
  // --- 宿主面（LSP / CLI pathErrors 信封） ---
  internal: "nudo:internal",
  pathEmptyDir: "nudo:path-empty-dir",
  pathIo: "nudo:path-io",
  pathMissingCallsite: "nudo:path-missing-callsite",
  pathNotFound: "nudo:path-not-found",
  pathNotTarget: "nudo:path-not-target",
} as const;

/** 全部诊断码字面量联合（DIAG 值的类型面）。 */
export type DiagCode = (typeof DIAG)[keyof typeof DIAG];
