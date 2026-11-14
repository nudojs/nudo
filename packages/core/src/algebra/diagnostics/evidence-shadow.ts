/**
 * 发布门影子双读（ADR 0001 阶段 1 · 切片 4.1）。
 *
 * 目的：在**不切换判据**的前提下，把现有的「按诊断码白名单」
 * （`EXPORT_BLOCKING_CODES`）与 D2 的语义判据（`publishBlockedBy`）做对照，
 * 把 BUG-021 的缺口（非清单码的降级诊断连上屏都被丢）变成可观测清单。
 *
 * 纪律：
 * - 默认关闭；关闭时 `recordPublishGateShadow` 只做一次布尔判断，不复制
 *   诊断数组、不构造 Evidence ⇒ 发布门热路径零分配、零行为变更。
 * - **不设白名单**：分歧一律如实记录（§10 决议 4）。
 * - 复用现有诊断码（§10 决议 2）；本模块不新增任何用户可见码。
 * - 不参与求值、不进 Abs；Abs 仍是唯一类型表示。
 */
import { DIAG, type DiagCode } from "./diag-codes.ts";
import { degradedOf, publishBlockedBy } from "./evidence.ts";

export interface RawDiagnostic {
  readonly code?: string;
}

export interface PublishGateShadow {
  /** 现有按码白名单命中的诊断码。 */
  readonly byCode: readonly string[];
  /** 全部「降级证据」码（按来源分派到现有诊断码，不新增）。 */
  readonly degraded: readonly string[];
  /** degraded 但不在白名单 ⇒ 当前被 `toExportDiagnostic` 直接丢掉（BUG-021）。 */
  readonly lostByCodeFilter: readonly string[];
  /** 语义判据在「用户申报过契约」档下会返回的码。 */
  readonly semanticIfDeclared: readonly string[];
}

/** 降级证据族：与 publishBlockedBy 的 `degraded` 判据同源。 */
const DEGRADED_CODES: ReadonlySet<string> = new Set<string>([
  DIAG.contractLoad,
  DIAG.contractParamMismatch,
  DIAG.contractConflict,
  DIAG.internal,
  DIAG.unknownInference,
]);

function uniq(codes: readonly string[]): string[] {
  return [...new Set(codes)].sort();
}

export function comparePublishGates(
  sources: readonly (readonly RawDiagnostic[])[],
  blockingCodes: readonly string[],
): PublishGateShadow {
  const all: string[] = [];
  for (const source of sources) {
    for (const d of source) {
      if (typeof d.code === "string") all.push(d.code);
    }
  }
  const byCode = uniq(all.filter((c) => blockingCodes.includes(c)));
  const degraded = uniq(all.filter((c) => DEGRADED_CODES.has(c)));
  const lostByCodeFilter = uniq(degraded.filter((c) => !blockingCodes.includes(c)));
  const semanticIfDeclared = uniq(
    degraded
      .map((c) => publishBlockedBy(degradedOf<unknown>(c as DiagCode), true))
      .filter((c): c is DiagCode => c !== undefined),
  );
  return { byCode, degraded, lostByCodeFilter, semanticIfDeclared };
}

let enabled = false;
let last: PublishGateShadow | undefined;

/** 迁移期开关；`false` 时清空已记录的对照。 */
export function setPublishGateShadow(on: boolean): void {
  enabled = on;
  if (!on) last = undefined;
}

/** 消费式读取（取后清空），便于一次分析一次断言。 */
export function takePublishGateShadow(): PublishGateShadow | undefined {
  const snapshot = last;
  last = undefined;
  return snapshot;
}

/** export 发布门诊断汇总处的唯一接线点；默认关闭时零开销。 */
export function recordPublishGateShadow(
  sources: readonly (readonly RawDiagnostic[])[],
  blockingCodes: readonly string[],
): void {
  if (!enabled) return;
  last = comparePublishGates(sources, blockingCodes);
}
