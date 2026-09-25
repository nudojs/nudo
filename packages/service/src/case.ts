/**
 * `@nudojs/service/case` — debug case face (`nudo test` / CaseJson).
 *
 * `@nudo:case` is debug / test / LSP scenario only — not the interface
 * product. This subpath serializes case reports and emits generated case
 * directives.
 */
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
