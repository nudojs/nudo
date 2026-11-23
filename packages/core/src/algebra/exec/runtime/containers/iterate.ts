/**
 * 迭代协议统一入口。
 *
 * 实现已按族拆到同目录模块；本文件只保留 re-export，供既有 import 使用。
 */
export { $arrRest, $concat } from "./spread-rest.ts";
export { $tpl } from "./template-object.ts";
export { $forInKeys } from "./for-in-keys.ts";
export { $elems, $yieldStarElems, elemsOf } from "./elems.ts";
export { asyncIterabilityKind, iterabilityKind } from "./iterability.ts";
export { guardIterable } from "./iterable-guard.ts";
export {
  builtinExactIterableElems,
  iterableElementDomain,
  iterableExactElements,
  iterableExpandElements,
} from "./iterable-capability.ts";
export { $forOf } from "./for-of.ts";
export { $collectionForEach } from "./collection-foreach.ts";
export { $iterCheck } from "./iter-check.ts";
export type { UserIterReader } from "./user-iterator.ts";
