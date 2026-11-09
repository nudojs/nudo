/**
 * `@nudojs/service/emit` — Nudo extensional emit products.
 *
 * Contract face, TypeScript `.d.ts`, schema / Standard Schema
 * projections, runtime guards, and debug case reports. These are one-way
 * renderings of Abs (plus the `nudo contract` / `nudo export` / `nudo test`
 * product surfaces); nothing here reads a projection back into Abs.
 */

// ─── Contract（侧车 / draft / emit / derive） ──────────────
export {
  contractSurface,
  formatContractSurfaceLine,
  type ContractSurfaceEntry,
  type ContractSurfaceOpts,
} from "./contract-surface.ts";

export {
  emitContract,
  formatEmitSummary,
  type EmitContractOpts,
  type EmitContractResult,
  type EmitContractSkipReason,
} from "./contract-emitter.ts";

export {
  draftContract,
  formatDraftModule,
  formatDraftSummary,
  sidecarDraftPath,
  writeContractDraft,
  type DraftEvidence,
  type ContractDraftEntry,
  type ContractDraftOpts,
  type ContractDraftResult,
  type WriteDraftResult,
} from "./contract-draft.ts";

export {
  deriveFromRoot,
  emitDerivedFromRoot,
  formatDerivedSection,
  type ConstraintSourceExpr,
  type DerivedExport,
  type DerivedParam,
  type EmitDerivedResult,
  type RootDeriveOpts,
  type RootDeriveResult,
} from "./contract-derivation.ts";

// what-if 绑定注入仍住在 analysis 侧（../what-if.ts）；contract 面按
// `@nudojs/service/contract` 导出名再导出，避免下游断档。
export {
  injectBindings,
  typeExprToDirective,
  type TypeBinding,
} from "../what-if.ts";

// ─── DTS / Schema / Guard（外延投影，单向） ─────────────────────────
export {
  generateDts,
  generateFunctionDtsLines,
  projectFunctionDts,
  dtsModuleSurface,
  projectModuleDts,
  absToTSType,
  type DtsContractFace,
  type DtsFunctionProjection,
  type DtsModuleSurface,
  type DtsModuleProjection,
  type DtsModuleExtras,
  type DtsValueSurface,
  type DtsClassSurface,
} from "./dts-generator.ts";

export {
  absToSchemaSource,
  absToSchemaNode,
  absToZodSchemaModule,
  type SchemaDialect,
  type SchemaNode,
  type SchemaProjection,
  type SchemaRefinement,
  type ZodModuleProjection,
} from "./schema-generator.ts";

export {
  absToStandardSchemaFunction,
  type StandardSchemaFunctionSpec,
  type StandardSchemaInputEntry,
  type StandardSchemaIssue,
  type StandardSchemaModuleProjection,
  type StandardSchemaResult,
} from "./standard-schema.ts";

export { domainEvidenceCases } from "./domain-cases.ts";

export { generateGuardFunctionFromAbs } from "./guard-generator.ts";

// ─── Case（debug 见证 / CaseJson / case 注入，非接口产品） ───────────
export {
  serializeCaseJson,
  type CaseJson,
  type CaseJsonCase,
  type CaseJsonFunction,
} from "./case-json.ts";

export {
  serializeCaseArg,
  buildCaseDirective,
  stripGeneratedCaseDirectives,
  insertGeneratedCaseDirectives,
  unifiedDiff,
  type EmitSkipReason,
  type EmitResult,
  type InsertCaseOptions,
} from "./case-emitter.ts";

// ─── Quickfix 物化（#69：action-map → 文本编辑；LSP + `check --fix` 共用） ─
export {
  materializeAction,
  applyTextEdits,
  matchSidecarFnDecl,
  normPosixPath,
  resolveRelativeSpec,
  type MaterializeInput,
  type QuickfixPlan,
  type QuickfixTitleKind,
  type TextEdit,
} from "./quickfix-edits.ts";

// ─── body-read 字段类型推断（草稿 / quickfix 自动填类型） ─
export {
  collectParamBodyReadTypes,
  collectParamContracts,
  contractDslOf,
  shapeDslFromFields,
  type BodyReadField,
  type BodyReadTypes,
  type ParamContractEvidence,
  type ParamContracts,
} from "./body-read-types.ts";
