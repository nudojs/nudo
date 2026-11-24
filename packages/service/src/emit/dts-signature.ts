/**
 * dts 主签名 / HOF / 契约证据 / 参数位渲染。
 *
 * 从 dts-generator 抽出。只负责“签名如何定型”，不负责 JSDoc 与声明胶水；
 * 返回位 IR 渲染仍走 dts-context 的同一入口。
 */
import type { Abs, LiteralValue, Pred, Term } from "@nudojs/core";
import {
  abs as makeAbs,
  anyAbs,
  collectAbsFreeVars,
  joinAbs,
  leqAbs,
  litValue,
  substAbs,
  termEquals,
} from "@nudojs/core";
import { absTypeForTsTypeText, isJsBindingIdent } from "@nudojs/core/internal";
import type { AnalysisResult, CaseResult, FunctionAnalysis } from "../analyzer.ts";
import { absToTSTypeIr } from "./dts-context.ts";
import { BUILTIN_GENERIC_BRANDS } from "./dts-type.ts";
import {
  TS_TYPE_TOKENS,
  annotationTypeRefs,
  isTypeRefResolvable,
  typeofValueRefs,
} from "./dts-annotation-text.ts";
import {
  dtsReturnWidenOf,
  renderDtsParams,
  type DtsParam,
  type DtsReturnWiden,
} from "./dts-ir.ts";
import {
  isArrayTypeText,
  sanitizeParamName,
  splitTopLevel,
  typeParamNamesInClause,
} from "./dts-text.ts";
import {
  widenParamAbs,
  widenReturnAbs,
  widenTopLevelAbs,
} from "./dts-widen.ts";
import { isNoInfoType } from "./dts-type-text.ts";
import { domainEvidenceCases } from "./domain-cases.ts";
import { tsAnnotationShape, tsAnnotationTypeText } from "../ts-annotation.ts";
import type { DtsModuleSurface } from "./dts-ir.ts";

/** α / B:param → TS 类型参数名（`B:transform` → `B_transform`）。 */
function tsTypeParamName(id: string): string {
  let n = id.replace(/[^A-Za-z0-9_$]/g, "_");
  if (!/^[A-Za-z_$]/.test(n)) n = `T_${n}`;
  if (n.length === 0) n = "T";
  return n;
}

/** case 在参数位 i 的 Abs */
function caseArgAbs(c: CaseResult, i: number): Abs | undefined {
  return c.argAbs[i];
}

/** case 结果 Abs */
function caseResultAbs(c: CaseResult): Abs {
  return c.abs;
}

