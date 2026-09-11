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

// sub/mul/div/mod 已删除：数值路径唯一真理在 algebra；非数应得 unknown。

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

// typeof_ / neg 已迁入 algebra surface（tryAbsUnary）

describe("applyBinaryOp", () => {
  it("dispatches to correct op", () => {
    expect(typeValueEquals(applyBinaryOp("+", T.literal(1), T.literal(2)), T.literal(3))).toBe(true);
    expect(typeValueEquals(applyBinaryOp("===", T.literal(1), T.literal(1)), T.literal(true))).toBe(true);
  });

  it("returns unknown for deleted / unsupported ops", () => {
    expect(applyBinaryOp("**", T.number, T.number)).toEqual(T.unknown);
    // sub/mul/div/mod 已从 Ops 删除，代数是唯一路径
    expect(applyBinaryOp("-", T.literal(5), T.literal(3))).toEqual(T.unknown);
    expect(applyBinaryOp("*", T.number, T.number)).toEqual(T.unknown);
    expect(applyBinaryOp("/", T.literal(10), T.literal(2))).toEqual(T.unknown);
    expect(applyBinaryOp("%", T.literal(7), T.literal(3))).toEqual(T.unknown);
  });
});
