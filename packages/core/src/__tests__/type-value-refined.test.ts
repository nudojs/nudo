import { describe, it, expect } from "vitest";
import {
  T,
  typeValueEquals,
  isSubtypeOf,
  typeValueToString,
  deepCloneTypeValue,
  getPrimitiveTypeOf,
  getRefinedBase,
} from "../type-value.ts";
import { createTemplate, isTemplate, getTemplateParts, getKnownPrefix, getKnownSuffix } from "../refinements/template.ts";
import { createRange, isRange, getRangeMeta } from "../refinements/range.ts";

describe("Refined TypeValue", () => {
  describe("T.refine", () => {
    it("creates a refined type", () => {
      const odd = T.refine(T.number, { name: "odd", meta: {} });
      expect(odd.kind).toBe("refined");
      if (odd.kind === "refined") {
        expect(odd.base).toBe(T.number);
        expect(odd.refinement.name).toBe("odd");
      }
    });
  });

  describe("typeValueEquals", () => {
    it("equal refined types with same name and base", () => {
      const a = T.refine(T.number, { name: "odd", meta: {} });
      const b = T.refine(T.number, { name: "odd", meta: {} });
      expect(typeValueEquals(a, b)).toBe(true);
    });

    it("different name means not equal", () => {
      const a = T.refine(T.number, { name: "odd", meta: {} });
      const b = T.refine(T.number, { name: "even", meta: {} });
      expect(typeValueEquals(a, b)).toBe(false);
    });

    it("different base means not equal", () => {
      const a = T.refine(T.number, { name: "x", meta: {} });
      const b = T.refine(T.string, { name: "x", meta: {} });
      expect(typeValueEquals(a, b)).toBe(false);
    });
  });

  describe("isSubtypeOf", () => {
    it("refined is subtype of its base", () => {
      const odd = T.refine(T.number, { name: "odd", meta: {} });
      expect(isSubtypeOf(odd, T.number)).toBe(true);
    });

    it("refined is subtype of unknown", () => {
      const odd = T.refine(T.number, { name: "odd", meta: {} });
      expect(isSubtypeOf(odd, T.unknown)).toBe(true);
    });

    it("literal is subtype of refined when check passes", () => {
      const odd = T.refine(T.number, {
        name: "odd",
        meta: {},
        check: (v) => typeof v === "number" && v % 2 !== 0,
      });
      expect(isSubtypeOf(T.literal(3), odd)).toBe(true);
      expect(isSubtypeOf(T.literal(4), odd)).toBe(false);
    });

    it("nested refined is subtype of outer base", () => {
      const integer = T.refine(T.number, { name: "integer", meta: {} });
      const positiveInt = T.refine(integer, { name: "positive integer", meta: {} });
      expect(isSubtypeOf(positiveInt, T.number)).toBe(true);
      expect(isSubtypeOf(positiveInt, integer)).toBe(true);
    });
  });

  describe("typeValueToString", () => {
    it("uses refinement name", () => {
      const odd = T.refine(T.number, { name: "odd", meta: {} });
      expect(typeValueToString(odd)).toBe("odd");
    });
  });

  describe("getPrimitiveTypeOf", () => {
    it("delegates to base", () => {
      const odd = T.refine(T.number, { name: "odd", meta: {} });
      expect(getPrimitiveTypeOf(odd)).toBe("number");
    });

    it("handles nested refined", () => {
      const inner = T.refine(T.string, { name: "inner", meta: {} });
      const outer = T.refine(inner, { name: "outer", meta: {} });
      expect(getPrimitiveTypeOf(outer)).toBe("string");
    });
  });

  describe("getRefinedBase", () => {
    it("unwraps to primitive", () => {
      const inner = T.refine(T.number, { name: "a", meta: {} });
      const outer = T.refine(inner, { name: "b", meta: {} });
      expect(getRefinedBase(outer)).toBe(T.number);
    });

    it("returns non-refined as-is", () => {
      expect(getRefinedBase(T.string)).toBe(T.string);
    });
  });

  describe("deepCloneTypeValue", () => {
    it("clones refined type", () => {
      const odd = T.refine(T.number, { name: "odd", meta: { x: 1 } });
      const cloned = deepCloneTypeValue(odd);
      expect(typeValueEquals(cloned, odd)).toBe(true);
      expect(cloned).not.toBe(odd);
    });
  });
});