export function predLiteralSet(p: Pred | undefined, self: Term): LiteralValue[] | undefined {
  if (p === undefined) return undefined;
  switch (p.op) {
    case "eq": {
      const { a: x, b: y } = p;
      const litT =
        x.op === "lit" && termEquals(y, self)
          ? x
          : y.op === "lit" && termEquals(x, self)
            ? y
            : undefined;
      return litT === undefined ? undefined : [litT.value];
    }
    case "and": {
      const found: LiteralValue[] = [];
      for (const arg of p.args) {
        if (arg.op !== "eq") continue;
        const s = predLiteralSet(arg, self);
        if (s === undefined) continue;
        found.push(...s);
      }
      if (found.length === 0) return undefined;
      const first = found[0]!;
      if (!found.every((v) => Object.is(v, first))) return undefined;
      return [first];
    }
    case "or": {
      const out: LiteralValue[] = [];
      for (const arg of p.args) {
        const s = predLiteralSet(arg, self);
        if (s === undefined) return undefined;
        out.push(...s);
      }
      return out.length > 0 ? out : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * 「无信息」类型串：Abs `any`（未约束）与 Abs `unknown`（推断失败）在
 * nudo 域里是两个概念，但 TS 投影面归一后都渲染成 `unknown`；源码注解
 * 原文仍可能是 `any` ⇒ 两者都算「不携带外延」，不能当作更精确的证据。
 */


/**
 * BUG-176：观测**联合**里含 `unknown` / `any` 成员时整串无信息。
 *
 * TS 里 `unknown` / `any` 吸收联合的其它成员（`unknown | number` ≡ `unknown`，
 * `any | string` ≡ `any`）⇒ 声明返回注解仍是唯一可用的证据。旧的 `isNoInfoType`
 * 只认整串等于 `unknown`/`any`，`hasMethod` 的观测串 `unknown | number` 因此
 * 挡住了声明注解 `: number`（产物返回位比 tsc 宽）。
 */
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

/** JS 字面量值 → TS 类型字面量（`42` / `"s"` / `true` / `null` / `undefined`） */
export function tsLiteralType(v: LiteralValue): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  switch (typeof v) {
    case "string":
      return JSON.stringify(v);
    case "boolean":
      return String(v);
    case "number":
      // NaN / ±Infinity 不是 TS 类型名 → 基类型
      return Number.isFinite(v) ? String(v) : "number";
    case "bigint":
      return `${String(v)}n`;
    default:
      return "unknown";
  }
}

/**
 * **契约返回位** → TS 类型串（Bug 520：保形，不 widen 顶层字面量）。
 *
 * 手写契约的返回域是**声明级证据**（用户申报的返回域，权威）⇒ 与 zod
 * （`z.literal(42)`）/ standard（`{"k":"lit","value":42}`）/ check 签名
 * （`=> 42`）三面同口径保形：`lit(42)` → `42`。
 *
 * 观测返回位（case 观测 / combined）沿用调用面 widen 口径（顶层字面量 →
 * 基类型）——那条路径的 widen 是**有意为之**（.d.ts 是调用面而非 case 台账）。
 */
/**
 * 契约位（形参 / 返回）的**字面量域** → TS 类型串；非字面量域 → undefined。
 *
 * 手写契约的 `lit(42)` 在 Abs 里是「prim + eq(self, lit(42)) pred」（字面量
 * 在 **pred** 里，term 是参数项）⇒ 只看 term / shape 的 widen 路径永远看不到
 * 它（`lit(42)` → `number`）。契约面是**声明级证据**（用户申报的调用域，
 * 权威）⇒ 形参位与返回位同口径保形（Bug 348：形参位此前不接这条 ⇒ dts 面
 * 对「x 必须是字面量 1」零表达，而 zod / standard 面都当真 ⇒ 双门禁对撞）。
 *
 * Bug 027：**union 臂逐成员取字面量集后合并**（与 zod 面同源——zod 遍历
 * `c.members`，dts 此前**只读顶层 pred**）：
 * - 同 prim 字面量 union（`union(lit(0), lit(1))`）在 Abs 面上被特化成
 *   「prim 臂 + or(eq…) 谓词」⇒ 顶层 pred 就是析取 ⇒ 本就保形 ✓；
 * - **非同 prim** 字面量 union（`union(lit(1), lit("x"))`）落成 **sum 形状**
 *   ⇒ 字面量挂在**各成员自己的** pred 上、顶层 pred 为空 ⇒ 此前取不到
 *   ⇒ **拓宽**成 `number | string` ⇒ 发布的 .d.ts **允许契约违约的调用**
 *   （`pick(99)` 编译通过、运行时被 nudo 门禁判违约 ⇒ 双门禁对撞）。
 */
export function contractLiteralTSType(a: Abs): string | undefined {
  // sum 臂（union 的 entry Abs）：逐成员取字面量集 → 合并（成员里有一个不是
  // 字面量域 ⇒ 整条不是字面量域 ⇒ undefined ⇒ 回落 widen 口径）。
  if (a.shape.k === "sum") {
    const members = (a.shape as { members: Abs[] }).members;
    const parts: string[] = [];
    for (const m of members) {
      const s = contractLiteralTSType(m);
      if (s === undefined) return undefined;
      parts.push(s);
    }
    const uniq = [...new Set(parts)];
    if (uniq.length === 0) return undefined;
    return uniq.length === 1 ? uniq[0]! : uniq.join(" | ");
  }
  if (a.term === undefined) return undefined;
  const set = predLiteralSet(a.pred, a.term);
  if (set === undefined || set.length === 0) {
    // **nullish** 字面量在 **term** 里（`lit(null)` / `lit(undefined)` 的 Abs
    // 形态：term 就是字面量本身，pred 锚在参数项上）⇒ 取 term 的字面量值。
    // 非 nullish 的 lit term 不在此列（观测面 / 契约面的标量字面量走 pred 或
    // widen 口径——不得把它当成「契约声明的字面量域」）。
    if (a.term.op === "lit" && (a.term.value === null || a.term.value === undefined)) {
      return tsLiteralType(a.term.value);
    }
    return undefined;
  }
  const parts = [...new Set(set.map(tsLiteralType))];
  if (parts.length === 1) return parts[0]!;
  return parts.join(" | ");
}

/**
 * BUG-180：契约 `any()` 槽 → TS `any`。
 *
 * `constraintToEntryAbs(any(), name)` 的形态是 `shape any + term var(<槽名>)`
 * （值槽锚）。旧实现把它当类型变量印出槽名（并因「名字可达」发明
 * `<v, return2>` 子句）⇒ 消费方读 `unknown`。`any()` 是用户申报的**无约束
 * 域**，投影面等价于 TS `any`（与 `nudo check` 的 `(v: any) => any` 同域）。
 *
 * 真正的类型绑定是 `bind:<name>`（`binderTerm`）/ HOF 变元（`B:param`）——
 * 它们不受此规则影响，仍按类型形参投影。
 */
export function contractAnyTSType(a: Abs): string | undefined {
  if (a.shape.k !== "any" || a.term?.op !== "var") return undefined;
  if (a.term.id.startsWith("bind:") || a.term.id.startsWith("B:")) return undefined;
  return "any";
}

export function contractReturnTSType(a: Abs, typeVars?: Map<string, string>): string {
  return (
    contractAnyTSType(a) ??
    contractLiteralTSType(a) ??
    absToTSTypeIr(widenTopLevelAbs(a), typeVars)
  );
}

export function restParamType(
  widened: Abs,
  isRest: boolean,
  typeVars?: Map<string, string>,
): string {
  if (!isRest) return absToTSTypeIr(widened, typeVars);
  if (widened.shape.k === "arr") return absToTSTypeIr(widened, typeVars);
  const ts = absToTSTypeIr(widened, typeVars);
  return widened.shape.k === "sum" || widened.shape.k === "fn" ? `(${ts})[]` : `${ts}[]`;
}

/** 同参数位多 case 的 Abs join + 逆变 widen → TS 串（rest 位提升为数组类型） */
export function paramTypeFromAbs(members: Abs[], isRest = false): string {
  if (members.length === 0) return isRest ? "unknown[]" : "unknown";
  let joined: Abs;
  try {
    joined = members.reduce((a, b) => joinAbs(a, b));
  } catch {
    joined = members[0]!;
  }
  return restParamType(widenParamAbs(joined), isRest);
}

/** 返回位 Abs：combinedAbs 优先，否则 join case 结果 Abs */
export function returnAbsOf(fn: FunctionAnalysis): Abs | undefined {
  if (fn.combinedAbs) return fn.combinedAbs;
  const results = fn.cases.map(caseResultAbs);
  if (results.length > 0) {
    try {
      return results.reduce((a, b) => joinAbs(a, b));
    } catch {
      /* fall through */
    }
    return results[0];
  }
  return undefined;
}

export function getParamName(fn: FunctionAnalysis, index: number): string {
  if (fn.paramNames && fn.paramNames[index]) {
    return fn.paramNames[index];
  }
  return `arg${index}`;
}

/**
 * Bug 479：形参位上的 **TS 声明注解**（`.ts` 源）→ dts 类型串。
 *
 * 声明位证据优先级（自高而低，见 `computeMainSignature`）：
 * 手写契约（sidecar / @nudo:contract）> TS 声明注解 > case-widen（观测值）。
 *
 * 不可放行 ⇒ undefined（调用方回落既有 case-widen）：
 * - 无注解（`.js` 源 / 未标注）；
 * - 注解含注释记号或换行（会破坏 .d.ts 文本结构）；
 * - rest 位的注解不是数组类型（TS 硬规则：A rest parameter must be of an
 *   array type）——放行会产出不可编译的 .d.ts。
 */
/**
 * dts 投影上下文（BUG-168）。
 *
 * 注解原文的**可解析性**判据需要模块面（哪些类型名在产物里会有声明）；
 * 注解引用到的名字要回传给模块面 —— 本地类 ⇒ 补 `declare class`，
 * 别的模块的 import ⇒ 补 `import type`（否则消费方 tsc 报 TS2304）。
 */
export type DtsProjectionCtx = {
  surface?: DtsModuleSurface;
  /** 注解原文引用到的**模块面类型名**（本地类 / import） */
  typeRefs?: Set<string>;
  /** 被丢弃的注解（引用了产物里不可解析的类型名）——台账用 */
  dropped?: string[];
  /** 「第三种」：返回注解与观测元素域冲突（只落台账，产物恒用观测口径） */
  mismatches?: Array<{ name: string; declared: string; observed: string }>;
  /** Bug 57：查 `surface.typeParamClauses` 用的普查名（类成员是 `C.m`） */
  typeParamKey?: string;
};

/**
 * 当前声明**自己的**类型形参名（函数 / 方法的 `<T>` 与所在类的 `<T>`）。
 *
 * BUG-132：`T` 在注解里是合法类型名（就在同一条声明的类型形参子句里），
 * 但 `isTypeNameResolvable` 的四档（本地类 / import / interface·type /
 * 内建）不含类型形参 ⇒ `<T>(v: T): T` 的每个 `T` 都被当成「未在本模块声明」
 * 丢弃并落误导性台账。类型形参也不需要产物补任何声明。
 */
export function ctxTypeParamNames(ctx?: DtsProjectionCtx): ReadonlySet<string> {
  const key = ctx?.typeParamKey;
  const surface = ctx?.surface;
  if (!key || !surface) return EMPTY_NAME_SET;
  const out = new Set<string>();
  for (const n of typeParamNamesInClause(surface.typeParamClauses?.get(key))) out.add(n);
  // 类成员（`Box.m`）同时在类级 `<T>` 的作用域里
  const dot = key.lastIndexOf(".");
  if (dot > 0) {
    for (const n of surface.classes.get(key.slice(0, dot))?.typeParams ?? []) out.add(n);
  }
  return out.size > 0 ? out : EMPTY_NAME_SET;
}

const EMPTY_NAME_SET: ReadonlySet<string> = new Set<string>();

export function tsParamAnnotation(
  fn: FunctionAnalysis,
  index: number,
  isRest: boolean,
  ctx?: DtsProjectionCtx,
): string | undefined {
  const text = tsAnnotationTypeText(fn.formals?.[index]?.tsType);
  if (!text) return undefined;
  if (isRest && !isArrayTypeText(text)) return undefined;
  // BUG-168：注解原文里的类型名必须在**产物里可解析**才放行 —— 类型形参
  // （`<T>(x: T)`）/ 本地 interface / type 别名 / 未导入的类型名落进 `.d.ts`
  // 就是 TS2304（整份产物编译不过，而 `nudo export` exit 0、零台账）。
  // 不可解析 ⇒ 不放行，回落 `paramTypeFromAbs` 的观测口径（与 check 面一致）
  // 并留台账；可解析 ⇒ 记下引用名，模块面据此补 `declare class` / `import type`。
  const declaredTypeParams = ctxTypeParamNames(ctx);
  const valueRefs = typeofValueRefs(text);
  for (const name of annotationTypeRefs(text)) {
    if (TS_TYPE_TOKENS.has(name)) continue;
    const surface = ctx?.surface;
    // BUG-132：本声明自己的类型形参（`<T>` / 类的 `<T>`）同样可解析。
    if (declaredTypeParams.has(name)) continue;
    // 可解析 = 环境内建 / 本地类 / 本地 interface·type / 会补 import type 的导入名
    // / `typeof X` 的值命名空间（BUG-262）。
    if (!isTypeRefResolvable(name, valueRefs.has(name), surface)) {
      ctx?.dropped?.push(`${fn.name}.${getParamName(fn, index)}: ${name}`);
      return undefined;
    }
    // 需要产物补声明的两类才记引用（内建 / 本地类型声明自带）
    if (surface?.classes.has(name) || surface?.imports?.has(name) === true) {
      ctx?.typeRefs?.add(name);
    }
  }
  return text;
}

/**
 * BUG-193：形参**默认值**的类型证据（`f(x = 1)` ⇒ `number`）。
 *
 * 只作 `tsParamAnnotation` 的兜底：显式注解是更高一档证据（采集期已跳过
 * 有注解的位）。默认值的静态定型发生在模块面扫描
 * （`defaultParamTypeTexts`）；无 surface / 无证据 ⇒ undefined。
 */
export function tsParamDefaultType(
  fn: FunctionAnalysis,
  index: number,
  isRest: boolean,
  ctx?: DtsProjectionCtx,
): string | undefined {
  if (isRest) return undefined; // rest 位的默认值不是合法 TS
  const surface = ctx?.surface;
  if (!surface) return undefined;
  const key = ctx?.typeParamKey ?? fn.name;
  return surface.paramDefaults?.get(key)?.[index];
}

// ---------------------------------------------------------------------------
// Widening —— 主签名语义（注释保留自 TypeValue 路径；实现已在 Abs 侧）
//
// case 形状携带字面量精度（10、"Alice"、true、[1,2,3]、{ id: 1 }），但
// .d.ts 是调用面而非 case 台账：按 case 生成重载时 `safeSqrt(arg0: 10): 10`
// 会让合法调用 `safeSqrt(5)` 匹配不到任何重载，直接编译错误（tsc 5.9.3
// 实测 TS2769，见 __tests__/dts-generator.test.ts 的 safeSqrt 场景）。
// 主签名因此取 Combined 语义：每个参数位置取各 case 对应参数类型的联合
// 并 widen，返回类型对 combined 同样 widen（顶层标量字面量 → 基类型
// number/string/boolean/bigint；null/undefined 字面量本身是基类型，不变）。
//
// 参数位是逆变位，拦截面最广，widen 递归进结构（tsc --strict 实测）：
//   - 同构元组 [1,2,3,4,5] → number[]：定长 widened 元组
//     [number,number,number,number,number] 仍会拒收变长合法实参（TS2345
//     "Source has 2 element(s) but target requires 3"），而字面量长度只是
//     单次调用观察，不该构成约束；
//   - 异构元组 [1,"two"] → [number, string]：位置语义真实，且不拦截
//     合法的按位调用（实测 f([1,"x"]) 通过）；
//   - 对象属性值 { id: 1 } → { id: number }、数组元素、Promise 载荷、
//     实例属性同样递归 widen（全部处于逆变位，字面量精度同样拦截赋值）；
//   - refined（模板串/数值收窄）剥到 base：参数位收窄拦截一切不匹配
//     实参，精确形状由 JSDoc Case: 行保留。
//
// 返回值位是协变位，收窄只会让调用方拿到更精确的类型、不会拦截调用，
// 维持现状：仅顶层（含 union 成员）标量字面量 widen，嵌套精度保留
// （Promise<42>、返回元组字面量等）。
// ---------------------------------------------------------------------------

/**
 * 契约面证据（export CLI 从 effectiveContract 取——与 check 签名面同数据源：
 * sidecar（*.nudo.js）∪ inline `@nudo:contract`）。
 * - params：手写契约参数位的 entry Abs（constraintToEntryAbs 产物）；
 * - return：契约 returns 的 entry Abs；CLI 无 returns 契约时可喂契约种子
 *   求值结果（与 check 的 refine 种子同向）。
 * 证据优先级：手写契约 > case 见证（widen）> HOF 泛型快照。
 */
export interface DtsContractFace {
  /**
   * params：契约参数位。
   * - `abs`：entry Abs（constraintToEntryAbs 产物）；
   * - `optional`：契约级**顶层形参可选性**（Bug 536）——`constraint.isOptional`
   *   的直传。`constraintToEntryAbs` 对标量契约**丢掉** isOptional（entry Abs
   *   里没有该信息），故可选性必须由契约面显式带过来；缺省（undefined）=
   *   契约未申报该位 ⇒ 按**必填**处理（契约是用户申报的调用域，权威）。
   */
  params: Array<{ name: string; abs: Abs; optional?: boolean; display?: string }>;
  return?: Abs;
  /** ABS-03：返回契约的可读原文（JSDoc 注记；不参与类型投影） */
  returnDisplay?: string;
}

/** 契约参数位（Abs + 可选性标记） */
export type ContractParam = { abs: Abs; optional?: boolean };

/** 契约参数位查找表（bare 名匹配；`...rest` 剥前缀） */
export function contractParamMap(contract: DtsContractFace | undefined): Map<string, ContractParam> {
  const m = new Map<string, ContractParam>();
  for (const p of contract?.params ?? []) m.set(p.name, { abs: p.abs, optional: p.optional });
  return m;
}

/** 契约参数位 → 参数位 TS 串（逆变 widen：与 case-widen 同口径） */
/**
 * 契约参数位 → 参数位 TS 串。
 *
 * 契约面的**字面量**保持形（Bug 348）：`lit(1)` 的字面量只活在 pred 里 ⇒
 * 逆变 widen 会把它剥成 `number` ⇒ dts 面零表达（消费方 tsc 放行违反契约的
 * 调用，而同一份代码 nudo check 判红 ⇒ 双门禁对撞）。口径与返回位
 * `contractReturnTSType` 同源（`predLiteralSet`）。
 *
 * rest 位不接字面量（rest 必须是数组类型——TS2370）。
 */
export function contractParamType(
  a: Abs,
  isRest: boolean,
  typeVars?: Map<string, string>,
): string {
  if (!isRest) {
    // BUG-180：`any()` 槽不是类型变量（见 `contractAnyTSType`）
    const anySlot = contractAnyTSType(a);
    if (anySlot !== undefined) return anySlot;
    const lit = contractLiteralTSType(a);
    if (lit !== undefined) return lit;
  }
  return restParamType(widenParamAbs(a), isRest, typeVars);
}

/**
 * 契约可选位（Bug 088）：入口 Abs 带 **undefined 臂**（`.optional()` 的
 * 「可为 undefined」语义在 core 的入口投影里保真）⇒ dts 面的 `?` 已经表达
 * 同一件事 ⇒ 类型串**不再**重复 `| undefined`（与对象槽 `k?: T` 约定同款
 * ——Bug 543/560）。否则同一形参会渲染成 `x?: number | undefined`。
 */
export function dropUndefinedArm(a: Abs): Abs {
  if (a.shape.k !== "sum") return a;
  const members = (a.shape as { members: Abs[] }).members;
  const kept = members.filter(
    (m) => !(m.term?.op === "lit" && m.term.value === undefined),
  );
  if (kept.length === members.length || kept.length === 0) return a;
  if (kept.length === 1) return kept[0]!;
  return makeAbs({ k: "sum", members: kept }, a.term, a.pred, a.conf);
}

/** 契约参数位 → 渲染用 Abs（可选位去掉 undefined 臂，见 `dropUndefinedArm`） */
export function contractParamRenderAbs(hit: { abs?: Abs; optional?: boolean }): Abs | undefined {
  if (!hit.abs) return undefined;
  return hit.optional === true ? dropUndefinedArm(hit.abs) : hit.abs;
}

export type MainSignature = {
  /** 渲染后的参数声明（含 `?` / `...rest`），如 `["x: number", "y?: string"]` */
  params: string[];
  /** 参数声明事实（签名 IR 打印器的输入） */
  paramSlots: DtsParam[];
  /** `this: T` 接收者子句（无 ⇒ undefined） */
  thisParam?: string;
  /** 去重后的参数名（JSDoc @param 与渲染共用，保证一致） */
  paramNames: string[];
  /** 各参数位 widen 后的 TS 类型串（JSDoc 与精确度比对用） */
  paramTypes: string[];
  /** widen 后的返回类型串 */
  returnType: string;
  /** 返回位 widen 来源（observed / scalar） */
  returnWiden?: DtsReturnWiden;
  /** ABS-03：契约面推导出的类型形参（只含被形参 / 返回位引用的变元） */
  typeParams?: string[];
  /** ABS-14 PR4b：类型形参名 → TS `extends` 约束（只含可表达的简单界） */
  constraints?: ReadonlyMap<string, string>;
};

/**
 * 声明形参位（**参数表的声明来源**）。
 *
 * Bug 506 / 516 / 526 / 553：dts 参数表的**长度**与**可选性**必须取自声明
 * 形参表，而不是观测到的 case 实参个数——观测面不得裁剪契约义务，也不得
 * 决定「带默认值的形参是否可省略」（JS 里带默认值的形参是**声明级**可选）。
 */
export type DeclaredParam = {
  /** 展示名（rest 带 `...` 前缀；pattern 是求值占位 `_p{i}`） */
  name: string;
  /** 声明级可选：实现签名带默认值（`x = 1`）⇒ 该位可省略（JS 语义） */
  hasDefault: boolean;
  /** 剩余参数（`...xs`） */
  isRest: boolean;
  /** 解构形参（pattern） */
  isPattern: boolean;
  /**
   * Bug 394：解构**种类**——`"array"` 时契约按**元素下标**寻址
   * （`[a, b]` 的 `a` 是下标 0 的元素，不是属性键）⇒ 输入面必须是
   * **数组 / 元组**形态，不能摊成对象。
   */
  patternKind?: "object" | "array";
  /** pattern 的顶层绑定名（`{ a, b }` → `["a","b"]`） */
  bound: string[];
  /** 数组解构：绑定名 → **元素下标**（`[a, b]` → a→0、b→1） */
  boundIndex: Record<string, number>;
  /** 契约名 → 源属性键（rename `{a: b}` → propKey.b = "a"） */
  propKey: Record<string, string>;
  /**
   * BUG-029：#137 的**点路径**契约面（`{ card: { grade } }` ⇒ `card.grade`）。
   * 内层绑定名不在 `propKey` 里（那张表只覆盖顶层 rename）⇒ 只按 `bound`
   * 查契约会整条落空，形参退成 `_p0: unknown`（契约明明在，dts 面却看不见）。
   */
  nestedPaths?: string[];
};

/** 声明形参表（fn.formals 优先；paramNames 兜底——旧缓存 / 合成函数无 formals） */
export function declaredParams(fn: FunctionAnalysis): DeclaredParam[] {
  const formals = fn.formals;
  if (formals && formals.length > 0) {
    return formals.map((f) => {
      switch (f.kind) {
        case "id":
          return {
            name: f.name,
            // BUG-169：TS 可选形参（`b?: T`）可省 —— `FormalParam.optional`
            // 现在由 core 从源码文本判定并写回（`tsOptionalParams`），与
            // JS 默认值同一条通道 ⇒ `.d.ts` 的 `?` 不再丢（消费端 TS2554）。
            hasDefault: f.optional === true,
            isRest: false,
            isPattern: false,
            bound: [],
            boundIndex: {},
            propKey: {},
          };
        case "default":
          return {
            name: f.name,
            hasDefault: true,
            isRest: false,
            isPattern: false,
            bound: [],
            boundIndex: {},
            propKey: {},
          };
        case "rest":
          return {
            name: f.display,
            hasDefault: false,
            isRest: true,
            isPattern: false,
            bound: [],
            boundIndex: {},
            propKey: {},
          };
        case "pattern":
          return {
            name: f.placeholder,
            // BUG-107：解构形参的**默认值存在性**由解析器如实给出
            // （`FormalParam.optional`，`{ a } = {}` ⇒ true）。硬编码 false
            // ⇒ `.d.ts` 把可省形参**必填化** ⇒ 合法调用报 TS2554。
            hasDefault: f.optional === true,
            isRest: false,
            isPattern: true,
            patternKind: f.patternKind ?? "object",
            bound: [...f.bound],
            boundIndex: { ...(f.boundIndex ?? {}) },
            propKey: { ...f.propKey },
            nestedPaths: [...(f.nestedPaths ?? [])],
          };
      }
    });
  }
  // 兜底：无 formals ⇒ 只能从展示名读 rest 前缀；「带默认值」不可得 ⇒ 保守
  // 按必填（不假造可选性）。
  return (fn.paramNames ?? []).map((n) => ({
    name: n,
    hasDefault: false,
    isRest: n.startsWith("..."),
    isPattern: false,
    bound: [],
    boundIndex: {},
    propKey: {},
  }));
}

/**
 * 点路径契约 → 公共形参名（BUG-029）：`["card.grade"]` ⇒ `{ card: { grade } }`。
 *
 * 解构形参没有公共名，而 `_p0` / `_p0_1` 是求值占位（tmp-names.ts）——公共面
 * 只允许源码里写得出来的形态。顶层绑定全覆盖时仍用 `{ a, b }`（既有口径）；
 * 这里只处理「契约只覆盖了内层路径」的情形，保证声明的**名字**与**类型**同形。
 */
export function patternNameFromPaths(paths: readonly string[]): string | undefined {
  type Node = { children: Map<string, Node> };
  const root: Node = { children: new Map() };
  for (const p of paths) {
    const segs = p.split(".").filter(Boolean);
    if (segs.length < 2) return undefined; // 混入顶层键 ⇒ 交给既有口径
    let cur = root;
    for (const seg of segs) {
      const next = cur.children.get(seg) ?? { children: new Map() };
      cur.children.set(seg, next);
      cur = next;
    }
  }
  // 每层自己带花括号：`card: { grade }`（漏括号会渲成 `{ card: grade }` —— 名字
  // 与类型对不上，产物 tsc 直接报错）
  const render = (node: Node): string =>
    [...node.children.entries()]
      .map(([k, c]) => (c.children.size === 0 ? k : `${k}: { ${render(c)} }`))
      .join(", ");
  const body = render(root);
  return body.length > 0 ? `{ ${body} }` : undefined;
}

/**
 * BUG-249：解构形参的 **JS 绑定模式**文本。
 *
 * `FormalParam.bound` 是**契约寻址名集合**（rename `{ a: x }` 同时收属性键 `a`
 * 与绑定名 `x`），不是语法上的绑定名。直接 join 会产出 `{ a, x, b }`——产物
 * 自身 TS2339。这里按 `propKey`（契约名 → 源属性键）还原源码形态：
 * 源键只在别处有 rename 时跳过自身，绑定名以 `源键: 绑定名` 形态出现。
 */
export function bindingPatternText(
  decl: Pick<DeclaredParam, "patternKind" | "bound" | "propKey">,
): string {
  if (decl.patternKind === "array") return `[ ${decl.bound.join(", ")} ]`;
  const renamedSources = new Set<string>();
  for (const b of decl.bound) {
    const src = decl.propKey[b] ?? b;
    if (src !== b) renamedSources.add(src);
  }
  const parts: string[] = [];
  const emitted = new Set<string>();
  for (const b of decl.bound) {
    const src = decl.propKey[b] ?? b;
    if (src === b) {
      if (renamedSources.has(b)) continue; // 该源键由对应的 `src: binding` 渲染
      if (emitted.has(b)) continue;
      emitted.add(b);
      parts.push(b);
      continue;
    }
    if (emitted.has(src)) continue;
    emitted.add(src);
    parts.push(`${src}: ${b}`);
  }
  return `{ ${parts.join(", ")} }`;
}

/** 契约位查找结果 */
export type ContractSlot = {
  /** 命中的契约 Abs（undefined = 无契约证据） */
  abs?: Abs;
  /** 契约级可选性（undefined = 契约未申报该位） */
  optional?: boolean;
  /** 解构形参命中的**字段键**集合（具名形参为空） */
  keys: string[];
};

/**
 * 把 `card.grade` 这样的点路径插成嵌套槽（BUG-029）。
 *
 * 已存在的中间槽若是 `obj` 就并入（同一首段的多个点路径合成一棵树），否则
 * 覆盖成新对象（标量契约与子路径契约并存时以子路径为准——标量无法承载成员）。
 */
export function insertNestedSlot(
  slots: Record<string, { value: Abs }>,
  path: string[],
  abs: Abs,
): void {
  const [head, ...rest] = path;
  if (head === undefined) return;
  if (rest.length === 0) {
    slots[head] = { value: abs };
    return;
  }
  const prev = slots[head]?.value;
  const inner: Record<string, { value: Abs }> =
    prev && prev.shape.k === "obj"
      ? { ...(prev.shape.slots as Record<string, { value: Abs }>) }
      : {};
  insertNestedSlot(inner, rest, abs);
  slots[head] = { value: makeAbs({ k: "obj", slots: inner }, undefined, undefined, "path") };
}

/**
 * 契约位查找：
 * - 具名形参：按 bare 名 join（`...rest` 剥前缀）；
 * - 解构形参（Bug 538）：契约可写**占位名**（`_p0` / `_`）= 整对象，或写
 *   **字段级**条目（`a` / `b`）——后者聚合成该形参的**形状**（不再是丢弃）。
 */
export function lookupContractSlot(
  decl: DeclaredParam | undefined,
  rawName: string,
  contractByParam: Map<string, ContractParam>,
): ContractSlot {
  if (!decl) {
    const bare = rawName.startsWith("...") ? rawName.slice(3) : rawName;
    const hit = contractByParam.get(bare);
    return hit ? { abs: hit.abs, optional: hit.optional, keys: [] } : { keys: [] };
  }
  if (!decl.isPattern) {
    const bare = decl.isRest ? decl.name.slice(3) : decl.name;
    const hit = contractByParam.get(bare);
    return hit ? { abs: hit.abs, optional: hit.optional, keys: [] } : { keys: [] };
  }
  // 解构形参：整对象契约（占位名 / `_`）
  const whole = contractByParam.get(decl.name) ?? contractByParam.get("_");
  if (whole) return { abs: whole.abs, optional: whole.optional, keys: [] };
  // 解构形参：字段级契约条目 → 聚合成该形参的形状
  const slots: Record<string, { value: Abs }> = {};
  const keys: string[] = [];
  let optional: boolean | undefined;
  for (const b of decl.bound) {
    const hit = contractByParam.get(b);
    if (!hit) continue;
    const key = decl.propKey[b] ?? b;
    slots[key] = { value: hit.abs };
    keys.push(key);
    if (hit.optional === true) optional = true;
  }
  // BUG-029：点路径契约（`card.grade`）。按源属性路径建**嵌套槽**——把
  // `card.grade: string()` 平铺成 `{ "card.grade": ... }` 会产出非法的属性名。
  for (const path of decl.nestedPaths ?? []) {
    const hit = contractByParam.get(path);
    if (!hit) continue;
    insertNestedSlot(slots, path.split(".").filter(Boolean), hit.abs);
    keys.push(path);
    if (hit.optional === true) optional = true;
  }
  if (keys.length === 0) return { keys: [] };
  // Bug 394：**数组解构**的字段级契约按**元素下标**寻址（`[a, b]` 的 `a` 是
  // 下标 0 的元素，不是属性键）⇒ 聚合成**元组**，不是对象。摊成对象会产出
  // 与真实形参形态**相反**的输入面（合法数组调用被判红、非法对象调用放行）。
  if (decl.patternKind === "array") {
    // 元组长度 = 模式的**位置数**（最高下标 + 1）——未契约的位置填 `anyAbs`
    // （Abs 域的「无约束」；TS 投影面按 2026-11-06 归一渲染成 `unknown`）；
    // 契约只覆盖部分位置时，
    // 元组长度不得塌成单元素（单元素元组会被 widen 成 `T[]` ⇒ 把
    // 「下标 0 是 number」误写成「每个元素都是 number」⇒ 合法调用被判红）。
    const lastIndex = decl.bound.reduce(
      (acc, b) => Math.max(acc, decl.boundIndex[b] ?? decl.bound.indexOf(b)),
      -1,
    );
    const elements: Abs[] = [];
    for (let i = 0; i <= lastIndex; i++) elements.push(anyAbs);
    for (const b of decl.bound) {
      const hit = contractByParam.get(b);
      if (!hit) continue;
      const idx = decl.boundIndex[b] ?? decl.bound.indexOf(b);
      if (idx < 0 || idx > lastIndex) continue;
      elements[idx] = hit.abs;
    }
    return {
      abs: makeAbs({ k: "tuple", elements }, undefined, undefined, "path"),
      optional,
      keys,
    };
  }
  return {
    abs: makeAbs({ k: "obj", slots }, undefined, undefined, "path"),
    optional,
    keys,
  };
}

/** 解构形参的观测形状键（多 case 并集；非对象观测 ⇒ 无键信息） */
export function patternObservedKeys(members: Abs[]): string[] {
  const keys = new Set<string>();
  for (const m of members) {
    if (m.shape.k !== "obj") return [];
    for (const k of Object.keys(m.shape.slots)) keys.add(k);
  }
  return [...keys];
}

/** Abs → `T | undefined` 文本（union / fn 成员带括号） */
export function absUnionUndefined(a: Abs): string {
  const ts = absToTSTypeIr(a);
  return `${a.shape.k === "sum" || a.shape.k === "fn" ? `(${ts})` : ts} | undefined`;
}

/** 类型文本 → `T | undefined` 文本（TS 注解是原文；函数类型需括号） */
export function textUnionUndefined(t: string): string {
  return t.includes("=>") ? `(${t}) | undefined` : `${t} | undefined`;
}

export function computeMainSignature(
  fn: FunctionAnalysis,
  contract?: DtsContractFace,
  ctx?: DtsProjectionCtx,
): MainSignature {
  const contractByParam = contractParamMap(contract);
  // ABS-11：契约 × HOF 关系合取（与 contractOnlySignature 同源口径）——
  // 契约覆盖位绑定 HOF α，未覆盖位继续用 HOF 面（写契约不丢 β 链接）。
  const hofByParam = new Map<string, Abs>();
  for (const s of fn.hof?.entryShapes ?? []) hofByParam.set(s.param, s.abs);
  for (const r of fn.hof?.fnRels ?? []) hofByParam.set(r.param, r.abs);
  const hofSubst = new Map<string, Abs>();
  for (const [name, hofAbs] of hofByParam) {
    const c = contract?.params.find((p) => p.name === name)?.abs;
    if (c) unifyHofWithContract(hofAbs, c, hofSubst);
  }
  const contractNames = new Set((contract?.params ?? []).map((p) => p.name));
  // ABS-03：契约面类型形参（契约 + 未覆盖位的 HOF 变元）
  const typeVars = ((): Map<string, string> => {
    if (!contract) return new Map();
    const merged: DtsContractFace = {
      params: [
        ...contract.params,
        ...[...hofByParam.entries()]
          .filter(([name]) => !contractNames.has(name))
          .map(([name, hofAbs]) => ({ name, abs: substAbs(hofAbs, hofSubst) })),
      ],
      ...(contract.return ? { return: contract.return } : {}),
    };
    return contractTypeVarsOf(merged);
  })();
  const declared = declaredParams(fn);
  const declaredArity = declared.length;
  const observedArity =
    fn.cases.length > 0 ? Math.max(...fn.cases.map((c) => c.argAbs.length)) : 0;
  const observedMinArity =
    fn.cases.length > 0 ? Math.min(...fn.cases.map((c) => c.argAbs.length)) : 0;
  // Bug 506 / 516：参数表长度取**声明形参表**（case 只贡献类型证据）。
  // - 声明形参比观测元数多 ⇒ 契约/声明申报的形参不再被静默丢弃（516）；
  // - 声明里有 rest ⇒ rest 吞掉全部尾部实参，参数表长度 = 声明长度，
  //   且 rest 必居末位（TS1014：剩余参数必须是最后一个）（506）。
  const hasRest = declared.some((d) => d.isRest);
  const arity = hasRest ? declaredArity : Math.max(declaredArity, observedArity);
  const slots: DtsParam[] = [];
  const paramNames: string[] = [];
  const paramTypes: string[] = [];
  const usedNames = new Set<string>();
  for (let i = 0; i < arity; i++) {
    const decl = declared[i];
    const members: Abs[] = [];
    // 域证据 case：合成证据（call@/entry@）+ **带断言**的声明 case。无断言的
    // case 指令是见证、不是域声明 ⇒ 不参与形参位证据（Bug 511：freeze 写回
    // 的单点见证会把形参面收窄成该点的字面量）。
    for (const c of domainEvidenceCases(fn.cases)) {
      if (i >= c.argAbs.length) continue;
      const a = caseArgAbs(c, i);
      if (a) members.push(a);
    }
    const isRest = decl?.isRest ?? false;
    const rawName = decl?.name ?? getParamName(fn, i);
    // 契约命中（手写契约 = 用户申报的调用域，权威）
    const contractHit = lookupContractSlot(decl, rawName, contractByParam);
    // 声明位证据优先级（自高而低）：
    //   1. 手写契约（sidecar / @nudo:contract）—— 用户申报的调用域（既有
    //      口径「声明位取侧车契约」；`Case:` 行才是观测值）；
    //   2. TS 声明注解（Bug 479，`.ts` 源）—— 源码里写下的类型，原文保留；
    //   3. case-widen —— 观测值 join + 逆变 widen（无声明时的既有回落）。
    // BUG-193：无显式注解时，形参默认值的初始值是声明面证据（`f(x = 1)`
    // ⇒ `x?: number`；tsc `--declaration` 同口径）。
    const annotation =
      tsParamAnnotation(fn, i, isRest, ctx) ?? tsParamDefaultType(fn, i, isRest, ctx);
    const contractRender = contractParamRenderAbs(contractHit);
    // 优先级：契约 > 声明注解 > 具体 case 证据 > HOF 关系面。
    // case 证据是「无信息」（unknown / any）而 HOF 有 β 链接时取 HOF——
    // 写契约不再让未覆盖位的关系静默退化成 unknown。
    const caseType = annotation ?? paramTypeFromAbs(members, isRest);
    const hofAbs = hofByParam.get(rawName) ?? hofByParam.get(decl?.name ?? "");
    const caseNoInfo =
      isNoInfoType(caseType.replace(/\[\]$/, "")) ||
      (isRest && isNoInfoType(caseType.replace(/\[\]$/, "")));
    const typeStr = contractRender
      ? contractParamType(contractRender, isRest, typeVars)
      : hofAbs && caseNoInfo && annotation === undefined
        ? restParamType(substAbs(hofAbs, hofSubst), isRest, typeVars)
        : caseType;
    // 声明名：解构形参用**绑定模式**形态 `{ a, b }`（公共 API 声明不该出现
    // 求值占位 `_p0`；Bug 538）。键不全（契约/观测都拿不到该绑定）时回落
    // 占位名——模式形态与类型不匹配会产出不可编译的 .d.ts。
    const patternKeys = contractHit.abs ? contractHit.keys : patternObservedKeys(members);
    // 绑定被覆盖 = 契约键正好是该绑定名，或该绑定是内层路径的**中间对象**
    // （`{ card }` + `card.grade` ⇒ `card` 还是模式里的名字，类型自带嵌套）。
    const coveredBy = (b: string): boolean => {
      const key = decl.propKey[b] ?? b;
      return patternKeys.includes(key) || patternKeys.some((k) => k.startsWith(`${key}.`));
    };
    const boundCovered =
      decl?.isPattern === true && decl.bound.length > 0 && decl.bound.every(coveredBy);
    // BUG-029：契约只覆盖内层点路径（`card.grade`）时，按路径还原模式名。
    const pathPattern =
      decl?.isPattern === true && !boundCovered && contractHit.abs
        ? patternNameFromPaths(contractHit.keys)
        : undefined;
    let name: string;
    if (pathPattern !== undefined) {
      name = pathPattern;
    } else if (boundCovered) {
      // Bug 394：数组解构渲染成**数组形态** `[ a, b ]`（与源码一致）——
      // 此前一律 `{ a, b }` ⇒ 声明面看得出是对象，与真实形参形态相反。
      name = decl !== undefined ? bindingPatternText(decl) : rawName;
    } else {
      name = rawName;
      const bare = isRest ? name.slice(3) : name;
      if (!isJsBindingIdent(bare)) {
        name = isRest ? `...arg${i}` : `arg${i}`;
      }
    }
    if (usedNames.has(name)) {
      // 重名会让 .d.ts 非法（tsc TS2300 Duplicate identifier）：模式形态重名
      // 回落求值占位（合法 TS 标识符），其余序号去重。
      const fallback = decl?.name ?? `arg${i}`;
      if (!usedNames.has(fallback)) {
        name = fallback;
      } else {
        let n = 2;
        while (usedNames.has(`${name}${n}`)) n++;
        name = `${name}${n}`;
      }
    }
    usedNames.add(name);
    // 可选性三来源（自高而低）：
    //   1. 契约级（Bug 536）—— 手写契约申报的调用域，权威；
    //   2. 声明级（Bug 526 / 553）—— 实现签名带默认值（JS 语义：可省略）；
    //   3. 观测级 —— 最短观测调用省略了该位（观测证明存在更短的合法调用）。
    // BUG-108：契约覆盖该位时**契约级 ∪ 声明级**（旧实现只看契约级 ⇒ 与
    // standard 面的「契约级 ∪ 声明级」互斥；标准面才是对的）。
    // rest 位不可选（TS：剩余参数不能带 `?`）；解构位不可选（TS：绑定模式
    // 参数不能带 `?`）——**但**未绑定展开时渲染名是求值占位（`_p0`，普通
    // 标识符），此时可省性可以表达（BUG-107：`{ a } = {}` ⇒ `_p0?: any`）。
    // BUG-420：`.d.ts` 的**声明**签名允许 `{ a }?: T`（实现签名才禁止
    // 绑定模式带 `?`）。有默认值即可省，与绑定是否被契约/观测覆盖无关。
    const patternOptional =
      decl?.isPattern === true && decl.hasDefault === true;
    const optional =
      isRest
        ? false
        : decl?.isPattern === true
          ? patternOptional
          : contractHit.abs
            ? contractHit.optional === true || decl?.hasDefault === true
            : decl?.hasDefault === true || i >= observedMinArity;
    slots.push({
      name,
      type: typeStr,
      optional,
      ...(isRest ? { isRest: true } : {}),
      ...(optional
        ? contractRender
          ? { unionText: absUnionUndefined(widenParamAbs(contractRender)) }
          : annotation
            ? { unionText: textUnionUndefined(annotation) }
            : {}
        : {}),
    });
    paramNames.push(name);
    paramTypes.push(typeStr);
  }
  // BUG-133：`this: T` 是 TS 声明的接收者契约（不占运行时形参位，但 dts
  // 必须保留子句；否则消费方 `.call(receiver, …)` 失去接收者校验）。
  const thisClause = thisReceiverClause(fn, ctx);
  const renderedParams = renderDtsParams(slots);
  const params = thisClause === "" ? renderedParams : [thisClause, ...renderedParams];
  const retAbs = contract?.return ?? returnAbsOf(fn);
  // 契约返回位（声明级证据，权威）⇒ 保形（Bug 520：lit(42) → 42，与 zod /
  // standard / check 三面同口径）；观测返回位按调用面 widen 口径**递归**拓宽
  // （BUG-206：元组 / 对象槽里的字面量是「一次观测」而不是函数的类型）。
  // ABS-11：契约无返回位且观测返回位无信息时，回落到 HOF 符号返回位
  // （arr(B) / fn 关系），避免「写契约」把整条关系面静默降级成 unknown。
  const hofReturn =
    !contract?.return && fn.hof?.symbolic ? substAbs(fn.hof.symbolic, hofSubst) : undefined;
  // BUG-214 / BUG-206：只有 call@ / entry@ 见证（纯观测）时，返回 Abs 才是
  // **一次调用**的取值 ⇒ 必须递归拓宽；作者写下的 `@nudo:case` 是域声明
  // （`source: "directive"`），维持嵌套精度（位置语义真实，字面量由 `Case:`
  // 行保留）。entry@ 是**合成见证**（`source` 缺省、名字带 `entry@L<n>`），
  // 与 call@ 同为观测——不能因为缺 source 就退回「字面量即类型」的旧口径。
  const returnWiden = dtsReturnWidenOf(fn.cases);
  const observedReturnType = retAbs
    ? absToTSTypeIr(widenReturnAbs(retAbs, returnWiden === "observed"), typeVars)
    : "unknown";
  // BUG-134：类型谓词 / 断言签名是**返回位的类型**（声明级证据）⇒ 优先于
  // 观测面（观测只能给 `boolean` / `undefined`）；手写契约返回位仍是最高优先。
  const predicateReturn = contract?.return ? undefined : tsReturnPredicate(fn, ctx);
  // BUG-192/196/206：声明注解只在**观测无信息**（inference 失败 / 必抛）或
  // 该维度无法用 Abs 表达（`void`）时接棒——「声明 vs 观测冲突 ⇒ 保留观测」
  // 是既有裁定（只落台账），这里不翻转它。
  const declaredReturn = contract?.return
    ? undefined
    : tsDeclaredReturn(fn, observedReturnType, ctx, retAbs);
  const returnType =
    contract?.return
      ? contractReturnTSType(contract.return, typeVars)
      : (predicateReturn ??
        declaredReturn ??
        (hofReturn && isNoInfoType(observedReturnType.replace(/\[\]$/, ""))
          ? absToTSTypeIr(hofReturn, typeVars)
          : observedReturnType));
  // ABS-03：可达性过滤（与 contractOnlySignature 同源）
  // 可达性只看**类型文本**（paramTypes / returnType）——形参名不是类型引用
  const typeParams = reachableTypeParams(
    typeVars,
    `${paramTypes.join(" ")} ${returnType}`,
  );
  // ABS-14 PR4b：契约 Pred 的可表达简单界 → 类型形参 extends。
  // 只登记契约位的界；调用方仅对**被发射**的变元使用（见 typeParamDecls）。
  const constraints = contractTypeParamConstraints(contract, typeVars);
  return {
    params,
    paramSlots: slots,
    ...(thisClause === "" ? {} : { thisParam: thisClause }),
    paramNames,
    paramTypes,
    returnType,
    returnWiden,
    ...(typeParams.length > 0 ? { typeParams } : {}),
    ...(constraints.size > 0 ? { constraints } : {}),
  };
}



/**
 * ABS-03：契约可读注记（JSDoc）。**不改类型面**——契约的权威投影仍是
 * Abs（参数位 / 返回位）；这里只是把用户写的约束原文留给读者，
 * `Case:` 行继续只做调试见证，二者不互相冒充。
 */


/**
 * 函数类型注解文本的返回位：`(x: number) => string` → `string`。
 *
 * 只解析**顶层** `=>`（括号 / 方括号 / 花括号内的是嵌套函数类型），其余形态
 * （别名 / 联合 / 条件类型）返回 undefined —— 不猜。
 */
export function fnTypeReturnText(text: string): string | undefined {
  let depth = 0;
  let arrow = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "=" && text[i + 1] === ">" && depth === 0) {
      arrow = i + 2;
      break;
    }
  }
  if (arrow < 0) return undefined;
  const head = text.slice(0, arrow - 2).trim();
  // 函数类型的形参表：`(…)` / `<T>(…)` / `new (…)`；裸标识符是 `x => T` 的退化形态
  if (!/^(?:new\s+)?(?:<[^<>]*>\s*)?\(/.test(head) && !/^[A-Za-z_$][\w$]*$/.test(head)) {
    return undefined;
  }
  const ret = text.slice(arrow).trim();
  return ret.length > 0 ? ret : undefined;
}

/**
 * BUG-192：HOF 返回位的 β 求解——回调形参**有声明类型**时，β 就从注解的
 * 返回位取值，而不是留成自由类型参数。
 *
 * 只处理「返回位就是这个 β 本身」（`B:<param>`）的形态；`arr(B)` 等关系仍走
 * HOF 符号面。形参注解的可解析性已由 `tsParamAnnotation` 校验过，这里直接
 * 复用它的结果，返回位文本因此与形参位同源。
 */
export function solveHofBetaFromParamAnnotation(
  fn: FunctionAnalysis,
  retAbs: Abs | undefined,
  ctx?: DtsProjectionCtx,
): string | undefined {
  if (!retAbs || retAbs.term?.op !== "var") return undefined;
  const free = [...collectAbsFreeVars(retAbs)];
  if (free.length !== 1 || free[0] !== retAbs.term.id) return undefined;
  if (!retAbs.term.id.startsWith("B:")) return undefined;
  const index = fn.paramNames.indexOf(retAbs.term.id.slice(2));
  if (index < 0) return undefined;
  const annotation = tsParamAnnotation(fn, index, false, ctx);
  return annotation ? fnTypeReturnText(annotation) : undefined;
}

/**
 * C3.3：从 hof 快照构造 TS 泛型主签名。
 * design-hof-relations §7：fnRels/entryShapes 的 α / B:param → 泛型参数。
 *
 * 策略（避免抢走更精确的 case-widen）：
 * - 无 case（entryOnly / 纯 HOF）→ 用泛型；
 * - 有 case 时，仅当 **所有** HOF 提升形参在 case-widen 下仍是 unknown
 *   才用泛型——`reduceSum([1..5])` 这类 concrete case 的 `number[]`
 *   优于 `A1[]`，继续走 case-widen。
 * 无可用关系时返回 undefined。
 */
export function computeHofSignature(
  fn: FunctionAnalysis,
  ctx?: DtsProjectionCtx,
):
  | {
      typeParams: string[];
      params: string[];
      paramNames: string[];
      paramTypes: string[];
      returnType: string;
    }
  | undefined {
  const hof = fn.hof;
  if (!hof) return undefined;
  const byParam = new Map<string, Abs>();
  for (const s of hof.entryShapes ?? []) byParam.set(s.param, s.abs);
  for (const r of hof.fnRels ?? []) byParam.set(r.param, r.abs);
  if (byParam.size === 0 && !hof.symbolic) return undefined;

  // 有 case 时：HOF 提升位若已有非 unknown / any 外延，让位给 case-widen
  // （Abs any = 未约束、Abs unknown = 推断失败——两者都是「无信息」形态，
  //  都不能算作「case-widen 已给出更精确的外延」，Bug 544 的分面）
  if (fn.cases.length > 0) {
    for (const [param] of byParam) {
      const idx = fn.paramNames.indexOf(param);
      if (idx < 0) continue;
      const caseType = paramTypeFromAbs(
        domainEvidenceCases(fn.cases)
          .map((c) => c.argAbs[idx])
          .filter((a): a is Abs => !!a),
      );
      const bare = caseType.endsWith("[]") ? caseType.slice(0, -2) : caseType;
      if (!isNoInfoType(bare)) {
        return undefined;
      }
    }
  }

  const arity = Math.max(
    fn.paramNames.length,
    ...[...(byParam.keys())].map((p) => fn.paramNames.indexOf(p) + 1),
    0,
  );
  if (arity === 0 && !hof.symbolic) return undefined;

  // 收集签名位上的自由变元（复用 L2 collectAbsVars）
  const free = new Set<string>();
  for (const a of byParam.values()) {
    for (const id of collectAbsFreeVars(a)) free.add(id);
  }
  const retAbs = hof.symbolic ?? fn.combinedAbs;
  if (retAbs) {
    for (const id of collectAbsFreeVars(retAbs)) free.add(id);
  }
  if (free.size === 0) return undefined;

  // α / B:param → 稳定 TS 名；同名冲突加序号
  const typeVars = new Map<string, string>();
  const used = new Set<string>();
  for (const id of [...free].sort()) {
    let n = tsTypeParamName(id);
    if (used.has(n) || !isJsBindingIdent(n)) {
      let i = 2;
      while (used.has(`${n}${i}`)) i++;
      n = `${n}${i}`;
    }
    used.add(n);
    typeVars.set(id, n);
  }

  const params: string[] = [];
  const paramNames: string[] = [];
  const paramTypes: string[] = [];
  const usedNames = new Set<string>();
  for (let i = 0; i < arity; i++) {
    const rawName = getParamName(fn, i);
    const isRest = rawName.startsWith("...");
    let name = sanitizeParamName(rawName, i);
    if (usedNames.has(name)) {
      let n = 2;
      while (usedNames.has(`${name}${n}`)) n++;
      name = isRest && name.startsWith("...") ? `...${name.slice(3)}${n}` : `${name}${n}`;
    }
    usedNames.add(name);
    const promoted = byParam.get(fn.paramNames[i] ?? rawName) ?? byParam.get(rawName);
    // Bug 479：TS 声明注解优先于 HOF 提升位（声明 > 泛型快照；契约面已在
    // 上游挡住——有契约参数时本函数根本不会被调用）。
    const typeStr = tsParamAnnotation(fn, i, isRest, ctx)
      ?? (promoted
        ? absToTSTypeIr(promoted, typeVars)
        : isRest
          ? "unknown[]"
          : "unknown");
    params.push(`${name}: ${typeStr}`);
    paramNames.push(name);
    paramTypes.push(typeStr);
  }
  // 返回位证据优先级（BUG-192）：声明注解 > 回调形参注解的 β 求解 > HOF 符号面。
  // `B:<param>` 只在回调**没有任何声明类型**时才是正确的关系变量：回调已注解
  // 时 β 有解，把它当自由类型参数发布会让调用方把返回值推成任意类型（假绿）
  // 或 unknown（假红）。返回位是裸 `B:` 变元 ⇒ 观测没有携带返回类型信息，
  // 因此声明注解可以直接接棒（`"unknown"` 即「观测无信息」）。
  const betaReturn =
    retAbs?.term?.op === "var" && retAbs.term.id.startsWith("B:")
      ? (tsDeclaredReturn(fn, "unknown", ctx) ??
        solveHofBetaFromParamAnnotation(fn, retAbs, ctx))
      : undefined;
  const returnType = betaReturn ?? (retAbs ? absToTSTypeIr(retAbs, typeVars) : "unknown");
  // ABS-14 PR4a：free 变元全量发射会留下悬空类型参数（entry-only
  // processItems 的 A2 从未被任何形参/返回位引用）。按签名文本过滤，
  // 与契约面 reachableTypeParams 同口径；投影单向，不改 Abs 分析结果。
  const reachable = reachableTypeParams(
    typeVars,
    `${params.join(" ")} ${returnType}`,
  );
  return { typeParams: reachable, params, paramNames, paramTypes, returnType };
}

/** projectFunctionDts 的返回面：声明行 + 主签名参数位（unknown = 无证据） */
export interface DtsFunctionProjection {
  /** 声明行（JSDoc + 主签名）；空 = 不发射（不在导出面 / 类成员） */
  lines: string[];
  /** 主签名各参数位（bare 名 + widen 后 TS 串）；legacy rest-args 声明面为空 */
  params: Array<{ name: string; type: string }>;
  /**
   * 导出名（模块面解析后的**导出名**）：`export { internal as publicName }`
   * ⇒ publicName；`export default function f` ⇒ default；类成员 ⇒ undefined
   * （类成员不是模块级导出）。
   */
  exportName?: string;
  /**
   * 类成员面：本函数是类方法（`C.m`）时给出归属类与成员声明（未缩进）。
   * 类成员**不是**模块级导出——模块级没有 `C_m` 这个名字（Bug 518/550）；
   * 成员声明进 `declare class C { … }`，类声明由 projectModuleDts 合成。
   */
  classMember?: { className: string; member: string; lines: string[] };
  /**
   * BUG-168：注解原文引用到的**模块面类型名**（本地类 / import）——模块面
   * 据此补 `declare class` / `import type`（否则产物里是 TS2304）。
   */
  typeRefs?: string[];
}

/**
 * ABS-11：契约 × HOF 关系合取（dts 投影层）。
 *
 * 手写契约覆盖的形参位必须保留 HOF 关系面（entryShapes / fnRels）——
 * 「写契约」不得静默丢掉 β 链接（dts-generator 旧口径 hasContractParams ⇒
 * hofSig=undefined 的取舍要消除）。这里用结构对齐把 HOF 的 α 变元绑定到
 * 契约 Abs 的对应子结构（arr 元素 / tuple 位 / obj 槽 / fn 参数与返回），
 * 未覆盖的形参再用 `substAbs` 实例化 HOF Abs。
 *
 * 只做**结构可对齐**的绑定（形状同 kind 才递归）；对不齐的变元保留为
 * 自由变元（诚实泛型，不伪造具体类型）。
 */
export function unifyHofWithContract(
  pattern: Abs,
  concrete: Abs,
  out: Map<string, Abs>,
): void {
  const ps = pattern.shape;
  const cs = concrete.shape;
  if (ps.k === "any" && pattern.term?.op === "var") {
    const id = pattern.term.id;
    if (!out.has(id)) out.set(id, concrete);
    return;
  }
  if (ps.k === "arr" && cs.k === "arr") {
    unifyHofWithContract(ps.element, cs.element, out);
    return;
  }
  if (ps.k === "tuple" && cs.k === "tuple") {
    ps.elements.forEach((e, i) => {
      const c = cs.elements[i];
      if (c) unifyHofWithContract(e, c, out);
    });
    return;
  }
  if (ps.k === "obj" && cs.k === "obj") {
    for (const [k, slot] of Object.entries(ps.slots)) {
      const c = cs.slots[k];
      if (c) unifyHofWithContract(slot.value, c.value, out);
    }
    return;
  }
  if (ps.k === "fn" && cs.k === "fn") {
    (ps.paramTypes ?? []).forEach((t, i) => {
      const c = (cs.paramTypes ?? [])[i];
      if (c) unifyHofWithContract(t, c, out);
    });
    if (ps.returnType && cs.returnType) {
      unifyHofWithContract(ps.returnType, cs.returnType, out);
    }
  }
}

/**
 * ABS-03：契约面自由变元 → TS 类型形参映射（`bind:<name>` ⇒ `<name>`）。
 * 确定性：按 term id 排序 ⇒ 声明顺序稳定（快照可钉）。
 */
export function contractTypeVarsOf(
  contract: DtsContractFace | undefined,
): Map<string, string> {
  // BUG-180：`constraintToEntryAbs` 把**每个契约槽**的入口 Abs 锚在
  // `termVar(<槽名>)` 上（`fn({ v: any() }, any())` ⇒ 值槽 `var("v")` / 返回槽
  // `var("return")`）。这些 anchor 是**值槽名**，不是类型绑定；把它们收成
  // 候选类型形参会让 any 槽直接印出 `<v>` / `<return2>`（凭空发明泛型），
  // 槽名与返回 shape 的属性键同名时还会长出 `<id extends number>`。
  // 只排除「anchor 名」本身：真正的绑定仍是 `bind:<name>`（`binderTerm`），
  // HOF 变元（`A1` / `B:param`）也不受影响。
  const anchors = new Set<string>(["return", "throws"]);
  for (const p of contract?.params ?? []) anchors.add(p.name);
  const freeIds = new Set<string>();
  for (const p of contract?.params ?? []) {
    for (const id of collectAbsFreeVars(p.abs)) {
      if (!id.startsWith("bind:") && anchors.has(id)) continue;
      freeIds.add(id);
    }
  }
  if (contract?.return) {
    for (const id of collectAbsFreeVars(contract.return)) {
      if (!id.startsWith("bind:") && anchors.has(id)) continue;
      freeIds.add(id);
    }
  }
  const typeVars = new Map<string, string>();
  const usedNames = new Set<string>();
  for (const id of [...freeIds].sort()) {
    const bare = id.startsWith("bind:") ? id.slice("bind:".length) : id;
    let n = tsTypeParamName(bare);
    if (usedNames.has(n) || !isJsBindingIdent(n)) {
      let i = 2;
      while (usedNames.has(`${n}${i}`)) i++;
      n = `${n}${i}`;
    }
    usedNames.add(n);
    typeVars.set(id, n);
  }
  return typeVars;
}

/** 可达性过滤：类型形参必须在最终签名文本里作为独立词出现 */
export function reachableTypeParams(
  typeVars: Map<string, string>,
  typeText: string,
): string[] {
  return [...new Set(typeVars.values())].filter((n) =>
    new RegExp(
      `(^|[^A-Za-z0-9_$])${n.replace(/[$]/g, "\\$")}([^A-Za-z0-9_$]|$)`,
    ).test(typeText),
  );
}

// ---------------------------------------------------------------------------
// ABS-14 PR4b：契约的简单界 → TS 类型形参 `extends`
//
// 口径（计划 §5 实现拆分 4b + ABS-03「不可表达时诚实省略」）：
// - 只翻译 TS 有对应类型的叶：`typeof` 的基元标签、`eq(var, lit)` 的字面量；
// - 数值界（gt/ge/lt/le）、长度、`not` / `ne`、`assumeFinite`、含 `app` term
//   的关系 TS 无类型 ⇒ 跳过该叶，不整条丢弃、也不静默放宽；
// - `and` 逐叶展平；`or` 只有所有臂都可表达且指向同一 var 时才联合
//   （只投半边会把契约域错误收窄 ⇒ 整条省略）；
// - `typeof "object" / "function"` 与 TS 的 `object` / `Function` 语义有偏差
//   （null、可调用签名）⇒ 诚实省略；
// - 投影单向：不改 Abs 分析结果，不回写分析结果对象。
// ---------------------------------------------------------------------------

export type BoundLeaf = { id: string; type: string };

/** `typeof` 标签 → TS 约束类型；语义有偏差的标签返回 undefined（省略）。 */
export function typeofExtendsType(t: string): string | undefined {
  switch (t) {
    case "number":
    case "string":
    case "boolean":
    case "bigint":
    case "symbol":
    case "undefined":
      return t;
    default:
      return undefined;
  }
}

/** 逐叶抽取可表达界（var id 保持 Pred 空间，由 typeVars 映射到 TS 名）。 */
export function predBoundLeaves(pred: Pred | undefined): BoundLeaf[] {
  if (pred === undefined) return [];
  switch (pred.op) {
    case "and":
      return pred.args.flatMap(predBoundLeaves);
    case "or": {
      const arms = pred.args.map(predBoundLeaves);
      if (arms.length === 0 || arms.some((a) => a.length !== 1)) return [];
      const id = arms[0]![0]!.id;
      if (arms.some((a) => a[0]!.id !== id)) return [];
      return [
        { id, type: [...new Set(arms.map((a) => a[0]!.type))].join(" | ") },
      ];
    }
    case "typeof": {
      const ts = typeofExtendsType(pred.type);
      return pred.t.op === "var" && ts !== undefined
        ? [{ id: pred.t.id, type: ts }]
        : [];
    }
    case "eq": {
      const { a, b } = pred;
      if (a.op === "var" && b.op === "lit") {
        return [{ id: a.id, type: tsLiteralType(b.value) }];
      }
      if (b.op === "var" && a.op === "lit") {
        return [{ id: b.id, type: tsLiteralType(a.value) }];
      }
      return [];
    }
    default:
      return [];
  }
}

/** 契约参数位 → TS 类型形参名 → 约束串。 */
export function contractTypeParamConstraints(
  contract: DtsContractFace | undefined,
  typeVars: Map<string, string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of contract?.params ?? []) {
    for (const leaf of predBoundLeaves(p.abs.pred)) {
      const name = typeVars.get(leaf.id);
      if (name !== undefined && !out.has(name)) out.set(name, leaf.type);
    }
  }
  return out;
}

