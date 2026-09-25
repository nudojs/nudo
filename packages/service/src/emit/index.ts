/**
 * `@nudojs/service/emit` — Nudo extensional emit products.
 *
 * Interface / contract face, TypeScript `.d.ts`, schema / Standard Schema
 * projections, runtime guards, and debug case reports. These are one-way
 * renderings of Abs (plus the `nudo contract` / `nudo export` / `nudo test`
 * product surfaces); nothing here reads a projection back into Abs.
 */

// ─── Interface（contract 侧车 / draft / emit / derive） ──────────────
export {
  interfaceSurface,
  formatInterfaceSurfaceLine,
  type InterfaceSurfaceEntry,
  type InterfaceSurfaceOpts,
} from "./interface-surface.ts";

export {
  emitInterface,
  formatEmitSummary,
  type EmitInterfaceOpts,
  type EmitInterfaceResult,
  type EmitInterfaceSkipReason,
} from "./interface-emitter.ts";

export {
  draftInterface,
  formatDraftModule,
  formatDraftSummary,
  sidecarDraftPath,
  writeInterfaceDraft,
  collectParamBodyAccesses,
  isDraftableEntry,
  type DraftEvidence,
  type InterfaceDraftEntry,
  type InterfaceDraftOpts,
  type InterfaceDraftResult,
  type WriteDraftResult,
} from "./interface-draft.ts";

export {
  deriveFromRoot,
  emitDerivedFromRoot,
  extractFnConstraintSources,
  formatDerivedSection,
  type ConstraintSourceExpr,
  type DerivedExport,
  type DerivedParam,
  type EmitDerivedResult,
  type RootDeriveOpts,
  type RootDeriveResult,
} from "./interface-derivation.ts";

// what-if 绑定注入仍住在 analysis 侧（../what-if.ts）；interface 面按
// 原 `@nudojs/service/interface` 导出名再导出，避免下游断档。
export {
  injectBindings,
  typeExprToDirective,
  type TypeBinding,
} from "../what-if.ts";

// ─── DTS / Schema / Guard（外延投影，单向） ─────────────────────────
export {
  generateDts,
  generateFunctionDtsLines,
  absToTSType,
} from "./dts-generator.ts";

export {
  absToSchemaSource,
  absToSchemaNode,
  constraintToSchemaNode,
  projectAbsToSchema,
  schemaNodeToZod,
  type SchemaDialect,
  type SchemaNode,
  type SchemaProjection,
  type SchemaRefinement,
} from "./schema-generator.ts";

export {
  absToStandardSchema,
  absToStandardSchemaModule,
  validateSchemaNode,
  type StandardSchemaIssue,
  type StandardSchemaModuleProjection,
  type StandardSchemaResult,
} from "./standard-schema.ts";

export {
  generateGuardFunction,
  generateGuardFunctionFromAbs,
} from "./guard-generator.ts";

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
} from "./case-emitter.ts";
