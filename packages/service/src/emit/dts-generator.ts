import type { Abs, LiteralValue, Pred, Term } from "@nudojs/core";
import {
  joinAbs,
  litValue,
  abs as makeAbs,
  collectAbsFreeVars,
  lookupObjAccessor,
  parseSource,
  termEquals,
  unknown,
  anyAbs,
  substAbs,
  provenanceOf,
  leqAbs,
  extStateOf,
} from "@nudojs/core";
import {
  isTemplateLike,
  templatePartsOf,
  escapeTemplateTypeFixed,
  formatObjectKey,
  isJsBindingIdent,
  sanitizeCommentText,
  toJsBindingIdent,
  ProjectionBudget,
  absTypeForTsTypeText,
} from "@nudojs/core/internal";
import type { AnalysisResult, CaseResult, FunctionAnalysis } from "../analyzer.ts";
import { domainEvidenceCases } from "./domain-cases.ts";
import { tsAnnotationShape, tsAnnotationTypeText } from "../ts-annotation.ts";
import { exportNameRepr } from "./export-binding.ts";
import { isHiddenInternalSlot } from "./internal-slot.ts";
import { isRuntimeGlobalCtorName } from "./schema-generator.ts";
import { renderDtsParams, type DtsParam } from "./dts-ir.ts";

// ---------------------------------------------------------------------------
// Abs → TS（dts 主路径）
//
// design-refine-derivation §12.1：`.d.ts` 优先源是 refine / Abs。
// C3.3 / design-hof-relations P5：有 hof 快照时投成泛型函数声明。
//
// widen 策略（参数逆变 / 返回协变），语义不变：
//   - 参数位：结构内字面量与收窄 pred 剥到基类型；同构元组 → array
//   - 返回位：仅顶层（含 sum 成员）标量字面量 → 基类型，嵌套精度保留
// ---------------------------------------------------------------------------

/** α / B:param → TS 类型参数名（`B:transform` → `B_transform`）。 */
function tsTypeParamName(id: string): string {
  let n = id.replace(/[^A-Za-z0-9_$]/g, "_");
  if (!/^[A-Za-z_$]/.test(n)) n = `T_${n}`;
  if (n.length === 0) n = "T";
  return n;
}

/**
 * 函数名 → 合法 TS **绑定名**（.d.ts 必须始终可被 tsc 解析）。
 *
 * 作用域名（类方法 `C.m`）不是合法标识符——直接落进 `export declare function
 * C.m(...)` 就是非法 TS（#494）。清洗口径与 noDeclaration 分支的
 * `Class_method` 投影一致（`C.m` → `C_m`），也与 zod / standard / guard 面
 * 的 `C_m*` 命名同源。
 *
 * **保留字**（`default` / `class` / `let` / `eval` …）也不是合法绑定名——
 * 直出就是 **TS1359 + TS1005**（整份 .d.ts 解析失败，Bug 552）。core 的
 * `toJsBindingIdent` 是仓里既有的保留字口径（保留字加 `_` 前缀）⇒ 复用。
 */
function dtsIdentifier(name: string): string {
  // Bug 11：合法绑定名（含 Unicode，如 `café` / `日本`）必须原样保留——ASCII
  // 预筛会把它们洗成 `caf_`，把模块的公开名字改掉。`toJsBindingIdent` 已是
  // 仓里 Unicode 保真的绑定名口径：合法名原样、保留字加 `_` 前缀、非法字符
  // 逐字清洗（`C.m` → `C_m`，#494 口径不变）。
  return toJsBindingIdent(name);
}

/** 函数类型 / 并集在数组元素、`| undefined` 等位置必须加括号（TS 优先级）。 */
function wrapComplexAbs(a: Abs, typeVars: Map<string, string> | undefined, budget: ProjectionBudget): string {
  const ts = absToTSTypeB(a, typeVars, budget);
  if (a.shape.k === "sum" || a.shape.k === "fn") return `(${ts})`;
  return ts;
}

/** 并集成员：函数类型必须括号，否则 `number | (x) => T` 非法（TS1385）。 */
function wrapUnionMember(a: Abs, typeVars: Map<string, string> | undefined, budget: ProjectionBudget): string {
  const ts = absToTSTypeB(a, typeVars, budget);
  if (a.shape.k === "fn") return `(${ts})`;
  return ts;
}

/**
 * 截断标记（DESIGN-001）：注释 + 基类型，任何类型位都是合法 TS 且可观测。
 * 模板插值位 unknown 不可插值（TS2322）→ string 变体；两个常量串不会与
 * 合法投影混淆（类型名不可能含 `/*`）。dts 无 dropped 台账——标记即观测。
 */
const TS_TRUNC = {
  cycle: "/* nudo:truncated:cycle */ unknown",
  depth: "/* nudo:truncated:depth */ unknown",
  cycleTpl: "/* nudo:truncated:cycle */ string",
  depthTpl: "/* nudo:truncated:depth */ string",
} as const;

/** 模板插值位换合法变体（unknown 不是可插值类型） */
function tsTplSafe(ts: string): string {
  if (ts === TS_TRUNC.cycle) return TS_TRUNC.cycleTpl;
  if (ts === TS_TRUNC.depth) return TS_TRUNC.depthTpl;
  return ts;
}

/**
 * 成员声明里不能用保留字/非法标识符；空名与非 ident 落到 argN。
 * optional 标签（`options?`）先剥下再判 ident、保留 `?` 输出
 * （与 formatShape 的 `label?` 口径一致，BUG-020/S6-005：
 * 旧实现整名换 argN，`?` 语义丢失变必填）。
 */
function sanitizeParamName(name: string, index: number): string {
  let optional = false;
  let base = name;
  if (base.endsWith("?")) {
    optional = true;
    base = base.slice(0, -1);
  }
  if (base.startsWith("...")) {
    const rest = base.slice(3);
    if (isJsBindingIdent(rest)) return `...${rest}${optional ? "?" : ""}`;
    return `...arg${index}`;
  }
  if (isJsBindingIdent(base)) return `${base}${optional ? "?" : ""}`;
  return `arg${index}`;
}

/** 对象字面量键：ident / 规范数字键可裸写，其余 JSON 引号（与 schema formatJsObjectKey 同口径）。 */
function formatPropKey(k: string): string {
  return formatObjectKey(k);
}

/**
 * Bug 191：对象字面量访问器（getter）的**读域**——访问器不住在 shape 槽里
 * （transpile 只落 `$lit(void 0)` 占位槽保键存在性，真 getter 住 core 的
 * accessorTable 侧表）。dts 投影直读占位槽 ⇒ 把 getter 的返回值谎报成
 * exact `undefined`（自信的错值：比真值更窄且自相矛盾——`{ab: 1}` 被声明
 * 成 `{ab: undefined}`）。
 *
 * 读法与 core 投影面同口径（core 的 accessorReadDomain）：有 getter → 以
 * 对象为接收者求值读域（getter 闭包的 `this` 就是该对象）；getter 抛
 * （读域不可静态刻画）→ unknown（sound 超近似，**不得**回落 definite
 * undefined）；无 getter（数据槽 / 仅 setter）→ 用槽值（仅 setter 的原生
 * 读值恒 undefined，占位槽本就正确）。
 *
 * 注：core 的 accessorReadDomain 未进公共面（public-api 冻结）——此处按
 * 公共面 `lookupObjAccessor` 同口径实现，不改 core 公共 API 形状。
 */
function slotAbsOf(a: Abs, k: string, fallback: Abs): Abs {
  // BUG-167：占位槽 `unknown` = 读域**不可判**（非纯 getter / defineProperty 装的
  // 访问器）⇒ 不得为投影执行用户 getter（分析期副作用 + 末次读被冻结成「确定值」
  // ⇒ dts 面自信错值）；直接投影 unknown。
  if (fallback.term === undefined) return fallback;
  const acc = lookupObjAccessor(a, k);
  if (!acc?.get) return fallback;
  try {
    return acc.get(a);
  } catch {
    return unknown;
  }
}

/**
 * Abs → TS 类型串。有损：pred / 非 lit term 落到 shape 基类型。
 * `typeVars`：term var id → TS 类型参数名（HOF 泛型投影时传入；
 * `any`+var 在此映射下渲染为该参数名，否则 `unknown`）。
 */
export function absToTSType(a: Abs, typeVars?: Map<string, string>): string {
  return absToTSTypeB(a, typeVars, new ProjectionBudget());
}

function absToTSTypeB(a: Abs, typeVars: Map<string, string> | undefined, budget: ProjectionBudget): string {
  // DESIGN-001：环 / 超深 shape 截断为显式标记（合法 TS，tsc 门可过）
  const stop = budget.enter(a);
  if (stop === "cycle") return TS_TRUNC.cycle;
  if (stop === "depth") return TS_TRUNC.depth;
  try {
    const text = absToTSTypeInner(a, typeVars, budget);
    // BUG-392：`Object.freeze` 的返回值在引擎里是 frozen 侧表状态；dts 面
    // 必须带上 readonly 维度（对象 ⇒ Readonly<T>，数组/元组 ⇒ readonly T）。
    if (a.facets?.frozen !== true && extStateOf(a) !== "frozen") return text;
    if (a.shape.k === "obj") return `Readonly<${text}>`;
    if (a.shape.k === "arr" || a.shape.k === "tuple") return `readonly ${text}`;
    return text;
  } finally {
    budget.exit();
  }
}

/**
 * 内建**泛型** brand → TS 类型串（Bug 521）。
 *
 * TS 里 `Map` / `Set` / `WeakMap` / `WeakSet` / `Array` / `Promise` … 是泛型：
 * 裸名缺类型实参 ⇒ **TS2314**（整份 `.d.ts` 编译不过）。内建 brand 的实例
 * 形状不带 K/V 证据（core 侧 brand 形状是 `objOf({})`）⇒ 实参落到最宽的
 * 合法值（`unknown`；`WeakMap` / `WeakSet` 的键位受 `WeakKey` 约束 ⇒ `object`）。
 *
 * 用户类 brand 走 `declare class` 路径（Bug 517）——不在本表内，原样保留类名。
 */
const BUILTIN_GENERIC_BRANDS = new Map<string, string>([
  ["Map", "Map<unknown, unknown>"],
  ["ReadonlyMap", "ReadonlyMap<unknown, unknown>"],
  ["WeakMap", "WeakMap<object, unknown>"],
  ["Set", "Set<unknown>"],
  ["ReadonlySet", "ReadonlySet<unknown>"],
  ["WeakSet", "WeakSet<object>"],
  ["Array", "Array<unknown>"],
  ["Promise", "Promise<unknown>"],
  ["Generator", "Generator<unknown>"],
  ["AsyncGenerator", "AsyncGenerator<unknown>"],
  ["Iterator", "Iterator<unknown>"],
  ["Iterable", "Iterable<unknown>"],
  ["IterableIterator", "IterableIterator<unknown>"],
  ["AsyncIterator", "AsyncIterator<unknown>"],
  ["AsyncIterable", "AsyncIterable<unknown>"],
  ["AsyncIterableIterator", "AsyncIterableIterator<unknown>"],
]);

/**
 * Bug 233：brand 类名的解析口径（**当前投影作用域**内可解析的类名）。
 *
 * - `undefined` = 无模块面的**纯投影**（`absToTSType` 单值投影）⇒ 保持原样：
 *   类名原样输出（纯投影没有声明面，无从判断该名在产物里是否可解析）。
 * - 有模块面 ⇒ 只有**产物里可解析**的类名才保留：本地声明的类（`declare class`
 *   合成）/ 已 import 的类（补 `import type`）/ TS 全局类型名（与 zod 白名单同
 *   名单）。其余（用户类 brand 来自未声明的名字）**降级为 unknown**——产物里
 *   出现「从未声明的类型名」会让消费方 tsc 报 TS2304（Bug 233）。
 */
type BrandScope = {
  /** 产物里可解析的类名 */
  names: ReadonlySet<string>;
  /**
   * 类名 → **必填**类型形参的占位实参（按声明顺序）。
   *
   * BUG-040：`class Box<T>` 在返回位被投影成裸 `Box` ⇒ 产物 TS2314（Generic
   * type 'Box<T>' requires 1 type argument(s)）。内建泛型早就在
   * `BUILTIN_GENERIC_BRANDS` 里补了 `unknown` 实参，用户类缺这一档。只对
   * **必填**形参补（有默认值的 `class Box<T = string>` 裸名合法，保持逐字
   * 不变——既有回归钉的就是这一半）。
   *
   * 回归修正：占位实参不能一律 `unknown`——`class C<T extends string>` 会被
   * 填成 `C<unknown>` ⇒ 消费端 TS2344（`unknown` 不满足约束）。无约束 ⇒
   * `unknown`；约束自包含 ⇒ 约束原文（`C<string>`）；否则 `any`（TS 的
   * `any` 满足任意约束，不会把「不可解析」变成编译错误）。
   */
  requiredArgFillers: ReadonlyMap<string, readonly string[]>;
};

let currentBrandScope: BrandScope | undefined;

/** 在给定 brand 解析口径下投影（作用域内恢复旧口径） */
function withBrandScope<T>(scope: BrandScope, fn: () => T): T {
  const prev = currentBrandScope;
  currentBrandScope = scope;
  try {
    return fn();
  } finally {
    currentBrandScope = prev;
  }
}

/**
 * Bug 77：模块级 `as const` 值声明通道专享的只读渲染开关。
 * 只在 `dtsValueDeclarations` 对 `as const` 绑定开启 ⇒ 对象槽渲染
 * `readonly k: …`；不影响其它任何 `absToTSType` 调用（返回位 / 参数位 /
 * 单值投影一律保持既有文本，避免把报告未列的既有行为改坏）。
 */
let currentReadonlySlots = false;
function withReadonlySlots<T>(fn: () => T): T {
  const prev = currentReadonlySlots;
  currentReadonlySlots = true;
  try {
    return fn();
  } finally {
    currentReadonlySlots = prev;
  }
}

/**
 * BUG-236：对象字面量 **symbol 方法**的返回注解文本（`[Symbol.iterator]():
 * Iterator<number>`）。
 *
 * 泛型 / 别名注解不映射成 Abs 形状（core `absShapeForTsTypeText` 只映射 JS
 * 一等类型）⇒ 经 Abs 叠加拿不到返回类型，symbol 成员行只能发 `unknown`，
 * 消费方 `[...obj]` 仍被 TS2488 挡住（可迭代判定要的是迭代器返回类型）。
 * 与 `currentReadonlySlots` 同一机制：只在渲染这一份值声明时生效。
 */
let currentSymbolReturnOverrides: ReadonlyMap<string, string> | undefined;
function withSymbolReturnOverrides<T>(overrides: ReadonlyMap<string, string> | undefined, fn: () => T): T {
  if (overrides === undefined || overrides.size === 0) return fn();
  const prev = currentSymbolReturnOverrides;
  currentSymbolReturnOverrides = overrides;
  try {
    return fn();
  } finally {
    currentSymbolReturnOverrides = prev;
  }
}

/**
 * BUG-263：用户符号成员键的源码名队列（按对象字面量属性顺序消费）。
 * well-known symbol 不消费本队列（它们有稳定映射）。
 */
let currentUserSymbolKeys: string[] | undefined;
function withUserSymbolKeys<T>(keys: readonly string[] | undefined, fn: () => T): T {
  if (keys === undefined || keys.length === 0) return fn();
  const prev = currentUserSymbolKeys;
  currentUserSymbolKeys = [...keys];
  try {
    return fn();
  } finally {
    currentUserSymbolKeys = prev;
  }
}

/**
 * BUG-271：对象字面量方法 / 箭头值的**返回注解原文**（`Promise<number>` 等）。
 *
 * Abs 的 fn shape 只能承载 Shape 可映射的返回类型；`Promise<number>` / 具名
 * 别名 / `string | null` 被 Shape 闸门丢成 `unknown`。源码注解在采集期已有，
 * 渲染时按成员键覆盖返回位文本。
 */
let currentObjectFnReturnOverrides: ReadonlyMap<string, string> | undefined;
function withObjectFnReturnOverrides<T>(overrides: ReadonlyMap<string, string> | undefined, fn: () => T): T {
  if (overrides === undefined || overrides.size === 0) return fn();
  const prev = currentObjectFnReturnOverrides;
  currentObjectFnReturnOverrides = overrides;
  try {
    return fn();
  } finally {
    currentObjectFnReturnOverrides = prev;
  }
}

/**
 * 模块面可解析的类名（本地声明的类 + 已 import 的类）——brand 类名只在这里
 * 列出的名字下才允许进产物。
 */
function brandScopeOf(surface: DtsModuleSurface | undefined): BrandScope {
  const names = new Set<string>();
  const requiredArgFillers = new Map<string, readonly string[]>();
  if (!surface) return { names, requiredArgFillers };
  for (const [name, cls] of surface.classes) {
    names.add(name);
    const fillers = requiredTypeArgFillers(cls.typeParamsText, cls.typeParams, surface);
    if (fillers.length > 0) requiredArgFillers.set(name, fillers);
  }
  // 导入类的形参个数要看被导入模块，模块面拿不到 ⇒ 只能原样（与旧口径一致）。
  for (const name of surface.imports?.keys() ?? []) names.add(name);
  return { names, requiredArgFillers };
}

/**
 * 顶层切分（忽略 `<>` / `()` / `[]` / `{}` 内的分隔符）。
 * 类型形参子句里常见 `T extends Record<string, unknown>` —— 逗号在实参里，
 * 不能就地 split。
 */
function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "<" || ch === "(" || ch === "[" || ch === "{") depth++;
    // 箭头函数 `=>`（`T extends (x: number) => string, U`）里的 `>` 是运算符
    // 而不是闭合括号：当成闭合会把 depth 减成负数，后续 `,` 全被当成实参内
    // 分隔符 ⇒ 第二个形参 `U` 从子句里消失（形参名 / 返回位引用被误判未声明）。
    else if (
      (ch === ">" && text[i - 1] !== "=") ||
      ch === ")" ||
      ch === "]" ||
      ch === "}"
    ) {
      depth--;
    }
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** 类型形参子句里的形参名（`<T, U extends X = Y>` ⇒ `["T","U"]`） */
function typeParamNamesInClause(clause: string | undefined): string[] {
  if (!clause) return [];
  const trimmed = clause.trim();
  if (!/^</.test(trimmed)) return [];
  const inner = trimmed.slice(1, trimmed.lastIndexOf(">") >= 0 ? trimmed.lastIndexOf(">") : undefined);
  return splitTopLevel(inner, ",")
    .map((p) => /^(?:(?:const|in|out)\s+)*([A-Za-z_$][\w$]*)/.exec(p.trim())?.[1])
    .filter((n): n is string => n !== undefined);
}

/**
 * BUG-195：源码类型形参子句 + HOF 推导子句 → 一条子句（源码在前，去重）。
 *
 * HOF 分支的自由变元（`B_f`）来自 Abs 域，那里**没有**「源码声明的类型形参」
 * 这个维度 ⇒ 只发 HOF 子句会把 `<U>` 整段抹掉，而形参注解仍原样引用 `U`
 * （TS2304）。两者必须并存（`<U, B_f>`）。
 */
function mergeTypeParamClauses(srcClause: string, derived: readonly string[]): string {
  if (derived.length === 0) return srcClause;
  const declared = typeParamNamesInClause(srcClause);
  const extra = derived.filter((n) => !declared.includes(n));
  if (extra.length === 0) return srcClause;
  if (srcClause === "") return `<${extra.join(", ")}>`;
  // 子句是**一个**尖括号组（`<U>`），推导变元必须并进同一条，不能并列成
  // `<U><B_f>`（那是两个类型形参子句，整份产物解析失败）。
  const close = srcClause.lastIndexOf(">");
  if (!/^</.test(srcClause) || close < 0) return srcClause;
  return `${srcClause.slice(0, close)}, ${extra.join(", ")}>`;
}

/**
 * 类型形参声明里是否有**默认值**（顶层 `=`，不是箭头 `=>`）。
 *
 * `T extends (x: number) => string` 的 `=` 属于箭头类型：按裸 `=` 切分会把它
 * 误判成「有默认值 ⇒ 可省」⇒ 裸类名不补实参（TS2314）。
 */
function typeParamHasDefault(text: string): boolean {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "<" || ch === "(" || ch === "[" || ch === "{") depth++;
    else if (
      (ch === ">" && text[i - 1] !== "=") ||
      ch === ")" ||
      ch === "]" ||
      ch === "}"
    ) {
      depth--;
    } else if (ch === "=" && depth === 0 && text[i + 1] !== ">") return true;
  }
  return false;
}

/**
 * 裸类名的**必填**类型形参占位实参（BUG-040 + 约束修正）。
 *
 * `class Box<T>` 被投影成裸 `Box` ⇒ TS2314，缺什么补什么；但 `unknown` 会
 * 违反声明里的约束（`class C<T extends string>` ⇒ `C<unknown>` 是 TS2344）：
 * - 无约束 ⇒ `unknown`（无信息，TS 的 top）；
 * - 约束自包含（只引用 TS 内建 / 产物里可解析的名字，且不引用本类自己的
 *   其它形参）⇒ 约束原文（`C<string>`）；
 * - 否则 ⇒ `any`（满足任意约束；比让整份产物编译失败可诊断）。
 */
function requiredTypeArgFillers(
  clause: string | undefined,
  names: readonly string[] | undefined,
  surface: DtsModuleSurface | undefined,
): string[] {
  const fallback = (): string[] => (names ?? []).map(() => "unknown");
  if (!clause) return fallback();
  const trimmed = clause.trim();
  if (!/^</.test(trimmed)) return fallback();
  const lastClose = trimmed.lastIndexOf(">");
  const inner = trimmed.slice(1, lastClose >= 0 ? lastClose : undefined);
  const ownNames = new Set(names ?? typeParamNamesInClause(clause));
  const out: string[] = [];
  for (const part of splitTopLevel(inner, ",")) {
    const text = part.trim();
    if (text === "") continue;
    // 有默认值的形参可省略 ⇒ 不补实参（`class Box<T = string>` 裸名合法）
    if (typeParamHasDefault(text)) continue;
    const m = /^(?:(?:const|in|out)\s+)*[A-Za-z_$][\w$]*\s+extends\s+([\s\S]+)$/.exec(text);
    const constraint = m?.[1]?.trim();
    if (!constraint) {
      out.push("unknown");
      continue;
    }
    // 引用本类其它形参（`U extends T`）在裸名使用点不在作用域里 ⇒ any。
    const selfContained = annotationTypeRefs(constraint).every(
      (n) => !ownNames.has(n) && isTypeNameResolvable(n, surface),
    );
    out.push(selfContained ? constraint : "any");
  }
  return out;
}

/**
 * brand 名 → TS 类型串（内建泛型补实参；用户类原样；非法名 → unknown）。
 *
 * Bug 233：模块面作用域内，**类名必须在产物里可解析**才原样输出（否则消费方
 * tsc TS2304）——不可解析的类名降级为 `unknown`（降级台账见 `projectModuleDts`）。
 * TS 全局类型名（Date / RegExp / Error / URL …）与 zod 白名单**同名单**
 * （族 15 S11 的 zod 白名单同源）——它们在 TS 里是环境内建类型名，无需声明。
 */
function brandTSType(name: string): string {
  const alias = BRAND_TYPE_ALIASES.get(name);
  if (alias !== undefined) return alias;
  const builtin = BUILTIN_GENERIC_BRANDS.get(name);
  if (builtin !== undefined) return builtin;
  if (!isJsBindingIdent(name) && !/^[A-Z][A-Za-z0-9_$]*$/.test(name)) return "unknown";
  const scope = currentBrandScope;
  if (scope === undefined) return name;
  if (scope.names.has(name)) {
    // BUG-040：必填类型形参必须补实参（TS2314）——占位实参按约束选择
    // （`unknown` 违反 `T extends string` ⇒ TS2344；见 `requiredTypeArgFillers`）。
    const fillers = scope.requiredArgFillers.get(name);
    if (!fillers || fillers.length === 0) return name;
    return `${name}<${fillers.join(", ")}>`;
  }
  if (isRuntimeGlobalCtorName(name)) return name;
  return "unknown";
}

/** 规范数组下标（"0" / "12"；无前导零）——生成器的元素槽位 */
const CANONICAL_INDEX = /^(?:0|[1-9]\d*)$/;

/**
 * 迭代器 / 生成器形态 → TS 类型串（Bug 554）；不是迭代器 ⇒ undefined。
 *
 * Abs 里生成器对象是「带**内部协议槽**的 obj」：`next` / `return` / `throw` /
 * `constructor` / `@@iterator`（async 则是 `@@asyncIterator`）+ **数字下标元素
 * 槽**（族 01 口径：`g[0]` 折 yield 值）。逐槽摊平 ⇒ 返回类型里没有
 * `[Symbol.iterator]()` ⇒ 消费方 `for (const v of gen(1))` 报 **TS2488**
 * （产物拒绝实现本身允许的用法）。
 *
 * 元素类型取数字下标元素槽的 join（返回位协变口径：顶层字面量 → 基类型）；
 * 无元素槽 ⇒ `unknown`。
 */
function iteratorTSType(
  a: Abs,
  typeVars: Map<string, string> | undefined,
  budget: ProjectionBudget,
): string | undefined {
  if (a.shape.k !== "obj") return undefined;
  const slots = a.shape.slots;
  // A11 · 槽位启用：随值携带的生成器身份优先于 `next` 槽启发式——重建 /
  // 快照产物可能丢内部协议槽，但 `facets.brand` 随 Abs 搬运。泛型实参仍由
  // 下方数字下标槽推导 ⇒ 输出恒为 `Generator<T>` / `AsyncGenerator<T>`，
  // 不会退化成裸名（TS2314，见 BUILTIN_GENERIC_BRANDS）。
  const carried = a.facets?.brand;
  const genBrand =
    carried === "Generator" || carried === "AsyncGenerator" ? carried : undefined;
  // 无 `next` 且无 brand ⇒ 不是迭代器（普通对象 / 仅可迭代对象仍走结构面）
  if (!slots["next"] && !genBrand) return undefined;
  // 「第三种」：元素域的**单一真值来源**是随值携带的 `facets.genElements`
  // （完整 yield 序列，未经过 $arr widen）。此前靠 `CANONICAL_INDEX` 扫
  // shape 数字下标槽反推语义，快照 / harvest 重建 / 跨包搬运后槽会折损。
  // **严格 fallback**：字段为 undefined（手工构造 / 静态收割 / 旧 Abs）时
  // 仍走数字槽 ⇒ 旧产物逐字不变（`emit-bug-130` 等负控制保持绿）。
  const carriedElems = a.facets?.genElements;
  const elems: Abs[] = carriedElems ? [...carriedElems] : [];
  if (!carriedElems) {
    for (const [k, slot] of Object.entries(slots)) {
      if (!CANONICAL_INDEX.test(k)) continue;
      elems.push(slot.value);
    }
  }
  let elemType = "unknown";
  if (elems.length > 0) {
    let joined: Abs;
    try {
      joined = elems.reduce((x, y) => joinAbs(x, y));
    } catch {
      joined = elems[0]!;
    }
    elemType = absToTSTypeB(widenTopLevelAbs(joined), typeVars, budget);
  }
  // A11 残余：随值携带 TReturn 时补第 2 类型实参；TNext 只有**显式携带**
  // 时才补第 3 实参（引擎不建模 `.next(v)` 入参 ⇒ 生产侧填最保守的
  // `unknown`，与 TS 默认值类型等价）。输出恒带 `<…>`，不退化成裸名
  // （TS2314）。手工构造 / 无 facets 的旧 Abs 仍输出 `Generator<T>` 或
  // `Generator<T, TReturn>` 逐字不变。
  const tReturn = a.facets?.genReturn
    ? absToTSTypeB(widenTopLevelAbs(a.facets.genReturn), typeVars, budget)
    : undefined;
  const tNext = a.facets?.genNext
    ? absToTSTypeB(widenTopLevelAbs(a.facets.genNext), typeVars, budget)
    : undefined;
  // 第 3 实参只有在第 2 实参存在时才有位置（TS 位置类型参数不可跳位）；
  // 缺省 TReturn 时按 TS 默认值省略整段尾部。
  const tail = tReturn
    ? tNext
      ? `, ${tReturn}, ${tNext}`
      : `, ${tReturn}`
    : "";
  if (genBrand === "AsyncGenerator" || slots["@@asyncIterator"]) {
    return `AsyncGenerator<${elemType}${tail}>`;
  }
  // 完整生成器协议（return / throw）或随值 brand ⇒ Generator；只有 next ⇒ 普通迭代器
  if (genBrand === "Generator" || slots["return"] || slots["throw"]) {
    return `Generator<${elemType}${tail}>`;
  }
  return `IterableIterator<${elemType}>`;
}

/** 引擎的符号键投影（`"@@X"`）→ TS 符号键成员名 */
const WELL_KNOWN_SYMBOLS = new Map<string, string>([
  ["@@iterator", "Symbol.iterator"],
  ["@@asyncIterator", "Symbol.asyncIterator"],
  ["@@toStringTag", "Symbol.toStringTag"],
  ["@@toPrimitive", "Symbol.toPrimitive"],
  ["@@hasInstance", "Symbol.hasInstance"],
  ["@@isConcatSpreadable", "Symbol.isConcatSpreadable"],
  ["@@match", "Symbol.match"],
  ["@@matchAll", "Symbol.matchAll"],
  ["@@replace", "Symbol.replace"],
  ["@@search", "Symbol.search"],
  ["@@species", "Symbol.species"],
  ["@@split", "Symbol.split"],
  ["@@unscopables", "Symbol.unscopables"],
]);

/**
 * BUG-216 / BUG-236：计算键里的 **well-known symbol** → 引擎符号键名
 * （`Symbol.iterator` → `"@@iterator"`）。
 *
 * `Symbol.iterator` 是静态 well-known 名字，不是动态键——TS 有 `[Symbol.x]`
 * 成员语法，漏掉这类键等于把运行期真实存在的公开成员整条删掉。未登记的
 * `Symbol.xxx`（用户符号）TS 没有对应语法 ⇒ 返回 undefined（不猜）。
 */
function surfaceSymbolKeyName(n: SurfaceNode | undefined): string | undefined {
  if (!n || n.type !== "MemberExpression" || n.computed === true) return undefined;
  const obj = n.object as SurfaceNode | undefined;
  const prop = surfaceName(n.property as SurfaceNode | undefined);
  if (obj?.type !== "Identifier" || obj.name !== "Symbol" || prop === undefined) return undefined;
  const engineKey = `@@${prop}`;
  return WELL_KNOWN_SYMBOLS.has(engineKey) ? engineKey : undefined;
}

/**
 * 符号键槽 → TS 符号键成员行（`[Symbol.iterator](): T`）；未登记的符号键 ⇒
 * undefined（TS 没有任意 symbol 键的类型语法 ⇒ 有损跳过）。
 */
function symbolMemberLine(
  k: string,
  slot: { value: Abs },
  typeVars: Map<string, string> | undefined,
  budget: ProjectionBudget,
): string | undefined {
  // BUG-263：用户 `Symbol()` 键的 Abs 槽是引擎内部 id（`@@sym#N`）；按属性
  // 出现序从源码名队列取绑定名（`{ [tag]: 1 }` ⇒ `[tag]`）。
  const userKey =
    WELL_KNOWN_SYMBOLS.has(k) || !k.startsWith("@@sym#")
      ? undefined
      : currentUserSymbolKeys?.shift();
  const sym = WELL_KNOWN_SYMBOLS.get(k) ?? userKey;
  if (sym === undefined) return undefined;
  const v = slot.value;
  if (v.shape.k === "fn") {
    // 方法形态：`[Symbol.iterator](): T`（TS 的可迭代判定要方法签名）
    const ret = v.shape.returnType
      ? absToTSTypeB(v.shape.returnType, typeVars, budget)
      : // BUG-236：泛型 / 别名返回注解不映射 Abs（见 withSymbolReturnOverrides）
        (currentSymbolReturnOverrides?.get(k) ?? "unknown");
    return `[${sym}](): ${ret}`;
  }
  return `[${sym}]: ${absToTSTypeB(v, typeVars, budget)}`;
}

/**
 * BUG-271：把对象字面量方法的返回位换成源码注解原文（只替换 `=>` 之后的
 * 返回类型；形参面保持 Abs 投影）。
 */
function applyObjectFnReturnOverride(key: string, ts: string): string {
  const override = currentObjectFnReturnOverrides?.get(key);
  if (override === undefined) return ts;
  // 只替换**外层**函数类型的返回位：返回类型本身可能是对象 / 函数类型，
  // 里面还有嵌套 `=>`（`() => { get: () => number }`）⇒ lastIndexOf 会把
  // 内层返回位改掉，得到 `getMilliseconds: () => Date` 这类错形。
  let depth = 0;
  for (let i = 0; i < ts.length - 1; i++) {
    const ch = ts[i]!;
    if (ch === "(" || ch === "[" || ch === "{" || ch === "<") depth++;
    else if (ch === ")" || ch === "]" || ch === "}" || (ch === ">" && ts[i - 1] !== "=")) depth--;
    if (depth === 0 && ch === "=" && ts[i + 1] === ">") {
      return `${ts.slice(0, i + 2)} ${override}`;
    }
  }
  return ts;
}

function absToTSTypeInner(a: Abs, typeVars: Map<string, string> | undefined, budget: ProjectionBudget): string {
  // 类型变量：shape any + term var（α / B:param）
  if (a.shape.k === "any" && a.term?.op === "var" && typeVars) {
    const mapped = typeVars.get(a.term.id);
    if (mapped) return mapped;
  }
  // arr(element=any+var) → T[]
  if (
    a.shape.k === "arr" &&
    a.shape.element.shape.k === "any" &&
    a.shape.element.term?.op === "var" &&
    typeVars
  ) {
    const mapped = typeVars.get(a.shape.element.term.id);
    if (mapped) return `${mapped}[]`;
  }

  if (a.term?.op === "lit") {
    const v = a.term.value;
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    if (a.shape.k === "prim") {
      if (typeof v === "string") return JSON.stringify(v);
      if (typeof v === "boolean") return String(v);
      if (typeof v === "number") {
        // NaN/±Infinity 不是 TS 类型名；投影到基类型 number
        if (!Number.isFinite(v)) return "number";
        return String(v);
      }
    }
  }

  // 模板串：prim(string) + template pred
  if (a.shape.k === "prim" && a.shape.type === "string" && isTemplateLike(a)) {
    const parts = templatePartsOf(a);
    const inner = parts
      .map((p) => {
        const lvR = litValue(p);
        const lv = lvR.ok ? lvR.value : undefined;
        // 固定段是嵌入语言：`\` `` ` `` `$` 必须转义，否则 `${` 变成类型插值
        if (typeof lv === "string") return escapeTemplateTypeFixed(lv);
        return `\${${tsTplSafe(absToTSTypeB(p, typeVars, budget))}}`;
      })
      .join("");
    return `\`${inner}\``;
  }

  switch (a.shape.k) {
    case "never":
      return "never";
    case "unknown":
      // Abs unknown = **推断失败**（引擎没有信息）→ TS unknown（消费方必须先收窄）
      return "unknown";
    case "any":
      // 2026-11-06 产品裁定：nudo 的 `any` 是「无约束并集 / 任意值」，语义
      // 更接近 **TS 的 unknown（top，需先收窄）**，而不是 TS 的 `any`（关闭
      // 类型检查的逃生舱）。三面运行时校验器早已把 any / unknown 同映为
      // unknown（schema-generator.ts / guard-generator.ts / standard-schema.ts），
      // dts 曾是唯一把 nudo any 直译成 TS any 的面。
      // `abs.md` 的「any ≠ unknown」规则约束的是 **nudo 自己的展示 / CLI 面**
      // （两个产品概念不得合并），不是 TS 投影面；BUG-544 把 TS2571 当假红，
      // 按本裁判定性为**正确的类型安全提示**（无约束返回值理应先收窄）。
      return "unknown";
    case "prim":
      return a.shape.type;
    case "obj": {
      // Bug 554：迭代器 / 生成器形态——Abs 里生成器对象是「带**内部协议槽**的
      // obj」（next / return / throw / constructor / @@iterator + 数字下标元素
      // 槽）。逐槽摊平 ⇒ 返回类型里没有 `[Symbol.iterator]()` ⇒ 消费方
      // `for (const v of gen(1))` 报 TS2488（产物拒绝实现本身允许的用法）。
      const iter = iteratorTSType(a, typeVars, budget);
      if (iter !== undefined) return iter;
      // BUG-258：**数组视图**（`view: "array"`，RegExpExecArray 等）必须投影成
      // **数组类型**。逐槽摊平得到的是对象字面量类型（`{ "0": "abc"; … }`）⇒
      // 消费方 `.map` / 下标读全报 TS2339，而同一份 Abs 在 guard / standard 面
      // 要求 `Array.isArray`（产物与判据五面矛盾）。
      // 下标槽（规范数组下标）→ 元组元素（洞位无语法可表 ⇒ `undefined`，与读值
      // 同形）；`length` 由元组自带，不重复写；`index` / `input` / `groups` 等
      // 引擎附带的**自有**槽 → 元组与对象类型的交集（`.map` 等数组成员仍可用）。
      if (a.shape.view === "array") {
        const idxNums = Object.keys(a.shape.slots)
          .filter((k) => CANONICAL_INDEX.test(k))
          .map(Number)
          .sort((x, y) => x - y);
        let arrayPart = "unknown[]";
        if (idxNums.length > 0) {
          const elems: string[] = [];
          for (let i = 0; i <= idxNums[idxNums.length - 1]!; i++) {
            const key = String(i);
            const slot = a.shape.slots[key];
            elems.push(
              slot === undefined
                ? "undefined"
                : wrapComplexAbs(slotAbsOf(a, key, slot.value), typeVars, budget),
            );
          }
          arrayPart = `[${elems.join(", ")}]`;
        }
        const sideEntries: string[] = [];
        for (const [k, slot] of Object.entries(a.shape.slots)) {
          if (CANONICAL_INDEX.test(k) || k === "length") continue;
          // BUG-236：symbol 键槽在 **dts** 面是公开成员（TS 有 `[Symbol.x]`
          // 语法），不适用 `isHiddenInternalSlot` 的「字符串键枚举面不可见」
          // 判据——旧顺序先过滤后分流 ⇒ 分支不可达，`[Symbol.iterator]` /
          // `[Symbol.toStringTag]` 整条丢失。分流必须在过滤之前。
          if (slot.symbolKey === true) {
            // 数组视图的元组部分**本身就是数组类型** ⇒ `[Symbol.iterator]`
            // 由数组类型提供；再发一条合成成员只会把元素域写成 `unknown`
            // （与 tuple 元素域自相矛盾）。
            if (k === "@@iterator") continue;
            const line = symbolMemberLine(k, slot, typeVars, budget);
            if (line !== undefined) sideEntries.push(line);
            continue;
          }
          if (isHiddenInternalSlot(k, slot)) continue;
          const slotAbs = slotAbsOf(a, k, slot.value);
          const base = absToTSTypeB(slotAbs, typeVars, budget);
          const inner =
            slotAbs.shape.k === "fn" ? applyObjectFnReturnOverride(k, base) : base;
          const ro = currentReadonlySlots || slot.readonly === true ? "readonly " : "";
          sideEntries.push(
            slot.optional
              ? `${ro}${formatPropKey(k)}?: ${
                  slotAbs.shape.k === "fn"
                    ? applyObjectFnReturnOverride(
                        k,
                        wrapComplexAbs(slotAbs, typeVars, budget),
                      )
                    : wrapComplexAbs(slotAbs, typeVars, budget)
                }`
              : `${ro}${formatPropKey(k)}: ${inner}`,
          );
        }
        return sideEntries.length === 0 ? arrayPart : `${arrayPart} & { ${sideEntries.join("; ")} }`;
      }
      const entries: string[] = [];
      for (const [k, slot] of Object.entries(a.shape.slots)) {
        // BUG-236：symbol 键槽是 TS 的**符号键成员**（见上），必须先于
        // `isHiddenInternalSlot` 分流，否则整条成员丢失。
        if (slot.symbolKey === true) {
          const line = symbolMemberLine(k, slot, typeVars, budget);
          if (line !== undefined) entries.push(line);
          continue;
        }
        // Bug 240 / 554：内部槽（internal）不是用户可见属性（私有字段 `#x` /
        // 生成器协议槽）⇒ 不进结构字段（与 core 的 format / projection / denote
        // 三面**同判据**：internal 且键不是规范数组下标）。
        if (isHiddenInternalSlot(k, slot)) continue;
        // Bug 543 / 560：optional 槽渲染成 TS 的**可选属性** `k?: T`。
        // 旧口径 `k: T | undefined` 在 TS 里是「**键必需**、值可为 undefined」——
        // 与顶层形参的 `k?: T` 口径相反，且比契约 / zod / standard / check
        // 四个面都**严**（投影方向反了：one-way 投影不得更严）。TS 里「键可省略」
        // 是独立的语法位，只有 `?` 能表达。
        // Bug 191：访问器键的槽是 `$lit(void 0)` 占位（真 getter 住侧表）——
        // dts 投影须取 getter 读域，否则把 getter 的返回值谎报成 exact
        // `undefined`。
        const slotAbs = slotAbsOf(a, k, slot.value);
        // BUG-075：契约面的槽位字面量住在 **pred**（`eq(k, lit("n"))`），
        // 不在 term ⇒ 只读 absToTSType 会把判别键拓宽成 `string`，
        // `{ k: "n"; v: number } | { k: "s"; v: string }` 的判别联合退化成
        // 交叉积，消费方接受 check 判红的值。契约字面量集优先。
        const litTs = contractLiteralTSType(slotAbs);
        const base = litTs ?? absToTSTypeB(slotAbs, typeVars, budget);
        const inner =
          slotAbs.shape.k === "fn" ? applyObjectFnReturnOverride(k, base) : base;
        // Bug 77：`as const` 值声明通道 ⇒ 对象槽按只读投影（`readonly k: …`）。
        // BUG-233：`slot.readonly` 是**分析面**带下来的事实（getter-only ⇒
        // 只读），与 `as const` 通道相互独立——两者任一成立都要发 readonly。
        const ro = currentReadonlySlots || slot.readonly === true ? "readonly " : "";
        if (slot.optional) {
          const baseOpt = litTs ?? wrapComplexAbs(slotAbs, typeVars, budget);
          const t =
            slotAbs.shape.k === "fn"
              ? applyObjectFnReturnOverride(k, baseOpt)
              : baseOpt;
          entries.push(`${ro}${formatPropKey(k)}?: ${t}`);
          continue;
        }
        entries.push(`${ro}${formatPropKey(k)}: ${inner}`);
      }
      // BUG-383：索引签名（open 对象的运行时键值域）→ TS 索引签名。
      if (a.shape.index) {
        const key = absToTSTypeB(a.shape.index.key, typeVars, budget);
        const value = absToTSTypeB(a.shape.index.value, typeVars, budget);
        entries.push(`[key: ${key}]: ${value}`);
      }
      // Bug 565：零成员对象**不是** TS 的 `{}`（= 任意非 nullish 值）⇒ 渲染成
      // `Record<string, never>`（空对象类型）：属性读合法（不再 TS2339 假红），
      // 且在联合类型里**不吸收** `{ a: number }`（`{}` 会把契约义务整个吃掉）。
      if (entries.length === 0) {
        return a.shape.open === true ? "Record<string, unknown>" : "Record<string, never>";
      }
      return `{ ${entries.join("; ")} }`;
    }
    case "arr":
      return `${wrapComplexAbs(a.shape.element, typeVars, budget)}[]`;
    case "tuple": {
      // hole 槽（`1 in a` 为 false）不得伪装成显式 undefined 元素。
      // TS 元组类型无空槽语法，用 labeled element `hole: T` 标出稀疏位。
      const holes = a.shape.holes ?? [];
      const parts = a.shape.elements.map((e, i) => {
        const ts = absToTSTypeB(e, typeVars, budget);
        return holes.includes(i) ? `hole: ${ts}` : ts;
      });
      if (a.shape.rest) {
        const rest = a.shape.rest;
        // rest 元素类型位与 arr 元素位同口径：union/fn 必须括号，
        // 否则 `...number | string[]` / `...(x) => T[]` 语义不同或非法
        const restTs =
          rest.shape.k === "arr"
            ? absToTSTypeB(rest, typeVars, budget)
            : `${wrapComplexAbs(rest, typeVars, budget)}[]`;
        parts.push(`...${restTs}`);
      }
      // Bug 77 / BUG-140：`as const` 通道下元组是**只读**的（`readonly [1, 2]`）。
      // 此前只读开关只接了对象槽与数组视图侧槽 ⇒ 冻结元组照样可写、可 `push`，
      // 作者声明的只读契约被无声撤销（消费方 `arr[0] = 1` 反而编译通过）。
      return `${currentReadonlySlots ? "readonly " : ""}[${parts.join(", ")}]`;
    }
    case "fn": {
      // A6/ABS-03：重载集 → TS 调用签名对象（声明序 = TS 解析序）。
      // 逐 arm 发射保留「形参 ↔ 返回」的相关性；无重载集时退回单签名面。
      const overloads = a.shape.overloads;
      if (overloads && overloads.length > 0) {
        const arms = overloads.map((arm) => {
          const params = arm.paramTypes
            .map((pt, i) => `a${i}: ${absToTSTypeB(pt, typeVars, budget)}`)
            .join(", ");
          const ret = absToTSTypeB(arm.returnType, typeVars, budget);
          return `(${params}): ${ret}`;
        });
        return `{ ${arms.join("; ")} }`;
      }
      const paramTypes = a.shape.paramTypes;
      const params = a.shape.params
        .map((p, i) => {
          const isRest = p.startsWith("...");
          const name = sanitizeParamName(p, i);
          const pt = paramTypes?.[i];
          let typeStr: string;
          if (pt) {
            if (isRest) {
              // rest 位必须是数组类型（TS：A rest parameter must be of an
              // array type）——非 arr（sum/tuple/fn/prim…）提升为 (T)[]，
              // 与 tuple rest 位同口径（BUG-020/S6-005：旧实现直接拼接，
              // `...args: number | string` 非法 TS）
              typeStr =
                pt.shape.k === "arr"
                  ? absToTSTypeB(pt, typeVars, budget)
                  : `${wrapComplexAbs(pt, typeVars, budget)}[]`;
            } else {
              typeStr = absToTSTypeB(pt, typeVars, budget);
            }
          } else if (isRest) typeStr = "unknown[]";
          else typeStr = "unknown";
          return `${name}: ${typeStr}`;
        })
        .join(", ");
      const ret = a.shape.returnType
        ? absToTSTypeB(a.shape.returnType, typeVars, budget)
        : "unknown";
      return `(${params}) => ${ret}`;
    }
    case "brand":
      return brandTSType(a.shape.name);
    case "eff":
      if (a.shape.eff === "promise")
        return `Promise<${absToTSTypeB(a.shape.inner, typeVars, budget)}>`;
      return absToTSTypeB(a.shape.inner, typeVars, budget);
    case "sum": {
      // 并集成员按渲染串去重：widen 后可能出现 number | number；
      // never 是 join 单位元，对 .d.ts 返回位无意义。
      const parts = a.shape.members
        .map((m) => wrapUnionMember(m, typeVars, budget))
        .filter((p) => p !== "never");
      const uniq = [...new Set(parts)];
      if (uniq.length === 0) return "never";
      if (uniq.length === 1) return uniq[0]!;
      return uniq.join(" | ");
    }
    default:
      return "unknown";
  }
}

/** case 在参数位 i 的 Abs */
function caseArgAbs(c: CaseResult, i: number): Abs | undefined {
  return c.argAbs[i];
}

/** case 结果 Abs */
function caseResultAbs(c: CaseResult): Abs {
  return c.abs;
}

/**
 * 参数位（逆变）递归 widen：字面量/收窄 pred → 基类型，结构递归。
 * 同构元组 → array；null/undefined/never/unknown/fn 保持。
 */
function widenParamAbs(a: Abs, budget: ProjectionBudget = new ProjectionBudget()): Abs {
  // DESIGN-001：环 / 超深时原样返回（widen 是尽力精度剥离，不是正确性必需）；
  // 渲染侧 absToTSType 的预算会在同位置给出显式截断标记。
  const stop = budget.enter(a);
  if (stop) return a;
  try {
    const widened = widenParamAbsInner(a, budget);
    // facets（生成器元素域 / 数组视图身份 / 迭代器协议）随 Abs 携带，widen 造
    // 新身份时会丢 ⇒ 元素域退回 shape 数字槽，`Generator<number | string>` 塌成
    // `Generator<unknown>`。拓宽只该剥精度，不该丢身份。
    return a.facets !== undefined && widened !== a && widened.facets === undefined
      ? { ...widened, facets: a.facets }
      : widened;
  } finally {
    budget.exit();
  }
}

function widenParamAbsInner(a: Abs, budget: ProjectionBudget): Abs {
  const s = a.shape;
  switch (s.k) {
    case "prim":
      return makeAbs(s, undefined, undefined, "exact");
    case "tuple": {
      const widened = s.elements.map((el) => widenParamAbs(el, budget));
      // rest 槽必须透传/并入：`[1, ...string]` 不得塌成 `number[]`（拒绝合法值）
      const widenedRest = s.rest ? widenParamAbs(s.rest, budget) : undefined;
      const holes = s.holes;
      const first = widened[0];
      // holes 必须透传：洞/显式 undefined 是可观察不同的（`in` / Object.keys），
      // 同构退化成 array 会把稀疏位抹平成稠密元素。
      // rest 参与同构判定：只有 rest 元素与固定位同型时才退化（`[1, ...number]` → number[]）。
      if (
        !holes?.length &&
        first &&
        widened.length > 0 &&
        widened.every((el) => absToTSType(el) === absToTSType(first)) &&
        (!widenedRest || absToTSType(widenedRest) === absToTSType(first))
      ) {
        return makeAbs({ k: "arr", element: first }, undefined, undefined, "exact");
      }
      return makeAbs(
        {
          k: "tuple",
          elements: widened,
          ...(widenedRest ? { rest: widenedRest } : {}),
          ...(holes?.length ? { holes: [...holes] } : {}),
        },
        undefined,
        undefined,
        "exact",
      );
    }
    case "arr":
      return makeAbs({ k: "arr", element: widenParamAbs(s.element, budget) }, undefined, undefined, "exact");
    case "obj": {
      const slots: Record<
        string,
        {
          value: Abs;
          optional?: boolean;
          readonly?: boolean;
          internal?: boolean;
          symbolKey?: boolean;
        }
      > = {};
      for (const [k, slot] of Object.entries(s.slots)) {
        // Bug 191：访问器键的槽是 `$lit(void 0)` 占位——**先**取 getter 读域
        // 再 widen（本分支造新对象，侧表按对象身份键控，造新后读域即丢）。
        const src = slotAbsOf(a, k, slot.value);
        // 数组视图的**下标**槽承担位置语义（渲染成元组）；`index` / `input` /
        // `groups` 这类伴生槽是引擎协议字段（每次调用的读值），不参与位置
        // 语义 ⇒ 原样保留（否则 `RegExpExecArray` 的 `index: 0` 被抹成
        // `index: number`，与产物里其余槽的口径不一致）。
        const sideSlot = s.view === "array" && !CANONICAL_INDEX.test(k) && k !== "length";
        slots[k] = {
          value: sideSlot ? src : widenParamAbs(src, budget),
          ...(slot.optional ? { optional: true } : {}),
          // BUG-233：只读标记**透传**（由声明面写入，见
          // `overlayObjectFnAnnotations`）——widen 造新槽时丢了它，getter-only
          // 就会被发布成可写。
          ...(slot.readonly === true ? { readonly: true } : {}),
          // Bug 240：internal / symbolKey 标记必须**透传**——widen 造新槽时丢了
          // 标记 ⇒ 内部槽（私有字段 / 生成器协议槽）被"提权"成用户可见字段
          // （`"#priv": number` / `"@@iterator": …`），产物面泄漏内部实现细节。
          ...(slot.internal === true ? { internal: true } : {}),
          ...(slot.symbolKey === true ? { symbolKey: true } : {}),
        };
      }
      return makeAbs(
        {
          k: "obj",
          slots,
          // BUG-258：数组视图 facet 必须透传——widen 造新 shape 时丢掉它 ⇒
          // 形参位投影回对象字面量类型（`.map` TS2339）。
          ...(s.view !== undefined ? { view: s.view } : {}),
          // BUG-383：open 对象的值域（groupBy / fromEntries 的 index 签名）
          // 必须随 widen 透传，否则 dts 退化成空对象。
          ...(s.open === true ? { open: true } : {}),
          ...(s.index !== undefined
            ? {
                index: {
                  key: widenParamAbs(s.index.key, budget),
                  value: widenParamAbs(s.index.value, budget),
                },
              }
            : {}),
        },
        undefined,
        undefined,
        "exact",
      );
    }
    case "eff":
      return makeAbs(
        { k: "eff", eff: s.eff, inner: widenParamAbs(s.inner, budget) },
        undefined,
        undefined,
        "exact",
      );
    case "brand":
      return makeAbs(
        { k: "brand", name: s.name, shape: widenParamAbs(s.shape, budget) },
        undefined,
        undefined,
        "exact",
      );
    case "sum":
      return makeAbs(
        { k: "sum", members: s.members.map((m) => widenParamAbs(m, budget)) },
        undefined,
        undefined,
        "exact",
      );
    default:
      return a;
  }
}

/**
 * 返回位拓宽：**观测值不是函数的类型**。
 *
 * 旧口径（BUG-206）只剥顶层标量字面量，依据是「返回位协变，收窄只让调用方
 * 拿到更精确的类型」。这个前提对**可变容器**不成立——观测到的元组 / 对象槽
 * 字面量是**一次调用**快照：
 * - `r1(): ["a"]` 让消费方 `r1()[1]` / `r1().push("b")` 报 TS2493 / TS2345；
 * - `r3(): { a: 1 }` 让消费方 `r3().a = 2` 报 TS2322（每次调用返回新对象）。
 *
 * `deep`（纯观测证据：call@ / entry@ 见证）⇒ 与形参位共用同一条拓宽管线
 * （`widenParamAbs`）：同构元组 → 数组、对象槽递归到基类型。
 * 作者写下的 `@nudo:case` 是**域声明**而不是观测 ⇒ 维持「嵌套精度保留」
 * （位置语义真实，字面量精度由 JSDoc 的 `Case:` 行承担）。
 *
 * BUG-209：`never` 是「这次观测抛了」的事实，不是返回类型（抛出已由独立的
 * `throws` 面表达）。把它发布成底类型会**同时**制造假红（成员访问 TS2339）
 * 与假绿（可赋给任意类型）；没有声明层证据时回到无信息域 `unknown`。
 */
/**
 * BUG-362：OOB 合成 undefined 臂是引擎的**内部**精度产物（`conf=partial` +
 * `lit(undefined)`），不是函数出口域。对外 dts 投影删除该臂；真实
 * `undefined`（作者 return / 缺失 return）的 term 同为 lit(undefined)，但
 * conf 不是 partial ⇒ 保留。
 */
function isSyntheticOobAbs(a: Abs): boolean {
  if (provenanceOf(a) === "synthetic") return true;
  return (
    a.conf === "partial" &&
    a.shape.k === "unknown" &&
    a.term?.op === "lit" &&
    a.term.value === undefined
  );
}

function stripSyntheticOobArms(a: Abs): Abs {
  if (a.shape.k === "sum") {
    const members = a.shape.members
      .filter((m) => !isSyntheticOobAbs(m))
      .map((m) => stripSyntheticOobArms(m));
    if (members.length === 0) return a;
    if (members.length === 1) return members[0]!;
    return { ...a, shape: { k: "sum", members } };
  }
  if (a.shape.k === "arr") {
    const element = stripSyntheticOobArms(a.shape.element);
    return element === a.shape.element ? a : { ...a, shape: { k: "arr", element } };
  }
  if (a.shape.k === "tuple") {
    let changed = false;
    const elements = a.shape.elements.map((m) => {
      const w = stripSyntheticOobArms(m);
      if (w !== m) changed = true;
      return w;
    });
    return changed ? { ...a, shape: { ...a.shape, elements } } : a;
  }
  return a;
}

function widenReturnAbs(a: Abs, deep: boolean): Abs {
  if (a.shape.k === "never") return unknown;
  const widened = stripSyntheticOobArms(deep ? widenParamAbs(a) : widenTopLevelAbs(a));
  // BUG-252：返回位的**空数组字面量**观测 `[]` 不能发布成 0 长元组（消费方
  // `.push("x")` 报 TS2345 `never`）——与模块值通道同口径退化成 `unknown[]`。
  if (
    widened.shape.k === "tuple" &&
    widened.shape.elements.length === 0 &&
    widened.shape.rest === undefined
  ) {
    return { ...widened, shape: { k: "arr", element: anyAbs }, term: undefined, pred: undefined };
  }
  return widened;
}

/** 返回位（协变）：仅顶层（含 sum 成员）标量字面量 → 基类型，嵌套精度保留 */
function widenTopLevelAbs(a: Abs): Abs {
  if (a.shape.k === "sum") {
    return makeAbs(
      { k: "sum", members: a.shape.members.map(widenTopLevelAbs) },
      undefined,
      undefined,
      a.conf,
    );
  }
  return widenLiteralToPrimAbs(a);
}

function widenLiteralToPrimAbs(a: Abs): Abs {
  if (a.term?.op === "lit" && a.term.value === null) return a;
  if (a.term?.op === "lit" && a.term.value === undefined) return a;
  if (a.term?.op === "lit" && a.shape.k === "prim") {
    const v = a.term.value;
    if (
      typeof v === "number" ||
      typeof v === "string" ||
      typeof v === "boolean" ||
      typeof v === "bigint"
    ) {
      return makeAbs(a.shape, undefined, undefined, a.conf);
    }
  }
  return a;
}

/**
 * Bug 72：模块级**值绑定**通道的拓宽（与返回位 `widenObservedReturnAbs`、
 * 参数位 `widenParamAbs` 对应，但目标是可变容器的基类型形态）。
 *
 * `widenTopLevelAbs` 只拓宽顶层 prim lit ⇒ `config.retries: 3` /
 * `empty: []` / `nums: [1,2,3]` 把可写绑定说成冻结字面量，消费端对
 * `config.retries = 5` / `empty.push(1)` / `nums[0] = 9` 报 TS2322 / TS2345。
 * 复用参数位的递归 widen（同构元组 → 数组、对象槽递归到基类型），再补两处：
 * - 空元组（`const x = []`）⇒ `unknown[]`（否则 `.push` 参数恒 `never`）；
 * - 保留随值携带的 `facets`（生成器身份 / 元素域）——widen 造新 Abs 时丢了。
 */
function widenModuleValueAbs(a: Abs): Abs {
  const widened = widenParamAbs(a);
  let out: Abs =
    a.facets !== undefined && widened.facets === undefined
      ? { ...widened, facets: a.facets }
      : widened;
  if (out.shape.k === "tuple" && out.shape.elements.length === 0 && !out.shape.rest) {
    out = {
      ...out,
      shape: { k: "arr", element: anyAbs },
      term: undefined,
      pred: undefined,
      conf: "exact",
    };
  }
  // BUG-237：**异构**元组退化成数组（元素域并集）。形参位的「异构元组保留」
  // 是真实的位置语义（实参要按位对上），但这里是 `export const` 的**可变
  // 数组绑定**：`[1, "a"]` 在 tsc 里是 `(string | number)[]`，发成定长
  // `[number, string]` 会让消费方的元素改写 / 越界读 / 异构替换全部假红
  // （TS2322 / TS2493 / TS2353）。同构元组在上一步 `widenParamAbs` 已退化成
  // `T[]`；`as const` 绑定不走本函数（冻结元组按 BUG-140 保留）。
  if (out.shape.k === "tuple") {
    out = { ...out, shape: { k: "arr", element: tupleElementDomain(out.shape) } };
  }
  return out;
}

/**
 * BUG-237：元组的元素域并集（按渲染文本去重，保持声明顺序）。
 * 洞（稀疏位）读值是 `undefined` ⇒ 域里必须含它。
 */
function tupleElementDomain(t: { elements: Abs[]; rest?: Abs; holes?: number[] }): Abs {
  const members: Abs[] = [];
  const seen = new Set<string>();
  const push = (m: Abs): void => {
    const key = absToTSType(m);
    if (seen.has(key)) return;
    seen.add(key);
    members.push(m);
  };
  for (const el of t.elements) push(el);
  if (t.holes?.length) push(unknown);
  if (t.rest) push(t.rest.shape.k === "arr" ? t.rest.shape.element : t.rest);
  return members.length === 1 ? members[0]! : makeAbs({ k: "sum", members }, undefined, undefined, "exact");
}

/**
 * rest 位类型：必须是**数组**类型（TS2370：A rest parameter must be of an
 * array type）——非 arr（sum/fn/prim…）提升为 `(T)[]`（sum/fn 成员带括号）。
 */
/**
 * pred → 字面量值集合（`eq(self, lit(v))` 口径）。
 *
 * 手写契约的返回域在 Abs 里是「prim + eq(self, lit(v)) pred」（core 的
 * `constraintToEntryAbs` 形态）——**字面量在 pred 里，不在 term 里** ⇒
 * 只看 term 的 widen 路径永远看不到它（`lit(42)` → `number`）。
 *
 * - `eq(self, lit(v))` ⇒ `[v]`
 * - `and(…)` ⇒ 各合取项的**交集**（只有一个字面量时才收窄）
 * - `or(…)` ⇒ 各析取项的并集（任一项不是字面量 eq ⇒ undefined：域不是有限集）
 * - 其它 pred（`gt` / `ne` / `typeof` …）⇒ undefined
 */
function predLiteralSet(p: Pred | undefined, self: Term): LiteralValue[] | undefined {
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
function isNoInfoType(ts: string): boolean {
  return ts === "unknown" || ts === "any";
}

/**
 * BUG-176：观测**联合**里含 `unknown` / `any` 成员时整串无信息。
 *
 * TS 里 `unknown` / `any` 吸收联合的其它成员（`unknown | number` ≡ `unknown`，
 * `any | string` ≡ `any`）⇒ 声明返回注解仍是唯一可用的证据。旧的 `isNoInfoType`
 * 只认整串等于 `unknown`/`any`，`hasMethod` 的观测串 `unknown | number` 因此
 * 挡住了声明注解 `: number`（产物返回位比 tsc 宽）。
 */
function isNoInfoObservedType(ts: string): boolean {
  if (isNoInfoType(ts)) return true;
  const members = splitTopLevel(ts, "|").map((m) => m.trim());
  return members.length > 1 && members.some((m) => isNoInfoType(m));
}

/** 观测串是内建泛型的**占位**形态（`Map<unknown, unknown>` 等，BUG-254）。 */
const PLACEHOLDER_BUILTIN_TYPES: ReadonlySet<string> = new Set(
  BUILTIN_GENERIC_BRANDS.values(),
);
function isPlaceholderBuiltinType(ts: string): boolean {
  const t = ts.trim();
  if (PLACEHOLDER_BUILTIN_TYPES.has(t)) return true;
  return /^(?:Readonly|Weak)?(?:Map|Set|Array|Promise|Generator|Iterator|Iterable)[A-Za-z]*<(?:unknown|object)(?:,\s*(?:unknown|object))?>$/.test(
    t,
  );
}

/** 顶层成员里是否出现 `readonly` 前缀（`readonly T[]` / `readonly [A, B]`）。 */
function hasReadonlyTypePrefix(text: string): boolean {
  return splitTopLevel(text, "|").some((m) => /^readonly\s+/.test(m.trim()));
}

/** 声明类型文本是否函数类型（`() => number` / `(b: number) => string`）。 */
function isFunctionTypeText(text: string): boolean {
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
function hasLibGlobalTypeText(text: string): boolean {
  return annotationTypeRefs(text).some((n) => LIB_GLOBAL_TYPE_NAMES.has(n));
}

/** 联合成员里是否有**字面量类型**（`"a"` / `42` / `true` / `10n`）。 */
function hasLiteralTypeText(text: string): boolean {
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
function tsLiteralType(v: LiteralValue): string {
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
function contractLiteralTSType(a: Abs): string | undefined {
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
function contractAnyTSType(a: Abs): string | undefined {
  if (a.shape.k !== "any" || a.term?.op !== "var") return undefined;
  if (a.term.id.startsWith("bind:") || a.term.id.startsWith("B:")) return undefined;
  return "any";
}

function contractReturnTSType(a: Abs, typeVars?: Map<string, string>): string {
  return (
    contractAnyTSType(a) ??
    contractLiteralTSType(a) ??
    absToTSType(widenTopLevelAbs(a), typeVars)
  );
}

function restParamType(
  widened: Abs,
  isRest: boolean,
  typeVars?: Map<string, string>,
): string {
  if (!isRest) return absToTSType(widened, typeVars);
  if (widened.shape.k === "arr") return absToTSType(widened, typeVars);
  const ts = absToTSType(widened, typeVars);
  return widened.shape.k === "sum" || widened.shape.k === "fn" ? `(${ts})[]` : `${ts}[]`;
}

/** 同参数位多 case 的 Abs join + 逆变 widen → TS 串（rest 位提升为数组类型） */
function paramTypeFromAbs(members: Abs[], isRest = false): string {
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
function returnAbsOf(fn: FunctionAnalysis): Abs | undefined {
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

function getParamName(fn: FunctionAnalysis, index: number): string {
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
type DtsProjectionCtx = {
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
 * TS 类型文本里**不需要产物声明**的词（关键字 / 基元 / TS 内建类型名）。
 *
 * 判据来源：TS 关键字 + lib.d.ts 的全局类型名（与 `isRuntimeGlobalCtorName`
 * 的运行时构造器名单同源，另加工具类型与迭代协议）。
 */
const TS_TYPE_TOKENS: ReadonlySet<string> = new Set([
  // 关键字 / 基元
  "string", "number", "boolean", "bigint", "symbol", "object", "unknown", "any",
  "never", "void", "undefined", "null", "this", "true", "false", "readonly",
  "keyof", "typeof", "infer", "extends", "in", "is", "asserts", "unique",
  "satisfies", "declare", "abstract", "const", "new", "import",
  // 工具类型 / 内建泛型
  "Array", "ReadonlyArray", "Promise", "PromiseLike", "Readonly", "Partial",
  "Required", "Pick", "Omit", "Exclude", "Extract", "NonNullable", "Record",
  "Parameters", "ConstructorParameters", "ReturnType", "InstanceType",
  "ThisParameterType", "OmitThisParameter", "ThisType", "Awaited", "Uppercase",
  "Lowercase", "Capitalize", "Uncapitalize", "PropertyKey", "TemplateStringsArray",
  "ArrayLike", "Iterable", "Iterator", "IterableIterator", "AsyncIterable",
  "AsyncIterator", "AsyncIterableIterator", "Generator", "AsyncGenerator",
  "GeneratorFunction", "AsyncGeneratorFunction", "Map", "ReadonlyMap", "WeakMap",
  "Set", "ReadonlySet", "WeakSet", "WeakRef", "FinalizationRegistry",
  "JSON", "Math", "Reflect", "Intl", "Proxy",
  "Date", "RegExp", "Error", "EvalError", "RangeError", "ReferenceError",
  "SyntaxError", "TypeError", "URIError", "AggregateError", "URL", "URLSearchParams",
  // BUG-245：lib.*.d.ts 里的**纯类型**全局名（无运行时构造器）——它们和
  // `Date` / `RegExp` 一样是环境内建，产物无需声明。旧白名单只覆盖关键字、
  // 工具类型与运行时构造器 ⇒ `RegExpMatchArray` / `IArguments` /
  // `CallableFunction` / `PromiseSettledResult` 被判「未在本模块声明」而丢弃。
  "IArguments", "CallableFunction", "NewableFunction", "RegExpMatchArray",
  "RegExpExecArray", "PromiseSettledResult", "PromiseFulfilledResult",
  "PromiseRejectedResult", "Disposable", "AsyncDisposable", "DisposableStack",
  "AsyncDisposableStack", "SuppressedError", "WeakKey", "ArrayBufferView",
  "NodeJS",
]);

/**
 * 引擎 brand 名 → TS 类型名的别名（BUG-245）。
 *
 * `arguments` 的运行时 brand 是 `Arguments`，TS 里对应的是 `IArguments`；
 * 直接把 `Arguments` 写进 `.d.ts` 是 TS2304，而按 unknown 降级又会丢掉
 * 观察到的实参表。别名只作用于 brand 渲染与未解析台账。
 */
const BRAND_TYPE_ALIASES: ReadonlyMap<string, string> = new Map([
  ["Arguments", "IArguments"],
]);

/**
 * 字符串 / 模板字面量里的**文本**替换成等长空格（BUG-191）。
 *
 * `annotationTypeRefs` 用正则抓标识符；字符串字面量类型里的文本
 * （`"a" | "b"` 的 `a`、`"ok"` 的 `ok`、`` `pre-${string}` `` 的 `pre`）会被
 * 当成类型引用 ⇒ 整条形参注解被判「引用了未在本模块声明的类型」而丢弃
 * （产物退成观测口径 `string` / `unknown`，消费方对错值零诊断）。
 *
 * 按 1 字符 → 1 字符遮蔽（保持下标不变，后缀判据仍可用于同一列）。模板串的
 * `${…}` 内部是**类型语法**（`` `${T}` `` 的 `T` 是真的类型引用）⇒ 内部文本
 * 原样保留，只遮蔽字面量文本段。
 */
function maskStringLiteralText(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      out += " ";
      i++;
      while (i < text.length) {
        if (text[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (text[i] === ch) {
          out += " ";
          i++;
          break;
        }
        out += " ";
        i++;
      }
      continue;
    }
    if (ch === "`") {
      out += " ";
      i++;
      while (i < text.length) {
        if (text[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (text[i] === "`") {
          out += " ";
          i++;
          break;
        }
        if (text[i] === "$" && text[i + 1] === "{") {
          const end = templateExprEnd(text, i + 2);
          const inner = text.slice(i + 2, Math.min(end, text.length));
          const closed = end < text.length;
          out += `  ${maskStringLiteralText(inner)}${closed ? " " : ""}`;
          i = closed ? end + 1 : text.length;
          continue;
        }
        out += " ";
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** 模板串 `${` 之后到配对 `}` 的下标（字符串 / 嵌套模板串不参与配对）。 */
function templateExprEnd(text: string, start: number): number {
  let i = start;
  let depth = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"' || ch === "'") {
      i++;
      while (i < text.length) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === ch) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "`") {
      i++;
      while (i < text.length) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === "`") {
          i++;
          break;
        }
        if (text[i] === "$" && text[i + 1] === "{") {
          i = templateExprEnd(text, i + 2) + 1;
          continue;
        }
        i++;
      }
      continue;
    }
    if (ch === "{") {
      depth++;
      i++;
      continue;
    }
    if (ch === "}") {
      if (depth === 0) return i;
      depth--;
      i++;
      continue;
    }
    i++;
  }
  return text.length;
}

/**
 * 注解原文里引用的**类型名**（BUG-168）。
 *
 * 跳过：限定访问的后半段（`Intl.DateTimeFormat` 只解析 `Intl`——产物里要解析的
 * 只是根名）、对象类型里的**属性键** / 索引签名参数名（`{ a: number }` 的 `a`）、
 * 方法签名里的**成员名**（`{ m(): number }` / `{ m?(): number }` 的 `m`，
 * BUG-176）、字符串 / 模板字面量内部的文本（BUG-191）。
 * 其余标识符一律视为类型引用，由调用方核对「产物里可解析」。
 */
function annotationTypeRefs(text: string): string[] {
  // BUG-353：字面量类型（`0xff` / `0b101` / `0o7` / `10n` / `1_000`）不是类型
  // 引用——数字后缀里的字母（`xff`）会被标识符正则误抓。数字段按等长空格
  // 遮蔽（与字符串遮蔽同机制），保持下标不变。
  const numericMasked = maskStringLiteralText(text).replace(
    /(?<![\w$.])(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?n?)(?![\w$])/g,
    (m) => " ".repeat(m.length),
  );
  const masked = numericMasked;
  const out: string[] = [];
  for (const m of masked.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
    const name = m[0];
    const at = m.index ?? 0;
    if (at > 0 && masked[at - 1] === ".") continue;
    const after = masked.slice(at + name.length);
    // 属性键 / 索引签名参数名：`a: T` / `a?: T`
    if (/^\?*\s*:/.test(after)) continue;
    // 方法签名成员名：`m(): T` / `m?(): T` / `m<T>(): T`——名字是成员**键**，
    // 不是类型引用（`Foo<T>` 这种类型引用后面不会跟 `(`）。
    if (/^\?*\s*(?:<[^<>]*>\s*)?\(/.test(after)) continue;
    out.push(name);
  }
  return out;
}

/**
 * 注解里的**值命名空间**引用（`typeof defaults` / `keyof typeof defaults` /
 * `typeof handler` 里的 `defaults` / `handler`）。它们不是类型名，不能用
 * `typeNames` 判定（BUG-262）。
 */
function typeofValueRefs(text: string): ReadonlySet<string> {
  const out = new Set<string>();
  const masked = maskStringLiteralText(text);
  for (const m of masked.matchAll(/\btypeof\s+([A-Za-z_$][\w$]*)/g)) {
    out.add(m[1]!);
  }
  return out;
}

/**
 * 注解引用是否可解析：类型命名空间（本地类 / interface·type / import /
 * 内建）或——仅当该引用前面有 `typeof`——本模块的值命名空间（BUG-262）。
 */
function isTypeRefResolvable(
  name: string,
  valuePosition: boolean,
  surface: DtsModuleSurface | undefined,
): boolean {
  if (isTypeNameResolvable(name, surface)) return true;
  return valuePosition && surface?.valueNames?.has(name) === true;
}

/**
 * 当前声明**自己的**类型形参名（函数 / 方法的 `<T>` 与所在类的 `<T>`）。
 *
 * BUG-132：`T` 在注解里是合法类型名（就在同一条声明的类型形参子句里），
 * 但 `isTypeNameResolvable` 的四档（本地类 / import / interface·type /
 * 内建）不含类型形参 ⇒ `<T>(v: T): T` 的每个 `T` 都被当成「未在本模块声明」
 * 丢弃并落误导性台账。类型形参也不需要产物补任何声明。
 */
function ctxTypeParamNames(ctx?: DtsProjectionCtx): ReadonlySet<string> {
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

function tsParamAnnotation(
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
 * rest 位可用的类型文本（`T[]` / `Array<T>` / `ReadonlyArray<T>` / 元组）。
 *
 * TS 4.0 起 rest 形参允许**元组**（`...x: [string, boolean]`：实参元数 = 元组
 * 长度）⇒ 闸门必须放行 `[A, B]` / `readonly [A, B]`，否则注解被丢、回落
 * 符号哨兵的 `unknown[]`（BUG-242）。
 */
function isArrayTypeText(t: string): boolean {
  const text = t.trim();
  return (
    /\[\]$/.test(text) ||
    /^Array<.*>$/.test(text) ||
    /^ReadonlyArray<.*>$/.test(text) ||
    /^readonly\s+\[[\s\S]*\]$/.test(text) ||
    /^\[[\s\S]*\]$/.test(text)
  );
}

/**
 * BUG-193：形参**默认值**的类型证据（`f(x = 1)` ⇒ `number`）。
 *
 * 只作 `tsParamAnnotation` 的兜底：显式注解是更高一档证据（采集期已跳过
 * 有注解的位）。默认值的静态定型发生在模块面扫描
 * （`defaultParamTypeTexts`）；无 surface / 无证据 ⇒ undefined。
 */
function tsParamDefaultType(
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
type ContractParam = { abs: Abs; optional?: boolean };

/** 契约参数位查找表（bare 名匹配；`...rest` 剥前缀） */
function contractParamMap(contract: DtsContractFace | undefined): Map<string, ContractParam> {
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
function contractParamType(
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
function dropUndefinedArm(a: Abs): Abs {
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
function contractParamRenderAbs(hit: { abs?: Abs; optional?: boolean }): Abs | undefined {
  if (!hit.abs) return undefined;
  return hit.optional === true ? dropUndefinedArm(hit.abs) : hit.abs;
}

type MainSignature = {
  /** 渲染后的参数声明（含 `?` / `...rest`），如 `["x: number", "y?: string"]` */
  params: string[];
  /** 去重后的参数名（JSDoc @param 与渲染共用，保证一致） */
  paramNames: string[];
  /** 各参数位 widen 后的 TS 类型串（JSDoc 与精确度比对用） */
  paramTypes: string[];
  /** widen 后的返回类型串 */
  returnType: string;
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
type DeclaredParam = {
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
function declaredParams(fn: FunctionAnalysis): DeclaredParam[] {
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
function patternNameFromPaths(paths: readonly string[]): string | undefined {
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
function bindingPatternText(
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
type ContractSlot = {
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
function insertNestedSlot(
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
function lookupContractSlot(
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
function patternObservedKeys(members: Abs[]): string[] {
  const keys = new Set<string>();
  for (const m of members) {
    if (m.shape.k !== "obj") return [];
    for (const k of Object.keys(m.shape.slots)) keys.add(k);
  }
  return [...keys];
}

/** Abs → `T | undefined` 文本（union / fn 成员带括号） */
function absUnionUndefined(a: Abs): string {
  return `${wrapComplexAbs(a, undefined, new ProjectionBudget())} | undefined`;
}

/** 类型文本 → `T | undefined` 文本（TS 注解是原文；函数类型需括号） */
function textUnionUndefined(t: string): string {
  return t.includes("=>") ? `(${t}) | undefined` : `${t} | undefined`;
}

function computeMainSignature(
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
    const patternOptional =
      decl?.isPattern === true && decl.hasDefault === true && !boundCovered;
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
  const observationOnly =
    fn.cases.length > 0 &&
    fn.cases.every((c) => c.source === "callsite" || c.name.startsWith("entry@"));
  const observedReturnType = retAbs
    ? absToTSType(widenReturnAbs(retAbs, observationOnly))
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
          ? absToTSType(hofReturn, typeVars)
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
    paramNames,
    paramTypes,
    returnType,
    ...(typeParams.length > 0 ? { typeParams } : {}),
    ...(constraints.size > 0 ? { constraints } : {}),
  };
}

function generateJSDoc(fn: FunctionAnalysis, sig: MainSignature): string {
  if (fn.cases.length === 0) return "";
  const lines: string[] = ["/**"];
  // 精确 case 形状记录在主签名 JSDoc 而非生成精确重载。决策依据按实测修正
  // （tsc 5.9.3，最小 .d.ts + 调用文件 + tsc --noEmit）：字面量参数重载其实
  // 可达——「宽主签名在前则后置精确重载永不命中」不成立，新鲜与非新鲜
  // （as const 传入）字面量实参都会优先命中字面量参数重载，与声明顺序无关。
  // 即便如此仍只生成单一主签名：① --from 场景单个函数可合成几十个
  // case，逐 case 重载会让声明面爆炸；② throwing case 的 `: never` 重载对
  // 调用方是陷阱（对 never 取属性/运算直接报错）；③ 字面量精度由下面的
  // Case: 行完整保留。与主签名同形的 case（无信息损失）不罗列。
  // Case: 行走 Abs 精确展示（字面量台账），不参与主签名计算。
  for (const c of fn.cases) {
    const argRenders = c.argAbs.map((a) => absToTSType(a));
    const resultRender = absToTSType(c.abs);
    // 无信息行（entry@ 兜底：全位 unknown / any）不占 JSDoc——签名位有
    // 契约/种子证据时它只会以 "=> unknown" / "=> any" 与主签名矛盾。
    // Abs 的 any（未约束）与 unknown（推断失败）分面后（Bug 544），两者
    // 都是「无信息」形态 ⇒ 一并抑制。
    if (argRenders.every(isNoInfoType) && isNoInfoType(resultRender)) {
      continue;
    }
    const preciseDiffers =
      c.argAbs.length !== sig.paramTypes.length ||
      argRenders.some((s, i) => s !== sig.paramTypes[i]) ||
      resultRender !== sig.returnType;
    if (!preciseDiffers) continue;
    const argsStr = argRenders.join(", ");
    // Case 名 / 类型串都可能含 `*/`、换行——注释体必须先清洗，否则提前闭合 JSDoc
    lines.push(` * Case: ${sanitizeCommentText(`${c.name} (${argsStr}) => ${resultRender}`)}`);
  }
  for (let i = 0; i < sig.paramTypes.length; i++) {
    lines.push(` * @param ${sanitizeCommentText(`${sig.paramNames[i]} - ${sig.paramTypes[i]}`)}`);
  }
  lines.push(` * @returns ${sanitizeCommentText(sig.returnType)}`);
  lines.push(" */");
  return lines.join("\n");
}

/**
 * ABS-03：契约可读注记（JSDoc）。**不改类型面**——契约的权威投影仍是
 * Abs（参数位 / 返回位）；这里只是把用户写的约束原文留给读者，
 * `Case:` 行继续只做调试见证，二者不互相冒充。
 */
function contractJSDocLines(contract: DtsContractFace | undefined): string[] {
  if (!contract) return [];
  const rows: string[] = [];
  for (const p of contract.params) {
    if (p.display) {
      rows.push(` * Contract: ${sanitizeCommentText(`${p.name}: ${p.display}`)}`);
    }
  }
  if (contract.returnDisplay) {
    rows.push(
      ` * Contract: ${sanitizeCommentText(`return: ${contract.returnDisplay}`)}`,
    );
  }
  return rows.length > 0 ? ["/**", ...rows, " */"] : [];
}

/**
 * 函数类型注解文本的返回位：`(x: number) => string` → `string`。
 *
 * 只解析**顶层** `=>`（括号 / 方括号 / 花括号内的是嵌套函数类型），其余形态
 * （别名 / 联合 / 条件类型）返回 undefined —— 不猜。
 */
function fnTypeReturnText(text: string): string | undefined {
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
function solveHofBetaFromParamAnnotation(
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
function computeHofSignature(
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
        ? absToTSType(promoted, typeVars)
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
  const returnType = betaReturn ?? (retAbs ? absToTSType(retAbs, typeVars) : "unknown");
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
function unifyHofWithContract(
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
function contractTypeVarsOf(
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
function reachableTypeParams(
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

type BoundLeaf = { id: string; type: string };

/** `typeof` 标签 → TS 约束类型；语义有偏差的标签返回 undefined（省略）。 */
function typeofExtendsType(t: string): string | undefined {
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
function predBoundLeaves(pred: Pred | undefined): BoundLeaf[] {
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
function contractTypeParamConstraints(
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
function typeParamDecls(
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
function contractOnlySignature(
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
    const optional =
      isRest || decl.isPattern ? false : hit.abs ? hit.optional === true || decl.hasDefault : decl.hasDefault;
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
      ? absToTSType(fn.combinedAbs)
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
function firstIteratorElem(text: string): string | undefined {
  const m = /^([A-Za-z_$][\w$]*)\s*<\s*([A-Za-z_$][\w$]*)\s*(?:[,>])/.exec(text.trim());
  if (!m || !GENERIC_ITERATOR_NAMES.has(m[1]!)) return undefined;
  return m[2];
}

function returnAnnotationMismatch(
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
function isTypePredicateText(text: string): boolean {
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
function thisReceiverClause(fn: FunctionAnalysis, ctx?: DtsProjectionCtx): string {
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

function tsReturnPredicate(fn: FunctionAnalysis, ctx?: DtsProjectionCtx): string | undefined {
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
function tsDeclaredReturn(
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
  const declaredAbs = observedAbs
    ? absTypeForTsTypeText(raw, {
        typeParams: new Map([...declared].map((n) => [n, anyAbs])),
      })
    : undefined;
  const declaredNarrower =
    declaredAbs !== undefined &&
    observedAbs !== undefined &&
    leqAbs(declaredAbs, observedAbs).ok &&
    !leqAbs(observedAbs, declaredAbs).ok;
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
    raw !== "void" &&
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

/**
 * 为单个函数生成 .d.ts 投影（JSDoc + 单一 widen 主签名）。
 * 证据优先级：手写契约（contract，export CLI 从 effectiveContract 取）
 * > hof 泛型投影（C3.3）> case-widen。
 * service 的 generateDts 与 CLI export --format dts 共用本函数。
 *
 * Bug 514/515/518/550：声明的**导出名**取自模块面（surface）——
 * `export { internal as publicName }` 的导出名是 publicName；
 * `export default function f` 的导出名是 default（写成
 * `export default function f(...)`，不是 `export declare function f`）；
 * 类成员（`C.m`）**不是**模块级导出（类声明由 projectModuleDts 合成）。
 */
export function projectFunctionDts(
  fn: FunctionAnalysis,
  contract?: DtsContractFace,
  surface?: DtsModuleSurface,
): DtsFunctionProjection {
  // Bug 233：brand 类名只在**产物里可解析**时才保留（本地声明 / 已 import /
  // TS 全局类型名）——作用域覆盖整条投影链（JSDoc / 签名 / 返回位）。
  // BUG-168：注解原文的可解析性需要同一份模块面；引用到的名字回传到投影上
  // （模块面据此补 `declare class` / `import type`），被丢弃的注解落台账。
  const ctx: DtsProjectionCtx = {
    ...(surface ? { surface } : {}),
    typeRefs: new Set(),
    dropped: [],
    mismatches: [],
    // Bug 57：类型形参子句按普查名查（类成员 `C.m`，模块函数 `gen`）。
    typeParamKey: fn.name,
  };
  const proj = withBrandScope(brandScopeOf(surface), () =>
    projectFunctionDtsInner(fn, contract, ctx),
  );
  // 「第三种」：声明 vs 观测，**只落台账、绝不覆盖产物**。手写契约覆盖返回位
  // 时跳过（那是第三来源，不参与「实现 vs 声明」的比较）；无 combinedAbs
  // 时没有观测可判。
  if (!contract?.return && fn.declaredReturnType && fn.combinedAbs) {
    const mismatch = returnAnnotationMismatch(
      fn.declaredReturnType,
      absToTSType(fn.combinedAbs),
    );
    if (mismatch) ctx.mismatches?.push({ name: fn.name, ...mismatch });
  }
  const typeRefs = [...(ctx.typeRefs ?? [])];
  const ledger = [
    ...(ctx.dropped ?? []).map(
      (n) =>
        `// nudo:dropped-type-annotation ${n} — type not declared in this module (falls back to the observed type)`,
    ),
    ...(ctx.mismatches ?? []).map(
      (m) =>
        `// nudo:return-annotation-mismatch ${m.name} — declared element "${m.declared}", observed "${m.observed}"; kept the observed type`,
    ),
  ];
  if (typeRefs.length === 0 && ledger.length === 0) return proj;
  const withMeta: DtsFunctionProjection = {
    ...proj,
    ...(typeRefs.length > 0 ? { typeRefs } : {}),
  };
  if (ledger.length === 0) return withMeta;
  return proj.classMember
    ? {
        ...withMeta,
        classMember: {
          ...proj.classMember,
          lines: [...ledger, ...proj.classMember.lines],
        },
      }
    : { ...withMeta, lines: [...ledger, ...proj.lines] };
}

function projectFunctionDtsInner(
  fn: FunctionAnalysis,
  contract: DtsContractFace | undefined,
  ctx: DtsProjectionCtx,
): DtsFunctionProjection {
  const surface = ctx.surface;
  // Bug 518/550：类成员（`C.m`）**不是模块级导出**——模块级没有 `C_m` 这个
  // 名字（那是凭空造导出；#494 的清洗只让它可解析，不让它正确）。
  // 成员声明进类体，类声明由模块面合成（一次一类）。
  //
  // **无模块面时保持历史口径**（`C_m` 模块级投影，#494 回归钉）：类声明必须
  // 一次一类（同一类多个方法 ⇒ 多份 `declare class C` ⇒ TS2300），只有模块面
  // 合成能保证。导出面感知的投影需要模块面（导出名 / 类 / 再导出）。
  const memberMatch = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(fn.name);
  if (fn.noDeclaration && memberMatch && surface) {
    const className = memberMatch[1]!;
    const member = memberMatch[2]!;
    const memberFn: FunctionAnalysis = { ...fn, name: member, noDeclaration: false };
    const decl = dtsFunctionDeclaration(memberFn, contract, {
      kind: "member",
      memberName: member,
    }, ctx);
    return {
      lines: [],
      params: decl.params,
      classMember: { className, member, lines: decl.lines },
    };
  }
  let emitFn = fn;
  if (fn.noDeclaration) {
    // 无模块面：类方法沿用历史 `Class_method` 投影（#494）；其余绑定形态
    // （default / CJS 槽 / export list）按导出名声明（Bug 514）。
    if (!memberMatch) {
      const form = dtsExportForm(fn.name, surface);
      if (form.kind === "none") return { lines: [], params: [] };
      const decl = dtsFunctionDeclaration(fn, contract, form, ctx);
      return {
        lines: decl.lines,
        params: decl.params,
        exportName: dtsFormExportName(form),
      };
    }
    emitFn = { ...fn, name: `${memberMatch[1]}_${memberMatch[2]}`, noDeclaration: false };
  }

  // 导出形态（模块面优先；无模块面 ⇒ 普查名即导出名）
  const form = dtsExportForm(emitFn.name, surface);
  if (form.kind === "none") return { lines: [], params: [] };

  // 双保险：任何非法标识符名都必须清洗——上游分类（noDeclaration）漏标时
  // 也不能产出不可解析的 .d.ts（#494）。
  const safeName = dtsIdentifier(emitFn.name);
  const named = safeName !== emitFn.name ? { ...emitFn, name: safeName } : emitFn;

  const decl = dtsFunctionDeclaration(named, contract, form, ctx);
  return {
    lines: decl.lines,
    params: decl.params,
    exportName: dtsFormExportName(form),
  };
}

/**
 * 单函数声明面（签名 + 声明行）：声明**写法**由导出形态决定
 * （具名 / default / 别名 / 类成员），签名口径不变。
 */
function dtsFunctionDeclaration(
  fn: FunctionAnalysis,
  contract: DtsContractFace | undefined,
  form: DtsExportForm,
  ctx?: DtsProjectionCtx,
): { lines: string[]; params: Array<{ name: string; type: string }> } {
  // BUG-175：源码已有重载声明（原文镜像 + `functionOverloads` 登记）⇒ 不发
  // 实现签名（实现形参是 `any`，作为额外重载就是 catch-all），只补导出胶水。
  const overloadDecl = ctx?.surface?.functionOverloads?.get(fn.name);
  if (overloadDecl !== undefined && form.kind !== "member" && form.kind !== "none") {
    return { lines: overloadExportGlue(form, overloadDecl.exported), params: [] };
  }
  // Bug 57：源码声明的**函数 / 方法级类型形参槽**（`<T>` / `<A, B>`）。
  // 类级形参早在 BUG-168 修过，函数 / 方法级漏了 ⇒ 消费端
  // `gen<string>(…)` 报 TS2558。HOF 快照自带 `<…>` ⇒ 那条分支不叠加。
  const srcTypeParams =
    ctx?.typeParamKey !== undefined
      ? (ctx.surface?.typeParamClauses?.get(ctx.typeParamKey) ?? "")
      : "";
  // BUG-132：compat 行（不带 `<T>` 的重复声明）只有在签名**不引用**类型形参
  // 时才合法——`id<T>(v: T): T` 的 compat 体会写成 `function id(v: T): T`，
  // `T` 不在作用域里 ⇒ TS2304（比缺声明更糟）。
  const srcTypeParamNames = new Set(typeParamNamesInClause(srcTypeParams));
  const compatAllowed = (signature: string): boolean =>
    srcTypeParams !== "" &&
    !annotationTypeRefs(signature).some((n) => srcTypeParamNames.has(n));
  // 手写契约参数面优先于 HOF 泛型快照：契约是用户申报的调用面；混合投影
  // （部分契约位 + 部分泛型位）会让泛型变元失去与 promoted 形参的定义关系
  const hasContractParams = (contract?.params.length ?? 0) > 0;
  const hofSig = hasContractParams ? undefined : computeHofSignature(fn, ctx);
  if (hofSig) {
    const returnType = contract?.return
      ? contractReturnTSType(contract.return)
      : hofSig.returnType;
    const lines: string[] = [];
    if (fn.cases.length > 0) {
      const jsdoc = generateJSDoc(fn, {
        params: hofSig.params,
        paramNames: hofSig.paramNames,
        paramTypes: hofSig.paramTypes,
        returnType,
      });
      if (jsdoc) lines.push(jsdoc);
    }
    // BUG-195：源码声明的类型形参必须先于 HOF 推导变元（`<U>` 有 Abs 证据时
    // 仍要出现在形参注解引用的作用域里）。
    const tparams = mergeTypeParamClauses(srcTypeParams, hofSig.typeParams);
    // BUG-133：`this: T` 接收者子句在 HOF 泛型分支同样要发射（旧实现只走
    // 观测签名分支 ⇒ `g<T>(this: Box<T>) { return (x) => … }` 的接收者契约
    // 整条消失）。子句可解析性判据与降级台账同 `thisReceiverClause`。
    const hofThis = thisReceiverClause(fn, ctx);
    const hofParams = hofThis === "" ? hofSig.params : [hofThis, ...hofSig.params];
    lines.push(
      ...dtsExportDeclaration(
        form,
        `${tparams}(${hofParams.join(", ")}): ${returnType}`,
      ),
    );
    return {
      lines,
      params: hofSig.paramNames.map((name, i) => ({
        name,
        type: hofSig.paramTypes[i] ?? "unknown",
      })),
    };
  }

  if (fn.skipped || fn.cases.length === 0) {
    // skipped / entryOnly / 无 case 函数：只有声明或 combined 返回类型已知，
    // 保持历史行为——rest-args 形式，combined（含 Promise<T>）原样输出。
    // #176：skip 即使带 @nudo:case（运行时见证已照常求值）也走声明面——
    // combinedAbs 来自 @nudo:skip => 声明，case 不参与 dts 面合成。
    // 例外：手写契约参数位是申报面的一部分，具名投影。
    if (hasContractParams) {
      const sig = contractOnlySignature(fn, contract!, ctx);
      const plain = `(${sig.params.join(", ")}): ${sig.returnType}`;
      // ABS-03：契约面类型形参（只含被签名引用的变元）——与源码声明形参
      // 并存时源码在前、契约推导在后
      const contractTParams =
        sig.typeParams && sig.typeParams.length > 0
          ? `<${typeParamDecls(sig.typeParams, sig.constraints)}>`
          : "";
      const paramsText = `${srcTypeParams}${contractTParams}${plain}`;
      return {
        lines: [
          ...contractJSDocLines(contract),
          ...dtsExportDeclaration(
            form,
            paramsText,
            // compat 行只有源码声明形参可承载（契约变元不在 compat 体里声明）
            srcTypeParams && !contractTParams && compatAllowed(plain) ? plain : undefined,
          ),
        ],
        params: sig.paramNames.map((name, i) => ({ name, type: sig.paramTypes[i]! })),
      };
    }
    const retAbs = fn.combinedAbs;
    if (retAbs) {
      return {
        lines: dtsExportDeclaration(form, `(...args: unknown[]): ${absToTSType(retAbs)}`),
        // rest-args 声明面无具名参数位可提示（skip = 开发者主动退出推断）
        params: [],
      };
    }
    // BUG-079：`@nudo:skip` 且**未声明返回类型**（combinedAbs 为 null）时，
    // 旧实现 `return { lines: [] }` ⇒ 该导出被**整条从产物里删掉**（不是降级
    // 成 any），而 `nudo check`（core checkSource）为同一函数合成 `any`
    // ⇒ 两面结论相反、消费端 `import { boom }` 直接 TS2305。
    // ⇒ 与 check 同源；TS 投影面按 2026-11-06 归一：无约束 any → TS unknown。
    return {
      lines: dtsExportDeclaration(form, `(...args: unknown[]): unknown`),
      params: [],
    };
  }

  const sig = computeMainSignature(fn, contract, ctx);
  const jsdoc = generateJSDoc(fn, sig);
  const lines: string[] = [...contractJSDocLines(contract)];
  if (jsdoc) lines.push(jsdoc);
  const plain = `(${sig.params.join(", ")}): ${sig.returnType}`;
  const sigTParams =
    sig.typeParams && sig.typeParams.length > 0
      ? `<${typeParamDecls(sig.typeParams, sig.constraints)}>`
      : "";
  lines.push(
    ...dtsExportDeclaration(
      form,
      `${srcTypeParams}${sigTParams}${plain}`,
      srcTypeParams && !sigTParams && compatAllowed(plain) ? plain : undefined,
    ),
  );
  return {
    lines,
    params: sig.paramNames.map((name, i) => ({ name, type: sig.paramTypes[i]! })),
  };
}

export function generateFunctionDtsLines(
  fn: FunctionAnalysis,
  contract?: DtsContractFace,
): string[] {
  return projectFunctionDts(fn, contract).lines;
}

export function generateDts(result: AnalysisResult): string {
  // 无模块面（没有源文本）：CJS 槽 / 别名绑定这类**没有声明级稳定名**的绑定
  // 不进模块级声明面（历史行为：只在 infer/JSON 面出现）；类方法沿用历史
  // `Class_method` 投影（#494 口径——类声明要一次一类，只有模块面合成能保证）。
  const entries: Array<{ fn: FunctionAnalysis; projection: DtsFunctionProjection }> = [];
  for (const fn of result.functions) {
    if (fn.noDeclaration && !/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.test(fn.name)) continue;
    entries.push({ fn, projection: projectFunctionDts(fn) });
  }
  const mod = projectModuleDts(undefined, entries);
  return mod.lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// 模块导出面（dts 投影面：导出名 / 类声明 / 再导出）
//
// 模块面 = 源文件的**导出面**：哪些名字被导出、导出名是什么、类长什么样、
// 再导出到哪。dts 投影必须按**导出名**声明（Bug 515）：局部绑定名 ≠ 导出名
// （`export { internal as publicName }` 的导出名是 publicName；
// `export default function f` 的导出名是 default）。
//
// 类成员（`C.m`）**不是**模块级导出（Bug 518/550）：模块级没有 `C_m` 这个
// 名字——成员收进 `declare class C { … }`（一次一类）。
//
// 再导出（`export * from` / `export {x} from`）按原样发射（Bug 939）：产物的
// 导出面必须与源模块一致，否则消费方 import 直接 TS2305。
// ---------------------------------------------------------------------------

/**
 * 类**成员面**（源码形状：成员名 + 构造器形参）——`scanClassSurface` 的返回面，
 * 只描述类体本身、不含导出形态；`DtsClassSurface` 在其上叠加导出三件套
 * （exportName / exportNames / isDefault）。
 */
/** 类字段投影面（实例 / static 共用）：名 + 类型 + 修饰符（Bug 23/77/86/42）。 */
export interface DtsClassFieldSurface {
  name: string;
  type: string;
  readonly?: boolean;
  /** BUG-044：`x?: T` 的可选修饰符（旧实现丢弃 ⇒ 消费方读到不存在的值） */
  optional?: boolean;
  accessibility?: "private" | "protected" | "public";
  isAbstract?: boolean;
  /**
   * BUG-216：well-known symbol 键（`[Symbol.iterator]` ⇒ name `"@@iterator"`）。
   * 发射时必须还原成 `[Symbol.iterator]` 括号形态，不能当字符串键。
   */
  symbolKey?: boolean;
}

/** 类方法投影面（源码面）：实例 / static 共用。 */
export interface DtsClassMethodSurface {
  name: string;
  params: string[];
  /**
   * 形参的源码类型注解原文（与 `params` 平行；无注解 / 注解不可解析 ⇒ undefined）。
   *
   * `params` 只承载**名字**——抽象方法 / 无体声明方法在分析面没有条目，发射侧
   * 曾因此退成 `unknown`（形参注解整段丢失 ⇒ 消费方错实参 / 错覆写编译通过）。
   * 注解在源码 AST 上本来就在，缺的只是这条通道。
   */
  paramTypes?: Array<string | undefined>;
  /**
   * BUG-193：默认值证据（与 `params` 平行；无注解的 `m(x = 1)` 位是 `number`）。
   * 分析面签名（`C.m`）把该表当形参类型兜底。
   */
  paramDefaults?: Array<string | undefined>;
  accessibility?: "private" | "protected" | "public";
  isAbstract?: boolean;
  /** 方法声明的返回类型注解原文（abstract / 无分析证据的方法用） */
  returnType?: string;
  /**
   * **注解证据**的返回类型（无返回注解时按方法体静态定型）。
   *
   * 求值面对「声明字段 + 构造器写入」的实例字段播种 `any` ⇒ 方法体
   * `this.n + 1` 被折成 `number | string`（`string` 分支不可达），而同次
   * `check` 与 `tsc --declaration` 都是 `number`。源码注解（字段 / 形参 /
   * 字面量）是声明面事实 ⇒ 这里给出静态定型结果，发射侧**只收窄不放宽**。
   */
  annotationReturnType?: string;
  /**
   * 无返回注解时的**方法体观测**返回类型（单条 `return` 的字面量 / 字段引用）。
   *
   * 静态方法与同名实例方法共用一条分析面签名（core 只普查一条 `C.m`）⇒
   * `analysisReturnOf` 的形参不匹配时不能复用实例位证据；此时按静态方法
   * **自己的**方法体给出可观测的类型（与 getter 同一证据标准）。
   */
  observedReturnType?: string;
  /** 方法级类型形参子句原文（`<U>`） */
  typeParams?: string;
  /** BUG-215：`m?(): T` 的可选修饰符（旧实现丢弃 ⇒ 消费方零诊断调用） */
  optional?: boolean;
  /** BUG-216：well-known symbol 键（见 `DtsClassFieldSurface.symbolKey`） */
  symbolKey?: boolean;
  /**
   * BUG-175：源码面**重载集**（声明序；非空 ⇒ 实现签名不得再发）。
   *
   * 实现签名（`m(a: any): any`）混进重载集会变成额外的 catch-all 重载 ⇒
   * 消费方传入 tsc 会拒绝的实参也编译通过。tsc `--declaration` 只发重载声明。
   */
  overloads?: DtsClassMethodSurface[];
  /**
   * 采集期标记：该条是**无体声明**（重载声明 / abstract / declare 方法）。
   * 主循环结束后与同名实现合并（实现作主条目、声明作 `overloads`）。
   */
  declarationOnly?: boolean;
}

/** 访问器投影面（Bug 23）：运行时是公开成员，dts 必须声明。 */
export interface DtsClassAccessorSurface {
  name: string;
  kind: "get" | "set";
  type: string;
  isStatic?: boolean;
  accessibility?: "private" | "protected" | "public";
  /** BUG-216：well-known symbol 键 */
  symbolKey?: boolean;
}

/** 构造器签名面（BUG-234：重载构造器逐条保留，声明序） */
export interface DtsCtorSignatureSurface {
  params: string[];
  paramTypes?: Array<string | undefined>;
  accessibility?: "private" | "protected" | "public";
}

export interface DtsClassMemberSurface {
  /** 实例方法（名 + 形参名，源码序） */
  instanceMethods: DtsClassMethodSurface[];
  /** 静态方法（名 + 形参名，源码序） */
  staticMethods: DtsClassMethodSurface[];
  /** 构造器形参名（无显式构造器 ⇒ undefined ⇒ 不发构造器声明） */
  ctorParams?: string[];
  /** BUG-042：构造器可见性（`private constructor` ⇒ 消费方不可 `new`） */
  ctorAccessibility?: "private" | "protected" | "public";
  /** Bug 48：构造器形参的源码类型注解（与 ctorParams 平行；无注解 ⇒ undefined） */
  ctorParamTypes?: Array<string | undefined>;
  /**
   * BUG-234：**重载构造器**的签名集（源码序；非空 ⇒ 只发这些声明，不发实现）。
   *
   * 旧实现只有一个 `ctorParams` 槽（首个构造器节点胜出）⇒ 后续重载整段丢弃，
   * 消费方 `new C("s")` 被 TS2345 假红。
   */
  ctorOverloads?: DtsCtorSignatureSurface[];
  /**
   * BUG-168：源码声明的**类型形参名**（`class Box<T>` ⇒ `["T"]`）。
   *
   * 缺了类型形参槽，泛型类只能发射成裸类名 ⇒ 消费端 `new Box<string>(…)`
   * 报 TS2558（"Expected 0 type arguments"）——实现允许的调用被产物判非法。
   */
  typeParams?: string[];
  /** Bug 74：类型形参**子句原文**（`<T = string>`）——含默认值 / 约束，发射时优先于名字表 */
  typeParamsText?: string;
  /**
   * BUG-151：超类的**本地名**（`class B extends A` ⇒ `"A"`）。
   *
   * 缺了 extends 子句 ⇒ 产物的继承链整条断掉 ⇒ 消费端 TS2339（继承成员不可见）
   * + TS2741（子类不可赋给父类）——运行时成员全在，两条都是假红。
   * 只在**产物里可解析**的类名上采集（否则 `extends Unknown` 是 TS2304）。
   */
  superClass?: string;
  /** BUG-378：`implements` 子句原文（与 tsc 一致，接口的编译期义务不得丢）。 */
  implements?: string[];
  /** Bug 73：源码里写下的超类**类型实参**原文（`extends Base<string>` ⇒ `["string"]`） */
  superTypeArguments?: string[];
  /**
   * BUG-109：超类是**表达式**（`extends mixin(Base)`）时的原文。
   *
   * `surfaceQualifiedName` 只认标识符 / 点号限定名 ⇒ 表达式超类整条被丢，
   * 产物的继承链断裂（消费方对继承成员 TS2339），且零台账。这里保留原文
   * 用作降级台账，并发一个开放的构造基类（见 `dtsClassDeclaration`）。
   */
  superExpressionText?: string;
  /**
   * 实例字段（BUG-151）：构造器里的 `this.x = …` 与类属性初始化器。
   *
   * 分析面对 `class C` 绑定给出的 brand 是**构造器面**（实例形状只有 `name`）
   * ⇒ 实例字段只能从源码面采集；类型取初始化器的基类型（字面量 → number /
   * string / boolean，其余 `unknown`——声明面有字段但类型不猜）。
   */
  instanceFields?: DtsClassFieldSurface[];
  /** Bug 23：static 字段（源码面，运行时公开数据属性） */
  staticFields?: DtsClassFieldSurface[];
  /** Bug 23：访问器（getter / setter，源码面公开成员） */
  accessors?: DtsClassAccessorSurface[];
  /** Bug 42：类带 `abstract` 修饰符 */
  isAbstract?: boolean;
  /** Bug 87：类含 `#` 私有标识符字段 ⇒ 发射 `#private;` 名义标记 */
  hasPrivateIdentifier?: boolean;
  /** Bug 88：类体 index signature 声明文本（`[key: string]: …;`） */
  indexSignatures?: string[];
}

/** 类声明面（成员面 + 导出形态） */
export interface DtsClassSurface extends DtsClassMemberSurface {
  /** 导出名（未导出 ⇒ undefined；`export default class C` ⇒ "default"） */
  exportName?: string;
  /**
   * BUG-189：**全部**导出名（具名导出优先，其后的别名 / default 逐条补发）。
   *
   * 同一个本地绑定可以同时是具名导出与 default 导出
   * （`export class C {}` + `export { C as default }`）——旧实现只留一个名字
   * ⇒ 发布的 `.d.ts` 缺 default 导出 ⇒ 消费端 default import 报 TS2349/TS2351。
   */
  exportNames?: string[];
  /** 导出形态是 default（`export default class C`） */
  isDefault: boolean;
  /**
   * BUG-360：该绑定是**类表达式**（`export const C = class { … }`）。TS 里
   * `C` 是值（构造器 + 静态成员），不是类型名 ⇒ 产物必须发 `declare const C:
   * typeof <内部类>`，不能发 `export declare class C`。
   */
  isExpression?: boolean;
}

/**
 * 对象字面量成员函数的**源码注解证据**（BUG-157）：成员键 → 形参 / 返回注解原文。
 *
 * 求值面把对象字面量成员变成 `$fnVal([...形参名], fn, {…})`——成员没被调用时
 * 只有形参名，没有类型（`(a: unknown) => unknown`）。源码注解就在 AST 上，
 * 必须在投影时叠加进 Abs（只补缺：观测到的返回类型优先）。
 */
export interface DtsObjectFnAnnotation {
  /** 成员键（静态键；计算键不收） */
  key: string;
  /** 形参注解原文（与形参位平行；无注解 ⇒ undefined） */
  paramTypes: Array<string | undefined>;
  /** 该位是否 rest（rest 注解必须是数组类型才放行） */
  rest: boolean[];
  /** 方法 / 函数的返回注解原文 */
  returnType?: string;
}

/**
 * 模块级**值声明**面（BUG-190）：`export const/let/var` 与 TS `enum`。
 *
 * 这些绑定在导出面表里**已登记**（`exportBindings`），但旧实现只发射函数与类
 * ⇒ 发布的 `.d.ts` 里从不出现 ⇒ 消费端 `import { VERSION }` 报 TS2305
 * （而运行时确实有这些导出）。
 */
export interface DtsValueSurface {
  /** 声明种类（`const` / `let` / `var` / TS `enum`） */
  kind: "const" | "let" | "var" | "enum";
  /** enum 成员（源码序 + 字面量初始化器；非 enum ⇒ undefined） */
  enumMembers?: Array<{ name: string; init?: string }>;
  /** Bug 25：`export const enum` ⇒ 发射 `declare const enum`（否则运行时 import 报错） */
  constEnum?: boolean;
  /** Bug 20：`export default <表达式>` 无分析面绑定时预投影的类型串 */
  typeText?: string;
  /** Bug 77：`as const` ⇒ 对象槽按只读投影 */
  asConst?: boolean;
  /**
   * BUG-260：顶层 `const <ident> = <primitive literal>`。tsc 对这种绑定保留
   * 字面量类型；解构 / 对象初始化器仍按拓宽口径（`const {a} = {a:1}` ⇒
   * `a: number`），不能用同一把闸门。
   */
  literalConst?: boolean;
  /**
   * BUG-130：源码的类型注解原文（`export const c1: number[] = []` 的
   * `number[]`）。
   *
   * 值声明此前只登记 kind / asConst，注解完全不参与 ⇒ 有初始化器的按观测
   * 形状投影（`[]` ⇒ `unknown[]`）、无初始化器的连形状都没有（`let l: number`
   * ⇒ `undefined`）。注解是声明面事实，且是「无初始化器」声明的**唯一**类型
   * 来源 ⇒ 可解析时优先于观测。
   */
  annotation?: string;
  /**
   * BUG-140：初始化器**内部**有 `as const`（`{ x: [1, 2] as const }`）时按源码
   * 字面量投影的类型串。
   *
   * 这种绑定本身不是 `as const`（对象未冻结），所以既不能走 `asConst` 的
   * 全只读通道，也不能走可变容器拓宽（会把内层元组的字面量 + 只读一起拓掉）
   * ⇒ 在采集期按 AST 算出「逐层冻结」的类型（与 `tsc --declaration` 同口径）。
   */
  nestedConstType?: string;
  /** BUG-157：对象字面量成员函数的源码注解（投影时叠加进 Abs，只补缺） */
  fnMemberAnnotations?: DtsObjectFnAnnotation[];
  /**
   * BUG-258 / BUG-254：初始化器 AST 的类型文本（仅 `typeof X` 引用与显式泛型
   * 实参这类 Abs 表达不了的声明事实优先于分析面观测）。
   */
  initTypeText?: string;
  /** BUG-264：`const s = Symbol("…")` ⇒ `unique symbol`。 */
  uniqueSymbol?: boolean;
  /** BUG-263：对象字面量里用户符号键的源码名（按出现序）。 */
  userSymbolKeys?: string[];
  /**
   * BUG-358：初始化器**不是**函数 / 类值（`export const handle = 1`）。
   *
   * 分析面可能把同名**对象成员键**误登记成模块级函数入口（`registry.handle`
   * 与 `const handle` 是两个实体）⇒ 当函数入口与一个非函数值绑定同名时，
   * 以值绑定为准：值声明照发、phantom 函数入口不发射。
   */
  nonFunctionValue?: boolean;
}

/**
 * namespace 面（BUG-191）：`export namespace NS { … }` 的成员声明文本。
 *
 * 为什么需要：namespace 在运行时是**真实对象**（求值器把 `NS.x` 物化出来），
 * 但 dts 的导出名表与声明发射只认函数/类/变量 ⇒ 发布的 `.d.ts` 里没有 `NS`
 * ⇒ 消费端 `import { NS }` 报 TS2305，而运行时确实有该导出。
 *
 * 成员按**源码声明**渲染（`keepTs` 的 AST 上类型注解仍在 ⇒ 直接从源码文本切），
 * 无注解的成员退 `unknown`（推理失败口径，不假造 any）。
 */
export interface DtsNamespaceSurface {
  /** 导出名（未导出 ⇒ undefined） */
  exportName?: string;
  /** 全部导出名（具名优先，其后的别名逐条补发） */
  exportNames?: string[];
  /** 成员声明行（`export const x: number;` / `export function f(a: string): void;` …） */
  members: string[];
}

/**
 * 导入面（一条 import 声明里的**类型名** → 模块说明符）。
 *
 * Bug 233：brand 引用的类若来自**别的模块**（本模块 import 进来的），
 * 产物里必须能解析那个类名 ⇒ 补 `import type { C } from "…";`（否则消费方
 * tsc TS2304）。命名空间导入（`import * as ns`）不能当类型名用 ⇒ 不收。
 */
export interface DtsImportSurface {
  /** 模块说明符（源码原文） */
  specifier: string;
  /** 导入形态：具名 / 默认 / `import x = require("…")` */
  kind: "named" | "default" | "equals";
  /**
   * BUG-012：具名导入的**原名**（`import { X as Y }` 里的 X）。再导出链条
   * （`export { Y as Z }`）要按原名写 `export { X as Z } from "…"`——按本地名
   * 写会引用到产物里不存在的绑定。
   */
  importedName?: string;
}

/** 模块导出面（源文件的导出面：导出名 → 本地绑定 + 类面 + 再导出 + 导入面） */
export interface DtsModuleSurface {
  /** 导出名 → 本地绑定名（CJS 槽 / 匿名 default / 再导出 ⇒ "" = 无本地绑定） */
  exportBindings: Map<string, string>;
  /** 再导出语句（`export * from "x"` / `export { a as b } from "x"`） */
  reexports: string[];
  /**
   * BUG-309：**仅类型**再导出的本地别名（export 名 → 本地名）。无 source 的
   * `export type { innerFn as localFn }` 由「导入绑定再导出」通道发射，那里
   * 必须保留 `type` 修饰符，否则产物把类型导出升级成值导出（消费方假绿 +
   * 运行期 ESM SyntaxError）。
   */
  typeOnlyExportBindings?: Map<string, string>;
  /** 类面（类本地名 → 类声明面） */
  classes: Map<string, DtsClassSurface>;
  /**
   * 导入面（可当类型名用的导入绑定名 → 模块说明符）。
   *
   * 具名导入按**导出名**记（`import { X as Y }` ⇒ 键 "X"——产物里补
   * `import type { X } from "…"` 用的是导出名）；默认导入按**本地名**记
   * （`import X from "…"` ⇒ 键 "X"，补 `import type X from "…"`）。
   */
  imports?: Map<string, DtsImportSurface>;
  /**
   * 模块级**值声明**（本地名 → 形态）——`export const/let/var` 与 TS `enum`
   * （BUG-190）。声明种类决定发射写法（`export declare const`/`let`/`var`，
   * enum 另发成员表）。
   */
  values: Map<string, DtsValueSurface>;
  /**
   * namespace 面（本地名 → 成员声明行）。BUG-191：`export namespace NS { … }`
   * 在运行时是真实对象（求值器物化了它），旧实现只发射函数/类/值 ⇒ 产物里
   * 没有 `NS` ⇒ 消费端 TS2305。
   */
  namespaces?: Map<string, DtsNamespaceSurface>;
  /**
   * Bug 22 / 75：模块顶层 `interface` / `type` 别名的**原文镜像**。
   * 导出的（`export interface Top`）整段原文带 `export`；未导出的私有类型
   * （`interface Hidden`）只发声明（tsc `--declaration` 同口径），让 namespace
   * 成员引用私有类型时在产物里可解析（否则 TS2304）。
   */
  typeDeclarations?: string[];
  /**
   * BUG-217：局部导出别名指向**类型声明**时的导出语句（`export { I as IA };`
   * / `export type { I as IB };`）。
   *
   * 类型声明的发射走源码切片通道（`typeDeclarations`），它**不查导出绑定表**
   * ⇒ 值绑定的 `export { f as g }` 有 `dtsExtraExportLines` 补发，类型绑定
   * 却没有对应物：只有类型别名导出的模块产物里**一条 export 都没有**（tsc 按
   * 非模块处理 ⇒ 消费方 TS2306）。
   */
  typeExportAliases?: string[];
  /**
   * BUG-175：自由函数的**重载声明**名（本地名 → 是否自带 `export` 修饰符）。
   *
   * 重载声明（`TSDeclareFunction`）以原文镜像进产物；分析面同时会给实现发一条
   * `export declare function …`——实现的形参注解通常是 `any` ⇒ 多出一条
   * catch-all 重载（消费方传入 tsc 会拒绝的实参也编译通过）。发射侧见本表
   * 就**不发实现签名**，只补导出胶水（别名 / default）。
   */
  functionOverloads?: Map<string, { exported: boolean }>;
  /**
   * BUG-005 / BUG-190：本模块**声明过的类型名**（`interface` / `type` 别名，
   * 导出与否都算；以及**会被发射**的导出 `enum`）。它们会被同一份产物声明
   * ⇒ 形参 / 字段注解里引用它们是可解析的，旧判据只认「本地类 / 导入名 /
   * TS 全局名」⇒ 本地 interface 注解被丢成 `unknown`，台账还谎报「未在本模块
   * 声明」。
   */
  typeNames?: Set<string>;
  /**
   * BUG-262：本模块的顶层**值**名（函数声明 / 变量 / enum / import）。`typeof X`
   * / `keyof typeof X` 引用的是值命名空间——只查 `typeNames` / `classes` 会把
   * 同模块的 `const defaults`、`function handler` 判成「未在本模块声明」⇒
   * 形参注解被丢弃并落与事实相反的台账。
   */
  valueNames?: Set<string>;
  /**
   * Bug 57：函数 / 方法级**类型形参子句**原文（`<T>` / `<A, B>` / `<T = string>`）。
   * 键是普查名（模块级 `gen`；类方法 `C.m`）；值直接切源码原文。
   */
  typeParamClauses?: Map<string, string>;
  /**
   * BUG-193：形参默认值的类型证据（普查名 → 逐位 TS 类型文本）。
   *
   * TS 对 `f(x = 1)` 的声明面推断是 `x?: number`（默认值初始值是类型证据）。
   * 分析面入口 Abs 不含默认值 ⇒ dts 形参位曾落 `unknown`（消费方对错实参零
   * 诊断）。这里从源码 `AssignmentPattern` 的初始值静态定型（只收字面量形状，
   * 表达式不猜），只在**无显式注解**的位生效（注解是更高一档证据）。
   */
  paramDefaults?: Map<string, Array<string | undefined>>;
  /**
   * Bug 49：命名空间导入（`import * as NS from "…"`）的本地名 → 模块说明符。
   * 命名空间限定超类（`extends NS.Base`）需要补 `import * as NS` 才可解析。
   */
  namespaceImports?: Map<string, string>;
  /**
   * BUG-008：CJS `module.exports = <单值>` 的模块形态。`local` = 承载该值的
   * 本地名；`""` = 匿名右值（`module.exports = function () {}`），产物用
   * `_default` 承载。`exportBindings` 里对应条目只是内部记账（让名字可解析），
   * 不表示模块是 ESM。
   *
   * 仅在「除该值外没有别的导出」时设置：`export =` 不得与其他导出共存
   * （TS2309），混用时保持既有 ESM 投影。
   */
  exportEquals?: {
    readonly local: string;
    /**
     * BUG-110：挂在**导出函数对象**上的属性 / 方法（`f.version = …` /
     * `f.helper = function…`）。TS 里等价于 `declare function f` +
     * `declare namespace f { … }` 的声明合并；旧产物只发可调用签名 ⇒
     * 消费方 `f.version` / `f.helper` 一律 TS2339。
     */
    members?: string[];
  };
}

/** AST 节点最小形状（Babel AST 的鸭子类型——不引 @babel/types） */
type SurfaceNode = Record<string, unknown> & { type?: string };

/** 标识符名（Identifier / StringLiteral——Babel 的 `export { x as "a-b" }`） */
function surfaceName(n: SurfaceNode | undefined): string | undefined {
  if (!n) return undefined;
  if (n.type === "Identifier" && typeof n.name === "string") return n.name;
  if ((n.type === "StringLiteral" || n.type === "Literal") && typeof n.value === "string") {
    return n.value;
  }
  return undefined;
}

/** 顶层 `const x = <字符串/数字字面量>` 的稳定值（BUG-385，按源码 memo）。 */
const literalConstKeyMemo = new Map<string, ReadonlyMap<string, string>>();
const LITERAL_CONST_KEY_MEMO_MAX = 8;
function literalConstKeysOf(source: string | undefined): ReadonlyMap<string, string> {
  if (source === undefined) return new Map();
  const hit = literalConstKeyMemo.get(source);
  if (hit) return hit;
  const out = new Map<string, string>();
  try {
    const ast = parseSource(source, { errorRecovery: true, keepTs: true }) as unknown as {
      program: { body: Array<Record<string, unknown>> };
    };
    for (const raw of ast.program.body) {
      const stmt =
        raw.type === "ExportNamedDeclaration" || raw.type === "ExportDefaultDeclaration"
          ? ((raw.declaration as Record<string, unknown> | undefined) ?? raw)
          : raw;
      if (stmt.type !== "VariableDeclaration" || stmt.kind !== "const") continue;
      for (const d of (stmt.declarations as Array<Record<string, unknown>> | undefined) ?? []) {
        const id = d.id as { type?: string; name?: string } | undefined;
        const init = d.init as { type?: string; value?: unknown } | null | undefined;
        if (id?.type !== "Identifier" || typeof id.name !== "string" || !init) continue;
        if (init.type === "StringLiteral" && typeof init.value === "string") {
          out.set(id.name, init.value);
        } else if (init.type === "NumericLiteral" && typeof init.value === "number") {
          out.set(id.name, String(init.value));
        }
      }
    }
  } catch {
    // 解析失败 ⇒ 空表（调用方按动态键处理）
  }
  if (literalConstKeyMemo.size >= LITERAL_CONST_KEY_MEMO_MAX) {
    const oldest = literalConstKeyMemo.keys().next().value;
    if (oldest !== undefined) literalConstKeyMemo.delete(oldest);
  }
  literalConstKeyMemo.set(source, out);
  return out;
}

/**
 * BUG-119：类成员**计算键**的静态名（`["a" + "b"]` / `` [`x${"y"}`] ``）。
 * 只折静态可判的字符串拼接/模板；动态键（变量 / 成员表达式）返回 undefined
 * （不猜 ⇒ 不假造成员）。旧实现只认 Identifier/StringLiteral ⇒ 整条成员丢失。
 */
function surfaceComputedKeyName(n: SurfaceNode | undefined): string | undefined {
  if (!n) return undefined;
  if (n.type === "StringLiteral" && typeof n.value === "string") return n.value;
  if (n.type === "NumericLiteral" && typeof n.value === "number") return String(n.value);
  if (n.type === "TemplateLiteral") {
    const exprs = (n.expressions as SurfaceNode[] | undefined) ?? [];
    const quasis = (n.quasis as SurfaceNode[] | undefined) ?? [];
    if (exprs.length === 0 && quasis.length === 1) {
      const cooked = (quasis[0]?.value as SurfaceNode | undefined)?.cooked;
      return typeof cooked === "string" ? cooked : undefined;
    }
    // 静态可折的 `${"a"}`：逐段拼
    let out = "";
    for (let i = 0; i < quasis.length; i++) {
      const cooked = (quasis[i]?.value as SurfaceNode | undefined)?.cooked;
      if (typeof cooked !== "string") return undefined;
      out += cooked;
      const e = exprs[i];
      if (e) {
        const v = surfaceComputedKeyName(e);
        if (v === undefined) return undefined;
        out += v;
      }
    }
    return out;
  }
  if (n.type === "BinaryExpression" && n.operator === "+") {
    const l = surfaceComputedKeyName(n.left as SurfaceNode | undefined);
    const r = surfaceComputedKeyName(n.right as SurfaceNode | undefined);
    return l !== undefined && r !== undefined ? l + r : undefined;
  }
  return undefined;
}

/**
 * 变量声明模式里的**全部绑定名**（Bug 63）。`export const { a, b } = src` /
 * `export const [c, ...rest] = arr` 的 `id` 是 ObjectPattern / ArrayPattern，
 * 旧扫描只读 `surfaceName(d.id)`（恒 undefined）⇒ 这些运行时真实存在的导出
 * 在 dts 面整体缺席（消费端 TS2305）。覆盖 Identifier / RestElement /
 * AssignmentPattern / 嵌套模式。
 */
function patternBindingNames(id: SurfaceNode | undefined): string[] {
  if (!id) return [];
  if (id.type === "Identifier") {
    const n = surfaceName(id);
    return n ? [n] : [];
  }
  const out: string[] = [];
  if (id.type === "ObjectPattern") {
    for (const p of (id.properties as SurfaceNode[] | undefined) ?? []) {
      if (p.type === "RestElement") {
        out.push(...patternBindingNames(p.argument as SurfaceNode | undefined));
        continue;
      }
      out.push(...patternBindingNames((p.value ?? p.argument) as SurfaceNode | undefined));
    }
  } else if (id.type === "ArrayPattern") {
    for (const e of (id.elements as SurfaceNode[] | undefined) ?? []) {
      if (e) out.push(...patternBindingNames(e));
    }
  } else if (id.type === "AssignmentPattern") {
    out.push(...patternBindingNames(id.left as SurfaceNode | undefined));
  } else if (id.type === "RestElement") {
    out.push(...patternBindingNames(id.argument as SurfaceNode | undefined));
  }
  return out;
}

/**
 * 对象字面量成员函数的源码注解（BUG-157）——只收**静态键**的箭头 / 函数
 * 表达式与方法简写。注解原文在这里不做可解析性判定：采集期 `typeNames` 尚未
 * 收齐（模块级 interface / type 声明在值扫描之后），判定推迟到发射期。
 */
function objectFnMemberAnnotations(
  init: SurfaceNode | undefined,
  source: string | undefined,
): DtsObjectFnAnnotation[] {
  if (!init || init.type !== "ObjectExpression" || source === undefined) return [];
  const out: DtsObjectFnAnnotation[] = [];
  for (const p of (init.properties as SurfaceNode[] | undefined) ?? []) {
    const isMethod = p.type === "ObjectMethod";
    const v = p.value as SurfaceNode | undefined;
    const isFnProp =
      (p.type === "ObjectProperty" || p.type === "Property") &&
      (v?.type === "FunctionExpression" || v?.type === "ArrowFunctionExpression");
    if (!isMethod && !isFnProp) continue;
    // BUG-236：计算 symbol 键（`[Symbol.iterator]() { … }`）的成员注解同样
    // 要补进 Abs——否则 symbol 成员行只能发 `unknown`，消费方 `[...obj]` 仍
    // 被 TS2488 挡住（可迭代判定要的是迭代器返回类型）。
    const key =
      p.computed === true
        ? surfaceSymbolKeyName(p.key as SurfaceNode | undefined)
        : surfaceName(p.key as SurfaceNode | undefined);
    if (!key) continue;
    const fnNode = (isMethod ? p : v) as SurfaceNode;
    const rawParams = (fnNode.params as SurfaceNode[] | undefined) ?? [];
    const paramTypes = rawParams.map((n) => nodeAnnotationText(n, source));
    const returnType = nodeAnnotationText(fnNode, source);
    if (!paramTypes.some((t) => t !== undefined) && returnType === undefined) continue;
    out.push({
      key,
      paramTypes,
      rest: rawParams.map((n) => n.type === "RestElement"),
      ...(returnType !== undefined ? { returnType } : {}),
    });
  }
  return out;
}

/**
 * BUG-263：对象字面量里**用户符号**计算键的源码名（`{ [tag]: 1 }` ⇒ `["tag"]`）。
 *
 * Abs 的槽键是引擎内部 id（`@@sym#N`），没有到源码绑定名的反查通道；按
 * 属性出现序收集即可与 Abs 槽序一一对应（well-known symbol 由既有映射处理，
 * 不参与本表）。嵌套对象递归展开，保证渲染顺序一致。
 */
function userSymbolMemberKeys(init: SurfaceNode | undefined): string[] {
  if (!init || init.type !== "ObjectExpression") return [];
  const out: string[] = [];
  for (const p of (init.properties as SurfaceNode[] | undefined) ?? []) {
    const key = p.key as SurfaceNode | undefined;
    if (p.computed === true && key?.type === "Identifier" && typeof key.name === "string") {
      out.push(key.name);
    }
    const v = p.value as SurfaceNode | undefined;
    if (v?.type === "ObjectExpression") out.push(...userSymbolMemberKeys(v));
  }
  return out;
}

/**
 * 初始化器形状 → TS 类型串（Bug 62 的 CJS 值导出 / default 表达式兜底）。
 * 比 `classFieldTypeOfInit` 完整：对象逐成员投影、数组按元素 join ⇒ 消费端
 * `import { obj, arr }` 拿到的不是 `object` / `unknown[]` 这种会 TS2322 的
 * 宽类型。只映射字面量形状，表达式一律 unknown（声明面不猜求值结果）。
 */
function valueTypeTextOfInit(
  init: SurfaceNode | undefined,
  source?: string,
  isKnownValue?: (name: string) => boolean,
  isResolvable?: (name: string, valuePosition?: boolean) => boolean,
): string {
  if (!init) return "unknown";
  if (init.type === "ObjectExpression") {
    const parts: string[] = [];
    const seen = new Set<string>();
    for (const p of (init.properties as SurfaceNode[] | undefined) ?? []) {
      if (
        p.type !== "ObjectProperty" &&
        p.type !== "Property" &&
        p.type !== "ObjectMethod"
      ) {
        continue;
      }
      const computed = p.computed === true;
      const keyName = computed
        ? surfaceSymbolKeyName(p.key as SurfaceNode | undefined) ??
          surfaceName(p.key as SurfaceNode | undefined)
        : surfaceName(p.key as SurfaceNode | undefined);
      if (!keyName) continue;
      const k = computed ? `[${keyName}]` : keyName;
      if (seen.has(k)) continue;
      seen.add(k);
      // BUG-355：ObjectMethod 的 `value` 在 Babel AST 上是 undefined——直接
      // 当属性值读会得到 `unknown`。方法节点本身就是签名来源。
      if (p.type === "ObjectMethod") {
        const kind = String(p.kind ?? "method");
        if (kind === "get") {
          const ret =
            safeFieldTypeAnnotation(nodeAnnotationText(p, source), isResolvable) ?? "unknown";
          parts.push(`${k}: ${ret}`);
          continue;
        }
        if (kind === "set") {
          const params = (p.params as SurfaceNode[] | undefined) ?? [];
          const ann =
            safeFieldTypeAnnotation(nodeAnnotationText(params[0], source), isResolvable) ??
            "unknown";
          parts.push(`${k}: ${ann}`);
          continue;
        }
        parts.push(`${k}: ${functionLiteralTypeText(p, source, isResolvable)}`);
        continue;
      }
      const v = (p.value ?? undefined) as SurfaceNode | undefined;
      parts.push(
        `${k}: ${v ? valueTypeTextOfInit(v, source, isKnownValue, isResolvable) : "unknown"}`,
      );
    }
    return parts.length > 0 ? `{ ${parts.join("; ")} }` : "object";
  }
  if (init.type === "ArrayExpression") {
    const elems = ((init.elements as SurfaceNode[] | undefined) ?? []).filter(
      (e): e is SurfaceNode => !!e,
    );
    const types = [
      ...new Set(elems.map((e) => valueTypeTextOfInit(e, source, isKnownValue, isResolvable))),
    ];
    if (types.length === 0) return "unknown[]";
    return types.length === 1 ? `${types[0]}[]` : `(${types.join(" | ")})[]`;
  }
  // BUG-258：`export const alias = target` / `{ fn: target }` 的类型是
  // `typeof target`（引用声明的 TS 签名），不是合作过的 `() => unknown`。
  if (init.type === "Identifier") {
    const name = surfaceName(init);
    if (name === "undefined") return "undefined";
    if (name && isKnownValue?.(name) === true) return `typeof ${name}`;
    return "unknown";
  }
  if (init.type === "NewExpression") {
    return newExpressionTypeText(init, source);
  }
  return classFieldTypeOfInit(init, source, isResolvable);
}

/**
 * 函数字面量 → TS 函数类型（BUG-356）：保留源码形参 / 返回注解。
 *
 * 旧实现的类字段分支硬编码 `(a0: unknown) => unknown` —— 注解就在 AST 上却
 * 从不读取；同一注解在具名对象字面量通道是正确的。
 */
function functionLiteralTypeText(
  fnNode: SurfaceNode,
  source: string | undefined,
  isResolvable?: (name: string, valuePosition?: boolean) => boolean,
): string {
  const params = Array.isArray(fnNode.params) ? (fnNode.params as SurfaceNode[]) : [];
  const slots = params.map((p, i) => {
    if (p.type === "RestElement") {
      const arg = p.argument as SurfaceNode | undefined;
      const name = surfaceName(arg) ?? `args${i}`;
      const ann = safeFieldTypeAnnotation(nodeAnnotationText(arg, source), isResolvable);
      return `...${name}${ann ? `: ${ann}` : ": unknown[]"}`;
    }
    if (p.type === "AssignmentPattern") {
      const left = p.left as SurfaceNode | undefined;
      const name = surfaceName(left) ?? `arg${i}`;
      const ann = safeFieldTypeAnnotation(nodeAnnotationText(left, source), isResolvable);
      const fallback = valueTypeTextOfInit(
        p.right as SurfaceNode | undefined,
        source,
        undefined,
        isResolvable,
      );
      return `${name}?${ann ? `: ${ann}` : fallback === "unknown" ? "" : `: ${fallback}`}`;
    }
    if (p.type === "Identifier") {
      const name = surfaceName(p) ?? `arg${i}`;
      const ann = safeFieldTypeAnnotation(nodeAnnotationText(p, source), isResolvable);
      const opt = p.optional === true ? "?" : "";
      return `${name}${opt}${ann ? `: ${ann}` : ": unknown"}`;
    }
    return `arg${i}: unknown`;
  });
  const ret =
    safeFieldTypeAnnotation(nodeAnnotationText(fnNode, source), isResolvable) ??
    (fnNode.async === true ? "Promise<unknown>" : "unknown");
  return `(${slots.join(", ")}) => ${ret}`;
}

/** `new X<…>()` → `X<…>`（内建泛型缺实参时补占位，避免 TS2314，BUG-254）。 */
function newExpressionTypeText(init: SurfaceNode, source?: string): string {
  const callee = surfaceQualifiedName(init.callee as SurfaceNode | undefined);
  if (!callee) return "object";
  const params =
    ((init.typeArguments as { params?: SurfaceNode[] } | undefined)?.params ?? []);
  const args = (source === undefined ? [] : params.map((p) => surfaceSlice(source, p)))
    .filter((t): t is string => t !== undefined && t.length > 0);
  if (args.length > 0) return `${callee}<${args.join(", ")}>`;
  return BUILTIN_GENERIC_BRANDS.get(callee) ?? callee;
}

/** 节点是否被 `as const` / `<const>` 冻结（BUG-077 / BUG-140） */
function isConstAssertionNode(node: SurfaceNode | undefined): boolean {
  if (!node) return false;
  if (node.type !== "TSAsExpression" && node.type !== "TSTypeAssertion") return false;
  const ann = node.typeAnnotation as SurfaceNode | undefined;
  return (
    ann?.type === "TSTypeReference" &&
    surfaceName(ann.typeName as SurfaceNode | undefined) === "const"
  );
}

/** 初始化器**内部**（任意深度）是否有 `as const` 断言 */
function containsConstAssertion(node: SurfaceNode | undefined): boolean {
  if (!node || typeof node !== "object") return false;
  if (isConstAssertionNode(node)) return true;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      if (
        value.some(
          (v) => v !== null && typeof v === "object" && containsConstAssertion(v as SurfaceNode),
        )
      ) {
        return true;
      }
      continue;
    }
    if (value !== null && typeof value === "object" && containsConstAssertion(value as SurfaceNode)) {
      return true;
    }
  }
  return false;
}

/**
 * `as const` 冻结子树 → TS 字面量类型（与 `tsc --declaration` 同口径）。
 *
 * `as const` 的操作数受 TS 限制（只允许字面量表达式），所以按 AST 渲染是
 * 可靠的、不需要求值：字面量保精度、对象逐槽 `readonly`、数组成
 * `readonly [ … ]`。
 */
function frozenLiteralType(node: SurfaceNode | undefined): string {
  if (!node) return "unknown";
  switch (node.type) {
    case "StringLiteral":
      return typeof node.value === "string" ? JSON.stringify(node.value) : "string";
    case "NumericLiteral":
      return typeof node.value === "number" ? String(node.value) : "number";
    case "BooleanLiteral":
      return node.value === true ? "true" : "false";
    case "NullLiteral":
      return "null";
    case "BigIntLiteral":
      return typeof node.value === "string" ? `${node.value}n` : "bigint";
    case "Identifier":
      // `undefined` 是唯一合法的标识符操作数；其余（不该出现）不猜，避免把
      // 一个产品里没有声明的名字写进 `.d.ts`（TS2304）。
      return node.name === "undefined" ? "undefined" : "unknown";
    case "UnaryExpression": {
      const arg = node.argument as SurfaceNode | undefined;
      if (
        (node.operator === "-" || node.operator === "+") &&
        arg?.type === "NumericLiteral" &&
        typeof arg.value === "number"
      ) {
        return node.operator === "-" ? `-${arg.value}` : String(arg.value);
      }
      return "unknown";
    }
    case "TemplateLiteral": {
      const quasis = (node.quasis as SurfaceNode[] | undefined) ?? [];
      const exprs = (node.expressions as SurfaceNode[] | undefined) ?? [];
      if (exprs.length > 0) return "string";
      const raw = quasis
        .map((q) => String((q.value as { raw?: string } | undefined)?.raw ?? ""))
        .join("");
      return `\`${raw}\``;
    }
    case "ObjectExpression": {
      const entries: string[] = [];
      for (const p of (node.properties as SurfaceNode[] | undefined) ?? []) {
        if (p.type !== "ObjectProperty" && p.type !== "Property") continue;
        if (p.computed === true) continue;
        const k = surfaceName(p.key as SurfaceNode | undefined);
        if (!k) continue;
        entries.push(
          `readonly ${formatPropKey(k)}: ${frozenLiteralType(p.value as SurfaceNode | undefined)}`,
        );
      }
      return entries.length === 0 ? "Record<string, never>" : `{ ${entries.join("; ")} }`;
    }
    case "ArrayExpression": {
      const elems = ((node.elements as SurfaceNode[] | undefined) ?? []).filter(
        (e): e is SurfaceNode => e !== null && e !== undefined,
      );
      return `readonly [${elems.map(frozenLiteralType).join(", ")}]`;
    }
    default:
      return "unknown";
  }
}

/** 数组元素位：联合 / 带空格的类型要加括号（`(readonly [1, 2])[]`） */
function wrapArrayElementType(t: string): string {
  return /^readonly\s|\s\|\s|&/.test(t) ? `(${t})` : t;
}

/**
 * 初始化器类型（BUG-140 的嵌套 `as const` 档）：逐层按「该子树是否冻结」投影。
 *
 * `nested = { x: [1, 2] as const }` 的绑定本身不是 `as const`（对象未冻结）
 * ⇒ 外层属性不是 `readonly`，内层数组是 `readonly [1, 2]`。只有这种「外层
 * 可变、内层冻结」的形态需要走这里；顶层 `as const` 仍走既有只读通道。
 *
 * **拿不准就不投影**（返回 undefined ⇒ 调用方回落到分析面的观测 Abs）：
 * 展开 / 计算键 / 方法 / 访问器 / 数组展开这些形态按源码逐槽枚举会**丢键**
 * 或把元素域算错（旧实现静默跳过 ⇒ `{ ["a"]: [1, 2] as const }` 变成
 * `Record<string, never>`、`{ ...base, … }` 丢掉 `b`、getter 丢掉 `g`）。
 */
function constAwareValueType(node: SurfaceNode | undefined, source?: string): string | undefined {
  if (!node) return undefined;
  if (isConstAssertionNode(node)) return frozenLiteralType(node.expression as SurfaceNode | undefined);
  if (node.type === "ObjectExpression") {
    const parts: string[] = [];
    for (const p of (node.properties as SurfaceNode[] | undefined) ?? []) {
      // 展开 / 方法 / getter / setter：不是「静态可枚举的数据属性」
      if (p.type !== "ObjectProperty" && p.type !== "Property") return undefined;
      if (typeof p.kind === "string" && p.kind !== "init") return undefined;
      if (p.computed === true) return undefined;
      const k = surfaceName(p.key as SurfaceNode | undefined);
      if (!k) return undefined;
      const v = constAwareValueType(p.value as SurfaceNode | undefined, source);
      if (v === undefined) return undefined;
      parts.push(`${formatPropKey(k)}: ${v}`);
    }
    return parts.length === 0 ? "Record<string, never>" : `{ ${parts.join("; ")} }`;
  }
  if (node.type === "ArrayExpression") {
    const raw = (node.elements as Array<SurfaceNode | null> | undefined) ?? [];
    // 空洞 / 展开：元素域无法按源码列点确定
    if (raw.some((e) => e === null || e === undefined || e.type === "SpreadElement")) {
      return undefined;
    }
    const types: string[] = [];
    for (const e of raw as SurfaceNode[]) {
      const t = constAwareValueType(e, source);
      if (t === undefined) return undefined;
      if (!types.includes(t)) types.push(t);
    }
    if (types.length === 0) return "unknown[]";
    const wrapped = types.map(wrapArrayElementType);
    return wrapped.length === 1 ? `${wrapped[0]}[]` : `(${wrapped.join(" | ")})[]`;
  }
  return valueTypeTextOfInit(node);
}

/** 形参名列表（Identifier / RestElement / AssignmentPattern / 模式 → argN） */function surfaceParamNames(params: SurfaceNode[] | undefined): string[] {
  return (params ?? []).map((p, i) => {
    if (p.type === "Identifier" && typeof p.name === "string") {
      // BUG-122：TS 可选形参 `n?: number` 的 `?` 挂在 Identifier 上
      // （`optional: true`），不是 AssignmentPattern ⇒ 旧实现丢标记，
      // 消费方 `new C()` 报 TS2554。
      return p.optional === true ? `${p.name}?` : p.name;
    }
    if (p.type === "RestElement") {
      const arg = p.argument as SurfaceNode | undefined;
      const n = surfaceName(arg);
      return n ? `...${n}` : `...arg${i}`;
    }
    if (p.type === "AssignmentPattern") {
      // Bug 71：带默认值的形参是**声明级**可省。`paramDeclOf` 经
      // `sanitizeParamName` 会保留尾随 `?`（`x?` → `x?: unknown`），否则构造器 /
      // static 方法的默认值信息在采集期就丢了 ⇒ 消费端 `new C()` / `C.make()`
      // 报 TS2554。
      const n = surfaceName(p.left as SurfaceNode | undefined);
      return `${n ?? `arg${i}`}?`;
    }
    if (p.type === "TSParameterProperty") {
      const inner = p.parameter as SurfaceNode | undefined;
      const n = inner ? surfaceParamNames([inner])[0] : undefined;
      return n ?? `arg${i}`;
    }
    return `arg${i}`;
  });
}

/**
 * BUG-193：形参默认值 → 类型证据（TS 声明面同口径）。
 *
 * `function f(x = 1)` 在 tsc `--declaration` 里是 `f(x?: number)`：默认值
 * **初始值**是类型证据。分析面入口 Abs 不携带默认值（`f()` 的 entry@ 实参
 * 是 any）⇒ dts 形参位曾落 `unknown`。这里从源码 `AssignmentPattern` 的
 * 初始值静态定型（只收字面量形状；标识符 / 调用一律不猜），按位返回。
 *
 * 显式注解位不采集（`tsParamAnnotation` 是更高一档证据）；无任何证据时返回
 * undefined（调用方沿用既有回落）。
 */
function defaultParamTypeTexts(
  params: SurfaceNode[] | undefined,
  source: string | undefined,
): Array<string | undefined> | undefined {
  if (!params || params.length === 0 || source === undefined) return undefined;
  // 与 `extractFormals` 的形参表同口径：`this: T` 是接收者标注，不占形参位。
  const formals = params.filter(
    (p) => !(p?.type === "Identifier" && p.name === "this"),
  );
  let any = false;
  const out = formals.map((p) => {
    const t = defaultParamTypeTextOf(p, source);
    if (t !== undefined) any = true;
    return t;
  });
  return any ? out : undefined;
}

/** 单个形参默认值的静态类型（无证据 ⇒ undefined；见 `defaultParamTypeTexts`） */
function defaultParamTypeTextOf(
  p: SurfaceNode | undefined,
  source: string | undefined,
): string | undefined {
  if (!p || source === undefined) return undefined;
  if (p.type === "TSParameterProperty") {
    return defaultParamTypeTextOf(p.parameter as SurfaceNode | undefined, source);
  }
  if (p.type !== "AssignmentPattern") return undefined;
  const left = p.left as SurfaceNode | undefined;
  if (left?.type !== "Identifier") return undefined;
  // 显式注解优先（这里只补「无注解」的默认形参位）
  if (nodeAnnotationText(left, source) !== undefined) return undefined;
  const text = valueTypeTextOfInit(p.right as SurfaceNode | undefined, source);
  return text === "unknown" ? undefined : text;
}

/** 类成员节点 → 其函数节点（estree MethodDefinition.value / Babel ClassMethod） */
function surfaceMemberFn(member: SurfaceNode): SurfaceNode {
  if (member.type === "MethodDefinition") {
    return (member.value as SurfaceNode | undefined) ?? member;
  }
  return member;
}

/**
 * Bug 49：`MemberExpression` → 点号限定名（`NS.Base` → `"NS.Base"`）。
 * 只用于**超类子句**（`extends NS.Base`）；`surfaceName` 保持原口径不动，
 * 避免影响导出名 / 成员键 / CJS 检测等其它调用点。
 */
function surfaceQualifiedName(n: SurfaceNode | undefined): string | undefined {
  if (!n) return undefined;
  if (n.type === "MemberExpression" && n.computed !== true) {
    const obj = surfaceQualifiedName(n.object as SurfaceNode | undefined);
    const prop = surfaceName(n.property as SurfaceNode | undefined);
    return obj && prop ? `${obj}.${prop}` : undefined;
  }
  return surfaceName(n);
}

/** 类型形参声明节点 → 子句原文（`<T, U = string>`）；无 source / 节点 ⇒ undefined。 */
function typeParamClauseText(node: SurfaceNode | undefined, source: string | undefined): string | undefined {
  if (!source || !node) return undefined;
  const text = surfaceSlice(source, node);
  return text && /^</.test(text) ? text : undefined;
}

/** 超类类型实参实例化节点 → 各实参的源码原文（`extends Base<string>` ⇒ `["string"]`）。 */
function superTypeArgsText(node: SurfaceNode | undefined, source: string | undefined): string[] {
  if (!source || !node) return [];
  const params = node.params as SurfaceNode[] | undefined;
  if (!Array.isArray(params)) return [];
  return params
    .map((p) => surfaceSlice(source, p))
    .filter((t): t is string => t !== undefined && t.length > 0);
}

/** 节点上的 TS 类型注解 → 清洗后的类型文本（`: T` 的 T）。 */
function nodeAnnotationText(n: SurfaceNode | undefined, source: string | undefined): string | undefined {
  if (!source || !n) return undefined;
  // 字段 / 形参注解挂 `typeAnnotation`；方法 / 函数返回注解挂 `returnType`
  // （两者都是 TSTypeAnnotation，真正的类型在 `.typeAnnotation` 上）。
  const ann = (n.typeAnnotation ?? n.returnType) as SurfaceNode | undefined;
  const ta = ann?.typeAnnotation as SurfaceNode | undefined;
  const text = surfaceSlice(source, ta);
  return text ? tsAnnotationTypeText(text) : undefined;
}

/**
 * 「该类型名在产物里可解析」——**唯一**判据（ADR §4 D6 / BUG-005）。
 *
 * 产物自带三类声明，加上环境内建：
 *   ① 本地类（`declare class`）与本地 `interface` / `type` 原文镜像；
 *   ② 会补 `import type` 的导入名；
 *   ③ TS 内建 token 与运行时全局构造器名（`Date` / `Error` / `URL` …）。
 *
 * 此前形参注解与字段注解各写一套（前者漏了 ①，后者连 ② 也没有）⇒ 同一个
 * 本地 `Point` 在形参位被丢成 `unknown`，在类字段位连导入名都不放行。
 */
function isTypeNameResolvable(name: string, surface: DtsModuleSurface | undefined): boolean {
  if (TS_TYPE_TOKENS.has(name) || isRuntimeGlobalCtorName(name)) return true;
  if (surface === undefined) return false;
  return (
    surface.classes.has(name) ||
    surface.imports?.has(name) === true ||
    surface.typeNames?.has(name) === true
  );
}

/**
 * Bug 44：字段的类型注解只有**引用都在产物里可解析**时才放行。
 * 私有类型名（`Hidden` / 未导入名）落进 .d.ts 会 TS2304 ⇒ 回落 `unknown`
 * （与模块级注解的安全降级同口径）。
 */
function safeFieldTypeAnnotation(
  text: string | undefined,
  isResolvable?: (name: string, valuePosition?: boolean) => boolean,
): string | undefined {
  if (!text) return undefined;
  const ok: (n: string, valuePosition?: boolean) => boolean =
    isResolvable ??
    ((n: string) => TS_TYPE_TOKENS.has(n) || isRuntimeGlobalCtorName(n));
  const valueRefs = typeofValueRefs(text);
  return annotationTypeRefs(text).every((n) => ok(n, valueRefs.has(n))) ? text : undefined;
}

/**
 * BUG-130：模块级值声明注解的放行判据（与形参 / 字段同口径）。
 * 引用到产物里不可解析的类型名 ⇒ 不采用（回落观测），并点名首个不可解析名。
 */
function safeValueAnnotation(
  text: string,
  surface: DtsModuleSurface | undefined,
  refs?: Set<string>,
): { text?: string; unresolved?: string } {
  const valueRefs = typeofValueRefs(text);
  for (const name of annotationTypeRefs(text)) {
    if (!isTypeRefResolvable(name, valueRefs.has(name), surface)) return { unresolved: name };
    if (surface?.classes.has(name) || surface?.imports?.has(name) === true) refs?.add(name);
  }
  return { text };
}

/** Bug 88：类体 `TSIndexSignature` → ambient 声明文本（`[key: string]: …;`）。 */
function indexSignatureText(mem: SurfaceNode, source: string | undefined): string | undefined {
  if (!source) return undefined;
  const raw = surfaceSlice(source, mem);
  if (!raw) return undefined;
  const cleaned = tsAnnotationTypeText(raw.replace(/;\s*$/, ""));
  return cleaned ? `${cleaned};` : undefined;
}

/**
 * BUG-175：把同名**无体声明**合并到实现条目上（`overloads`），无实现时
 * 合并到首条声明上（抽象 / ambient 重载集）——保持源码顺序、去掉重复条目。
 *
 * 合并后发射侧只发 `overloads`（= 源码声明集），**不发实现签名**：实现的
 * 形参注解通常是 `any`，混进重载集就是额外 catch-all 重载（消费方传入 tsc
 * 会拒绝的实参也编译通过）。
 */
function coalesceClassMethodOverloads(list: DtsClassMethodSurface[]): void {
  const groups = new Map<string, DtsClassMethodSurface[]>();
  for (const e of list) {
    const g = groups.get(e.name);
    if (g) g.push(e);
    else groups.set(e.name, [e]);
  }
  const drop = new Set<DtsClassMethodSurface>();
  for (const [, group] of groups) {
    const decls = group.filter((e) => e.declarationOnly === true);
    if (decls.length === 0) continue;
    const impl = group.find((e) => e.declarationOnly !== true);
    const keep = impl ?? decls[0]!;
    const signatures = impl === undefined && decls.length === 1 ? [] : decls;
    if (signatures.length > 0) {
      keep.overloads = signatures.map((e) => ({
        name: e.name,
        params: e.params,
        ...(e.paramTypes !== undefined ? { paramTypes: e.paramTypes } : {}),
        ...(e.accessibility !== undefined ? { accessibility: e.accessibility } : {}),
        ...(e.isAbstract === true ? { isAbstract: true } : {}),
        ...(e.returnType !== undefined ? { returnType: e.returnType } : {}),
        ...(e.typeParams !== undefined ? { typeParams: e.typeParams } : {}),
        ...(e.optional === true ? { optional: true } : {}),
        ...(e.symbolKey === true ? { symbolKey: true } : {}),
      }));
    }
    for (const e of group) if (e !== keep) drop.add(e);
  }
  if (drop.size === 0) return;
  let w = 0;
  for (let r = 0; r < list.length; r++) {
    const e = list[r]!;
    if (!drop.has(e)) list[w++] = e;
  }
  list.length = w;
}

/**
 * 类声明面扫描（实例方法 / 静态方法 / 构造器形参 / 类型形参 / 超类）。
 *
 * `isResolvable` = 「该名字在产物里可解析」判据（本地类 / import / TS 全局名）：
 * 只有可解析的超类名才进产物（`extends Unknown` 会产出 TS2304）。
 */
function scanClassSurface(
  decl: SurfaceNode,
  isResolvable: (name: string, valuePosition?: boolean) => boolean = () => false,
  source?: string,
): DtsClassMemberSurface {
  const body = (decl.body as { body?: SurfaceNode[] } | undefined)?.body ?? [];
  // BUG-168：源码声明的类型形参名（`class Box<T, U>`）——产物必须有类型形参槽，
  // 否则消费端 `new Box<string>(…)` 报 TS2558。
  // Babel 的形参节点是 `TSTypeParameter`（`name` 可能是标识符节点，也可能是
  // 字符串——两版 Babel 都见过）⇒ 两种形态都读。
  const typeParamNameOf = (p: SurfaceNode | undefined): string | undefined => {
    if (!p) return undefined;
    if (typeof p.name === "string") return p.name;
    return surfaceName(p.name as SurfaceNode | undefined) ?? surfaceName(p);
  };
  const typeParams = (
    (decl.typeParameters as { params?: SurfaceNode[] } | undefined)?.params ?? []
  )
    .map((p) => typeParamNameOf(p))
    .filter((n): n is string => n !== undefined);
  // Bug 74：类型形参子句原文（`<T = string>`）——含默认值 / 约束。
  const typeParamsText = typeParamClauseText(
    decl.typeParameters as SurfaceNode | undefined,
    source,
  );
  // BUG-132：类自己的类型形参（`class Box<T>`）在字段 / 构造器 / 参数属性的
  // 注解里是合法类型名——不在 `isResolvable` 的四档（本地类 / import /
  // interface·type / 内建）里，旧实现把整条注解当「未声明」丢弃 ⇒
  // `value: unknown` / `constructor(v: unknown)`，与紧邻的 `<T>` 自相矛盾。
  const typeParamScope = new Set(typeParams);
  const resolvableInClass = (name: string, valuePosition?: boolean): boolean =>
    typeParamScope.has(name) || isResolvable(name, valuePosition);
  // BUG-151 / Bug 49：超类（namespace 限定名 `NS.Base` 也要保留）。
  const superName = surfaceQualifiedName(decl.superClass as SurfaceNode | undefined);
  const superClass = superName && isResolvable(superName) ? superName : undefined;
  // Bug 73：源码里写下的超类类型实参（`extends Base<string>`）。
  const superTypeArguments = superTypeArgsText(
    decl.superTypeArguments as SurfaceNode | undefined,
    source,
  );
  // BUG-378：类的 `implements` 子句（文本级保真；接口义务必须在产物里）。
  const implementsTexts =
    source === undefined
      ? []
      : ((decl.implements as SurfaceNode[] | undefined) ?? [])
          .map((n) => surfaceSlice(source, n))
          .filter((t): t is string => t !== undefined);
  // BUG-109：超类不是标识符 / 限定名，而是表达式（`extends mixin(Base)` /
  // `extends (class { … })`）⇒ 留原文作台账，发射侧降级成开放构造基类。
  // 注意：`superName` 有值但**不可解析**（`extends Unknown`）是另一条既有
  // 降级路径（不发射 extends，避免 TS2304）⇒ 不在本条范围内。
  const superExpressionText =
    decl.superClass !== undefined && superName === undefined && source !== undefined
      ? surfaceSlice(source, decl.superClass as SurfaceNode)
      : undefined;
  const instanceMethods: DtsClassMethodSurface[] = [];
  const staticMethods: DtsClassMethodSurface[] = [];
  const staticFields: DtsClassFieldSurface[] = [];
  const accessors: DtsClassAccessorSurface[] = [];
  const indexSignatures: string[] = [];
  let hasPrivateIdentifier = false;
  let ctorParams: string[] | undefined;
  let ctorParamTypes: Array<string | undefined> | undefined;
  /** BUG-042：构造器可见性（源码修饰符；缺省 public） */
  let ctorAccessibility: "private" | "protected" | "public" | undefined;
  /** BUG-234：构造器重载声明集（无体构造器；源码序） */
  const ctorDecls: DtsCtorSignatureSurface[] = [];
  let ctorImpl: DtsCtorSignatureSurface | undefined;
  const instanceFields: DtsClassFieldSurface[] = [];
  /** BUG-033：无注解 getter（待按返回值观测补类型） */
  const pendingGetters: Array<{ index: number; fn: SurfaceNode; isStatic: boolean }> = [];
  /** 无返回注解的静态方法（待按方法体观测补类型；与 getter 同一证据标准） */
  const pendingStaticMethods: Array<{ entry: DtsClassMethodSurface; fn: SurfaceNode }> = [];
  /** 无返回注解的实例方法（待按**注解证据**静态定型；只收窄观测串） */
  const pendingAnnotationReturns: Array<{
    entry: DtsClassMethodSurface;
    fn: SurfaceNode;
    paramNames: string[];
    paramTypes: Array<string | undefined>;
  }> = [];
  const fieldNames = new Set<string>();
  const staticFieldNames = new Set<string>();

  const accessibilityOf = (
    mem: SurfaceNode,
  ): "private" | "protected" | undefined =>
    mem.accessibility === "private" || mem.accessibility === "protected"
      ? mem.accessibility
      : undefined;
  /**
   * 类成员键（BUG-216 / BUG-119）：标识符 / 静态可折的字符串计算键，以及
   * **well-known symbol** 计算键（`[Symbol.iterator]`）。
   *
   * 旧实现只认 `surfaceComputedKeyName`（字符串折叠），symbol 计算键一律
   * undefined ⇒ 采集期的 `if (!key) continue` 把整条成员丢掉。
   */
  const classMemberKeyOf = (
    mem: SurfaceNode,
  ): { name: string; symbolKey?: true } | undefined => {
    if (mem.computed === true) {
      const sym = surfaceSymbolKeyName(mem.key as SurfaceNode | undefined);
      if (sym !== undefined) return { name: sym, symbolKey: true };
      // BUG-385：`const k = "dyn"; [k]()` —— 绑定到字面量 const 的 computed
      // Identifier 有稳定名（tsc 保留 `[k]`；产物发等价的 `dyn()`）。
      const keyNode = mem.key as SurfaceNode | undefined;
      if (keyNode?.type === "Identifier" && typeof keyNode.name === "string") {
        const literal = literalConstKeysOf(source).get(keyNode.name);
        if (literal !== undefined) return { name: literal };
      }
      const folded = surfaceComputedKeyName(keyNode);
      return folded !== undefined ? { name: folded } : undefined;
    }
    const name = surfaceName(mem.key as SurfaceNode | undefined);
    return name !== undefined ? { name } : undefined;
  };
  const fieldAnnotation = (mem: SurfaceNode): string | undefined =>
    // 与形参注解走同一「可解析」判据（本地类 / interface·type / 导入名 / 内建，
    // 加上本类自己的类型形参）；具体名字面由调用方注入。
    safeFieldTypeAnnotation(nodeAnnotationText(mem, source), resolvableInClass);

  const addField = (
    name: string,
    mem: SurfaceNode,
    init: SurfaceNode | undefined,
    symbolKey?: boolean,
  ): void => {
    if (fieldNames.has(name)) return;
    fieldNames.add(name);
    instanceFields.push({
      name,
      // Bug 44：有初始化器看形状，没有则取源码类型注解（不是 `unknown`）。
      type: classFieldType(
        init,
        fieldAnnotation(mem),
        source,
        resolvableInClass,
        mem.readonly === true,
      ),
      // Bug 77 / 86：readonly 与访问修饰符保真。
      ...(mem.readonly === true ? { readonly: true } : {}),
      ...(accessibilityOf(mem) ? { accessibility: accessibilityOf(mem) } : {}),
      ...(mem.abstract === true ? { isAbstract: true } : {}),
      // BUG-044：`x?: T` 的 `?` 挂在 key 上（不在 typeAnnotation 节点里）
      ...(mem.optional === true ? { optional: true } : {}),
      ...(symbolKey === true ? { symbolKey: true } : {}),
    });
  };
  const addStaticField = (name: string, mem: SurfaceNode, symbolKey?: boolean): void => {
    if (staticFieldNames.has(name)) return;
    staticFieldNames.add(name);
    staticFields.push({
      name,
      type: classFieldType(
        mem.value as SurfaceNode | undefined,
        fieldAnnotation(mem),
        source,
        resolvableInClass,
        mem.readonly === true,
      ),
      ...(mem.readonly === true ? { readonly: true } : {}),
      ...(mem.optional === true ? { optional: true } : {}),
      ...(accessibilityOf(mem) ? { accessibility: accessibilityOf(mem) } : {}),
      ...(symbolKey === true ? { symbolKey: true } : {}),
    });
  };
  /**
   * Bug 48：TS 构造器参数属性（`constructor(public id: number, …)`）。
   * 运行时 strip pass 会插入 `this.id = id`，但 dts 读的是剥类型前的 AST ⇒
   * 必须在这里把它们显式登记成实例字段（类型来自源码注解）。
   */
  const collectParamProperty = (p: SurfaceNode): void => {
    if (p.type !== "TSParameterProperty") return;
    const accessibility = accessibilityOf(p);
    const readonly = p.readonly === true;
    let inner = p.parameter as SurfaceNode | undefined;
    let init: SurfaceNode | undefined;
    if (inner?.type === "AssignmentPattern") {
      init = inner.right as SurfaceNode | undefined;
      inner = inner.left as SurfaceNode | undefined;
    }
    const name = surfaceName(inner);
    if (!name || fieldNames.has(name)) return;
    fieldNames.add(name);
    instanceFields.push({
      name,
      type: classFieldType(
        init,
        safeFieldTypeAnnotation(nodeAnnotationText(inner, source), resolvableInClass),
        source,
        resolvableInClass,
        readonly,
      ),
      ...(readonly ? { readonly: true } : {}),
      ...(accessibility ? { accessibility } : {}),
      // BUG-229：`constructor(public z?: string)` 的 `?` 挂在形参自身
      // （AssignmentPattern 解包后是 `left.optional`）——字段面与同文件的
      // `z?: string;` 同口径，否则产物内部自相矛盾（构造器可选、字段必选）。
      ...(inner?.optional === true ? { optional: true } : {}),
    });
  };
  /** 类体里的 `this.<k> = <expr>`（含嵌套语句块） */
  const collectThisAssignments = (node: SurfaceNode | undefined): void => {
    if (!node || typeof node !== "object") return;
    if (node.type === "AssignmentExpression" || node.type === "AssignmentPattern") {
      const left = node.left as SurfaceNode | undefined;
      const obj = left?.object as SurfaceNode | undefined;
      if (left?.type === "MemberExpression" && obj?.type === "ThisExpression") {
        const key = surfaceName(left.property as SurfaceNode | undefined);
        if (key) addField(key, {}, node.right as SurfaceNode | undefined);
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          if (v && typeof v === "object") collectThisAssignments(v as SurfaceNode);
        }
        continue;
      }
      if (value && typeof value === "object") collectThisAssignments(value as SurfaceNode);
    }
  };
  // BUG-083：`static { this.x = … }`（ClassStaticBlock）写入的静态成员。
  // 旧实现只认字段/方法节点 ⇒ 静态块整条被跳过，产物缺成员（消费方 TS2339，
  // 运行期成员其实存在）。只登记 `this.<k> = <expr>` 形态（动态键不猜）。
  const collectStaticAssignments = (node: SurfaceNode | undefined): void => {
    if (!node || typeof node !== "object") return;
    if (node.type === "AssignmentExpression" || node.type === "AssignmentPattern") {
      const left = node.left as SurfaceNode | undefined;
      const obj = left?.object as SurfaceNode | undefined;
      if (left?.type === "MemberExpression" && obj?.type === "ThisExpression") {
        const key =
          left.computed === true
            ? surfaceComputedKeyName(left.property as SurfaceNode | undefined)
            : surfaceName(left.property as SurfaceNode | undefined);
        if (key) addStaticField(key, { value: node.right as SurfaceNode | undefined });
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          if (v && typeof v === "object") collectStaticAssignments(v as SurfaceNode);
        }
        continue;
      }
      if (value && typeof value === "object") collectStaticAssignments(value as SurfaceNode);
    }
  };
  for (const raw of body) {
    const mem = raw as SurfaceNode & { kind?: string; static?: boolean; value?: SurfaceNode };
    if (mem.type === "ClassStaticBlock" || mem.type === "StaticBlock") {
      collectStaticAssignments(mem.body as SurfaceNode | undefined);
      continue;
    }
    // Bug 88：index signature 是公开索引面。
    if (mem.type === "TSIndexSignature") {
      const t = indexSignatureText(mem, source);
      if (t) indexSignatures.push(t);
      continue;
    }
    const isField =
      mem.type === "ClassProperty" ||
      mem.type === "PropertyDefinition" ||
      mem.type === "ClassAccessorProperty" ||
      mem.type === "ClassPrivateProperty";
    if (isField) {
      // Bug 87：`#` 私有字段 ⇒ 类带 `#private;` 名义标记（不作为结构成员发射）。
      if (
        mem.type === "ClassPrivateProperty" ||
        (mem.key as SurfaceNode | undefined)?.type === "PrivateName"
      ) {
        hasPrivateIdentifier = true;
        continue;
      }
      // BUG-119 / BUG-216：计算键走静态折名（`["a" + "b"]` / `["x"]`），
      // well-known symbol 键走括号形态。
      const keyInfo = classMemberKeyOf(mem);
      if (!keyInfo) continue;
      // Bug 23：static 字段也收集（旧的 `mem.static !== true` 过滤把它整条挡掉）。
      if (mem.static === true) addStaticField(keyInfo.name, mem, keyInfo.symbolKey === true);
      else addField(keyInfo.name, mem, mem.value as SurfaceNode | undefined, keyInfo.symbolKey === true);
      continue;
    }
    const isMethod =
      mem.type === "MethodDefinition" ||
      mem.type === "ClassMethod" ||
      mem.type === "TSDeclareMethod";
    if (!isMethod) continue;
    const kind = mem.kind ?? "method";
    const keyInfo = classMemberKeyOf(mem);
    if (!keyInfo) continue;
    const keyName = keyInfo.name;
    const fnNode = surfaceMemberFn(mem);
    const params = surfaceParamNames(fnNode.params as SurfaceNode[] | undefined);
    const accessibility = accessibilityOf(mem);
    const returnType = nodeAnnotationText(mem, source);
    const methodTypeParams = typeParamClauseText(
      (fnNode.typeParameters ?? mem.typeParameters) as SurfaceNode | undefined,
      source,
    );
    // BUG-175 / BUG-234：无体声明 = 重载签名（或 abstract / declare 方法），
    // 有体 = 实现。tsc `--declaration` 只发重载声明，绝不发实现签名。
    const hasBody = fnNode.body !== undefined;
    const paramTypesOf = (
      rawParams: SurfaceNode[],
      resolvable: (name: string) => boolean = resolvableInClass,
    ): Array<string | undefined> =>
      rawParams.map((p) => {
        // BUG-193：默认值初始值是形参类型证据（`m(x = 1)` ⇒ `x?: number`）。
        // 注解优先；无注解时用默认值；都没有 ⇒ undefined（发射侧回落）。
        const defaultValue = defaultParamTypeTextOf(p, source);
        let n = p;
        if (n.type === "TSParameterProperty") {
          n = (n.parameter as SurfaceNode | undefined) ?? n;
        }
        if (n.type === "AssignmentPattern") {
          n = (n.left as SurfaceNode | undefined) ?? n;
        }
        return (
          safeFieldTypeAnnotation(nodeAnnotationText(n, source), resolvable) ?? defaultValue
        );
      });
    if (kind === "constructor") {
      const rawParams = (fnNode.params as SurfaceNode[] | undefined) ?? [];
      const sig: DtsCtorSignatureSurface = {
        params,
        ...(() => {
          const types = paramTypesOf(rawParams);
          return types.some((t) => t !== undefined) ? { paramTypes: types } : {};
        })(),
        ...(accessibilityOf(mem) ? { accessibility: accessibilityOf(mem) } : {}),
      };
      if (hasBody) ctorImpl = sig;
      else ctorDecls.push(sig);
      for (const p of rawParams) collectParamProperty(p);
      collectThisAssignments(fnNode.body as SurfaceNode | undefined);
      continue;
    }
    // Bug 23：getter / setter 是公开成员（不是可调用入口，但属于类型面）。
    if (kind === "get" || kind === "set") {
      const p0 = (fnNode.params as SurfaceNode[] | undefined)?.[0];
      const t =
        (kind === "get" ? returnType : nodeAnnotationText(p0, source)) ?? "unknown";
      accessors.push({
        name: keyName,
        kind,
        type: t,
        ...(mem.static === true ? { isStatic: true } : {}),
        ...(accessibility ? { accessibility } : {}),
        ...(keyInfo.symbolKey === true ? { symbolKey: true } : {}),
      });
      // BUG-033：无注解的 getter 与同类方法 / 对象 getter 同口径——按**返回值
      // 观测**给类型，而不是一律 `unknown`（消费方 TS2322 / TS18046）。
      // 解析推迟到主循环之后：字段表要先收齐（`get value() { return this.n }`）。
      if (kind === "get" && returnType === undefined) {
        pendingGetters.push({ index: accessors.length - 1, fn: fnNode, isStatic: mem.static === true });
      }
      continue;
    }
    if (kind !== "method") continue;
    // BUG-195：**方法级**类型形参（`m<U>(x: U): U`）同样在产物里可解析——
    // 只查类级作用域会把 `U` 判成未声明 ⇒ 返回注解被丢弃、回落观测 `unknown`。
    const methodTypeParamScope = new Set(typeParamNamesInClause(methodTypeParams));
    const resolvableInMethod = (name: string): boolean =>
      methodTypeParamScope.has(name) || resolvableInClass(name);
    // 形参注解与**字段**注解同一「可解析」判据：引用产物里解析不了的类型名
    // 落进 `.d.ts` 就是 TS2304（整份产物编译不过）⇒ 该位回落 TS top。
    const paramTypes = paramTypesOf(
      (fnNode.params as SurfaceNode[] | undefined) ?? [],
      resolvableInMethod,
    );
    // BUG-193：默认值证据也挂到源码面（分析面签名的形参位据此补缺）
    const paramDefaults = defaultParamTypeTexts(
      fnNode.params as SurfaceNode[] | undefined,
      source,
    );
    const entry: DtsClassMethodSurface = {
      name: keyName,
      params,
      ...(paramTypes.some((t) => t !== undefined) ? { paramTypes } : {}),
      ...(paramDefaults !== undefined ? { paramDefaults } : {}),
      ...(accessibility ? { accessibility } : {}),
      ...(mem.abstract === true ? { isAbstract: true } : {}),
      ...(returnType ? { returnType } : {}),
      ...(methodTypeParams ? { typeParams: methodTypeParams } : {}),
      // BUG-215：`m?(): T` 的 `?` 是方法自身的声明修饰符
      ...(mem.optional === true ? { optional: true } : {}),
      ...(keyInfo.symbolKey === true ? { symbolKey: true } : {}),
    };
    if (!hasBody) {
      // 无体声明：先按「重载候选」入表；主循环后与同名实现合并（见
      // coalesceClassMethodOverloads）。无实现时它们自己就是声明面。
      entry.declarationOnly = true;
      (mem.static === true ? staticMethods : instanceMethods).push(entry);
      continue;
    }
    if (mem.static === true) {
      staticMethods.push(entry);
      if (returnType === undefined) pendingStaticMethods.push({ entry, fn: fnNode });
    } else {
      instanceMethods.push(entry);
      if (returnType === undefined) {
        pendingAnnotationReturns.push({ entry, fn: fnNode, paramNames: params, paramTypes });
      } else {
        // BUG-156（注解档）：源码**有**返回注解时，注解本身就是 `check` 签名面
        // 发布的那条类型 —— 求值面把 `this.<字段>` 播种成 any 得到的宽域
        // （`number | string`）不该盖过它。与形参位同一「可解析」判据；发射侧
        // 只收窄不放宽（`refineObservedReturn`），注解对不上观测时原样保留。
        const evidence = safeFieldTypeAnnotation(returnType, resolvableInMethod);
        if (evidence !== undefined) entry.annotationReturnType = evidence;
      }
    }
  }
  // BUG-175：同名无体声明 → 实现条目的 `overloads`（只发声明，不发实现）；
  // 无实现的重载集/抽象声明则合并到首条上（保持源码序）。
  coalesceClassMethodOverloads(instanceMethods);
  coalesceClassMethodOverloads(staticMethods);
  // BUG-033：getter 的返回值观测（无注解档）。
  // **只在 getter 体内恰有一个 `return` 时**采用——多 return 可能返回不同类型，
  // 取「第一个」会把公开类型钉得比运行时**更窄**（不可靠的说法：消费者按窄
  // 类型写代码，运行时拿到另一支）。与对象字面量 getter 的读域同一判定：
  // 拿不准就 `unknown`（不是「无类型」，是「未观测到」）。
  // 只认两种形态——字面量族（初始化器映射）与 `this.<字段>`（字段类型已知）；
  // 其余表达式一律保留 `unknown`（不猜），避免把 getter 变成第二个推断引擎。
  for (const g of pendingGetters) {
    const observed = getterObservedType(g.fn, g.isStatic);
    const prev = accessors[g.index];
    if (observed !== undefined && prev !== undefined) {
      accessors[g.index] = { ...prev, type: observed };
    }
  }
  // 静态方法的**方法体观测**（无注解档）：同名 static / instance 在分析面只有
  // 一条签名（core 普查按 `C.m` 去重），形参不匹配时不能复用实例位返回类型；
  // 此时按静态方法自己的单条 `return` 给可观测类型（与 getter 同判据）。
  for (const m of pendingStaticMethods) {
    const observed = getterObservedType(m.fn, true);
    if (observed !== undefined) m.entry.observedReturnType = observed;
  }
  // BUG-156：无返回注解的实例方法按**源码注解证据**静态定型。
  //
  // 求值面对「声明字段 + 构造器写入」的实例字段播种 `any`（构造器实参是观测
  // 占位）⇒ `return this.n + 1` 折成 `number | string`；而字段注解 `n: number`
  // 就写在同一份产物里，同次 `check` / `tsc --declaration` 都是 `number`。
  // 这里只做**声明面**能确定的一件事：按源码注解（字段 / 形参）与字面量给
  // 单个 `return` 表达式定型（算术 / 模板 / 比较而已，不做调用推断）。
  // 发射侧**只收窄不放宽**（见 `refineObservedReturn`）。
  for (const m of pendingAnnotationReturns) {
    const inferred = annotationReturnTypeOf(m.fn, m.paramNames, m.paramTypes, false);
    if (inferred !== undefined) m.entry.annotationReturnType = inferred;
  }
  // BUG-234：单构造器通道（ctorParams）取「实现优先，否则首条声明」——重载集
  // 存在时发射侧走 ctorOverloads，ctorParams 只服务既有读面。
  const ctorChosen = ctorImpl ?? ctorDecls[0];
  if (ctorChosen !== undefined) {
    ctorParams = ctorChosen.params;
    ctorAccessibility = ctorChosen.accessibility ?? ctorAccessibility;
    ctorParamTypes = ctorChosen.paramTypes;
  }
  /**
   * 单条 `return` 表达式的**注解证据**类型：字面量 / `this.<字段>` / 带注解
   * 形参，以及它们之间的算术与比较。拿不准（调用、下标、任意属性链…）⇒
   * undefined（不猜）。
   */
  function annotationReturnTypeOf(
    fnNode: SurfaceNode,
    paramNames: string[],
    paramTypes: Array<string | undefined>,
    isStatic: boolean,
  ): string | undefined {
    const returns: SurfaceNode[] = [];
    collectReturns(fnNode.body as SurfaceNode | undefined, returns);
    if (returns.length !== 1) return undefined;
    return annotatedExprType(returns[0]!.argument as SurfaceNode | undefined, {
      paramNames,
      paramTypes,
      isStatic,
    });
  }
  /** 纯注解/字面量表达式 → 基元类型文本（不做求值、不做调用推断）。 */
  function annotatedExprType(
    node: SurfaceNode | undefined,
    scope: { paramNames: string[]; paramTypes: Array<string | undefined>; isStatic: boolean },
  ): string | undefined {
    if (!node) return undefined;
    switch (node.type) {
      case "ParenthesizedExpression":
      case "TSNonNullExpression":
      case "TSSatisfiesExpression":
        return annotatedExprType(node.expression as SurfaceNode | undefined, scope);
      case "NumericLiteral":
        return "number";
      case "StringLiteral":
      case "TemplateLiteral":
        return "string";
      case "BooleanLiteral":
        return "boolean";
      case "NullLiteral":
        return "null";
      case "Identifier": {
        const name = surfaceName(node);
        if (!name) return undefined;
        const at = scope.paramNames.indexOf(name);
        return at < 0 ? undefined : primOfText(scope.paramTypes[at]);
      }
      case "MemberExpression": {
        const obj = node.object as SurfaceNode | undefined;
        const key = surfaceName(node.property as SurfaceNode | undefined);
        if (obj?.type !== "ThisExpression" || !key || node.computed === true) return undefined;
        const table = scope.isStatic ? staticFields : instanceFields;
        return primOfText(table.find((f) => f.name === key)?.type);
      }
      case "UnaryExpression": {
        const op = String(node.operator ?? "");
        if (op === "typeof") return "string";
        if (op === "void") return "undefined";
        if (op === "!") return "boolean";
        const arg = annotatedExprType(node.argument as SurfaceNode | undefined, scope);
        return arg === "number" && (op === "-" || op === "+" || op === "~") ? "number" : undefined;
      }
      case "BinaryExpression": {
        const op = String(node.operator ?? "");
        const left = annotatedExprType(node.left as SurfaceNode | undefined, scope);
        const right = annotatedExprType(node.right as SurfaceNode | undefined, scope);
        if (
          op === "==" || op === "!=" || op === "===" || op === "!==" ||
          op === "<" || op === ">" || op === "<=" || op === ">=" ||
          op === "in" || op === "instanceof"
        ) {
          return "boolean";
        }
        // `+` 有一侧是 string ⇒ TS 的 string；否则两个 number / bigint。
        if (op === "+") {
          if (left === "string" || right === "string") return "string";
          if (left === "number" && right === "number") return "number";
          if (left === "bigint" && right === "bigint") return "bigint";
          return undefined;
        }
        if (
          op === "-" || op === "*" || op === "/" || op === "%" || op === "**" ||
          op === "&" || op === "|" || op === "^" || op === "<<" || op === ">>" || op === ">>>"
        ) {
          if (left === "number" && right === "number") return "number";
          if (left === "bigint" && right === "bigint") return "bigint";
        }
        return undefined;
      }
      default:
        return undefined;
    }
  }
  /** 注解文本 → 基元类型名（对象 / 联合 / 泛型 ⇒ undefined：算术面无法确定） */
  function primOfText(t: string | undefined): string | undefined {
    return t === "number" || t === "string" || t === "boolean" || t === "bigint"
      ? t
      : undefined;
  }
  function getterObservedType(fnNode: SurfaceNode, isStatic: boolean): string | undefined {
    const returns: SurfaceNode[] = [];
    collectReturns(fnNode.body as SurfaceNode | undefined, returns);
    // 0 条 = 无 return（或只从嵌套函数返回）；≥2 条 = 多分支 ⇒ 都不猜
    if (returns.length !== 1) return undefined;
    const ret = returns[0]!.argument as SurfaceNode | undefined;
    if (ret === undefined) return undefined;
    if (ret.type === "MemberExpression") {
      const obj = ret.object as SurfaceNode | undefined;
      const key = surfaceName(ret.property as SurfaceNode | undefined);
      if (obj?.type !== "ThisExpression" || !key || ret.computed === true) return undefined;
      const table = isStatic ? staticFields : instanceFields;
      return table.find((f) => f.name === key)?.type;
    }
    const t = classFieldTypeOfInit(ret, source, resolvableInClass);
    return t === "unknown" ? undefined : t;
  }
  /** getter 体内的 `return`（不跨函数边界；收到第二条即可停） */
  function collectReturns(node: SurfaceNode | undefined, out: SurfaceNode[]): void {
    if (!node || typeof node !== "object" || out.length > 1) return;
    if (
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionDeclaration" ||
      node.type === "ClassMethod" ||
      node.type === "MethodDefinition" ||
      // 对象字面量里的方法 / 访问器同样是函数边界：`{ f() { return 1 } }`
      // 的 `return` 不是外层 getter / static 方法的返回值。
      node.type === "ObjectMethod" ||
      node.type === "ClassPrivateMethod"
    ) {
      return;
    }
    if (node.type === "ReturnStatement") {
      out.push(node);
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          if (!v || typeof v !== "object") continue;
          collectReturns(v as SurfaceNode, out);
        }
        continue;
      }
      if (value && typeof value === "object") collectReturns(value as SurfaceNode, out);
    }
  }

  return {
    instanceMethods,
    staticMethods,
    // BUG-234：构造器重载声明集（有实现 ⇒ 只发声明集，与 tsc 同口径）
    ...(ctorDecls.length > 0 ? { ctorOverloads: ctorDecls } : {}),
    ...(ctorParams !== undefined ? { ctorParams } : {}),
    ...(ctorParamTypes !== undefined ? { ctorParamTypes } : {}),
    ...(ctorAccessibility !== undefined ? { ctorAccessibility } : {}),
    ...(typeParams.length > 0 ? { typeParams } : {}),
    ...(typeParamsText !== undefined ? { typeParamsText } : {}),
    ...(superClass !== undefined ? { superClass } : {}),
    ...(superTypeArguments.length > 0 ? { superTypeArguments } : {}),
    ...(superExpressionText !== undefined ? { superExpressionText } : {}),
    ...(implementsTexts.length > 0 ? { implements: implementsTexts } : {}),
    ...(instanceFields.length > 0 ? { instanceFields } : {}),
    ...(staticFields.length > 0 ? { staticFields } : {}),
    ...(accessors.length > 0 ? { accessors } : {}),
    ...(indexSignatures.length > 0 ? { indexSignatures } : {}),
    ...(decl.abstract === true ? { isAbstract: true } : {}),
    ...(hasPrivateIdentifier ? { hasPrivateIdentifier: true } : {}),
  };
}

/**
 * enum 成员初始化器 → **常量值**（BUG-190 + 数值链修正）。
 *
 * 只折 TS 允许的「常量 enum 表达式」：字面量 / 负数 / 模板 / 前序成员引用 /
 * 算术 / 位运算 / 字符串拼接。其余（调用、成员访问、外部变量）⇒ undefined：
 * 声明面不猜求值结果，也**绝不**把不可渲染的初始化器当成「无初始化器」去
 * 自增（`enum E { A = 1, B = val() }` 的 B 不是 2）。
 *
 * 返回 `number | string`，由调用方渲染成 TS 字面量文本。
 */
function enumConstValue(
  node: SurfaceNode | undefined,
  members: ReadonlyMap<string, number | string>,
): number | string | undefined {
  if (!node) return undefined;
  switch (node.type) {
    case "StringLiteral":
      return typeof node.value === "string" ? node.value : undefined;
    case "NumericLiteral":
      return typeof node.value === "number" ? node.value : undefined;
    case "Identifier":
      // 同一 enum 内**已折出**的成员引用（`B = A + 1`）；外部绑定不猜。
      return node.name === undefined ? undefined : members.get(String(node.name));
    case "TemplateLiteral": {
      const quasis = (node.quasis as SurfaceNode[] | undefined) ?? [];
      const exprs = (node.expressions as SurfaceNode[] | undefined) ?? [];
      let out = "";
      for (let i = 0; i < quasis.length; i++) {
        const cooked = (quasis[i]?.value as SurfaceNode | undefined)?.cooked;
        if (typeof cooked !== "string") return undefined;
        out += cooked;
        const e = exprs[i];
        if (e !== undefined) {
          const v = enumConstValue(e, members);
          if (v === undefined) return undefined;
          out += String(v);
        }
      }
      return out;
    }
    case "UnaryExpression": {
      const arg = enumConstValue(node.argument as SurfaceNode | undefined, members);
      if (typeof arg !== "number") return undefined;
      if (node.operator === "-") return -arg;
      if (node.operator === "+") return arg;
      if (node.operator === "~") return ~arg;
      return undefined;
    }
    case "ParenthesizedExpression":
      return enumConstValue(node.expression as SurfaceNode | undefined, members);
    case "BinaryExpression": {
      const l = enumConstValue(node.left as SurfaceNode | undefined, members);
      const r = enumConstValue(node.right as SurfaceNode | undefined, members);
      if (l === undefined || r === undefined) return undefined;
      const op = String(node.operator ?? "");
      // `+` 是 enum 里唯一允许字符串的运算符（`"a" + "b"` / `"a" + 1`）
      if (op === "+") {
        if (typeof l === "string" || typeof r === "string") return String(l) + String(r);
        return l + r;
      }
      if (typeof l !== "number" || typeof r !== "number") return undefined;
      switch (op) {
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return l / r;
        case "%":
          return l % r;
        case "**":
          return l ** r;
        case "<<":
          return l << r;
        case ">>":
          return l >> r;
        case ">>>":
          return l >>> r;
        case "&":
          return l & r;
        case "|":
          return l | r;
        case "^":
          return l ^ r;
        default:
          return undefined;
      }
    }
    default:
      return undefined;
  }
}

/** 折出的常量值 → enum 初始化器文本（`String(-0)` 与 tsc 一致为 `0`） */
function enumInitTextOfValue(value: number | string): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/**
 * 类字段公开类型 = **唯一优先级格**（ADR §4 D2）：声明 > 观测。
 *
 * - `declared`：源码类型注解。mutable 字段的公开类型**不得窄于**注解——
 *   `z: number | null = 1` 若发射成 `number`，消费方按注解写 `null` 就 TS2322
 *   （BUG-014）。这是不可靠的说法：注解允许的值，产物必须允许。
 * - `observed`：初始化器形状（无注解时才用；仍不猜表达式）。
 * - 否则 `unknown`（不是「无类型」，是「未观测到」）。
 */
function classFieldType(
  init: SurfaceNode | undefined,
  annotation?: string,
  source?: string,
  isResolvable?: (name: string, valuePosition?: boolean) => boolean,
  readonly = false,
): string {
  if (annotation !== undefined) return annotation;
  return classFieldTypeOfInit(init, source, isResolvable, readonly);
}

/** 初始化器形状 → 基类型（供 `classFieldType` 与 default 表达式投影复用）。 */
function classFieldTypeOfInit(
  init: SurfaceNode | undefined,
  source?: string,
  isResolvable?: (name: string, valuePosition?: boolean) => boolean,
  readonly = false,
): string {
  if (!init) return "unknown";
  // BUG-273：`readonly r = 5` 与 `const r = 5` 同口径——TS 的只读属性**不参与
  // 字面量拓宽**（`new K().r` 的类型是 `5`）。非 readonly 字段仍发 `number`。
  if (
    readonly &&
    (init.type === "NumericLiteral" ||
      init.type === "StringLiteral" ||
      init.type === "BooleanLiteral" ||
      init.type === "BigIntLiteral" ||
      (init.type === "TemplateLiteral" &&
        ((init.expressions as SurfaceNode[] | undefined) ?? []).length === 0))
  ) {
    return frozenLiteralType(init);
  }
  // BUG-135：断言包装不再「一律按内层」——
  // `ro = [1, 2] as const` 会丢掉只读（`unknown[]`）、
  // `x = 1 as number | string` 会被窄化成 `number`（公开面比实现窄 ⇒ 消费方
  // 按源码注解赋值即 TS2322）。`as const` 走冻结字面量通道；`as T` / `<T>`
  // 用可解析的断言原文（`satisfies T` / `v!` 不改变值类型 ⇒ 仍按内层）。
  if (init.type === "TSAsExpression" || init.type === "TSTypeAssertion") {
    const inner = init.expression as SurfaceNode | undefined;
    if (isConstAssertionNode(init)) return frozenLiteralType(inner);
    const asserted =
      source === undefined
        ? undefined
        : surfaceSlice(source, init.typeAnnotation as SurfaceNode | undefined);
    const safe = asserted ? safeFieldTypeAnnotation(asserted, isResolvable) : undefined;
    return safe ?? classFieldTypeOfInit(inner, source, isResolvable);
  }
  if (init.type === "TSNonNullExpression" || init.type === "TSSatisfiesExpression") {
    return classFieldTypeOfInit(init.expression as SurfaceNode | undefined, source, isResolvable);
  }
  switch (init.type) {
    case "NumericLiteral":
      return "number";
    case "StringLiteral":
    case "TemplateLiteral":
      return "string";
    case "BooleanLiteral":
      return "boolean";
    case "ArrayExpression":
    case "ObjectExpression":
      // BUG-244：类字段通道此前只给容器粗型（`unknown[]` / `object`），而模块值
      // 通道早已逐成员投影 ⇒ 同一形状在类字段位不可用。这里复用同一投影。
      return valueTypeTextOfInit(init, source, undefined, isResolvable);
    case "NewExpression":
      // BUG-244 / BUG-254：`new Map<string, number>()` 的类型实参是源码事实。
      return newExpressionTypeText(init, source);
    case "NullLiteral":
      // `state = null` —— TS 对类字段的推断就是 `null`（不是 any/unknown）
      return "null";
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      // BUG-356：保留源码形参 / 返回注解（与具名对象字面量同口径）。
      return functionLiteralTypeText(init, source, isResolvable);
    case "UnaryExpression": {
      // `-1` / `+1`
      const arg = init.argument as SurfaceNode | undefined;
      return arg?.type === "NumericLiteral" ? "number" : "unknown";
    }
    default:
      return "unknown";
  }
}

/** 源码片段（`keepTs` 的 AST 上类型注解仍在 ⇒ 直接切原文；越界 ⇒ undefined） */
function surfaceSlice(source: string, n: SurfaceNode | undefined): string | undefined {
  const start = n?.start;
  const end = n?.end;
  if (typeof start !== "number" || typeof end !== "number") return undefined;
  const text = source.slice(start, end).trim();
  return text.length > 0 ? text : undefined;
}

/** 形参的类型注解文本（`: T`；无注解 ⇒ 空串） */
function surfaceParamType(source: string, n: SurfaceNode | undefined): string {
  const ta = n?.typeAnnotation as SurfaceNode | undefined;
  const t = surfaceSlice(source, ta?.typeAnnotation as SurfaceNode | undefined);
  return t ? `: ${t}` : "";
}

/**
 * namespace 成员形参（ambient 上下文：**默认值非法** ⇒ `a = 1` 降成 `a?: T`）。
 * 解构形参在 ambient 里无法平移到声明位 ⇒ 记 `argN: unknown`（不假造类型）。
 */
function surfaceNamespaceParam(p: SurfaceNode | undefined, index: number, source: string): string {
  if (!p) return `arg${index}: unknown`;
  if (p.type === "RestElement") {
    const arg = p.argument as SurfaceNode | undefined;
    return `...${surfaceName(arg) ?? `arg${index}`}${surfaceParamType(source, arg)}`;
  }
  if (p.type === "AssignmentPattern") {
    const left = p.left as SurfaceNode | undefined;
    return `${surfaceName(left) ?? `arg${index}`}?${surfaceParamType(source, left)}`;
  }
  if (p.type === "Identifier") {
    const opt = p.optional === true ? "?" : "";
    return `${surfaceName(p) ?? `arg${index}`}${opt}${surfaceParamType(source, p)}`;
  }
  return `arg${index}: unknown`;
}

/**
 * Bug 76：namespace 内的 `export class` 按 **ambient 声明体**渲染成员。
 *
 * 旧实现无条件发 `export class C {}`（理由：ambient 类体不允许初始化器 /
 * 方法实现）——但声明体（`v: number; m(): number;`）在 ambient 上下文完全
 * 合法，被一并丢掉 ⇒ 消费端 `new NS.C().v` TS2339 而运行时成员都在。
 */
function namespaceClassLines(decl: SurfaceNode, source: string): string[] {
  const name = surfaceName(decl.id as SurfaceNode | undefined);
  if (!name) return [];
  const scanned = scanClassSurface(decl, () => true, source);
  const lines: string[] = [];
  // BUG-031：`export class C extends Base` 的 extends 子句此前整条丢掉 ⇒
  // 消费方拿不到基类成员（TS2339），产物与源码形态不符。类型形参同理。
  const tps = typeParamClauseText(decl.typeParameters as SurfaceNode | undefined, source) ?? "";
  const superName = surfaceQualifiedName(decl.superClass as SurfaceNode | undefined);
  const superArgs = superTypeArgsText(
    decl.superTypeArguments as SurfaceNode | undefined,
    source,
  );
  if (scanned.hasPrivateIdentifier) lines.push("#private;");
  for (const idx of scanned.indexSignatures ?? []) lines.push(idx);
  // BUG-234：重载构造器逐条发射（只发声明集）
  if (scanned.ctorOverloads !== undefined && scanned.ctorOverloads.length > 0) {
    for (const sig of scanned.ctorOverloads) {
      const ctorAcc = sig.accessibility ?? scanned.ctorAccessibility;
      const ctorPrefix = ctorAcc !== undefined ? `${ctorAcc} ` : "";
      lines.push(
        `${ctorPrefix}constructor(${sig.params
          .map((p, i) => paramDeclOf(p, i, sig.paramTypes?.[i]))
          .join(", ")});`,
      );
    }
  } else if (scanned.ctorParams) {
    const ctorPrefix = scanned.ctorAccessibility ? `${scanned.ctorAccessibility} ` : "";
    lines.push(
      `${ctorPrefix}constructor(${scanned.ctorParams
        .map((p, i) => paramDeclOf(p, i, scanned.ctorParamTypes?.[i]))
        .join(", ")});`,
    );
  }
  for (const m of scanned.instanceMethods) {
    const parts = [m.accessibility ?? "", m.isAbstract ? "abstract" : ""].filter(Boolean);
    const prefix = parts.length > 0 ? `${parts.join(" ")} ` : "";
    lines.push(...classMethodDeclLines(m, { prefix }));
  }
  for (const m of scanned.staticMethods) {
    const prefix = m.accessibility ? `${m.accessibility} ` : "";
    lines.push(...classMethodDeclLines(m, { static: true, prefix }));
  }
  for (const f of scanned.staticFields ?? []) {
    lines.push(
      `${staticFieldPrefix(f)}${memberKeyText(f.name, f.symbolKey)}${f.optional ? "?" : ""}: ${f.type};`,
    );
  }
  for (const a of scanned.accessors ?? []) {
    const st = a.isStatic ? "static " : "";
    const key = memberKeyText(a.name, a.symbolKey);
    lines.push(
      a.kind === "get"
        ? `${st}get ${key}(): ${a.type};`
        : `${st}set ${key}(v: ${a.type});`,
    );
  }
  for (const f of scanned.instanceFields ?? []) {
    lines.push(
      `${fieldPrefix(f)}${memberKeyText(f.name, f.symbolKey)}${f.optional ? "?" : ""}: ${f.type};`,
    );
  }
  const header =
    superName !== undefined
      ? `export class ${name}${tps} extends ${superName}${
          superArgs.length > 0 ? `<${superArgs.join(", ")}>` : ""
        }`
      : `export class ${name}${tps}`;
  return lines.length > 0
    ? [`${header} {`, ...lines.map((l) => `  ${l}`), `}`]
    : [`${header} {}`];
}

/**
 * namespace 成员声明行（BUG-191）：让 `.d.ts` 的 `NS` 与源导出面同形。
 *
 * 只渲染**有运行时值**的成员（const/let/var/function/class/enum/嵌套 namespace）
 * 与可镜像的类型成员（interface / type 别名，直接切源码原文——类型是 erasable 的，
 * 原文进 ambient 上下文合法）。class 只发空体：ambient 类体不允许初始化器 /
 * 方法实现，切原文会让整份产物编译不过（TS1039）。
 */
function namespaceMemberLines(
  decl: SurfaceNode | null | undefined,
  source: string,
): string[] {
  if (!decl) return [];
  switch (decl.type) {
    case "VariableDeclaration": {
      const kindRaw = String(decl.kind ?? "let");
      const kind = kindRaw === "const" || kindRaw === "var" ? kindRaw : "let";
      const out: string[] = [];
      for (const d of (decl.declarations as SurfaceNode[] | undefined) ?? []) {
        const id = d.id as SurfaceNode | undefined;
        const name = surfaceName(id);
        if (!name) continue;
        // BUG-230：无显式注解时，初始化器形状就是**声明面**的类型证据
        // （`export const inferred = 1` ⇒ `number`，与顶层 `export const` 的
        // widen 口径一致；字面量 widen 到基类型）。旧实现只读源码注解
        // ⇒ 无注解成员一律 `unknown`（消费方 `const n: number = N.inferred`
        // 报 TS2322）。表达式 / 标识符不猜（`valueTypeTextOfInit` 给 unknown）。
        const annotation = surfaceParamType(source, id).slice(2);
        const t =
          annotation ||
          (id?.type === "Identifier"
            ? valueTypeTextOfInit(d.init as SurfaceNode | undefined, source)
            : "unknown");
        out.push(`export ${kind} ${name}: ${t};`);
      }
      return out;
    }
    case "FunctionDeclaration": {
      const name = surfaceName(decl.id as SurfaceNode | undefined);
      if (!name) return [];
      const params = ((decl.params as SurfaceNode[] | undefined) ?? []).map((p, i) =>
        surfaceNamespaceParam(p, i, source),
      );
      const rt = decl.returnType as SurfaceNode | undefined;
      const ret = surfaceSlice(source, rt?.typeAnnotation as SurfaceNode | undefined) ?? "unknown";
      // BUG-027：类型形参子句必须跟着走，否则 `id<T>(v: T): T` 落成
      // `id(v: T): T` —— `T` 在产物里无处声明，`tsc --strict` 直接 TS2304，
      // 而 `nudo export` / `nudo check` 双绿。
      const tps = typeParamClauseText(
        decl.typeParameters as SurfaceNode | undefined,
        source,
      ) ?? "";
      return [`export function ${name}${tps}(${params.join(", ")}): ${ret};`];
    }
    case "ClassDeclaration": {
      // Bug 76：ambient 声明体合法 ⇒ 发射成员，不再无条件空类体。
      return namespaceClassLines(decl, source);
    }
    case "TSEnumDeclaration":
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration": {
      // 枚举成员初始化器在 ambient 上下文合法；interface / type 别名本就是
      // 纯类型 ⇒ 三者都可以直接镜像源码原文。
      const text = surfaceSlice(source, decl);
      if (!text) return [];
      const lines = text.split("\n");
      return [`export ${lines[0]!.trim()}`, ...lines.slice(1)];
    }
    case "TSModuleDeclaration": {
      const name = surfaceName(decl.id as SurfaceNode | undefined);
      if (!name) return [];
      return [
        `export namespace ${name} {`,
        ...namespaceMembersOf(decl, source).map((l) => `  ${l}`),
        `}`,
      ];
    }
    default:
      return [];
  }
}

/** namespace 体 → 成员行（`namespace A.B` 的尾段挂在嵌套 TSModuleDeclaration 上） */
function namespaceMembersOf(decl: SurfaceNode, source: string): string[] {
  const body = decl.body as SurfaceNode | undefined;
  if (body && body.type === "TSModuleDeclaration") {
    const name = surfaceName(body.id as SurfaceNode | undefined);
    if (!name) return [];
    return [
      `export namespace ${name} {`,
      ...namespaceMembersOf(body, source).map((l) => `  ${l}`),
      `}`,
    ];
  }
  const out: string[] = [];
  for (const stmt of (body?.body as SurfaceNode[] | undefined) ?? []) {
    // 只有 `export` 的成员对外可见（未导出成员是 namespace 内部绑定）
    if (stmt.type !== "ExportNamedDeclaration") continue;
    out.push(...namespaceMemberLines(stmt.declaration as SurfaceNode | null | undefined, source));
  }
  return out;
}

/**
 * 模块导出面扫描（源文件 → 导出名表 + 类面 + 再导出语句）。
 *
 * 与 core 侧车的 `localNamedExports` 同源同口径（同一 AST 扫描），但**多**给
 * 两样东西：导出名 → 本地绑定的**映射**（别名导出要按导出名声明）与再导出
 * 语句（dts 要复现再导出面）。
 */
export function dtsModuleSurface(source: string): DtsModuleSurface {
  const surface: DtsModuleSurface = {
    exportBindings: new Map(),
    reexports: [],
    classes: new Map(),
    imports: new Map(),
    values: new Map(),
    namespaces: new Map(),
    typeDeclarations: [],
    typeNames: new Set(),
    valueNames: new Set(),
    typeOnlyExportBindings: new Map(),
    typeParamClauses: new Map(),
    paramDefaults: new Map(),
    namespaceImports: new Map(),
    functionOverloads: new Map(),
  };
  /** BUG-008：`module.exports = <单值>` 的目标（`""` = 匿名右值）；见 surface.exportEquals */
  let exportEqualsCandidate: string | undefined;
  let ast: { program: { body: SurfaceNode[] } };
  try {
    // `keepTs`：导出面扫描要看到 **TS 语法本身** —— `import type`（BUG-168：
    // 注解原文引用的类型名要能补 `import type`）、`export type`、类类型形参
    // （`class Box<T>`）、TS `enum`（BUG-190）在剥除后的 AST 上**都已消失**。
    ast = parseSource(source, { errorRecovery: true, keepTs: true }) as unknown as {
      program: { body: SurfaceNode[] };
    };
  } catch {
    return surface; // 解析失败：无导出面信息，不阻断（与 core 侧车同口径）
  }
  const body = ast.program.body;
  const bind = (exportName: string, local: string): void => {
    if (!exportName) return;
    if (!surface.exportBindings.has(exportName)) surface.exportBindings.set(exportName, local);
  };
  /** 值导出右值是否是函数 / 类（这类走函数声明面，不发值声明） */
  const isFnOrClassInit = (n: SurfaceNode | undefined): boolean =>
    n?.type === "FunctionExpression" ||
    n?.type === "ArrowFunctionExpression" ||
    n?.type === "ClassExpression" ||
    n?.type === "ClassDeclaration" ||
    n?.type === "FunctionDeclaration";
  /**
   * Bug 62：CJS 值导出登记 `surface.values`（此前只 `bind` ⇒ 导出名表有、
   * 值声明表没有 ⇒ dts 面整体缺席；值-only 模块还触发 export 命令空产物早退）。
   * 类型取初始化器形状（分析面对 CJS 赋值没有绑定 Abs 可用）。
   */
  const noteCjsValue = (name: string, init: SurfaceNode | undefined): void => {
    if (!name || surface.values.has(name)) return;
    surface.values.set(name, { kind: "const", typeText: valueTypeTextOfInit(init, source) });
  };
  /** `module.exports` / `exports` → true */  const isExportsTarget = (n: SurfaceNode | undefined): boolean => {
    if (!n) return false;
    if (n.type === "Identifier") return n.name === "exports";
    if (n.type === "MemberExpression") {
      return (
        surfaceName(n.object as SurfaceNode | undefined) === "module" &&
        surfaceName(n.property as SurfaceNode | undefined) === "exports"
      );
    }
    return false;
  };
  /** `exports.a` / `module.exports.a` → "a" */
  const cjsPropName = (left: SurfaceNode | undefined): string | undefined => {
    if (!left || left.type !== "MemberExpression" || left.computed === true) return undefined;
    if (!isExportsTarget(left.object as SurfaceNode | undefined)) return undefined;
    return surfaceName(left.property as SurfaceNode | undefined);
  };

  // ── 类声明（本地名 → AST 节点） ──
  const classDecls = new Map<string, SurfaceNode>();
  /** BUG-360：类表达式绑定（值是构造器，不是类型名）。 */
  const classExpressions = new Set<string>();
  const addClass = (decl: SurfaceNode | null | undefined, preferName?: string): void => {
    // Bug 61：`export const C = class { … }` 的 ClassExpression 也是完整类值，
    // 只认 ClassDeclaration ⇒ dts 落成 `const C: unknown`（消费端 TS18046）。
    if (decl?.type !== "ClassDeclaration" && decl?.type !== "ClassExpression") return;
    // 类表达式自身的 id 是内部名（`class D {}`）⇒ 导出身份是变量名（preferName）。
    const id = preferName ?? surfaceName(decl.id as SurfaceNode | undefined);
    if (id && !classDecls.has(id)) {
      classDecls.set(id, decl);
      if (decl.type === "ClassExpression") classExpressions.add(id);
    }
  };
  /** `export const C = class {}` / `const C = class {}` 的类表达式注册 */
  const scanVarDeclsForClassExpr = (vd: SurfaceNode | null | undefined): void => {
    if (vd?.type !== "VariableDeclaration") return;
    for (const d of (vd.declarations as SurfaceNode[] | undefined) ?? []) {
      const id = surfaceName(d.id as SurfaceNode | undefined);
      const init = d.init as SurfaceNode | undefined;
      if (id && (init?.type === "ClassExpression" || init?.type === "ClassDeclaration")) {
        addClass(init, id);
      }
    }
  };
  for (const stmt of body) {
    if (stmt.type === "ClassDeclaration") {
      addClass(stmt);
      continue;
    }
    if (stmt.type === "VariableDeclaration") {
      scanVarDeclsForClassExpr(stmt);
      continue;
    }
    if (stmt.type === "ExportNamedDeclaration") {
      const d = stmt.declaration as SurfaceNode | null | undefined;
      if (d?.type === "VariableDeclaration") scanVarDeclsForClassExpr(d);
      else addClass(d);
      continue;
    }
    if (stmt.type === "ExportDefaultDeclaration") {
      const d = stmt.declaration as SurfaceNode | null | undefined;
      // Bug 12：匿名 `export default class { … }` 没有 id ⇒ 注册到普查名
      // "default" 上（类方法普查名是 `default.m`），让类声明面能合成它。
      if (d?.type === "ClassDeclaration" && !surfaceName(d.id as SurfaceNode | undefined)) {
        if (!classDecls.has("default")) classDecls.set("default", d);
      } else {
        addClass(d);
      }
    }
  }

  // ── 导入面（Bug 233：brand 类名来自别的模块 ⇒ 产物里要能解析那个名字）──
  // 具名导入按**导出名**记（`import { X as Y }` ⇒ 键 "X"——补 import 用导出名）；
  // 默认导入按**本地名**记；命名空间导入不能当类型名 ⇒ 不收。
  const imports = surface.imports ?? new Map<string, DtsImportSurface>();
  for (const stmt of body) {
    // BUG-387：`import src = require("./types")` 的导入面。
    if (stmt.type === "TSImportEqualsDeclaration") {
      const local = surfaceName(stmt.id as SurfaceNode | undefined);
      const ref = stmt.moduleReference as SurfaceNode | undefined;
      const specifier =
        ref?.type === "TSExternalModuleReference"
          ? String((ref.expression as SurfaceNode | undefined)?.value ?? "")
          : "";
      if (local && specifier && !imports.has(local)) {
        imports.set(local, { specifier, kind: "equals" });
      }
      continue;
    }
    if (stmt.type !== "ImportDeclaration") continue;
    const from = stmt.source as SurfaceNode | undefined;
    const specifier = String(from?.value ?? "");
    if (!specifier) continue;
    for (const spec of (stmt.specifiers as SurfaceNode[] | undefined) ?? []) {
      if (spec.type === "ImportDefaultSpecifier") {
        const local = surfaceName(spec.local as SurfaceNode | undefined);
        if (local && !imports.has(local)) {
          imports.set(local, { specifier, kind: "default" });
        }
        continue;
      }
      if (spec.type === "ImportNamespaceSpecifier") {
        // Bug 49：命名空间导入自己不能当类型名用，但 `extends NS.Base` 需要
        // 补 `import * as NS from "…"` 才可解析 ⇒ 单独登记。
        const local = surfaceName(spec.local as SurfaceNode | undefined);
        if (local) surface.namespaceImports!.set(local, specifier);
        continue;
      }
      if (spec.type !== "ImportSpecifier") continue;
      const exported = surfaceName(spec.imported as SurfaceNode | undefined);
      if (!exported) continue;
      if (!imports.has(exported)) {
        imports.set(exported, { specifier, kind: "named" });
      }
      // BUG-012：`import { X as Y }` —— 本地名 Y 也要能查到来源（再导出用）。
      const local = surfaceName(spec.local as SurfaceNode | undefined);
      if (local && local !== exported && !imports.has(local)) {
        imports.set(local, { specifier, kind: "named", importedName: exported });
      }
    }
  }

  // ── 导出名表 + 再导出语句 ──
  /**
   * BUG-217：`export { I as IA }` 里**被导出的是类型声明**的组（按源语句分组，
   * 与 tsc 同形）。判定推迟到类型声明扫描之后（`typeNames` 才齐）。
   */
  const pendingTypeAliasExports: Array<{
    typeOnly: boolean;
    aliases: Array<{ local: string; exported: string }>;
  }> = [];
  for (const stmt of body) {
    if (stmt.type === "ExportAllDeclaration") {
      // `export * from "x"` / `export * as ns from "x"`（Babel：独立节点）
      const from = stmt.source as SurfaceNode | undefined;
      const src = JSON.stringify(String(from?.value ?? ""));
      const ns = surfaceName(stmt.exported as SurfaceNode | undefined);
      // BUG-309：`export type * from` / `export type * as ns from` 的 `type`
      // 必须保留——否则仅类型导出被发布成值导出。
      const typeKw = stmt.exportKind === "type" ? "type " : "";
      if (ns) {
        surface.reexports.push(`export ${typeKw}* as ${exportNameRepr(ns)} from ${src};`);
        bind(ns, "");
      } else {
        surface.reexports.push(`export ${typeKw}* from ${src};`);
      }
      continue;
    }
    if (stmt.type === "ExportNamedDeclaration") {
      const from = stmt.source as SurfaceNode | undefined;
      const specs = (stmt.specifiers as SurfaceNode[] | undefined) ?? [];
      if (from) {
        // 再导出：`export * from` / `export { a as b } from` / `export * as ns from`
        const src = JSON.stringify(String(from.value ?? ""));
        // BUG-309：语句级 `export type { … } from`。
        const stmtTypeOnly = stmt.exportKind === "type";
        if (specs.length === 0) {
          surface.reexports.push(`export ${stmtTypeOnly ? "type " : ""}* from ${src};`);
          continue;
        }
        const parts: string[] = [];
        for (const spec of specs) {
          // BUG-309：specifier 级 `export { type x as y } from`。
          const specTypeKw = spec.exportKind === "type" && !stmtTypeOnly ? "type " : "";
          if (spec.type === "ExportNamespaceSpecifier") {
            const ns = surfaceName(spec.exported as SurfaceNode | undefined);
            if (!ns) continue;
            // Bug 19：`export * as ns from` 只能写成独立语句，
            // `export { * as ns } from` 是非法 TS（TS1003/1005/1128/1434）。
            // Babel 8 把 `export * as ns from` 解析成 ExportNamedDeclaration +
            // ExportNamespaceSpecifier ⇒ 这条分支才是它真正走到的地方。
            surface.reexports.push(
              `export ${stmtTypeOnly ? "type " : ""}* as ${exportNameRepr(ns)} from ${src};`,
            );
            bind(ns, "");
            continue;
          }
          if (spec.type !== "ExportSpecifier") continue;
          const local = surfaceName(spec.local as SurfaceNode | undefined);
          const exported = surfaceName(spec.exported as SurfaceNode | undefined);
          if (!exported) continue;
          bind(exported, "");
          // Bug 30：导出名 / 本地名都走 exportNameRepr（字符串名 `a-b` ⇒ `"a-b"`）。
          const localRepr = exportNameRepr(local ?? exported);
          const exportedRepr = exportNameRepr(exported);
          parts.push(
            `${specTypeKw}${
              local && local !== exported
                ? `${localRepr} as ${exportedRepr}`
                : exportedRepr
            }`,
          );
        }
        if (parts.length > 0) {
          surface.reexports.push(
            `export ${stmtTypeOnly ? "type " : ""}{ ${parts.join(", ")} } from ${src};`,
          );
        }
        continue;
      }
      const decl = stmt.declaration as SurfaceNode | null | undefined;
      if (decl) {
        if (
          decl.type === "FunctionDeclaration" ||
          decl.type === "ClassDeclaration" ||
          // BUG-190：`export enum Mode` 也是一条导出声明（旧实现漏登记 ⇒
          // 值声明永远不落地；`keepTs` 下 enum 不再是 VariableDeclaration）。
          decl.type === "TSEnumDeclaration"
        ) {
          const id = surfaceName(decl.id as SurfaceNode | undefined);
          if (id) bind(id, id);
        } else if (decl.type === "TSDeclareFunction") {
          // BUG-131：ambient `export declare function f(): T;` 没有函数体、
          // 不进分析面 ⇒ 旧实现既不登记也不发射，整条从产物消失（消费方
          // TS2305）。声明面即事实：原文镜像进产物（与 interface/type 同口径）。
          const id = surfaceName(decl.id as SurfaceNode | undefined);
          if (id) {
            bind(id, id);
            const text = surfaceSlice(source, stmt);
            if (text) {
              surface.typeDeclarations!.push(ambientFunctionDeclarationText(text));
              surface.functionOverloads!.set(id, { exported: true });
            }
          }
        } else if (decl.type === "VariableDeclaration") {
          for (const d of (decl.declarations as SurfaceNode[] | undefined) ?? []) {
            // Bug 63：解构导出绑定（ObjectPattern / ArrayPattern / RestElement）
            // 的导出名此前恒为 undefined ⇒ bind 从未发生 ⇒ dts 面整体缺席。
            for (const id of patternBindingNames(d.id as SurfaceNode | undefined)) {
              bind(id, id);
            }
          }
        } else if (decl.type === "TSModuleDeclaration") {
          // BUG-191：`export namespace NS { … }` 的 dts 模块面——旧实现只认
          // 函数/类/枚举/变量 ⇒ namespace 不登记、不发射 ⇒ 产物里没有 NS
          // （消费端 TS2305）。成员按源码形态镜像（见 namespaceMembersOf）。
          const id = surfaceName(decl.id as SurfaceNode | undefined);
          if (id) {
            bind(id, id);
            surface.namespaces!.set(id, {
              members: namespaceMembersOf(decl, source),
            });
          }
        }
        continue;
      }
      // BUG-217：类型声明的导出别名要单独记（见 pendingTypeAliasExports）——
      // 类型名的可判定性（typeNames）要等下面的原文镜像扫描结束。
      const stmtTypeOnly = stmt.exportKind === "type";
      const aliasSpecs = specs
        .filter((spec): spec is SurfaceNode => spec.type === "ExportSpecifier");
      // BUG-309：`export { type innerFn as localFn };`（无 source）的 specifier
      // 级 `type` 与语句级同义——两者都要落到仅类型别名表。
      pendingTypeAliasExports.push({
        typeOnly:
          stmtTypeOnly ||
          (aliasSpecs.length > 0 && aliasSpecs.every((spec) => spec.exportKind === "type")),
        aliases: aliasSpecs
          .map((spec) => ({
            local: surfaceName(spec.local as SurfaceNode | undefined),
            exported: surfaceName(spec.exported as SurfaceNode | undefined),
          }))
          .filter(
            (a): a is { local: string; exported: string } =>
              a.local !== undefined && a.exported !== undefined,
          ),
      });
      for (const spec of aliasSpecs) {
        if (!stmtTypeOnly && spec.exportKind !== "type") continue;
        // 记录「这个 export 名是仅类型」——发射通道（值 / 类 / 导入绑定）据此
        // 保留 `type` 修饰符，而不是把它发布成值导出。
        const exportedName = surfaceName(spec.exported as SurfaceNode | undefined);
        const localName = surfaceName(spec.local as SurfaceNode | undefined);
        if (exportedName !== undefined && localName !== undefined) {
          surface.typeOnlyExportBindings!.set(exportedName, localName);
        }
      }
      for (const spec of specs) {
        if (spec.type === "ExportNamespaceSpecifier") {
          const ns = surfaceName(spec.exported as SurfaceNode | undefined);
          if (ns) bind(ns, "");
          continue;
        }
        if (spec.type !== "ExportSpecifier") continue;
        const local = surfaceName(spec.local as SurfaceNode | undefined);
        const exported = surfaceName(spec.exported as SurfaceNode | undefined);
        if (!exported || !local) continue;
        bind(exported, local);
        // BUG-390：本地再导出命名空间导入 —— 产物补
        // `import * as ns …; export { ns };`（不得静默空产物）。
        if (surface.namespaceImports?.has(local)) {
          surface.reexports.push(
            `export { ${exportNameRepr(local)} as ${exportNameRepr(exported)} };`,
          );
        }
      }
      continue;
    }
    if (stmt.type === "ExportDefaultDeclaration") {
      const decl = stmt.declaration as SurfaceNode | null | undefined;
      if (!decl) {
        bind("default", "");
        continue;
      }
      if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") {
        // 匿名默认类 / 函数没有本地绑定名。匿名默认**类**的类声明面由
        // `classDecls` 里按普查名 "default" 的注册承载（Bug 12A），与这里的
        // 导出绑定表无关（dtsExportNamesOf 对 "default" 有专用分支）。
        bind("default", surfaceName(decl.id as SurfaceNode | undefined) ?? "");
        continue;
      }
      if (decl.type === "ArrowFunctionExpression" || decl.type === "FunctionExpression") {
        // 匿名默认函数由普查面函数声明发射（Bug 12B 给名字），不另发值声明
        // （否则与 `export default function …` 撞成两个 default 导出）。
        bind("default", "");
        continue;
      }
      if (decl.type === "Identifier") {
        bind("default", surfaceName(decl) ?? "");
        continue;
      }
      // BUG-272：`export default interface D { … }` / `export default type T = …`
      // 是**类型声明**，不是值表达式——旧实现落到下面的 `_default: unknown`
      // 值通道，接口声明与 typeNames 登记双双丢失（消费方 `import D` 当类型
      // 用 TS2749）。原文镜像进 typeDeclarations（切片本身带 `export default`）。
      if (decl.type === "TSInterfaceDeclaration" || decl.type === "TSTypeAliasDeclaration") {
        const name = surfaceName(decl.id as SurfaceNode | undefined);
        const text = surfaceSlice(source, stmt);
        if (text) surface.typeDeclarations!.push(text);
        if (name) surface.typeNames!.add(name);
        continue;
      }
      // Bug 20：非函数 / 非标识符的 `export default <表达式>`（42 / "x" /
      // {…} / fac()）从 dts 模块面整体消失 ⇒ 登记一条合成值绑定 `_default`。
      //
      // BUG-009：类型必须走 `valueTypeTextOfInit`（对象逐成员 / 数组按元素
      // join）——`classFieldTypeOfInit` 只给宽类型 `object` / `unknown[]`，
      // 消费方 `cfg.a` 直接 TS2339。与 CJS `module.exports = {…}` 同口径。
      if (!surface.values.has("_default")) {
        surface.values.set("_default", {
          kind: "const",
          typeText: valueTypeTextOfInit(decl, source),
        });
      }
      bind("default", "_default");
      continue;
    }
    if (stmt.type === "ExpressionStatement") {
      const expr = stmt.expression as SurfaceNode | undefined;
      if (expr?.type !== "AssignmentExpression" || expr.operator !== "=") continue;
      const left = expr.left as SurfaceNode | undefined;
      const right = expr.right as SurfaceNode | undefined;
      if (!left || !right) continue;
      const prop = cjsPropName(left);
      if (prop && prop !== "default") {
        bind(prop, prop);
        // Bug 62：`exports.num = 1` 等值导出登记值声明（函数 / 类右值走函数面）
        if (!isFnOrClassInit(right)) noteCjsValue(prop, right);
        continue;
      }
      if (!isExportsTarget(left)) continue;
      if (right.type === "ObjectExpression") {
        for (const p of (right.properties as SurfaceNode[] | undefined) ?? []) {
          const key = surfaceName(p.key as SurfaceNode | undefined);
          if (!key || key === "default") continue;
          bind(key, key);
          // 只有值成员登记值声明（方法 / 函数值属性走函数声明面）
          const v = (p.value ?? undefined) as SurfaceNode | undefined;
          if (p.type !== "ObjectMethod" && p.type !== "ClassMethod" && !isFnOrClassInit(v)) {
            noteCjsValue(key, v);
          }
        }
        continue;
      }
      if (right.type === "Identifier") {
        const n = surfaceName(right);
        if (n) {
          bind(n, n);
          // BUG-008：`module.exports = real` —— 模块形态是 `export =`。
          exportEqualsCandidate = n;
        }
        continue;
      }
      bind("default", "");
      // BUG-008：`module.exports = function () {}`（匿名右值）同样是 `export =`
      exportEqualsCandidate = "";
    }
  }

  // BUG-175：**未带 export** 的顶层重载声明（`function over(a: s): s;` +
  // `export { over as over2 }`）——导出别名由 `dtsExtraExportLines` 补，声明
  // 本身按 ambient 形态镜像（`.d.ts` 与 stdout 平铺面都可编译）。
  for (const stmt of body) {
    if (stmt.type !== "TSDeclareFunction") continue;
    const id = surfaceName(stmt.id as SurfaceNode | undefined);
    if (id === undefined) continue;
    const text = surfaceSlice(source, stmt);
    if (text === undefined) continue;
    surface.typeDeclarations!.push(ambientFunctionDeclarationText(text));
    surface.functionOverloads!.set(id, { exported: false });
  }

  // BUG-008：`export =` 的形态判定放在**镜像类型声明扫描之后**（见下）——
  // `export interface` / `export type` 同样是「其它导出」（TS2309）。

  // ── 模块级值声明（BUG-190）──
  // `export const/let/var` 与 TS `enum` 在导出名表里已登记，但旧实现只发射
  // 函数与类 ⇒ 这些绑定**被登记但从不落地** ⇒ 发布的 `.d.ts` 里没有它们
  // ⇒ 消费端 `import { VERSION }` 报 TS2305，而运行时确实有该导出。
  // 这里只采集**声明形态**（种类 + enum 成员名）；值的类型来自分析面绑定
  // （`projectModuleDts` 的 `values` 实参）。
  /** Bug 77：`{…} as const` / `<const>{…}` ⇒ 对象槽按只读投影。 */
  const isAsConst = (init: SurfaceNode | undefined): boolean => isConstAssertionNode(init);
  // BUG-258：顶层值名（`typeof target` 只对真正存在的绑定成立）——在值声明
  // 扫描之前一次性收集，避免把局部 / 未声明名字写成 TS2304。
  const knownTopLevelValues = new Set<string>();
  for (const stmt of body) {
    const decl =
      stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration"
        ? ((stmt.declaration as SurfaceNode | null | undefined) ?? stmt)
        : stmt;
    if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") {
      const id = surfaceName(decl.id as SurfaceNode | undefined);
      if (id) knownTopLevelValues.add(id);
    } else if (decl.type === "VariableDeclaration") {
      for (const d of (decl.declarations as SurfaceNode[] | undefined) ?? []) {
        for (const id of patternBindingNames(d.id as SurfaceNode | undefined)) {
          knownTopLevelValues.add(id);
        }
      }
    } else if (decl.type === "ImportDeclaration") {
      for (const spec of (decl.specifiers as SurfaceNode[] | undefined) ?? []) {
        const local = surfaceName(spec.local as SurfaceNode | undefined);
        if (local) knownTopLevelValues.add(local);
      }
    }
  }
  /** BUG-264：`const s = Symbol("…")` ⇒ `unique symbol`（`Symbol.for` 除外）。 */
  const isUniqueSymbolInit = (init: SurfaceNode | undefined): boolean =>
    init?.type === "CallExpression" &&
    surfaceName(init.callee as SurfaceNode | undefined) === "Symbol" &&
    (init.callee as SurfaceNode | undefined)?.type === "Identifier";
  const noteValueDecl = (decl: SurfaceNode | null | undefined): void => {
    if (!decl) return;
    if (decl.type === "VariableDeclaration") {
      const raw = String(decl.kind ?? "");
      const kind = raw === "const" || raw === "var" ? raw : "let";
      for (const d of (decl.declarations as SurfaceNode[] | undefined) ?? []) {
        const init = d.init as SurfaceNode | undefined;
        const idNode = d.id as SurfaceNode | undefined;
        // BUG-130：声明器的类型注解（`export const c1: number[] = []`）。只对
        // 单标识符绑定采集——解构模式上的注解描述的是**整个模式**，不能当成
        // 每个绑定各自的类型。
        const annotation =
          idNode?.type === "Identifier" ? nodeAnnotationText(idNode, source) : undefined;
        // BUG-140：绑定本身不是 `as const`、但初始化器内部有断言
        // （`{ x: [1, 2] as const }`）⇒ 按源码逐层冻结语义投影，别走可变容器
        // 拓宽（那会把内层元组的字面量与只读一起拓掉）。
        //
        // 回归修正：与 `annotation` 同一条守卫——只对**单标识符**绑定挂这个
        // 类型。解构模式（`const { x, y } = { … }`）的初始化器类型描述的是
        // **整个右值**，挂到每个绑定上会让 `x`/`y` 都声明成整个对象
        // （消费端 TS2339）；模式绑定回落到分析面的观测类型。
        const nestedConstType =
          idNode?.type === "Identifier" && !isAsConst(init) && containsConstAssertion(init)
            ? constAwareValueType(init, source)
            : undefined;
        // BUG-157：对象字面量成员函数的源码注解（求值面只有形参名）。只对
        // 单标识符绑定采集——解构模式上的初始化器类型描述的是整个右值。
        const fnMemberAnnotations =
          idNode?.type === "Identifier" ? objectFnMemberAnnotations(init, source) : [];
        // BUG-258 / BUG-254：源码初始化器里 Abs 表达不了的声明事实（`typeof X`
        // 引用 / 显式泛型实参）。只对单标识符绑定采集。
        const initTypeText =
          idNode?.type === "Identifier"
            ? valueTypeTextOfInit(init, source, (n) => knownTopLevelValues.has(n))
            : undefined;
        // BUG-263：用户符号成员键（`{ [tag]: 1 }`）的源码名。
        const userSymbolKeys =
          idNode?.type === "Identifier" ? userSymbolMemberKeys(init) : [];
        // BUG-264：`const s = Symbol("s")`（无显式 `: symbol` 注解）⇒ unique symbol。
        const uniqueSymbol =
          kind === "const" &&
          idNode?.type === "Identifier" &&
          annotation === undefined &&
          isUniqueSymbolInit(init);
        // BUG-260：只有 `const <ident> = <primitive literal>` 保留字面量；
        // 解构 / 复合初始化器仍走拓宽（与 tsc 的 const 推断一致）。
        const literalConst =
          kind === "const" &&
          idNode?.type === "Identifier" &&
          annotation === undefined &&
          (init?.type === "StringLiteral" ||
            init?.type === "NumericLiteral" ||
            init?.type === "BooleanLiteral" ||
            init?.type === "BigIntLiteral");
        // BUG-358：该绑定是值（不是函数 / 类值）——同名 phantom 函数入口不得
        // 抢占它的导出声明。
        const nonFunctionValue =
          init == null ||
          (init.type !== "ArrowFunctionExpression" &&
            init.type !== "FunctionExpression" &&
            init.type !== "ClassExpression" &&
            init.type !== "FunctionDeclaration" &&
            init.type !== "ClassDeclaration");
        // Bug 63：解构声明模式展开**全部绑定名**（`{ a, b }` / `[c, ...rest]`）
        // ⇒ 每个绑定都进 surface.values（dtsValueDeclarations 逐条读它）。
        for (const id of patternBindingNames(idNode)) {
          if (surface.values.has(id)) continue;
          surface.values.set(id, {
            kind,
            ...(isAsConst(init) ? { asConst: true } : {}),
            ...(annotation !== undefined ? { annotation } : {}),
            ...(nestedConstType !== undefined ? { nestedConstType } : {}),
            ...(fnMemberAnnotations.length > 0 ? { fnMemberAnnotations } : {}),
            ...(initTypeText !== undefined ? { initTypeText } : {}),
            ...(literalConst ? { literalConst: true } : {}),
            ...(uniqueSymbol ? { uniqueSymbol: true } : {}),
            ...(userSymbolKeys.length > 0 ? { userSymbolKeys } : {}),
            ...(nonFunctionValue ? { nonFunctionValue: true } : {}),
          });
        }
      }
      return;
    }
    if (decl.type === "TSEnumDeclaration") {
      const id = surfaceName(decl.id as SurfaceNode | undefined);
      if (!id) return;
      // Babel 的 enum 成员数组有两种形态：旧版直接挂 `members`，新版包在
      // `TSEnumBody` 里（`body.members`）——都读。
      const enumBody = decl.body as SurfaceNode | undefined;
      const members = Array.isArray(decl.members)
        ? (decl.members as SurfaceNode[])
        : Array.isArray(enumBody)
          ? (enumBody as SurfaceNode[])
          : Array.isArray(enumBody?.members)
            ? (enumBody!.members as SurfaceNode[])
            : [];
      const enumMembers: { name: string; init?: string }[] = [];
      // BUG-139：数值 enum 的隐式自增必须算出字面量（tsc 产物同口径）——
      // 否则消费端 `const y: 2 = E.B` 因成员类型退成 `E.B` 而 TS2322。
      //
      // 回归修正：**只有**「源码没写初始化器」(`initNode === undefined`) 才能
      // 自增。写了但不可折的初始化器（`B = val()` / `A = other.length`）既
      // 不能凭空 +1（`enum E { A = 1, B = val() }` 的 B 不是 2），也不能猜值 ⇒
      // 只发射成员名并断开数值链（tsc `--declaration` 同形：`B`）。
      let prevNumeric: number | undefined = -1; // 首个无初始化器成员 ⇒ 0（tsc 同口径）
      const constValues = new Map<string, number | string>();
      for (const m of members) {
        const name =
          surfaceName(m.id as SurfaceNode | undefined) ??
          surfaceName(m.key as SurfaceNode | undefined);
        if (!name) continue;
        const initNode = m.initializer as SurfaceNode | undefined;
        if (initNode === undefined) {
          if (prevNumeric !== undefined) {
            prevNumeric += 1;
            constValues.set(name, prevNumeric);
            enumMembers.push({ name, init: String(prevNumeric) });
          } else {
            enumMembers.push({ name });
          }
          continue;
        }
        const value = enumConstValue(initNode, constValues);
        if (value === undefined) {
          prevNumeric = undefined;
          enumMembers.push({ name });
          continue;
        }
        constValues.set(name, value);
        // 字符串成员不参与后续自增（`enum { A = "a", B }` 本身是 TS1061）。
        prevNumeric = typeof value === "number" ? value : undefined;
        enumMembers.push({ name, init: enumInitTextOfValue(value) });
      }
      // Bug 25：`export const enum` 的 `const` 限定必须保留（否则消费端 tsc
      // 通过、运行时 import 报「does not provide an export named …」）。
      surface.values.set(id, {
        kind: "enum",
        enumMembers,
        ...(decl.const === true ? { constEnum: true } : {}),
      });
    }
  };
  for (const stmt of body) {
    if (stmt.type === "VariableDeclaration" || stmt.type === "TSEnumDeclaration") {
      noteValueDecl(stmt);
      continue;
    }
    if (stmt.type === "ExportNamedDeclaration") {
      noteValueDecl(stmt.declaration as SurfaceNode | null | undefined);
    }
  }
  // BUG-262：值命名空间的名字面（`typeof X` 的 X 是**值**，不是类型）。
  for (const local of surface.values.keys()) surface.valueNames!.add(local);
  for (const stmt of body) {
    const decl =
      stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration"
        ? ((stmt.declaration as SurfaceNode | null | undefined) ?? stmt)
        : stmt;
    if (decl.type === "FunctionDeclaration") {
      const id = surfaceName(decl.id as SurfaceNode | undefined);
      if (id) surface.valueNames!.add(id);
    } else if (decl.type === "VariableDeclaration") {
      for (const d of (decl.declarations as SurfaceNode[] | undefined) ?? []) {
        for (const id of patternBindingNames(d.id as SurfaceNode | undefined)) {
          surface.valueNames!.add(id);
        }
      }
    }
  }
  // 导入的值同样在值命名空间（`typeof importedFn`）；`import type` 除外。
  for (const stmt of body) {
    if (stmt.type !== "ImportDeclaration" || stmt.importKind === "type") continue;
    for (const spec of (stmt.specifiers as SurfaceNode[] | undefined) ?? []) {
      if (spec.importKind === "type") continue;
      const local = surfaceName(spec.local as SurfaceNode | undefined);
      if (local) surface.valueNames!.add(local);
    }
  }

  // ── Bug 22 / 75：模块顶层 `interface` / `type` 别名原文镜像 ──
  // 导出的（`export interface Top`）切整个 ExportNamedDeclaration（带 `export`）；
  // 未导出的私有类型（`interface Hidden`）只发声明（tsc `--declaration` 同口径）
  // ⇒ namespace 成员引用私有类型时产物里可解析（否则 TS2304）。
  const noteTypeDecl = (slice: SurfaceNode, decl: SurfaceNode): void => {
    // 切 `slice`（`export interface X` 要带 export；`decl` 只是内层声明）
    const text = surfaceSlice(source, slice);
    if (text) surface.typeDeclarations!.push(text);
    // BUG-005：类型名要进「产物里可解析」的名字面（形参 / 字段注解可引用它）。
    const name = surfaceName(decl.id as SurfaceNode | undefined);
    if (name) surface.typeNames!.add(name);
  };
  for (const stmt of body) {
    if (stmt.type === "TSInterfaceDeclaration" || stmt.type === "TSTypeAliasDeclaration") {
      noteTypeDecl(stmt, stmt);
      continue;
    }
    if (stmt.type === "ExportNamedDeclaration") {
      const d = stmt.declaration as SurfaceNode | null | undefined;
      if (d?.type === "TSInterfaceDeclaration" || d?.type === "TSTypeAliasDeclaration") {
        noteTypeDecl(stmt, d);
      }
    }
  }

  // BUG-217：类型声明的局部导出别名 → `export { I as IA };` / `export type { … };`。
  // 只补**类型名**：函数 / 类 / 值 / namespace 的别名由各自发射通道补
  // （`dtsExtraExportLines` / `dtsValueDeclarations`），这里再发就是重复声明。
  {
    const typeAliasLines: string[] = [];
    for (const group of pendingTypeAliasExports) {
      const parts: string[] = [];
      for (const a of group.aliases) {
        if (surface.typeNames!.has(a.local) !== true) continue;
        if (
          classDecls.has(a.local) ||
          surface.values.has(a.local) ||
          surface.namespaces!.has(a.local)
        ) {
          continue;
        }
        parts.push(
          a.local === a.exported
            ? exportNameRepr(a.exported)
            : `${exportNameRepr(a.local)} as ${exportNameRepr(a.exported)}`,
        );
      }
      if (parts.length > 0) {
        typeAliasLines.push(`export ${group.typeOnly ? "type " : ""}{ ${parts.join(", ")} };`);
      }
    }
    if (typeAliasLines.length > 0) surface.typeExportAliases = typeAliasLines;
  }

  // ── 全局增强原文镜像：模块级 `declare global { … }` / `declare namespace X` ──
  // BUG-167：全局增强在 AST 里是一个**裸 `TSModuleDeclaration`**——没有
  // `ExportNamedDeclaration` 外壳（`kind: "global"`，无 id 名可登记），也不是
  // 类型别名 ⇒ 上面五趟顶层扫描（类 / 导入面 / 导出名表 / 值声明 / interface
  // 与 type 镜像）**一趟都不命中** ⇒ 整块静默消失：消费方 `window.<member>`、
  // `NodeJS.ProcessEnv` 的增强读不到（TS2339），而 `nudo export` 照样报绿。
  // tsc `--declaration` 对同一写法原样保留（`declare global { … }` 在 dts 里
  // 是同形事实）⇒ 这里同口径原文镜像。`declare namespace NodeJS { … }` 这类
  // ambient 命名空间增强同样是裸 `TSModuleDeclaration`（`declare: true`），
  // 同一条通道落地（否则整块丢；成员多寡不影响，切的是整条语句）。
  const isGlobalAugmentation = (n: SurfaceNode): boolean =>
    n.kind === "global" ||
    n.global === true ||
    (n.declare === true && surfaceName(n.id as SurfaceNode | undefined) === "global");
  for (const stmt of body) {
    if (stmt.type !== "TSModuleDeclaration") continue;
    if (!isGlobalAugmentation(stmt) && stmt.declare !== true) continue;
    const text = surfaceSlice(source, stmt);
    if (text) surface.typeDeclarations!.push(text);
  }

  // BUG-008：只有「这个值就是模块本身」时才是 `export =`。
  //
  // 排除项（都是 TS2309「export assignment 不得与其他导出元素共存」）：
  // - `module.exports` 之外还有具名值导出（`exports.x = …` / `export const`）；
  // - 镜像进产物的 **`export interface` / `export type`** —— BUG-005 让本地
  //   类型原文镜像进同一份产物后，`export =` 与它共存会让产物直接编译失败
  //   （`error TS2309`），而 `nudo export` 仍 exit 0。
  //   这类混用源码在 TS 自己的 `--declaration` 里本来就只有具名导出
  //   （`module.exports = C` 只是对全局 `module` 的赋值，不构成声明面事实）
  //   ⇒ 保持既有 ESM 投影，不猜 `export =`（与 TS 同答案，且产物可编译）。
  const hasExportedTypeDecl = (surface.typeDeclarations ?? []).some((t) =>
    /^\s*export\b/.test(t),
  );
  /**
   * 注解原文在产物里是否可解析（值声明 / CJS 函数成员共用；与类字段 /
   * 形参同一判据，落实在此处是因为 `typeNames` 已扫描完毕）。
   */
  const isResolvableValueType = (name: string, valuePosition?: boolean): boolean =>
    TS_TYPE_TOKENS.has(name) ||
    isRuntimeGlobalCtorName(name) ||
    classDecls.has(name) ||
    imports.has(name) ||
    surface.typeNames!.has(name) ||
    (valuePosition === true && surface.valueNames!.has(name));
  /**
   * BUG-110：`module.exports = f` 之后 `f.version = …` / `f.helper = function…`
   * 是**函数对象上的成员写**。TS 的可调用模块用声明合并表达：
   * `declare function f` + `declare namespace f { … }`。此前 CJS 槽采集只收
   * `exports.x` / `module.exports.x`，这些 `f.<prop>` 一条都不进产物 ⇒
   * 消费方 `f.version` / `f.helper(2)` 全部 TS2339。
   */
  const exportEqualsMembersOf = (local: string): string[] => {
    if (local === "") return [];
    const out: string[] = [];
    for (const stmt of body) {
      if (stmt.type !== "ExpressionStatement") continue;
      const e = stmt.expression as SurfaceNode | undefined;
      if (e?.type !== "AssignmentExpression" || e.operator !== "=") continue;
      const left = e.left as SurfaceNode | undefined;
      if (left?.type !== "MemberExpression" || left.computed === true) continue;
      const obj = left.object as SurfaceNode | undefined;
      if (obj?.type !== "Identifier" || obj.name !== local) continue;
      const name = surfaceName(left.property as SurfaceNode | undefined);
      if (!name || !isJsBindingIdent(name)) continue;
      const init = e.right as SurfaceNode | undefined;
      if (init?.type === "FunctionExpression" || init?.type === "ArrowFunctionExpression") {
        const rawParams = (init.params as SurfaceNode[] | undefined) ?? [];
        const params = surfaceParamNames(rawParams)
          .map((p, i) =>
            paramDeclOf(
              p,
              i,
              safeFieldTypeAnnotation(nodeAnnotationText(rawParams[i], source), isResolvableValueType),
            ),
          )
          .join(", ");
        // 成员函数的返回注解同样保真（`f.helper = function (x: number): number`）
        const ret =
          safeFieldTypeAnnotation(nodeAnnotationText(init, source), isResolvableValueType) ??
          "unknown";
        out.push(`function ${name}(${params}): ${ret};`);
      } else {
        out.push(`const ${name}: ${valueTypeTextOfInit(init, source)};`);
      }
    }
    return out;
  };
  if (
    exportEqualsCandidate !== undefined &&
    surface.exportBindings.size === 1 &&
    !hasExportedTypeDecl
  ) {
    const members = exportEqualsMembersOf(exportEqualsCandidate);
    surface.exportEquals = {
      local: exportEqualsCandidate,
      ...(members.length > 0 ? { members } : {}),
    };
  }

  // ── Bug 57：函数 / 方法级类型形参子句（普查名 → `<T>` 原文）──
  const noteTypeParams = (key: string, fnNode: SurfaceNode | undefined): void => {
    const text = typeParamClauseText(fnNode?.typeParameters as SurfaceNode | undefined, source);
    if (text) surface.typeParamClauses!.set(key, text);
  };
  // BUG-193：形参默认值的类型证据（普查名 → 逐位类型文本）
  const noteParamDefaults = (key: string, fnNode: SurfaceNode | undefined): void => {
    const defaults = defaultParamTypeTexts(
      fnNode?.params as SurfaceNode[] | undefined,
      source,
    );
    if (defaults !== undefined) surface.paramDefaults!.set(key, defaults);
  };
  for (const stmt of body) {
    const inner = stmt.declaration as SurfaceNode | null | undefined;
    const d = inner ?? stmt;
    if (d.type === "FunctionDeclaration" || d.type === "TSDeclareFunction") {
      const name =
        surfaceName(d.id as SurfaceNode | undefined) ??
        (stmt.type === "ExportDefaultDeclaration" ? "default" : undefined);
      if (name) {
        noteTypeParams(name, d);
        noteParamDefaults(name, d);
      }
    } else if (d.type === "ArrowFunctionExpression" || d.type === "FunctionExpression") {
      // 匿名 `export default <T,>(…) => …` 的普查名是 "default"
      noteTypeParams("default", d);
      noteParamDefaults("default", d);
    } else if (d.type === "VariableDeclaration") {
      for (const dd of (d.declarations as SurfaceNode[] | undefined) ?? []) {
        const name = surfaceName(dd.id as SurfaceNode | undefined);
        const init = dd.init as SurfaceNode | undefined;
        if (
          name &&
          init &&
          (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")
        ) {
          noteTypeParams(name, init);
          noteParamDefaults(name, init);
        }
      }
    } else if (d.type === "ClassDeclaration") {
      const clsName = surfaceName(d.id as SurfaceNode | undefined);
      if (!clsName) continue;
      for (const raw of (d.body as { body?: SurfaceNode[] } | undefined)?.body ?? []) {
        const m = raw as SurfaceNode;
        const key = surfaceName(m.key as SurfaceNode | undefined);
        if (!key) continue;
        const fnNode = surfaceMemberFn(m);
        if (
          m.type === "ClassMethod" ||
          m.type === "MethodDefinition" ||
          m.type === "TSDeclareMethod" ||
          m.type === "ClassProperty"
        ) {
          noteTypeParams(`${clsName}.${key}`, fnNode);
          noteParamDefaults(`${clsName}.${key}`, fnNode);
        }
      }
    }
  }

  // ── BUG-190：同模块 `enum` 的类型名也是产物里的**可解析类型** ──
  // `dtsValueDeclarations` 会为导出 enum 发 `declare enum Color { … }`，但
  // 「注解里的名字在产物里是否可解析」的判据只登记 interface / type 别名
  // ⇒ `paint(c: Color)` 被误判成「type not declared in this module」整条丢弃
  // （形参 / 字段回落 unknown，返回位靠声明注解回落）。两张清单同源：
  // 只有**会被发射**的导出 enum 才算可解析（未导出 enum 在产物里没有声明，
  // 放行会 TS2304）。必须在类面扫描之前登记（类字段注解用同一判据）。
  for (const [local, value] of surface.values) {
    if (value.kind !== "enum") continue;
    if (dtsExportNamesOf(surface, local).length === 0) continue;
    surface.typeNames!.add(local);
  }

  // ── 类面（导出名 + 成员） ──
  // 可解析判据：本地类 / 已 import 的名字 / TS 全局构造器名（与 `brandTSType`
  // 同一口径）——只在这种名字上放行 `extends`。
  // Bug 49：namespace 限定名 `NS.Base` 的根名是命名空间导入 ⇒ 也算可解析
  // （`projectModuleDtsInner` 会补 `import * as NS`）。
  const isResolvableName = (name: string, valuePosition?: boolean): boolean => {
    if (name.includes(".")) {
      const root = name.split(".")[0]!;
      return surface.namespaceImports!.has(root) || imports.has(root);
    }
    // BUG-005：本地 interface / type 别名同样可解析（会被原文镜像进产物）。
    // TS 内建 token（`number` / `string` / 联合里的 `null` …）必须先放行——
    // 这个判据同时服务**字段注解**，漏掉它任何 `x: number` 都会被丢。
    return (
      TS_TYPE_TOKENS.has(name) ||
      classDecls.has(name) ||
      imports.has(name) ||
      isRuntimeGlobalCtorName(name) ||
      surface.typeNames?.has(name) === true ||
      (valuePosition === true && surface.valueNames!.has(name))
    );
  };
  for (const [local, decl] of classDecls) {
    const scanned = scanClassSurface(decl, isResolvableName, source);
    // BUG-193：类方法的默认值证据挂到模块面（分析面签名 `C.m` 的形参位兜底）
    for (const m of [...scanned.instanceMethods, ...scanned.staticMethods]) {
      if (m.paramDefaults !== undefined) {
        surface.paramDefaults!.set(`${local}.${m.name}`, m.paramDefaults);
      }
    }
    // BUG-189：一个本地绑定可同时是具名导出与 default 导出 ⇒ 全部记下，
    // 主形态取第一个（具名优先），其余在声明后逐条补 `export { … as … }`。
    const exportNames = dtsExportNamesOf(surface, local);
    const exportName = exportNames[0];
    surface.classes.set(local, {
      ...scanned,
      ...(exportName !== undefined ? { exportName } : {}),
      ...(exportNames.length > 0 ? { exportNames } : {}),
      isDefault: exportName === "default",
      ...(classExpressions.has(local) ? { isExpression: true } : {}),
    });
  }
  return surface;
}

/**
 * 本地绑定名 → **全部**导出名（模块面）：未导出 ⇒ `[]`。
 *
 * BUG-189：同一个绑定可以同时是具名导出与 default 导出
 * （`export function foo(){}` + `export { foo as default }`，或 `export default foo;`）。
 * 旧实现拿到第一个命中就 `return`（且优先具名）⇒ default 别名被丢弃 ⇒ 发布的
 * `.d.ts` 里 default 导出**整个消失**（消费端 default import 报 TS2349 / TS2351，
 * 而运行时 default 与具名导出同时存在）。
 *
 * 具名导出（本地名即导出名）排在最前 = 主声明形态；其余名字按源码序补发。
 */
function dtsExportNamesOf(surface: DtsModuleSurface, localName: string): string[] {
  // 匿名 default（普查名 "default"）
  if (localName === "default") return ["default"];
  const names: string[] = [];
  for (const [exportName, local] of surface.exportBindings) {
    if (local !== localName) continue;
    if (!names.includes(exportName)) names.push(exportName);
  }
  const self = names.indexOf(localName);
  if (self > 0) {
    names.splice(self, 1);
    names.unshift(localName);
  }
  return names;
}

/** 主声明之外的附加导出名（补一条 `export { <declared> as <name> };`） */
type DtsExportExtra = { exportNameRepr: string };

/** 导出形态 → 声明写法 */
type DtsExportForm =
  | { kind: "none" }
  | { kind: "named"; exportName: string; extras?: DtsExportExtra[] }
  | { kind: "member"; memberName: string }
  | { kind: "default"; localName: string; extras?: DtsExportExtra[] }
  /**
   * BUG-008：CJS `module.exports = <单值>`。运行期 `require()` 拿到的就是那个
   * 值，ESM 的 `export default` / `export declare function` 声明与真实形态不符
   * ⇒ 消费方 `import f from "./x.cjs"` 报 TS2349（没有调用签名）。
   * `localName` = 产物里承载该值的本地名（匿名右值用 `_default`）。
   */
  | { kind: "exportEquals"; localName: string }
  | {
      kind: "alias";
      exportName: string;
      exportNameRepr: string;
      localName: string;
      extras?: DtsExportExtra[];
    };

/** 导出形态解析（模块面优先；无模块面 ⇒ 普查名即导出名） */
function dtsExportForm(
  localName: string,
  surface: DtsModuleSurface | undefined,
): DtsExportForm {
  if (!surface) {
    if (localName === "default") return { kind: "default", localName: "" };
    return { kind: "named", exportName: dtsIdentifier(localName) };
  }
  // BUG-008：`module.exports = <单值>` 的模块形态是 `export =`，不是 ESM 导出。
  // 必须先于 exportBindings 判定——扫描面为了「名字可解析」把该本地名登记成
  // 具名导出，但那只是内部记账，不是模块形态。
  if (surface.exportEquals !== undefined) {
    const target = surface.exportEquals.local;
    const hit = target === "" ? localName === "default" : localName === target;
    if (hit) return { kind: "exportEquals", localName: target === "" ? "_default" : target };
  }
  const names = dtsExportNamesOf(surface, localName);
  const exportName = names[0];
  if (exportName === undefined) return { kind: "none" };
  const extras = names.slice(1).map((n) => ({ exportNameRepr: exportNameRepr(n) }));
  const withExtras = extras.length > 0 ? { extras } : {};
  if (exportName === "default") {
    // 匿名 default（普查名 "default"）⇒ `export default function (…)`
    return {
      kind: "default",
      localName: localName === "default" ? "" : localName,
      ...withExtras,
    };
  }
  if (exportName === localName || !isJsBindingIdent(localName)) {
    // 本地名不是合法绑定名 ⇒ 不能 `declare function <local>` + 别名导出
    return { kind: "named", exportName: dtsIdentifier(exportName), ...withExtras };
  }
  return {
    kind: "alias",
    exportName,
    exportNameRepr: exportNameRepr(exportName),
    localName,
    ...withExtras,
  };
}

/** 导出形态 → 导出名（类成员不是模块级导出 ⇒ undefined） */
function dtsFormExportName(form: DtsExportForm): string | undefined {
  switch (form.kind) {
    case "named":
      return form.exportName;
    case "alias":
      return form.exportName;
    case "default":
      return "default";
    case "exportEquals":
      // `export = X` 对 ESM 消费方等价于 default 导入；台账按导出名记账。
      return form.localName;
    default:
      return undefined;
  }
}

/** 主声明之外的导出名 → `export { <declared> as <name> };` 行 */
function dtsExtraExportLines(
  declared: string | undefined,
  extras: DtsExportExtra[] | undefined,
): string[] {
  if (declared === undefined) return [];
  return (extras ?? []).map((e) => `export { ${declared} as ${e.exportNameRepr} };`);
}

/**
 * BUG-175：源码里的**无体重载声明** → `.d.ts` / stdout 平铺面都能编译的
 * ambient 形态。
 *
 * `.d.ts` 里裸 `export function f(a: string): string;` 本来合法（文件级
 * ambient 上下文），但 stdout 是把同一份文本平铺进**普通 `.ts` 模块**——
 * 非 ambient 的重载签名（无实现）会与实现的 `declare` 混排成 TS2384。
 * 统一补 `declare` 后两处都是 ambient 声明。
 */
function ambientFunctionDeclarationText(text: string): string {
  const t = text.trim();
  if (/^export\s+declare\s+(async\s+)?function\b/.test(t)) return t;
  if (/^declare\s+(async\s+)?function\b/.test(t)) return t;
  if (/^export\s+(async\s+)?function\b/.test(t)) return t.replace(/^export\s+/, "export declare ");
  if (/^(async\s+)?function\b/.test(t)) return `declare ${t}`;
  return t;
}

/**
 * BUG-175：重载集已由镜像声明发射 ⇒ 实现签名只补**导出胶水**。
 *
 * 具名自导出（`export function f(…)`）的镜像行自带 `export`，无需补；
 * `export { f as g }` / default / `export =` 的导出语句原本挂在实现声明上，
 * 抑制实现后必须单独补回，否则导出面消失。
 */
function overloadExportGlue(form: DtsExportForm, declaredExported: boolean): string[] {
  switch (form.kind) {
    case "named":
      // 声明本身带 `export` ⇒ 已是导出面成员；否则补一条导出语句
      return declaredExported || !isJsBindingIdent(form.exportName)
        ? []
        : [`export { ${form.exportName} };`];
    case "alias":
      return [
        `export { ${form.localName} as ${form.exportNameRepr} };`,
        ...dtsExtraExportLines(form.localName, form.extras),
      ];
    case "default":
      return [`export { ${form.localName} as default };`, ...dtsExtraExportLines(form.localName, form.extras)];
    case "exportEquals":
      return [`export = ${form.localName};`];
    default:
      return [];
  }
}

/**
 * 声明行（按导出形态；`signature` = `(<params>): <ret>`，可含类型参数）。
 *
 * `compatSignature`：Bug 57 兼容位——named 形态带源码类型形参时，除
 * `f<T>(…)` 主声明外再补一条同签名的非泛型重载，使「泛型函数旧文本形态」
 * 的既有钉与消费端都成立（TS 允许重载；带显式类型实参的调用命中泛型那条）。
 */
function dtsExportDeclaration(
  form: DtsExportForm,
  signature: string,
  compatSignature?: string,
): string[] {
  switch (form.kind) {
    case "named":
      return [
        `export declare function ${form.exportName}${signature};`,
        ...(compatSignature
          ? [`export declare function ${form.exportName}${compatSignature};`]
          : []),
        ...dtsExtraExportLines(form.exportName, form.extras),
      ];
    case "member":
      return [`${form.memberName}${signature};`];
    case "default":
      if (form.localName) {
        return [
          `export default function ${form.localName}${signature};`,
          ...dtsExtraExportLines(form.localName, form.extras),
        ];
      }
      // 匿名默认函数：`.d.ts` 上下文里 `export default function (…)` 合法。
      // stdout 平铺面（普通 .ts 模块）需要 `ambientizeDtsSegment` 支持匿名
      // 形态——根因在 packages/nudojs/src/commands/export/stdout.ts，超出
      // 本文件改动范围（见最终汇报），此处保持既有发射形态不动。
      return [`export default function ${signature};`];
    case "alias":
      return [
        `declare function ${form.localName}${signature};`,
        `export { ${form.localName} as ${form.exportNameRepr} };`,
        ...dtsExtraExportLines(form.localName, form.extras),
      ];
    case "exportEquals":
      // `export = <local>` 只允许一条，且不得与其他导出语句共存（TS2309）；
      // 声明本身必须**不带 export**（否则变成 ESM 具名导出 + TS2309）。
      return [
        `declare function ${form.localName}${signature};`,
        `export = ${form.localName};`,
      ];
    default:
      return [];
  }
}

/** 模块面 dts 投影结果 */
export interface DtsModuleProjection {
  /** .d.ts 行（模块级声明 + 类声明 + 再导出） */
  lines: string[];
  /** 各导出的参数位（CLI 的 unknown 提示用） */
  params: Array<{ name: string; type: string }>;
}

/**
 * 模块面 dts 投影：逐函数投影 + 模块面 → 一份 .d.ts。
 * - 类成员收进 `declare class C { … }`（模块级不再有 `C_m` 导出）
 * - 再导出面（`export * from` / `export {x} from`）按原样发射
 * - brand 引用（类实例类型）补类声明（否则 TS2304）
 * - brand 引用的类若来自**别的模块**（本模块 import 进来的）⇒ 补
 *   `import type { C } from "…";`（Bug 233：否则产物里那个类名从未声明 ⇒
 *   消费方 tsc TS2304）
 * - 产物里**无法解析**的类名（既没本地声明、也没 import、也不是 TS 全局类型名）
 *   ⇒ 降级为 unknown，并在产物头部留**降级台账**（可诊断）
 */
/**
 * 模块面合成的**分析面补充证据**（函数入口之外的事实：模块级绑定 Abs）。
 *
 * `values`（BUG-190）：`export const/let/var` / `enum` 的类型来源。
 *
 * 注：类实例 brand **不能**从这里取 —— 分析面 `bindings` 里的 `class C` 绑定是
 * **构造器面**的 brand（实例形状只有 `name`），不是实例形状；类体字段改由源码面
 * 采集（`DtsClassSurface.instanceFields`，BUG-151）。
 */
export interface DtsModuleExtras {
  /** 模块级值声明的类型来源（本地名 → Abs；分析面的 `bindings`） */
  values?: ReadonlyMap<string, Abs>;
}

export function projectModuleDts(
  surface: DtsModuleSurface | undefined,
  entries: ReadonlyArray<{
    fn: FunctionAnalysis;
    projection: DtsFunctionProjection;
    contract?: DtsContractFace;
  }>,
  extras?: DtsModuleExtras,
): DtsModuleProjection {
  // Bug 233：类字段声明（brand 实例形状）也要在 brand 解析口径内渲染。
  return withBrandScope(brandScopeOf(surface), () =>
    projectModuleDtsInner(surface, entries, extras),
  );
}

function projectModuleDtsInner(
  surface: DtsModuleSurface | undefined,
  entries: ReadonlyArray<{
    fn: FunctionAnalysis;
    projection: DtsFunctionProjection;
    contract?: DtsContractFace;
  }>,
  extras?: DtsModuleExtras,
): DtsModuleProjection {
  const values = extras?.values;
  const lines: string[] = [];
  const params: Array<{ name: string; type: string }> = [];
  /**
   * BUG-231：`export const cb: Fn = (a, b) => …` 的**声明器注解**。
   *
   * 分析面把箭头 / 函数表达式登记成函数（`scan-top-functions.ts`）⇒ 发射侧
   * 走 `declare function cb(...)`：`const` 形态、声明器上的类型注解、别名里的
   * 可选形参全部丢失（消费方 TS2554 假红 / `unknown` 形参假绿）。tsc
   * `--declaration` 对同一写法发 `export declare const cb: Fn;`。
   *
   * 判据：该本地名既有分析面函数条目，又有**可解析的**声明器注解 ⇒ 抑制
   * 函数声明，改由值声明通道发 `declare const cb: Fn`。注解不可解析 ⇒ 保持
   * 既有函数发射（否则产物里那个名字 TS2304）。
   */
  const annotatedConstLocals = new Set<string>();
  if (surface !== undefined) {
    const entryLocals = new Set(entries.map((e) => e.fn.name));
    for (const [local, value] of surface.values) {
      if (!entryLocals.has(local)) continue;
      if (value.annotation === undefined) continue;
      if (safeValueAnnotation(value.annotation, surface).unresolved !== undefined) continue;
      annotatedConstLocals.add(local);
    }
  }
  /** 类名 → 实例方法声明（分析面） */
  const members = new Map<string, Array<{ member: string; lines: string[] }>>();
  /** brand 类名 → brand Abs（实例形状 → 字段） */
  const brands = new Map<string, Abs>();
  /** 注解原文引用到的 import 名（BUG-168：补 `import type` 用） */
  const annotationRefs = new Set<string>();

  // Bug 22 / 75：顶层 `export interface` / `export type` 与私有类型别名原文
  // 镜像进产物（namespace 成员引用私有类型时产物自身才不报 TS2304）。
  for (const t of surface?.typeDeclarations ?? []) {
    for (const l of t.split("\n")) lines.push(l);
  }
  // BUG-217：类型声明的导出别名（`export { I as IA };` / `export type {…};`）
  for (const l of surface?.typeExportAliases ?? []) lines.push(l);

  for (const { fn, projection, contract } of entries) {
    // BUG-231：声明器带可解析类型注解的 `const f = <箭头/函数表达式>` 由值声明
    // 通道发 `declare const f: T`（tsc 同形）⇒ 不再发函数声明。
    if (annotatedConstLocals.has(fn.name)) continue;
    // BUG-358：同名**值绑定**（`export const handle = 1`）是权威声明；对象
    // 成员键被误登记成的函数入口不得发射（否则常量声明整条消失）。
    if (surface?.values.get(fn.name)?.nonFunctionValue === true) continue;
    if (projection.classMember) {
      const list = members.get(projection.classMember.className) ?? [];
      list.push({
        member: projection.classMember.member,
        lines: projection.classMember.lines,
      });
      members.set(projection.classMember.className, list);
    } else {
      lines.push(...projection.lines);
    }
    params.push(...projection.params);
    for (const n of projection.typeRefs ?? []) annotationRefs.add(n);
    collectBrandAbs(fn, contract, brands);
  }

  // ── 类声明（一次一类；brand 引用的类也要声明，否则 TS2304） ──
  // BUG-130：值声明注解引用的类型名同样要进「产物里可解析」的面（本地类补
  // `declare class`、导入名补 `import type`）——必须在类名收敛**之前**登记，
  // 否则值声明里的 `opts: Opts` 会在产物里成为未声明的名字（TS2304）。
  for (const v of surface?.values.values() ?? []) {
    if (v.annotation === undefined) continue;
    for (const name of annotationTypeRefs(v.annotation)) {
      if (!isTypeNameResolvable(name, surface)) continue;
      if (surface?.classes.has(name) || surface?.imports?.has(name) === true) {
        annotationRefs.add(name);
      }
    }
  }
  const classNames = new Set<string>(members.keys());
  if (surface) {
    for (const [local, cls] of surface.classes) {
      if (cls.exportName !== undefined) classNames.add(local);
    }
    for (const name of brands.keys()) {
      if (surface.classes.has(name)) classNames.add(name);
    }
    // BUG-054：`export const svc = new Svc()`（Svc 未导出）——值声明的 brand
    // 也要求在产物里可解析（否则 `svc: Svc` + 无声明 ⇒ 消费方 TS2304）。
    if (values) {
      for (const a of values.values()) {
        for (const name of brandNamesInAbs(a)) {
          if (surface.classes.has(name)) classNames.add(name);
        }
      }
    }
    // BUG-168：注解原文引用的**本地类**同样要声明（否则产物里那个名字是
    // TS2304）；这类类不是导出面成员 ⇒ 只发 `declare class`（不导出）。
    for (const name of annotationRefs) {
      if (surface.classes.has(name)) classNames.add(name);
    }
    // BUG-151：作为**超类**被引用的类同样要在产物里可解析（`extends Base`
    // 里的 Base 不声明就是 TS2304）——本地类补 `declare class`，导入类补
    // `import type`。传递闭包：基类的基类也要落地。
    const superQueue = [...classNames];
    while (superQueue.length > 0) {
      const name = superQueue.pop()!;
      const base = surface.classes.get(name)?.superClass;
      if (base === undefined) continue;
      if (surface.imports?.has(base) === true) annotationRefs.add(base);
      if (!surface.classes.has(base) || classNames.has(base)) continue;
      classNames.add(base);
      superQueue.push(base);
    }
  }
  // BUG-151：类体字段取**源码面**（构造器里的 `this.x = …` 与类属性初始化器）
  // —— 分析面 `bindings` 的 `class C` 绑定是构造器面 brand（实例形状只有
  // `name`），不是实例形状。
  /** 类名 → 该类的实例字段（brand 字段 ∪ 构造器赋值，去重） */
  const classFields = new Map<string, DtsClassFieldSurface[]>();
  const resolving = new Set<string>();
  const fieldsOf = (className: string): DtsClassFieldSurface[] => {
    const cached = classFields.get(className);
    if (cached) return cached;
    if (resolving.has(className)) return []; // 自引用（非法继承）⇒ 停止
    resolving.add(className);
    const memberNames = new Set((members.get(className) ?? []).map((m) => m.member));
    const out: DtsClassFieldSurface[] = [];
    const seen = new Set<string>();
    // 源码字段优先（BUG-007）：构造器里的 `this.x = <expr>` 与字段注解是**声明
    // 面**的事实；brand 是**某个构造点**的观测快照——`static make(){ return new
    // C() }` 这种零实参内部构造会把 `x` 钉成 `undefined`，与构造器签名自相矛盾。
    // 因而 brand 只作兜底（补源码里看不到的槽，如方法内赋值）。
    const cls = surface?.classes.get(className);
    for (const f of cls?.instanceFields ?? []) {
      if (seen.has(f.name)) continue;
      if (memberNames.has(f.name)) continue; // 与实例方法同名 ⇒ 方法是权威
      seen.add(f.name);
      out.push(f);
    }
    // brand 兜底（分析面观测到的、源码声明面没有的槽）
    for (const f of brandFieldLines(brands.get(className), memberNames)) {
      if (seen.has(f.name)) continue;
      seen.add(f.name);
      out.push(f);
    }
    // 继承来的字段不再重复声明（TS2416：子类属性类型必须与基类兼容）
    const superName = cls?.superClass;
    const inherited = new Set<string>();
    if (superName) {
      for (const f of fieldsOf(superName)) inherited.add(f.name);
    }
    resolving.delete(className);
    const filtered = out.filter((f) => !inherited.has(f.name));
    classFields.set(className, filtered);
    return filtered;
  };
  for (const className of classNames) {
    const cls = surface?.classes.get(className);
    const clsMembers = members.get(className) ?? [];
    const clsFields = fieldsOf(className);
    const superText = superClauseText(className, surface);
    const inheritedStatics = inheritedStaticNamesOf(className, surface);
    const inheritedViews = inheritedMemberViews(className, surface, members);
    // BUG-360：`export const C = class { … }` 是**值**（构造器对象），不是类型
    // 名。发内部类 + `declare const C: typeof <内部类>`：`Array<C>` / `implements
    // C` 与 tsc 一样报 TS2749，而 `new C(...)` / `C.static` 仍可用。
    const exportNames = cls?.exportNames ?? (cls?.exportName !== undefined ? [cls.exportName] : []);
    if (cls?.isExpression === true && exportNames.length > 0) {
      const internal = `__nudo_expr_${dtsIdentifier(className)}`;
      lines.push(
        ...dtsClassDeclaration(
          internal,
          { ...cls, exportName: undefined, exportNames: [], isDefault: false },
          clsMembers,
          clsFields,
          superText,
          inheritedStatics,
          inheritedViews,
        ),
      );
      const primary = exportNames[0]!;
      const declared = dtsIdentifier(className);
      const extras = exportNames
        .slice(1)
        .map((n) => `export { ${declared} as ${exportNameRepr(n)} };`);
      if (primary === "default") {
        lines.push(`declare const ${declared}: typeof ${internal};`, "export default " + declared + ";", ...extras);
      } else if (primary === className) {
        lines.push(`export declare const ${declared}: typeof ${internal};`, ...extras);
      } else {
        lines.push(
          `declare const ${declared}: typeof ${internal};`,
          `export { ${declared} as ${exportNameRepr(primary)} };`,
          ...extras,
        );
      }
      continue;
    }
    lines.push(
      ...dtsClassDeclaration(
        className,
        cls,
        clsMembers,
        clsFields,
        // BUG-151：`extends <base>`——基类泛型时补 `any` 实参（TS2314：泛型基类
        // 缺类型实参会让整份产物编译不过）。
        superText,
        // BUG-070：继承来的 static 不得在子类里投影成实例方法
        inheritedStatics,
        // BUG-194 / BUG-228：继承来的实例方法（类型实参已代入 + 修饰符保真）
        inheritedViews,
      ),
    );
  }

  // ── BUG-008：`module.exports = C`（类）→ `declare class C` + `export = C` ──
  // 函数形态走 `DtsExportForm.exportEquals`；类走类声明通道（一次一类），
  // 所以在这里把该类的导出前缀摘掉并补 `export =`。`export =` 不得与其它
  // 导出共存（TS2309）——surface.exportEquals 只在单值导出时设置。
  if (surface?.exportEquals !== undefined && surface.exportEquals.local !== "") {
    const target = surface.exportEquals.local;
    const prefix = `export declare class ${dtsIdentifier(target)}`;
    let converted = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.startsWith(prefix)) {
        lines[i] = line.slice("export ".length);
        converted = true;
      }
    }
    if (converted) lines.push(`export = ${dtsIdentifier(target)};`);
    // BUG-110：函数对象上的附加成员走声明合并（`declare namespace f { … }`）。
    // 放在 `export =` 之前 / 之后都合法；这里统一在其它声明之后追加。
    const members = surface.exportEquals.members ?? [];
    if (members.length > 0) {
      lines.push(
        `declare namespace ${dtsIdentifier(target)} {`,
        ...members.map((m) => `  ${m}`),
        "}",
      );
    }
  }

  // ── 模块级值声明（BUG-190）──
  // 已作为函数 / 类声明发射的本地绑定不再发值声明（`export const f = () => …`
  // 被分析成函数；再发一条 `declare const f` 就是 TS2300 Duplicate identifier）。
  const declaredLocals = new Set<string>(entries.map((e) => e.fn.name));
  // BUG-381：对象成员函数在值通道只有形参名；成员自己的分析返回 Abs 在
  // entries 里（`fn f => number`）——传给注解叠加层，未写返回注解也能发布。
  const analyzedMemberReturns = new Map<string, Abs>();
  for (const e of entries) {
    if (e.fn.combinedAbs) analyzedMemberReturns.set(e.fn.name, e.fn.combinedAbs);
  }
  lines.push(
    ...dtsValueDeclarations(
      surface,
      values,
      declaredLocals,
      annotationRefs,
      annotatedConstLocals,
      analyzedMemberReturns,
    ),
  );

  // BUG-384：`export =` / `module.exports = <值>` 的值目标（对象 / 原始值）
  // 也必须走 `export =` 模块形态；上面只转换了类目标。
  if (
    surface?.exportEquals !== undefined &&
    surface.exportEquals.local !== "" &&
    !lines.some((l) => l.startsWith("export = "))
  ) {
    const target = surface.exportEquals.local;
    const prefix = `export declare const ${dtsIdentifier(target)}:`;
    let converted = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.startsWith(prefix)) {
        lines[i] = line.slice("export ".length);
        converted = true;
      }
    }
    if (converted) lines.push(`export = ${dtsIdentifier(target)};`);
  }

  // ── namespace 声明（BUG-191）──
  // `export namespace NS { export const x: number = 1 }` 在运行时是真实对象
  // （求值器把 NS.x 物化出来），但旧实现只发射函数/类/值声明 ⇒ 产物里没有 NS
  // ⇒ 消费端 `import { NS }` 报 TS2305。这里按源码成员形态镜像
  // （`export declare namespace NS { export const x: number; }`）。
  if (surface?.namespaces) {
    for (const [local, ns] of surface.namespaces) {
      const names = dtsExportNamesOf(surface, local);
      const exportName = names[0];
      const declaredName = dtsIdentifier(exportName === undefined ? local : exportName);
      lines.push(
        `${exportName === undefined ? "declare" : "export declare"} namespace ${declaredName} {`,
        ...ns.members.map((m) => `  ${m}`),
        "}",
      );
      // 同一绑定另有导出名（`export { NS as Other }`）⇒ 补别名导出语句
      for (const extra of names.slice(1)) {
        lines.push(`export { ${declaredName} as ${exportNameRepr(extra)} };`);
      }
    }
  }

  // ── BUG-012：再导出 **导入绑定**（`import D from "…"; export default D;`
  // / `export { D as E }`）──
  // 这类导出没有本地声明可挂：声明面按「本地名」找导出名，而本地名是导入来的
  // ⇒ 产物里 default / E 整条消失（消费方 TS2305 / TS2351），但文件头部的
  // 导出名表又声称它有 ⇒ 产物自相矛盾。
  // 修法是把它写成**再导出语句**（值语义），按导入原名做一次映射。
  if (surface) {
    const declaredLocally = new Set<string>([
      ...declaredLocals,
      ...classNames,
      ...surface.values.keys(),
      ...(surface.namespaces?.keys() ?? []),
    ]);
    for (const [exportName, local] of surface.exportBindings) {
      if (!local || declaredLocally.has(local)) continue;
      const imp = surface.imports?.get(local);
      if (!imp) continue;
      const fromName = imp.kind === "default" ? "default" : (imp.importedName ?? local);
      // BUG-309：本地 `export type { innerFn as localFn }` 仍是仅类型导出。
      const typeKw =
        surface.typeOnlyExportBindings?.get(exportName) === local ? "type " : "";
      lines.push(
        `export ${typeKw}{ ${exportNameRepr(fromName)} as ${exportNameRepr(exportName)} } from ${JSON.stringify(
          imp.specifier,
        )};`,
      );
    }
  }

  // ── Bug 233：brand 引用的类来自 import ⇒ 补 import type（否则 TS2304）──
  const importLines: string[] = [];
  // BUG-006：**镜像类型声明**（`interface` / `type` 原文）里引用的导入名同样
  // 要补 `import type`，否则产物里那句声明自己就是 TS2304（`export` 与
  // `check` 双绿、消费方编译不过）。此前只统计签名 / 注解里的引用。
  const typeDeclRefs = new Set<string>();
  for (const t of surface?.typeDeclarations ?? []) {
    for (const n of annotationTypeRefs(t)) typeDeclRefs.add(n);
  }
  // BUG-121：**类字段 / 访问器**的注解是第三条引用通道——`DtsClassFieldSurface.type`
  // 保存注解**原文**、访问器直接取 `nodeAnnotationText`，两者都原样进产物，
  // 但此前只有函数/方法投影的 `typeRefs`、镜像类型声明、超类名会进
  // `annotationRefs` ⇒ 「类字段保存注入依赖」（`opts: Opts`）这种常见写法
  // 产出的 `.d.ts` 里 `Opts` **没有对应的 `import type`** ⇒ 消费方 TS2304，
  // 而同一份文件只要类里多一个 `normalize(o: Opts)` 方法就能编译。
  //
  // 这些成员此时已经写进 `lines`（类体在 import 块之前装配）⇒ 按**产物文本**
  // 里的标识符补登记（与注解原文同源，不另开扫描通道；本地类在上面已排除，
  // 多补一条未使用的 `import type` 在 `.d.ts` 里无害，漏补则是硬错）。
  if (surface?.imports) {
    const emittedIdents = new Set(lines.join("\n").match(/[A-Za-z_$][\w$]*/g) ?? []);
    for (const name of surface.imports.keys()) {
      if (annotationRefs.has(name)) continue;
      if (emittedIdents.has(name)) annotationRefs.add(name);
    }
  }

  if (surface?.imports) {
    for (const [name, imp] of surface.imports) {
      // 只为**被引用**的名字补 import：brand 类名（Bug 233）/ 注解原文引用的
      // 类型名（BUG-168）/ 镜像类型声明里的引用（BUG-006）。
      if (!brands.has(name) && !annotationRefs.has(name) && !typeDeclRefs.has(name)) continue;
      if (surface.classes.has(name)) continue; // 本地已声明 ⇒ 走 declare class
      const src = JSON.stringify(imp.specifier);
      if (imp.kind === "equals") {
        importLines.push(`import ${name} = require(${src});`);
        continue;
      }
      if (imp.kind === "default") {
        importLines.push(`import type ${name} from ${src};`);
        continue;
      }
      // BUG-243：`import type { User as U }` 的产物必须写 `User as U`——旧实现
      // 只写本地名 `U`，而目标模块没有导出 `U` ⇒ 整份 `.d.ts` TS2305。
      const imported = imp.importedName;
      const spec =
        imported !== undefined && imported !== name ? `${imported} as ${name}` : name;
      importLines.push(`import type { ${spec} } from ${src};`);
    }
  }
  // Bug 49：namespace 限定超类（`extends NS.Base`）⇒ 补
  // `import * as NS from "…"`，否则产物里 `NS` 从未声明（`extends` 整条被丢）。
  if (surface?.namespaceImports) {
    for (const [name, specifier] of surface.namespaceImports) {
      const used =
        [...classNames].some(
          (c) => surface.classes.get(c)?.superClass?.startsWith(`${name}.`) === true,
        ) ||
        // BUG-390：`import * as ns` 的再导出（`export { ns }`）也要补导入行。
        [...surface.exportBindings.values()].some((local) => local === name);
      if (used) {
        importLines.push(`import * as ${name} from ${JSON.stringify(specifier)};`);
      }
    }
  }

  // ── Bug 233：不可解析的类名（降级为 unknown）——台账（可诊断） ──
  // 判据与 `brandTSType` 同款（内建泛型 / 模块面可解析 / TS 全局类型名 ⇒ 不降级）。
  const scope = brandScopeOf(surface);
  const unresolved = [...brands.keys()].filter(
    (name) =>
      BRAND_TYPE_ALIASES.get(name) === undefined &&
      !BUILTIN_GENERIC_BRANDS.has(name) &&
      !scope.names.has(name) &&
      !TS_TYPE_TOKENS.has(name) &&
      !isRuntimeGlobalCtorName(name),
  );
  const ledger =
    unresolved.length > 0
      ? [
          `// nudo:unresolved-class ${unresolved.join(", ")} — brand type not declared in this module (projected as unknown)`,
        ]
      : [];

  // ── 再导出面 ──
  if (surface) for (const r of surface.reexports) lines.push(r);

  return { lines: [...importLines, ...ledger, ...lines], params };
}

/**
 * 静态字段修饰符前缀（BUG-041）：`static` 必须排在 `readonly` 之前
 * （TS1029 "'static' modifier must precede 'readonly' modifier"）。旧实现先拼
 * `fieldPrefix`（readonly/accessibility）再拼 `static` ⇒ `readonly static`。
 */
function staticFieldPrefix(f: DtsClassFieldSurface): string {
  const parts = [
    f.accessibility ?? "",
    "static",
    f.readonly ? "readonly" : "",
    f.isAbstract ? "abstract" : "",
  ].filter(Boolean);
  return `${parts.join(" ")} `;
}

/** 字段修饰符前缀（Bug 77 readonly / Bug 86 accessibility / Bug 42 abstract）。 */
function fieldPrefix(f: DtsClassFieldSurface): string {
  const parts = [
    f.accessibility ?? "",
    f.isAbstract ? "abstract" : "",
    f.readonly ? "readonly" : "",
  ].filter(Boolean);
  return parts.length > 0 ? `${parts.join(" ")} ` : "";
}

/**
 * 给分析面方法声明行加访问修饰符（Bug 86）：声明行是 `lines` 的最后一行，
 * JSDoc / 降级台账都在它前面，只给声明行加前缀，注释保持原样。
 */
function withMethodModifier(lines: string[], prefix: string): string[] {
  if (!prefix || lines.length === 0) return lines;
  const out = [...lines];
  const last = out.length - 1;
  out[last] = `${prefix} ${out[last]}`;
  return out;
}

/** 形参声明 → 基名（`...rest` / `y?` / `y: unknown` ⇒ `rest` / `y` / `y`） */
function paramBaseName(decl: string): string {
  let t = decl.trim();
  if (t.startsWith("...")) t = t.slice(3);
  const colon = t.indexOf(":");
  if (colon >= 0) t = t.slice(0, colon);
  t = t.trim();
  return t.endsWith("?") ? t.slice(0, -1) : t;
}

/**
 * 分析面签名行 → 形参基名表（`m(x: unknown, y?: T): R;` ⇒ `["x", "y"]`）。
 * 括号按深度配对（形参类型里可能有函数类型）；解析失败 ⇒ undefined。
 */
function analysisLineParamNames(line: string): string[] | undefined {
  const open = line.indexOf("(");
  if (open < 0) return undefined;
  let depth = 0;
  let close = -1;
  for (let i = open; i < line.length; i++) {
    const ch = line[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return undefined;
  const inner = line.slice(open + 1, close).trim();
  if (inner === "") return [];
  return splitTopLevel(inner, ",").map(paramBaseName);
}

/**
 * 类成员键的声明文本：符号键还原成 `[Symbol.iterator]` 括号形态（BUG-216），
 * 其余与对象键同口径（ident / 数字 / JSON 引号）。
 */
function memberKeyText(name: string, symbolKey?: boolean): string {
  if (symbolKey === true) {
    const sym = WELL_KNOWN_SYMBOLS.get(name);
    if (sym !== undefined) return `[${sym}]`;
  }
  return formatPropKey(name);
}

/**
 * 类方法声明行（BUG-175 / BUG-215 / BUG-216）：有 `overloads` ⇒ 只发声明集
 * （不发实现），否则发单条签名；`?` / 符号键 / 类型形参子句逐条保留。
 */
function classMethodDeclLines(
  m: DtsClassMethodSurface,
  opts: { static?: boolean; prefix?: string } = {},
): string[] {
  const st = opts.static === true ? "static " : "";
  const prefix = opts.prefix ?? "";
  const key = `${memberKeyText(m.name, m.symbolKey)}${m.optional ? "?" : ""}`;
  const signatures = m.overloads !== undefined && m.overloads.length > 0 ? m.overloads : [m];
  return signatures.map((sig) => {
    const params = sig.params
      .map((p, i) => paramDeclOf(p, i, sig.paramTypes?.[i]))
      .join(", ");
    return `${prefix}${st}${key}${sig.typeParams ?? ""}(${params}): ${sig.returnType ?? "unknown"};`;
  });
}

/** 类声明行（导出形态 + 类型形参 + 超类 + 构造器 + 方法 + 字段 + 修饰符） */
function dtsClassDeclaration(
  className: string,
  cls: DtsClassSurface | undefined,
  memberList: Array<{ member: string; lines: string[] }>,
  fields: DtsClassFieldSurface[],
  superText = "",
  /**
   * 沿 `extends` 链**继承来的**静态成员名（BUG-070）。
   *
   * 分析面把基类的 `static` 方法也登记到导出子类名下（Bug 64：未导出基类的
   * 方法也是子类公共面的一部分），但登记名 `` `${sub}.${m.name}` `` **不带
   * static 标记** ⇒ 下面的「Bug 13」守卫只查**该类自己**源码面的
   * `staticMethods` ⇒ 继承来的 static 落进实例方法循环，产物对子类凭空声明
   * 一个**实例**方法（`export class Sub extends Base {}` ⇒ `v(): number;`），
   * 消费方 `new Sub().v()` 类型检查通过、运行期 `TypeError`。
   */
  inheritedStatics: ReadonlySet<string> = new Set(),
  /**
   * BUG-194 / BUG-228：**继承来的实例方法**（只是分析面按子类名登记的基类
   * own 方法）。值 = 已按超类类型实参代入的声明行 + 基类源码面的访问修饰符。
   *
   * 继承链由 `extends` 子句带进子类类型面；重声明必须（a）代入类型实参，
   * 否则 `Box<number>.get(): T` 落到子类变成 `unknown` ⇒ 产物自身 TS2416；
   * （b）保留 `protected`；`private` 则**不得**重发（TS 要求同一个私有声明，
   * 重发即 TS2415）。
   */
  inherited: ReadonlyMap<string, { lines?: string[]; accessibility?: "private" | "protected" | "public" }> = new Map(),
): string[] {
  const body: string[] = [];
  const methodNames = new Set<string>();
  // Bug 87：`#private;` 名义标记——含 `#` 私有字段的类之间不可结构互赋。
  if (cls?.hasPrivateIdentifier) body.push("#private;");
  // Bug 88：index signature 是公开索引面。
  for (const idx of cls?.indexSignatures ?? []) body.push(idx);
  // 构造器（源码面：形参名已知；Bug 48 起带源码注解的类型也保真）
  //
  // BUG-234：重载构造器只发声明集（与 tsc 同口径），实现签名不发。
  if (cls?.ctorOverloads !== undefined && cls.ctorOverloads.length > 0) {
    for (const sig of cls.ctorOverloads) {
      const params = sig.params
        .map((p, i) => paramDeclOf(p, i, sig.paramTypes?.[i]))
        .join(", ");
      const ctorAcc = sig.accessibility ?? cls.ctorAccessibility;
      const ctorPrefix = ctorAcc !== undefined ? `${ctorAcc} ` : "";
      body.push(`${ctorPrefix}constructor(${params});`);
    }
  } else if (cls?.ctorParams) {
    const params = cls.ctorParams
      .map((p, i) => paramDeclOf(p, i, cls.ctorParamTypes?.[i]))
      .join(", ");
    // BUG-042：构造器可见性（`private constructor` ⇒ 消费方不可 `new`）
    const ctorPrefix = cls.ctorAccessibility ? `${cls.ctorAccessibility} ` : "";
    body.push(`${ctorPrefix}constructor(${params});`);
  }
  const instanceSurface = cls?.instanceMethods ?? [];
  const staticSurface = cls?.staticMethods ?? [];
  // Bug 13：「仅 static」的方法在普查面被登记成同名实例方法 ⇒ 那条是幻影，
  // 只发源码面的 static 版本；同名 static + instance 同时存在时不跳过。
  //
  // BUG-070：**继承来的** static 同样算「仅 static」——`Sub extends Base {}`
  // 的 `Sub.v` 来自基类的 `static v`，子类不得把它投影成实例方法（基类那条
  // static 由 `extends Base` 继承下来，消费方照样能 `Sub.v()`）。
  const staticOnly = new Set(
    [...staticSurface.map((sm) => sm.name), ...inheritedStatics].filter(
      (name) => !instanceSurface.some((im) => im.name === name),
    ),
  );
  // Bug 86：源码面方法的访问修饰符查表。
  const accessibility = new Map<string, string>();
  for (const m of [...instanceSurface, ...staticSurface]) {
    if (m.accessibility) accessibility.set(m.name, m.accessibility);
  }
  // 实例方法（分析面）
  // BUG-156：分析面的返回类型取求值面 `combinedAbs`（构造器实参被播种成
  // `any`）⇒ `this.<带注解字段> + 1` 折成 `number | string`。源码面已按注解
  // 证据静态定型（`annotationReturnType`），这里**只收窄**观测串，并同步
  // JSDoc 的 `@returns`（否则注释与声明自相矛盾）。
  const refineAnnotationReturn = (member: string, lines: string[]): string[] => {
    const evidence = instanceSurface.find((x) => x.name === member)?.annotationReturnType;
    if (evidence === undefined || lines.length === 0) return lines;
    const last = lines[lines.length - 1]!;
    const sig = /^(.*\)\s*:\s*)(.+?)(;\s*)$/.exec(last);
    if (!sig) return lines;
    const observed = sig[2]!.trim();
    const refined = refineObservedReturn(observed, evidence);
    if (refined === observed) return lines;
    const out = [...lines.slice(0, -1), `${sig[1]}${refined}${sig[3]}`];
    return out.map((l) =>
      l.includes(`@returns ${observed}`)
        ? l.replace(`@returns ${observed}`, `@returns ${refined}`)
        : l,
    );
  };
  for (const m of memberList) {
    if (staticOnly.has(m.member)) continue;
    methodNames.add(m.member);
    // BUG-175：源码面重载集 ⇒ 只发声明集（分析面的实现签名是 `any` catch-all）
    const own = instanceSurface.find((x) => x.name === m.member);
    if (own?.overloads !== undefined && own.overloads.length > 0) {
      const prefix = [own.accessibility ?? "", own.isAbstract ? "abstract" : ""]
        .filter(Boolean)
        .join(" ");
      body.push(
        ...classMethodDeclLines(own, { prefix: prefix.length > 0 ? `${prefix} ` : "" }),
      );
      continue;
    }
    // BUG-194 / BUG-228：继承来的方法用代入后的声明行 + 基类修饰符
    const inh = inherited.get(m.member);
    if (inh !== undefined && inh.lines === undefined) continue; // private 继承成员不重发
    const lines = inh?.lines ?? refineAnnotationReturn(m.member, m.lines);
    const modifier =
      inh !== undefined ? (inh.accessibility ?? "") : (accessibility.get(m.member) ?? "");
    for (const l of withMethodModifier(lines, modifier)) {
      body.push(...l.split("\n"));
    }
  }
  // Bug 42：abstract 方法 / 无函数体的声明方法在分析面没有条目 ⇒ 从源码面补发。
  for (const m of instanceSurface) {
    if (methodNames.has(m.name)) continue;
    methodNames.add(m.name);
    const parts = [m.accessibility ?? "", m.isAbstract ? "abstract" : ""].filter(Boolean);
    const prefix = parts.length > 0 ? `${parts.join(" ")} ` : "";
    body.push(...classMethodDeclLines(m, { prefix }));
  }
  // 静态方法（源码面）
  // BUG-095：JS 源码没有返回注解 ⇒ 从分析面同名成员的签名行取返回类型
  // （实例方法一直走分析面，static 只读注解是两套口径）。
  //
  // 回归修正：分析面按**裸成员名**（`C.m`）查——同名 static / instance 只有
  // 一条签名（实例位）⇒ 直接复用会把实例方法的返回类型贴到静态方法上
  // （wrong-exact）。只有形参名 / 元数一致（同一条声明的同一调用面）才复用；
  // 否则回落到静态方法自己的方法体观测，再否则 `unknown`。
  const analysisReturnOf = (name: string, params: readonly string[]): string | undefined => {
    const entry = memberList.find((m) => m.member === name);
    if (!entry) return undefined;
    const last = entry.lines[entry.lines.length - 1];
    if (!last) return undefined;
    const ret = /\)\s*:\s*([^;]+);\s*$/.exec(last);
    if (!ret) return undefined;
    const analysisParams = analysisLineParamNames(last);
    const want = params.map(paramBaseName);
    if (
      !analysisParams ||
      analysisParams.length !== want.length ||
      analysisParams.some((n, i) => n !== want[i])
    ) {
      return undefined;
    }
    return ret[1]?.trim();
  };
  for (const m of staticSurface) {
    const prefix = m.accessibility ? `${m.accessibility} ` : "";
    if (m.overloads !== undefined && m.overloads.length > 0) {
      body.push(...classMethodDeclLines(m, { static: true, prefix }));
      continue;
    }
    const ret =
      m.returnType ??
      analysisReturnOf(m.name, m.params) ??
      m.observedReturnType ??
      "unknown";
    body.push(...classMethodDeclLines({ ...m, returnType: ret }, { static: true, prefix }));
  }
  // Bug 23：static 字段（运行时公开数据属性）
  for (const f of cls?.staticFields ?? []) {
    body.push(
      `${staticFieldPrefix(f)}${memberKeyText(f.name, f.symbolKey)}${f.optional ? "?" : ""}: ${f.type};`,
    );
  }
  // Bug 23：访问器（getter / setter 属于公开类型面）
  for (const a of cls?.accessors ?? []) {
    const acc = a.accessibility ? `${a.accessibility} ` : "";
    const st = a.isStatic ? "static " : "";
    const key = memberKeyText(a.name, a.symbolKey);
    body.push(
      a.kind === "get"
        ? `${acc}${st}get ${key}(): ${a.type};`
        : `${acc}${st}set ${key}(v: ${a.type});`,
    );
  }
  // 实例字段（brand 实例形状 ∪ 源码面字段）
  for (const f of fields) {
    if (methodNames.has(f.name)) continue;
    body.push(
      `${fieldPrefix(f)}${memberKeyText(f.name, f.symbolKey)}${f.optional ? "?" : ""}: ${f.type};`,
    );
  }
  // Bug 74：类型形参子句优先取源码原文（含默认值 / 约束），否则按名字表补槽。
  const typeParams = cls?.typeParams ?? [];
  const typeParamsText =
    cls?.typeParamsText ?? (typeParams.length > 0 ? `<${typeParams.join(", ")}>` : "");
  const inner =
    body.length > 0
      ? `\n${body.map((l) => (l.trim() === "" ? l : `  ${l}`)).join("\n")}\n`
      : "";
  // Bug 12：匿名 default 类的普查名就是 "default"，保留字不能当类名 ⇒
  // 用合成声明名 `_default`（`export default class _default { … }` 合法）。
  const declaredName = className === "default" ? "_default" : className;
  // BUG-109：表达式超类（`extends mixin(Base)`）无法按名字解析，但继承链
  // 不能整条消失。降级成一个**开放构造基类**：实例 / 静态成员都可读可调用
  // （`any` 只出现在这条显式降级里），并发台账点名原文——比对每个继承成员
  // 报 TS2339 更可诊断，也不会把「作者声明的继承」静默撤销。
  const superExpr = cls?.superExpressionText;
  const baseName = `__nudo_base_${declaredName}`;
  const degradedSuper = superText === "" && superExpr !== undefined;
  const prelude = degradedSuper
    ? [
        `// nudo:unresolved-superclass ${declaredName} — extends ${sanitizeCommentText(superExpr)} (projected as open structural base)`,
        `declare const ${baseName}: { new (): any; [key: string]: any };`,
      ]
    : [];
  const effectiveSuperText = degradedSuper ? ` extends ${baseName}` : superText;
  const implementsText =
    cls?.implements !== undefined && cls.implements.length > 0
      ? ` implements ${cls.implements.join(", ")}`
      : "";
  const header = `${declaredName}${typeParamsText}${effectiveSuperText}${implementsText}`;
  // Bug 42：abstract 类修饰符。
  const abs = cls?.isAbstract ? "abstract " : "";
  const exportNames =
    cls?.exportNames ?? (cls?.exportName !== undefined ? [cls.exportName] : []);
  const exportName = exportNames[0];
  const extras = exportNames
    .slice(1)
    .map((n) => `export { ${declaredName} as ${exportNameRepr(n)} };`);
  if (exportName === undefined)
    return [...prelude, `declare ${abs}class ${header} {${inner}}`];
  if (exportName === "default")
    return [...prelude, `export default ${abs}class ${header} {${inner}}`, ...extras];
  if (exportName === className)
    return [...prelude, `export declare ${abs}class ${header} {${inner}}`, ...extras];
  return [
    ...prelude,
    `declare ${abs}class ${header} {${inner}}`,
    `export { ${declaredName} as ${exportNameRepr(exportName)} };`,
    ...extras,
  ];
}

/**
 * 类声明的超类子句（BUG-151）：` extends A`；基类是泛型 ⇒ 补 `unknown`
 * 实参（TS2314：泛型基类缺类型实参会让整份产物编译不过；`unknown` 是 TS
 * 的 top，2026-11-06 归一后产物里不再出现语义为「无约束」的 `any`）。
 */
/**
 * 沿 `extends` 链收集**继承来的**静态成员名（BUG-070）。
 *
 * 只收**本模块**里能查到的基类（分析面沿 `superClass` 登记继承方法时同样只
 * 走本地类）；基类自己 override 的方法按 ES 语义以最近一层为准——这里取并集
 * 即可，因为「子类 own 实例方法同名」会在调用方（`staticOnly`）里把该名字剔掉。
 */
function inheritedStaticNamesOf(
  className: string,
  surface: DtsModuleSurface | undefined,
): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>([className]);
  let base = surface?.classes.get(className)?.superClass;
  while (base !== undefined && !seen.has(base)) {
    seen.add(base);
    const cls = surface?.classes.get(base);
    if (!cls) break;
    for (const m of cls.staticMethods ?? []) out.add(m.name);
    base = cls.superClass;
  }
  return out;
}

/**
 * BUG-194：类型参数字面替换（`get(): T` + `{T → number}` ⇒ `get(): number`）。
 *
 * 只替换**类型位置**的整词出现：限定名后半段（`A.T`）与对象类型的属性键
 * （`{ T: number }`）不动。基类 own 方法的声明行是在基类作用域里算出来的，
 * 落到子类必须按 `extends Base<…>` 的实参代入。
 */
function substituteTypeParams(text: string, subst: ReadonlyMap<string, string>): string {
  if (subst.size === 0) return text;
  let out = text;
  for (const [name, value] of subst) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(
      new RegExp(`(?<![\\w$])${escaped}(?![\\w$])(?!\\s*\\??\\s*:)`, "g"),
      () => value,
    );
  }
  return out;
}

/** 成员在某个类的源码面里的访问修饰符（实例 / 静态方法；查不到 ⇒ undefined）。 */
function methodAccessibilityOf(
  cls: DtsClassMemberSurface | undefined,
  member: string,
): "private" | "protected" | "public" | undefined {
  if (!cls) return undefined;
  const hit = [...(cls.instanceMethods ?? []), ...(cls.staticMethods ?? [])].find(
    (m) => m.name === member,
  );
  return hit?.accessibility;
}

/**
 * BUG-194 / BUG-228：**继承来的实例方法**的声明视图。
 *
 * 分析面把基类 own 方法按子类名登记（Bug 64：未导出基类的方法也是子类公共
 * 面的一部分），dts 会把它当子类 own 成员发射——但（a）基类的类型实参从未
 * 代入（`Box<number>.get(): T` 变 `unknown` ⇒ 产物自身 TS2416）；（b）
 * `private` / `protected` 一律丢失（TS2415 / 消费方假绿）。这里沿 `extends`
 * 链取**声明类**的签名行，累积代入类型实参，并带回源码面修饰符。
 *
 * `lines === undefined` 表示该成员**不得重发**（private：TS 要求同一个私有
 * 声明，子类重发即 TS2415）。
 */
function inheritedMemberViews(
  className: string,
  surface: DtsModuleSurface | undefined,
  members: ReadonlyMap<string, Array<{ member: string; lines: string[] }>>,
): Map<string, { lines?: string[]; accessibility?: "private" | "protected" | "public" }> {
  const out = new Map<string, { lines?: string[]; accessibility?: "private" | "protected" | "public" }>();
  const own = surface?.classes.get(className);
  if (!surface || !own) return out;
  const ownNames = new Set(
    [...(own.instanceMethods ?? []), ...(own.staticMethods ?? [])].map((m) => m.name),
  );
  let cur = own.superClass;
  if (cur === undefined) return out;
  let subst = new Map<string, string>();
  const firstParams = surface.classes.get(cur)?.typeParams ?? [];
  const firstArgs = own.superTypeArguments ?? [];
  firstParams.forEach((p, i) => subst.set(p, firstArgs[i] ?? "unknown"));
  while (cur !== undefined) {
    const base = surface.classes.get(cur);
    if (!base) break;
    // BUG-386：未导出基类不在分析面普查表里（`members` 只收导出类）⇒
    // 从**源码面**（surface.classes 的方法签名）补继承视图。已导出的基类
    // 仍优先用分析面行（含观测收窄的证据）。
    const analysisEntries = members.get(cur) ?? [];
    const seenMembers = new Set(analysisEntries.map((e) => e.member));
    const sourceEntries: Array<{ member: string; lines: string[] }> = [];
    for (const m of base.instanceMethods ?? []) {
      if (seenMembers.has(m.name)) continue;
      const params = m.params
        .map((name, i) => {
          const type = m.paramTypes?.[i] ?? m.paramDefaults?.[i];
          return type === undefined ? name : `${name}: ${type}`;
        })
        .join(", ");
      const ret = m.returnType ?? m.annotationReturnType ?? m.observedReturnType ?? "unknown";
      sourceEntries.push({
        member: m.name,
        lines: [`${m.name}${m.optional === true ? "?" : ""}${m.typeParams ?? ""}(${params}): ${ret};`],
      });
    }
    for (const entry of [...analysisEntries, ...sourceEntries]) {
      if (ownNames.has(entry.member)) continue; // 子类 own 方法覆盖
      if (out.has(entry.member)) continue; // 最近的声明类优先
      const accessibility = methodAccessibilityOf(base, entry.member);
      if (accessibility === "private") {
        out.set(entry.member, { accessibility });
        continue;
      }
      out.set(entry.member, {
        lines: entry.lines.map((l) => substituteTypeParams(l, subst)),
        ...(accessibility !== undefined ? { accessibility } : {}),
      });
    }
    const next = base.superClass;
    if (next === undefined) break;
    const parentParams = surface.classes.get(next)?.typeParams ?? [];
    const parentArgs = (base.superTypeArguments ?? []).map((a) =>
      substituteTypeParams(a, subst),
    );
    const nextSubst = new Map<string, string>();
    parentParams.forEach((p, i) => nextSubst.set(p, parentArgs[i] ?? "unknown"));
    subst = nextSubst;
    cur = next;
  }
  return out;
}

function superClauseText(
  className: string,
  surface: DtsModuleSurface | undefined,
): string {
  const cls = surface?.classes.get(className);
  const superName = cls?.superClass;
  if (!superName) return "";
  const builtin = BUILTIN_GENERIC_BRANDS.get(superName);
  if (builtin !== undefined) return ` extends ${builtin}`;
  // Bug 73：源码里**显式写下**的超类类型实参（`extends Base<string>`）优先——
  // 只查本模块类会漏掉导入的泛型基类，产物自身报 TS2314。
  const args = cls?.superTypeArguments;
  if (args && args.length > 0) return ` extends ${superName}<${args.join(", ")}>`;
  const baseParams = surface?.classes.get(superName)?.typeParams ?? [];
  const localArgs = baseParams.length > 0 ? `<${baseParams.map(() => "unknown").join(", ")}>` : "";
  return ` extends ${superName}${localArgs}`;
}

/**
 * 对象字面量成员函数的源码注解叠加（BUG-157）：**只补缺**——形参位没有
 * Abs 证据时才填；返回位只在观测没有返回类型时填。
 *
 * 求值面的 fn Abs 只有形参名（成员未调用 ⇒ 无外延证据），注解是唯一声明面
 * 证据；调用点观测到的返回类型优先（观测是事实）。
 */
function overlayObjectFnAnnotations(
  a: Abs,
  annotations: readonly DtsObjectFnAnnotation[] | undefined,
  surface: DtsModuleSurface,
  refs?: Set<string>,
  analyzedReturns?: ReadonlyMap<string, Abs>,
): Abs {
  // BUG-256：即使没有任何函数注解，也要走访问器实体化（getter-only 的
  // `readonly` 是访问器表的事实，与注解无关）。
  if (a.shape.k !== "obj") return a;
  const slots: Record<string, (typeof a.shape.slots)[string]> = { ...a.shape.slots };
  // BUG-235：本函数会造**新 Abs 身份**，而访问器侧表按对象身份键控 ⇒ 新对象
  // 再也查不到 getter，下游 `slotAbsOf` 落回 `$lit(void 0)` 占位槽，把 getter
  // 读域发布成 exact `undefined`（`{ m(a: number): string; g: undefined }`）。
  // 侧表无法整体迁移（`migrateAccessors` 不在公共面），但投影只需要读域 ⇒
  // 在造新对象前把它**实体化**进槽值。
  //
  // BUG-233 / BUG-256：getter-only（有 get 无 set）在 TS 里是**只读**属性，
  // 这里把该事实落成槽标记（下游 widen 透传、渲染发 `readonly`）——新对象
  // 没有侧表，晚一步就再也查不到。旧实现只在「有返回注解」时落标记，且第一段
  // 的改动因 `changed` 未置位被整体丢弃（`gAnnot` / `gPlain` 都发可写）。
  //
  // BUG-270：setter-only 的属性类型是 **setter 形参类型**（TS 语义），不是
  // 占位槽的 `undefined`。参数注解在 `objectFnMemberAnnotations` 里已采集。
  let changed = false;
  for (const [k, slot] of Object.entries(slots)) {
    const acc = lookupObjAccessor(a, k);
    if (acc === undefined) continue;
    if (acc.get === undefined) {
      const ann = (annotations ?? []).find((a) => a.key === k);
      const paramText = ann?.paramTypes[0];
      if (paramText !== undefined && safeValueAnnotation(paramText, surface, refs).unresolved === undefined) {
        const shape = tsAnnotationShape(paramText);
        if (shape) {
          slots[k] = { ...slot, value: makeAbs(shape, undefined, undefined, "path") };
          changed = true;
        }
      }
      continue;
    }
    const read = slotAbsOf(a, k, slot.value);
    const readonly = acc.set === undefined;
    if (read !== slot.value || (readonly && slot.readonly !== true)) {
      slots[k] = {
        ...slot,
        ...(read !== slot.value ? { value: read } : {}),
        ...(readonly ? { readonly: true } : {}),
      };
      changed = true;
    }
  }
  // BUG-381：无注解的成员也要用**分析返回**（成员自己的 fn 条目）补返回位，
  // 不能只依赖 `fnMemberAnnotations`（对象属性箭头没有 AST 成员注解条目）。
  for (const [member, ret] of analyzedReturns ?? []) {
    const slot = slots[member];
    if (!slot || slot.value.shape.k !== "fn" || slot.value.shape.returnType !== undefined) continue;
    slots[member] = {
      ...slot,
      value: { ...slot.value, shape: { ...slot.value.shape, returnType: ret } },
    };
    changed = true;
  }
  for (const ann of annotations ?? []) {
    const slot = slots[ann.key];
    if (!slot) continue;
    const fn = slot.value;
    if (fn.shape.k !== "fn") continue;
    const paramTypes = [...(fn.shape.paramTypes ?? [])];
    let fnChanged = false;
    ann.paramTypes.forEach((text, i) => {
      if (paramTypes[i] !== undefined || text === undefined) return;
      // rest 位必须是数组类型（与 `tsParamAnnotation` 同一判据）
      if (ann.rest[i] === true && !isArrayTypeText(text)) return;
      if (safeValueAnnotation(text, surface, refs).unresolved !== undefined) return;
      const shape = tsAnnotationShape(text);
      if (!shape) return;
      paramTypes[i] = makeAbs(shape, undefined, undefined, "path");
      fnChanged = true;
    });
    let returnType = fn.shape.returnType;
    if (returnType === undefined && ann.returnType === undefined) {
      // BUG-381：成员自己的分析已给出返回域（`fn f => number exact`）。
      const analyzed = analyzedReturns?.get(ann.key);
      if (analyzed !== undefined) {
        returnType = analyzed;
        fnChanged = true;
      }
    }
    if (returnType === undefined && ann.returnType !== undefined) {
      if (safeValueAnnotation(ann.returnType, surface, refs).unresolved === undefined) {
        const shape = tsAnnotationShape(ann.returnType);
        if (shape) {
          returnType = makeAbs(shape, undefined, undefined, "path");
          fnChanged = true;
        }
      }
    }
    if (!fnChanged) continue;
    slots[ann.key] = {
      ...slot,
      value: {
        ...fn,
        shape: { ...fn.shape, paramTypes, ...(returnType !== undefined ? { returnType } : {}) },
      },
    };
    changed = true;
  }
  return changed ? { ...a, shape: { ...a.shape, slots } } : a;
}

/**
 * 模块级值声明（BUG-190）：`export const/let/var` 与 TS `enum`。
 *
 * 只有**导出面**上的值声明落地（`dtsExportNamesOf` 非空）；类型取自分析面的
 * 绑定 Abs（顶层字面量 widen 到基类型——声明面是取值面，不是 case 台账）；
 * 拿不到绑定 ⇒ `unknown` + 产物内台账（可诊断，不静默）。
 */
function dtsValueDeclarations(
  surface: DtsModuleSurface | undefined,
  values: ReadonlyMap<string, Abs> | undefined,
  declaredLocals: ReadonlySet<string>,
  annotationRefs?: Set<string>,
  /**
   * BUG-231：这些本地名虽被分析成函数，但声明器带可解析类型注解
   * （`export const cb: Fn = (a) => …`）⇒ 由本通道发 `declare const cb: Fn`，
   * 不得按函数处理的「已声明」跳过。
   */
  annotatedFunctionLocals: ReadonlySet<string> = new Set<string>(),
  /** BUG-381：对象成员函数的分析返回 Abs（成员名 → 返回域）。 */
  analyzedMemberReturns: ReadonlyMap<string, Abs> = new Map<string, Abs>(),
): string[] {
  if (!surface) return [];
  const out: string[] = [];
  for (const [local, value] of surface.values) {
    const names = dtsExportNamesOf(surface, local);
    const primary = names[0];
    if (primary === undefined) continue; // 未导出 ⇒ 不在公开面
    // 已被模块级函数声明占用（`export const f = () => …` 被分析成函数）⇒
    // 再发一条值声明会产出 TS2300（Duplicate identifier）。BUG-231 的例外：
    // 声明器注解可解析 ⇒ 函数声明已被抑制，值声明才是正确形态。
    if (
      declaredLocals.has(local) &&
      !annotatedFunctionLocals.has(local) &&
      value.nonFunctionValue !== true
    ) {
      continue;
    }
    if (surface.classes.has(local)) continue;
    const abs = values?.get(local);
    let decl: string;
    if (value.kind === "enum") {
      // 成员带上**字面量**初始化器（字符串 enum 的成员类型是字面量类型：
      // 丢掉 `= "a"` 会把它变成数值 enum ⇒ 消费端的 `Mode.A` 类型语义反转）。
      const body = (value.enumMembers ?? [])
        .map(
          (m) =>
            `  ${isJsBindingIdent(m.name) ? m.name : JSON.stringify(m.name)}${
              m.init !== undefined ? ` = ${m.init}` : ""
            },`,
        )
        .join("\n");
      // Bug 25：`export const enum` ⇒ `declare const enum`（与 tsc
      // `--declaration` 同形；否则消费端生成运行时 import、运行时 SyntaxError）。
      const constKw = value.constEnum ? "const " : "";
      decl = `declare ${constKw}enum ${local} {${body ? `\n${body}\n` : ""}}`;
    } else {
      // BUG-130：源码注解优先于观测（`export let l: number` 没有初始化器，
      // 注解是唯一类型来源）；引用不可解析名 ⇒ 不采用并落台账。
      const ann = value.annotation
        ? safeValueAnnotation(value.annotation, surface, annotationRefs)
        : undefined;
      if (ann?.unresolved !== undefined) {
        out.push(
          `// nudo:dropped-type-annotation ${local}: ${ann.unresolved} — type not declared in this module (falls back to the observed type)`,
        );
      }
      // BUG-254 / BUG-258：初始化器 AST 里 Abs 表达不了的声明事实优先
      // （`typeof target` / `new Map<string, number>()` 的显式实参）。
      const initText = value.initTypeText;
      const astPreferred =
        initText !== undefined &&
        (initText.includes("typeof ") ||
          /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*<[\s\S]+>$/.test(initText));
      // BUG-264：`const s = Symbol("s")` ⇒ `unique symbol`（显式 `: symbol`
      // 注解已在上面优先）。
      const uniqueSymbolText = value.uniqueSymbol === true ? "unique symbol" : undefined;
      // BUG-140：初始化器内部的 `as const`（外层可变、内层冻结）。
      const declaredText =
        ann?.text ??
        value.nestedConstType ??
        uniqueSymbolText ??
        (astPreferred ? initText : undefined);
      if (abs === undefined && value.typeText === undefined && declaredText === undefined) {
        out.push(
          `// nudo:unresolved-value ${local} — no analysis binding (projected as unknown)`,
        );
      }
      // Bug 72：可变容器递归拓宽（对象槽 / 数组元素到基类型）。
      // Bug 77：`as const` 是**冻结**声明——字面量类型必须保留（否则
      // `{ readonly host: "h" }` 被拓宽成 `readonly host: string`，把 as const
      // 的字面量精度也丢了）⇒ 只走既有的顶层 widen + readonly 渲染。
      //
      // BUG-157：对象字面量成员函数的形参 / 返回注解叠加进 Abs（只补缺）。
      const withMemberAnnotations = (a: Abs): Abs =>
        overlayObjectFnAnnotations(
          a,
          value.fnMemberAnnotations,
          surface,
          annotationRefs,
          analyzedMemberReturns,
        );
      // BUG-236：symbol 方法的返回注解走文本旁路（见 withSymbolReturnOverrides）
      const symbolReturns = new Map<string, string>();
      // BUG-271：普通对象方法的返回注解（`Promise<number>` / 具名别名 /
      // `string | null`）不能经 Shape 闸门——源码注解直接覆盖返回位文本。
      const objectReturns = new Map<string, string>();
      for (const ann of value.fnMemberAnnotations ?? []) {
        if (ann.returnType === undefined) continue;
        const safe = safeValueAnnotation(ann.returnType, surface, annotationRefs);
        if (safe.text === undefined) continue;
        if (ann.key.startsWith("@@")) symbolReturns.set(ann.key, safe.text);
        else objectReturns.set(ann.key, safe.text);
      }
      // BUG-260：`const` 不参与顶层字面量拓宽（tsc 对 `const c = "abc"` 保留
      // `"abc"`）；`let` / `var` 仍拓宽。`as const` 完全不拓宽（冻结声明）。
      const renderAbs = (): string => {
        if (!abs) return value.typeText ?? "unknown";
        const annotated = withMemberAnnotations(abs);
        if (value.asConst) return absToTSType(annotated);
        if (value.literalConst === true && annotated.shape.k === "prim" && annotated.term?.op === "lit") {
          return absToTSType(annotated);
        }
        return absToTSType(widenModuleValueAbs(annotated));
      };
      const render = (): string =>
        withUserSymbolKeys(value.userSymbolKeys, () =>
          withObjectFnReturnOverrides(objectReturns, () =>
            withSymbolReturnOverrides(symbolReturns, renderAbs),
          ),
        );
      const typeText = declaredText ?? (value.asConst ? withReadonlySlots(render) : render());
      decl = `declare ${value.kind} ${local}: ${typeText};`;
    }
    if (primary === local) {
      out.push(`export ${decl}`);
      out.push(...names.slice(1).map((n) => `export { ${local} as ${exportNameRepr(n)} };`));
      continue;
    }
    out.push(decl);
    out.push(`export { ${local} as ${exportNameRepr(primary)} };`);
    out.push(...names.slice(1).map((n) => `export { ${local} as ${exportNameRepr(n)} };`));
  }
  return out;
}

/**
 * 类形参声明（构造器 / 方法 / static）。
 *
 * BUG-003 曾把这里从硬编码 `unknown` 改成 `any`，理由是「nudo 展示面的
 * 无约束形参显示 any」。2026-11-06 产品裁定明确：该 display 规则只管
 * **nudo 展示 / CLI 面**；**TS 投影面**把 nudo 的无约束 any 映为 TS
 * `unknown`（top），所以无注解时仍回 `unknown`，且理由不是「推断失败」而是
 * 「TS 侧的 top」。
 *
 * 有注解时**原文保真**（源码里写什么就是什么）：形参注解不是「猜类型」，
 * 是声明面事实——抽象 / 无体方法在分析面没有条目，源码面是唯一证据源。
 * rest 位的注解在合法 TS 里本来就是数组类型（`...rest: number[]`），不得
 * 再追加 `[]`（`number[][]` 会让消费方 `new C(1, 2, 3)` 报 TS2345）；只有
 * 注解不可用（缺 / 非数组文本）时才补 `unknown[]`。
 */
function paramDeclOf(name: string, index: number, annotation?: string): string {
  const safe = sanitizeParamName(name, index);
  if (annotation !== undefined) {
    if (safe.startsWith("...") && !isArrayTypeText(annotation)) {
      return `${safe}: ${annotation}[]`;
    }
    return `${safe}: ${annotation}`;
  }
  return safe.startsWith("...") ? `${safe}: unknown[]` : `${safe}: unknown`;
}

/**
 * 观测返回串 → 注解证据收窄（BUG-156）。
 *
 * 只做**收窄**：观测是 `unknown`（求值面没有信息）或是**标量联合**且注解证据
 * 是其中一个成员时采用注解证据。反向（注解证据不在观测串里 / 观测是单类型 /
 * 结构化类型）一律不动——本函数**不放宽**，也不改字面量精度（`2` 保持 `2`）。
 */
function refineObservedReturn(observed: string, annotationEvidence?: string): string {
  if (annotationEvidence === undefined) return observed;
  if (observed === "unknown") return annotationEvidence;
  const members = observed.split("|").map((s) => s.trim());
  if (members.length < 2) return observed;
  return members.includes(annotationEvidence) ? annotationEvidence : observed;
}

/** brand 实例形状 → 字段声明（排除方法名——方法进类体，不进字段） */
function brandFieldLines(
  brand: Abs | undefined,
  methodNames: Set<string>,
): Array<{ name: string; type: string }> {
  if (!brand) return [];
  const brandShape = brand.shape;
  if (brandShape.k !== "brand") return [];
  const instance = brandShape.shape;
  if (instance.shape.k !== "obj") return [];
  const out: Array<{ name: string; type: string }> = [];
  for (const [k, slot] of Object.entries(instance.shape.slots)) {
    if (methodNames.has(k)) continue;
    // Bug 240：私有字段（`#x`）是 internal 槽 ⇒ 不是用户可见属性 ⇒ 不进类体
    // （与 core 三面同判据）。
    if (isHiddenInternalSlot(k, slot)) continue;
    out.push({ name: k, type: absToTSType(widenParamAbs(slot.value)) });
  }
  return out;
}

/** Abs 树里的 brand（类实例类型）收集：类名 → brand Abs */
/**
 * BUG-054：Abs 里出现的 brand 类名集合（值声明的实例类型 ⇒ 产物要能解析该类）。
 */
function brandNamesInAbs(a: Abs | undefined, out: Set<string> = new Set()): Set<string> {
  const seen = new Set<Abs>();
  const visit = (x: Abs | undefined): void => {
    if (!x || seen.has(x)) return;
    seen.add(x);
    const s = x.shape;
    switch (s.k) {
      case "brand":
        if (isJsBindingIdent(s.name) || /^[A-Z][A-Za-z0-9_$]*$/.test(s.name)) out.add(s.name);
        visit(s.shape);
        return;
      case "obj":
        for (const slot of Object.values(s.slots)) visit(slot.value);
        return;
      case "arr":
        visit(s.element);
        return;
      case "tuple":
        for (const e of s.elements) visit(e);
        if (s.rest) visit(s.rest);
        return;
      case "fn":
        for (const pt of s.paramTypes ?? []) visit(pt);
        if (s.returnType) visit(s.returnType);
        for (const slot of Object.values(s.slots ?? {})) visit(slot.value);
        return;
      case "sum":
        for (const m of s.members) visit(m);
        return;
      case "eff":
        visit(s.inner);
        return;
      default:
        return;
    }
  };
  visit(a);
  return out;
}

function collectBrandAbs(
  fn: FunctionAnalysis,
  contract: DtsContractFace | undefined,
  out: Map<string, Abs>,
): void {
  const seen = new Set<Abs>();
  const visit = (a: Abs | undefined): void => {
    if (!a || seen.has(a)) return;
    seen.add(a);
    const s = a.shape;
    switch (s.k) {
      case "brand":
        if (isJsBindingIdent(s.name) || /^[A-Z][A-Za-z0-9_$]*$/.test(s.name)) {
          if (!out.has(s.name)) out.set(s.name, a);
        }
        visit(s.shape);
        return;
      case "obj":
        for (const slot of Object.values(s.slots)) visit(slot.value);
        return;
      case "arr":
        visit(s.element);
        return;
      case "tuple":
        for (const e of s.elements) visit(e);
        if (s.rest) visit(s.rest);
        return;
      case "fn":
        for (const p of s.paramTypes ?? []) visit(p);
        if (s.returnType) visit(s.returnType);
        for (const slot of Object.values(s.slots ?? {})) visit(slot.value);
        return;
      case "sum":
        for (const m of s.members) visit(m);
        return;
      case "eff":
        visit(s.inner);
        return;
      default:
        return;
    }
  };
  for (const c of fn.cases) {
    visit(c.abs);
    for (const a of c.argAbs ?? []) visit(a);
  }
  visit(fn.combinedAbs);
  if (contract) {
    for (const p of contract.params) visit(p.abs);
    visit(contract.return);
  }
}