/** `<A extends number, B>` 的声明元素；无约束时与旧输出逐字节一致。 */
export function typeParamDecls(
  names: readonly string[],
  constraints?: ReadonlyMap<string, string>,
): string {
  if (constraints === undefined || constraints.size === 0) return names.join(", ");
  return names
    .map((n) => {
      const c = constraints.get(n);
      return c === undefined ? n : `${n} extends ${c}`;
    })
    .join(", ");
}

/** 契约-only 参数签名（skip / 无 case 函数 + 手写契约参数位）：具名参数 + 声明返回 */
export function contractOnlySignature(
  fn: FunctionAnalysis,
  contract: DtsContractFace,
  ctx?: DtsProjectionCtx,
): MainSignature {
  const byName = contractParamMap(contract);
  const declared = declaredParams(fn);
  // ABS-11：契约 × HOF 关系合取——契约覆盖位把 HOF α 绑定到契约子结构，
  // 未覆盖位继续用 HOF 关系面（写契约不再静默丢 β 链接）。
  const hofByParam = new Map<string, Abs>();
  for (const s of fn.hof?.entryShapes ?? []) hofByParam.set(s.param, s.abs);
  for (const r of fn.hof?.fnRels ?? []) hofByParam.set(r.param, r.abs);
  const hofSubst = new Map<string, Abs>();
  for (const [name, hofAbs] of hofByParam) {
    const cAbs = contract.params.find((p) => p.name === name)?.abs;
    if (cAbs) unifyHofWithContract(hofAbs, cAbs, hofSubst);
  }
  const contractNames = new Set(contract.params.map((p) => p.name));
  // ABS-03：契约面的自由变元（bind/ref 的 `bind:<name>` 项）→ TS 类型形参；
  // ABS-11：未覆盖形参的 HOF 变元同样参与（已代入的从 substAbs 结果收集）。
  const typeVars = ((): Map<string, string> => {
    const merged: DtsContractFace = {
      params: [
        ...contract.params,
        ...[...hofByParam.entries()]
          .filter(([name]) => !contractNames.has(name))
          .map(([name, hofAbs]) => ({ name, abs: substAbs(hofAbs, hofSubst) })),
      ],
      ...(contract.return ? { return: contract.return } : {}),
    };
    return contractTypeVarsOf(merged);
  })();
  const slots: DtsParam[] = [];
  const paramNames: string[] = [];
  const paramTypes: string[] = [];
  const usedNames = new Set<string>();
  for (let i = 0; i < declared.length; i++) {
    const decl = declared[i]!;
    const raw = decl.name;
    const isRest = decl.isRest;
    const hit = lookupContractSlot(decl, raw, byName);
    // 解构形参：绑定模式形态（键不全时回落占位名——见 computeMainSignature）
    const boundCovered =
      decl.isPattern &&
      decl.bound.length > 0 &&
      decl.bound.every((b) => hit.keys.includes(decl.propKey[b] ?? b));
    // BUG-029：只覆盖内层点路径时按路径还原模式名（`{ card: { grade } }`）
    const pathPattern =
      !boundCovered && hit.abs !== undefined ? patternNameFromPaths(hit.keys) : undefined;
    let name =
      pathPattern ?? (boundCovered ? bindingPatternText(decl) : sanitizeParamName(raw, i));
    if (usedNames.has(name)) {
      let n = 2;
      while (usedNames.has(`${name}${n}`)) n++;
      name = `${name}${n}`;
    }
    usedNames.add(name);
    const annotation =
      tsParamAnnotation(fn, i, isRest, ctx) ?? tsParamDefaultType(fn, i, isRest, ctx);
    const hitRender = contractParamRenderAbs(hit);
    const hofAbs = hofByParam.get(decl.name);
    const typeStr = hitRender
      ? contractParamType(hitRender, isRest, typeVars)
      : hofAbs
        ? restParamType(substAbs(hofAbs, hofSubst), isRest, typeVars)
        : (annotation ?? (isRest ? "unknown[]" : "unknown"));
    // 可选性（与 computeMainSignature 同口径）：契约级 ∪ 声明级（默认值）。
    // BUG-108：契约覆盖该位时旧实现**只看契约级** ⇒ `fn({ a: num })` +
    // `function f(a = 1)` 的 dts 面把 `a` 印成必填，而 standard 面
    // （契约级 ∪ 声明级）印成可选 ⇒ 三面互斥；声明级默认值是 JS 语义的
    // 「可省略」，契约没否决它 ⇒ 两来源取并。
    const optional = isRest
      ? false
      : decl.isPattern
        ? decl.hasDefault
        : hit.abs
          ? hit.optional === true || decl.hasDefault
          : decl.hasDefault;
    slots.push({
      name,
      type: typeStr,
      optional,
      ...(isRest ? { isRest: true } : {}),
      ...(optional
        ? hitRender
          ? { unionText: absUnionUndefined(widenParamAbs(hitRender)) }
          : annotation
            ? { unionText: textUnionUndefined(annotation) }
            : {}
        : {}),
    });
    paramNames.push(name);
    paramTypes.push(typeStr);
  }
  const params = renderDtsParams(slots);
  // 契约里多出、形参表对不上的参数名不投影（arity 谎言；check 面报
  // nudo:contract-param-mismatch，export 不执法）
  const returnType = contract.return
    ? contractReturnTSType(contract.return, typeVars)
    : fn.combinedAbs
      ? absToTSTypeIr(fn.combinedAbs, typeVars)
      : "unknown";
  // 可达性过滤：只发射在最终签名文本里真正出现的类型形参
  // 可达性只看**类型文本**（paramTypes / returnType）——形参名不是类型引用
  const typeParams = reachableTypeParams(
    typeVars,
    `${paramTypes.join(" ")} ${returnType}`,
  );
  // ABS-14 PR4b：契约 Pred 的可表达简单界 → 类型形参 extends。
  // 只登记契约位的界；调用方仅对**被发射**的变元使用（见 typeParamDecls）。
  const constraints = contractTypeParamConstraints(contract, typeVars);
  return {
    params,
    paramSlots: slots,
    paramNames,
    paramTypes,
    returnType,
    ...(typeParams.length > 0 ? { typeParams } : {}),
    ...(constraints.size > 0 ? { constraints } : {}),
  };
}

