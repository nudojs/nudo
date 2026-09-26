/**
 * `@nudojs/service/evaluator` — host API surface（宿主接入面），不是生产求值引擎。
 *
 * 生产求值是 Abs-native B-path：`evalAbsModuleGraph` + `runTranspiled`
 * （见 `@nudojs/service/analysis` / `abs-modules-graph.ts` / `bpath-run.ts`）。
 * TypeValue AST 解释器（evaluator.ts）已从生产路径删除；本子路径只保留
 * 宿主仍需要的 env/config/prototype 表与 CallRecord。
 */
export type { CallRecord } from "./call-record.ts";

export {
  BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS,
  describeAbsMember,
  builtinProtoMember,
  builtinProtoMemberNames,
} from "./builtins/builtin-prototype.ts";

export { loadEnvs, loadEnvsAsync, preloadPathEnvs, type LoadedEnv } from "./env-loader.ts";

export {
  findProjectConfig,
  interfaceConfig,
  analysisConfig,
  checkConfig,
  diskCacheRoot,
  matchesEmitAllowlist,
  type NudoConfig,
  type InterfaceConfig,
  type AnalysisConfig,
  type CheckConfig,
  type AnalysisMode,
  type DiagnosticsLevel,
} from "./config.ts";

export { resolveNpmNudo } from "./resolve-npm.ts";
