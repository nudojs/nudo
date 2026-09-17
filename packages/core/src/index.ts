/**
 * @nudojs/core — 唯一类型系统。
 *
 * 内涵（algebra）：Abs = shape × term × pred × conf，类型即计算。
 */

export {
  type Environment,
  createEnvironment,
} from "./environment.ts";

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