// ---------------------------------------------------------------------------
// 「第三种」：返回注解一致性校验
//
// 实现是**事实**，声明是**断言**。两者不符时只出台账，产物恒用观测口径
// （不覆盖、不 fallback 到声明）—— 否则会重演 BUG-168 在形参位修掉的
// 「check 面与 dts 面相反裁决」。
// ---------------------------------------------------------------------------

const PRIM_TYPE_NAMES: ReadonlySet<string> = new Set([
  "number", "string", "boolean", "bigint", "symbol", "object",
  "undefined", "null", "void", "never", "unknown", "any",
]);

const GENERIC_ITERATOR_NAMES: ReadonlySet<string> = new Set([
  "Generator", "AsyncGenerator", "IterableIterator", "Iterator",
  "AsyncIterableIterator", "AsyncIterator",
]);

/**
 * 只认「`迭代器名<单一标识符, 或 >`」这一种形态。联合类型（`1 | 2` /
 * `number | string`）、嵌套泛型、对象类型、字面量一律**不匹配** ⇒ 不参与
 * 校验。这是刻意的窄判据：widen 口径差异（`Generator<1|2>` 观测为
 * `Generator<number>`）不是冲突，假阳性比漏报更伤。
 */
export function firstIteratorElem(text: string): string | undefined {
  const m = /^([A-Za-z_$][\w$]*)\s*<\s*([A-Za-z_$][\w$]*)\s*(?:[,>])/.exec(text.trim());
  if (!m || !GENERIC_ITERATOR_NAMES.has(m[1]!)) return undefined;
  return m[2];
}

