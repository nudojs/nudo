export {
  type TypeValue,
  type LiteralValue,
  T,
  typeValueEquals,
  simplifyUnion,
  widenLiteral,
  isSubtypeOf,
  typeValueToString,
  narrowType,
  subtractType,
  getPrimitiveTypeOf,
  deepCloneTypeValue,
  mergeObjectProperties,
} from "./type-value.ts";

export { Ops, applyBinaryOp } from "./ops.ts";

export {
  type Environment,
  createEnvironment,
} from "./environment.ts";
