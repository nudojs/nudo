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
} from "@nudojs/core/internal";
import type { AnalysisResult, CaseResult, FunctionAnalysis } from "../analyzer.ts";
import { domainEvidenceCases } from "./domain-cases.ts";
import { tsAnnotationTypeText } from "../ts-annotation.ts";
import { exportNameRepr } from "./export-binding.ts";
import { isHiddenInternalSlot } from "./internal-slot.ts";
import { isRuntimeGlobalCtorName } from "./schema-generator.ts";

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
  let n = name;
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n)) {
    n = n.replace(/[^A-Za-z0-9_$]/g, "_");
    if (!/^[A-Za-z_$]/.test(n)) n = `_${n}`;
    if (n.length === 0) n = "_";
  }
  // 保留字 → `_` 前缀（`default` → `_default`）；已合法的名字原样返回
  return toJsBindingIdent(n);
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
    return absToTSTypeInner(a, typeVars, budget);
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
let currentBrandScope: ReadonlySet<string> | undefined;

/** 在给定 brand 解析口径下投影（作用域内恢复旧口径） */
function withBrandScope<T>(scope: ReadonlySet<string>, fn: () => T): T {
  const prev = currentBrandScope;
  currentBrandScope = scope;
  try {
    return fn();
  } finally {
    currentBrandScope = prev;
  }
}

/**
 * 模块面可解析的类名（本地声明的类 + 已 import 的类）——brand 类名只在这里
 * 列出的名字下才允许进产物。
 */