export function returnAnnotationMismatch(
  declared: string | undefined,
  observed: string,
): { declared: string; observed: string } | undefined {
  if (!declared) return undefined;
  // 注解文本可能含换行 / 注释记号；只取可安全落进台账的形态（BUG-192 口径）。
  const cleaned = tsAnnotationTypeText(declared);
  if (!cleaned) return undefined;
  const want = firstIteratorElem(cleaned);
  const got = firstIteratorElem(observed);
  if (!want || !got || want === got) return undefined;
  if (!PRIM_TYPE_NAMES.has(want) || !PRIM_TYPE_NAMES.has(got)) return undefined;
  // unknown / any 是保守域而非互斥断言 ⇒ 观测推不出来时不能判「声明错了」。
  if (want === "unknown" || want === "any" || got === "unknown" || got === "any") {
    return undefined;
  }
  return { declared: want, observed: got };
}

/** 类型谓词 / 断言签名文本（`x is T` / `this is T` / `asserts x` / `asserts x is T`） */
export function isTypePredicateText(text: string): boolean {
  const t = text.trim();
  return (
    /^asserts\s+(?:this|[A-Za-z_$][\w$]*)(?:\s+is\s+[\s\S]+)?$/.test(t) ||
    /^(?:this|[A-Za-z_$][\w$]*)\s+is\s+[\s\S]+$/.test(t)
  );
}

