import { describe, it, expect } from "vitest";
import { implies, and, ge, le, eq } from "../pred.ts";
import { lit, v } from "../term.ts";

describe("implies eq from tight bounds", () => {
  it("x≥5 ∧ x≤5 ⊨ x=5", () => {
    const x = v("x");
    const phi = and(ge(x, lit(5)), le(x, lit(5)));
    expect(implies(phi, eq(x, lit(5)))).toBe(true);
  });

  it("x≥5 ∧ x≤6 does not imply x=5", () => {
    const x = v("x");
    const phi = and(ge(x, lit(5)), le(x, lit(6)));
    expect(implies(phi, eq(x, lit(5)))).not.toBe(true);
  });
});
