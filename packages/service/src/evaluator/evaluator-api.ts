export {
  evaluate,
  evaluateFunction,
  evaluateFunctionFull,
  evaluateProgram,
  setModuleResolver,
  setCurrentFileDir,
  resetMemo,
  getUnreachableRanges,
  resetUnreachableRanges,
  setNodeTypeCollector,
  setCallCollector,
  type CallRecord,
  setUnknownCollector,
  setProvenanceTracking,
  type UnknownRecord,
  setSampleCount,
  setMaxConcreteIter,
  setUnknownBuiltinHandler,
  setEnvModules,
  resetEnvModules,
  setMockModules,
  resetMockModules,
  setCurrentSource,
  memberMayExistOn,
  setUsageSiteTag,
  USAGE_SITE_MODULE,
} from "./evaluator.ts";

export { narrow } from "./narrowing.ts";

// 补全成员派生的唯一真值（service/analyzer、lsp-surface 经本模块取用）
export { BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS } from "./builtins/builtin-prototype.ts";

export { loadEnvs, loadEnvsAsync, preloadPathEnvs, type LoadedEnv } from "./env-loader.ts";

export { findProjectConfig, interfaceConfig, type NudoConfig, type InterfaceConfig } from "./config.ts";

export { resolveNpmNudo } from "./resolve-npm.ts";
