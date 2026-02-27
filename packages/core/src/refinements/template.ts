import { type TypeValue, type Refinement, T, typeValueToString } from "../type-value.ts";
import { createRange } from "./range.ts";

export function getKnownPrefix(parts: TypeValue[]): string {
  let prefix = "";
  for (const p of parts) {
    if (p.kind === "literal" && typeof p.value === "string") {
      prefix += p.value;
    } else {
      break;
    }
  }
  return prefix;
}

export function getKnownSuffix(parts: TypeValue[]): string {
  let suffix = "";
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.kind === "literal" && typeof p.value === "string") {
      suffix = p.value + suffix;
    } else {
      break;
    }
  }
  return suffix;
}

function getFixedLength(parts: TypeValue[]): number {
  let len = 0;
  for (const p of parts) {
    if (p.kind === "literal" && typeof p.value === "string") {
      len += p.value.length;
    }
  }
  return len;
}

function getAllFixedText(parts: TypeValue[]): string {
  return parts
    .filter((p): p is TypeValue & { kind: "literal" } => p.kind === "literal" && typeof p.value === "string")
    .map((p) => p.value as string)
    .join("");
}

function formatTemplateName(parts: TypeValue[]): string {
  const inner = parts
    .map((p) => (p.kind === "literal" && typeof p.value === "string" ? p.value : `\${${typeValueToString(p)}}`))
    .join("");
  return `\`${inner}\``;
}

function normalizeParts(parts: TypeValue[]): TypeValue[] {
  const result: TypeValue[] = [];
  for (const p of parts) {
    const last = result[result.length - 1];
    if (
      last?.kind === "literal" && typeof last.value === "string" &&
      p.kind === "literal" && typeof p.value === "string"
    ) {
      result[result.length - 1] = T.literal(last.value + p.value);
    } else if (
      last?.kind === "primitive" && last.type === "string" &&
      p.kind === "primitive" && p.type === "string"
    ) {
      // T.string + T.string collapses to T.string
    } else {
      result.push(p);
    }
  }
  return result;
}

function createTemplateRefinement(parts: TypeValue[]): Refinement {
  return {
    name: formatTemplateName(parts),
    meta: { parts },
    check(value: unknown) {
      if (typeof value !== "string") return false;
      return matchesTemplate(value, parts);
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
        const prefix = getKnownPrefix((_self as any).refinement.meta.parts as TypeValue[]);
        const search = arg.value;
        if (prefix.length >= search.length) {
          return T.literal(prefix.startsWith(search));
        }
        if (search.startsWith(prefix)) return undefined;
        return T.literal(false);
      },
      endsWith(_self: TypeValue, args: TypeValue[]) {
        const arg = args[0];
        if (arg?.kind !== "literal" || typeof arg.value !== "string") return undefined;
        const suffix = getKnownSuffix((_self as any).refinement.meta.parts as TypeValue[]);
        const search = arg.value;
        if (suffix.length >= search.length) {
          return T.literal(suffix.endsWith(search));
        }
        if (search.endsWith(suffix)) return undefined;
        return T.literal(false);
      },
      includes(_self: TypeValue, args: TypeValue[]) {
        const arg = args[0];
        if (arg?.kind !== "literal" || typeof arg.value !== "string") return undefined;
        const fixed = getAllFixedText((_self as any).refinement.meta.parts as TypeValue[]);
        if (fixed.includes(arg.value)) return T.literal(true);
        return undefined;
      },
    },
    properties: {
      length(_self: TypeValue) {
        const parts = (_self as any).refinement.meta.parts as TypeValue[];
        const hasAbstract = parts.some((p) => p.kind !== "literal");
        if (!hasAbstract) return undefined;
        const minLen = getFixedLength(parts);
        return createRange({ min: minLen });
      },
    },
  };
}

function matchesTemplate(value: string, parts: TypeValue[]): boolean {
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.kind === "literal" && typeof p.value === "string") {
      if (!value.startsWith(p.value, pos)) return false;
      pos += p.value.length;
    } else {
      if (i === parts.length - 1) return true;
      const next = parts[i + 1];
      if (next?.kind === "literal" && typeof next.value === "string") {
        const idx = value.indexOf(next.value, pos);
        if (idx === -1) return false;
        pos = idx;
      } else {
        return true;
      }
    }
  }
  return pos === value.length;
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

export function isTemplate(tv: TypeValue): boolean {
  return tv.kind === "refined" && Array.isArray(tv.refinement.meta.parts);
}

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
