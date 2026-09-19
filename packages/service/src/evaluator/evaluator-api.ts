/**
 * evaluator 公共出口。TypeValue AST 解释器（evaluator.ts）已从生产路径
 * 删除；本文件只保留仍被 service 使用的 env/config/prototype 表与 CallRecord。
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
  type NudoConfig,
  type InterfaceConfig,
  type AnalysisConfig,
  type CheckConfig,
  type AnalysisMode,
  type DiagnosticsLevel,
} from "./config.ts";

export { resolveNpmNudo } from "./resolve-npm.ts";
