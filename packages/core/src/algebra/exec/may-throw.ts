/**
 * 求值引擎侧 re-export 面：定义在内核叶子 algebra/may-throw.ts。
 * （内核 arithmetic/surface 等对「可能抛」的算子记 soft 效果，原语定居
 * algebra/，内核不得 import exec/。）保留本文件：exec/runtime/*、
 * check*、internal.ts 等既有 import 路径继续经此可达。
 * may-throw collectors 归 @nudojs/core/internal（host plumbing，非 $op runtime）。
 */
export {
  $tryDigestSoft,
  $tryMarkSoft,
  $tryReleaseSoft,
  ERROR_FAMILY,
  type MayThrowEffect,
  errorTypeAbs,
  filterDeclaredThrows,
  filterGateThrows,
  filterIgnoredThrows,
  flushMayThrowEffects,
  formatThrowsAbs,
  getMayThrowCollector,
  isThrowsIgnored,
  mayThrowEffectsToAbs,
  orphanMayThrowEffects,
  popMayThrowFrame,
  pushMayThrowFrame,
  recordMayThrow,
  runWithMayThrowSession,
  setMayThrowCollector,
  throwAbsToKinds,
  throwPayloadOf,
  throwsKindCovered,
} from "../may-throw.ts";
