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
      slots: Array<{ key: string; type: DtsType; optional?: boolean; readonly?: boolean }>;
      /** 索引签名（`[key: K]: V`） */
      index?: { key: DtsType; value: DtsType };
      /** 零成员对象：closed ⇒ never；open ⇒ unknown */
      empty?: "never" | "unknown";
    }
  | { kind: "generic"; name: string; args: DtsType[] }
  | { kind: "named"; text: string }
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
};

/**
 * Abs → DtsType；返回 undefined = 本切片不负责，调用方回落。
 *
 * 保守条件：任何非字面量 term、任何收窄 pred、类型变量都直接放弃；宁可走
 * 旧渲染器，也不让新打印器输出与旧产物不同的文本。
 */
export function dtsTypeOfAbs(a: Abs, opts: DtsTypeOpts = {}): DtsType | undefined {
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
      // 数组视图：仅支持「规范下标 + length」的纯数组面；带伴生槽
      // （index/input/groups 等）时旧渲染器会发 tuple & object 交叉类型 ⇒ 回落。
      if (a.shape.view !== undefined) {
        if (a.shape.view !== "array") return undefined;
        const entries = Object.entries(a.shape.slots);
        if (entries.some(([k]) => !CANONICAL_INDEX.test(k) && k !== "length")) return undefined;
        const idxs = entries
          .map(([k]) => k)
          .filter((k) => CANONICAL_INDEX.test(k))
          .map(Number)
          .sort((x, y) => x - y);
        if (idxs.length === 0) return { kind: "array", element: { kind: "unknown" } };
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
        return { kind: "tuple", elements };
      }
      const entries = Object.entries(a.shape.slots);
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
      const slots: Array<{
        key: string;
        type: DtsType;
        optional?: boolean;
        readonly?: boolean;
      }> = [];
      for (const [k, slot] of entries) {
        if (slot.symbolKey === true || isHiddenInternalSlot(k, slot)) return undefined;
        if (lookupObjAccessor(a, k) !== undefined) return undefined;
        // 对象方法可能叠加源码返回注解（applyObjectFnReturnOverride）⇒
        // 独立 fn 类型支持不适用于对象槽，仍走旧渲染器。
        if (slot.value.shape.k === "fn") return undefined;
        const t = contractLiteralDtsType(slot.value) ?? dtsTypeOfAbs(slot.value, opts);
        if (t === undefined) return undefined;
        slots.push({
          key: formatObjectKey(k),
          type: t,
          ...(slot.optional ? { optional: true } : {}),
          ...(slot.readonly === true || opts.readonlyValues ? { readonly: true } : {}),
        });
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

/** 契约字面量槽（`eq(self, lit(v))`）→ 字面量类型；非该形态 ⇒ undefined。 */
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
  if (a.term === undefined || a.pred?.op !== "eq") return undefined;
  const { a: l, b: r } = a.pred;
  const litTerm =
    l.op === "lit" && termEquals(r, a.term)
      ? l
      : r.op === "lit" && termEquals(l, a.term)
        ? r
        : undefined;
  if (!litTerm) return undefined;
  return literalDtsType(litTerm.value);
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
        const typ = renderDtsType(s.type);
        const value = s.optional && s.type.kind === "union" ? `(${typ})` : typ;
        return `${s.readonly ? "readonly " : ""}${s.key}${s.optional ? "?" : ""}: ${value}`;
      });
      if (t.index) {
        parts.push(`[key: ${renderDtsType(t.index.key)}]: ${renderDtsType(t.index.value)}`);
      }
      return `{ ${parts.join("; ")} }`;
    }
    case "template":
      return `\`${t.parts
        .map((p) => (p.fixed !== undefined ? p.fixed : `\${${renderDtsType(p.type!)}}`))
        .join("")}\``;
    case "generic":
      return `${t.name}<${t.args.map(renderDtsType).join(", ")}>`;
    case "named":
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
