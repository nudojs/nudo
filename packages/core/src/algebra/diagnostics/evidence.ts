/**
 * Evidence<T> —— ADR 0001 阶段 0 骨架（core/algebra/diagnostics）。
 *
 * 把「公开类型/签名的来源」与「推断失败」编码进类型：
 *   declared（用户申报） > join(observed)（多路径观测） > degraded（失败）。
 * `unknown` 只能由 degraded 产生，**没有「→ any」的构造子** —— fail-closed
 * 由类型保证，不再依赖 review 或按码白名单（ADR §10 决议 2）。
 *
 * 本模块是分析期包装类型，**不是 Abs 的新槽位**，不参与 `leqAbs` /
 * `formatShape` / 求值；Abs 仍是唯一类型表示（CLAUDE.md:9）。
 * 阶段 0 零行为变更：不接任何产品面，仅由单元测试消费。
 */
import { DIAG, type DiagCode } from "./diag-codes.ts";
import type { SymbolId } from "../scan/semantic-index.ts";

export type Evidence<T> =
  | { readonly kind: "declared"; readonly value: T; readonly from: "annotation" | "contract" }
  | { readonly kind: "observed"; readonly value: T; readonly paths: number }
  | { readonly kind: "degraded"; readonly reason: DiagCode };

/** 公共产物（dts / zod / standard）的键名；内部求值占位名不得流入。 */
export type PublicName = string & { readonly __brand: "PublicName" };
export type InternalName = string & { readonly __brand: "InternalName" };

/** 模块形态一等化：CJS `export =` 不再是「从不发射」的缺口（BUG-008）。 */
export type ModuleForm =
  | { readonly kind: "esm" }
  | { readonly kind: "cjs"; readonly exportEquals: SymbolId | null };

export function declaredOf<T>(value: T, from: "annotation" | "contract"): Evidence<T> {
  return { kind: "declared", value, from };
}

export function observedOf<T>(value: T, paths = 1): Evidence<T> {
  return { kind: "observed", value, paths };
}

export function degradedOf<T = never>(reason: DiagCode): Evidence<T> {
  return { kind: "degraded", reason };
}

/**
 * 唯一优先级格（ADR §4 D2）。observed 多路时用调用方提供的 `join` 合并，
 * 避免「取单次内部构造点观测值」把公开类型钉死（BUG-007）。
 */
export function resolvePublicType<T>(
  sources: readonly Evidence<T>[],
  join: (a: T, b: T) => T,
): Evidence<T> {
  for (const s of sources) if (s.kind === "declared") return s;
  const observed: Array<Extract<Evidence<T>, { readonly kind: "observed" }>> = [];
  for (const s of sources) if (s.kind === "observed") observed.push(s);
  if (observed.length > 0) {
    const first = observed[0]!;
    let value = first.value;
    let paths = first.paths;
    for (let i = 1; i < observed.length; i++) {
      const next = observed[i]!;
      value = join(value, next.value);
      paths += next.paths;
    }
    return { kind: "observed", value, paths };
  }
  for (const s of sources) if (s.kind === "degraded") return s;
  return { kind: "degraded", reason: DIAG.unknownInference };
}

/** `_p0` / `_p0_1`：解构形参的求值占位（tmp-names.ts），禁止成为公共键。 */
const PLACEHOLDER = /^_p\d+(?:_\d+)?$/;

export function isPlaceholder(name: string): boolean {
  return PLACEHOLDER.test(name);
}

export function publicName(name: string): PublicName {
  if (isPlaceholder(name)) {
    throw new Error(`internal placeholder "${name}" cannot be used as a public name`);
  }
  return name as PublicName;
}

export function internalName(name: string): InternalName {
  return name as InternalName;
}

/**
 * 发布门语义判据（ADR §10 决议 2 / BUG-021）：不按诊断码枚举，而是「公开面
 * 存在 degraded **且** 用户申报过契约 ⇒ 阻断并上屏」，返回可用于上屏的码。
 */
export function publishBlockedBy(
  evidence: Evidence<unknown>,
  hasDeclaredContract: boolean,
): DiagCode | undefined {
  if (evidence.kind === "degraded" && hasDeclaredContract) return evidence.reason;
  return undefined;
}