/**
 * 返回位的**类型谓词 / 断言签名**（BUG-134）。
 *
 * 谓词是返回位的类型本身，不是 Abs 能表达的维度 ⇒ 观测面只给 `boolean` /
 * `undefined`，产物把窄化契约整条丢掉：消费方 `if (isStr(x)) x.toUpperCase()`
 * 与 `assertStr(x); x.toUpperCase()` 都报 TS18046（`tsc --declaration` 的产物
 * 是 `x is string` / `asserts x is string`）。声明面原文已采集
 * （`fn.declaredReturnType`）⇒ 可解析时**原样保留**；引用到不可解析的类型名
 * ⇒ 落台账并回落观测（与 `tsParamAnnotation` 同口径）。
 */
/**
 * BUG-133：`this: T` 接收者子句。类型名不可解析 ⇒ 台账 + 省略（不产出
 * TS2304）；可解析的本地声明 / import 回传 typeRefs（模块面补声明 / import）。
 *
 * 修正：
 * - 本声明自己的类型形参（`g<T>(this: Box<T>)` 的 `T`）是合法类型名，
 *   不能按「未在本模块声明」丢弃（与 `tsParamAnnotation` 同口径）；
 * - 无模块面时也必须走同一可解析性判据（旧实现跳过校验 ⇒ 纯投影面把
 *   未声明的 `this` 类型写成 TS2304，且零台账）；
 * - 不可解析 ⇒ 省略子句并落 `(this receiver)` 台账。
 */
