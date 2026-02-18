import { describe, it, expect } from "vitest";
import { Ops, applyBinaryOp } from "../ops.ts";
import { T, typeValueEquals } from "../type-value.ts";

describe("Ops.add", () => {
  it("adds two literal numbers", () => {
    expect(typeValueEquals(Ops.add(T.literal(1), T.literal(2)), T.literal(3))).toBe(true);
  });

  it("concatenates two literal strings", () => {
    expect(typeValueEquals(Ops.add(T.literal("a"), T.literal("b")), T.literal("ab"))).toBe(true);
  });

  it("returns number for abstract numbers", () => {
    expect(typeValueEquals(Ops.add(T.number, T.number), T.number)).toBe(true);
  });

  it("returns string when one side is string", () => {
    expect(typeValueEquals(Ops.add(T.number, T.string), T.string)).toBe(true);
    expect(typeValueEquals(Ops.add(T.string, T.literal(1)), T.string)).toBe(true);
  });
});

describe("Ops.sub / mul / div / mod", () => {
  it("computes literal arithmetic", () => {
    expect(typeValueEquals(Ops.sub(T.literal(5), T.literal(3)), T.literal(2))).toBe(true);
    expect(typeValueEquals(Ops.mul(T.literal(3), T.literal(4)), T.literal(12))).toBe(true);
    expect(typeValueEquals(Ops.div(T.literal(10), T.literal(2)), T.literal(5))).toBe(true);
    expect(typeValueEquals(Ops.mod(T.literal(7), T.literal(3)), T.literal(1))).toBe(true);
  });

  it("returns number for abstract operands", () => {
    expect(typeValueEquals(Ops.sub(T.number, T.number), T.number)).toBe(true);
    expect(typeValueEquals(Ops.mul(T.number, T.literal(2)), T.number)).toBe(true);
  });
});

describe("Ops.strictEq / strictNeq", () => {
  it("compares literals", () => {
    expect(typeValueEquals(Ops.strictEq(T.literal(1), T.literal(1)), T.literal(true))).toBe(true);
    expect(typeValueEquals(Ops.strictEq(T.literal(1), T.literal(2)), T.literal(false))).toBe(true);
    expect(typeValueEquals(Ops.strictNeq(T.literal(1), T.literal(2)), T.literal(true))).toBe(true);
  });

  it("returns boolean for abstract operands", () => {
    expect(typeValueEquals(Ops.strictEq(T.number, T.number), T.boolean)).toBe(true);
  });
});

describe("Ops.gt / lt / gte / lte", () => {
  it("compares literal numbers", () => {
    expect(typeValueEquals(Ops.gt(T.literal(3), T.literal(2)), T.literal(true))).toBe(true);
    expect(typeValueEquals(Ops.lt(T.literal(1), T.literal(2)), T.literal(true))).toBe(true);
    expect(typeValueEquals(Ops.gte(T.literal(2), T.literal(2)), T.literal(true))).toBe(true);
    expect(typeValueEquals(Ops.lte(T.literal(3), T.literal(2)), T.literal(false))).toBe(true);
  });

  it("returns boolean for abstract operands", () => {
    expect(typeValueEquals(Ops.gt(T.number, T.number), T.boolean)).toBe(true);
  });
});

describe("Ops.typeof_", () => {
  it("returns literal typeof for known types", () => {
    expect(typeValueEquals(Ops.typeof_(T.literal(1)), T.literal("number"))).toBe(true);
    expect(typeValueEquals(Ops.typeof_(T.literal("hi")), T.literal("string"))).toBe(true);
    expect(typeValueEquals(Ops.typeof_(T.literal(null)), T.literal("object"))).toBe(true);
    expect(typeValueEquals(Ops.typeof_(T.number), T.literal("number"))).toBe(true);
    expect(typeValueEquals(Ops.typeof_(T.object({})), T.literal("object"))).toBe(true);
  });
});

describe("Ops.not", () => {
  it("negates literal booleans", () => {
    expect(typeValueEquals(Ops.not(T.literal(true)), T.literal(false))).toBe(true);
    expect(typeValueEquals(Ops.not(T.literal(false)), T.literal(true))).toBe(true);
  });

  it("negates truthy/falsy literals", () => {
    expect(typeValueEquals(Ops.not(T.literal(0)), T.literal(true))).toBe(true);
    expect(typeValueEquals(Ops.not(T.literal("")), T.literal(true))).toBe(true);
    expect(typeValueEquals(Ops.not(T.literal(1)), T.literal(false))).toBe(true);
  });

  it("returns boolean for abstract types", () => {
    expect(typeValueEquals(Ops.not(T.number), T.boolean)).toBe(true);
  });
});

describe("Ops.neg", () => {
  it("negates literal number", () => {
    expect(typeValueEquals(Ops.neg(T.literal(5)), T.literal(-5))).toBe(true);
  });

  it("returns number for abstract", () => {
    expect(typeValueEquals(Ops.neg(T.number), T.number)).toBe(true);
  });
});

describe("applyBinaryOp", () => {
  it("dispatches to correct op", () => {
    expect(typeValueEquals(applyBinaryOp("+", T.literal(1), T.literal(2)), T.literal(3))).toBe(true);
    expect(typeValueEquals(applyBinaryOp("===", T.literal(1), T.literal(1)), T.literal(true))).toBe(true);
  });

  it("returns unknown for unsupported op", () => {
    expect(applyBinaryOp("**", T.number, T.number)).toEqual(T.unknown);
  });
});
