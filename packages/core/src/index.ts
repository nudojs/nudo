/**
 * @nudojs/core — 唯一类型系统。
 *
 * 内涵（algebra）：Abs = shape × term × pred × conf，类型即计算。
 * 外延（TypeValue）：评估 IR——环境绑定、dts/lsp/序列化消费的投影格式，
 * 不是平行类型系统。Abs ⇄ TypeValue 经 bridge 有损投影。
 */

// --- 评估 IR（TypeValue）---
export {
  type TypeValue,
  type LiteralValue,
  type Refinement,
  type FunctionSignature,
  type SigImpl,
  type AbsSigImpl,
  T,
  typeValueEquals,
  simplifyUnion,
  widenLiteral,
  collapseLiteralUnion,
  isSubtypeOf,
  typeValueToString,
  isFnSig,
  getFnSig,
} from "./type-value.ts";

export {
  type Environment,
  createEnvironment,
} from "./environment.ts";

export {
  createTemplate,
  isTemplate,
  getTemplateParts,
  concatTemplates,
} from "./refinements/template.ts";

export {
  createRange,
  isRange,
  getRangeMeta,
  type RangeMeta,
} from "./refinements/range.ts";

export {
  type MockHelper,
  stub,
  spy,
  mock,
} from "./mock-helpers.ts";

export { stripTypes } from "./strip-types.ts";
export {
  parseSource,
  resetParseSourceCache,
  getParseSourceCacheSize,
} from "./algebra/parse-source.ts";

// --- 内涵：类型即计算 ---
export * from "./algebra/index.ts";