export function thisReceiverClause(fn: FunctionAnalysis, ctx?: DtsProjectionCtx): string {
  const raw = fn.thisReceiverType?.trim();
  if (!raw) return "";
  const surface = ctx?.surface;
  const declaredTypeParams = ctxTypeParamNames(ctx);
  const valueRefs = typeofValueRefs(raw);
  for (const name of annotationTypeRefs(raw)) {
    if (TS_TYPE_TOKENS.has(name) || declaredTypeParams.has(name)) continue;
    if (!isTypeRefResolvable(name, valueRefs.has(name), surface)) {
      ctx?.dropped?.push(`${fn.name}: ${name} (this receiver)`);
      return "";
    }
    if (surface?.classes.has(name) || surface?.imports?.has(name) === true) {
      ctx?.typeRefs?.add(name);
    }
  }
  return `this: ${raw}`;
}

export function tsReturnPredicate(fn: FunctionAnalysis, ctx?: DtsProjectionCtx): string | undefined {
  const raw = tsAnnotationTypeText(fn.declaredReturnType);
  if (!raw || !isTypePredicateText(raw)) return undefined;
  const trimmed = raw.trim();
  const withoutAsserts = trimmed.replace(/^asserts\s+/, "");
  const isPart = /^(?:this|[A-Za-z_$][\w$]*)\s+is\s+([\s\S]+)$/.exec(withoutAsserts);
  // `asserts x`（无类型位）⇒ 没有类型名要核对，原样保留
  if (!isPart) return trimmed;
  const typePart = isPart[1]!;
  const declaredTypeParams = ctxTypeParamNames(ctx);
  const valueRefs = typeofValueRefs(typePart);
  for (const name of annotationTypeRefs(typePart)) {
    if (TS_TYPE_TOKENS.has(name) || declaredTypeParams.has(name)) continue;
    const surface = ctx?.surface;
    if (!isTypeRefResolvable(name, valueRefs.has(name), surface)) {
      ctx?.dropped?.push(`${fn.name}: ${name} (return predicate)`);
      return undefined;
    }
    if (surface?.classes.has(name) || surface?.imports?.has(name) === true) {
      ctx?.typeRefs?.add(name);
    }
  }
  return trimmed;
}

