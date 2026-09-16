import { type TypeValue, type Refinement, T, typeValueToString } from "../type-value.ts";
import { createRange } from "./range.ts";
import {
  type TemplatePartView,
  viewTemplateParts,
  knownPrefixOfViews,
  knownSuffixOfViews,
  allFixedTextOfViews,
  formatTemplateNameViews,
  mergeAdjacentFixedViews,
  templateMatchesValue,
  decideStartsWith,
  decideEndsWith,
  decideIncludes,
} from "../algebra/template.ts";

/**
 * TypeValue 模板 refined 机制（派发表/check/ops）接线。
 * 语义计算（前缀/后缀/固定文本/匹配/名称渲染/相邻合并/谓词判定）的唯一
 * 实现在 algebra/template.ts；本模块只做 TypeValue 形态的薄适配。
 */
function tvTemplateViews(parts: TypeValue[]): TemplatePartView<TypeValue>[] {
  return viewTemplateParts(parts, (p) =>
    p.kind === "literal" && typeof p.value === "string"
      ? { fixed: p.value }
      : { render: typeValueToString(p) },
  );
}

export function getKnownPrefix(parts: TypeValue[]): string {
  return knownPrefixOfViews(tvTemplateViews(parts));
}

export function getKnownSuffix(parts: TypeValue[]): string {
  return knownSuffixOfViews(tvTemplateViews(parts));
}

function formatTemplateName(parts: TypeValue[]): string {
  return formatTemplateNameViews(tvTemplateViews(parts));
}

function normalizeParts(parts: TypeValue[]): TypeValue[] {
  const merged = mergeAdjacentFixedViews(tvTemplateViews(parts), (text) => ({
    fixed: text,
    render: text,
    part: T.literal(text),
  }));
  // T.string + T.string 折叠为 T.string（TypeValue 侧特有；Abs 侧无此折叠）
  const out: TypeValue[] = [];
  for (const { part: p } of merged) {
    const last = out[out.length - 1];
    if (
      last?.kind === "primitive" && last.type === "string" &&
      p.kind === "primitive" && p.type === "string"
    ) {
      // 丢弃重复的相邻 string prim
    } else {
      out.push(p);
    }
  }
  return out;
}

function createTemplateRefinement(parts: TypeValue[]): Refinement {
  return {
    name: formatTemplateName(parts),
    meta: { parts },
    check(value: unknown) {
      if (typeof value !== "string") return false;
      return templateMatchesValue(value, tvTemplateViews(parts));
    },
    ops: {
      "+"(self: TypeValue, other: TypeValue) {
        return concatTemplates(self, other);
      },
    },
    methods: {
      startsWith(_self: TypeValue, args: TypeValue[]) {
        const arg = args[0];
        if (arg?.kind !== "literal" || typeof arg.value !== "string") return undefined;
        const parts = (_self as any).refinement.meta.parts as TypeValue[];
        const d = decideStartsWith(knownPrefixOfViews(tvTemplateViews(parts)), arg.value);
        return d === "unknown" ? undefined : T.literal(d);
      },
      endsWith(_self: TypeValue, args: TypeValue[]) {
        const arg = args[0];
        if (arg?.kind !== "literal" || typeof arg.value !== "string") return undefined;
        const parts = (_self as any).refinement.meta.parts as TypeValue[];
        const d = decideEndsWith(knownSuffixOfViews(tvTemplateViews(parts)), arg.value);
        return d === "unknown" ? undefined : T.literal(d);
      },
      includes(_self: TypeValue, args: TypeValue[]) {
        const arg = args[0];
        if (arg?.kind !== "literal" || typeof arg.value !== "string") return undefined;
        const parts = (_self as any).refinement.meta.parts as TypeValue[];
        const d = decideIncludes(allFixedTextOfViews(tvTemplateViews(parts)), arg.value);
        return d === "unknown" ? undefined : T.literal(d);
      },
    },
    properties: {
      length(_self: TypeValue) {
        const parts = (_self as any).refinement.meta.parts as TypeValue[];
        const hasAbstract = parts.some((p) => p.kind !== "literal");
        if (!hasAbstract) return undefined;
        // 最小长度 = 固定文本总长（与旧 getFixedLength 同口径：只计字符串字面量）
        return createRange({ min: allFixedTextOfViews(tvTemplateViews(parts)).length });
      },
    },
  };
}

export function createTemplate(parts: TypeValue[]): TypeValue {
  const normalized = normalizeParts(parts);
  if (normalized.length === 1 && normalized[0].kind === "literal") {
    return normalized[0];
  }
  if (normalized.length === 1 && normalized[0].kind === "primitive" && normalized[0].type === "string") {
    return T.string;
  }
  return T.refine(T.string, createTemplateRefinement(normalized));
}

export { isTemplate } from "./template-predicates.ts";

export function getTemplateParts(tv: TypeValue): TypeValue[] | undefined {
  if (tv.kind === "refined" && Array.isArray(tv.refinement.meta.parts)) {
    return tv.refinement.meta.parts as TypeValue[];
  }
  return undefined;
}

export function concatTemplates(left: TypeValue, right: TypeValue): TypeValue {
  const leftParts = getTemplateParts(left) ?? [left];
  const rightParts = getTemplateParts(right) ?? [right];
  return createTemplate([...leftParts, ...rightParts]);
}