function brandScopeOf(surface: DtsModuleSurface | undefined): ReadonlySet<string> {
  const out = new Set<string>();
  if (!surface) return out;
  for (const name of surface.classes.keys()) out.add(name);
  for (const name of surface.imports?.keys() ?? []) out.add(name);
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
  const builtin = BUILTIN_GENERIC_BRANDS.get(name);
  if (builtin !== undefined) return builtin;
  if (!isJsBindingIdent(name) && !/^[A-Z][A-Za-z0-9_$]*$/.test(name)) return "unknown";
  const scope = currentBrandScope;
  if (scope === undefined) return name;
  if (scope.has(name)) return name;
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
  // 无 `next` ⇒ 不是迭代器（普通对象 / 仅可迭代对象仍走结构面）
  if (!slots["next"]) return undefined;
  const elems: Abs[] = [];
  for (const [k, slot] of Object.entries(slots)) {
    if (!CANONICAL_INDEX.test(k)) continue;
    elems.push(slot.value);
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
  if (slots["@@asyncIterator"]) return `AsyncGenerator<${elemType}>`;
  // 完整生成器协议（return / throw）⇒ Generator；只有 next ⇒ 普通迭代器
  if (slots["return"] || slots["throw"]) return `Generator<${elemType}>`;
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
 * 符号键槽 → TS 符号键成员行（`[Symbol.iterator](): T`）；未登记的符号键 ⇒
 * undefined（TS 没有任意 symbol 键的类型语法 ⇒ 有损跳过）。
 */
function symbolMemberLine(
  k: string,
  slot: { value: Abs },
  typeVars: Map<string, string> | undefined,
  budget: ProjectionBudget,
): string | undefined {
  const sym = WELL_KNOWN_SYMBOLS.get(k);
  if (sym === undefined) return undefined;
  const v = slot.value;
  if (v.shape.k === "fn") {
    // 方法形态：`[Symbol.iterator](): T`（TS 的可迭代判定要方法签名）
    const ret = v.shape.returnType
      ? absToTSTypeB(v.shape.returnType, typeVars, budget)
      : "unknown";
    return `[${sym}](): ${ret}`;
  }
  return `[${sym}]: ${absToTSTypeB(v, typeVars, budget)}`;
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
      // Abs any = **未受约束**（未标注入口形参 / 显式 any()）→ TS any。
      // abs.md:100 明文规则：「unconstrained entry parameters display as `any`,
      // never as `unknown`」——旧口径把两者合并成 unknown ⇒ 消费方吃 TS2571
      // 假红（引擎自己的签名说 `any`，产物却说 unknown）。
      return "any";
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
          if (isHiddenInternalSlot(k, slot)) continue;
          if (slot.symbolKey === true) {
            const line = symbolMemberLine(k, slot, typeVars, budget);
            if (line !== undefined) sideEntries.push(line);
            continue;
          }
          const slotAbs = slotAbsOf(a, k, slot.value);
          const inner = absToTSTypeB(slotAbs, typeVars, budget);
          sideEntries.push(
            slot.optional
              ? `${formatPropKey(k)}?: ${wrapComplexAbs(slotAbs, typeVars, budget)}`
              : `${formatPropKey(k)}: ${inner}`,
          );
        }
        return sideEntries.length === 0 ? arrayPart : `${arrayPart} & { ${sideEntries.join("; ")} }`;
      }
      const entries: string[] = [];
      for (const [k, slot] of Object.entries(a.shape.slots)) {
        // Bug 240 / 554：内部槽（internal）不是用户可见属性（私有字段 `#x` /
        // 生成器协议槽）⇒ 不进结构字段（与 core 的 format / projection / denote
        // 三面**同判据**：internal 且键不是规范数组下标）。
        if (isHiddenInternalSlot(k, slot)) continue;
        // 符号键槽：TS 里是**符号键成员**，不是字符串字段（`"@@iterator"`
        // 只是引擎内部的键投影）。未登记的符号键 TS 无语法可表达 ⇒ 跳过。
        if (slot.symbolKey === true) {
          const line = symbolMemberLine(k, slot, typeVars, budget);
          if (line !== undefined) entries.push(line);
          continue;
        }
        // Bug 543 / 560：optional 槽渲染成 TS 的**可选属性** `k?: T`。
        // 旧口径 `k: T | undefined` 在 TS 里是「**键必需**、值可为 undefined」——
        // 与顶层形参的 `k?: T` 口径相反，且比契约 / zod / standard / check
        // 四个面都**严**（投影方向反了：one-way 投影不得更严）。TS 里「键可省略」
        // 是独立的语法位，只有 `?` 能表达。
        // Bug 191：访问器键的槽是 `$lit(void 0)` 占位（真 getter 住侧表）——
        // dts 投影须取 getter 读域，否则把 getter 的返回值谎报成 exact
        // `undefined`。
        const slotAbs = slotAbsOf(a, k, slot.value);
        const inner = absToTSTypeB(slotAbs, typeVars, budget);
        if (slot.optional) {
          const t = wrapComplexAbs(slotAbs, typeVars, budget);
          entries.push(`${formatPropKey(k)}?: ${t}`);
          continue;
        }
        entries.push(`${formatPropKey(k)}: ${inner}`);
      }
      // Bug 565：零成员对象**不是** TS 的 `{}`（= 任意非 nullish 值）⇒ 渲染成
      // `Record<string, never>`（空对象类型）：属性读合法（不再 TS2339 假红），
      // 且在联合类型里**不吸收** `{ a: number }`（`{}` 会把契约义务整个吃掉）。
      if (entries.length === 0) return "Record<string, never>";
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
      return `[${parts.join(", ")}]`;
    }
    case "fn": {
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
    return widenParamAbsInner(a, budget);
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
        { value: Abs; optional?: boolean; internal?: boolean; symbolKey?: boolean }
      > = {};
      for (const [k, slot] of Object.entries(s.slots)) {
        // Bug 191：访问器键的槽是 `$lit(void 0)` 占位——**先**取 getter 读域
        // 再 widen（本分支造新对象，侧表按对象身份键控，造新后读域即丢）。
        const src = slotAbsOf(a, k, slot.value);
        slots[k] = {
          value: widenParamAbs(src, budget),
          ...(slot.optional ? { optional: true } : {}),
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
 * BUG-214：**纯调用点观测**的返回位拓宽。
 *
 * 只有 `call@` 见证（没有 `@nudo:case` 断言、也没有入口泛化）时，返回 Abs 是
 * **一次**调用点的取值 ⇒ 对象槽里的字面量是那次调用的实参流进来的，不是函数
 * 的类型（`mk(1)` ⇒ `{ a: 1; b: "s" }`，而 `mk("x")` 返回 `{ a: "x" }`）。
 * 把这种字面量发布成 `.d.ts` 会让消费端对**合法代码**报 TS2345 / TS2367。
 *
 * → 对象槽里的标量字面量剥到基类型（`{ a: number; b: string }`）。
 * 非纯观测证据（入口泛化 / 带断言的 case）维持「嵌套精度保留」。
 */
function widenObservedReturnAbs(a: Abs, budget: ProjectionBudget = new ProjectionBudget()): Abs {
  const stop = budget.enter(a);
  if (stop) return a;
  try {
    const s = a.shape;
    if (s.k === "prim") {
      if (a.term?.op === "lit" && a.term.value !== null && a.term.value !== undefined) {
        return makeAbs(s, undefined, undefined, "exact");
      }
      return a;
    }
    if (s.k === "obj") {
      const slots: Record<
        string,
        { value: Abs; optional?: boolean; internal?: boolean; symbolKey?: boolean }
      > = {};
      for (const [k, slot] of Object.entries(s.slots)) {
        const src = slotAbsOf(a, k, slot.value);
        slots[k] = {
          ...slot,
          value: widenObservedReturnAbs(src, budget),
        };
      }
      return makeAbs({ k: "obj", slots }, undefined, undefined, "exact");
    }
    if (s.k === "arr") {
      return makeAbs(
        { k: "arr", element: widenObservedReturnAbs(s.element, budget) },
        undefined,
        undefined,
        "exact",
      );
    }
    if (s.k === "tuple") {
      return makeAbs(
        {
          k: "tuple",
          elements: s.elements.map((e) => widenObservedReturnAbs(e, budget)),
          ...(s.rest ? { rest: widenObservedReturnAbs(s.rest, budget) } : {}),
          ...(s.holes?.length ? { holes: [...s.holes] } : {}),
        },
        undefined,
        undefined,
        "exact",
      );
    }
    return a;
  } finally {
    budget.exit();
  }
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
 * 「无信息」类型串：Abs `any`（未约束）与 Abs `unknown`（推断失败）的 TS
 * 渲染（`any` / `unknown`）都**不携带外延**——不能算作「比泛型 / 兜底更
 * 精确的证据」（Bug 544 的 any/unknown 分面：两者语义相反，但都无外延）。
 */
function isNoInfoType(ts: string): boolean {
  return ts === "unknown" || ts === "any";
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

function contractReturnTSType(a: Abs): string {
  return contractLiteralTSType(a) ?? absToTSType(widenTopLevelAbs(a));
}

function restParamType(widened: Abs, isRest: boolean): string {
  if (!isRest) return absToTSType(widened);
  if (widened.shape.k === "arr") return absToTSType(widened);
  const ts = absToTSType(widened);
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
]);

/**
 * 注解原文里引用的**类型名**（BUG-168）。
 *
 * 跳过：限定访问的后半段（`Intl.DateTimeFormat` 只解析 `Intl`——产物里要解析的
 * 只是根名）、对象类型里的**属性键** / 索引签名参数名（`{ a: number }` 的 `a`）。
 * 其余标识符一律视为类型引用，由调用方核对「产物里可解析」。
 */
function annotationTypeRefs(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
    const name = m[0];
    const at = m.index ?? 0;
    if (at > 0 && text[at - 1] === ".") continue;
    // 属性键 / 索引签名参数名：`a: T` / `a?: T`
    if (/^\?*\s*:/.test(text.slice(at + name.length))) continue;
    out.push(name);
  }
  return out;
}

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
  for (const name of annotationTypeRefs(text)) {
    if (TS_TYPE_TOKENS.has(name)) continue;
    const surface = ctx?.surface;
    // 可解析 = 环境内建类型名（Date / Error / URL …）/ 产物里会声明的本地类 /
    // 产物里会补 `import type` 的导入名。
    const resolvable =
      isRuntimeGlobalCtorName(name) ||
      (surface !== undefined &&
        (surface.classes.has(name) || surface.imports?.has(name) === true));
    if (!resolvable) {
      ctx?.dropped?.push(`${fn.name}.${getParamName(fn, index)}: ${name}`);
      return undefined;
    }
    if (surface?.classes.has(name) || surface?.imports?.has(name) === true) {
      ctx?.typeRefs?.add(name);
    }
  }
  return text;
}

/** 数组类型文本（`T[]` / `Array<T>` / `ReadonlyArray<T>`） */
function isArrayTypeText(t: string): boolean {
  return /\[\]$/.test(t) || /^Array<.*>$/.test(t) || /^ReadonlyArray<.*>$/.test(t);
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
 * 契约面证据（export CLI 从 effectiveInterface 取——与 check 签名面同数据源：
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
  params: Array<{ name: string; abs: Abs; optional?: boolean }>;
  return?: Abs;
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
function contractParamType(a: Abs, isRest: boolean): string {
  if (!isRest) {
    const lit = contractLiteralTSType(a);
    if (lit !== undefined) return lit;
  }
  return restParamType(widenParamAbs(a), isRest);
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
  if (keys.length === 0) return { keys: [] };
  // Bug 394：**数组解构**的字段级契约按**元素下标**寻址（`[a, b]` 的 `a` 是
  // 下标 0 的元素，不是属性键）⇒ 聚合成**元组**，不是对象。摊成对象会产出
  // 与真实形参形态**相反**的输入面（合法数组调用被判红、非法对象调用放行）。
  if (decl.patternKind === "array") {
    // 元组长度 = 模式的**位置数**（最高下标 + 1）——未契约的位置留 `any`
    // （**无约束**，不是 unknown——unknown 表示引擎推导失败；契约没写的元素位
    // 是「没约束」⇒ any，与入口无约束参数同口径）；契约只覆盖部分位置时，
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

/** 参数位（渲染前的中间形态） */
type ParamSlot = {
  /** 声明名（rest 带 `...`；pattern 是 `{ a, b }`） */
  name: string;
  /** 基础类型串（不含 `?` / `| undefined`） */
  type: string;
  /** 该位可省略 */
  optional: boolean;
  /** `T | undefined` 文本（可选位不在尾部时用——TS1016 不允许 `?` 跟在必填位后） */
  unionText?: string;
};

/**
 * 渲染参数位列表。
 *
 * TS 规则：**可选位之后不得跟必填位**（TS1016「A required parameter cannot
 * follow an optional parameter」）⇒ 可选位若不在尾部，只能渲染成
 * `T | undefined`（值可为 undefined，位置仍必填）——TS 的位置参数约定
 * 无法表达「中间位可省略」。
 */
function renderParamSlots(slots: ParamSlot[]): string[] {
  const out: string[] = new Array(slots.length);
  let requiredAfter = false;
  for (let i = slots.length - 1; i >= 0; i--) {
    const s = slots[i]!;
    const hasRequiredAfter = requiredAfter;
    if (!s.optional) requiredAfter = true;
    if (s.optional && hasRequiredAfter) {
      out[i] = `${s.name}: ${s.unionText ?? `${s.type} | undefined`}`;
    } else {
      out[i] = s.optional ? `${s.name}?: ${s.type}` : `${s.name}: ${s.type}`;
    }
  }
  return out;
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
  const slots: ParamSlot[] = [];
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
    const annotation = tsParamAnnotation(fn, i, isRest, ctx);
    const contractRender = contractParamRenderAbs(contractHit);
    const typeStr = contractRender
      ? contractParamType(contractRender, isRest)
      : (annotation ?? paramTypeFromAbs(members, isRest));
    // 声明名：解构形参用**绑定模式**形态 `{ a, b }`（公共 API 声明不该出现
    // 求值占位 `_p0`；Bug 538）。键不全（契约/观测都拿不到该绑定）时回落
    // 占位名——模式形态与类型不匹配会产出不可编译的 .d.ts。
    const patternKeys = contractHit.abs ? contractHit.keys : patternObservedKeys(members);
    const boundCovered =
      decl?.isPattern === true &&
      decl.bound.length > 0 &&
      decl.bound.every((b) => patternKeys.includes(decl.propKey[b] ?? b));
    let name: string;
    if (boundCovered) {
      // Bug 394：数组解构渲染成**数组形态** `[ a, b ]`（与源码一致）——
      // 此前一律 `{ a, b }` ⇒ 声明面看得出是对象，与真实形参形态相反。
      name =
        decl?.patternKind === "array"
          ? `[ ${decl.bound.join(", ")} ]`
          : `{ ${decl.bound.join(", ")} }`;
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
  const params = renderParamSlots(slots);
  const retAbs = contract?.return ?? returnAbsOf(fn);
  // BUG-214：**纯调用点观测**（只有 call@ 见证）的返回位是**一次调用**的取值，
  // 不是函数的类型 ⇒ 对象槽里的字面量必须拓宽（否则发布的 .d.ts 让消费端对
  // 合法代码报 TS2345 / TS2367）。
  const observedOnly =
    fn.cases.length > 0 && fn.cases.every((c) => c.source === "callsite");
  // 契约返回位（声明级证据，权威）⇒ 保形（Bug 520：lit(42) → 42，与 zod /
  // standard / check 三面同口径）；观测返回位沿用调用面 widen 口径。
  const returnType = retAbs
    ? contract?.return
      ? contractReturnTSType(contract.return)
      : absToTSType(
          observedOnly ? widenObservedReturnAbs(widenTopLevelAbs(retAbs)) : widenTopLevelAbs(retAbs),
        )
    : "unknown";
  return { params, paramNames, paramTypes, returnType };
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
  const typeParams: string[] = [];
  for (const id of [...free].sort()) {
    let n = tsTypeParamName(id);
    if (used.has(n) || !isJsBindingIdent(n)) {
      let i = 2;
      while (used.has(`${n}${i}`)) i++;
      n = `${n}${i}`;
    }
    used.add(n);
    typeVars.set(id, n);
    typeParams.push(n);
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
  const returnType = retAbs ? absToTSType(retAbs, typeVars) : "unknown";
  return { typeParams, params, paramNames, paramTypes, returnType };
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

/** 契约-only 参数签名（skip / 无 case 函数 + 手写契约参数位）：具名参数 + 声明返回 */
function contractOnlySignature(
  fn: FunctionAnalysis,
  contract: DtsContractFace,
  ctx?: DtsProjectionCtx,
): MainSignature {
  const byName = contractParamMap(contract);
  const declared = declaredParams(fn);
  const slots: ParamSlot[] = [];
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
    let name = boundCovered ? `{ ${decl.bound.join(", ")} }` : sanitizeParamName(raw, i);
    if (usedNames.has(name)) {
      let n = 2;
      while (usedNames.has(`${name}${n}`)) n++;
      name = `${name}${n}`;
    }
    usedNames.add(name);
    const annotation = tsParamAnnotation(fn, i, isRest, ctx);
    const hitRender = contractParamRenderAbs(hit);
    const typeStr = hitRender
      ? contractParamType(hitRender, isRest)
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
  const params = renderParamSlots(slots);
  // 契约里多出、形参表对不上的参数名不投影（arity 谎言；check 面报
  // nudo:interface-param-mismatch，export 不执法）
  const returnType = contract.return
    ? contractReturnTSType(contract.return)
    : fn.combinedAbs
      ? absToTSType(fn.combinedAbs)
      : "unknown";
  return { params, paramNames, paramTypes, returnType };
}

/**
 * 为单个函数生成 .d.ts 投影（JSDoc + 单一 widen 主签名）。
 * 证据优先级：手写契约（contract，export CLI 从 effectiveInterface 取）
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
  const ctx: DtsProjectionCtx = { ...(surface ? { surface } : {}), typeRefs: new Set(), dropped: [] };
  const proj = withBrandScope(brandScopeOf(surface), () =>
    projectFunctionDtsInner(fn, contract, ctx),
  );
  const typeRefs = [...(ctx.typeRefs ?? [])];
  const ledger = (ctx.dropped ?? []).map(
    (n) =>
      `// nudo:dropped-type-annotation ${n} — type not declared in this module (falls back to the observed type)`,
  );
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
    const tparams =
      hofSig.typeParams.length > 0 ? `<${hofSig.typeParams.join(", ")}>` : "";
    lines.push(
      ...dtsExportDeclaration(
        form,
        `${tparams}(${hofSig.params.join(", ")}): ${returnType}`,
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
      return {
        lines: dtsExportDeclaration(form, `(${sig.params.join(", ")}): ${sig.returnType}`),
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
    // ⇒ 与 check 同源：产物面投影成 `any`。
    return {
      lines: dtsExportDeclaration(form, `(...args: unknown[]): any`),
      params: [],
    };
  }

  const sig = computeMainSignature(fn, contract, ctx);
  const jsdoc = generateJSDoc(fn, sig);
  const lines: string[] = [];
  if (jsdoc) lines.push(jsdoc);
  lines.push(...dtsExportDeclaration(form, `(${sig.params.join(", ")}): ${sig.returnType}`));
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

/** 类声明面（源码形状：成员名 + 构造器形参） */
export interface DtsClassSurface {
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
  /** 实例方法（名 + 形参名，源码序） */
  instanceMethods: Array<{ name: string; params: string[] }>;
  /** 静态方法（名 + 形参名，源码序） */
  staticMethods: Array<{ name: string; params: string[] }>;
  /** 构造器形参名（无显式构造器 ⇒ undefined ⇒ 不发构造器声明） */
  ctorParams?: string[];
  /**
   * BUG-168：源码声明的**类型形参名**（`class Box<T>` ⇒ `["T"]`）。
   *
   * 缺了类型形参槽，泛型类只能发射成裸类名 ⇒ 消费端 `new Box<string>(…)`
   * 报 TS2558（"Expected 0 type arguments"）——实现允许的调用被产物判非法。
   */
  typeParams?: string[];
  /**
   * BUG-151：超类的**本地名**（`class B extends A` ⇒ `"A"`）。
   *
   * 缺了 extends 子句 ⇒ 产物的继承链整条断掉 ⇒ 消费端 TS2339（继承成员不可见）
   * + TS2741（子类不可赋给父类）——运行时成员全在，两条都是假红。
   * 只在**产物里可解析**的类名上采集（否则 `extends Unknown` 是 TS2304）。
   */
  superClass?: string;
  /**
   * 实例字段（BUG-151）：构造器里的 `this.x = …` 与类属性初始化器。
   *
   * 分析面对 `class C` 绑定给出的 brand 是**构造器面**（实例形状只有 `name`）
   * ⇒ 实例字段只能从源码面采集；类型取初始化器的基类型（字面量 → number /
   * string / boolean，其余 `unknown`——声明面有字段但类型不猜）。
   */
  instanceFields?: Array<{ name: string; type: string }>;
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
  /** 导入形态：具名（`import type { X } from "…"`）/ 默认（`import type X from "…"`） */
  kind: "named" | "default";
}

/** 模块导出面（源文件的导出面：导出名 → 本地绑定 + 类面 + 再导出 + 导入面） */
export interface DtsModuleSurface {
  /** 导出名 → 本地绑定名（CJS 槽 / 匿名 default / 再导出 ⇒ "" = 无本地绑定） */
  exportBindings: Map<string, string>;
  /** 再导出语句（`export * from "x"` / `export { a as b } from "x"`） */
  reexports: string[];
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

/** 形参名列表（Identifier / RestElement / AssignmentPattern / 模式 → argN） */
function surfaceParamNames(params: SurfaceNode[] | undefined): string[] {
  return (params ?? []).map((p, i) => {
    if (p.type === "Identifier" && typeof p.name === "string") return p.name;
    if (p.type === "RestElement") {
      const arg = p.argument as SurfaceNode | undefined;
      const n = surfaceName(arg);
      return n ? `...${n}` : `...arg${i}`;
    }
    if (p.type === "AssignmentPattern") {
      const n = surfaceName(p.left as SurfaceNode | undefined);
      return n ?? `arg${i}`;
    }
    if (p.type === "TSParameterProperty") {
      const inner = p.parameter as SurfaceNode | undefined;
      const n = inner ? surfaceParamNames([inner])[0] : undefined;
      return n ?? `arg${i}`;
    }
    return `arg${i}`;
  });
}

/** 类成员节点 → 其函数节点（estree MethodDefinition.value / Babel ClassMethod） */
function surfaceMemberFn(member: SurfaceNode): SurfaceNode {
  if (member.type === "MethodDefinition") {
    return (member.value as SurfaceNode | undefined) ?? member;
  }
  return member;
}

/**
 * 类声明面扫描（实例方法 / 静态方法 / 构造器形参 / 类型形参 / 超类）。
 *
 * `isResolvable` = 「该名字在产物里可解析」判据（本地类 / import / TS 全局名）：
 * 只有可解析的超类名才进产物（`extends Unknown` 会产出 TS2304）。
 */
function scanClassSurface(
  decl: SurfaceNode,
  isResolvable: (name: string) => boolean = () => false,
): {
  instanceMethods: Array<{ name: string; params: string[] }>;
  staticMethods: Array<{ name: string; params: string[] }>;
  ctorParams?: string[];
  typeParams?: string[];
  superClass?: string;
  instanceFields?: Array<{ name: string; type: string }>;
} {
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
  // BUG-151：超类（`class B extends A`）——只在可解析的名字上采集。
  const superName = surfaceName(decl.superClass as SurfaceNode | undefined);
  const superClass = superName && isResolvable(superName) ? superName : undefined;
  const instanceMethods: Array<{ name: string; params: string[] }> = [];
  const staticMethods: Array<{ name: string; params: string[] }> = [];
  let ctorParams: string[] | undefined;
  /** BUG-151：实例字段（构造器 `this.x = …` 与类属性初始化器） */
  const instanceFields: Array<{ name: string; type: string }> = [];
  const fieldNames = new Set<string>();
  const addField = (name: string, init: SurfaceNode | undefined): void => {
    if (fieldNames.has(name)) return;
    fieldNames.add(name);
    instanceFields.push({ name, type: classFieldType(init) });
  };
  /** 类体里的 `this.<k> = <expr>`（含嵌套语句块） */
  const collectThisAssignments = (node: SurfaceNode | undefined): void => {
    if (!node || typeof node !== "object") return;
    if (node.type === "AssignmentExpression" || node.type === "AssignmentPattern") {
      const left = node.left as SurfaceNode | undefined;
      const obj = left?.object as SurfaceNode | undefined;
      if (left?.type === "MemberExpression" && obj?.type === "ThisExpression") {
        const key = surfaceName(left.property as SurfaceNode | undefined);
        if (key) addField(key, node.right as SurfaceNode | undefined);
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
  for (const raw of body) {
    const mem = raw as SurfaceNode & { kind?: string; static?: boolean; value?: SurfaceNode };
    // 类属性（`x = 1` / `x;`）——源码面字段。
    if (
      (mem.type === "ClassProperty" ||
        mem.type === "PropertyDefinition" ||
        mem.type === "ClassPrivateProperty" ||
        mem.type === "ClassAccessorProperty") &&
      mem.static !== true
    ) {
      const key = surfaceName(mem.key as SurfaceNode | undefined);
      if (key) addField(key, mem.value as SurfaceNode | undefined);
      continue;
    }
    const isMethod =
      mem.type === "MethodDefinition" ||
      mem.type === "ClassMethod" ||
      mem.type === "TSDeclareMethod";
    if (!isMethod) continue;
    const kind = mem.kind ?? "method";
    const keyName = surfaceName(mem.key as SurfaceNode | undefined);
    if (!keyName) continue;
    const fnNode = surfaceMemberFn(mem);
    const params = surfaceParamNames(fnNode.params as SurfaceNode[] | undefined);
    if (kind === "constructor") {
      if (ctorParams === undefined) ctorParams = params;
      // 构造器里的 `this.x = …` ⇒ 实例字段（含嵌套语句块与 super() 之后的赋值）
      collectThisAssignments(fnNode.body as SurfaceNode | undefined);
      continue;
    }
    // getter / setter 不是可调用入口（与 sidecar 键口径一致）
    if (kind !== "method") continue;
    if (mem.static) staticMethods.push({ name: keyName, params });
    else instanceMethods.push({ name: keyName, params });
  }
  return {
    instanceMethods,
    staticMethods,
    ...(ctorParams !== undefined ? { ctorParams } : {}),
    ...(typeParams.length > 0 ? { typeParams } : {}),
    ...(superClass !== undefined ? { superClass } : {}),
    ...(instanceFields.length > 0 ? { instanceFields } : {}),
  };
}

/**
 * enum 成员初始化器 → 字面量文本（BUG-190）。
 *
 * 只投影**字面量**（字符串 / 数字 / 负数）：声明面不猜表达式求值结果
 * （`A = other.length` 这类保持无名成员，语义仍可用）。字符串枚举的成员类型
 * 是字面量类型 ⇒ 丢掉 `= "a"` 会把成员降级成数值 enum。
 */
function enumInitText(node: SurfaceNode | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "StringLiteral") {
    return typeof node.value === "string" ? JSON.stringify(node.value) : undefined;
  }
  if (node.type === "NumericLiteral") {
    return typeof node.value === "number" ? String(node.value) : undefined;
  }
  if (node.type === "UnaryExpression" && node.operator === "-") {
    const arg = node.argument as SurfaceNode | undefined;
    if (arg?.type === "NumericLiteral" && typeof arg.value === "number") {
      return `-${String(arg.value)}`;
    }
  }
  return undefined;
}

/**
 * 类字段初始化器 → dts 类型串（BUG-151）。
 *
 * 只映射**初始化器的形状**（字面量 → 基类型、数组 / 对象 → 宽类型）；表达式
 * 一律 `unknown`（声明面有该字段，但类型不猜——与入口无约束参数的口径一致）。
 */
function classFieldType(init: SurfaceNode | undefined): string {
  if (!init) return "unknown";
  switch (init.type) {
    case "NumericLiteral":
      return "number";
    case "StringLiteral":
    case "TemplateLiteral":
      return "string";
    case "BooleanLiteral":
      return "boolean";
    case "ArrayExpression":
      return "unknown[]";
    case "ObjectExpression":
    case "NewExpression":
      return "object";
    case "NullLiteral":
      // `state = null` —— TS 对类字段的推断就是 `null`（不是 any/unknown）
      return "null";
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
        const t = surfaceParamType(source, id).slice(2) || "unknown";
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
      return [`export function ${name}(${params.join(", ")}): ${ret};`];
    }
    case "ClassDeclaration": {
      const name = surfaceName(decl.id as SurfaceNode | undefined);
      return name ? [`export class ${name} {}`] : [];
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
  };
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
  /** `module.exports` / `exports` → true */
  const isExportsTarget = (n: SurfaceNode | undefined): boolean => {
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
  const addClass = (decl: SurfaceNode | null | undefined): void => {
    if (decl?.type !== "ClassDeclaration") return;
    const id = surfaceName(decl.id as SurfaceNode | undefined);
    if (id && !classDecls.has(id)) classDecls.set(id, decl);
  };
  for (const stmt of body) {
    if (stmt.type === "ClassDeclaration") {
      addClass(stmt);
      continue;
    }
    if (stmt.type === "ExportNamedDeclaration") {
      addClass(stmt.declaration as SurfaceNode | null | undefined);
      continue;
    }
    if (stmt.type === "ExportDefaultDeclaration") {
      addClass(stmt.declaration as SurfaceNode | null | undefined);
    }
  }

  // ── 导入面（Bug 233：brand 类名来自别的模块 ⇒ 产物里要能解析那个名字）──
  // 具名导入按**导出名**记（`import { X as Y }` ⇒ 键 "X"——补 import 用导出名）；
  // 默认导入按**本地名**记；命名空间导入不能当类型名 ⇒ 不收。
  const imports = surface.imports ?? new Map<string, DtsImportSurface>();
  for (const stmt of body) {
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
      if (spec.type !== "ImportSpecifier") continue; // 命名空间导入不能当类型名
      const exported = surfaceName(spec.imported as SurfaceNode | undefined);
      if (!exported) continue;
      if (!imports.has(exported)) {
        imports.set(exported, { specifier, kind: "named" });
      }
    }
  }

  // ── 导出名表 + 再导出语句 ──
  for (const stmt of body) {
    if (stmt.type === "ExportAllDeclaration") {
      // `export * from "x"` / `export * as ns from "x"`（Babel：独立节点）
      const from = stmt.source as SurfaceNode | undefined;
      const src = JSON.stringify(String(from?.value ?? ""));
      const ns = surfaceName(stmt.exported as SurfaceNode | undefined);
      if (ns) {
        surface.reexports.push(`export * as ${ns} from ${src};`);
        bind(ns, "");
      } else {
        surface.reexports.push(`export * from ${src};`);
      }
      continue;
    }
    if (stmt.type === "ExportNamedDeclaration") {
      const from = stmt.source as SurfaceNode | undefined;
      const specs = (stmt.specifiers as SurfaceNode[] | undefined) ?? [];
      if (from) {
        // 再导出：`export * from` / `export { a as b } from` / `export * as ns from`
        const src = JSON.stringify(String(from.value ?? ""));
        if (specs.length === 0) {
          surface.reexports.push(`export * from ${src};`);
          continue;
        }
        const parts: string[] = [];
        for (const spec of specs) {
          if (spec.type === "ExportNamespaceSpecifier") {
            const ns = surfaceName(spec.exported as SurfaceNode | undefined);
            if (!ns) continue;
            parts.push(`* as ${ns}`);
            bind(ns, "");
            continue;
          }
          if (spec.type !== "ExportSpecifier") continue;
          const local = surfaceName(spec.local as SurfaceNode | undefined);
          const exported = surfaceName(spec.exported as SurfaceNode | undefined);
          if (!exported) continue;
          bind(exported, "");
          parts.push(local && local !== exported ? `${local} as ${exported}` : exported);
        }
        if (parts.length > 0) {
          surface.reexports.push(`export { ${parts.join(", ")} } from ${src};`);
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
        } else if (decl.type === "VariableDeclaration") {
          for (const d of (decl.declarations as SurfaceNode[] | undefined) ?? []) {
            const id = surfaceName(d.id as SurfaceNode | undefined);
            if (id) bind(id, id);
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
        bind("default", surfaceName(decl.id as SurfaceNode | undefined) ?? "");
        continue;
      }
      if (decl.type === "Identifier") {
        bind("default", surfaceName(decl) ?? "");
        continue;
      }
      bind("default", "");
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
        continue;
      }
      if (!isExportsTarget(left)) continue;
      if (right.type === "ObjectExpression") {
        for (const p of (right.properties as SurfaceNode[] | undefined) ?? []) {
          const key = surfaceName(p.key as SurfaceNode | undefined);
          if (key && key !== "default") bind(key, key);
        }
        continue;
      }
      if (right.type === "Identifier") {
        const n = surfaceName(right);
        if (n) bind(n, n);
        continue;
      }
      bind("default", "");
    }
  }

  // ── 模块级值声明（BUG-190）──
  // `export const/let/var` 与 TS `enum` 在导出名表里已登记，但旧实现只发射
  // 函数与类 ⇒ 这些绑定**被登记但从不落地** ⇒ 发布的 `.d.ts` 里没有它们
  // ⇒ 消费端 `import { VERSION }` 报 TS2305，而运行时确实有该导出。
  // 这里只采集**声明形态**（种类 + enum 成员名）；值的类型来自分析面绑定
  // （`projectModuleDts` 的 `values` 实参）。
  const noteValueDecl = (decl: SurfaceNode | null | undefined): void => {
    if (!decl) return;
    if (decl.type === "VariableDeclaration") {
      const raw = String(decl.kind ?? "");
      const kind = raw === "const" || raw === "var" ? raw : "let";
      for (const d of (decl.declarations as SurfaceNode[] | undefined) ?? []) {
        const id = surfaceName(d.id as SurfaceNode | undefined);
        if (id && !surface.values.has(id)) surface.values.set(id, { kind });
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
      const enumMembers = members
        .map((m) => {
          const name =
            surfaceName(m.id as SurfaceNode | undefined) ??
            surfaceName(m.key as SurfaceNode | undefined);
          if (!name) return undefined;
          const init = enumInitText(m.initializer as SurfaceNode | undefined);
          return init !== undefined ? { name, init } : { name };
        })
        .filter((m): m is { name: string; init?: string } => m !== undefined);
      surface.values.set(id, { kind: "enum", enumMembers });
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

  // ── 类面（导出名 + 成员） ──
  // 可解析判据：本地类 / 已 import 的名字 / TS 全局构造器名（与 `brandTSType`
  // 同一口径）——只在这种名字上放行 `extends`。
  const isResolvableName = (name: string): boolean =>
    classDecls.has(name) || imports.has(name) || isRuntimeGlobalCtorName(name);
  for (const [local, decl] of classDecls) {
    const scanned = scanClassSurface(decl, isResolvableName);
    // BUG-189：一个本地绑定可同时是具名导出与 default 导出 ⇒ 全部记下，
    // 主形态取第一个（具名优先），其余在声明后逐条补 `export { … as … }`。
    const exportNames = dtsExportNamesOf(surface, local);
    const exportName = exportNames[0];
    surface.classes.set(local, {
      ...scanned,
      ...(exportName !== undefined ? { exportName } : {}),
      ...(exportNames.length > 0 ? { exportNames } : {}),
      isDefault: exportName === "default",
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

/** 声明行（按导出形态；`signature` = `(<params>): <ret>`，可含类型参数） */
function dtsExportDeclaration(form: DtsExportForm, signature: string): string[] {
  switch (form.kind) {
    case "named":
      return [
        `export declare function ${form.exportName}${signature};`,
        ...dtsExtraExportLines(form.exportName, form.extras),
      ];
    case "member":
      return [`${form.memberName}${signature};`];
    case "default":
      return form.localName
        ? [
            `export default function ${form.localName}${signature};`,
            ...dtsExtraExportLines(form.localName, form.extras),
          ]
        : [`export default function ${signature};`];
    case "alias":
      return [
        `declare function ${form.localName}${signature};`,
        `export { ${form.localName} as ${form.exportNameRepr} };`,
        ...dtsExtraExportLines(form.localName, form.extras),
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
  /** 类名 → 实例方法声明（分析面） */
  const members = new Map<string, Array<{ member: string; lines: string[] }>>();
  /** brand 类名 → brand Abs（实例形状 → 字段） */
  const brands = new Map<string, Abs>();
  /** 注解原文引用到的 import 名（BUG-168：补 `import type` 用） */
  const annotationRefs = new Set<string>();

  for (const { fn, projection, contract } of entries) {
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
  const classNames = new Set<string>(members.keys());
  if (surface) {
    for (const [local, cls] of surface.classes) {
      if (cls.exportName !== undefined) classNames.add(local);
    }
    for (const name of brands.keys()) {
      if (surface.classes.has(name)) classNames.add(name);
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
  const classFields = new Map<string, Array<{ name: string; type: string }>>();
  const resolving = new Set<string>();
  const fieldsOf = (className: string): Array<{ name: string; type: string }> => {
    const cached = classFields.get(className);
    if (cached) return cached;
    if (resolving.has(className)) return []; // 自引用（非法继承）⇒ 停止
    resolving.add(className);
    const memberNames = new Set((members.get(className) ?? []).map((m) => m.member));
    const out: Array<{ name: string; type: string }> = [];
    const seen = new Set<string>();
    // brand 字段优先（分析面观测，更精确）
    for (const f of brandFieldLines(brands.get(className), memberNames)) {
      if (seen.has(f.name)) continue;
      seen.add(f.name);
      out.push(f);
    }
    const cls = surface?.classes.get(className);
    for (const f of cls?.instanceFields ?? []) {
      if (seen.has(f.name)) continue;
      if (memberNames.has(f.name)) continue; // 与实例方法同名 ⇒ 方法是权威
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
    lines.push(
      ...dtsClassDeclaration(
        className,
        surface?.classes.get(className),
        members.get(className) ?? [],
        fieldsOf(className),
        // BUG-151：`extends <base>`——基类泛型时补 `any` 实参（TS2314：泛型基类
        // 缺类型实参会让整份产物编译不过）。
        superClauseText(className, surface),
      ),
    );
  }

  // ── 模块级值声明（BUG-190）──
  // 已作为函数 / 类声明发射的本地绑定不再发值声明（`export const f = () => …`
  // 被分析成函数；再发一条 `declare const f` 就是 TS2300 Duplicate identifier）。
  const declaredLocals = new Set<string>(entries.map((e) => e.fn.name));
  lines.push(...dtsValueDeclarations(surface, values, declaredLocals));

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

  // ── Bug 233：brand 引用的类来自 import ⇒ 补 import type（否则 TS2304）──
  const importLines: string[] = [];
  if (surface?.imports) {
    for (const [name, imp] of surface.imports) {
      // 只为**被引用**的名字补 import：brand 类名（Bug 233）或注解原文引用的
      // 类型名（BUG-168：注解放行的前提是它在产物里可解析）。
      if (!brands.has(name) && !annotationRefs.has(name)) continue;
      if (surface.classes.has(name)) continue; // 本地已声明 ⇒ 走 declare class
      const src = JSON.stringify(imp.specifier);
      importLines.push(
        imp.kind === "default"
          ? `import type ${name} from ${src};`
          : `import type { ${name} } from ${src};`,
      );
    }
  }

  // ── Bug 233：不可解析的类名（降级为 unknown）——台账（可诊断） ──
  // 判据与 `brandTSType` 同款（内建泛型 / 模块面可解析 / TS 全局类型名 ⇒ 不降级）。
  const scope = brandScopeOf(surface);
  const unresolved = [...brands.keys()].filter(
    (name) =>
      !BUILTIN_GENERIC_BRANDS.has(name) &&
      !scope.has(name) &&
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

/** 类声明行（导出形态 + 类型形参 + 超类 + 构造器 + 实例方法 + 静态方法 + 实例字段） */
function dtsClassDeclaration(
  className: string,
  cls: DtsClassSurface | undefined,
  memberList: Array<{ member: string; lines: string[] }>,
  fields: Array<{ name: string; type: string }>,
  superText = "",
): string[] {
  const body: string[] = [];
  const methodNames = new Set<string>();
  // 构造器（源码面：形参名已知，类型未知）
  if (cls?.ctorParams) {
    const params = cls.ctorParams.map((p, i) => classParamDecl(p, i)).join(", ");
    body.push(`constructor(${params});`);
  }
  // 实例方法（分析面）
  for (const m of memberList) {
    methodNames.add(m.member);
    for (const l of m.lines) body.push(...l.split("\n"));
  }
  // 静态方法（源码面：形参名已知，类型未知）
  for (const m of cls?.staticMethods ?? []) {
    const params = m.params.map((p, i) => classParamDecl(p, i)).join(", ");
    body.push(`static ${m.name}(${params}): unknown;`);
  }
  // 实例字段（brand 实例形状 ∪ 构造器赋值——见 projectModuleDtsInner 的 fieldsOf）
  for (const f of fields) {
    if (methodNames.has(f.name)) continue;
    body.push(`${formatPropKey(f.name)}: ${f.type};`);
  }
  // BUG-168：类型形参槽（`class Box<T>`）——缺了它消费端 `new Box<string>(…)`
  // 报 TS2558（"Expected 0 type arguments"）。
  const typeParams = cls?.typeParams ?? [];
  const typeParamsText = typeParams.length > 0 ? `<${typeParams.join(", ")}>` : "";
  const inner =
    body.length > 0
      ? `\n${body.map((l) => (l.trim() === "" ? l : `  ${l}`)).join("\n")}\n`
      : "";
  const header = `${className}${typeParamsText}${superText}`;
  const exportNames =
    cls?.exportNames ?? (cls?.exportName !== undefined ? [cls.exportName] : []);
  const exportName = exportNames[0];
  // BUG-189：同一个类可同时是具名导出与 default 导出 ⇒ 主声明之后逐条补
  // `export { C as <name> };`（旧实现只发一个名字 ⇒ default 导出消失）。
  const extras = exportNames
    .slice(1)
    .map((n) => `export { ${className} as ${exportNameRepr(n)} };`);
  if (exportName === undefined) return [`declare class ${header} {${inner}}`];
  if (exportName === "default") return [`export default class ${header} {${inner}}`, ...extras];
  if (exportName === className) return [`export declare class ${header} {${inner}}`, ...extras];
  return [
    `declare class ${header} {${inner}}`,
    `export { ${className} as ${exportNameRepr(exportName)} };`,
    ...extras,
  ];
}

/**
 * 类声明的超类子句（BUG-151）：` extends A`；基类是泛型 ⇒ 补 `any` 实参
 * （TS2314：泛型基类缺类型实参会让整份产物编译不过）。
 */
function superClauseText(
  className: string,
  surface: DtsModuleSurface | undefined,
): string {
  const superName = surface?.classes.get(className)?.superClass;
  if (!superName) return "";
  const builtin = BUILTIN_GENERIC_BRANDS.get(superName);
  if (builtin !== undefined) return ` extends ${builtin}`;
  const baseParams = surface?.classes.get(superName)?.typeParams ?? [];
  const args = baseParams.length > 0 ? `<${baseParams.map(() => "any").join(", ")}>` : "";
  return ` extends ${superName}${args}`;
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
): string[] {
  if (!surface) return [];
  const out: string[] = [];
  for (const [local, value] of surface.values) {
    const names = dtsExportNamesOf(surface, local);
    const primary = names[0];
    if (primary === undefined) continue; // 未导出 ⇒ 不在公开面
    // 已被模块级函数声明占用（`export const f = () => …` 被分析成函数）⇒
    // 再发一条值声明会产出 TS2300（Duplicate identifier）。
    if (declaredLocals.has(local)) continue;
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
      decl = `declare enum ${local} {${body ? `\n${body}\n` : ""}}`;
    } else {
      if (abs === undefined) {
        out.push(
          `// nudo:unresolved-value ${local} — no analysis binding (projected as unknown)`,
        );
      }
      const typeText = abs ? absToTSType(widenTopLevelAbs(abs)) : "unknown";
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
 * 类形参声明（构造器 / 静态方法）。
 *
 * BUG-003：这里曾是**硬编码 `unknown`** —— 与 `CLAUDE.md` 的分面约定相悖
 * （入口**无约束**形参应显示 `any`；真正的 `unknown` 表示**推断失败**），
 * 也与同一文件上 `nudo check` 的签名面（`Widget(w: any, h: any)`）矛盾。
 * 构造器 / 静态方法的形参**没有任何类型证据**（分析面不产出其 Abs）⇒ 按
 * 「无约束 ⇒ any」投影（与 dts 参数位的无证据口径一致）。
 *
 * 遗留（已上报）：实例方法 / 静态方法的**返回类型**仍落在 `unknown` ——
 * 类成员通道只吃 case / combinedAbs 证据，而分析面对类成员给出的
 * `combinedAbs` 就是 `unknown`（证据通道在 analyzer 侧，不在本文件可修范围）。
 */
function classParamDecl(name: string, index: number): string {
  const safe = sanitizeParamName(name, index);
  return safe.startsWith("...") ? `${safe}: any[]` : `${safe}: any`;
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