/**
 * 返回位的**声明注解原文**（BUG-132 / 192 / 196 / 206 / 209）。
 *
 * 形参位自 BUG-479 起就是「注解原文优先」，返回位只有谓词（BUG-134）与
 * 「引用本声明类型形参」（BUG-132）两档特殊情形优先。本函数补齐另外两档
 * **Abs 表达不了**的证据：
 * - `void`：Abs 没有「函数无返回值」这个维度，观测只能给 `undefined`，而
 *   TS 里二者单向可赋 ⇒ `ReturnType<typeof f>` 的合法用法被拒（BUG-196）；
 * - 观测无信息：`unknown`（推断失败）/ `never`（唯一观测在抛出点）都不是
 *   「类型」，声明是唯一可用的证据（BUG-209）。
 *
 * 观测给出**具体**类型时仍以观测为准（「声明 vs 观测冲突 ⇒ 保留观测」是既有
 * 裁定，见 `returnAnnotationMismatch` 台账），本函数不翻转它。
 *
 * 只放行**产物里可解析**的注解：引用了不可解析的类型名 ⇒ 落台账并回落既有
 * 路径（与 `tsParamAnnotation` 同口径，避免 TS2304 的整份产物）。
 */
export function tsDeclaredReturn(
  fn: FunctionAnalysis,
  observed: string,
  ctx?: DtsProjectionCtx,
  observedAbs?: Abs,
): string | undefined {
  const raw = tsAnnotationTypeText(fn.declaredReturnType);
  // 谓词（`x is T` / `asserts x`）由 tsReturnPredicate 独占：它的名字扫描口径
  // 不同（形参名不是类型引用），这里不重复判。
  if (!raw || isTypePredicateText(raw)) return undefined;
  const declared = ctxTypeParamNames(ctx);
  // 引用**本声明类型形参**的注解永远优先（BUG-132）：Abs 没有「类型变量」
  // 这个维度，观测只能给 unknown ⇒ 不采用就等于丢掉参数与返回的定义关系。
  const usesTypeParam = annotationTypeRefs(raw).some((n) => declared.has(n));
  // 声明注解在下列情形**必须**保留（否则产物与 tsc 相反）：
  // - BUG-254：观测是内建泛型占位（`Map<unknown, unknown>`）而声明给了实参；
  // - BUG-257：声明是 `readonly T[]` / `readonly [A, B]`，观测没有只读维度；
  // - BUG-274：声明是函数类型，观测只有 `(a0: unknown) => unknown`；
  // - BUG-261：声明是字面量类型（`"a"` / `42` / `true`），观测只能给基类型；
  // - BUG-362：观测下标读带 `| undefined`，声明是更窄的 `T`。
  // 声明域比观测域更窄（`(): number` 而观测是 `number | string`）⇒ 声明
  // 是发布契约，必须保留；只有「观测更窄」时才让位（既有协变口径）。
  const declaredAbs =
    fn.declaredReturnAbs ??
    (observedAbs
      ? absTypeForTsTypeText(raw, {
          typeParams: new Map([...declared].map((n) => [n, anyAbs])),
        })
      : undefined);
  const declaredNarrower =
    declaredAbs !== undefined &&
    observedAbs !== undefined &&
    leqAbs(declaredAbs, observedAbs).ok &&
    !leqAbs(observedAbs, declaredAbs).ok;
  // 声明是观测的**超类型**（`(): keyof User` 而观测 `"name"`、`(): string |
  // number` 而观测 `number`、`(): {a?: number; b: string}` 而观测 `{b:"s"}`）：
  // 声明仍是有效公开契约，且消费者按声明收窄/拓宽 ⇒ 保留声明。此前只认
  // 「声明更窄」，把这一类全部让给观测（报告 422/426/455/498 的共同政策面）。
  const declaredCoversObserved =
    declaredAbs !== undefined &&
    observedAbs !== undefined &&
    leqAbs(observedAbs, declaredAbs).ok;
  // BUG-403 配套：enum 作返回注解时 tsc 保留 `Color`，不会改写成成员字面量
  // 联合 / 基类型。观测域是新映射出的 `"red" | "green"` ⇒ 必须让声明名胜出。
  const bareName = raw.trim();
  const namedEnumReturn =
    /^[A-Za-z_$][\w$]*$/.test(bareName) &&
    ctx?.surface?.values.get(bareName)?.kind === "enum";
  // BUG-393：用户泛型类的具体返回注解（`Box<number>`）不能被裸 `Box` /
  // `Box<unknown>` 观测覆盖——分析面 brand 不携带类型实参。
  const genericRef = /^([A-Za-z_$][\w$]*)<[\s\S]+>$/.exec(bareName);
  const genericDeclMorePrecise =
    genericRef !== null &&
    (observed === genericRef[1] || observed.startsWith(`${genericRef[1]}<unknown`));
  const declarationMorePrecise =
    declaredNarrower ||
    declaredCoversObserved ||
    namedEnumReturn ||
    genericDeclMorePrecise ||
    hasLibGlobalTypeText(raw) ||
    isPlaceholderBuiltinType(observed) ||
    (hasReadonlyTypePrefix(raw) && !observed.includes("readonly")) ||
    (isFunctionTypeText(raw) && /=>\s*unknown/.test(observed)) ||
    (hasLiteralTypeText(raw) && !hasLiteralTypeText(observed)) ||
    (observed.includes("| undefined") && !raw.includes("| undefined"));
  if (
    !usesTypeParam &&
    raw.trim() !== "this" &&
    !declarationMorePrecise &&
    !isNoInfoObservedType(observed) &&
    observed !== "never"
  ) {
    return undefined;
  }
  const valueRefs = typeofValueRefs(raw);
  for (const name of annotationTypeRefs(raw)) {
    if (TS_TYPE_TOKENS.has(name) || declared.has(name)) continue;
    const surface = ctx?.surface;
    if (!isTypeRefResolvable(name, valueRefs.has(name), surface)) {
      ctx?.dropped?.push(`${fn.name}: ${name} (return type)`);
      return undefined;
    }
    if (surface?.classes.has(name) || surface?.imports?.has(name) === true) {
      ctx?.typeRefs?.add(name);
    }
  }
  return raw;
}
