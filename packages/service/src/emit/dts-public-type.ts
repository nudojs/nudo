/**
 * dts 公共类型决议的**单点判据**（Phase 2）。
 *
 * 声明是发布契约：只要声明覆盖全部观测路径（声明 ⊇ 观测），或声明本身更窄
 * （声明 ⊂ 观测），就保留声明；不可比 / 观测更窄的冲突才让位观测。
 * `tsDeclaredReturn` 与类成员 `refineObservedReturn` 共用本模块，避免两套
 * 「declarationMorePrecise」白名单再次漂移。
 */
import { leqAbs, type Abs } from "@nudojs/core";
import type { DtsModuleSurface } from "./dts-ir.ts";
import { BUILTIN_GENERIC_BRANDS } from "./dts-type.ts";
import { isNoInfoType } from "./dts-type-text.ts";
import { annotationTypeRefs } from "./dts-annotation-text.ts";
import { splitTopLevel } from "./dts-text.ts";
import { tsAnnotationShape } from "../ts-annotation.ts";

export function declaredWins(
  declared: Abs | undefined,
  observed: Abs | undefined,
): boolean {
  if (declared === undefined) return false;
  if (observed === undefined) return true;
  // 声明覆盖观测（含等价）：消费者按声明写代码仍然成立。
  if (leqAbs(observed, declared).ok) return true;
  // 声明更窄：与既有「声明更精确」口径一致。
  return leqAbs(declared, observed).ok;
}

/** 观测串是「无信息」类型（unknown / any / 其联合）。 */
export function isNoInfoObservedType(ts: string): boolean {
  if (isNoInfoType(ts)) return true;
  const members = splitTopLevel(ts, "|").map((m) => m.trim());
  return members.length > 1 && members.some((m) => isNoInfoType(m));
}

/** 观测串是内建泛型的**占位**形态（`Map<unknown, unknown>` 等，BUG-254）。 */
const PLACEHOLDER_BUILTIN_TYPES: ReadonlySet<string> = new Set(
  BUILTIN_GENERIC_BRANDS.values(),
);
export function isPlaceholderBuiltinType(ts: string): boolean {
  const t = ts.trim();
  if (PLACEHOLDER_BUILTIN_TYPES.has(t)) return true;
  return /^(?:Readonly|Weak)?(?:Map|Set|Array|Promise|Generator|Iterator|Iterable)[A-Za-z]*<(?:unknown|object)(?:,\s*(?:unknown|object))?>$/.test(
    t,
  );
}

/** 顶层成员里是否出现 `readonly` 前缀（`readonly T[]` / `readonly [A, B]`）。 */
export function hasReadonlyTypePrefix(text: string): boolean {
  return splitTopLevel(text, "|").some((m) => /^readonly\s+/.test(m.trim()));
}

/** 声明类型文本是否函数类型（`() => number` / `(b: number) => string`）。 */
export function isFunctionTypeText(text: string): boolean {
  return tsAnnotationShape(text)?.k === "fn";
}

/**
 * BUG-245：注解引用了 **lib 全局纯类型名**（Abs 无法表达）。这些名字是声明
 * 面事实，观测（`null | [string] & {…}` / `Promise<{…}>`）只能给结构近似
 * ⇒ 返回位必须保留声明注解。
 */
const LIB_GLOBAL_TYPE_NAMES: ReadonlySet<string> = new Set([
  "IArguments",
  "CallableFunction",
  "NewableFunction",
  "RegExpMatchArray",
  "RegExpExecArray",
  "PromiseSettledResult",
  "PromiseFulfilledResult",
  "PromiseRejectedResult",
  "Disposable",
  "AsyncDisposable",
  "DisposableStack",
  "AsyncDisposableStack",
  "SuppressedError",
]);
export function hasLibGlobalTypeText(text: string): boolean {
  return annotationTypeRefs(text).some((n) => LIB_GLOBAL_TYPE_NAMES.has(n));
}

/** 联合成员里是否有**字面量类型**（`"a"` / `42` / `true` / `10n`）。 */
export function hasLiteralTypeText(text: string): boolean {
  return splitTopLevel(text, "|").some((raw) => {
    const m = raw.trim();
    return (
      /^["'`]/.test(m) ||
      /^-?(?:\d+(?:\.\d+)?|\d[\d_]*)(?:n)?$/.test(m) ||
      m === "true" ||
      m === "false"
    );
  });
}

export type DtsPublicTypeDecision = "declared" | "observed";

/**
 * 唯一决议：给定的声明文本 / Abs 与观测文本 / Abs → 发布哪一个。
 * `declaredWins` 覆盖「声明 ⊇ 观测 / 声明更窄」；其余规则是 Abs 表示缺口的
 * 声明保留条件（enum / 泛型实参 / lib 全局 / 内建占位 / readonly / 函数 /
 * 字面量 / `| undefined`）。全部规则只在本函数出现。
 */
export function resolveDtsPublicType(input: {
  declaredAbs?: Abs;
  observedAbs?: Abs;
  declaredText: string;
  observedText: string;
  surface?: DtsModuleSurface;
}): DtsPublicTypeDecision {
  const { declaredAbs, observedAbs, declaredText: raw, observedText: observed, surface } = input;
  if (declaredWins(declaredAbs, observedAbs)) return "declared";
  const bareName = raw.trim();
  const namedEnumReturn =
    /^[A-Za-z_$][\w$]*$/.test(bareName) &&
    surface?.values.get(bareName)?.kind === "enum";
  const genericRef = /^([A-Za-z_$][\w$]*)<[\s\S]+>$/.exec(bareName);
  const genericDeclMorePrecise =
    genericRef !== null &&
    (observed === genericRef[1] || observed.startsWith(`${genericRef[1]}<unknown`));
  if (
    namedEnumReturn ||
    genericDeclMorePrecise ||
    hasLibGlobalTypeText(raw) ||
    isPlaceholderBuiltinType(observed) ||
    (hasReadonlyTypePrefix(raw) && !observed.includes("readonly")) ||
    (isFunctionTypeText(raw) && /=>\s*unknown/.test(observed)) ||
    (hasLiteralTypeText(raw) && !hasLiteralTypeText(observed)) ||
    (observed.includes("| undefined") && !raw.includes("| undefined"))
  ) {
    return "declared";
  }
  return "observed";
}
