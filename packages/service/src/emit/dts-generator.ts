/**
 * dts 生成器的稳定入口（兼容内部测试与既有 import）。
 *
 * 实现已按职责拆到：
 * - `dts-root.ts`：AnalysisResult → dts / 模块投影 wrapper
 * - `dts-function-emit.ts`：函数声明发射
 * - `dts-signature.ts`：主签名 / HOF / 契约证据
 * - `dts-surface-module.ts`：模块面扫描
 * - `dts-module-assembly.ts`：模块声明组装
 *
 * 新代码应直接引用上述模块；本文件只保留 re-export。
 */
export {
  generateDts,
  projectModuleDts,
  type DtsModuleExtras,
  type DtsModuleProjection,
} from "./dts-root.ts";
export {
  generateFunctionDtsLines,
  projectFunctionDts,
} from "./dts-function-emit.ts";
export { dtsModuleSurface } from "./dts-surface-module.ts";
export type {
  DtsContractFace,
  DtsFunctionProjection,
  DtsProjectionCtx,
  MainSignature,
} from "./dts-signature.ts";
