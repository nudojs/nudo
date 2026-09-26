/**
 * `@nudojs/service/emit` interface / contract face.
 *
 * Sidecar surface, interface emission, draft generation, and root-driven
 * contract derivation (the `nudo contract` product surface).
 */
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

export {
  injectBindings,
  typeExprToDirective,
  type TypeBinding,
} from "../what-if.ts";
