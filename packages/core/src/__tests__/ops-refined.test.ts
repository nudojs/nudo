import { describe, it, expect } from "vitest";
import { T, typeValueEquals } from "../type-value.ts";
import { dispatchBinaryOp, dispatchMethod, dispatchProperty } from "../ops.ts";
import { createTemplate, isTemplate } from "../refinements/template.ts";
import { createRange } from "../refinements/range.ts";

describe("dispatchBinaryOp", () => {
  describe("refined fallback", () => {
    it("falls back to base type when no ops defined", () => {
      const odd = T.refine(T.number, { name: "odd", meta: {} });
      const result = dispatchBinaryOp("+", odd, T.literal(1));
      expect(result.kind).toBe("primitive");
    });

    it("uses custom ops when defined", () => {
      const odd = T.refine(T.number, {
        name: "odd",
        meta: {},
        ops: {
          "%"(self, other) {
            if (other.kind === "literal" && other.value === 2) return T.literal(1);
            return undefined;
          },
        },
      });
      const result = dispatchBinaryOp("%", odd, T.literal(2));
      expect(typeValueEquals(result, T.literal(1))).toBe(true);
    });

    it("falls back when custom op returns undefined", () => {
      const odd = T.refine(T.number, {
        name: "odd",
        meta: {},
        ops: {
          "%"(self, other) {
            if (other.kind === "literal" && other.value === 2) return T.literal(1);
            return undefined;
          },
        },
      });
      const result = dispatchBinaryOp("%", odd, T.literal(3));
      expect(result.kind).toBe("primitive");
    });
  });

  describe("template string via add", () => {
    it("literal string + T.string produces template", () => {
      const result = dispatchBinaryOp("+", T.literal("xy"), T.string);
      expect(isTemplate(result)).toBe(true);
    });

    it("T.string + literal string produces template", () => {
      const result = dispatchBinaryOp("+", T.string, T.literal("!"));
      expect(isTemplate(result)).toBe(true);
    });

    it("template + template concatenates", () => {
      const left = createTemplate([T.literal("a"), T.string]);
      const right = createTemplate([T.literal("b"), T.string]);
      const result = dispatchBinaryOp("+", left, right);
      expect(isTemplate(result)).toBe(true);
    });

    it("two literal strings still produce literal", () => {
      const result = dispatchBinaryOp("+", T.literal("a"), T.literal("b"));
      expect(typeValueEquals(result, T.literal("ab"))).toBe(true);
    });

    it("T.string + T.string stays T.string", () => {
      const result = dispatchBinaryOp("+", T.string, T.string);
      expect(typeValueEquals(result, T.string)).toBe(true);
    });
  });

  describe("range comparison ops", () => {
    it("range(min:0) >= 0 is true", () => {
      const r = createRange({ min: 0 });
      const result = dispatchBinaryOp(">=", r, T.literal(0));
      expect(typeValueEquals(result, T.literal(true))).toBe(true);
    });

    it("range(min:0) >= -1 is true", () => {
      const r = createRange({ min: 0 });
      const result = dispatchBinaryOp(">=", r, T.literal(-1));
      expect(typeValueEquals(result, T.literal(true))).toBe(true);
    });

    it("range(max:100) > 200 is false", () => {
      const r = createRange({ max: 100 });
      const result = dispatchBinaryOp(">", r, T.literal(200));
      expect(typeValueEquals(result, T.literal(false))).toBe(true);
    });

    it("range(min:0, max:100) > 50 is uncertain (boolean)", () => {
      const r = createRange({ min: 0, max: 100 });
      const result = dispatchBinaryOp(">", r, T.literal(50));
      expect(typeValueEquals(result, T.boolean)).toBe(true);
    });

    it("range(max:10) <= 10 is true", () => {
      const r = createRange({ max: 10 });
      const result = dispatchBinaryOp("<=", r, T.literal(10));
      expect(typeValueEquals(result, T.literal(true))).toBe(true);
    });

    it("range(min:5) < 3 is false", () => {
      const r = createRange({ min: 5 });
      const result = dispatchBinaryOp("<", r, T.literal(3));
      expect(typeValueEquals(result, T.literal(false))).toBe(true);
    });
  });
});

describe("dispatchMethod", () => {
  describe("template startsWith", () => {
    it("known prefix matches", () => {
      const tmpl = createTemplate([T.literal("xy"), T.string]);
      const result = dispatchMethod(tmpl, "startsWith", [T.literal("x")]);
      expect(result).toBeDefined();
      expect(typeValueEquals(result!, T.literal(true))).toBe(true);
    });

    it("known prefix full match", () => {
      const tmpl = createTemplate([T.literal("xy"), T.string]);
      const result = dispatchMethod(tmpl, "startsWith", [T.literal("xy")]);
      expect(typeValueEquals(result!, T.literal(true))).toBe(true);
    });

    it("known prefix mismatch", () => {
      const tmpl = createTemplate([T.literal("xy"), T.string]);
      const result = dispatchMethod(tmpl, "startsWith", [T.literal("a")]);
      expect(typeValueEquals(result!, T.literal(false))).toBe(true);
    });

    it("uncertain when search extends beyond prefix", () => {
      const tmpl = createTemplate([T.literal("xy"), T.string]);
      const result = dispatchMethod(tmpl, "startsWith", [T.literal("xyz")]);
      expect(result).toBeUndefined();
    });
  });

  describe("template endsWith", () => {
    it("known suffix matches", () => {
      const tmpl = createTemplate([T.string, T.literal("!")]);
      const result = dispatchMethod(tmpl, "endsWith", [T.literal("!")]);
      expect(typeValueEquals(result!, T.literal(true))).toBe(true);
    });

    it("known suffix mismatch", () => {
      const tmpl = createTemplate([T.string, T.literal("!")]);
      const result = dispatchMethod(tmpl, "endsWith", [T.literal("?")]);
      expect(typeValueEquals(result!, T.literal(false))).toBe(true);
    });
  });

  describe("template includes", () => {
    it("known fixed text includes substring", () => {
      const tmpl = createTemplate([T.literal("hello"), T.string, T.literal("world")]);
      const result = dispatchMethod(tmpl, "includes", [T.literal("hello")]);
      expect(typeValueEquals(result!, T.literal(true))).toBe(true);
    });

    it("uncertain when not in fixed text", () => {
      const tmpl = createTemplate([T.literal("hello"), T.string]);
      const result = dispatchMethod(tmpl, "includes", [T.literal("xyz")]);
      expect(result).toBeUndefined();
    });
  });

  it("returns undefined for unknown methods", () => {
    const tmpl = createTemplate([T.literal("x"), T.string]);
    const result = dispatchMethod(tmpl, "unknownMethod", []);
    expect(result).toBeUndefined();
  });

  it("returns undefined for non-refined types", () => {
    const result = dispatchMethod(T.string, "startsWith", [T.literal("x")]);
    expect(result).toBeUndefined();
  });
});

describe("dispatchProperty", () => {
  it("template length returns range", () => {
    const tmpl = createTemplate([T.literal("xy"), T.string]);
    const result = dispatchProperty(tmpl, "length");
    expect(result).toBeDefined();
    expect(result!.kind).toBe("refined");
  });

  it("returns undefined for non-refined types", () => {
    const result = dispatchProperty(T.string, "length");
    expect(result).toBeUndefined();
  });
});
