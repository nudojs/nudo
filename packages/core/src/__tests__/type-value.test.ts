import { describe, it, expect } from "vitest";
import {
  T,
  typeValueEquals,
  simplifyUnion,
  widenLiteral,
  isSubtypeOf,
  typeValueToString,
  narrowType,
  subtractType,
  getPrimitiveTypeOf,
} from "../type-value.ts";

describe("T factory", () => {
  it("creates literal type values", () => {
    expect(T.literal(1)).toEqual({ kind: "literal", value: 1 });
    expect(T.literal("hello")).toEqual({ kind: "literal", value: "hello" });
    expect(T.literal(true)).toEqual({ kind: "literal", value: true });
    expect(T.literal(null)).toEqual({ kind: "literal", value: null });
    expect(T.literal(undefined)).toEqual({ kind: "literal", value: undefined });
  });

  it("provides primitive singletons", () => {
    expect(T.number).toEqual({ kind: "primitive", type: "number" });
    expect(T.string).toEqual({ kind: "primitive", type: "string" });
    expect(T.boolean).toEqual({ kind: "primitive", type: "boolean" });
  });

  it("creates object type values", () => {
    const obj = T.object({ x: T.number, y: T.string });
    expect(obj.kind).toBe("object");
    if (obj.kind === "object") {
      expect(obj.properties.x).toBe(T.number);
      expect(obj.properties.y).toBe(T.string);
      expect(typeof obj.id).toBe("symbol");
    }
  });

  it("creates union type values with simplification", () => {
    const u = T.union(T.literal(1), T.literal(2));
    expect(u.kind).toBe("union");
    if (u.kind === "union") {
      expect(u.members).toHaveLength(2);
    }
  });

  it("simplifies single-member union to the member", () => {
    const u = T.union(T.number);
    expect(u).toBe(T.number);
  });

  it("simplifies empty union to never", () => {
    const u = T.union(T.never, T.never);
    expect(u).toEqual(T.never);
  });
});

describe("typeValueEquals", () => {
  it("compares literals", () => {
    expect(typeValueEquals(T.literal(1), T.literal(1))).toBe(true);
    expect(typeValueEquals(T.literal(1), T.literal(2))).toBe(false);
  });

  it("compares primitives", () => {
    expect(typeValueEquals(T.number, T.number)).toBe(true);
    expect(typeValueEquals(T.number, T.string)).toBe(false);
  });

  it("compares never and unknown", () => {
    expect(typeValueEquals(T.never, T.never)).toBe(true);
    expect(typeValueEquals(T.unknown, T.unknown)).toBe(true);
    expect(typeValueEquals(T.never, T.unknown)).toBe(false);
  });
});

describe("simplifyUnion", () => {
  it("deduplicates members", () => {
    const result = simplifyUnion([T.literal(1), T.literal(1), T.literal(2)]);
    expect(result.kind).toBe("union");
    if (result.kind === "union") {
      expect(result.members).toHaveLength(2);
    }
  });

  it("flattens nested unions", () => {
    const inner = T.union(T.literal(1), T.literal(2));
    const result = simplifyUnion([inner, T.literal(3)]);
    expect(result.kind).toBe("union");
    if (result.kind === "union") {
      expect(result.members).toHaveLength(3);
    }
  });

  it("absorbs unknown", () => {
    const result = simplifyUnion([T.number, T.unknown]);
    expect(result).toEqual(T.unknown);
  });

  it("removes never", () => {
    const result = simplifyUnion([T.number, T.never]);
    expect(result).toBe(T.number);
  });
});

describe("widenLiteral", () => {
  it("widens number literal to number", () => {
    expect(widenLiteral(T.literal(42))).toEqual(T.number);
  });

  it("widens string literal to string", () => {
    expect(widenLiteral(T.literal("hi"))).toEqual(T.string);
  });

  it("widens boolean literal to boolean", () => {
    expect(widenLiteral(T.literal(true))).toEqual(T.boolean);
  });

  it("returns non-literal unchanged", () => {
    expect(widenLiteral(T.number)).toBe(T.number);
  });
});

describe("isSubtypeOf", () => {
  it("everything is subtype of unknown", () => {
    expect(isSubtypeOf(T.number, T.unknown)).toBe(true);
    expect(isSubtypeOf(T.literal(1), T.unknown)).toBe(true);
  });

  it("never is subtype of everything", () => {
    expect(isSubtypeOf(T.never, T.number)).toBe(true);
    expect(isSubtypeOf(T.never, T.never)).toBe(true);
  });

  it("literal is subtype of its primitive", () => {
    expect(isSubtypeOf(T.literal(1), T.number)).toBe(true);
    expect(isSubtypeOf(T.literal("hi"), T.string)).toBe(true);
    expect(isSubtypeOf(T.literal(true), T.boolean)).toBe(true);
  });

  it("literal is not subtype of wrong primitive", () => {
    expect(isSubtypeOf(T.literal(1), T.string)).toBe(false);
  });

  it("union is subtype if all members are", () => {
    const u = T.union(T.literal(1), T.literal(2));
    expect(isSubtypeOf(u, T.number)).toBe(true);
  });

  it("value is subtype of union containing it", () => {
    const u = T.union(T.number, T.string);
    expect(isSubtypeOf(T.number, u)).toBe(true);
  });
});

describe("typeValueToString", () => {
  it("formats literals", () => {
    expect(typeValueToString(T.literal(1))).toBe("1");
    expect(typeValueToString(T.literal("hi"))).toBe('"hi"');
    expect(typeValueToString(T.literal(true))).toBe("true");
    expect(typeValueToString(T.literal(null))).toBe("null");
    expect(typeValueToString(T.literal(undefined))).toBe("undefined");
  });

  it("formats primitives", () => {
    expect(typeValueToString(T.number)).toBe("number");
    expect(typeValueToString(T.string)).toBe("string");
  });

  it("formats unions", () => {
    const u = T.union(T.number, T.string);
    expect(typeValueToString(u)).toBe("number | string");
  });

  it("formats objects", () => {
    const obj = T.object({ x: T.number });
    expect(typeValueToString(obj)).toBe("{ x: number }");
  });

  it("formats never and unknown", () => {
    expect(typeValueToString(T.never)).toBe("never");
    expect(typeValueToString(T.unknown)).toBe("unknown");
  });
});

describe("narrowType", () => {
  it("narrows union by predicate", () => {
    const u = T.union(T.literal(1), T.literal("a"), T.literal(true));
    const result = narrowType(u, (m) => m.kind === "literal" && typeof m.value === "number");
    expect(typeValueEquals(result, T.literal(1))).toBe(true);
  });

  it("returns never if nothing matches", () => {
    const result = narrowType(T.number, (m) => m.kind === "literal");
    expect(result).toEqual(T.never);
  });
});

describe("getPrimitiveTypeOf", () => {
  it("returns typeof for literals", () => {
    expect(getPrimitiveTypeOf(T.literal(1))).toBe("number");
    expect(getPrimitiveTypeOf(T.literal("hi"))).toBe("string");
    expect(getPrimitiveTypeOf(T.literal(null))).toBe("object");
  });

  it("returns type for primitives", () => {
    expect(getPrimitiveTypeOf(T.number)).toBe("number");
  });

  it("returns object for object/array/tuple", () => {
    expect(getPrimitiveTypeOf(T.object({}))).toBe("object");
    expect(getPrimitiveTypeOf(T.array(T.number))).toBe("object");
  });
});