describe("Template String", () => {
  it("creates template from parts", () => {
    const tmpl = createTemplate([T.literal("xy"), T.string]);
    expect(isTemplate(tmpl)).toBe(true);
    expect(tmpl.kind).toBe("refined");
  });

  it("collapses to literal when all parts are literal", () => {
    const tmpl = createTemplate([T.literal("hello"), T.literal(" world")]);
    expect(tmpl.kind).toBe("literal");
    if (tmpl.kind === "literal") expect(tmpl.value).toBe("hello world");
  });

  it("collapses to T.string when only T.string", () => {
    const tmpl = createTemplate([T.string]);
    expect(tmpl.kind).toBe("primitive");
  });

  it("getKnownPrefix extracts leading literals", () => {
    expect(getKnownPrefix([T.literal("xy"), T.string])).toBe("xy");
    expect(getKnownPrefix([T.string, T.literal("z")])).toBe("");
    expect(getKnownPrefix([T.literal("a"), T.literal("b"), T.string])).toBe("ab");
  });

  it("getKnownSuffix extracts trailing literals", () => {
    expect(getKnownSuffix([T.string, T.literal("!")])).toBe("!");
    expect(getKnownSuffix([T.literal("x"), T.string])).toBe("");
  });

  it("getTemplateParts returns parts", () => {
    const tmpl = createTemplate([T.literal("x"), T.string]);
    const parts = getTemplateParts(tmpl);
    expect(parts).toHaveLength(2);
  });

  it("toString formats as template literal", () => {
    const tmpl = createTemplate([T.literal("xy"), T.string]);
    expect(typeValueToString(tmpl)).toBe("`xy${string}`");
  });

  it("is subtype of T.string", () => {
    const tmpl = createTemplate([T.literal("x"), T.string]);
    expect(isSubtypeOf(tmpl, T.string)).toBe(true);
  });

  it("check validates concrete strings", () => {
    const tmpl = createTemplate([T.literal("xy"), T.string]);
    if (tmpl.kind === "refined" && tmpl.refinement.check) {
      expect(tmpl.refinement.check("xyhello")).toBe(true);
      expect(tmpl.refinement.check("xy")).toBe(true);
      expect(tmpl.refinement.check("ahello")).toBe(false);
    }
  });
});

describe("Range", () => {
  it("creates range type", () => {
    const r = createRange({ min: 0 });
    expect(isRange(r)).toBe(true);
    expect(r.kind).toBe("refined");
  });

  it("collapses to literal when min === max", () => {
    const r = createRange({ min: 5, max: 5 });
    expect(r.kind).toBe("literal");
    if (r.kind === "literal") expect(r.value).toBe(5);
  });

  it("getRangeMeta returns metadata", () => {
    const r = createRange({ min: 0, max: 100, integer: true });
    const meta = getRangeMeta(r);
    expect(meta).toEqual({ min: 0, max: 100, integer: true });
  });

  it("is subtype of T.number", () => {
    const r = createRange({ min: 0 });
    expect(isSubtypeOf(r, T.number)).toBe(true);
  });

  it("toString formats with constraints", () => {
    expect(typeValueToString(createRange({ min: 0 }))).toBe("number (>= 0)");
    expect(typeValueToString(createRange({ min: 0, max: 100 }))).toBe("number (>= 0, <= 100)");
    expect(typeValueToString(createRange({ integer: true }))).toBe("integer");
  });

  it("check validates concrete numbers", () => {
    const r = createRange({ min: 0, max: 10 });
    if (r.kind === "refined" && r.refinement.check) {
      expect(r.refinement.check(5)).toBe(true);
      expect(r.refinement.check(-1)).toBe(false);
      expect(r.refinement.check(11)).toBe(false);
    }
  });
});
