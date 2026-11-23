/**
 * dts 声明 IR · 类型节点 + 打印器。
 *
 * 第一切片只覆盖**无需引擎上下文**的类型：prim / 字面量 / array / tuple /
 * union / never / unknown。遇到 obj / brand / fn / eff / 模板 / 类型变量 /
 * 收窄 pred 时返回 undefined，由调用方回落到既有 `absToTSType`。
 *
 * 这样新路径可以逐步接管简单返回 / 参数类型，而不在一次改动里重写 8.5k 行
 * 渲染器。
 */
import {
  extStateOf,
  litValue,
  lookupObjAccessor,
  termEquals,
  type Abs,
  type LiteralValue,
} from "@nudojs/core";
import {
  escapeTemplateTypeFixed,
  formatObjectKey,
  isJsBindingIdent,
  isTemplateLike,
  templatePartsOf,
} from "@nudojs/core/internal";
import { isHiddenInternalSlot } from "./internal-slot.ts";

/** 引擎的符号键投影（`"@@X"`）→ TS 符号键成员名。 */
export const WELL_KNOWN_SYMBOLS = new Map<string, string>([
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

/** brand 名 → TS 类型别名（Arguments 等）。 */
export const BRAND_TYPE_ALIASES = new Map<string, string>([["Arguments", "IArguments"]]);

/** 内建泛型 brand → 带占位实参的 TS 类型（TS2314 防护）。 */
export const BUILTIN_GENERIC_BRANDS = new Map<string, string>([
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

export type DtsObjectSlot = {
  key: string;
  type: DtsType;
  optional?: boolean;
  readonly?: boolean;
  /** `key` 是 `Symbol.x`（打印 `[Symbol.x]` 成员） */
  symbol?: boolean;
};

export type DtsType =
  | { kind: "prim"; name: string }
  | { kind: "literal"; text: string }
  | { kind: "never" }
  | { kind: "unknown" }
  | { kind: "array"; element: DtsType; readonly?: boolean }
  | {
      kind: "tuple";
      elements: DtsType[];
      holes?: readonly number[];
      rest?: DtsType;
      readonly?: boolean;
    }
  | {
      kind: "object";
      slots: DtsObjectSlot[];
      /** 索引签名（`[key: K]: V`） */
      index?: { key: DtsType; value: DtsType };
      /** 零成员对象：closed ⇒ never；open ⇒ unknown */
      empty?: "never" | "unknown";
    }
  | { kind: "intersection"; members: DtsType[] }
  | { kind: "generic"; name: string; args: DtsType[] }
  | { kind: "named"; text: string }
  | { kind: "raw"; text: string }
  | { kind: "template"; parts: Array<{ fixed?: string; type?: DtsType }> }
  | {
      kind: "fn";
      params: Array<{ name: string; type: DtsType }>;
      returnType: DtsType;
    }
  | {
      kind: "overloads";
      arms: Array<{ paramTypes: DtsType[]; returnType: DtsType }>;
    }
  | { kind: "union"; members: DtsType[] };

export type DtsBrandScope = {
  /** 产物里可解析的类名 */
  names: ReadonlySet<string>;
  /** 类名 → 必填类型形参占位实参 */
  requiredArgFillers: ReadonlyMap<string, readonly string[]>;
};

export type DtsTypeOpts = {
  /** `as const` 通道下的值整体只读（与 absToTSType 的全局开关同口径） */
  readonlyValues?: boolean;
  /** 模块投影作用域；缺省 = 纯投影（类名原样保留） */
  brandScope?: DtsBrandScope;
  /** TS 全局构造器名判定（有作用域时用于保留 Date/RegExp 等） */
  runtimeGlobalCtor?: (name: string) => boolean;
  /** 类型变量名映射（α / B:param → 稳定 TS 名） */
  typeVars?: ReadonlyMap<string, string>;
  /** 对象方法返回注解原文（应用在返回位；源码声明优先） */
  objectFnReturnOverrides?: ReadonlyMap<string, string>;
  /** symbol 方法的返回注解原文（无 Abs 返回位时兜底） */
  symbolReturnOverrides?: ReadonlyMap<string, string>;
  /** @internal 递归环检测（DESIGN-001：Abs 允许成环） */
  seen?: Set<Abs>;
};

/**
 * Abs → DtsType；返回 undefined = 本切片不负责，调用方回落。
 *
 * 保守条件：任何非字面量 term、任何收窄 pred、类型变量都直接放弃；宁可走
 * 旧渲染器，也不让新打印器输出与旧产物不同的文本。
 */
export function dtsTypeOfAbs(a: Abs, opts: DtsTypeOpts = {}): DtsType | undefined {
  const seen = opts.seen ?? new Set<Abs>();
  if (seen.has(a)) return undefined;
  seen.add(a);
  try {
    return dtsTypeOfAbsInner(a, { ...opts, seen });
  } finally {
    seen.delete(a);
  }
}

function dtsTypeOfAbsInner(a: Abs, opts: DtsTypeOpts): DtsType | undefined {
  // 类型变量：shape any + term var（α / B:param）。
  if (a.shape.k === "any" && a.term?.op === "var") {
    const mapped = opts.typeVars?.get(a.term.id);
    if (mapped !== undefined) return { kind: "raw", text: mapped };
  }
  // 模板字面量类型：pred 承载 parts，必须先于「收窄 pred ⇒ 回落」处理。
  if (a.shape.k === "prim" && a.shape.type === "string" && isTemplateLike(a)) {
    const parts: Array<{ fixed?: string; type?: DtsType }> = [];
    for (const p of templatePartsOf(a)) {
      const lv = litValue(p);
      if (lv.ok && typeof lv.value === "string") {
        parts.push({ fixed: escapeTemplateTypeFixed(lv.value) });
      } else {
        const t = dtsTypeOfAbs(p, opts);
        if (t === undefined) return undefined;
        parts.push({ type: t });
      }
    }
    return { kind: "template", parts };
  }
  if (a.pred !== undefined && a.pred.op !== "true") return undefined;
  if (a.term !== undefined && a.term.op !== "lit") return undefined;

  if (a.term?.op === "lit") {
    const v = a.term.value;
    if (v === null) return { kind: "literal", text: "null" };
    if (v === undefined) return { kind: "literal", text: "undefined" };
    if (a.shape.k === "prim") {
      if (typeof v === "string") return { kind: "literal", text: JSON.stringify(v) };
      if (typeof v === "boolean") return { kind: "literal", text: String(v) };
      if (typeof v === "number") {
        return Number.isFinite(v)
          ? { kind: "literal", text: String(v) }
          : { kind: "prim", name: "number" };
      }
      if (typeof v === "bigint") return { kind: "prim", name: "bigint" };
    }
  }

  switch (a.shape.k) {
    case "never":
      return { kind: "never" };
    case "unknown":
      return { kind: "unknown" };
    case "any":
      // nudo any 在 TS 投影面 = unknown（ABS-03 产品裁定）。
      return { kind: "unknown" };
    case "prim":
      return { kind: "prim", name: a.shape.type };
    case "arr": {
      const element = dtsTypeOfAbs(a.shape.element, opts);
      return element === undefined
        ? undefined
        : {
            kind: "array",
            element,
            ...(opts.readonlyValues || isFrozen(a) ? { readonly: true } : {}),
          };
    }
    case "tuple": {
      const elements: DtsType[] = [];
      for (const el of a.shape.elements) {
        const t = dtsTypeOfAbs(el, opts);
        if (t === undefined) return undefined;
        elements.push(t);
      }
      let rest: DtsType | undefined;
      if (a.shape.rest) {
        rest = dtsTypeOfAbs(a.shape.rest, opts);
        if (rest === undefined) return undefined;
      }
      return {
        kind: "tuple",
        elements,
        ...(a.shape.holes?.length ? { holes: [...a.shape.holes] } : {}),
        ...(rest ? { rest } : {}),
        ...(opts.readonlyValues || isFrozen(a) ? { readonly: true } : {}),
      };
    }
    case "eff": {
      const inner = dtsTypeOfAbs(a.shape.inner, opts);
      if (inner === undefined) return undefined;
      return a.shape.eff === "promise"
        ? { kind: "generic", name: "Promise", args: [inner] }
        : inner;
    }
    case "brand": {
      const name = a.shape.name;
      const alias = BRAND_TYPE_ALIASES.get(name);
      if (alias !== undefined) return { kind: "named", text: alias };
      const builtin = BUILTIN_GENERIC_BRANDS.get(name);
      if (builtin !== undefined) return { kind: "named", text: builtin };
      if (!isJsBindingIdent(name) && !/^[A-Z][A-Za-z0-9_$]*$/.test(name)) {
        return { kind: "unknown" };
      }
      const scope = opts.brandScope;
      if (scope === undefined) return { kind: "named", text: name };
      if (scope.names.has(name)) {
        const fillers = scope.requiredArgFillers.get(name);
        return {
          kind: "named",
          text: fillers && fillers.length > 0 ? `${name}<${fillers.join(", ")}>` : name,
        };
      }
      if (opts.runtimeGlobalCtor?.(name) === true) return { kind: "named", text: name };
      return { kind: "unknown" };
    }
    case "fn": {
      if (a.shape.overloads !== undefined && a.shape.overloads.length > 0) {
        const arms: Array<{ paramTypes: DtsType[]; returnType: DtsType }> = [];
        for (const arm of a.shape.overloads) {
          const paramTypes: DtsType[] = [];
          for (const pt of arm.paramTypes) {
            const t = dtsTypeOfAbs(pt, opts);
            if (t === undefined) return undefined;
            paramTypes.push(t);
          }
          const returnType = dtsTypeOfAbs(arm.returnType, opts);
          if (returnType === undefined) return undefined;
          arms.push({ paramTypes, returnType });
        }
        return { kind: "overloads", arms };
      }
      const params: Array<{ name: string; type: DtsType }> = [];
      const names = a.shape.params ?? [];
      for (let i = 0; i < names.length; i++) {
        const raw = names[i] ?? `arg${i}`;
        const isRest = raw.startsWith("...");
        const pt = a.shape.paramTypes?.[i];
        if (pt) {
          const t = dtsTypeOfAbs(pt, opts);
          if (t === undefined) return undefined;
          params.push({
            name: sanitizeFnParam(raw, i),
            type: isRest && pt.shape.k !== "arr" ? { kind: "array", element: t } : t,
          });
        } else {
          params.push({
            name: sanitizeFnParam(raw, i),
            type: isRest ? { kind: "array", element: { kind: "unknown" } } : { kind: "unknown" },
          });
        }
      }
      const returnType = a.shape.returnType
        ? dtsTypeOfAbs(a.shape.returnType, opts)
        : { kind: "unknown" as const };
      if (returnType === undefined) return undefined;
      return { kind: "fn", params, returnType };
    }
    case "sum": {
      const members: DtsType[] = [];
      for (const m of a.shape.members) {
        const t = dtsTypeOfAbs(m, opts);
        if (t === undefined) return undefined;
        members.push(t);
      }
      return { kind: "union", members };
    }
    case "obj": {
      const entries = Object.entries(a.shape.slots);
      if (a.shape.view !== undefined) {
        if (a.shape.view !== "array") return undefined;
        const idxs = entries
          .map(([k]) => k)
          .filter((k) => CANONICAL_INDEX.test(k))
          .map(Number)
          .sort((x, y) => x - y);
        let arrayPart: DtsType;
        if (idxs.length === 0) {
          arrayPart = { kind: "array", element: { kind: "unknown" } };
        } else {
          const elements: DtsType[] = [];
          for (let i = 0; i <= idxs[idxs.length - 1]!; i++) {
            const slot = a.shape.slots[String(i)];
            if (slot === undefined) {
              elements.push({ kind: "literal", text: "undefined" });
              continue;
            }
            const t = dtsTypeOfAbs(slot.value, opts);
            if (t === undefined || t.kind === "union" || t.kind === "fn") return undefined;
            elements.push(t);
          }
          arrayPart = { kind: "tuple", elements };
        }
        const sideEntries = entries.filter(
          ([k]) => !CANONICAL_INDEX.test(k) && k !== "length",
        );
        if (sideEntries.length === 0) return arrayPart;
        const sideSlots: DtsObjectSlot[] = [];
        for (const [k, slot] of sideEntries) {
          const s = objectSlotOf(a, k, slot, opts);
          if (s === undefined) return undefined;
          sideSlots.push(s);
        }
        return {
          kind: "intersection",
          members: [arrayPart, { kind: "object", slots: sideSlots }],
        };
      }
      let index: { key: DtsType; value: DtsType } | undefined;
      if (a.shape.index !== undefined) {
        const key = dtsTypeOfAbs(a.shape.index.key, opts);
        const value = dtsTypeOfAbs(a.shape.index.value, opts);
        if (key === undefined || value === undefined) return undefined;
        index = { key, value };
      }
      if (entries.length === 0 && index === undefined) {
        return { kind: "object", slots: [], empty: a.shape.open === true ? "unknown" : "never" };
      }
      const slots: DtsObjectSlot[] = [];
      for (const [k, slot] of entries) {
        const s = objectSlotOf(a, k, slot, opts);
        if (s === undefined) return undefined;
        slots.push(s);
      }
      return { kind: "object", slots, ...(index ? { index } : {}) };
    }
    default:
      return undefined;
  }
}

/** 与 dts-generator 的形参名清洗同口径（非法标识符 → argN）。 */
function sanitizeFnParam(name: string, index: number): string {
  let optional = false;
  let base = name;
  if (base.endsWith("?")) {
    optional = true;
    base = base.slice(0, -1);
  }
  if (base.startsWith("...")) {
    const rest = base.slice(3);
    return isJsBindingIdent(rest) ? `...${rest}${optional ? "?" : ""}` : `...arg${index}`;
  }
  return isJsBindingIdent(base) ? `${base}${optional ? "?" : ""}` : `arg${index}`;
}

/** 单个对象槽 → IR 槽；符号键 / 访问器 / 方法 / 内部槽不可表达 ⇒ undefined。 */
function objectSlotOf(
  a: Abs,
  k: string,
  slot: { value: Abs; optional?: boolean; readonly?: boolean; symbolKey?: boolean },
  opts: DtsTypeOpts,
): DtsObjectSlot | undefined {
  const flags = {
    ...(slot.optional ? { optional: true } : {}),
    ...(slot.readonly === true || opts.readonlyValues ? { readonly: true } : {}),
  };
  if (slot.symbolKey === true) {
    const sym = WELL_KNOWN_SYMBOLS.get(k);
    if (sym === undefined) return undefined;
    if (slot.value.shape.k === "fn") {
      const fromAbs = slot.value.shape.returnType
        ? dtsTypeOfAbs(slot.value.shape.returnType, opts)
        : undefined;
      const override = opts.symbolReturnOverrides?.get(k);
      const ret = fromAbs ?? (override !== undefined ? { kind: "raw" as const, text: override } : { kind: "unknown" as const });
      return { key: sym, symbol: true, type: { kind: "fn", params: [], returnType: ret } };
    }
    const t = dtsTypeOfAbs(slot.value, opts);
    return t === undefined ? undefined : { key: sym, symbol: true, type: t };
  }
  if (isHiddenInternalSlot(k, slot)) return undefined;

  let source = slot.value;
  if (slot.value.term !== undefined) {
    const acc = lookupObjAccessor(a, k);
    if (acc?.get) {
      try {
        source = acc.get(a);
      } catch {
        return { key: formatObjectKey(k), type: { kind: "unknown" }, ...flags };
      }
    }
  }
  let t = contractLiteralDtsType(source) ?? dtsTypeOfAbs(source, opts);
  if (t === undefined) return undefined;
  if (t.kind === "fn") {
    const override = opts.objectFnReturnOverrides?.get(k);
    if (override !== undefined) {
      t = { ...t, returnType: { kind: "raw", text: override } };
    }
  }
  return { key: formatObjectKey(k), type: t, ...flags };
}

/** 契约字面量槽（`eq(self, lit(v))` / and / or）→ 字面量类型。 */
function contractLiteralDtsType(a: Abs): DtsType | undefined {
  if (a.shape.k === "sum") {
    const members: DtsType[] = [];
    for (const m of a.shape.members) {
      const t = contractLiteralDtsType(m);
      if (t === undefined) return undefined;
      members.push(t);
    }
    return { kind: "union", members };
  }
  if (a.term === undefined) return undefined;
  const set = predLiteralValues(a.pred, a.term);
  if (set === undefined || set.length === 0) {
    if (a.term.op === "lit" && (a.term.value === null || a.term.value === undefined)) {
      return literalDtsType(a.term.value);
    }
    return undefined;
  }
  const members: DtsType[] = [];
  const seen = new Set<string>();
  for (const v of set) {
    const t = literalDtsType(v);
    const key = renderDtsType(t);
    if (seen.has(key)) continue;
    seen.add(key);
    members.push(t);
  }
  return members.length === 1 ? members[0]! : { kind: "union", members };
}

/** pred → 字面量值集合（与 dts-generator 的 predLiteralSet 同口径）。 */
function predLiteralValues(
  p: Abs["pred"],
  self: NonNullable<Abs["term"]>,
): LiteralValue[] | undefined {
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
        const s = predLiteralValues(arg, self);
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
        const s = predLiteralValues(arg, self);
        if (s === undefined) return undefined;
        out.push(...s);
      }
      return out.length > 0 ? out : undefined;
    }
    default:
      return undefined;
  }
}

function literalDtsType(v: LiteralValue): DtsType {
  if (v === null) return { kind: "literal", text: "null" };
  if (v === undefined) return { kind: "literal", text: "undefined" };
  switch (typeof v) {
    case "string":
      return { kind: "literal", text: JSON.stringify(v) };
    case "boolean":
      return { kind: "literal", text: String(v) };
    case "number":
      return Number.isFinite(v)
        ? { kind: "literal", text: String(v) }
        : { kind: "prim", name: "number" };
    case "bigint":
      return { kind: "literal", text: `${String(v)}n` };
    default:
      return { kind: "unknown" };
  }
}

/** 规范数组下标（`0` / `12`；无前导零）。 */
const CANONICAL_INDEX = /^(?:0|[1-9]\d*)$/;

/** `Object.freeze` 的冻结侧表（与 absToTSTypeB 的 BUG-392 判据同源）。 */
function isFrozen(a: Abs): boolean {
  return a.facets?.frozen === true || extStateOf(a) === "frozen";
}

/** DtsType → TS 文本（与 absToTSType 的支持子集逐字同形）。 */
export function renderDtsType(t: DtsType): string {
  switch (t.kind) {
    case "prim":
      return t.name;
    case "literal":
      return t.text;
    case "never":
      return "never";
    case "unknown":
      return "unknown";
    case "array": {
      const el = renderDtsType(t.element);
      const needsParens = t.element.kind === "union" || t.element.kind === "fn";
      const arr = needsParens ? `(${el})[]` : `${el}[]`;
      return t.readonly ? `readonly ${arr}` : arr;
    }
    case "tuple": {
      const parts = t.elements.map((el, i) => {
        const text = renderDtsType(el);
        return t.holes?.includes(i) ? `hole: ${text}` : text;
      });
      if (t.rest) {
        const restText =
          t.rest.kind === "array"
            ? renderDtsType(t.rest)
            : t.rest.kind === "union"
              ? `(${renderDtsType(t.rest)})[]`
              : `${renderDtsType(t.rest)}[]`;
        parts.push(`...${restText}`);
      }
      return `${t.readonly ? "readonly " : ""}[${parts.join(", ")}]`;
    }
    case "object": {
      if (t.slots.length === 0 && t.index === undefined) {
        return `Record<string, ${t.empty ?? "never"}>`;
      }
      const parts = t.slots.map((s) => {
        if (s.symbol) {
          if (s.type.kind === "fn") {
            return `[${s.key}](): ${renderDtsType(s.type.returnType)}`;
          }
          return `[${s.key}]: ${renderDtsType(s.type)}`;
        }
        const typ = renderDtsType(s.type);
        const needsParens = s.type.kind === "union" || s.type.kind === "fn";
        const value = s.optional && needsParens ? `(${typ})` : typ;
        return `${s.readonly ? "readonly " : ""}${s.key}${s.optional ? "?" : ""}: ${value}`;
      });
      if (t.index) {
        parts.push(`[key: ${renderDtsType(t.index.key)}]: ${renderDtsType(t.index.value)}`);
      }
      return `{ ${parts.join("; ")} }`;
    }
    case "intersection":
      return t.members.map(renderDtsType).join(" & ");
    case "template":
      return `\`${t.parts
        .map((p) => (p.fixed !== undefined ? p.fixed : `\${${renderDtsType(p.type!)}}`))
        .join("")}\``;
    case "generic":
      return `${t.name}<${t.args.map(renderDtsType).join(", ")}>`;
    case "named":
    case "raw":
      return t.text;
    case "fn": {
      const params = t.params.map((p) => `${p.name}: ${renderDtsType(p.type)}`);
      return `(${params.join(", ")}) => ${renderDtsType(t.returnType)}`;
    }
    case "overloads": {
      const arms = t.arms.map(
        (a) =>
          `(${a.paramTypes.map((p, i) => `a${i}: ${renderDtsType(p)}`).join(", ")}): ${renderDtsType(a.returnType)}`,
      );
      return `{ ${arms.join("; ")} }`;
    }
    case "union": {
      const parts = t.members
        .map((m) => {
          const text = renderDtsType(m);
          return m.kind === "fn" ? `(${text})` : text;
        })
        .filter((s) => s !== "never");
      const uniq = [...new Set(parts)];
      return uniq.length === 0 ? "never" : uniq.join(" | ");
    }
  }
}
