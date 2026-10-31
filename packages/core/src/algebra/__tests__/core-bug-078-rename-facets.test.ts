/**
 * BUG-078：`renameAbs` 重建 shape 时丢 facet（fn.optionalParams /
 * tuple.holes）⇒ α-重命名后稀疏元组被误判可赋给稠密元组（假绿）。
 */
import { describe, it, expect } from "vitest";
import { renameAbs } from "../generalize-key.ts";
import { leqAbs } from "../leq.ts";
import { abs, num, numLit, type Abs } from "../abs.ts";

const fnAbs = (o: boolean[]): Abs =>
  abs(
    { k: "fn", params: ["a"], optionalParams: o, paramTypes: [num()] },
    undefined,
    undefined,
    "exact",
  );

const tupleAbs = (holes?: number[]): Abs =>
  abs(
    { k: "tuple", elements: [numLit(1), numLit(2)], ...(holes ? { holes } : {}) },
    undefined,
    undefined,
    "exact",
  );

const RENAME = new Map([["A1", "zzz"]]);

describe("BUG-078 renameAbs preserves shape facets", () => {
  it("keeps fn.optionalParams", () => {
    const renamed = renameAbs(fnAbs([true]), RENAME);
    expect(renamed.shape).toMatchObject({ k: "fn", optionalParams: [true] });
  });

  it("keeps tuple.holes", () => {
    const renamed = renameAbs(tupleAbs([1]), RENAME);
    expect(renamed.shape).toMatchObject({ k: "tuple", holes: [1] });
  });

  it("renamed sparse tuple is still not assignable to dense tuple", () => {
    expect(leqAbs(tupleAbs([1]), tupleAbs()).ok).toBe(false);
    expect(leqAbs(renameAbs(tupleAbs([1]), RENAME), tupleAbs()).ok).toBe(false);
  });
});
