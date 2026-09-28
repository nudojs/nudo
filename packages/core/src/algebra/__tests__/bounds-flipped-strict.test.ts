/**
 * 数值界提取 / 比较判定。
 * 回归背景：
 * 1. collectBoundsFromPred / collectBoundsFromPhi 只识别「变量在左、字面量在右」，
 *    `0 < x`（≡ x>0）与 `5 > x`（≡ x<5）的界被整段丢掉，约束传播与比较判定失效。
 * 2. decideByBounds 在等界处忽略 strict：x<5 ∧ y>5 仍应推出 x<y；
 *    x≤5 ∧ y≥5 仍应推出 x≤y；x≥5 ∧ y<5 仍应推出 x>y。
 */
import { describe, it, expect } from "vitest";
import {
  add,
  cmp,
  numLit,
  numVar,
  lit,
  v,
  gt,
  ge,
  lt,
  le,
  and,
  formatAbs,
} from "../index.ts";

describe("numeric bounds: flipped comparisons", () => {
  it("0 < x (i.e. x>0) still propagates through add: x+1 > 1", () => {
    const x = numVar("x", lt(lit(0), v("x")));
    const r = add(x, numLit(1));
    expect(formatAbs(r)).toContain(">");
    expect(formatAbs(r)).toContain("1");
  });

  it("5 > x (i.e. x<5) still propagates through add: x+1 < 6", () => {
    const x = numVar("x", gt(lit(5), v("x")));
    const r = add(x, numLit(1));
    expect(formatAbs(r)).toContain("<");
    expect(formatAbs(r)).toContain("6");
  });

  it("0 <= x (i.e. x>=0) still propagates through add: x+1 >= 1", () => {
    const x = numVar("x", le(lit(0), v("x")));
    const r = add(x, numLit(1));
    expect(formatAbs(r)).toContain("≥");
    expect(formatAbs(r)).toContain("1");
  });

  it("5 >= x (i.e. x<=5) still propagates through add: x+1 <= 6", () => {
    const x = numVar("x", ge(lit(5), v("x")));
    const r = add(x, numLit(1));
    expect(formatAbs(r)).toContain("≤");
    expect(formatAbs(r)).toContain("6");
  });
});

describe("decideByBounds: strict / equal bounds", () => {
  it("x<5 vs y>5 implies x<y", () => {
    const x = numVar("x", lt(v("x"), lit(5)));
    const y = numVar("y", gt(v("y"), lit(5)));
    const r = cmp("lt", x, y);
    expect(r.term?.op === "lit" && r.term.value === true).toBe(true);
  });

  it("x<=5 vs y>=5 implies x<=y", () => {
    const x = numVar("x", le(v("x"), lit(5)));
    const y = numVar("y", ge(v("y"), lit(5)));
    const r = cmp("le", x, y);
    expect(r.term?.op === "lit" && r.term.value === true).toBe(true);
  });

  it("x<5 vs y>5 implies x<=y", () => {
    const x = numVar("x", lt(v("x"), lit(5)));
    const y = numVar("y", gt(v("y"), lit(5)));
    const r = cmp("le", x, y);
    expect(r.term?.op === "lit" && r.term.value === true).toBe(true);
  });

  it("x>=5 vs y<5 implies x>y", () => {
    const x = numVar("x", ge(v("x"), lit(5)));
    const y = numVar("y", lt(v("y"), lit(5)));
    const r = cmp("gt", x, y);
    expect(r.term?.op === "lit" && r.term.value === true).toBe(true);
  });

  it("x>5 vs y<=5 implies x>y (strict on one side)", () => {
    const x = numVar("x", gt(v("x"), lit(5)));
    const y = numVar("y", le(v("y"), lit(5)));
    const r = cmp("gt", x, y);
    expect(r.term?.op === "lit" && r.term.value === true).toBe(true);
  });

  it("x>5 vs y<=5 implies NOT x<=y", () => {
    const x = numVar("x", gt(v("x"), lit(5)));
    const y = numVar("y", le(v("y"), lit(5)));
    const r = cmp("le", x, y);
    expect(r.term?.op === "lit" && r.term.value === false).toBe(true);
  });

  it("x<5 vs y>=5 implies NOT x>=y", () => {
    const x = numVar("x", lt(v("x"), lit(5)));
    const y = numVar("y", ge(v("y"), lit(5)));
    const r = cmp("ge", x, y);
    expect(r.term?.op === "lit" && r.term.value === false).toBe(true);
  });

  it("x<=5 vs y>5 implies NOT x>y", () => {
    const x = numVar("x", le(v("x"), lit(5)));
    const y = numVar("y", gt(v("y"), lit(5)));
    const r = cmp("gt", x, y);
    expect(r.term?.op === "lit" && r.term.value === false).toBe(true);
  });
});
