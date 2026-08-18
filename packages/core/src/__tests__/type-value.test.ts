import { describe, it, expect } from "vitest";
import {
  T,
  type LiteralValue,
  typeValueEquals,
  simplifyUnion,
  widenLiteral,
  collapseLiteralUnion,
  isSubtypeOf,
  typeValueToString,
  narrowType,
  subtractType,
  getPrimitiveTypeOf,
} from "../type-value.ts";
import { createTemplate } from "../refinements/template.ts";

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

  it("collapses 20 number literals beyond maxLiterals to number", () => {
    const members = Array.from({ length: 20 }, (_, i) => T.literal((i + 1) ** 2));
    const u = { kind: "union", members } as const;
    const result = collapseLiteralUnion(u, 4);
    expect(result).toEqual(T.number);
  });

  it("collapses 5 string literals to string", () => {
    const u = {
      kind: "union",
      members: ["a", "b", "c", "d", "e"].map((s) => T.literal(s)),
    } as const;
    const result = collapseLiteralUnion(u, 4);
    expect(result).toEqual(T.string);
  });

  it("returns union unchanged when member count equals maxLiterals", () => {
    const u = {
      kind: "union",
      members: [T.literal(1), T.literal(2), T.literal(3), T.literal(4)],
    } as const;
    expect(collapseLiteralUnion(u, 4)).toBe(u);
  });

  it("mixed union: number literals absorbed by T.number, string literal kept (行为已修复：吸收律)", () => {
    const u = {
      kind: "union",
      members: [T.literal(1), T.number, T.literal("x"), T.literal(2), T.literal(3)],
    } as const;
    // 原断言期望原样返回 u；现 collapseLiteralUnion 复用 simplifyUnion 的吸收律，
    // 数字字面量 1/2/3 被共存的 T.number 吸收，仅剩 ["x", number]（数量 ≤ 阈值不再坍缩）
    expect(collapseLiteralUnion(u, 4)).toEqual(T.union(T.number, T.literal("x")));
  });

  it("returns non-union unchanged (single literal / T.number)", () => {
    const lit = T.literal(1);
    expect(collapseLiteralUnion(lit, 0)).toBe(lit);
    expect(collapseLiteralUnion(T.number, 0)).toBe(T.number);
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

describe("union absorption law (3 | number → number)", () => {
  it("absorbs number literal into number", () => {
    expect(T.union(T.literal(3), T.number)).toBe(T.number);
    expect(T.union(T.number, T.literal(3))).toBe(T.number);
  });

  it("absorbs string literal into string", () => {
    expect(T.union(T.literal("a"), T.string)).toBe(T.string);
    expect(T.union(T.string, T.literal("a"))).toBe(T.string);
  });

  it("absorbs boolean literal into boolean", () => {
    expect(T.union(T.literal(true), T.boolean)).toBe(T.boolean);
    expect(T.union(T.boolean, T.literal(false))).toBe(T.boolean);
  });

  it("absorbs bigint literal into bigint", () => {
    // LiteralValue 类型暂不含 bigint，运行时以 cast 构造
    expect(T.union(T.literal(10n as unknown as LiteralValue), T.bigint)).toBe(T.bigint);
  });

  it("absorbs template literal into string", () => {
    const tmpl = createTemplate([T.literal("x"), T.string]);
    expect(T.union(tmpl, T.string)).toBe(T.string);
  });

  it("absorbs only matching base across mixed members (order-stable)", () => {
    // 1 被 number 吸收，"a" 无 string 在场而保留
    const u = T.union(T.literal(1), T.number, T.literal("a"));
    expect(u.kind).toBe("union");
    if (u.kind === "union") {
      expect(u.members).toHaveLength(2);
      expect(typeValueEquals(u.members[0], T.number)).toBe(true);
      expect(typeValueEquals(u.members[1], T.literal("a"))).toBe(true);
    }
  });

  it("keeps different-base literal union (1 | \"a\")", () => {
    const u = T.union(T.literal(1), T.literal("a"));
    expect(u.kind).toBe("union");
    if (u.kind === "union") {
      expect(u.members).toHaveLength(2);
    }
  });

  it("keeps pure literal unions (\"a\" | \"b\", 2 | -9)", () => {
    expect(typeValueToString(T.union(T.literal("a"), T.literal("b")))).toBe('"a" | "b"');
    expect(typeValueToString(T.union(T.literal(2), T.literal(-9)))).toBe("2 | -9");
  });

  it("keeps undefined/null literal unions untouched", () => {
    expect(typeValueToString(T.union(T.undefined, T.string))).toBe("undefined | string");
    expect(typeValueToString(T.union(T.null, T.literal(1)))).toBe("null | 1");
  });

  it("keeps pure primitive unions untouched (number | string | boolean)", () => {
    expect(typeValueToString(T.union(T.number, T.string, T.boolean))).toBe(
      "number | string | boolean",
    );
  });
});
